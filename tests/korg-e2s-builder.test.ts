/**
 * tests/features/korg-e2s-builder.test.ts
 *
 * Unit-Tests fuer client/src/utils/korg/e2sBankBuilder.ts und
 * client/src/utils/korg/audioProcessor.ts (v3.4.0).
 *
 * Coverage:
 *   - audioProcessor: floatToInt16LeBytes, resampleLinear, downmixToMono,
 *     peakNormalize, convertToE2sSpec
 *   - e2sBankBuilder:
 *       * Magic-Signature
 *       * Offset-Table @ 0x0010 mit 1020 Einträgen
 *       * Sample-Area beginnt bei 0x1000
 *       * Pro Slot: RIFF + fmt + data + korg-Chunks
 *       * korg-Chunk ist exakt 1180B
 *       * ESLI-Magic + version 0x01F4
 *       * ESLI-Name 16B ASCII space-padded
 *       * Category-Enum-Clamp 0..17
 *       * Empty Slots haben Offset=0
 *       * Slot-Index-Grenze (E2S_MAX_SLOTS) enforced
 *       * File-Size respektiert E2S_MAX_TOTAL_PCM_BYTES
 *
 *   - Round-Trip (THE killer test):
 *       buildE2sBank({slots}) → parseE2sBank → slots ≈ input slots
 */

import { describe, it, expect } from "vitest";
import {
  buildE2sBank,
  E2sBuildError,
  type E2sSlotInput,
} from "../src/core/e2sBankBuilder";
import {
  convertToE2sSpec,
  downmixToMono,
  floatToInt16LeBytes,
  peakNormalize,
  resampleLinear,
  sanitizeE2sSlotName,
  AudioProcessError,
} from "../src/core/audioProcessor";
import { parseE2sBank, countE2sSlots } from "../src/core/e2sBankReader";
import {
  E2S_ALL_OFFSET_TABLE_START,
  E2S_ALL_SAMPLE_AREA_START,
  E2S_ALL_SIGNATURE,
  E2S_MAX_SLOTS,
  ESLI_CATEGORY_OFFSET,
  ESLI_NAME_LEN,
  ESLI_NAME_OFFSET,
  ESLI_SLICE_STRUCT_SIZE,
  ESLI_SLICES_COUNT,
  ESLI_SLICES_OFFSET,
  KORG_BODY_SUBMAGIC,
  KORG_SUBCHUNK_BODY_SIZE,
  KORG_SUBCHUNK_ID,
} from "../src/core/constants";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sineFloat(frames: number, freq = 440, sr = 44100, amp = 0.5): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sr) * amp;
  }
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// ─── audioProcessor — pure helpers ───────────────────────────────────────────

describe("audioProcessor — floatToInt16LeBytes", () => {
  it("encodes 0.0 → 0x00 0x00", () => {
    const out = floatToInt16LeBytes(new Float32Array([0]));
    expect(out[0]).toBe(0);
    expect(out[1]).toBe(0);
  });

  it("encodes +1.0 → 0xFF 0x7F (32767)", () => {
    const out = floatToInt16LeBytes(new Float32Array([1.0]));
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0x7f);
  });

  it("encodes -1.0 → 0x00 0x80 (-32768)", () => {
    const out = floatToInt16LeBytes(new Float32Array([-1.0]));
    expect(out[0]).toBe(0x00);
    expect(out[1]).toBe(0x80);
  });

  it("clips values above +1", () => {
    const out = floatToInt16LeBytes(new Float32Array([1.5, 2.0]));
    // Both should clip to +1.0 → 0xFF 0x7F
    expect(out[0]).toBe(0xff);
    expect(out[1]).toBe(0x7f);
    expect(out[2]).toBe(0xff);
    expect(out[3]).toBe(0x7f);
  });

  it("clips values below -1", () => {
    const out = floatToInt16LeBytes(new Float32Array([-2.0, -1.5]));
    expect(out[0]).toBe(0x00);
    expect(out[1]).toBe(0x80);
  });

  it("maps NaN/Infinity to 0 defensively", () => {
    const out = floatToInt16LeBytes(new Float32Array([NaN, Infinity, -Infinity]));
    for (let i = 0; i < 6; i++) expect(out[i]).toBe(0);
  });

  it("encodes an entire buffer length correctly", () => {
    const out = floatToInt16LeBytes(new Float32Array(100));
    expect(out.length).toBe(200);
  });
});

describe("audioProcessor — resampleLinear", () => {
  it("no-op when input rate == output rate", () => {
    const src = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const out = resampleLinear(src, 44100, 44100, 1);
    expect(out.length).toBe(src.length);
    expect(out[0]).toBeCloseTo(0.1);
  });

  it("doubles sample count when upsampling 2x", () => {
    const src = new Float32Array(100);
    const out = resampleLinear(src, 22050, 44100, 1);
    expect(out.length).toBeCloseTo(200, -1); // floor(100 * 2)
  });

  it("halves sample count when downsampling 2x", () => {
    const src = new Float32Array(100);
    const out = resampleLinear(src, 88200, 44100, 1);
    expect(out.length).toBeCloseTo(50, -1);
  });

  it("preserves stereo interleaving", () => {
    // 100 stereo frames = 200 samples interleaved
    const src = new Float32Array(200);
    for (let i = 0; i < 100; i++) {
      src[i * 2] = 0.5; // L = 0.5 constant
      src[i * 2 + 1] = -0.5; // R = -0.5 constant
    }
    const out = resampleLinear(src, 48000, 44100, 2);
    // First couple frames should still be ~ (0.5, -0.5)
    expect(out[0]).toBeCloseTo(0.5, 2);
    expect(out[1]).toBeCloseTo(-0.5, 2);
  });
});

describe("audioProcessor — downmixToMono", () => {
  it("averages L+R per frame", () => {
    const stereo = new Float32Array([1.0, -1.0, 0.5, -0.5]);
    const { pcm, peak } = downmixToMono(stereo);
    expect(pcm.length).toBe(2);
    expect(pcm[0]).toBeCloseTo(0.0);
    expect(pcm[1]).toBeCloseTo(0.0);
    expect(peak).toBeCloseTo(0.0);
  });

  it("computes correct peak after downmix", () => {
    const stereo = new Float32Array([0.6, 0.8, -0.4, -0.4]);
    const { pcm, peak } = downmixToMono(stereo);
    expect(pcm[0]).toBeCloseTo(0.7);
    expect(pcm[1]).toBeCloseTo(-0.4);
    expect(peak).toBeCloseTo(0.7);
  });
});

describe("audioProcessor — peakNormalize", () => {
  it("scales peak to target", () => {
    const out = peakNormalize(new Float32Array([0.5, -0.3]), 0.95);
    expect(Math.max(...out.map(Math.abs))).toBeCloseTo(0.95);
  });

  it("silent input remains silent", () => {
    const out = peakNormalize(new Float32Array([0, 0, 0]), 0.95);
    expect(out[0]).toBe(0);
  });

  it("rejects target outside (0, 1]", () => {
    expect(() => peakNormalize(new Float32Array([0.5]), 0)).toThrow(AudioProcessError);
    expect(() => peakNormalize(new Float32Array([0.5]), 1.5)).toThrow(AudioProcessError);
  });
});

describe("audioProcessor — convertToE2sSpec", () => {
  it("passes through mono 44.1kHz unchanged (no resample, no downmix)", () => {
    const pcm = sineFloat(1000);
    const out = convertToE2sSpec(pcm, 44100, 1);
    expect(out.sampleRate).toBe(44100);
    expect(out.channels).toBe(1);
    expect(out.frames).toBe(1000);
  });

  it("resamples 48k → 44.1k", () => {
    const pcm = sineFloat(48000); // 1 second @ 48k
    const out = convertToE2sSpec(pcm, 48000, 1, { targetSampleRate: 44100 });
    expect(out.sampleRate).toBe(44100);
    // ~44100 frames ± rounding
    expect(out.frames).toBeGreaterThan(43000);
    expect(out.frames).toBeLessThan(45000);
  });

  it("downmixes stereo → mono when forceMono=true", () => {
    const interleaved = new Float32Array(200);
    const out = convertToE2sSpec(interleaved, 44100, 2, { forceMono: true });
    expect(out.channels).toBe(1);
    expect(out.frames).toBe(100);
  });

  it("rejects per-slot cap violation", () => {
    // Allocate huge Float32Array (>10 MB after int16 conversion = >5M frames)
    const tooBig = new Float32Array(6_000_000); // 6M × 2B = 12 MB
    expect(() => convertToE2sSpec(tooBig, 44100, 1)).toThrow(AudioProcessError);
  });

  it("rejects invalid target sample rate", () => {
    const pcm = sineFloat(100);
    expect(() =>
      convertToE2sSpec(pcm, 44100, 1, { targetSampleRate: 22050 as unknown as 44100 }),
    ).toThrow(AudioProcessError);
  });
});

describe("audioProcessor — sanitizeE2sSlotName", () => {
  it("strips non-ASCII characters", () => {
    expect(sanitizeE2sSlotName("Kick_ä1")).toBe("Kick_1");
  });

  it("truncates to maxLen (default 16)", () => {
    expect(sanitizeE2sSlotName("ABCDEFGHIJKLMNOPQR").length).toBe(16);
  });

  it("keeps printable ASCII 0x20..0x7E", () => {
    expect(sanitizeE2sSlotName("Test 01-2.wav")).toBe("Test 01-2.wav");
  });
});

// ─── e2sBankBuilder ──────────────────────────────────────────────────────────

describe("e2sBankBuilder — produced file structure", () => {
  it("produces a valid 'e2s sample all\\x1a\\x00' signature at 0x0000", () => {
    const result = buildE2sBank([]);
    const view = new Uint8Array(result.buffer);
    expect(bytesEqual(view.subarray(0, 16), E2S_ALL_SIGNATURE)).toBe(true);
  });

  it("places offset table at 0x07E0 with 250 entries", () => {
    const pcm = sineFloat(100);
    const inputs: E2sSlotInput[] = [
      { slotIndex: 0, name: "Kick01", pcmData: pcm, sampleRate: 44100, channels: 1 },
    ];
    const result = buildE2sBank(inputs);
    expect(result.buffer.byteLength).toBeGreaterThan(0x1000);
    const dv = new DataView(result.buffer);
    // First entry must point at >= 0x1000
    const first = dv.getUint32(E2S_ALL_OFFSET_TABLE_START, true);
    expect(first).toBe(E2S_ALL_SAMPLE_AREA_START);
    // 250th entry exists and is readable (= 0 for empty)
    const last = dv.getUint32(E2S_ALL_OFFSET_TABLE_START + (E2S_MAX_SLOTS - 1) * 4, true);
    expect(last).toBe(0);
  });

  it("sample area begins at 0x1000", () => {
    const result = buildE2sBank([
      { slotIndex: 5, name: "X", pcmData: new Float32Array(50), sampleRate: 44100, channels: 1 },
    ]);
    const dv = new DataView(result.buffer);
    const off5 = dv.getUint32(E2S_ALL_OFFSET_TABLE_START + 5 * 4, true);
    expect(off5).toBe(E2S_ALL_SAMPLE_AREA_START);
    // The 4 bytes at 0x1000 must be 'RIFF'
    const view = new Uint8Array(result.buffer);
    expect(view[E2S_ALL_SAMPLE_AREA_START]).toBe(0x52);     // R
    expect(view[E2S_ALL_SAMPLE_AREA_START + 1]).toBe(0x49); // I
    expect(view[E2S_ALL_SAMPLE_AREA_START + 2]).toBe(0x46); // F
    expect(view[E2S_ALL_SAMPLE_AREA_START + 3]).toBe(0x46); // F
  });

  it("each slot contains RIFF + fmt + data + korg sub-chunks", () => {
    const pcm = sineFloat(200);
    const result = buildE2sBank([
      { slotIndex: 0, name: "Probe", pcmData: pcm, sampleRate: 44100, channels: 1 },
    ]);
    const view = new Uint8Array(result.buffer);
    // After RIFF header (4 + 4 = 8) we expect 'WAVE'
    const start = E2S_ALL_SAMPLE_AREA_START;
    const ascii = (off: number, len: number) =>
      Array.from(view.subarray(off, off + len))
        .map((b) => String.fromCharCode(b))
        .join("");
    expect(ascii(start, 4)).toBe("RIFF");
    expect(ascii(start + 8, 4)).toBe("WAVE");
    // 'fmt ' chunk follows immediately at start+12
    expect(ascii(start + 12, 4)).toBe("fmt ");
    // 'fmt' chunk size LE32 = 16
    const dv = new DataView(result.buffer);
    expect(dv.getUint32(start + 16, true)).toBe(16);
    // After fmt body (16 bytes) comes 'data' at start+12+8+16 = start+36
    expect(ascii(start + 36, 4)).toBe("data");
    const dataSize = dv.getUint32(start + 40, true);
    expect(dataSize).toBe(pcm.length * 2); // mono × 2 bytes
    // Then 'korg' should follow after data + optional pad
    const korgOff = start + 36 + 8 + dataSize + (dataSize & 1);
    expect(ascii(korgOff, 4)).toBe("korg");
  });

  it("korg sub-chunk body is exactly 1180 bytes", () => {
    const result = buildE2sBank([
      { slotIndex: 0, name: "K", pcmData: new Float32Array(10), sampleRate: 44100, channels: 1 },
    ]);
    const view = new Uint8Array(result.buffer);
    // Find 'korg' bytes
    let pos = -1;
    for (let i = E2S_ALL_SAMPLE_AREA_START; i < view.length - 8; i++) {
      if (
        view[i] === 0x6b &&
        view[i + 1] === 0x6f &&
        view[i + 2] === 0x72 &&
        view[i + 3] === 0x67
      ) {
        pos = i;
        break;
      }
    }
    expect(pos).toBeGreaterThan(0);
    const dv = new DataView(result.buffer);
    const size = dv.getUint32(pos + 4, true);
    expect(size).toBe(KORG_SUBCHUNK_BODY_SIZE);
    expect(size).toBe(1180);
  });

  it("ESLI sub-magic, declared-size and OSC_0index (@+0x08) are correct", () => {
    const result = buildE2sBank([
      { slotIndex: 7, sampleNumber: 501, name: "Y", pcmData: new Float32Array(10), sampleRate: 44100, channels: 1 },
    ]);
    const view = new Uint8Array(result.buffer);
    // Find 'korg' header, then check body fields.
    let korgAt = -1;
    for (let i = E2S_ALL_SAMPLE_AREA_START; i < view.length - 8; i++) {
      if (
        view[i] === 0x6b &&
        view[i + 1] === 0x6f &&
        view[i + 2] === 0x72 &&
        view[i + 3] === 0x67
      ) {
        korgAt = i;
        break;
      }
    }
    expect(korgAt).toBeGreaterThan(0);
    const bodyStart = korgAt + 8;
    // First 4 bytes of body == 'esli'
    expect(bytesEqual(view.subarray(bodyStart, bodyStart + 4), KORG_BODY_SUBMAGIC)).toBe(true);
    // declared-size LE32 at body+4
    const dv = new DataView(result.buffer);
    expect(dv.getUint32(bodyStart + 4, true)).toBe(0x0494);
    // v3.271: body+0x08 is OSC_0index (sample number), NOT a constant "version".
    expect(dv.getUint16(bodyStart + 0x08, true)).toBe(501);
  });

  it("ESLI name is 16 bytes ASCII, NUL-padded", () => {
    const result = buildE2sBank([
      { slotIndex: 0, name: "Hello", pcmData: new Float32Array(10), sampleRate: 44100, channels: 1 },
    ]);
    const view = new Uint8Array(result.buffer);
    // Locate body of first korg chunk
    let korgAt = -1;
    for (let i = E2S_ALL_SAMPLE_AREA_START; i < view.length - 8; i++) {
      if (view[i] === 0x6b && view[i + 1] === 0x6f && view[i + 2] === 0x72 && view[i + 3] === 0x67) {
        korgAt = i;
        break;
      }
    }
    expect(korgAt).toBeGreaterThan(0);
    const bodyStart = korgAt + 8;
    const nameStart = bodyStart + ESLI_NAME_OFFSET;
    const nameBytes = view.subarray(nameStart, nameStart + ESLI_NAME_LEN);
    expect(nameBytes.length).toBe(16);
    // First 5 chars must be "Hello" (0x48 0x65 0x6c 0x6c 0x6f)
    expect(nameBytes[0]).toBe(0x48);
    expect(nameBytes[1]).toBe(0x65);
    expect(nameBytes[2]).toBe(0x6c);
    expect(nameBytes[3]).toBe(0x6c);
    expect(nameBytes[4]).toBe(0x6f);
    // Bytes 5..15 should all be 0 (padding)
    for (let i = 5; i < 16; i++) expect(nameBytes[i]).toBe(0);
  });

  it("category enum is clamped to [0,17]", () => {
    const result = buildE2sBank([
      { slotIndex: 0, name: "A", pcmData: new Float32Array(4), sampleRate: 44100, channels: 1, category: 99 },
    ]);
    const view = new Uint8Array(result.buffer);
    let korgAt = -1;
    for (let i = E2S_ALL_SAMPLE_AREA_START; i < view.length - 8; i++) {
      if (view[i] === 0x6b && view[i + 1] === 0x6f && view[i + 2] === 0x72 && view[i + 3] === 0x67) {
        korgAt = i;
        break;
      }
    }
    const dv = new DataView(result.buffer);
    const cat = dv.getUint16(korgAt + 8 + ESLI_CATEGORY_OFFSET, true);
    expect(cat).toBe(17);
  });

  it("empty slots have offset = 0 in the offset table", () => {
    const result = buildE2sBank([
      { slotIndex: 0, name: "A", pcmData: new Float32Array(4), sampleRate: 44100, channels: 1 },
      { slotIndex: 3, name: "B", pcmData: new Float32Array(4), sampleRate: 44100, channels: 1 },
    ]);
    const dv = new DataView(result.buffer);
    expect(dv.getUint32(E2S_ALL_OFFSET_TABLE_START + 0 * 4, true)).toBeGreaterThan(0);
    expect(dv.getUint32(E2S_ALL_OFFSET_TABLE_START + 1 * 4, true)).toBe(0);
    expect(dv.getUint32(E2S_ALL_OFFSET_TABLE_START + 2 * 4, true)).toBe(0);
    expect(dv.getUint32(E2S_ALL_OFFSET_TABLE_START + 3 * 4, true)).toBeGreaterThan(0);
  });

  it("throws when more than 250 slot inputs are provided", () => {
    const inputs: E2sSlotInput[] = [];
    for (let i = 0; i < E2S_MAX_SLOTS + 1; i++) {
      inputs.push({
        slotIndex: i,
        name: `S${i}`,
        pcmData: new Float32Array(2),
        sampleRate: 44100,
        channels: 1,
      });
    }
    expect(() => buildE2sBank(inputs)).toThrow(E2sBuildError);
  });

  it("warns on duplicate slot indices, keeping first", () => {
    const result = buildE2sBank([
      { slotIndex: 5, name: "A", pcmData: new Float32Array(4), sampleRate: 44100, channels: 1 },
      { slotIndex: 5, name: "B", pcmData: new Float32Array(4), sampleRate: 44100, channels: 1 },
    ]);
    expect(result.warnings.some((w) => w.includes("more than once"))).toBe(true);
    // Round-trip: nur Slot 5 sollte sichtbar sein
    const bank = parseE2sBank(result.buffer);
    expect(bank.slots[5]?.name).toBe("A");
  });

  it("rejects invalid sampleRate", () => {
    expect(() =>
      buildE2sBank([
        { slotIndex: 0, name: "A", pcmData: new Float32Array(4), sampleRate: 0, channels: 1 },
      ]),
    ).toThrow(E2sBuildError);
  });

  it("rejects PCM larger than per-slot cap (10 MB)", () => {
    // 10 MB worth of int16 = 5_242_880 frames mono
    const huge = new Float32Array(5_300_000);
    expect(() =>
      buildE2sBank([
        { slotIndex: 0, name: "X", pcmData: huge, sampleRate: 44100, channels: 1 },
      ]),
    ).toThrow(E2sBuildError);
  });
});

// ─── ROUND-TRIP — Builder → Reader → Identity ───────────────────────────────

describe("e2sBankBuilder — Round-Trip (build → parse)", () => {
  it("round-trips a single mono slot with name + category", () => {
    const pcm = sineFloat(500);
    const result = buildE2sBank([
      {
        slotIndex: 0,
        name: "Kick01",
        pcmData: pcm,
        sampleRate: 44100,
        channels: 1,
        category: 2, // Kick
      },
    ]);
    const bank = parseE2sBank(result.buffer);
    expect(countE2sSlots(bank)).toBe(1);
    const slot = bank.slots[0]!;
    expect(slot.name).toBe("Kick01");
    expect(slot.category).toBe(2);
    expect(slot.categoryName).toBe("Kick");
    expect(slot.channels).toBe(1);
    expect(slot.sampleRate).toBe(44100);
    expect(slot.frames).toBe(500);
    // PCM values should approximately match the source
    expect(slot.pcmData[10]).toBeCloseTo(pcm[10], 3);
    expect(slot.pcmData[100]).toBeCloseTo(pcm[100], 3);
  });

  it("round-trips a stereo slot", () => {
    const inter = new Float32Array(200);
    for (let i = 0; i < 100; i++) {
      inter[i * 2] = 0.3;
      inter[i * 2 + 1] = -0.7;
    }
    const result = buildE2sBank([
      {
        slotIndex: 7,
        name: "Stereo",
        pcmData: inter,
        sampleRate: 48000,
        channels: 2,
        category: 14, // Phrase
      },
    ]);
    const bank = parseE2sBank(result.buffer);
    const slot = bank.slots[7]!;
    expect(slot).not.toBeNull();
    expect(slot.channels).toBe(2);
    expect(slot.sampleRate).toBe(48000);
    expect(slot.frames).toBe(100);
    expect(slot.pcmData[0]).toBeCloseTo(0.3, 3);
    expect(slot.pcmData[1]).toBeCloseTo(-0.7, 3);
  });

  it("round-trips multiple slots with gaps (empty indices remain null)", () => {
    const result = buildE2sBank([
      { slotIndex: 0, name: "First", pcmData: new Float32Array(40), sampleRate: 44100, channels: 1 },
      { slotIndex: 5, name: "Five", pcmData: new Float32Array(40), sampleRate: 44100, channels: 1 },
      { slotIndex: 249, name: "Last", pcmData: new Float32Array(40), sampleRate: 44100, channels: 1 },
    ]);
    const bank = parseE2sBank(result.buffer);
    expect(countE2sSlots(bank)).toBe(3);
    expect(bank.slots[0]?.name).toBe("First");
    expect(bank.slots[1]).toBeNull();
    expect(bank.slots[5]?.name).toBe("Five");
    expect(bank.slots[249]?.name).toBe("Last");
  });

  it("name with non-ASCII is sanitized + round-trips", () => {
    const result = buildE2sBank([
      { slotIndex: 0, name: "Käfer!", pcmData: new Float32Array(10), sampleRate: 44100, channels: 1 },
    ]);
    const bank = parseE2sBank(result.buffer);
    // Umlaut wird stripped → "Kfer!"
    expect(bank.slots[0]?.name).toBe("Kfer!");
  });

  it("level field is preserved after round-trip (modulo u16 quantization)", () => {
    const result = buildE2sBank([
      {
        slotIndex: 0,
        name: "L",
        pcmData: new Float32Array(10),
        sampleRate: 44100,
        channels: 1,
        level: 127,
      },
    ]);
    const bank = parseE2sBank(result.buffer);
    // Reader normalizes back to [0..127] - allow ±1 for quantization
    expect(bank.slots[0]?.level).toBeGreaterThanOrEqual(126);
    expect(bank.slots[0]?.level).toBeLessThanOrEqual(127);
  });

  it("gain12db flag round-trips", () => {
    const result = buildE2sBank([
      {
        slotIndex: 0,
        name: "G",
        pcmData: new Float32Array(10),
        sampleRate: 44100,
        channels: 1,
        gain12db: true,
      },
    ]);
    const bank = parseE2sBank(result.buffer);
    expect(bank.slots[0]?.gain12db).toBe(true);
  });
});

describe("e2sBankBuilder — File-Size invariants", () => {
  it("total file size includes prelude + RIFF chunks", () => {
    const pcm = new Float32Array(100);
    const result = buildE2sBank([
      { slotIndex: 0, name: "A", pcmData: pcm, sampleRate: 44100, channels: 1 },
    ]);
    // Expected:
    //   prelude (0x1000) +
    //   RIFF header (8) + WAVE (4) + fmt(8+16) + data(8 + 200) + korg(8+1180)
    // = 4096 + 8 + 4 + 24 + 208 + 1188 = 5528
    expect(result.buffer.byteLength).toBe(5528);
  });

  it("empty bank size equals prelude only (0x1000)", () => {
    const result = buildE2sBank([]);
    expect(result.buffer.byteLength).toBe(E2S_ALL_SAMPLE_AREA_START);
  });

  it("respects E2S_MAX_TOTAL_PCM_BYTES cap (cumulative PCM)", () => {
    // 25 slots × ~9.5 MB = 237 MB > 224 MB cap
    // Use a near-cap slot size to trigger the cumulative check.
    const justUnderCap = new Float32Array(4_500_000); // 9 MB int16
    const inputs: E2sSlotInput[] = [];
    for (let i = 0; i < 30; i++) {
      inputs.push({
        slotIndex: i,
        name: `B${i}`,
        pcmData: justUnderCap,
        sampleRate: 44100,
        channels: 1,
      });
    }
    expect(() => buildE2sBank(inputs)).toThrow(/cumulative PCM/);
  });
});

// ─── v3.6.0 — Raw-RIFF-Preservation ─────────────────────────────────────────

describe("e2sBankBuilder — Raw-RIFF-Preservation (v3.6.0)", () => {
  it("identisches read→write Round-Trip ist bit-exact (preserveRawRiff)", () => {
    const pcm = sineFloat(500, 440, 44100, 0.3);
    // Stage 1 — bauen mit "frischem" Slot (re-encoded).
    const baseline = buildE2sBank([
      {
        slotIndex: 0,
        name: "BitExact",
        pcmData: pcm,
        sampleRate: 44100,
        channels: 1,
        category: 2,
        level: 100,
      },
    ]);
    // Stage 2 — Reader liest mit preserveRawRiff: true, dann Builder mit
    // preserveRawRiff: true + isDirty=false.
    const bank = parseE2sBank(baseline.buffer, "<test>", { preserveRawRiff: true });
    const slot = bank.slots[0]!;
    expect(slot.rawRiff).toBeInstanceOf(Uint8Array);
    expect(slot.rawRiff!.length).toBeGreaterThan(0);

    const rebuilt = buildE2sBank(
      [
        {
          slotIndex: 0,
          name: slot.name,
          pcmData: slot.pcmData,
          sampleRate: slot.sampleRate,
          channels: slot.channels,
          category: slot.category,
          rawRiff: slot.rawRiff,
          isDirty: false,
        },
      ],
      { preserveRawRiff: true },
    );

    // Bit-exakt zu Baseline (prelude + RIFF beide identisch).
    expect(rebuilt.buffer.byteLength).toBe(baseline.buffer.byteLength);
    const a = new Uint8Array(baseline.buffer);
    const b = new Uint8Array(rebuilt.buffer);
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        throw new Error(`bit-diff at byte ${i}: ${a[i]} != ${b[i]}`);
      }
    }
    expect(b.length).toBe(a.length);
  });

  it("dirty Slot wird re-encoded, unedited Slot bleibt rawRiff (mixed bank)", () => {
    // Baseline: 2 slots
    const baseline = buildE2sBank([
      { slotIndex: 0, name: "Keep", pcmData: sineFloat(40, 440, 44100, 0.2), sampleRate: 44100, channels: 1, category: 3 },
      { slotIndex: 1, name: "Change", pcmData: sineFloat(40, 880, 44100, 0.2), sampleRate: 44100, channels: 1, category: 4 },
    ]);
    const bank = parseE2sBank(baseline.buffer, "<t>", { preserveRawRiff: true });
    const slot0 = bank.slots[0]!;
    const slot1 = bank.slots[1]!;

    // Slot 0 unedited (rawRiff Passthrough), Slot 1 mit neuem Namen → re-encoded.
    const rebuilt = buildE2sBank(
      [
        {
          slotIndex: 0,
          name: slot0.name,
          pcmData: slot0.pcmData,
          sampleRate: slot0.sampleRate,
          channels: slot0.channels,
          category: slot0.category,
          rawRiff: slot0.rawRiff,
          isDirty: false,
        },
        {
          slotIndex: 1,
          name: "Renamed",
          pcmData: slot1.pcmData,
          sampleRate: slot1.sampleRate,
          channels: slot1.channels,
          category: slot1.category,
          rawRiff: slot1.rawRiff,
          isDirty: true,
        },
      ],
      { preserveRawRiff: true },
    );

    const reparsed = parseE2sBank(rebuilt.buffer);
    expect(reparsed.slots[0]?.name).toBe("Keep");
    expect(reparsed.slots[1]?.name).toBe("Renamed");

    // Verify slot 0's RIFF-bytes in rebuilt == baseline's slot 0 RIFF-bytes.
    const a = new Uint8Array(baseline.buffer);
    const b = new Uint8Array(rebuilt.buffer);
    const baselineDv = new DataView(baseline.buffer);
    const rebuiltDv = new DataView(rebuilt.buffer);
    const off0Base = baselineDv.getUint32(E2S_ALL_OFFSET_TABLE_START + 0 * 4, true);
    const off0Reb = rebuiltDv.getUint32(E2S_ALL_OFFSET_TABLE_START + 0 * 4, true);
    expect(off0Reb).toBe(off0Base);
    const riffSize0Base = baselineDv.getUint32(off0Base + 4, true);
    const riffSize0Reb = rebuiltDv.getUint32(off0Reb + 4, true);
    expect(riffSize0Reb).toBe(riffSize0Base);
    for (let i = off0Base; i < off0Base + 8 + riffSize0Base; i++) {
      if (a[i] !== b[i]) {
        throw new Error(`slot 0 RIFF byte ${i} differs: ${a[i]} != ${b[i]}`);
      }
    }
  });

  it("Hash der gesamten .all-Datei nach Round-Trip ist identical (preserveRawRiff)", () => {
    // Hash = simple FNV-1a 32-bit für Test-Determinismus.
    function fnv1a(buf: Uint8Array): number {
      let h = 0x811c9dc5;
      for (let i = 0; i < buf.length; i++) {
        h ^= buf[i];
        h = (h * 0x01000193) >>> 0;
      }
      return h >>> 0;
    }
    const baseline = buildE2sBank([
      { slotIndex: 0, name: "Hash1", pcmData: sineFloat(60, 220, 44100, 0.1), sampleRate: 44100, channels: 1, category: 1 },
      { slotIndex: 7, name: "Hash2", pcmData: sineFloat(60, 660, 44100, 0.1), sampleRate: 44100, channels: 1, category: 5 },
    ]);
    const bank = parseE2sBank(baseline.buffer, "<h>", { preserveRawRiff: true });
    const slots = bank.slots.flatMap((s, i) =>
      s
        ? [{
            slotIndex: i,
            name: s.name,
            pcmData: s.pcmData,
            sampleRate: s.sampleRate,
            channels: s.channels,
            category: s.category,
            rawRiff: s.rawRiff,
            isDirty: false,
          }]
        : [],
    );
    const rebuilt = buildE2sBank(slots, { preserveRawRiff: true });
    const baselineHash = fnv1a(new Uint8Array(baseline.buffer));
    const rebuiltHash = fnv1a(new Uint8Array(rebuilt.buffer));
    expect(rebuiltHash).toBe(baselineHash);
  });

  it("ohne preserveRawRiff → Slots werden re-encoded (legacy v3.4-Pfad)", () => {
    const baseline = buildE2sBank([
      { slotIndex: 0, name: "LegacyA", pcmData: new Float32Array(20), sampleRate: 44100, channels: 1, category: 2, level: 50 },
    ]);
    const bank = parseE2sBank(baseline.buffer, "<l>", { preserveRawRiff: true });
    const slot = bank.slots[0]!;
    expect(slot.rawRiff).toBeInstanceOf(Uint8Array);

    // OPT-OUT: kein preserveRawRiff im Builder → muss neu encoden, kann
    // sich aber semantisch identisch verhalten.
    const rebuilt = buildE2sBank([
      {
        slotIndex: 0,
        name: slot.name,
        pcmData: slot.pcmData,
        sampleRate: slot.sampleRate,
        channels: slot.channels,
        category: slot.category,
        level: slot.level,
        rawRiff: slot.rawRiff,
        isDirty: false,
      },
    ]);
    // Semantic round-trip works either way:
    const reparsed = parseE2sBank(rebuilt.buffer);
    expect(reparsed.slots[0]?.name).toBe("LegacyA");
  });

  it("isDirty=true bricht Passthrough auch wenn rawRiff vorhanden", () => {
    const baseline = buildE2sBank([
      { slotIndex: 0, name: "BeforeEdit", pcmData: new Float32Array(20), sampleRate: 44100, channels: 1, category: 2 },
    ]);
    const bank = parseE2sBank(baseline.buffer, "<e>", { preserveRawRiff: true });
    const slot = bank.slots[0]!;

    const rebuilt = buildE2sBank(
      [
        {
          slotIndex: 0,
          name: "AfterEdit",
          pcmData: slot.pcmData,
          sampleRate: slot.sampleRate,
          channels: slot.channels,
          category: slot.category,
          rawRiff: slot.rawRiff,
          isDirty: true, // ← forces re-encode despite rawRiff
        },
      ],
      { preserveRawRiff: true },
    );

    const reparsed = parseE2sBank(rebuilt.buffer);
    expect(reparsed.slots[0]?.name).toBe("AfterEdit");
  });

  it("Reader OHNE preserveRawRiff: slot.rawRiff bleibt undefined", () => {
    const baseline = buildE2sBank([
      { slotIndex: 0, name: "NoRaw", pcmData: new Float32Array(10), sampleRate: 44100, channels: 1 },
    ]);
    const bank = parseE2sBank(baseline.buffer); // default opts
    expect(bank.slots[0]?.rawRiff).toBeUndefined();
  });

  it("kaputtes rawRiff → Fallback auf Re-Encode + Warning", () => {
    const corrupt = new Uint8Array([0x42, 0x42, 0x42, 0x42, 0, 0, 0, 0, 0, 0, 0, 0]); // not RIFF
    const result = buildE2sBank(
      [
        {
          slotIndex: 0,
          name: "Salvage",
          pcmData: new Float32Array(10),
          sampleRate: 44100,
          channels: 1,
          rawRiff: corrupt,
          isDirty: false,
        },
      ],
      { preserveRawRiff: true },
    );
    // Should have warned about invalid magic, then re-encoded successfully.
    expect(result.warnings.some((w) => w.includes("invalid magic"))).toBe(true);
    const bank = parseE2sBank(result.buffer);
    expect(bank.slots[0]?.name).toBe("Salvage");
  });
});

// ─── v3.8.0 ESLI-Slice Round-Trip & Byte-Layout ───────────────────────────────

describe("v3.8.0 ESLI Slice serialization", () => {
  /** Finds the offset of the 'korg' chunk *body* (i.e. start of the 1180-byte body)
   *  for the first slot. */
  function findKorgBodyOffset(buf: ArrayBuffer): number {
    const view = new Uint8Array(buf);
    for (let i = E2S_ALL_SAMPLE_AREA_START; i < view.length - 8; i++) {
      if (
        view[i] === 0x6b &&
        view[i + 1] === 0x6f &&
        view[i + 2] === 0x72 &&
        view[i + 3] === 0x67
      ) {
        return i + 8; // skip 'korg' + size = 8 bytes
      }
    }
    return -1;
  }

  it("Slices werden in ESLI bei 0x58 korrekt als 4×LE32 serialisiert", () => {
    const result = buildE2sBank([
      {
        slotIndex: 0,
        name: "Slice",
        pcmData: new Float32Array(10_000),
        sampleRate: 44100,
        channels: 1,
        slices: [
          { start: 0, length: 1234, attackLength: 10, amplitude: 100 },
          { start: 1234, length: 5678, attackLength: 20, amplitude: 200 },
        ],
      },
    ]);
    const bodyOff = findKorgBodyOffset(result.buffer);
    expect(bodyOff).toBeGreaterThan(0);
    const dv = new DataView(result.buffer);

    // Slice 0 @ body+0x58
    const s0 = bodyOff + ESLI_SLICES_OFFSET;
    expect(dv.getInt32(s0, true)).toBe(0);
    expect(dv.getUint32(s0 + 4, true)).toBe(1234);
    expect(dv.getUint32(s0 + 8, true)).toBe(10);
    expect(dv.getUint32(s0 + 12, true)).toBe(100);

    // Slice 1 @ body+0x58+16
    const s1 = s0 + ESLI_SLICE_STRUCT_SIZE;
    expect(dv.getInt32(s1, true)).toBe(1234);
    expect(dv.getUint32(s1 + 4, true)).toBe(5678);
    expect(dv.getUint32(s1 + 8, true)).toBe(20);
    expect(dv.getUint32(s1 + 12, true)).toBe(200);

    // Slice 2 @ body+0x58+32 — should be all zero (no slice given)
    const s2 = s0 + 2 * ESLI_SLICE_STRUCT_SIZE;
    expect(dv.getInt32(s2, true)).toBe(0);
    expect(dv.getUint32(s2 + 4, true)).toBe(0);
    expect(dv.getUint32(s2 + 8, true)).toBe(0);
    expect(dv.getUint32(s2 + 12, true)).toBe(0);
  });

  it("Sample-Nummer wird pro Slot in BEIDE esli-Felder geschrieben (+0x08 & +0x56, v3.271)", () => {
    // Walk the offset table → each slot's RIFF → korg/esli body → read a field.
    const readAt = (buf: ArrayBuffer, slotPos: number, off: number): number => {
      const dv = new DataView(buf);
      const riffOff = dv.getUint32(E2S_ALL_OFFSET_TABLE_START + slotPos * 4, true);
      let p = riffOff + 12;
      const end = riffOff + 8 + dv.getUint32(riffOff + 4, true);
      while (p + 8 <= end) {
        const id = String.fromCharCode(...new Uint8Array(buf, p, 4));
        const sz = dv.getUint32(p + 4, true);
        if (id === "korg") return dv.getUint16(p + 8 + off, true);
        p += 8 + sz + (sz & 1);
      }
      return -1;
    };
    const num = (buf: ArrayBuffer, pos: number) => ({
      osc0: readAt(buf, pos, 0x08), // OSC_0index
      osc1: readAt(buf, pos, 0x56), // OSC_0index1
    });

    // Explicit sampleNumber → written verbatim to BOTH fields (user samples 501+).
    const withNumbers = buildE2sBank([
      { slotIndex: 0, sampleNumber: 501, name: "A", pcmData: new Float32Array(2000), sampleRate: 44100, channels: 1 },
      { slotIndex: 1, sampleNumber: 502, name: "B", pcmData: new Float32Array(2000), sampleRate: 44100, channels: 1 },
      { slotIndex: 2, sampleNumber: 666, name: "C", pcmData: new Float32Array(2000), sampleRate: 44100, channels: 1 },
    ]);
    expect(num(withNumbers.buffer, 0)).toEqual({ osc0: 501, osc1: 501 });
    expect(num(withNumbers.buffer, 1)).toEqual({ osc0: 502, osc1: 502 });
    expect(num(withNumbers.buffer, 2)).toEqual({ osc0: 666, osc1: 666 });

    // Default (no sampleNumber) → falls back to slotIndex in both fields.
    const defaulted = buildE2sBank([
      { slotIndex: 3, name: "D", pcmData: new Float32Array(2000), sampleRate: 44100, channels: 1 },
      { slotIndex: 9, name: "E", pcmData: new Float32Array(2000), sampleRate: 44100, channels: 1 },
    ]);
    expect(num(defaulted.buffer, 3)).toEqual({ osc0: 3, osc1: 3 });
    expect(num(defaulted.buffer, 9)).toEqual({ osc0: 9, osc1: 9 });
  });

  it("WAV_dataSize (@0x44) + end address (@0x38) werden gesetzt (v3.271 'lädt nicht'-Fix)", () => {
    const frames = 5000;
    const result = buildE2sBank([
      { slotIndex: 0, name: "Snd", pcmData: new Float32Array(frames), sampleRate: 44100, channels: 1 },
    ]);
    const dv = new DataView(result.buffer);
    const riffOff = dv.getUint32(E2S_ALL_OFFSET_TABLE_START, true);
    let p = riffOff + 12;
    const end = riffOff + 8 + dv.getUint32(riffOff + 4, true);
    let dataSize = -1, bodyOff = -1;
    while (p + 8 <= end) {
      const id = String.fromCharCode(...new Uint8Array(result.buffer, p, 4));
      const sz = dv.getUint32(p + 4, true);
      if (id === "data") dataSize = sz;
      if (id === "korg") bodyOff = p + 8;
      p += 8 + sz + (sz & 1);
    }
    const pcmBytes = frames * 2; // 16-bit mono
    expect(dataSize).toBe(pcmBytes);
    // WAV_dataSize must equal the data byte count (else device sees empty sample).
    expect(dv.getUint32(bodyOff + 0x44, true)).toBe(pcmBytes);
    // EndPoint = last-frame address = dataSize - frameBytes.
    expect(dv.getUint32(bodyOff + 0x38, true)).toBe(pcmBytes - 2);
    expect(dv.getUint32(bodyOff + 0x30, true)).toBe(0); // StartPoint
    // playLogPeriod @0x2A — frequency-derived (44100 → 15736). Without it the
    // device has no playback rate → sample won't load/play.
    expect(dv.getUint16(bodyOff + 0x2a, true)).toBe(15736);
  });

  it("playLogPeriod (@0x2A) + importNum (@0x1C) match real-file formulas", () => {
    const mk = (sr: number, num: number) =>
      buildE2sBank([
        { slotIndex: 0, sampleNumber: num, name: "X", pcmData: new Float32Array(100), sampleRate: sr, channels: 1 },
      ]);
    const read = (buf: ArrayBuffer, off: number) => {
      const dv = new DataView(buf);
      const riffOff = dv.getUint32(E2S_ALL_OFFSET_TABLE_START, true);
      let p = riffOff + 12;
      const end = riffOff + 8 + dv.getUint32(riffOff + 4, true);
      while (p + 8 <= end) {
        const id = String.fromCharCode(...new Uint8Array(buf, p, 4));
        const sz = dv.getUint32(p + 4, true);
        if (id === "korg") return dv.getUint16(p + 8 + off, true);
        p += 8 + sz + (sz & 1);
      }
      return -1;
    };
    expect(read(mk(44100, 501).buffer, 0x2a)).toBe(15736); // playLogPeriod 44.1k
    expect(read(mk(48000, 501).buffer, 0x2a)).toBe(15360); // playLogPeriod 48k
    expect(read(mk(44100, 501).buffer, 0x1c)).toBe(551); // importNum = num + 50
    expect(read(mk(44100, 666).buffer, 0x1c)).toBe(716);
  });

  it("Read → Edit Slices → Write → Read produziert identische Slices", () => {
    const inputSlices = [
      { start: 0, length: 4000, attackLength: 0, amplitude: 0 },
      { start: 4000, length: 3000, attackLength: 0, amplitude: 0 },
      { start: 7000, length: 3000, attackLength: 0, amplitude: 0 },
    ];
    const built = buildE2sBank([
      {
        slotIndex: 7,
        name: "Loop",
        pcmData: new Float32Array(10_000),
        sampleRate: 44100,
        channels: 1,
        slices: inputSlices,
      },
    ]);
    const bank = parseE2sBank(built.buffer);
    const slot = bank.slots[7];
    expect(slot).not.toBeNull();
    expect(slot!.slices).toEqual(inputSlices);

    // Now edit the slices: add one, modify one, then re-write
    const editedSlices = [
      { start: 0, length: 2000, attackLength: 0, amplitude: 0 },
      { start: 2000, length: 2000, attackLength: 0, amplitude: 0 },
      { start: 4000, length: 3000, attackLength: 0, amplitude: 0 },
      { start: 7000, length: 3000, attackLength: 0, amplitude: 0 },
    ];
    const built2 = buildE2sBank([
      {
        slotIndex: 7,
        name: "Loop",
        pcmData: slot!.pcmData,
        sampleRate: slot!.sampleRate,
        channels: slot!.channels,
        slices: editedSlices,
      },
    ]);
    const bank2 = parseE2sBank(built2.buffer);
    expect(bank2.slots[7]?.slices).toEqual(editedSlices);
  });

  it("Slice-Cap auf 64 wird im Builder enforced + Warning", () => {
    const tooMany = Array.from({ length: 80 }, (_, i) => ({
      start: i * 100,
      length: 100,
      attackLength: 0,
      amplitude: 0,
    }));
    const result = buildE2sBank([
      {
        slotIndex: 0,
        name: "Cap",
        pcmData: new Float32Array(10_000),
        sampleRate: 44100,
        channels: 1,
        slices: tooMany,
      },
    ]);
    // Warning enthält "slices > 64"
    expect(result.warnings.some((w) => /slices > 64|truncating/.test(w))).toBe(true);
    const bank = parseE2sBank(result.buffer);
    // After parse, trailing all-zero slices are trimmed (Reader-Konvention).
    // Wir prüfen nur, dass nicht mehr als ESLI_SLICES_COUNT geschrieben wurden.
    expect((bank.slots[0]?.slices.length ?? 0)).toBeLessThanOrEqual(ESLI_SLICES_COUNT);
    expect((bank.slots[0]?.slices.length ?? 0)).toBe(ESLI_SLICES_COUNT);
  });
});

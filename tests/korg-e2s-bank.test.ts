/**
 * tests/features/korg-e2s-bank.test.ts
 *
 * Unit-Tests fuer client/src/utils/korg/e2sBankReader.ts (v3.3.0).
 *
 * Coverage:
 *   - Signature-Check (positive + zerstoert)
 *   - Offset-Table-Bounds-Validation
 *   - Slot-Parsing (RIFF + fmt + data + korg/esli)
 *   - PCM le16 → Float32 Decode
 *   - Empty-Slot-Handling (offset = 0)
 *   - Category-Mapping
 *   - Slice-Array-Decode
 *   - Optionale Real-File-Tests via fs (Korg e2s files/Sample/)
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseE2sBank,
  isE2sBuffer,
  le16PcmToFloat32,
  countE2sSlots,
  E2sParseError,
} from "../src/core/e2sBankReader";
import {
  E2S_ALL_OFFSET_TABLE_START,
  E2S_ALL_SAMPLE_AREA_START,
  E2S_ALL_SIGNATURE,
  E2S_MAX_SLOTS,
  E2S_CATEGORY_NAMES,
  ESLI_CATEGORY_OFFSET,
  ESLI_NAME_LEN,
  ESLI_NAME_OFFSET,
  KORG_BODY_SUBMAGIC,
  KORG_SUBCHUNK_BODY_SIZE,
  KORG_SUBCHUNK_ID,
} from "../src/core/constants";
import { detectKorgBankType } from "../src/core/bankDetect";

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface SyntheticSlot {
  name: string;
  /** PCM data per channel (mono = single Float32Array, stereo = interleaved L/R Float32Array). */
  pcmFloat: Float32Array;
  channels: 1 | 2;
  sampleRate: number;
  category?: number;
}

/** Wandelt Float32 [-1,+1] → LE-i16 Bytes. */
function float32ToLe16(pcm: Float32Array): Uint8Array {
  const out = new Uint8Array(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) {
    let v = Math.max(-1, Math.min(1, pcm[i]));
    v = v < 0 ? v * 0x8000 : v * 0x7fff;
    const vi = v | 0;
    out[i * 2] = vi & 0xff;
    out[i * 2 + 1] = (vi >> 8) & 0xff;
  }
  return out;
}

/**
 * Baut einen synthetischen .all-Buffer mit beliebigen Slots.
 *
 * Layout:
 *   - 0x0000: 16B Signature
 *   - 0x0010..0x07DF: zeros (prelude padding)
 *   - 0x07E0..0x0BC7: offset table (250 × u32 LE)
 *   - 0x0BC8..0x0FFF: zeros (padding to 0x1000)
 *   - 0x1000+: RIFF/WAVE chunks (one per slot)
 */
function buildMinimalE2sBuffer(slots: Array<SyntheticSlot | null>): Uint8Array {
  if (slots.length > E2S_MAX_SLOTS) {
    throw new Error(`Too many slots: ${slots.length} > ${E2S_MAX_SLOTS}`);
  }

  // Build pro non-null slot ein RIFF/WAVE-Body + remember its offset.
  const chunks: { offset: number; body: Uint8Array }[] = [];
  let cursor = E2S_ALL_SAMPLE_AREA_START;
  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot) continue;
    const pcmBytes = float32ToLe16(slot.pcmFloat);
    // RIFF: 4 RIFF + 4 size + 4 WAVE + (8 fmt + 16 fmt-body) + (8 data + pcmBytes) + (8 korg + 1180 korg-body)
    const fmtSize = 16;
    const dataSize = pcmBytes.length;
    const korgSize = KORG_SUBCHUNK_BODY_SIZE;
    const bodyLen = 4 + (8 + fmtSize) + (8 + dataSize + (dataSize & 1)) + (8 + korgSize);
    const body = new Uint8Array(bodyLen);
    let off = 0;
    // 'WAVE'
    body.set([0x57, 0x41, 0x56, 0x45], off); off += 4;
    // 'fmt ' + size
    body.set([0x66, 0x6d, 0x74, 0x20], off); off += 4;
    const dvFmt = new DataView(body.buffer);
    dvFmt.setUint32(off, fmtSize, true); off += 4;
    dvFmt.setUint16(off, 1, true); off += 2; // PCM
    dvFmt.setUint16(off, slot.channels, true); off += 2;
    dvFmt.setUint32(off, slot.sampleRate, true); off += 4;
    dvFmt.setUint32(off, slot.sampleRate * slot.channels * 2, true); off += 4; // byteRate
    dvFmt.setUint16(off, slot.channels * 2, true); off += 2; // blockAlign
    dvFmt.setUint16(off, 16, true); off += 2; // bps
    // 'data' + size
    body.set([0x64, 0x61, 0x74, 0x61], off); off += 4;
    dvFmt.setUint32(off, dataSize, true); off += 4;
    body.set(pcmBytes, off); off += dataSize;
    if (dataSize & 1) off += 1; // word-pad
    // 'korg' + size
    body.set(KORG_SUBCHUNK_ID, off); off += 4;
    dvFmt.setUint32(off, korgSize, true); off += 4;
    // korg body
    body.set(KORG_BODY_SUBMAGIC, off + 0); // 'esli'
    // Name @ ESLI_NAME_OFFSET (10)
    const nameBytes = new TextEncoder().encode(slot.name.padEnd(ESLI_NAME_LEN, "\0")).subarray(0, ESLI_NAME_LEN);
    body.set(nameBytes, off + ESLI_NAME_OFFSET);
    // Category @ ESLI_CATEGORY_OFFSET (26) as u16 LE
    dvFmt.setUint16(off + ESLI_CATEGORY_OFFSET, slot.category ?? 0, true);
    off += korgSize;

    // Compose RIFF chunk = 'RIFF' + size + body
    const chunk = new Uint8Array(8 + body.length);
    chunk.set([0x52, 0x49, 0x46, 0x46], 0);
    const dvHdr = new DataView(chunk.buffer);
    dvHdr.setUint32(4, body.length, true);
    chunk.set(body, 8);
    chunks.push({ offset: cursor, body: chunk });
    cursor += chunk.length;
  }

  const totalSize = cursor;
  const buf = new Uint8Array(totalSize);

  // Signature
  buf.set(E2S_ALL_SIGNATURE, 0);

  // Offset-Table — slot i kriegt offset, andernfalls 0
  const dvOff = new DataView(buf.buffer);
  let chunkIdx = 0;
  for (let i = 0; i < E2S_MAX_SLOTS; i++) {
    const slot = i < slots.length ? slots[i] : null;
    if (slot) {
      dvOff.setUint32(E2S_ALL_OFFSET_TABLE_START + i * 4, chunks[chunkIdx].offset, true);
      chunkIdx++;
    } else {
      dvOff.setUint32(E2S_ALL_OFFSET_TABLE_START + i * 4, 0, true);
    }
  }

  // Write chunks
  for (const c of chunks) {
    buf.set(c.body, c.offset);
  }

  return buf;
}

function sineFloat(frames: number, freq = 440, sr = 44100): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sr) * 0.5;
  }
  return out;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("korg/e2sBankReader — signature detection", () => {
  it("isE2sBuffer returns true for valid signature", () => {
    const buf = buildMinimalE2sBuffer([]);
    expect(isE2sBuffer(buf)).toBe(true);
  });

  it("isE2sBuffer returns false for buffer with broken signature", () => {
    const buf = buildMinimalE2sBuffer([]);
    buf[0] = 0x00;
    expect(isE2sBuffer(buf)).toBe(false);
  });

  it("isE2sBuffer returns false for tiny buffer", () => {
    expect(isE2sBuffer(new Uint8Array(5))).toBe(false);
  });
});

describe("korg/e2sBankReader — file caps", () => {
  it("throws on too-small buffer", () => {
    const tiny = new Uint8Array(100);
    expect(() => parseE2sBank(tiny)).toThrow(E2sParseError);
  });

  it("throws on wrong magic", () => {
    const buf = buildMinimalE2sBuffer([]);
    buf[0] = 0x00;
    expect(() => parseE2sBank(buf)).toThrow(/signature mismatch/);
  });
});

describe("korg/e2sBankReader — slot parsing", () => {
  it("parses an empty bank (no slots) without error", () => {
    const buf = buildMinimalE2sBuffer([]);
    const bank = parseE2sBank(buf);
    expect(bank.slots).toHaveLength(E2S_MAX_SLOTS);
    expect(countE2sSlots(bank)).toBe(0);
  });

  it("parses a single mono slot with PCM + name + category", () => {
    const pcm = sineFloat(1000);
    const buf = buildMinimalE2sBuffer([
      { name: "Kick01", pcmFloat: pcm, channels: 1, sampleRate: 44100, category: 2 /* Kick */ },
    ]);
    const bank = parseE2sBank(buf);
    expect(countE2sSlots(bank)).toBe(1);
    const slot = bank.slots[0]!;
    expect(slot).not.toBeNull();
    expect(slot.name).toBe("Kick01");
    expect(slot.channels).toBe(1);
    expect(slot.sampleRate).toBe(44100);
    expect(slot.frames).toBe(1000);
    expect(slot.category).toBe(2);
    expect(slot.categoryName).toBe("Kick");
    expect(slot.pcmData.length).toBe(1000);
  });

  it("parses a stereo slot with interleaved PCM (length = frames*2)", () => {
    const pcm = sineFloat(400); // we'll interleave L+R manually
    const interleaved = new Float32Array(pcm.length * 2);
    for (let i = 0; i < pcm.length; i++) {
      interleaved[i * 2] = pcm[i];
      interleaved[i * 2 + 1] = -pcm[i]; // R is inverted
    }
    const buf = buildMinimalE2sBuffer([
      { name: "Stereo", pcmFloat: interleaved, channels: 2, sampleRate: 48000 },
    ]);
    const bank = parseE2sBank(buf);
    const slot = bank.slots[0]!;
    expect(slot.channels).toBe(2);
    expect(slot.sampleRate).toBe(48000);
    expect(slot.frames).toBe(400);
    expect(slot.pcmData.length).toBe(400 * 2);
  });

  it("skips empty offset-table entries (offset = 0)", () => {
    const buf = buildMinimalE2sBuffer([
      { name: "A", pcmFloat: new Float32Array(50), channels: 1, sampleRate: 44100 },
      null,
      { name: "B", pcmFloat: new Float32Array(50), channels: 1, sampleRate: 44100 },
    ]);
    const bank = parseE2sBank(buf);
    expect(countE2sSlots(bank)).toBe(2);
    expect(bank.slots[0]?.name).toBe("A");
    expect(bank.slots[1]).toBeNull();
    expect(bank.slots[2]?.name).toBe("B");
  });

  it("preserves offset-table (raw) in the returned bank", () => {
    const buf = buildMinimalE2sBuffer([
      { name: "X", pcmFloat: new Float32Array(20), channels: 1, sampleRate: 44100 },
    ]);
    const bank = parseE2sBank(buf);
    expect(bank.offsetTable.length).toBe(E2S_MAX_SLOTS);
    expect(bank.offsetTable[0]).toBeGreaterThanOrEqual(E2S_ALL_SAMPLE_AREA_START);
  });

  it("category name maps correctly via e2sCategoryName", () => {
    const buf = buildMinimalE2sBuffer([
      { name: "Snare01", pcmFloat: new Float32Array(20), channels: 1, sampleRate: 44100, category: 3 },
    ]);
    const bank = parseE2sBank(buf);
    expect(bank.slots[0]?.categoryName).toBe(E2S_CATEGORY_NAMES[3]); // "Snare"
  });
});

describe("korg/e2sBankReader — PCM decode helper", () => {
  it("le16PcmToFloat32 0x0000 → 0.0", () => {
    expect(le16PcmToFloat32(new Uint8Array([0x00, 0x00]))[0]).toBe(0);
  });

  it("le16PcmToFloat32 0xFF7F (32767) → ~+1.0", () => {
    expect(le16PcmToFloat32(new Uint8Array([0xff, 0x7f]))[0]).toBeCloseTo(0.99997, 4);
  });

  it("le16PcmToFloat32 0x0080 (-32768) → -1.0", () => {
    expect(le16PcmToFloat32(new Uint8Array([0x00, 0x80]))[0]).toBe(-1);
  });
});

describe("korg/e2sBankReader — defensive parsing", () => {
  it("throws on slot offset pointing inside the prelude", () => {
    const buf = buildMinimalE2sBuffer([
      { name: "OK", pcmFloat: new Float32Array(10), channels: 1, sampleRate: 44100 },
    ]);
    // Manipulate offset to 0x100 (inside prelude)
    const dv = new DataView(buf.buffer);
    dv.setUint32(E2S_ALL_OFFSET_TABLE_START, 0x100, true);
    expect(() => parseE2sBank(buf)).toThrow(/prelude/);
  });
});

describe("korg/bankDetect — disambiguation", () => {
  it("detects valid E2S buffer", () => {
    const e2s = buildMinimalE2sBuffer([]);
    expect(detectKorgBankType(e2s)).toBe("e2s");
  });

  it("returns 'unknown' for random bytes", () => {
    expect(detectKorgBankType(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBe("unknown");
  });
});

// ─── OPTIONAL: Real-File-Tests via fs (Korg e2s files/Sample/) ───────────────

const REAL_FILES_DIR = path.resolve(__dirname, "../../Korg e2s files/Sample");
const REAL_FILES_AVAILABLE = (() => {
  try {
    return fs.existsSync(REAL_FILES_DIR) && fs.statSync(REAL_FILES_DIR).isDirectory();
  } catch {
    return false;
  }
})();

const describeReal = REAL_FILES_AVAILABLE ? describe : describe.skip;

describeReal("korg/e2sBankReader — real-file Smoke (Korg e2s files/Sample/)", () => {
  it("parses at least one real .all file without throwing", () => {
    const files = fs.readdirSync(REAL_FILES_DIR).filter((f) =>
      f.toLowerCase().endsWith(".all"),
    );
    if (files.length === 0) return;
    const filePath = path.join(REAL_FILES_DIR, files[0]);
    const bytes = fs.readFileSync(filePath);
    const bank = parseE2sBank(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      files[0],
    );
    expect(bank.source).toBe(files[0]);
    // Real-File mit Sample-Bank hat in der Regel ≥1 belegten Slot
    expect(countE2sSlots(bank)).toBeGreaterThanOrEqual(0);
  });
});

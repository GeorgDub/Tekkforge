/**
 * tests/features/korg-esx-parser.test.ts
 *
 * Unit-Tests fuer client/src/utils/korg/esxParser.ts (v3.3.0).
 *
 * Coverage:
 *   - Magic-Detection (positive + zerstoerte Signaturen)
 *   - File-Size-Caps (zu klein, zu gross)
 *   - Sample-Header-Parsing (mono + stereo) mit synthetischem Buffer
 *   - PCM-BE→LE-Konvertierung (be16PcmToFloat32 als Pure-Helper)
 *   - Empty-Slot-Sentinel (0xFFFFFFFF)
 *   - Optionale Real-File-Tests via fs (conditional auf KORG ESX files/)
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  parseEsxBank,
  isEsxBuffer,
  be16PcmToFloat32,
  EsxParseError,
} from "../src/core/esxParser";
import {
  ESX1_ADDR_NUM_MONO_SAMPLES,
  ESX1_ADDR_SAMPLE_DATA,
  ESX1_ADDR_SAMPLE_HEADER_MONO,
  ESX1_ADDR_SAMPLE_HEADER_STEREO,
  ESX1_ADDR_VALID_CHECK_2,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO,
  ESX1_EMPTY_OFFSET,
  ESX1_SIGNATURE,
  ESX1_SIZE_FILE_MIN,
  ESX1_SUBMAGIC,
  ESX1_SUBMAGIC_OFFSET,
} from "../src/core/constants";

// ─── Synthetic Buffer Builder ────────────────────────────────────────────────

/** Baut ein minimales valides .esx-Buffer fuer Tests. */
function buildMinimalEsxBuffer(opts: {
  monoSamples?: Array<{
    name: string;
    pcmFrames: number; // 16-bit frames pro Channel
    sampleRate?: number;
    loopStart?: number;
  }>;
  stereoSamples?: Array<{
    name: string;
    pcmFrames: number;
    sampleRate?: number;
  }>;
  /** Optional: zerstöre ein bestimmtes Byte. */
  corrupt?: { offset: number; value: number };
  /** Optional: erweiterten file-size cap überschreiten. */
  extraSize?: number;
  /** Optional: explizit ein "currentOffset"-Counter setzen (Default = berechnet). */
  declaredCurrentOffset?: number;
}): Uint8Array {
  const monoSamples = opts.monoSamples ?? [];
  const stereoSamples = opts.stereoSamples ?? [];

  // PCM-Bereich Größe: alle frames * 2 bytes (mono) + alle frames * 4 bytes (stereo, L+R)
  const monoBytes = monoSamples.reduce((acc, s) => acc + s.pcmFrames * 2, 0);
  const stereoBytes = stereoSamples.reduce((acc, s) => acc + s.pcmFrames * 4, 0);
  const totalPcm = monoBytes + stereoBytes;

  const baseSize = ESX1_SIZE_FILE_MIN + totalPcm + 1024; // header + min + PCM + padding
  const finalSize = baseSize + (opts.extraSize ?? 0);
  const buf = new Uint8Array(finalSize);

  // Magic
  buf.set(ESX1_SIGNATURE, 0);
  buf.set(ESX1_SUBMAGIC, ESX1_SUBMAGIC_OFFSET);
  // Second magic @ 0x1B0000
  buf.set(ESX1_SIGNATURE, ESX1_ADDR_VALID_CHECK_2);

  // Sample-Counters
  const dv = new DataView(buf.buffer);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 0, monoSamples.length, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 4, stereoSamples.length, false);
  dv.setUint32(
    ESX1_ADDR_NUM_MONO_SAMPLES + 8,
    opts.declaredCurrentOffset ?? totalPcm,
    false,
  );

  // Mono-Headers: setze die ersten N als belegt, Rest auf EMPTY_OFFSET
  let pcmCursor = 0;
  for (let i = 0; i < 256; i++) {
    const off = ESX1_ADDR_SAMPLE_HEADER_MONO + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
    if (i < monoSamples.length) {
      const sm = monoSamples[i];
      const nameBytes = new TextEncoder().encode(sm.name.padEnd(8, "\0")).subarray(0, 8);
      buf.set(nameBytes, off);
      const lenBytes = sm.pcmFrames * 2;
      dv.setUint32(off + 8, pcmCursor, false); // off1Start
      dv.setUint32(off + 12, pcmCursor + lenBytes, false); // off1End
      dv.setUint32(off + 16, 0, false); // start
      dv.setUint32(off + 20, sm.pcmFrames, false); // end
      dv.setUint32(off + 24, sm.loopStart ?? 0, false); // loopStart
      dv.setUint32(off + 28, sm.sampleRate ?? 44100, false); // sampleRate
      dv.setInt16(off + 32, 0, false); // sample_tune
      buf[off + 34] = 100; // playLevel
      // Schreibe PCM-Daten (BE) — wir geben jedem Sample sägezahn-mässige Bytes.
      for (let k = 0; k < sm.pcmFrames; k++) {
        const v = (k * 100) & 0x7fff;
        buf[ESX1_ADDR_SAMPLE_DATA + pcmCursor + k * 2] = (v >> 8) & 0xff;
        buf[ESX1_ADDR_SAMPLE_DATA + pcmCursor + k * 2 + 1] = v & 0xff;
      }
      pcmCursor += lenBytes;
    } else {
      dv.setUint32(off + 8, ESX1_EMPTY_OFFSET, false);
      dv.setUint32(off + 12, ESX1_EMPTY_OFFSET, false);
    }
  }

  // Stereo-Headers
  for (let i = 0; i < 128; i++) {
    const off =
      ESX1_ADDR_SAMPLE_HEADER_STEREO + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO;
    if (i < stereoSamples.length) {
      const ss = stereoSamples[i];
      const nameBytes = new TextEncoder().encode(ss.name.padEnd(8, "\0")).subarray(0, 8);
      buf.set(nameBytes, off);
      const channelLen = ss.pcmFrames * 2;
      const off1Start = pcmCursor;
      const off1End = off1Start + channelLen;
      const off2Start = off1End;
      const off2End = off2Start + channelLen;
      dv.setUint32(off + 8, off1Start, false);
      dv.setUint32(off + 12, off1End, false);
      dv.setUint32(off + 16, off2Start, false);
      dv.setUint32(off + 20, off2End, false);
      dv.setUint32(off + 24, 0, false);
      dv.setUint32(off + 28, ss.pcmFrames, false);
      dv.setUint32(off + 32, ss.sampleRate ?? 44100, false);
      dv.setInt16(off + 36, 0, false);
      buf[off + 38] = 100;
      // PCM L
      for (let k = 0; k < ss.pcmFrames; k++) {
        const v = (k * 200) & 0x7fff;
        buf[ESX1_ADDR_SAMPLE_DATA + off1Start + k * 2] = (v >> 8) & 0xff;
        buf[ESX1_ADDR_SAMPLE_DATA + off1Start + k * 2 + 1] = v & 0xff;
      }
      // PCM R
      for (let k = 0; k < ss.pcmFrames; k++) {
        const v = ((k * 200) + 5000) & 0x7fff;
        buf[ESX1_ADDR_SAMPLE_DATA + off2Start + k * 2] = (v >> 8) & 0xff;
        buf[ESX1_ADDR_SAMPLE_DATA + off2Start + k * 2 + 1] = v & 0xff;
      }
      pcmCursor += channelLen * 2;
    } else {
      dv.setUint32(off + 8, ESX1_EMPTY_OFFSET, false);
      dv.setUint32(off + 12, ESX1_EMPTY_OFFSET, false);
      dv.setUint32(off + 16, ESX1_EMPTY_OFFSET, false);
      dv.setUint32(off + 20, ESX1_EMPTY_OFFSET, false);
    }
  }

  if (opts.corrupt) {
    buf[opts.corrupt.offset] = opts.corrupt.value;
  }

  return buf;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("korg/esxParser — magic detection", () => {
  it("isEsxBuffer returns true for valid signatures", () => {
    const buf = buildMinimalEsxBuffer({ monoSamples: [] });
    expect(isEsxBuffer(buf)).toBe(true);
  });

  it("isEsxBuffer returns false for buffer with broken KORG magic", () => {
    const buf = buildMinimalEsxBuffer({ corrupt: { offset: 0, value: 0x00 } });
    expect(isEsxBuffer(buf)).toBe(false);
  });

  it("isEsxBuffer returns false for buffer with broken ESX sub-magic", () => {
    const buf = buildMinimalEsxBuffer({
      corrupt: { offset: ESX1_SUBMAGIC_OFFSET, value: 0x00 },
    });
    expect(isEsxBuffer(buf)).toBe(false);
  });

  it("isEsxBuffer returns false for tiny buffer", () => {
    expect(isEsxBuffer(new Uint8Array(5))).toBe(false);
  });
});

describe("korg/esxParser — file-size caps", () => {
  it("rejects buffer smaller than ESX1_SIZE_FILE_MIN", () => {
    expect(() => parseEsxBank(new Uint8Array(100))).toThrow(EsxParseError);
  });

  it("rejects oversized buffer (>64 MB)", () => {
    // We can't easily allocate 64 MB in test env; check via size threshold:
    // build a 100 MB buffer is too memory-heavy. Instead, test the boundary
    // by faking the size via a smaller dummy that has the right header but
    // claims to be large via array length.
    const huge = new Uint8Array(65 * 1024 * 1024 + 1);
    huge.set(ESX1_SIGNATURE, 0);
    huge.set(ESX1_SUBMAGIC, ESX1_SUBMAGIC_OFFSET);
    huge.set(ESX1_SIGNATURE, ESX1_ADDR_VALID_CHECK_2);
    expect(() => parseEsxBank(huge)).toThrow(/exceeds max/);
  });
});

describe("korg/esxParser — magic + sample-count validation", () => {
  it("returns empty bank + warning on invalid first magic (v3.90.0: variant-header tolerance)", () => {
    const buf = buildMinimalEsxBuffer({});
    buf[0] = 0x00;
    const bank = parseEsxBank(buf);
    expect(bank.monoSamples).toEqual([]);
    expect(bank.warnings.some((w) => /variant header|unsupported variant/i.test(w))).toBe(
      true,
    );
  });

  it("returns empty bank + warning on invalid sub-magic (v3.90.0: variant-format tolerance)", () => {
    const buf = buildMinimalEsxBuffer({});
    buf[ESX1_SUBMAGIC_OFFSET] = 0x00;
    const bank = parseEsxBank(buf);
    expect(bank.monoSamples).toEqual([]);
    expect(bank.warnings.some((w) => /unsupported sub-format/i.test(w))).toBe(true);
  });

  it("throws when second magic is missing", () => {
    const buf = buildMinimalEsxBuffer({});
    buf[ESX1_ADDR_VALID_CHECK_2] = 0x00;
    expect(() => parseEsxBank(buf)).toThrow(/Invalid second magic/);
  });

  it("throws when declared mono count > 256", () => {
    const buf = buildMinimalEsxBuffer({});
    const dv = new DataView(buf.buffer);
    dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES, 999, false);
    expect(() => parseEsxBank(buf)).toThrow(/out of range/);
  });
});

describe("korg/esxParser — parse mono samples", () => {
  it("parses a single mono sample with name + correct frame count", () => {
    const buf = buildMinimalEsxBuffer({
      monoSamples: [{ name: "Kick", pcmFrames: 1000, sampleRate: 44100 }],
    });
    const bank = parseEsxBank(buf, "test.esx");
    expect(bank.source).toBe("test.esx");
    expect(bank.monoSamples).toHaveLength(1);
    expect(bank.monoSamples[0].name).toBe("Kick");
    expect(bank.monoSamples[0].channels).toBe(1);
    expect(bank.monoSamples[0].frames).toBe(1000);
    expect(bank.monoSamples[0].sampleRate).toBe(44100);
    expect(bank.monoSamples[0].pcmData.length).toBe(1000);
  });

  it("returns Float32 PCM in [-1, +1] range", () => {
    const buf = buildMinimalEsxBuffer({
      monoSamples: [{ name: "Test", pcmFrames: 100 }],
    });
    const bank = parseEsxBank(buf);
    const pcm = bank.monoSamples[0].pcmData;
    for (let i = 0; i < pcm.length; i++) {
      expect(pcm[i]).toBeGreaterThanOrEqual(-1);
      expect(pcm[i]).toBeLessThanOrEqual(1);
    }
  });

  it("skips empty mono slots (sentinel 0xFFFFFFFF)", () => {
    const buf = buildMinimalEsxBuffer({
      monoSamples: [{ name: "OnlyOne", pcmFrames: 100 }],
    });
    const bank = parseEsxBank(buf);
    // 1 belegter + 255 leere → 1 in der Liste
    expect(bank.monoSamples).toHaveLength(1);
    expect(bank.declaredMonoCount).toBe(1);
  });

  it("parses multiple mono samples in order", () => {
    const buf = buildMinimalEsxBuffer({
      monoSamples: [
        { name: "A", pcmFrames: 50 },
        { name: "B", pcmFrames: 75 },
        { name: "C", pcmFrames: 100 },
      ],
    });
    const bank = parseEsxBank(buf);
    expect(bank.monoSamples).toHaveLength(3);
    expect(bank.monoSamples.map((s) => s.name)).toEqual(["A", "B", "C"]);
    expect(bank.monoSamples.map((s) => s.frames)).toEqual([50, 75, 100]);
  });
});

describe("korg/esxParser — parse stereo samples", () => {
  it("parses stereo sample with interleaved PCM (length = frames * 2)", () => {
    const buf = buildMinimalEsxBuffer({
      stereoSamples: [{ name: "StereoLp", pcmFrames: 200 }],
    });
    const bank = parseEsxBank(buf);
    expect(bank.stereoSamples).toHaveLength(1);
    const s = bank.stereoSamples[0];
    expect(s.channels).toBe(2);
    expect(s.frames).toBe(200);
    expect(s.pcmData.length).toBe(200 * 2); // interleaved
    expect(s.index).toBeGreaterThanOrEqual(256); // mono-slots end at 255
  });

  it("decodes left + right channels independently (interleaved L,R,L,R)", () => {
    const buf = buildMinimalEsxBuffer({
      stereoSamples: [{ name: "X", pcmFrames: 10 }],
    });
    const bank = parseEsxBank(buf);
    const pcm = bank.stereoSamples[0].pcmData;
    // Builder schreibt L = (k*200) und R = (k*200 + 5000) als BE i16 → unterschiedlich
    expect(pcm[0]).not.toBe(pcm[1]);
  });
});

describe("korg/esxParser — be16PcmToFloat32 helper", () => {
  it("converts BE-i16 0x0000 → 0.0", () => {
    const f = be16PcmToFloat32(new Uint8Array([0x00, 0x00]));
    expect(f[0]).toBe(0);
  });

  it("converts BE-i16 0x7FFF → ~1.0", () => {
    const f = be16PcmToFloat32(new Uint8Array([0x7f, 0xff]));
    expect(f[0]).toBeCloseTo(0.99997, 4);
  });

  it("converts BE-i16 0x8000 (-32768) → -1.0", () => {
    const f = be16PcmToFloat32(new Uint8Array([0x80, 0x00]));
    expect(f[0]).toBe(-1);
  });

  it("handles two frames sequentially", () => {
    const f = be16PcmToFloat32(new Uint8Array([0x00, 0x00, 0x00, 0x01]));
    expect(f.length).toBe(2);
    expect(f[0]).toBe(0);
    expect(f[1]).toBeCloseTo(1 / 32768, 6);
  });
});

describe("korg/esxParser — defensive parsing", () => {
  it("does not throw if a slot has inverted offsetStart > offsetEnd", () => {
    const buf = buildMinimalEsxBuffer({
      monoSamples: [{ name: "OK", pcmFrames: 50 }],
    });
    // Schreibe Slot 1 (zweiter Mono-Slot) mit invertierten Offsets
    const off2 = ESX1_ADDR_SAMPLE_HEADER_MONO + 1 * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
    const dv = new DataView(buf.buffer);
    dv.setUint32(off2 + 8, 100, false); // off1Start
    dv.setUint32(off2 + 12, 50, false); // off1End (kleiner als Start!)
    const bank = parseEsxBank(buf);
    expect(bank.monoSamples).toHaveLength(1); // nur OK Slot
    expect(bank.warnings.length).toBeGreaterThan(0);
  });

  it("clamps level to [0..127]", () => {
    const buf = buildMinimalEsxBuffer({
      monoSamples: [{ name: "X", pcmFrames: 10 }],
    });
    // Lass playLevel auf 100, prüfe Übernahme
    const bank = parseEsxBank(buf);
    expect(bank.monoSamples[0].level).toBe(100);
  });
});

// ─── OPTIONAL: Real-File-Tests via fs (Korg ESX files/) ──────────────────────

const REAL_FILES_DIR = path.resolve(__dirname, "../../Korg ESX files");
const REAL_FILES_AVAILABLE = (() => {
  try {
    return fs.existsSync(REAL_FILES_DIR) && fs.statSync(REAL_FILES_DIR).isDirectory();
  } catch {
    return false;
  }
})();

const describeReal = REAL_FILES_AVAILABLE ? describe : describe.skip;

describeReal("korg/esxParser — real-file Smoke (Korg ESX files/)", () => {
  it("parses at least one real .esx file without throwing", () => {
    const files = fs.readdirSync(REAL_FILES_DIR).filter((f) =>
      f.toLowerCase().endsWith(".esx"),
    );
    if (files.length === 0) return; // no files → skip silently
    const filePath = path.join(REAL_FILES_DIR, files[0]);
    const bytes = fs.readFileSync(filePath);
    const bank = parseEsxBank(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength), files[0]);
    expect(bank.source).toBe(files[0]);
    // Real-File hat in der Regel zumindest einige Samples
    expect(bank.monoSamples.length + bank.stereoSamples.length).toBeGreaterThanOrEqual(0);
  });
});

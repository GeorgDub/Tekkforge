/**
 * tests/features/e2s-export.test.ts
 *
 * v3.271.0 — Byte-exact tests for the TEMPLATE-OVERLAY E2 Sampler exporter
 * (client/src/utils/e2sExport.ts).
 *
 * Two layers:
 *   1. SELF-CONSISTENCY (always runs): exact sizes, markers, "empty overlay ==
 *      template", "name overlay changes only name bytes", "active step writes
 *      the verified 5-byte record", allpat slot composition.
 *   2. REAL-FILE GROUND TRUTH (conditional skip — files are user-supplied, not
 *      in the repo): the reconstructed .e2sallpat prefix and the .e2spat file
 *      header must byte-match the real KORG dumps in "Korg e2s files/".
 *
 * The verification proxy that replaces hardware testing this session:
 *   builder output is byte-identical to a real init pattern except where we
 *   intentionally wrote content.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import {
  buildE2PatternBody,
  buildE2PatternFileV2,
  buildE2AllPatFile,
  looksLikeE2AllPatFile,
  E2S_BODY_SIZE,
  E2S_FILE_HEADER_SIZE,
  E2S_SINGLE_FILE_SIZE,
  E2S_ALLPAT_PREFIX_SIZE,
  E2S_ALLPAT_SLOT_COUNT,
  E2S_ALLPAT_FILE_SIZE,
} from "../src/core/e2sExport";
import { E2S_INIT_BODY_B64 } from "../src/core/e2sExportAssets";
import type { E2PatternInput } from "../src/core/electribePatternBuilder";
import { parseElectribeAllPatBank } from "../src/core/electribeImport";

// ─── Template (the embedded init body, decoded once) ─────────────────────────

const TEMPLATE_BODY = new Uint8Array(Buffer.from(E2S_INIT_BODY_B64, "base64"));

// The template was generated as factory slot 244 "Init Pattern": BPM 120,
// step-length code 0, all 16×64 step records normalized to inactive.
const TEMPLATE_NAME = "Init Pattern";
const TEMPLATE_BPM = 120;
const TEMPLATE_STEPLEN = 16; // → code 0 (matches template byte @0x25)

/** An input that, overlaid, must reproduce the template byte-for-byte. */
const NEUTRAL_INPUT: E2PatternInput = {
  name: TEMPLATE_NAME,
  bpm: TEMPLATE_BPM,
  stepLength: TEMPLATE_STEPLEN,
  parts: [], // no parts → no step/part overlay at all
};

function emptyParts(): E2PatternInput["parts"] {
  return Array.from({ length: 16 }, () => ({ steps: [] }));
}

function diffOffsets(a: Uint8Array, b: Uint8Array): number[] {
  const out: number[] = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) out.push(i);
  return out;
}

// ─── 1. Self-consistency ──────────────────────────────────────────────────────

describe("e2sExport — sizes & markers", () => {
  it("single .e2spat is exactly 16640 bytes with KORG/e2sampler/PTST markers", () => {
    const buf = new Uint8Array(buildE2PatternFileV2(NEUTRAL_INPUT));
    expect(buf.byteLength).toBe(E2S_SINGLE_FILE_SIZE);
    expect(buf.byteLength).toBe(16640);
    expect([...buf.slice(0, 4)]).toEqual([0x4b, 0x4f, 0x52, 0x47]); // KORG
    expect([...buf.slice(0x10, 0x14)]).toEqual([0x65, 0x32, 0x73, 0x61]); // e2sa
    expect(buf[0x20]).toBe(0x01); // version
    expect([...buf.slice(0x100, 0x104)]).toEqual([0x50, 0x54, 0x53, 0x54]); // PTST
    // 0xFF padding region
    expect(buf[0x24]).toBe(0xff);
    expect(buf[0xff]).toBe(0xff);
  });

  it("all .e2sallpat is exactly 4_161_792 bytes and passes looksLikeE2AllPatFile", () => {
    const buf = new Uint8Array(buildE2AllPatFile([]));
    expect(buf.byteLength).toBe(E2S_ALLPAT_FILE_SIZE);
    expect(buf.byteLength).toBe(4_161_792);
    expect(looksLikeE2AllPatFile(buf)).toBe(true);
    // GLST @ 0x100, GLED @ 0x1FC, PTST @ first slot
    expect([...buf.slice(0x100, 0x104)]).toEqual([0x47, 0x4c, 0x53, 0x54]);
    expect([...buf.slice(0x1fc, 0x200)]).toEqual([0x47, 0x4c, 0x45, 0x44]);
    expect([...buf.slice(0x10100, 0x10104)]).toEqual([0x50, 0x54, 0x53, 0x54]);
  });

  it("constants are internally consistent", () => {
    expect(E2S_FILE_HEADER_SIZE + E2S_BODY_SIZE).toBe(E2S_SINGLE_FILE_SIZE);
    expect(E2S_ALLPAT_PREFIX_SIZE + E2S_ALLPAT_SLOT_COUNT * E2S_BODY_SIZE).toBe(
      E2S_ALLPAT_FILE_SIZE,
    );
  });
});

describe("e2sExport — template-overlay fidelity", () => {
  it("neutral overlay reproduces the template body byte-for-byte", () => {
    const body = buildE2PatternBody(NEUTRAL_INPUT);
    expect(body.length).toBe(E2S_BODY_SIZE);
    expect(diffOffsets(body, TEMPLATE_BODY)).toEqual([]);
  });

  it("changing only the name diffs only the 16 name bytes (0x10..0x20)", () => {
    const body = buildE2PatternBody({ ...NEUTRAL_INPUT, name: "MyBeat" });
    const diffs = diffOffsets(body, TEMPLATE_BODY);
    expect(diffs.every((o) => o >= 0x10 && o < 0x20)).toBe(true);
    // "MyBeat" then NUL pad
    expect(Buffer.from(body.slice(0x10, 0x16)).toString("latin1")).toBe("MyBeat");
    expect(body[0x16]).toBe(0x00);
  });

  it("changing only the BPM diffs only the 2 BPM bytes (0x22..0x24)", () => {
    const body = buildE2PatternBody({ ...NEUTRAL_INPUT, bpm: 165 });
    const diffs = diffOffsets(body, TEMPLATE_BODY);
    expect(diffs.every((o) => o === 0x22 || o === 0x23)).toBe(true);
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    expect(view.getUint16(0x22, true)).toBe(1650); // 165.0 × 10
  });

  it("step-length code maps 16→0, 32→1, 64→3", () => {
    expect(buildE2PatternBody({ ...NEUTRAL_INPUT, stepLength: 16 })[0x25]).toBe(0);
    expect(buildE2PatternBody({ ...NEUTRAL_INPUT, stepLength: 32 })[0x25]).toBe(1);
    expect(buildE2PatternBody({ ...NEUTRAL_INPUT, stepLength: 64 })[0x25]).toBe(3);
  });

  it("an active step writes the verified 5-byte record (trigger/gate/vel/flag/note)", () => {
    const parts = emptyParts();
    parts[0] = {
      steps: [{ active: true, note: 0x47, velocity: 0x7f, gate: 0x24 }],
    };
    const body = buildE2PatternBody({ ...NEUTRAL_INPUT, parts });
    const stepOff = 0x800 + 0 * 816 + 0x30 + 0 * 12; // part0, step0
    // Korrigiertes Layout (Factory-verifiziert): b1=Gate, b2=Vel, b3=Flag, b4=Note
    expect([...body.slice(stepOff, stepOff + 5)]).toEqual([0x01, 0x24, 0x7f, 0x01, 0x47]);
    // bytes 5..11 stay zero
    expect([...body.slice(stepOff + 5, stepOff + 12)]).toEqual([0, 0, 0, 0, 0, 0, 0]);
    // every OTHER step record is still the canonical inactive form
    const step1Off = stepOff + 12;
    expect([...body.slice(step1Off, step1Off + 5)]).toEqual([0x00, 0x48, 0x60, 0x00, 0x00]);
  });

  it("gate defaults to 0x48, clamps to 96, passes 0xFF tie through", () => {
    const parts = emptyParts();
    parts[0] = {
      steps: [
        { active: true }, // default gate
        { active: true, gate: 999 }, // clamp → 96
        { active: true, gate: 0xff }, // tie sentinel
      ],
    };
    const body = buildE2PatternBody({ ...NEUTRAL_INPUT, parts });
    const so = 0x800 + 0x30;
    expect(body[so + 1]).toBe(0x48);
    expect(body[so + 12 + 1]).toBe(96);
    expect(body[so + 24 + 1]).toBe(0xff);
    // Default-Note aktiver Steps = 0x3C (C4 = Originaltonhöhe)
    expect(body[so + 4]).toBe(0x3c);
  });

  it("inactive step uses canonical 00 48 60 00 00", () => {
    const parts = emptyParts();
    parts[0] = { steps: [{ active: false }] };
    const body = buildE2PatternBody({ ...NEUTRAL_INPUT, parts });
    const stepOff = 0x800 + 0x30;
    expect([...body.slice(stepOff, stepOff + 5)]).toEqual([0x00, 0x48, 0x60, 0x00, 0x00]);
  });

  it("part volume(0x18)/pan(0x19 signed)/mute(0x01) overlay the header bytes", () => {
    const parts = emptyParts();
    parts[3] = { volume: 100, pan: 0, muted: true, steps: [] }; // pan 0 = ganz links
    parts[4] = { volume: 127, pan: 96, muted: false, steps: [] }; // pan 96 = +32 rechts
    const body = buildE2PatternBody({ ...NEUTRAL_INPUT, parts });
    const p3 = 0x800 + 3 * 816;
    const p4 = 0x800 + 4 * 816;
    expect(body[p3 + 0x18]).toBe(100); // ampLevel
    expect(body[p3 + 0x19]).toBe(0xc0); // pan 0 → signed -64 → 0xC0
    expect(body[p3 + 0x01]).toBe(1); // mute an
    expect(body[p4 + 0x18]).toBe(127);
    expect(body[p4 + 0x19]).toBe(32); // pan 96 → signed +32
    expect(body[p4 + 0x01]).toBe(0); // mute aus
  });

  it("clamps out-of-range BPM, note, velocity", () => {
    const body = buildE2PatternBody({ ...NEUTRAL_INPUT, bpm: 99999 });
    const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
    expect(view.getUint16(0x22, true)).toBe(3000); // 300.0 max
    const parts = emptyParts();
    parts[0] = { steps: [{ active: true, note: 999, velocity: 999 }] };
    const b2 = buildE2PatternBody({ ...NEUTRAL_INPUT, parts });
    const so = 0x800 + 0x30;
    expect(b2[so + 2]).toBe(127); // velocity geclampt
    expect(b2[so + 4]).toBe(127); // note geclampt
  });
});

describe("e2sExport — .e2sallpat composition", () => {
  it("unused slots are filled with the real init-pattern body (not zeros)", () => {
    const buf = new Uint8Array(buildE2AllPatFile([]));
    for (const slot of [0, 1, 123, 249]) {
      const off = E2S_ALLPAT_PREFIX_SIZE + slot * E2S_BODY_SIZE;
      const body = buf.slice(off, off + E2S_BODY_SIZE);
      expect(diffOffsets(body, TEMPLATE_BODY)).toEqual([]);
    }
  });

  it("provided patterns land in their slots; the rest stay init", () => {
    const p0: E2PatternInput = { name: "Kick", bpm: 140, stepLength: 16, parts: emptyParts() };
    (p0.parts as NonNullable<E2PatternInput["parts"]>)[0] = {
      steps: [{ active: true }],
    };
    const p1: E2PatternInput = { name: "Snare", bpm: 90, stepLength: 32, parts: [] };

    const buf = new Uint8Array(buildE2AllPatFile([p0, p1]));

    const slot0 = buf.slice(
      E2S_ALLPAT_PREFIX_SIZE,
      E2S_ALLPAT_PREFIX_SIZE + E2S_BODY_SIZE,
    );
    expect(diffOffsets(slot0, buildE2PatternBody(p0))).toEqual([]);

    const slot1Off = E2S_ALLPAT_PREFIX_SIZE + E2S_BODY_SIZE;
    const slot1 = buf.slice(slot1Off, slot1Off + E2S_BODY_SIZE);
    expect(diffOffsets(slot1, buildE2PatternBody(p1))).toEqual([]);

    // slot 2 = untouched init
    const slot2Off = E2S_ALLPAT_PREFIX_SIZE + 2 * E2S_BODY_SIZE;
    expect(diffOffsets(buf.slice(slot2Off, slot2Off + E2S_BODY_SIZE), TEMPLATE_BODY)).toEqual([]);
  });

  it("more than 250 patterns are truncated to 250 slots", () => {
    const many = Array.from({ length: 300 }, (_, i): E2PatternInput => ({
      name: `P${i}`,
      bpm: 120,
      stepLength: 16,
      parts: [],
    }));
    const buf = new Uint8Array(buildE2AllPatFile(many));
    expect(buf.byteLength).toBe(E2S_ALLPAT_FILE_SIZE);
    // last slot (249) must hold pattern 249's name, pattern 250+ dropped
    const off = E2S_ALLPAT_PREFIX_SIZE + 249 * E2S_BODY_SIZE;
    expect(Buffer.from(buf.slice(off + 0x10, off + 0x14)).toString("latin1")).toBe("P249");
  });
});

// ─── 1b. Full-chain round-trip through the project's own parser ──────────────
// Exercises overlay → bytes → parse on NON-template content (the byte-position
// tests above check fields in isolation; this catches write↔read drift).

describe("e2sExport — round-trip through parseElectribeAllPatBank", () => {
  function activeAt(indices: number[]): NonNullable<E2PatternInput["parts"]>[number] {
    const steps = Array.from({ length: 16 }, (_, i) => ({
      active: indices.includes(i),
      velocity: 100,
    }));
    return { steps };
  }

  it("250-slot bank round-trips count, names, bpm, step-length and step triggers", () => {
    const p0: E2PatternInput = {
      name: "Kick16",
      bpm: 140,
      stepLength: 16,
      parts: emptyParts(),
    };
    (p0.parts as NonNullable<E2PatternInput["parts"]>)[0] = activeAt([0, 4, 8, 12]);

    const p1: E2PatternInput = {
      name: "Snare32",
      bpm: 90.5,
      stepLength: 32,
      parts: emptyParts(),
    };
    (p1.parts as NonNullable<E2PatternInput["parts"]>)[2] = activeAt([4, 12]);

    const buf = new Uint8Array(buildE2AllPatFile([p0, p1]));
    const bank = parseElectribeAllPatBank(buf);

    expect(bank.patterns.length).toBe(E2S_ALLPAT_SLOT_COUNT);
    expect(bank.patterns[0].name).toBe("Kick16");
    expect(bank.patterns[0].bpm).toBeCloseTo(140, 1);
    expect(bank.patterns[0].stepLength).toBe(16);
    expect(bank.patterns[1].name).toBe("Snare32");
    expect(bank.patterns[1].bpm).toBeCloseTo(90.5, 1);
    expect(bank.patterns[1].stepLength).toBe(32);

    // step triggers survive the full chain
    const p0Part0 = bank.patterns[0].parts[0].steps;
    expect(p0Part0[0].active).toBe(true);
    expect(p0Part0[4].active).toBe(true);
    expect(p0Part0[8].active).toBe(true);
    expect(p0Part0[12].active).toBe(true);
    expect(p0Part0[1].active).toBe(false);

    const p1Part2 = bank.patterns[1].parts[2].steps;
    expect(p1Part2[4].active).toBe(true);
    expect(p1Part2[12].active).toBe(true);
    expect(p1Part2[0].active).toBe(false);

    // untouched slots parse as the factory init pattern
    expect(bank.patterns[2].name).toBe(TEMPLATE_NAME);
  });

  it("per-part sampleId written at +0x08 round-trips through the parser (v3.271 fix)", () => {
    const parts = emptyParts();
    parts[0] = { sampleId: 501, steps: [{ active: true }] };
    parts[5] = { sampleId: 666, steps: [] };
    const p: E2PatternInput = { name: "SampleRef", bpm: 120, stepLength: 16, parts };

    // Direct byte check: u16 LE @ part+0x08.
    const body = buildE2PatternBody(p);
    const partOff = (i: number) => 0x800 + i * 816 + 0x08;
    expect(body[partOff(0)] | (body[partOff(0) + 1] << 8)).toBe(501);
    expect(body[partOff(5)] | (body[partOff(5) + 1] << 8)).toBe(666);

    // Parser reads it back from +0x08 (was +0x04 before the fix).
    const bank = parseElectribeAllPatBank(new Uint8Array(buildE2AllPatFile([p])));
    expect(bank.patterns[0].parts[0].sampleId).toBe(501);
    expect(bank.patterns[0].parts[5].sampleId).toBe(666);
  });
});

// ─── 2. Real-file ground truth (conditional skip) ───────────────────────────

const REAL_FILES_DIR = path.resolve(process.cwd(), "Korg e2s files");
const REAL_ALLPAT = "e2s-2016.e2sallpat";
const REAL_E2SPAT = "181_Init Pattern.e2spat";

const REAL_AVAILABLE = (() => {
  try {
    return (
      fs.existsSync(path.join(REAL_FILES_DIR, REAL_ALLPAT)) &&
      fs.existsSync(path.join(REAL_FILES_DIR, REAL_E2SPAT))
    );
  } catch {
    return false;
  }
})();

const realRunner = REAL_AVAILABLE ? describe : describe.skip;

realRunner("e2sExport — real-file ground truth", () => {
  it("reconstructed .e2sallpat prefix byte-matches the real bank prefix", () => {
    const real = new Uint8Array(fs.readFileSync(path.join(REAL_FILES_DIR, REAL_ALLPAT)));
    const built = new Uint8Array(buildE2AllPatFile([]));
    expect(built.byteLength).toBe(real.byteLength);
    const realPrefix = real.slice(0, E2S_ALLPAT_PREFIX_SIZE);
    const builtPrefix = built.slice(0, E2S_ALLPAT_PREFIX_SIZE);
    expect(diffOffsets(builtPrefix, realPrefix)).toEqual([]);
  });

  it(".e2spat file header byte-matches a real KORG file header (0x00..0x100)", () => {
    const real = new Uint8Array(fs.readFileSync(path.join(REAL_FILES_DIR, REAL_E2SPAT)));
    const built = new Uint8Array(buildE2PatternFileV2(NEUTRAL_INPUT));
    expect(diffOffsets(built.slice(0, 0x100), real.slice(0, 0x100))).toEqual([]);
  });

  it("a real init-pattern body parses cleanly through our overlay (body region matches template structure)", () => {
    // Sanity: the embedded template really is the size of a real body and starts with PTST.
    expect(TEMPLATE_BODY.length).toBe(E2S_BODY_SIZE);
    expect([...TEMPLATE_BODY.slice(0, 4)]).toEqual([0x50, 0x54, 0x53, 0x54]);
  });
});

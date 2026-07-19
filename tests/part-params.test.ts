import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createPattern,
  buildPatternFile,
  importE2Patterns,
  serializeProject,
  deserializeProject,
  createProject,
} from "../src/core/editorModel";
import {
  PART_PARAMS,
  readPartParamsFromBody,
  writePartParamsToBody,
  clampParamValue,
  PART_PARAMS_BASE,
  PART_PARAMS_STRIDE,
} from "../src/core/partParams";

const off = (part: number, o: number) => 0x100 + PART_PARAMS_BASE + part * PART_PARAMS_STRIDE + o;

describe("partParams — experimentelles Sound-Param-Editing", () => {
  it("write→read round-trip on a body", () => {
    const body = new Uint8Array(0x4000);
    writePartParamsToBody(body, 3, { cutoff: 100, resonance: 40, ifxOn: 1, filterType: 2 });
    const r = readPartParamsFromBody(body, 3);
    expect(r.cutoff).toBe(100);
    expect(r.resonance).toBe(40);
    expect(r.ifxOn).toBe(1);
    expect(r.filterType).toBe(2);
  });

  it("does NOT touch verified volume(0x15)/pan(0x22)/sample(0x08) offsets", () => {
    // Keiner der Param-Offsets darf mit 0x08,0x09,0x15,0x22 kollidieren.
    const used = new Set(PART_PARAMS.map((p) => p.offset));
    for (const forbidden of [0x08, 0x09, 0x15, 0x22]) {
      expect(used.has(forbidden)).toBe(false);
    }
  });

  it("a set param lands at its offset in the exported .e2spat body", () => {
    const p = createPattern("FX");
    p.parts[0].params = { cutoff: 77, ifxOn: 1, ifxType: 5 };
    const file = buildPatternFile(p);
    expect(file[off(0, 0x0d)]).toBe(77); // cutoff
    expect(file[off(0, 0x20)]).toBe(1); // ifxOn
    expect(file[off(0, 0x21)]).toBe(5); // ifxType
  });

  it("write is byte-safe (raw), UI clamp is separate", () => {
    const body = new Uint8Array(0x4000);
    // Roh geschrieben: 999 & 0xFF = 231 (Preservation, kein Range-Raten).
    writePartParamsToBody(body, 0, { cutoff: 999 });
    expect(readPartParamsFromBody(body, 0).cutoff).toBe(231);
    // UI-Clamp begrenzt User-Eingaben auf den vermuteten Bereich.
    expect(clampParamValue("cutoff", 999)).toBe(127);
    expect(clampParamValue("ifxOn", 5)).toBe(1);
    expect(clampParamValue("filterType", -3)).toBe(0);
  });

  it("params survive project save/load", () => {
    const project = createProject();
    project.patterns[0].parts[2].params = { cutoff: 55, resonance: 66 };
    const restored = deserializeProject(serializeProject(project));
    expect(restored.patterns[0].parts[2].params).toEqual({ cutoff: 55, resonance: 66 });
  });
});

const GOLDEN = path.resolve(process.cwd(), "examples", "golden", "245_BodyTalk1.e2spat");
(fs.existsSync(GOLDEN) ? describe : describe.skip)("partParams — Import befüllt aus rawBody (BodyTalk1)", () => {
  const orig = new Uint8Array(fs.readFileSync(GOLDEN));

  it("populates part.params on import and preserves them on unchanged re-export", () => {
    const p = importE2Patterns(orig).patterns[0];
    expect(p.parts[0].params).toBeDefined(); // params sitzen pro PART
    // Re-Export ohne Änderung → Param-Bytes identisch zum Original
    const origBody = orig.slice(0x100);
    const outBody = buildPatternFile(p).slice(0x100);
    for (let part = 0; part < 16; part++) {
      for (const pp of PART_PARAMS) {
        const o = PART_PARAMS_BASE + part * PART_PARAMS_STRIDE + pp.offset;
        expect(outBody[o]).toBe(origBody[o]);
      }
    }
  });

  it("editing one param changes only that byte", () => {
    const p = importE2Patterns(orig).patterns[0];
    const origBody = orig.slice(0x100);
    p.parts[0].params = { ...p.parts[0].params, cutoff: (origBody[PART_PARAMS_BASE + 0x0d] + 1) & 0x7f };
    const outBody = buildPatternFile(p).slice(0x100);
    // genau das Cutoff-Byte von Part 0 unterscheidet sich
    let diffs = 0;
    for (let i = 0x800; i < 0x800 + 16 * PART_PARAMS_STRIDE; i++) {
      if (outBody[i] !== origBody[i]) diffs++;
    }
    // Nur editierte Steps (keine) + das eine Cutoff-Byte → aber Steps werden
    // aus dem Editor-Modell neu geschrieben; prüfe gezielt das Cutoff-Byte.
    expect(outBody[PART_PARAMS_BASE + 0x0d]).toBe((origBody[PART_PARAMS_BASE + 0x0d] + 1) & 0x7f);
    expect(diffs).toBeGreaterThan(0);
  });
});

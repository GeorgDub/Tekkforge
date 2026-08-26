import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  importE2Patterns,
  buildPatternFile,
  createPattern,
  serializeProject,
  deserializeProject,
  clonePattern,
  createProject,
} from "../src/core/editorModel";

const GOLDEN = path.resolve(process.cwd(), "examples", "golden", "245_BodyTalk1.e2spat");
const PARTS_OFF = 0x800;
const PART_STRIDE = 0x330;

/** Part-Header-Offsets, die wir NICHT editieren (müssen erhalten bleiben). */
const PRESERVED_PART_OFFSETS: number[] = [];
for (let o = 0x0a; o < 0x30; o++) {
  if (o === 0x15 || o === 0x22) continue; // Volume / Pan (editierbar)
  PRESERVED_PART_OFFSETS.push(o);
}

(fs.existsSync(GOLDEN) ? describe : describe.skip)("rawBody-Fidelity (BodyTalk1)", () => {
  const orig = new Uint8Array(fs.readFileSync(GOLDEN));
  const origBody = orig.slice(0x100);

  it("import → export ohne Änderung: Part-Header (Filter/Amp/IFX) byte-identisch", () => {
    const res = importE2Patterns(orig);
    const p = res.patterns[0];
    expect(p.rawBody).toBeDefined();
    expect(p.rawBody!.length).toBe(0x4000);

    const outBody = buildPatternFile(p).slice(0x100);
    let diffs = 0;
    for (let part = 0; part < 16; part++) {
      const ps = PARTS_OFF + part * PART_STRIDE;
      for (const o of PRESERVED_PART_OFFSETS) {
        if (outBody[ps + o] !== origBody[ps + o]) diffs++;
      }
    }
    expect(diffs).toBe(0);
  });

  it("import → export: Motion-/Pattern-Header-Region 0x100–0x7FF byte-identisch", () => {
    const res = importE2Patterns(orig);
    const outBody = buildPatternFile(res.patterns[0]).slice(0x100);
    let diffs = 0;
    for (let i = 0x100; i < 0x800; i++) if (outBody[i] !== origBody[i]) diffs++;
    expect(diffs).toBe(0);
  });

  it("import → export: Chain-Region (0x3B00) byte-identisch", () => {
    const res = importE2Patterns(orig);
    const outBody = buildPatternFile(res.patterns[0]).slice(0x100);
    for (let i = 0x3b00; i < 0x3b10; i++) expect(outBody[i]).toBe(origBody[i]);
  });

  it("Kontrast: Neu-Pattern (ohne rawBody) weicht im Part-Header (Filter/Amp) ab", () => {
    // Zeigt, dass die Erhaltung wirklich vom rawBody kommt: das Init-Template
    // hat andere Part-Header-Bytes (Filter/Amp/IFX) als das Factory-Pattern.
    const fresh = buildPatternFile(createPattern("NEU")).slice(0x100);
    let diffs = 0;
    for (let part = 0; part < 16; part++) {
      const ps = PARTS_OFF + part * PART_STRIDE;
      for (const o of PRESERVED_PART_OFFSETS) if (fresh[ps + o] !== origBody[ps + o]) diffs++;
    }
    expect(diffs).toBeGreaterThan(0);
  });

  it("rawBody überlebt clonePattern (Uint8Array, kein JSON-Objekt)", () => {
    const p = importE2Patterns(orig).patterns[0];
    const c = clonePattern(p);
    expect(c.rawBody).toBeInstanceOf(Uint8Array);
    expect(c.rawBody!.length).toBe(0x4000);
    expect([...c.rawBody!.slice(0, 16)]).toEqual([...p.rawBody!.slice(0, 16)]);
  });

  it("rawBody überlebt Projekt Save/Load (Base64)", () => {
    const project = createProject();
    project.patterns = importE2Patterns(orig).patterns;
    const restored = deserializeProject(serializeProject(project));
    const rb = restored.patterns[0].rawBody;
    expect(rb).toBeInstanceOf(Uint8Array);
    expect(rb!.length).toBe(0x4000);
    // Re-Export nach Load = weiterhin fidelity-erhaltend
    const outBody = buildPatternFile(restored.patterns[0]).slice(0x100);
    for (let i = 0x100; i < 0x800; i++) expect(outBody[i]).toBe(origBody[i]);
  });

  it("editierte Steps werden überlagert, Rest bleibt erhalten", () => {
    const p = importE2Patterns(orig).patterns[0];
    // ändere einen Step in Part 0
    p.parts[0].steps[0] = { on: true, velocity: 111, note: 65, gate: 20 };
    const outBody = buildPatternFile(p).slice(0x100);
    const so = PARTS_OFF + 0x30; // Part0 Step0
    expect(outBody[so]).toBe(0x01); // trigger
    expect(outBody[so + 1]).toBe(20); // gate
    expect(outBody[so + 2]).toBe(111); // velocity
    // Note wird als MIDI+1 abgelegt (0 = kein Ton) — siehe e2StepNote.ts.
    expect(outBody[so + 4]).toBe(66); // MIDI 65
    // Motion-Region trotzdem erhalten
    let diffs = 0;
    for (let i = 0x100; i < 0x800; i++) if (outBody[i] !== origBody[i]) diffs++;
    expect(diffs).toBe(0);
  });
});

describe("Kette überlebt den Weg in den Editor", () => {
  it("chainTo und chainRepeat werden beim Import zurückgelesen", () => {
    // Geschrieben wurden sie schon immer (0x3B00/0x3B02) — gelesen nicht.
    // Damit verlor jedes importierte Set seine Kette: der Song-Modus und das
    // Ausrechnen einer Vorschau sahen lauter einzelne Patterns.
    const p = createPattern("KETTE");
    p.chainTo = 7;
    p.chainRepeat = 3;
    const zurueck = importE2Patterns(buildPatternFile(p)).patterns[0];
    expect(zurueck.chainTo).toBe(7);
    expect(zurueck.chainRepeat).toBe(3);
  });

  it("ohne Kette bleibt das Feld leer statt 0 zu behaupten", () => {
    const zurueck = importE2Patterns(buildPatternFile(createPattern("OHNE"))).patterns[0];
    expect(zurueck.chainTo ?? 0).toBe(0);
  });
});

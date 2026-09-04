import { describe, it, expect } from "vitest";
import { createPattern, type EditorProject } from "../src/core/editorModel";
import { verdoppleSteps, kopierePart, fuegePartEin, haengePatternsAn, istUnberuehrt } from "../src/core/patternWerkzeuge";

function pattern(name: string, len: 16 | 32 | 64, hits: [number, number, number?][] = []): ReturnType<typeof createPattern> {
  const p = createPattern(name);
  p.stepLength = len;
  for (const [part, step, note] of hits) {
    p.parts[part].steps[step].on = true;
    if (note !== undefined) p.parts[part].steps[step].note = note;
  }
  return p;
}
const an = (p: ReturnType<typeof createPattern>, part: number) => p.parts[part].steps.map((s, i) => (s.on ? i : -1)).filter((i) => i >= 0);

describe("patternWerkzeuge", () => {
  it("verdoppleSteps: 16 → 32 → 64 kopiert die erste Haelfte, 64 bleibt", () => {
    const p = pattern("T", 16, [[0, 0, 60], [0, 4, 62], [3, 8]]);
    p.parts[0].steps[4].notes = [62, 65];
    expect(verdoppleSteps(p)).toBe(true);
    expect(p.stepLength).toBe(32);
    expect(an(p, 0)).toEqual([0, 4, 16, 20]);
    expect(an(p, 3)).toEqual([8, 24]);
    expect(p.parts[0].steps[20].note).toBe(62);
    expect(p.parts[0].steps[20].notes).toEqual([62, 65]);
    expect(p.parts[0].steps[20].notes).not.toBe(p.parts[0].steps[4].notes);
    expect(verdoppleSteps(p)).toBe(true);
    expect(p.stepLength).toBe(64);
    expect(an(p, 0)).toEqual([0, 4, 16, 20, 32, 36, 48, 52]);
    expect(verdoppleSteps(p)).toBe(false);
  });

  it("kopierePart / fuegePartEin: Steps wandern, kuerzere Quelle wird wiederholt, Klang nur auf Wunsch", () => {
    const quelle = pattern("Q", 16, [[2, 0, 67], [2, 6, 69]]);
    quelle.parts[2].sampleNumber = 555;
    quelle.parts[2].volume = 90;
    quelle.parts[2].params = { cutoff: 33 };
    const ablage = kopierePart(quelle.parts[2], quelle.stepLength);
    quelle.parts[2].steps[0].on = false; // die Ablage ist eine Kopie
    expect(ablage.steps[0].on).toBe(true);
    const ziel = pattern("Z", 64, [[5, 3]]);
    ziel.parts[5].sampleNumber = 777;
    fuegePartEin(ziel.parts[5], ablage, ziel.stepLength);
    expect(an(ziel, 5)).toEqual([0, 6, 16, 22, 32, 38, 48, 54]);
    expect(ziel.parts[5].steps[22].note).toBe(69);
    expect(ziel.parts[5].sampleNumber).toBe(777);
    // ohne Wiederholen: nur die Quell-Laenge, Rest leer
    fuegePartEin(ziel.parts[5], ablage, ziel.stepLength, { wiederholen: false });
    expect(an(ziel, 5)).toEqual([0, 6]);
    // mit Klang: Sample, Volume, Parameter kommen mit
    fuegePartEin(ziel.parts[5], ablage, ziel.stepLength, { mitKlang: true });
    expect(ziel.parts[5].sampleNumber).toBe(555);
    expect(ziel.parts[5].volume).toBe(90);
    expect(ziel.parts[5].params).toEqual({ cutoff: 33 });
  });

  it("haengePatternsAn: hinten dran, Ketten verschoben, leeres Vorgabe-Pattern wird ersetzt", () => {
    const projekt: EditorProject = { version: 1, patterns: [pattern("PATTERN 1", 64)], samples: [] };
    expect(istUnberuehrt(projekt.patterns[0])).toBe(true);
    const a = pattern("MIDI 1", 32, [[0, 0]]);
    const b = pattern("MIDI 2", 32, [[0, 4]]);
    a.chainTo = 2;
    b.chainTo = 1;
    expect(haengePatternsAn(projekt, [a, b])).toBe(0);
    expect(projekt.patterns.map((p) => p.name)).toEqual(["MIDI 1", "MIDI 2"]);
    expect(projekt.patterns[0].chainTo).toBe(2);
    // zweiter Import: hinten, Ketten um 2 verschoben, Quelle bleibt unangetastet
    const c = pattern("MIDI 3", 16, [[1, 2]]);
    c.chainTo = 1;
    expect(haengePatternsAn(projekt, [c])).toBe(2);
    expect(projekt.patterns).toHaveLength(3);
    expect(projekt.patterns[2].chainTo).toBe(3);
    expect(c.chainTo).toBe(1);
    projekt.patterns[2].parts[1].steps[2].on = false;
    expect(c.parts[1].steps[2].on).toBe(true);
    expect(istUnberuehrt(projekt.patterns[0])).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { createPattern, type EditorPattern, type PoolSample } from "../src/core/editorModel";
import { fuehreZusammen, type BibliothekEintrag } from "../src/core/bibliothek";

function sample(nr: number, name: string, wert = 0.5, sekunden = 0.5): PoolSample {
  return { number: nr, name, sampleRate: 44100, pcm: new Float32Array(Math.round(44100 * sekunden)).fill(wert) };
}

function pattern(name: string, refs: (number | null)[]): EditorPattern {
  const p = createPattern(name);
  refs.forEach((nr, i) => {
    if (!p.parts[i]) return;
    p.parts[i].sampleNumber = nr;
    if (nr !== null) p.parts[i].steps[0].on = true;
  });
  return p;
}

function eintrag(id: string, p: EditorPattern, samples: PoolSample[]): BibliothekEintrag {
  return { id, name: p.name, pattern: p, samples, wann: 0 };
}

describe("fuehreZusammen", () => {
  it("legt die Samples zweier Patterns in EINE Bank und zieht die Verweise mit", () => {
    const a = eintrag("a", pattern("A", [501, 502]), [sample(501, "Kick A", 0.1), sample(502, "Snare A", 0.2)]);
    const b = eintrag("b", pattern("B", [501]), [sample(501, "Kick B", 0.3)]);
    const r = fuehreZusammen([a, b]);
    expect(r.samples.map((s) => s.number)).toEqual([501, 502, 503]);
    // Beide Bänke hatten ein 501 — in der gemeinsamen Bank zeigen sie auf
    // verschiedene Nummern, nicht beide auf dieselbe.
    expect(r.patterns[0].parts[0].sampleNumber).toBe(501);
    expect(r.patterns[1].parts[0].sampleNumber).toBe(503);
  });

  it("speichert ein identisches Sample nur einmal", () => {
    // Zwei Patterns aus demselben Set teilen sich die Kick. Zweimal ablegen
    // hieße, das knappe Sample-RAM zu verschenken.
    const geteilt = () => sample(501, "Kick", 0.4);
    const a = eintrag("a", pattern("A", [501]), [geteilt()]);
    const b = eintrag("b", pattern("B", [501]), [geteilt()]);
    const r = fuehreZusammen([a, b]);
    expect(r.samples).toHaveLength(1);
    expect(r.doppelt).toBe(1);
    expect(r.patterns[0].parts[0].sampleNumber).toBe(501);
    expect(r.patterns[1].parts[0].sampleNumber).toBe(501);
  });

  it("gleicher Name, anderer Inhalt bleibt zweimal drin", () => {
    // Namen sind kein Beweis: zwei Sets können beide „Kick" heißen und ganz
    // verschieden klingen. Entdoppelt wird nur bei gleichem Inhalt.
    const a = eintrag("a", pattern("A", [501]), [sample(501, "Kick", 0.1)]);
    const b = eintrag("b", pattern("B", [501]), [sample(501, "Kick", 0.9)]);
    const r = fuehreZusammen([a, b]);
    expect(r.samples).toHaveLength(2);
    expect(r.doppelt).toBe(0);
  });

  it("gleicher Inhalt, andere Länge ist nicht dasselbe", () => {
    const a = eintrag("a", pattern("A", [501]), [sample(501, "K", 0.5, 0.5)]);
    const b = eintrag("b", pattern("B", [501]), [sample(501, "K", 0.5, 1.0)]);
    expect(fuehreZusammen([a, b]).samples).toHaveLength(2);
  });

  it("leert Verweise, deren Sample fehlt, und meldet sie", () => {
    const a = eintrag("a", pattern("A", [501, 777]), [sample(501, "Kick")]);
    const r = fuehreZusammen([a]);
    expect(r.patterns[0].parts[0].sampleNumber).toBe(501);
    expect(r.patterns[0].parts[1].sampleNumber).toBeNull();
    expect(r.patterns[0].parts[1].muted).toBe(true);
    expect(r.verwaist).toBe(1);
    expect(r.hinweise.join(" ")).toMatch(/777/);
  });

  it("die Kette zeigt auf die Plätze in der neuen Reihenfolge", () => {
    const a = eintrag("a", pattern("A", [501]), [sample(501, "K1", 0.1)]);
    const b = eintrag("b", pattern("B", [501]), [sample(501, "K2", 0.2)]);
    const c = eintrag("c", pattern("C", [501]), [sample(501, "K3", 0.3)]);
    const r = fuehreZusammen([a, b, c], { verketten: true });
    expect(r.patterns.map((p) => p.chainTo)).toEqual([2, 3, 0]);
  });

  it("ohne Verketten bleiben die Patterns einzeln", () => {
    const a = eintrag("a", pattern("A", [501]), [sample(501, "K1", 0.1)]);
    const b = eintrag("b", pattern("B", [501]), [sample(501, "K2", 0.2)]);
    const r = fuehreZusammen([a, b]);
    expect(r.patterns.every((p) => (p.chainTo ?? 0) === 0)).toBe(true);
  });

  it("warnt, wenn die gemeinsame Bank nicht ins Sample-RAM passt", () => {
    const riesig = sample(501, "Riese", 0.5, 200);
    const a = eintrag("a", pattern("A", [501]), [riesig]);
    const b = eintrag("b", pattern("B", [501]), [sample(501, "Zweiter", 0.4, 200)]);
    const r = fuehreZusammen([a, b]);
    expect(r.hinweise.join(" ")).toMatch(/RAM|passt nicht/i);
  });

  it("lässt die abgelegten Patterns unangetastet", () => {
    const p = pattern("A", [501]);
    const a = eintrag("a", p, [sample(501, "K")]);
    fuehreZusammen([a, a]);
    expect(p.parts[0].sampleNumber).toBe(501);
  });

  it("eine leere Auswahl ergibt ein leeres Ergebnis, keinen Fehler", () => {
    const r = fuehreZusammen([]);
    expect(r.patterns).toEqual([]);
    expect(r.samples).toEqual([]);
  });
});

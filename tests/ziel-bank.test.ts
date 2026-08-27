import { describe, it, expect } from "vitest";
import { createPattern, type EditorPattern, type PoolSample } from "../src/core/editorModel";
import {
  leereZielBank,
  fuegeHinzu,
  entferne,
  ramBytes,
  RAM_BUDGET_BYTES,
  uebernehmeMuster,
  type ZielBank,
} from "../src/core/zielBank";

function sample(nr: number, name: string, sekunden = 1): PoolSample {
  return { number: nr, name, sampleRate: 44100, pcm: new Float32Array(Math.round(44100 * sekunden)) };
}

/** Pattern, dessen Parts auf bestimmte Sample-Nummern zeigen. */
function pattern(name: string, refs: (number | null)[]): EditorPattern {
  const p = createPattern(name);
  refs.forEach((nr, i) => {
    if (p.parts[i]) {
      p.parts[i].sampleNumber = nr;
      if (nr !== null) p.parts[i].steps[0].on = true;
    }
  });
  return p;
}

describe("Ziel-Bank: einsammeln", () => {
  it("beginnt leer", () => {
    const b = leereZielBank();
    expect(b.eintraege).toEqual([]);
    expect(ramBytes(b)).toBe(0);
  });

  it("vergibt Nummern ab 501, lückenlos", () => {
    const b = leereZielBank();
    fuegeHinzu(b, [sample(700, "A"), sample(701, "B")], { quelle: "bank1" });
    expect(b.eintraege.map((e) => e.nummer)).toEqual([501, 502]);
  });

  it("merkt sich, woher jedes Sample kam", () => {
    const b = leereZielBank();
    fuegeHinzu(b, [sample(700, "A")], { quelle: "erste.all" });
    fuegeHinzu(b, [sample(700, "B")], { quelle: "zweite.all" });
    expect(b.eintraege.map((e) => `${e.quelle}#${e.quellNummer}`)).toEqual(["erste.all#700", "zweite.all#700"]);
  });

  it("dieselbe Nummer aus zwei Bänken kollidiert nicht", () => {
    // Genau der Fall beim Zusammenführen: beide Bänke haben ein Sample 501.
    const b = leereZielBank();
    fuegeHinzu(b, [sample(501, "Kick A")], { quelle: "a" });
    fuegeHinzu(b, [sample(501, "Kick B")], { quelle: "b" });
    expect(b.eintraege.map((e) => e.nummer)).toEqual([501, 502]);
    expect(b.eintraege.map((e) => e.name)).toEqual(["Kick A", "Kick B"]);
  });

  it("meldet, was hinzugekommen ist", () => {
    const b = leereZielBank();
    const r = fuegeHinzu(b, [sample(700, "A"), sample(701, "B")], { quelle: "x" });
    expect(r.aufgenommen).toBe(2);
    expect(r.abbildung.get(700)).toBe(501);
    expect(r.abbildung.get(701)).toBe(502);
  });

  it("entfernen füllt die Lücke nicht auf — Nummern bleiben stabil", () => {
    // Wichtig: wer entfernt, darf nicht dafür sorgen, dass ein anderes Sample
    // plötzlich unter einer fremden Nummer steht. Das Aufräumen ist ein
    // eigener Schritt.
    const b = leereZielBank();
    fuegeHinzu(b, [sample(700, "A"), sample(701, "B"), sample(702, "C")], { quelle: "x" });
    entferne(b, [502]);
    expect(b.eintraege.map((e) => e.nummer)).toEqual([501, 503]);
  });
});

describe("Ziel-Bank: Speicher", () => {
  it("rechnet in Geräte-Bytes (16 Bit Mono bei 44,1 kHz)", () => {
    const b = leereZielBank();
    fuegeHinzu(b, [sample(700, "A", 2)], { quelle: "x" });
    expect(ramBytes(b)).toBe(2 * 44100 * 2);
  });

  it("warnt, wenn das Budget reißt — nimmt aber trotzdem auf", () => {
    const b = leereZielBank();
    const gross = sample(700, "Riese", RAM_BUDGET_BYTES / (44100 * 2) + 5);
    const r = fuegeHinzu(b, [gross], { quelle: "x" });
    expect(r.aufgenommen).toBe(1);
    expect(r.hinweise.join(" ")).toMatch(/RAM|Budget|passt nicht/i);
  });

  it("unter dem Budget gibt es keine Warnung", () => {
    const b = leereZielBank();
    const r = fuegeHinzu(b, [sample(700, "klein", 1)], { quelle: "x" });
    expect(r.hinweise).toEqual([]);
  });
});

describe("Ziel-Bank: Patterns übernehmen", () => {
  it("führt die Verweise auf die neuen Nummern nach", () => {
    const b = leereZielBank();
    const r = fuegeHinzu(b, [sample(700, "Kick"), sample(701, "Snare")], { quelle: "x" });
    const p = pattern("P1", [700, 701]);
    const bericht = uebernehmeMuster(b, [p], r.abbildung);
    expect(bericht.patterns[0].parts[0].sampleNumber).toBe(501);
    expect(bericht.patterns[0].parts[1].sampleNumber).toBe(502);
  });

  it("meldet Verweise, deren Sample nicht mitgekommen ist", () => {
    // DIE gefährliche Stelle: ein Part zeigt auf ein Sample, das nicht in der
    // Zielbank steckt. Bliebe die alte Nummer stehen, spielte das Gerät dort
    // irgendein fremdes Sample — still und falsch.
    const b = leereZielBank();
    const r = fuegeHinzu(b, [sample(700, "Kick")], { quelle: "x" });
    const p = pattern("P1", [700, 999]);
    const bericht = uebernehmeMuster(b, [p], r.abbildung);
    expect(bericht.patterns[0].parts[0].sampleNumber).toBe(501);
    expect(bericht.patterns[0].parts[1].sampleNumber, "verwaister Verweis muss leer sein").toBeNull();
    expect(bericht.verwaist).toBe(1);
    expect(bericht.hinweise.join(" ")).toMatch(/999/);
  });

  it("ein verwaister Part wird stummgeschaltet, nicht heimlich weitergespielt", () => {
    const b = leereZielBank();
    const r = fuegeHinzu(b, [sample(700, "Kick")], { quelle: "x" });
    const bericht = uebernehmeMuster(b, [pattern("P1", [700, 999])], r.abbildung);
    expect(bericht.patterns[0].parts[1].muted).toBe(true);
  });

  it("lässt das Original unangetastet", () => {
    const b = leereZielBank();
    const r = fuegeHinzu(b, [sample(700, "Kick")], { quelle: "x" });
    const p = pattern("P1", [700]);
    uebernehmeMuster(b, [p], r.abbildung);
    expect(p.parts[0].sampleNumber).toBe(700);
  });

  it("Parts ohne Sample bleiben ohne Sample", () => {
    const b = leereZielBank();
    const r = fuegeHinzu(b, [sample(700, "Kick")], { quelle: "x" });
    const bericht = uebernehmeMuster(b, [pattern("P1", [700, null])], r.abbildung);
    expect(bericht.patterns[0].parts[1].sampleNumber).toBeNull();
    expect(bericht.verwaist).toBe(0);
  });

  it("mehrere Patterns aus verschiedenen Bänken landen konsistent", () => {
    const b = leereZielBank();
    const a = fuegeHinzu(b, [sample(501, "A-Kick")], { quelle: "a" });
    const c = fuegeHinzu(b, [sample(501, "B-Kick")], { quelle: "b" });
    const pa = uebernehmeMuster(b, [pattern("PA", [501])], a.abbildung);
    const pb = uebernehmeMuster(b, [pattern("PB", [501])], c.abbildung);
    expect(pa.patterns[0].parts[0].sampleNumber).toBe(501);
    expect(pb.patterns[0].parts[0].sampleNumber).toBe(502);
  });
});

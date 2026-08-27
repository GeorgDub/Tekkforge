import { describe, it, expect } from "vitest";
import {
  createPattern,
  importE2Patterns,
  importSamplesFromAll,
  type EditorPattern,
  type PoolSample,
} from "../src/core/editorModel";
import type { BibliothekEintrag } from "../src/core/bibliothek";
import { dateienEinzeln, dateienSeparat, dateienGemeinsam } from "../src/core/bibliothekExport";

function sample(nr: number, name: string, wert: number, sekunden = 0.2): PoolSample {
  return { number: nr, name, sampleRate: 44100, pcm: new Float32Array(Math.round(44100 * sekunden)).fill(wert) };
}

function pattern(name: string, refs: number[]): EditorPattern {
  const p = createPattern(name);
  refs.forEach((nr, i) => {
    p.parts[i].sampleNumber = nr;
    p.parts[i].steps[0].on = true;
  });
  return p;
}

function eintrag(id: string, name: string, refs: number[], samples: PoolSample[]): BibliothekEintrag {
  return { id, name, pattern: pattern(name, refs), samples, wann: 0 };
}

/** Zeigt jeder gesetzte Part-Verweis auf ein Sample, das wirklich in der Bank liegt? */
function verweiseLoesenAuf(allpat: Uint8Array, all: Uint8Array, patternNr: number): boolean {
  const { patterns } = importE2Patterns(allpat, true);
  const vorhanden = new Set(importSamplesFromAll(all).map((s) => s.number));
  const p = patterns[patternNr];
  if (!p) return false;
  return p.parts.every(
    (part) => !part.steps.some((s) => s.on) || (part.sampleNumber !== null && vorhanden.has(part.sampleNumber)),
  );
}

function finde(dateien: { name: string; bytes: Uint8Array }[], endung: string): { name: string; bytes: Uint8Array }[] {
  return dateien.filter((d) => d.name.toLowerCase().endsWith(endung));
}

describe("bibliothekExport", () => {
  const a = () => eintrag("a", "AMPHEGOTT", [501, 502], [sample(501, "Kick", 0.2), sample(502, "Vox", 0.3)]);
  const b = () => eintrag("b", "STURMMASKE", [501], [sample(501, "Kick B", 0.7)]);

  it("gemeinsam: eine Bank, eine Pattern-Datei, und die Verweise lösen darin auf", () => {
    const r = dateienGemeinsam([a(), b()]);
    expect(finde(r.dateien, ".e2sallpat")).toHaveLength(1);
    expect(finde(r.dateien, ".all")).toHaveLength(1);
    const allpat = finde(r.dateien, ".e2sallpat")[0].bytes;
    const all = finde(r.dateien, ".all")[0].bytes;
    // Beide Einträge hatten ein 501 — in der gemeinsamen Bank muss jedes
    // Pattern auf SEIN Sample zeigen, nicht beide auf dasselbe.
    expect(verweiseLoesenAuf(allpat, all, 0)).toBe(true);
    expect(verweiseLoesenAuf(allpat, all, 1)).toBe(true);
    const { patterns } = importE2Patterns(allpat, true);
    expect(patterns[0].parts[0].sampleNumber).not.toBe(patterns[1].parts[0].sampleNumber);
  });

  it("separat: je Eintrag eine .all, und die Pattern-Datei behält die alten Nummern", () => {
    const r = dateienSeparat([a(), b()]);
    expect(finde(r.dateien, ".e2sallpat")).toHaveLength(1);
    expect(finde(r.dateien, ".all")).toHaveLength(2);
    const allpat = finde(r.dateien, ".e2sallpat")[0].bytes;
    const [bankA, bankB] = finde(r.dateien, ".all");
    // Pattern 1 gehört zu Bank 1, Pattern 2 zu Bank 2 — jede für sich geladen.
    expect(verweiseLoesenAuf(allpat, bankA.bytes, 0)).toBe(true);
    expect(verweiseLoesenAuf(allpat, bankB.bytes, 1)).toBe(true);
  });

  it("einzeln: je Eintrag eine .e2spat und die Bank dazu", () => {
    const r = dateienEinzeln([a(), b()]);
    expect(finde(r.dateien, ".e2spat")).toHaveLength(2);
    expect(finde(r.dateien, ".all")).toHaveLength(2);
  });

  it("gleiche Namen überschreiben sich nicht", () => {
    const r = dateienSeparat([eintrag("a", "TEKK", [501], [sample(501, "K", 0.1)]), eintrag("b", "TEKK", [501], [sample(501, "K", 0.9)])]);
    const namen = r.dateien.map((d) => d.name);
    expect(new Set(namen).size).toBe(namen.length);
  });

  it("schreibt keine Bank, die das Gerät nicht laden kann", () => {
    // 5 × 60 s sind zusammen 26 MB — je Slot erlaubt, in Summe zu viel. Eine
    // solche Datei zu schreiben hilft niemandem: das Gerät weist sie ab, und
    // der Nutzer sucht den Fehler bei sich.
    const viele: PoolSample[] = [];
    for (let i = 0; i < 5; i++) viele.push(sample(501 + i, `S${i}`, 0.3, 60));
    const r = dateienGemeinsam([eintrag("g", "GROSS", [501], viele)]);
    expect(r.ueberBudget).toBe(true);
    expect(r.hinweise.join(" ")).toMatch(/RAM|passt nicht/i);
    expect(r.dateien).toEqual([]);
  });

  it("ein einzelnes Riesen-Sample stürzt nicht ab, sondern wird gemeldet", () => {
    // Der Bank-Bauer wirft bei über 10 MB je Slot. Das darf nicht als
    // Ausnahme in die Oberfläche durchschlagen.
    const r = dateienGemeinsam([eintrag("g", "GROSS", [501], [sample(501, "Riese", 0.5, 200)])]);
    expect(r.ueberBudget).toBe(true);
    expect(r.dateien).toEqual([]);
  });

  it("eine leere Auswahl liefert keine Dateien statt einer leeren Bank", () => {
    expect(dateienGemeinsam([]).dateien).toEqual([]);
    expect(dateienSeparat([]).dateien).toEqual([]);
    expect(dateienEinzeln([]).dateien).toEqual([]);
  });
});

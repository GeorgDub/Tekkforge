import { describe, it, expect } from "vitest";
import { createPattern, EDITOR_GATE_MAX, type EditorPattern } from "../src/core/editorModel";
import { stimmen } from "../src/core/patternStimmen";

function basis(): EditorPattern {
  const p = createPattern("T");
  p.stepLength = 16;
  for (const part of p.parts) part.sampleNumber = null;
  return p;
}

/** Ein einzelner klingender Step auf einem Part. */
function setze(p: EditorPattern, part: number, step: number, opts: Partial<{ note: number; velocity: number; gate: number; notes: number[] }> = {}): void {
  p.parts[part].sampleNumber = 501 + part;
  const s = p.parts[part].steps[step];
  s.on = true;
  if (opts.note !== undefined) s.note = opts.note;
  if (opts.velocity !== undefined) s.velocity = opts.velocity;
  if (opts.gate !== undefined) s.gate = opts.gate;
  if (opts.notes !== undefined) s.notes = opts.notes;
}

describe("stimmen", () => {
  it("liefert für jeden klingenden Step eine Stimme", () => {
    const p = basis();
    setze(p, 0, 0);
    setze(p, 0, 8);
    setze(p, 2, 4);
    const st = stimmen(p);
    expect(st).toHaveLength(3);
    expect(st.map((s) => s.step).sort((a, b) => a - b)).toEqual([0, 4, 8]);
  });

  it("überspringt Steps jenseits der genutzten Länge", () => {
    const p = basis();
    setze(p, 0, 0);
    setze(p, 0, 20); // hinter stepLength 16
    expect(stimmen(p)).toHaveLength(1);
  });

  it("überspringt stummgeschaltete Parts", () => {
    const p = basis();
    setze(p, 0, 0);
    setze(p, 1, 0);
    p.parts[1].muted = true;
    expect(stimmen(p)).toHaveLength(1);
  });

  it("überspringt Parts ohne Sample — sonst klänge es nach nichts", () => {
    const p = basis();
    setze(p, 0, 0);
    p.parts[0].sampleNumber = null;
    expect(stimmen(p)).toHaveLength(0);
  });

  it("rechnet Anschlag und Part-Lautstärke zusammen", () => {
    const p = basis();
    setze(p, 0, 0, { velocity: 127 });
    p.parts[0].volume = 127;
    expect(stimmen(p)[0].gain).toBeCloseTo(1, 4);
    p.parts[0].volume = 64;
    expect(stimmen(p)[0].gain).toBeCloseTo(64 / 127, 4);
  });

  it("hält den Pegel im gültigen Bereich, auch bei krummen Werten", () => {
    const p = basis();
    setze(p, 0, 0, { velocity: 200 });
    p.parts[0].volume = 200;
    expect(stimmen(p)[0].gain).toBeLessThanOrEqual(1);
    expect(stimmen(p)[0].gain).toBeGreaterThanOrEqual(0);
  });

  it("Panorama 64 ist die Mitte, 0 und 127 die Ränder", () => {
    const p = basis();
    setze(p, 0, 0);
    p.parts[0].pan = 64;
    expect(stimmen(p)[0].pan).toBeCloseTo(0, 3);
    p.parts[0].pan = 0;
    expect(stimmen(p)[0].pan).toBeCloseTo(-1, 3);
    p.parts[0].pan = 127;
    expect(stimmen(p)[0].pan).toBeCloseTo(1, 3);
  });

  it("Note 60 ist Originaltonhöhe, eine Oktave höher heißt doppelte Rate", () => {
    const p = basis();
    setze(p, 0, 0, { note: 60 });
    expect(stimmen(p)[0].rate).toBeCloseTo(1, 5);
    setze(p, 1, 0, { note: 72 });
    expect(stimmen(p).find((s) => s.part === 1)!.rate).toBeCloseTo(2, 5);
    setze(p, 2, 0, { note: 48 });
    expect(stimmen(p).find((s) => s.part === 2)!.rate).toBeCloseTo(0.5, 5);
  });

  it("Gate 96 heißt ausklingen lassen, kürzere Gates begrenzen die Dauer", () => {
    const p = basis();
    setze(p, 0, 0, { gate: EDITOR_GATE_MAX });
    expect(stimmen(p)[0].dauerSteps).toBeNull();
    setze(p, 1, 0, { gate: 24 });
    expect(stimmen(p).find((s) => s.part === 1)!.dauerSteps).toBeCloseTo(1, 4); // 24/96 × 4 Steps
    setze(p, 2, 0, { gate: 48 });
    expect(stimmen(p).find((s) => s.part === 2)!.dauerSteps).toBeCloseTo(2, 4);
  });

  it("ein Akkord ergibt eine Stimme je Ton — das Gerät spielt sie auch alle", () => {
    const p = basis();
    setze(p, 0, 0, { note: 60, notes: [60, 64, 67] });
    const st = stimmen(p);
    expect(st).toHaveLength(3);
    expect(st.map((s) => s.rate).map((r) => Math.round(Math.log2(r) * 12))).toEqual([0, 4, 7]);
    // Alle vom selben Part und Step, also auch derselbe Klang und Zeitpunkt
    expect(new Set(st.map((s) => s.sampleNumber)).size).toBe(1);
    expect(new Set(st.map((s) => s.step)).size).toBe(1);
  });

  it("gibt die Stimmen in Step-Reihenfolge zurück", () => {
    const p = basis();
    setze(p, 3, 12);
    setze(p, 0, 0);
    setze(p, 1, 4);
    expect(stimmen(p).map((s) => s.step)).toEqual([0, 4, 12]);
  });
});

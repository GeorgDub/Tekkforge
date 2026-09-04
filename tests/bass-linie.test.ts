import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { bassMitLinie } from "../src/core/patternGen";
import { liedZuSet, type StemErgebnis } from "../src/core/liedZuSet";
import type { E2StepInput } from "../src/core/electribePatternBuilder";

const SR = 44100;
const TEKK = path.resolve("examples/e2s/tekk4.all");
const tekkDrums = fs.existsSync(TEKK) ? new Uint8Array(fs.readFileSync(TEKK)) : undefined;

describe("bassMitLinie", () => {
  const figur: E2StepInput[] = Array.from({ length: 64 }, (_, s) => (s % 4 === 2 ? { active: true, notes: [60], velocity: 110, gate: 12 } : { active: false }));

  it("jeder Schlag bekommt die Note seines Viertels, Pausen halten die letzte Note", () => {
    // Viertel 0..15: A A E E, dann Pause, dann C …
    const linie = [33, 33, 40, 40, null, null, 36, 36, ...Array(8).fill(null)];
    const out = bassMitLinie(figur, linie);
    expect(out[2].notes).toEqual([57]); // A
    expect(out[10].notes).toEqual([52]); // E
    expect(out[18].notes).toEqual([52]); // Pause: E bleibt
    expect(out[26].notes).toEqual([48]); // C
    expect(out[62].notes).toEqual([48]);
    expect(out.filter((s) => s.active).length).toBe(figur.filter((s) => s.active).length);
    expect(out[0].active).toBe(false);
  });

  it("ohne einzige Note bleibt 60; die Figur wird nicht veraendert", () => {
    const out = bassMitLinie(figur, Array(16).fill(null));
    expect(out[2].notes).toEqual([60]);
    expect(figur[2].notes).toEqual([60]);
  });
});

describe("liedZuSet: Bassline aus dem Bass-Stem", () => {
  function lied(sek = 40, bpm = 180): Float32Array {
    const y = new Float32Array(Math.round(sek * SR));
    const beat = Math.round((60 / bpm) * SR);
    for (let i = 0; i < y.length; i++) y[i] = Math.sin((2 * Math.PI * 220 * i) / SR) * 0.25;
    for (let s = 0; s < y.length; s += beat) for (let i = 0; i < 2000 && s + i < y.length; i++) y[s + i] += Math.sin((2 * Math.PI * 55 * i) / SR) * 0.7 * (1 - i / 2000);
    return y;
  }
  /** Bass-Stem: A (55 Hz) in Takt 1/2, E (82,4 Hz) in Takt 3/4 — je Viertel angeschlagen. */
  function bassStem(frames: number, bpm: number): Float32Array {
    const out = new Float32Array(frames);
    const viertel = (60 / bpm) * SR;
    for (let k = 0; k * viertel < frames; k++) {
      const hz = Math.floor(k / 8) % 2 === 0 ? 55 : 82.41;
      const von = Math.round(k * viertel);
      for (let i = 0; i < viertel && von + i < frames; i++) {
        const t = i / SR;
        out[von + i] = Math.exp(-t * 3) * (0.6 * Math.sin(2 * Math.PI * hz * t) + 0.2 * Math.sin(2 * Math.PI * 2 * hz * t));
      }
    }
    return out;
  }
  const stems = (bpm: number) => (fenster: { id: string; pcm: Float32Array; nurVox: boolean }[]): StemErgebnis[] =>
    fenster.map((f) => ({ id: f.id, melo: f.nurVox ? null : f.pcm, vox: null, drums: null, bass: f.nurVox ? null : bassStem(f.pcm.length, bpm) }));

  it("der Bass-Part spielt die Noten des Originals", () => {
    const bpm = 180;
    const set = liedZuSet(lied(40, bpm), SR, { name: "B", kanaele: 1, tekkDrums, bpm, stems: stems(bpm) });
    const melo = set.projekt.samples.find((s) => s.rolle === "melo")!;
    expect(melo.bassLinie).toBeDefined();
    expect(melo.bassLinie!.slice(0, 8).every((n) => n === 33)).toBe(true);
    expect(melo.bassLinie!.slice(8, 16).every((n) => n === 40)).toBe(true);
    const drop = set.patterns.find((p) => p.name.endsWith("DROP"))!;
    const bass = drop.parts[8];
    const noten = bass.steps.map((s) => (s.active ? s.notes?.[0] : null));
    expect(noten.slice(0, 32).filter((n) => n !== null).every((n) => n === 57)).toBe(true); // A
    expect(noten.slice(32).filter((n) => n !== null).every((n) => n === 52)).toBe(true); // E
    expect(noten.filter((n) => n !== null).length).toBeGreaterThan(4);
  });

  it("ohne Bass-Stem bleibt der Bass auf 60", () => {
    const set = liedZuSet(lied(), SR, { name: "B", kanaele: 1, tekkDrums, bpm: 180 });
    const drop = set.patterns.find((p) => p.name.endsWith("DROP"))!;
    expect(drop.parts[8].steps.filter((s) => s.active).every((s) => (s.notes?.[0] ?? 60) === 60 || (s.notes?.[0] ?? 60) === 55 || (s.notes?.[0] ?? 60) === 67)).toBe(true);
    expect(set.projekt.samples.find((s) => s.rolle === "melo")!.bassLinie).toBeUndefined();
  });
});

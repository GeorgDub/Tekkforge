import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { liedZuSet, type StemErgebnis } from "../src/core/liedZuSet";

const TEKK = path.resolve("examples/e2s/tekk4.all");
const tekkDrums = fs.existsSync(TEKK) ? new Uint8Array(fs.readFileSync(TEKK)) : undefined;

/** Ein Lied bauen: Kick auf jeder Viertel, dazu ein Ton — reicht für die Analyse. */
function liedchen(sekunden = 40, bpm = 180): Float32Array {
  const sr = 44100;
  const y = new Float32Array(Math.round(sekunden * sr));
  const beat = Math.round((60 / bpm) * sr);
  for (let i = 0; i < y.length; i++) y[i] = Math.sin((2 * Math.PI * 220 * i) / sr) * 0.25;
  for (let s = 0; s < y.length; s += beat) {
    for (let i = 0; i < 2000 && s + i < y.length; i++) {
      y[s + i] += Math.sin((2 * Math.PI * 55 * i) / sr) * 0.7 * (1 - i / 2000);
    }
  }
  return y;
}

/** Stem-Trennung vortäuschen: gibt zurück, was hineinkam. */
function stemsAttrappe(mitVox = true) {
  return (fenster: { id: string; pcm: Float32Array; nurVox: boolean }[]): StemErgebnis[] =>
    fenster.map((f) => ({
      id: f.id,
      melo: f.nurVox ? null : f.pcm,
      vox: mitVox ? f.pcm.slice(0, Math.min(f.pcm.length, 44100 * 2)) : null,
      drums: f.nurVox ? null : f.pcm,
    }));
}

describe("liedZuSet", () => {
  const pcm = liedchen();

  it("baut aus einem Lied eine Bank und eine Aufbau-Kette", () => {
    const set = liedZuSet(pcm, 44100, { name: "Testlied", tekkDrums });
    expect(set.projekt.samples.length).toBeGreaterThan(0);
    expect(set.patterns.length).toBeGreaterThan(1);
    expect(set.bank.byteLength).toBeGreaterThan(1000);
    expect(set.patterns.some((p) => p.name.endsWith("DROP"))).toBe(true);
  });

  it("wählt die Tempo-Oktave und legt das Tekk-Tempo fest", () => {
    const set = liedZuSet(pcm, 44100, { name: "T", tekkDrums });
    expect(set.bpm).toBeCloseTo(set.gemessen * set.oktave, 0);
    expect(set.bpm).toBeGreaterThanOrEqual(140);
  });

  it("eine feste BPM-Angabe schlägt die Messung", () => {
    const set = liedZuSet(pcm, 44100, { name: "T", bpm: 200, tekkDrums });
    expect(set.bpm).toBe(200);
    expect(set.patterns[0].bpm).toBe(200);
  });

  it("sagt es, wenn ohne Stems und ohne Drums gebaut wird", () => {
    // Genau die Falle, die im Stapellauf auffiel: aus dem Vollmix entstehen nur
    // Melodie-Fenster, und ohne tekk4 hat der Drop keine Kick.
    const set = liedZuSet(pcm, 44100, { name: "T" });
    expect(set.hinweise.join(" ")).toMatch(/kein Schlagzeug/i);
    expect(set.zaehler.drums).toBe(0);
    expect(set.zaehler.vox).toBe(0);
  });

  it("mit tekk4 hat der Drop ein Schlagzeug", () => {
    const set = liedZuSet(pcm, 44100, { name: "T", tekkDrums });
    const drop = set.patterns.find((p) => p.name.endsWith("DROP"))!;
    expect(drop.parts[0].muted).toBe(false);
    expect(drop.parts[0].steps.filter((s) => s.active).length).toBeGreaterThan(8);
  });

  it("mit Stem-Trennung entstehen eigene Drums und Vocals", () => {
    const set = liedZuSet(pcm, 44100, { name: "T", stems: stemsAttrappe(true) });
    expect(set.zaehler.drums).toBeGreaterThan(0);
    expect(set.zaehler.vox).toBeGreaterThan(0);
    expect(set.projekt.samples.some((s) => s.rolle === "vox")).toBe(true);
    expect(set.projekt.samples.some((s) => s.rolle === "kick")).toBe(true);
  });

  it("ohne erkannte Vocals steht das im Hinweis", () => {
    const set = liedZuSet(pcm, 44100, { name: "T", stems: stemsAttrappe(false) });
    expect(set.zaehler.vox).toBe(0);
    expect(set.hinweise.join(" ")).toMatch(/Vocals/i);
  });

  it("kann auch ein einzelnes Jam-Pattern statt der Kette", () => {
    const set = liedZuSet(pcm, 44100, { name: "T", tekkDrums, aufbau: false });
    expect(set.patterns).toHaveLength(1);
  });

  it("die Sample-Namen bleiben im Geräte-Rahmen", () => {
    const set = liedZuSet(pcm, 44100, { name: "Ein sehr langer Liedname", stems: stemsAttrappe(true) });
    for (const s of set.projekt.samples) expect(s.name.length).toBeLessThanOrEqual(16);
  });
});

import { describe, it, expect } from "vitest";
import { fft, bandEnergien } from "../src/core/dsp";
import { analysiereLied } from "../src/core/liedAnalyse";

const SR = 44100;

/** 60 s bei 95 BPM: Kicks auf jedem Beat, dazu drei Abschnitte mit verschiedener Klangfarbe/Lautstaerke. */
function testLied(): Float32Array {
  const sek = 60;
  const out = new Float32Array(sek * SR);
  const beat = Math.round((60 / 95) * SR);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const abschnitt = t < 20 ? 0 : t < 40 ? 1 : 2; // A leise 200 Hz, B laut 400 Hz + Rauschen, C mittel 800 Hz
    const pegel = [0.12, 0.7, 0.35][abschnitt];
    const f = [200, 400, 800][abschnitt];
    let v = pegel * Math.sin(2 * Math.PI * f * t);
    if (abschnitt === 1) v += 0.25 * (Math.sin(i * 12.9898) * 43758.5453 % 1) - 0.12;
    // Kick: kurzer Impuls mit Tiefton auf jedem Beat, Downbeat lauter
    const inBeat = i % beat;
    if (inBeat < 2000) {
      const amp = (i % (4 * beat) < beat ? 1 : 0.6) * (1 - inBeat / 2000);
      v += amp * 0.8 * Math.sin(2 * Math.PI * 55 * (inBeat / SR));
    }
    out[i] = v;
  }
  return out;
}

describe("dsp", () => {
  it("fft stimmt mit der naiven DFT ueberein (64 Punkte)", () => {
    const n = 64;
    const re = new Float32Array(n).map((_, i) => Math.sin(i * 0.3) + 0.5 * Math.cos(i * 1.1));
    const im = new Float32Array(n);
    const reRef = new Float64Array(n);
    const imRef = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      for (let t = 0; t < n; t++) {
        const w = (-2 * Math.PI * k * t) / n;
        reRef[k] += re[t] * Math.cos(w);
        imRef[k] += re[t] * Math.sin(w);
      }
    }
    fft(re, im);
    for (let k = 0; k < n; k++) {
      expect(Math.abs(re[k] - reRef[k])).toBeLessThan(1e-3);
      expect(Math.abs(im[k] - imRef[k])).toBeLessThan(1e-3);
    }
  });
  it("bandEnergien: 24 Baender, Summe 1, Sinus 200 Hz liegt in den tiefen Baendern", () => {
    const pcm = new Float32Array(SR).map((_, i) => 0.5 * Math.sin((2 * Math.PI * 200 * i) / SR));
    const b = bandEnergien(pcm, SR);
    expect(b.length).toBe(24);
    expect(Math.abs(b.reduce((s, v) => s + v, 0) - 1)).toBeLessThan(1e-3);
    const tief = b.slice(0, 8).reduce((s, v) => s + v, 0);
    expect(tief).toBeGreaterThan(0.6);
  });
});

describe("liedAnalyse", () => {
  const lied = testLied();
  const res = analysiereLied(lied, SR, { zielBpm: 190 });
  it("misst 95 BPM und waehlt Double-Time auf 190", () => {
    expect(Math.abs(res.bpm - 95)).toBeLessThanOrEqual(1);
    expect(res.k).toBe(2);
    expect(Math.abs(res.rate - 1)).toBeLessThan(0.02);
  });
  it("liefert drei 8-Takt-Fenster mit Labels, exakter Laenge und hoerbarem Pegel", () => {
    expect(res.fenster.map((f) => f.label).sort()).toEqual(["BREAK", "DROP", "VAR"]);
    const frames = Math.round((8 * 240) / 190 * SR);
    for (const f of res.fenster) {
      expect(f.pcm.length).toBe(frames);
      expect(f.pegelDb).toBeGreaterThan(-35);
    }
  });
  it("DROP liegt im lauten Abschnitt, BREAK im leisen, VAR anderswo als DROP", () => {
    const drop = res.fenster.find((f) => f.label === "DROP")!;
    const brk = res.fenster.find((f) => f.label === "BREAK")!;
    const varF = res.fenster.find((f) => f.label === "VAR")!;
    expect(drop.startSek).toBeGreaterThanOrEqual(19);
    expect(drop.startSek).toBeLessThan(40);
    expect(brk.pegelDb).toBeLessThan(drop.pegelDb);
    expect(varF.startSek).not.toBe(drop.startSek);
  });
  it("liefert alle hoerbaren 8-Takt-Segmente in Liedreihenfolge, Fenster tragen ihren Segment-Index", () => {
    expect(res.segmente.length).toBeGreaterThan(res.fenster.length);
    const frames = Math.round(((8 * 240) / 190) * SR);
    for (let i = 0; i < res.segmente.length; i++) {
      const s = res.segmente[i];
      expect(s.pegelDb).toBeGreaterThan(-35);
      expect(s.pcm.length).toBe(frames);
      if (i > 0) expect(s.startSek).toBeGreaterThan(res.segmente[i - 1].startSek);
    }
    for (const f of res.fenster) {
      expect(f.index).toBeDefined();
      const seg = res.segmente.find((s) => s.index === f.index)!;
      expect(seg).toBeDefined();
      expect(seg.startSek).toBe(f.startSek);
    }
  });
  it("bpmHinweis uebersteuert die Messung", () => {
    const r2 = analysiereLied(lied, SR, { zielBpm: 180, bpmHinweis: 90 });
    expect(r2.bpm).toBe(90);
    expect(r2.k).toBe(2);
  });
});

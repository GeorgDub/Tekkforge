import { describe, it, expect } from "vitest";
import { bereiteAuf, VARISPEED_MAX, VARISPEED_MIN } from "../src/core/bankPlan";
import { mittleresSpektrum } from "../src/core/dsp";
import type { ScanEintrag } from "../src/core/sampleScan";

const SR = 44100;

/** Vier Takte bei `bpm`: Kick auf jeder Viertel plus ein Ton bei 330 Hz. */
function loop(bpm: number, hz = 330): Float32Array {
  const frames = Math.round(4 * (240 / bpm) * SR);
  const out = new Float32Array(frames);
  const viertel = (60 / bpm) * SR;
  for (let i = 0; i < frames; i++) out[i] = 0.3 * Math.sin((2 * Math.PI * hz * i) / SR);
  for (let b = 0; b * viertel < frames; b++) {
    const s = Math.round(b * viertel);
    for (let k = 0; k < 2000 && s + k < frames; k++) out[s + k] += 0.7 * Math.sin((2 * Math.PI * 60 * k) / SR) * Math.exp(-k / 500);
  }
  return out;
}
const eintrag = (pcm: Float32Array): ScanEintrag =>
  ({ datei: "Loop Melo.wav", stem: "Loop Melo", rolle: "melo", familie: "loop melo", sekunden: pcm.length / SR, rmsDb: -12, peak: 0.7, pcm, sampleRate: SR }) as ScanEintrag;
function spitzeHz(pcm: Float32Array, von = 200, bis = 600): number {
  const s = mittleresSpektrum(pcm, SR, 4096);
  let k = Math.round((von * s.n) / SR);
  for (let i = k; i < (bis * s.n) / SR; i++) if (s.leistung[i] > s.leistung[k]) k = i;
  return (k * SR) / s.n;
}

describe("bereiteAuf: dehnen statt verstimmen jenseits der Varispeed-Grenze", () => {
  it("ein 135-BPM-Vier-Takter in einer 180er-Bank bleibt ein Vier-Takter in Originaltonhoehe", () => {
    // Faktor 1,333 liegt ueber VARISPEED_MAX — vorher wurde das „5 Takte mit 7 % Varispeed“
    expect(180 / 135).toBeGreaterThan(VARISPEED_MAX);
    const t = bereiteAuf(eintrag(loop(135)), 180).teile;
    expect(t).toHaveLength(1);
    expect(t[0].kind).toBe("loop");
    expect(t[0].takte).toBe(4);
    expect(t[0].pcm.length).toBe(Math.round(4 * (240 / 180) * SR));
    expect(Math.abs(spitzeHz(t[0].pcm) - 330)).toBeLessThan(15);
  });

  it("innerhalb der Grenze bleibt es beim Varispeed — die Tonhoehe wandert mit", () => {
    // 170 → 180: Faktor 1,059, innerhalb ±23 %
    expect(180 / 170).toBeLessThan(VARISPEED_MAX);
    expect(180 / 170).toBeGreaterThan(VARISPEED_MIN);
    const t = bereiteAuf(eintrag(loop(170)), 180).teile;
    expect(t[0].kind).toBe("loop");
    expect(t[0].takte).toBe(4);
    expect(spitzeHz(t[0].pcm)).toBeGreaterThan(330 * 1.03);
  });

  it("eine Schleife, die das Raster schon trifft, bleibt unangetastet", () => {
    const t = bereiteAuf(eintrag(loop(180)), 180).teile;
    expect(t[0].takte).toBe(4);
    expect(Math.abs(spitzeHz(t[0].pcm) - 330)).toBeLessThan(5);
  });
});

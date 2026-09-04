import { describe, it, expect } from "vitest";
import { beatRaster } from "../src/core/beatRaster";

const SR = 44100;

/**
 * Klick-Spur mit Tempo-Drift: die Beat-Abstaende wachsen von `bpm0` bis
 * `bpm1` gleichmaessig ueber die Dauer. Downbeat (jeder vierte) mit Bass.
 * Liefert die wahren Beat-Positionen mit.
 */
function drift(bpm0: number, bpm1: number, sek: number): { pcm: Float32Array; beats: number[] } {
  const pcm = new Float32Array(Math.round(sek * SR));
  const beats: number[] = [];
  let t = 0.3 * SR;
  let i = 0;
  while (t < pcm.length - 4000) {
    beats.push(Math.round(t));
    const amp = i % 4 === 0 ? 0.9 : 0.6;
    const hz = i % 4 === 0 ? 55 : 180;
    for (let k = 0; k < 3000; k++) pcm[Math.round(t) + k] += amp * Math.sin((2 * Math.PI * hz * k) / SR) * Math.exp(-k / 600);
    const bpm = bpm0 + ((bpm1 - bpm0) * t) / pcm.length;
    t += (60 / bpm) * SR;
    i++;
  }
  return { pcm, beats };
}

describe("beatRaster", () => {
  it("folgt einem Lied, das treibt — das starre Lineal nicht", () => {
    const { pcm, beats } = drift(120, 124, 60);
    const r = beatRaster(pcm, SR, 120);
    expect(r.beats.length).toBeGreaterThan(beats.length - 6);
    expect(r.beats.length).toBeLessThan(beats.length + 6);
    // jeder spaete wahre Beat hat einen gefundenen Beat in 20 ms Naehe
    const spaete = beats.slice(-16);
    for (const b of spaete) {
      const naechster = r.beats.reduce((a, x) => (Math.abs(x - b) < Math.abs(a - b) ? x : a), r.beats[0]);
      expect(Math.abs(naechster - b) / SR, `Beat bei ${(b / SR).toFixed(2)} s`).toBeLessThan(0.02);
    }
    // das starre Raster (120 BPM ab dem ersten Beat) liegt am Ende deutlich daneben
    const linealEnde = beats[0] + (spaete.length ? beats.length - 1 : 0) * (60 / 120) * SR;
    expect(Math.abs(linealEnde - beats[beats.length - 1]) / SR).toBeGreaterThan(0.1);
    expect(r.drift).toBeGreaterThan(0);
    expect(r.belegt).toBeGreaterThan(0.6);
  });

  it("gerade Spur: Beats auf den Klicks, Downbeats auf den Bass-Schlaegen, Drift nahe 0", () => {
    const { pcm, beats } = drift(120, 120, 30);
    const r = beatRaster(pcm, SR, 120);
    for (const b of beats.slice(2, -2)) {
      const naechster = r.beats.reduce((a, x) => (Math.abs(x - b) < Math.abs(a - b) ? x : a), r.beats[0]);
      expect(Math.abs(naechster - b) / SR).toBeLessThan(0.02);
    }
    expect(r.drift).toBeLessThan(3);
    // Downbeats: jeder vierte, und zwar die mit Bass (i % 4 === 0)
    const wahreDown = beats.filter((_, i) => i % 4 === 0);
    let treffer = 0;
    for (const d of r.downbeats) if (wahreDown.some((w) => Math.abs(w - d) / SR < 0.03)) treffer++;
    expect(treffer / Math.max(1, r.downbeats.length)).toBeGreaterThan(0.8);
  });

  it("Stille ergibt kein Raster", () => {
    const r = beatRaster(new Float32Array(SR * 5), SR, 120);
    expect(r.belegt).toBe(0);
    expect(beatRaster(new Float32Array(0), SR, 120).beats).toEqual([]);
  });
});

import { describe, it, expect } from "vitest";
import { meloRaster, stabAusRaster, bassAnMelo } from "../src/core/meloRaster";
import type { E2StepInput } from "../src/core/electribePatternBuilder";

const SR = 44100;
const BPM = 180;
const stepFrames = Math.round(((240 / BPM) * SR) / 16);

/** 4-Takt-Loop mit 800-Hz-Anschlaegen auf den angegebenen Steps. */
function synthMelo(onsetSteps: number[]): Float32Array {
  const pcm = new Float32Array(stepFrames * 64);
  for (const s of onsetSteps) {
    const start = s * stepFrames;
    for (let i = 0; i < 3000; i++) pcm[start + i] = Math.sin((2 * Math.PI * 800 * i) / SR) * 0.8 * Math.exp(-i / 900);
  }
  return pcm;
}

describe("meloRaster", () => {
  it("Onsets landen auf den richtigen Steps, Rest bleibt leise", () => {
    const steps = [0, 6, 16, 22, 32, 38, 48, 54];
    const r = meloRaster(synthMelo(steps), SR, 4);
    expect(r.onset).toHaveLength(64);
    for (const s of steps) expect(r.onset[s]).toBeGreaterThan(0.5);
    for (let s = 0; s < 64; s++) {
      if (!steps.includes(s)) expect(r.onset[s]).toBeLessThan(0.35);
    }
  });
  it("Bassanteil: tiefe Haelfte hoch, hohe Haelfte niedrig", () => {
    const pcm = new Float32Array(stepFrames * 64);
    for (let i = 0; i < stepFrames * 32; i++) pcm[i] = Math.sin((2 * Math.PI * 60 * i) / SR) * 0.5;
    for (let i = stepFrames * 32; i < pcm.length; i++) pcm[i] = Math.sin((2 * Math.PI * 2000 * i) / SR) * 0.5;
    const r = meloRaster(pcm, SR, 4);
    expect(r.bass[4]).toBeGreaterThan(0.7);
    expect(r.bass[40]).toBeLessThan(0.2);
  });
  it("8-Takt-Loop wird per Maximum auf 64 Steps gefaltet", () => {
    const acht = new Float32Array(stepFrames * 128);
    const start = 70 * stepFrames; // Step 70 → faellt auf Raster-Step 6
    for (let i = 0; i < 3000; i++) acht[start + i] = Math.sin((2 * Math.PI * 800 * i) / SR) * 0.8 * Math.exp(-i / 900);
    const r = meloRaster(acht, SR, 8);
    expect(r.onset[6]).toBeCloseTo(1, 2);
  });
  it("stabAusRaster: hoechstens 6 Hits, genau auf den staerksten Onsets", () => {
    const steps = [0, 6, 16, 22, 32, 38, 48, 54];
    const r = meloRaster(synthMelo(steps), SR, 4);
    const st = stabAusRaster(r);
    const aktiv = st.map((x, s) => (x.active ? s : -1)).filter((s) => s >= 0);
    expect(aktiv.length).toBeLessThanOrEqual(6);
    expect(aktiv.length).toBeGreaterThan(0);
    for (const s of aktiv) expect(steps).toContain(s);
    for (const s of aktiv) expect(st[s].velocity).toBeGreaterThanOrEqual(80);
  });
  it("bassAnMelo: Hits auf Melo-Bass-Steps entfallen; leer wird nie", () => {
    const raster = { onset: new Array(64).fill(0), bass: new Array(64).fill(0) };
    for (let s = 0; s < 32; s++) raster.bass[s] = 0.9;
    const figur: E2StepInput[] = Array.from({ length: 64 }, (_, s) => (s % 4 === 2 ? { active: true, notes: [60], velocity: 110, gate: 12 } : { active: false }));
    const out = bassAnMelo(figur, raster);
    for (let s = 0; s < 32; s++) expect(out[s].active).toBe(false);
    expect(out.slice(32).filter((x) => x.active).length).toBe(8);
    // alles voll Bass → Figur bleibt unveraendert statt leer
    const vollBass = { onset: raster.onset, bass: new Array(64).fill(0.9) };
    expect(bassAnMelo(figur, vollBass)).toEqual(figur);
  });
});

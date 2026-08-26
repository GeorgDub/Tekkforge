import { describe, it, expect } from "vitest";
import { grooveAusAudio } from "../src/core/grooveAusLied";
import { TRIGGER_MAX } from "../src/core/e2Groove";

const SR = 44100;

/**
 * Baut ein Schlagzeug-Raster: `versatzProStep[i]` verschiebt den i-ten 16tel
 * um so viele Frames. So laesst sich pruefen, ob die Messung genau das findet.
 */
function raster(bpm: number, steps: number, versatzProStep: number[], pegel: number[] = []): Float32Array {
  const stepFrames = (60 / bpm / 4) * SR;
  const out = new Float32Array(Math.round(steps * stepFrames) + SR);
  for (let i = 0; i < steps; i++) {
    const start = Math.round(i * stepFrames + (versatzProStep[i] ?? 0));
    const amp = pegel[i] ?? 0.9;
    if (amp <= 0) continue;
    // kurzer Schlag: Tiefton mit schneller Huellkurve
    for (let k = 0; k < 3000 && start + k < out.length; k++) {
      out[start + k] += amp * Math.sin((2 * Math.PI * 90 * k) / SR) * Math.exp(-k / 700);
    }
  }
  return out;
}

describe("grooveAusLied", () => {
  it("gerades Raster ergibt eine Vorlage ohne Versatz", () => {
    const pcm = raster(120, 32, []);
    const r = grooveAusAudio(pcm, SR, { bpm: 120 });
    expect(r.groove.steps).toHaveLength(64);
    // die ersten 16 Steps sind belegt und liegen auf dem Raster
    for (let i = 0; i < 16; i++) {
      expect(Math.abs(r.groove.steps[i].trigger), `Step ${i}`).toBeLessThanOrEqual(3);
    }
    expect(r.belegteSteps).toBeGreaterThan(8);
  });

  it("erkennt Swing: jeder zweite Schlag liegt spaeter", () => {
    const stepFrames = (60 / 120 / 4) * SR;
    const versatz = Array.from({ length: 32 }, (_, i) => (i % 2 === 1 ? Math.round(stepFrames * 0.25) : 0));
    const r = grooveAusAudio(raster(120, 32, versatz), SR, { bpm: 120 });
    // 0,25 Step = 24 von 96 Einheiten (48 = halber Step)
    expect(r.groove.steps[1].trigger).toBeGreaterThan(14);
    expect(r.groove.steps[1].trigger).toBeLessThan(34);
    expect(Math.abs(r.groove.steps[0].trigger)).toBeLessThanOrEqual(4);
    expect(r.groove.steps[3].trigger).toBeGreaterThan(14);
  });

  it("erkennt einen Schlag VOR dem Raster als negativen Versatz", () => {
    const stepFrames = (60 / 120 / 4) * SR;
    const versatz = Array.from({ length: 32 }, (_, i) => (i === 4 ? -Math.round(stepFrames * 0.2) : 0));
    const r = grooveAusAudio(raster(120, 32, versatz), SR, { bpm: 120 });
    expect(r.groove.steps[4].trigger).toBeLessThan(-8);
  });

  it("Versatz bleibt im erlaubten Bereich", () => {
    const stepFrames = (60 / 120 / 4) * SR;
    const versatz = Array.from({ length: 32 }, () => Math.round(stepFrames * 0.9));
    const r = grooveAusAudio(raster(120, 32, versatz), SR, { bpm: 120 });
    for (const s of r.groove.steps) {
      expect(s.trigger).toBeGreaterThanOrEqual(-TRIGGER_MAX);
      expect(s.trigger).toBeLessThanOrEqual(TRIGGER_MAX);
    }
  });

  it("uebernimmt die Anschlagstaerke: lauter Schlag hoehere Velocity", () => {
    const pegel = Array.from({ length: 32 }, (_, i) => (i % 4 === 0 ? 0.95 : 0.25));
    const r = grooveAusAudio(raster(120, 32, [], pegel), SR, { bpm: 120 });
    expect(r.groove.steps[0].velocity).toBeGreaterThan(r.groove.steps[1].velocity);
    for (const s of r.groove.steps) {
      expect(s.velocity).toBeGreaterThanOrEqual(0);
      expect(s.velocity).toBeLessThanOrEqual(127);
    }
  });

  it("Steps ohne Schlag behalten Standardwerte und zaehlen nicht als belegt", () => {
    // nur jeder vierte Step hat einen Schlag
    const pegel = Array.from({ length: 32 }, (_, i) => (i % 4 === 0 ? 0.9 : 0));
    const r = grooveAusAudio(raster(120, 32, [], pegel), SR, { bpm: 120 });
    expect(r.groove.steps[1].trigger).toBe(0);
    expect(r.groove.steps[1].velocity).toBe(0x60);
    expect(r.belegteSteps).toBeLessThanOrEqual(16);
    expect(r.belegteSteps).toBeGreaterThanOrEqual(4);
  });

  it("misst das Tempo selbst, wenn keines vorgegeben ist", () => {
    const r = grooveAusAudio(raster(150, 64, []), SR, {});
    expect(r.bpm).toBeGreaterThan(100);
    expect(r.bpm).toBeLessThan(200);
    expect(r.groove.name.length).toBeGreaterThan(0);
  });

  it("zu kurzes oder stilles Audio ergibt eine leere Vorlage statt eines Fehlers", () => {
    const r = grooveAusAudio(new Float32Array(1000), SR, { bpm: 120 });
    expect(r.belegteSteps).toBe(0);
    expect(r.groove.steps).toHaveLength(64);
    expect(r.groove.steps.every((s) => s.trigger === 0)).toBe(true);
  });
});

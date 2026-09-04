import { describe, it, expect } from "vitest";
import { swingAusGroove, grooveFuerLied, mitSwing, SWING_MINDESTENS } from "../src/core/grooveAnschluss";
import { initGrooveBytes, decodeGroove, setzeSwing, type Groove } from "../src/core/e2Groove";
import type { E2PatternInput } from "../src/core/electribePatternBuilder";

const SR = 44100;

/** Schlagzeug-Raster wie im grooveAusLied-Test: Versatz je 16tel in Frames. */
function raster(bpm: number, steps: number, versatzProStep: number[]): Float32Array {
  const stepFrames = (60 / bpm / 4) * SR;
  const out = new Float32Array(Math.round(steps * stepFrames) + SR);
  for (let i = 0; i < steps; i++) {
    const start = Math.round(i * stepFrames + (versatzProStep[i] ?? 0));
    for (let k = 0; k < 3000 && start + k < out.length; k++) out[start + k] += 0.9 * Math.sin((2 * Math.PI * 90 * k) / SR) * Math.exp(-k / 700);
  }
  return out;
}

describe("grooveAnschluss", () => {
  it("swingAusGroove: 24 Einheiten auf den ungeraden Steps sind 25 %", () => {
    const g: Groove = decodeGroove(initGrooveBytes());
    setzeSwing(g, 24);
    expect(swingAusGroove(g)).toBe(25);
    setzeSwing(g, 48);
    expect(swingAusGroove(g)).toBe(50);
  });

  it("swingAusGroove: Rauschen unter der Schwelle bleibt gerade, ohne belegte Steps 0", () => {
    const g: Groove = decodeGroove(initGrooveBytes());
    setzeSwing(g, 1);
    expect(SWING_MINDESTENS).toBeGreaterThan(1);
    expect(swingAusGroove(g)).toBe(0);
    const leer: Groove = { name: "x", laenge: 16, steps: Array.from({ length: 64 }, () => ({ trigger: 0, velocity: 0x60, gate: 0x60 })) };
    expect(swingAusGroove(leer)).toBe(0);
  });

  it("grooveFuerLied: ein Lied mit spaeten Offbeats ergibt positiven Swing", () => {
    const stepFrames = (60 / 120 / 4) * SR;
    const versatz = Array.from({ length: 64 }, (_, i) => (i % 2 === 1 ? Math.round(stepFrames * 0.25) : 0));
    const r = grooveFuerLied(raster(120, 64, versatz), SR, 120, "Testlied mit langem Namen");
    expect(r.swing).toBeGreaterThanOrEqual(15);
    expect(r.swing).toBeLessThanOrEqual(35);
    expect(r.groove.laenge).toBe(16);
    expect(r.groove.name.length).toBeLessThanOrEqual(15);
    expect(r.belegteSteps).toBeGreaterThan(8);
  });

  it("grooveFuerLied: gerades Raster bleibt gerade", () => {
    const r = grooveFuerLied(raster(120, 64, []), SR, 120, "gerade");
    expect(r.swing).toBe(0);
  });

  it("mitSwing legt den Wert auf jedes Pattern, 0 laesst alles unveraendert", () => {
    const p: E2PatternInput[] = [
      { name: "a", bpm: 180, stepLength: 64, parts: [] },
      { name: "b", bpm: 180, stepLength: 64, parts: [] },
    ];
    expect(mitSwing(p, 0)).toBe(p);
    const s = mitSwing(p, 23.6);
    expect(s.map((x) => x.swing)).toEqual([24, 24]);
    expect(mitSwing(p, 90)[0].swing).toBe(50);
    expect(mitSwing(p, -90)[0].swing).toBe(-50);
    expect(p[0].swing).toBeUndefined();
  });
});

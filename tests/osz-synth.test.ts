import { describe, it, expect } from "vitest";
import { oszPcm, oszSample } from "../src/core/oszSynth";
import { rendere } from "../src/core/patternRender";
import { createPattern } from "../src/core/editorModel";

const rms = (p: Float32Array): number => Math.sqrt(p.reduce((a, x) => a + x * x, 0) / p.length);
/** Grundfrequenz per Nulldurchgaengen im mittleren Teil. */
function grundHz(p: Float32Array, sr = 44100): number {
  const von = Math.round(sr * 0.5);
  const bis = Math.round(sr * 1.5);
  let wechsel = 0;
  for (let i = von + 1; i < bis; i++) if (p[i - 1] <= 0 && p[i] > 0) wechsel++;
  return wechsel / ((bis - von) / sr);
}

describe("oszSynth — Ersatzklaenge fuer Synth-Oszillatoren", () => {
  it("Analog: SAW, PULSE, TRIANGLE, SINE klingen auf C4; Audio In ist still; Noise rauscht", () => {
    for (const n of ["SAW", "PULSE", "TRIANGLE", "SINE", "UNI-SAW", "OCT-SQU", "RING-TRI", "CHIP-PULSE"]) {
      const p = oszPcm(n, "Analog");
      expect(p).toHaveLength(88200);
      expect(rms(p), n).toBeGreaterThan(0.1);
    }
    expect(Math.abs(grundHz(oszPcm("SAW", "Analog")) - 261.6)).toBeLessThan(3);
    expect(Math.abs(grundHz(oszPcm("SINE", "Analog")) - 261.6)).toBeLessThan(3);
    expect(rms(oszPcm("Audio In Mn", "Audio In"))).toBe(0);
    expect(rms(oszPcm("LPF NOISE", "Analog"))).toBeGreaterThan(0.02);
    expect(rms(oszPcm("HPF NOISE", "Analog"))).toBeGreaterThan(0.02);
  });

  it("FM und VPM: nach Name geformt, hoerbar, verschieden", () => {
    const a = oszPcm("X-SAW -24", "FM");
    const b = oszPcm("X-SAW +7", "FM");
    const v = oszPcm("VPM-SINE 32", "VPM");
    expect(rms(a)).toBeGreaterThan(0.1);
    expect(rms(v)).toBeGreaterThan(0.1);
    let diff = 0;
    for (let i = 0; i < 5000; i++) diff += Math.abs(a[i] - b[i]);
    expect(diff).toBeGreaterThan(50);
  });

  it("oszSample: aus der Liste, mit Cache; unbekannte Nummer null", () => {
    const s = oszSample(35, "tekkforge");
    expect(s).toMatchObject({ number: 35, name: "X-SAW -24", sampleRate: 44100 });
    expect(oszSample(35, "tekkforge")).toBe(s);
    expect(oszSample(36, "hacktribe")?.name).toBe("X-SAW -20");
    expect(oszSample(400, "tekkforge")).toBeNull();
  });

  it("rendere spielt einen Part mit Oszillator-Nummer ohne Pool-Sample", () => {
    const p = createPattern("OSZ");
    p.bpm = 120;
    p.stepLength = 16;
    p.parts[0].sampleNumber = 1;
    p.parts[0].muted = false;
    p.parts[0].steps[0].on = true;
    p.parts[0].steps[0].velocity = 127;
    const r = rendere(p, [], { ausklang: 0.1 });
    expect(rms(r.pcm.subarray(0, 8000))).toBeGreaterThan(0.05);
    // ohne Oszillator-Nummer bleibt es still
    p.parts[0].sampleNumber = 900;
    expect(rms(rendere(p, [], { ausklang: 0.1 }).pcm.subarray(0, 8000))).toBe(0);
  });
});

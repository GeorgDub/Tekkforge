import { describe, it, expect } from "vitest";
import { rateFuer, rolloffHz, RATE_HALB, RATE_VOLL, ROLLOFF_GRENZE_HZ } from "../src/core/rateWahl";

const SR = 44100;
const sinus = (hz: number, sek = 1): Float32Array => new Float32Array(Math.round(sek * SR)).map((_, i) => 0.8 * Math.sin((2 * Math.PI * hz * i) / SR));
function rauschen(sek = 1, startwert = 3): Float32Array {
  let z = startwert;
  return new Float32Array(Math.round(sek * SR)).map(() => {
    z = (z * 1664525 + 1013904223) >>> 0;
    return (z / 4294967296) * 1.6 - 0.8;
  });
}

describe("rateWahl", () => {
  it("rolloffHz: ein tiefer Ton liegt tief, weisses Rauschen hoch, Stille 0", () => {
    expect(rolloffHz(sinus(200), SR)).toBeLessThan(600);
    expect(rolloffHz(rauschen(), SR)).toBeGreaterThan(15000);
    expect(rolloffHz(new Float32Array(SR), SR)).toBe(0);
    expect(rolloffHz(new Float32Array(100), SR)).toBe(0);
  });

  it("rateFuer: dunkles Material halbiert, helles bleibt voll, Stille bleibt voll", () => {
    expect(rateFuer(sinus(200), SR, "bass")).toBe(RATE_HALB);
    expect(rateFuer(sinus(60), SR, "kick")).toBe(RATE_HALB);
    expect(rateFuer(rauschen(), SR, "fx")).toBe(RATE_VOLL);
    expect(rateFuer(new Float32Array(SR), SR, "melo")).toBe(RATE_VOLL);
  });

  it("Hats, Snare und Clap bleiben immer voll — auch wenn die Messung anders saehe", () => {
    expect(rateFuer(sinus(200), SR, "hat")).toBe(RATE_VOLL);
    expect(rateFuer(sinus(200), SR, "snare")).toBe(RATE_VOLL);
    expect(rateFuer(sinus(200), SR, "clap")).toBe(RATE_VOLL);
  });

  it("sparsameVocals schlaegt die Messung fuer Vocals; messen: false laesst nur den Wunsch gelten", () => {
    expect(rateFuer(rauschen(), SR, "vox", { sparsameVocals: true })).toBe(RATE_HALB);
    expect(rateFuer(sinus(200), SR, "vox", { messen: false })).toBe(RATE_VOLL);
    expect(rateFuer(sinus(200), SR, "vox", { messen: false, sparsameVocals: true })).toBe(RATE_HALB);
  });

  it("die Grenze ist einstellbar", () => {
    const hz = rolloffHz(sinus(200), SR);
    expect(hz).toBeGreaterThan(0);
    expect(rateFuer(sinus(200), SR, "bass", { grenzeHz: hz / 2 })).toBe(RATE_VOLL);
    expect(ROLLOFF_GRENZE_HZ).toBe(9000);
  });
});

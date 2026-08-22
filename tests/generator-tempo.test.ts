import { describe, it, expect } from "vitest";
import { taktPassung, tempoSchaetzen, tempoVorschlag, onsetKurve } from "../src/core/tempoAnalyse";

function klickspur(bpm: number, sekunden: number, sr = 22050): Float32Array {
  const out = new Float32Array(Math.round(sekunden * sr));
  const beat = Math.round((60 / bpm) * sr);
  for (let i = 0; i < out.length; i += beat) {
    for (let k = 0; k < 200 && i + k < out.length; k++) out[i + k] = (1 - k / 200) * (i % (4 * beat) === 0 ? 1 : 0.5);
  }
  return out;
}

describe("tempoAnalyse", () => {
  it("taktPassung: 5.333 s bei 180 BPM sind exakt 4 Takte", () => {
    const p = taktPassung(5.3333, 180);
    expect(p.takte).toBe(4);
    expect(p.abweichung).toBeLessThan(0.001);
  });
  it("taktPassung: 10.67 s bei 180 sind 8 Takte, 5.86 s sind 4 Takte mit ~10 % Abweichung", () => {
    expect(taktPassung(10.67, 180).takte).toBe(8);
    const p = taktPassung(5.86, 180);
    expect(p.takte).toBe(4);
    expect(p.abweichung).toBeGreaterThan(0.09);
    expect(p.abweichung).toBeLessThan(0.11);
  });
  it("onsetKurve hat einen Wert je Hop", () => {
    const y = klickspur(180, 2);
    expect(onsetKurve(y, 22050, 256).length).toBe(Math.floor(y.length / 256));
  });
  it("tempoSchaetzen findet 180 auf einer Klickspur (±1)", () => {
    expect(Math.abs(tempoSchaetzen(klickspur(180, 12), 22050) - 180)).toBeLessThanOrEqual(1);
  });
  it("tempoSchaetzen findet 95 oder 190 auf einer 95er-Spur", () => {
    const t = tempoSchaetzen(klickspur(95, 16), 22050);
    expect([95, 190].some((k) => Math.abs(t - k) <= 1)).toBe(true);
  });
  it("tempoVorschlag: lauter 5.333-s-Loops → 180", () => {
    expect(tempoVorschlag([5.333, 10.667, 5.333, 2.667])).toBe(180);
  });
  it("tempoVorschlag: 5.486-s-Loops → 175", () => {
    expect(tempoVorschlag([5.486, 5.486, 10.971])).toBe(175);
  });
  it("tempoVorschlag ohne Treffer → 180", () => {
    expect(tempoVorschlag([0.3, 0.2])).toBe(180);
  });
});

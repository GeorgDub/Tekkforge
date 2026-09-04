import { describe, it, expect } from "vitest";
import { timeStretch, stretchAufLaenge } from "../src/core/timeStretch";
import { mittleresSpektrum } from "../src/core/dsp";

const SR = 44100;
const ton = (hz: number, sek: number): Float32Array => new Float32Array(Math.round(sek * SR)).map((_, i) => 0.7 * Math.sin((2 * Math.PI * hz * i) / SR));
function spitzeHz(pcm: Float32Array): number {
  const s = mittleresSpektrum(pcm, SR, 4096);
  let k = 1;
  for (let i = 2; i < s.n / 2; i++) if (s.leistung[i] > s.leistung[k]) k = i;
  return (k * SR) / s.n;
}
function klicks(bpm: number, sek: number): Float32Array {
  const out = new Float32Array(Math.round(sek * SR));
  const beat = (60 / bpm) * SR;
  for (let b = 0; b * beat < out.length; b++) {
    const s = Math.round(b * beat);
    for (let k = 0; k < 1500 && s + k < out.length; k++) out[s + k] += 0.9 * Math.sin((2 * Math.PI * 200 * k) / SR) * Math.exp(-k / 300);
  }
  return out;
}
function schlaege(pcm: Float32Array): number[] {
  const out: number[] = [];
  let ruhe = 0;
  for (let i = 0; i < pcm.length; i++) {
    if (Math.abs(pcm[i]) > 0.4 && ruhe > 2000) out.push(i);
    if (Math.abs(pcm[i]) > 0.4) ruhe = 0;
    else ruhe++;
  }
  return out;
}

describe("timeStretch", () => {
  it("dehnt auf die Ziellaenge und behaelt die Tonhoehe", () => {
    const q = ton(220, 2);
    const y = timeStretch(q, 1.3);
    expect(y.length).toBe(Math.round(q.length * 1.3));
    expect(Math.abs(spitzeHz(y) - 220)).toBeLessThan(12);
    const kurz = timeStretch(q, 0.7);
    expect(kurz.length).toBe(Math.round(q.length * 0.7));
    expect(Math.abs(spitzeHz(kurz) - 220)).toBeLessThan(12);
    // Pegel bleibt in der Naehe (kein Ueberblend-Loch, keine Verdopplung)
    let peak = 0;
    for (const v of y) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeGreaterThan(0.5);
    expect(peak).toBeLessThan(0.9);
  });

  it("eine Klick-Spur behaelt ihre Schlaege, nur weiter auseinander", () => {
    const q = klicks(120, 4);
    const y = timeStretch(q, 1.25);
    const vorher = schlaege(q);
    const nachher = schlaege(y);
    expect(Math.abs(nachher.length - vorher.length)).toBeLessThanOrEqual(1);
    // Abstand der Schlaege um den Faktor gedehnt (±10 %)
    const abstand = (s: number[]) => (s[s.length - 1] - s[0]) / (s.length - 1);
    expect(abstand(nachher) / abstand(vorher)).toBeGreaterThan(1.12);
    expect(abstand(nachher) / abstand(vorher)).toBeLessThan(1.38);
  });

  it("Faktor 1 gibt eine Kopie zurueck, unmoegliche Faktoren werfen", () => {
    const q = ton(100, 0.5);
    const y = timeStretch(q, 1);
    expect(y).not.toBe(q);
    expect([...y.subarray(0, 100)]).toEqual([...q.subarray(0, 100)]);
    expect(() => timeStretch(q, 0)).toThrow();
    expect(() => timeStretch(q, Number.NaN)).toThrow();
  });

  it("stretchAufLaenge trifft die Bildzahl exakt", () => {
    expect(stretchAufLaenge(ton(220, 1), 60000).length).toBe(60000);
    expect(stretchAufLaenge(ton(220, 1), 30000).length).toBe(30000);
    expect(stretchAufLaenge(new Float32Array(0), 100).length).toBe(100);
  });
});

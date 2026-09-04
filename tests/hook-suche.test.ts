import { describe, it, expect } from "vitest";
import { hookFenster, taktChromas, fensterAehnlichkeit } from "../src/core/hookSuche";

const SR = 44100;
const BPM = 180;
const takt = (240 / BPM) * SR;

/** Ein Takt mit vier Toenen aus einer Akkordfolge — jede Folge klingt anders. */
function taktMit(noten: number[]): Float32Array {
  const out = new Float32Array(Math.round(takt));
  const viertel = out.length / 4;
  for (let i = 0; i < out.length; i++) {
    const n = noten[Math.min(3, Math.floor(i / viertel))];
    const hz = 440 * Math.pow(2, (n - 69) / 12);
    out[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / SR) + 0.2 * Math.sin((2 * Math.PI * 2 * hz * i) / SR);
  }
  return out;
}
function fenster(folge: number[][]): Float32Array {
  const teile = folge.map(taktMit);
  const out = new Float32Array(teile.reduce((n, t) => n + t.length, 0));
  let p = 0;
  for (const t of teile) {
    out.set(t, p);
    p += t.length;
  }
  return out;
}
const A = [
  [57, 60, 64, 57],
  [55, 59, 62, 55],
  [53, 57, 60, 53],
  [52, 55, 59, 52],
];
const B = [
  [60, 64, 67, 60],
  [62, 65, 69, 62],
  [64, 67, 71, 64],
  [65, 69, 72, 65],
];
const C = [
  [61, 64, 68, 61],
  [58, 62, 65, 58],
  [63, 66, 70, 63],
  [56, 60, 63, 56],
];

describe("hookSuche", () => {
  it("taktChromas: ein Takt je Takt, zwoelf Klassen; gleiche Takte sind sich aehnlich, andere nicht", () => {
    const a = taktChromas(fenster(A), SR, BPM);
    expect(a).toHaveLength(4);
    expect(a[0]).toHaveLength(12);
    expect(fensterAehnlichkeit(a, taktChromas(fenster(A), SR, BPM))).toBeGreaterThan(0.99);
    expect(fensterAehnlichkeit(a, taktChromas(fenster(C), SR, BPM))).toBeLessThan(0.9);
  });

  it("der Hook ist das Fenster, das am oeftesten wiederkehrt — Struktur A B A C A", () => {
    const h = hookFenster([fenster(A), fenster(B), fenster(A), fenster(C), fenster(A)], SR, BPM);
    expect(h).toEqual({ index: 0, wiederholungen: 2 });
  });

  it("ohne Wiederholung kein Hook; ein einzelnes Fenster auch nicht", () => {
    expect(hookFenster([fenster(A), fenster(B), fenster(C)], SR, BPM)).toBeNull();
    expect(hookFenster([fenster(A)], SR, BPM)).toBeNull();
  });
});

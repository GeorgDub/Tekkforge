import { describe, it, expect } from "vitest";
import {
  schneide,
  blenden,
  normalisiere,
  umkehren,
  wellenform,
  stilleGrenzen,
  pruefeLoop,
  LOOP_AUS,
  LOOP_VORWAERTS,
} from "../src/core/sampleEdit";

const SR = 44100;
/** Rampe 0..1 ueber n Frames — Werte sind an jeder Stelle nachrechenbar. */
const rampe = (n: number) => new Float32Array(n).map((_, i) => i / (n - 1));

describe("sampleEdit", () => {
  it("schneide: nimmt genau den gewaehlten Bereich, Grenzen werden geklemmt", () => {
    const p = rampe(100);
    const s = schneide(p, 20, 30);
    expect(s.length).toBe(10);
    expect(s[0]).toBeCloseTo(20 / 99, 5);
    expect(s[9]).toBeCloseTo(29 / 99, 5);
    // ausserhalb: klemmt statt zu werfen
    expect(schneide(p, -50, 500).length).toBe(100);
    // von >= bis ergibt mindestens einen Frame
    expect(schneide(p, 60, 60).length).toBe(1);
  });

  it("blenden: Anfang steigt von null, Ende faellt auf null", () => {
    const p = new Float32Array(1000).fill(1);
    const b = blenden(p, 10, 10, SR); // 10 ms = 441 Frames
    expect(b[0]).toBe(0);
    expect(b[b.length - 1]).toBe(0);
    expect(b[500]).toBe(1); // Mitte unberuehrt
    // monoton steigend im Einblendbereich
    expect(b[100]).toBeLessThan(b[300]);
  });

  it("blenden: laenger als das Sample wird gekuerzt, nicht verrechnet", () => {
    const p = new Float32Array(100).fill(1);
    const b = blenden(p, 1000, 1000, SR);
    expect(b.length).toBe(100);
    expect(b.every((v) => v >= 0 && v <= 1)).toBe(true);
  });

  it("normalisiere: hebt den lautesten Punkt auf den Zielpegel", () => {
    const p = new Float32Array([0.1, -0.25, 0.2]);
    const n = normalisiere(p, 0.95);
    expect(Math.max(...Array.from(n).map(Math.abs))).toBeCloseTo(0.95, 5);
    // Verhaeltnisse bleiben erhalten
    expect(n[0] / n[2]).toBeCloseTo(0.1 / 0.2, 5);
    // Stille bleibt Stille (keine Division durch null)
    expect(Array.from(normalisiere(new Float32Array(10), 0.95))).toEqual(Array(10).fill(0));
  });

  it("umkehren: dreht die Reihenfolge, laesst die Laenge", () => {
    const u = umkehren(rampe(5));
    expect(u[0]).toBeCloseTo(1, 5);
    expect(u[4]).toBeCloseTo(0, 5);
    expect(u.length).toBe(5);
  });

  it("wellenform: je Spalte der tiefste und hoechste Wert", () => {
    const p = new Float32Array([1, -1, 0.5, -0.5, 0.25, -0.25, 0, 0]);
    const w = wellenform(p, 4);
    expect(w.min).toHaveLength(4);
    expect(w.max).toHaveLength(4);
    expect(w.max[0]).toBeCloseTo(1, 5);
    expect(w.min[0]).toBeCloseTo(-1, 5);
    expect(w.max[3]).toBeCloseTo(0, 5);
    // mehr Spalten als Frames: keine Luecken, keine Ausnahme
    const fein = wellenform(new Float32Array([1, -1]), 8);
    expect(fein.min).toHaveLength(8);
  });

  it("stilleGrenzen: findet den hoerbaren Bereich", () => {
    const p = new Float32Array(1000);
    for (let i = 300; i < 700; i++) p[i] = 0.8;
    const g = stilleGrenzen(p, 40);
    expect(g.von).toBeGreaterThanOrEqual(295);
    expect(g.von).toBeLessThanOrEqual(300);
    expect(g.bis).toBeGreaterThanOrEqual(700);
    expect(g.bis).toBeLessThanOrEqual(705);
    // durchgehend still: ganzer Bereich, damit nichts verschwindet
    const still = stilleGrenzen(new Float32Array(500), 40);
    expect(still).toEqual({ von: 0, bis: 500 });
  });

  it("pruefeLoop: Start vor Ende, innerhalb des Samples", () => {
    expect(pruefeLoop(0, 100, 100)).toEqual({ ok: true });
    expect(pruefeLoop(50, 100, 100).ok).toBe(true);
    expect(pruefeLoop(100, 100, 100).ok).toBe(false);
    expect(pruefeLoop(-1, 50, 100).ok).toBe(false);
    expect(pruefeLoop(0, 101, 100).ok).toBe(false);
    const f = pruefeLoop(80, 20, 100);
    expect(f.ok).toBe(false);
    if (!f.ok) expect(f.grund).toMatch(/vor dem Ende|Start/i);
  });

  it("Loop-Modi entsprechen dem Bank-Format", () => {
    // e2sBankBuilder: 1 = One-Shot, 0 = vorwaerts schleifend
    expect(LOOP_AUS).toBe(1);
    expect(LOOP_VORWAERTS).toBe(0);
  });
});

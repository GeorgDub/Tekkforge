import { describe, it, expect } from "vitest";
import { tekkZielTempo, TEKK_MIN, TEKK_MAX, TEKK_MITTE } from "../src/core/tempoAnalyse";

describe("tekkZielTempo", () => {
  it("lässt ein Tempo im Tekk-Bereich stehen", () => {
    expect(tekkZielTempo(180)).toBe(180);
    expect(tekkZielTempo(TEKK_MIN)).toBe(TEKK_MIN);
    expect(tekkZielTempo(TEKK_MAX)).toBe(TEKK_MAX);
  });

  it("verdoppelt ein zu langsames Tempo, wenn es dadurch passt", () => {
    // 90 → 180: klassischer Fall, ein halbtaktig gemessenes Lied.
    expect(tekkZielTempo(90)).toBe(180);
    expect(tekkZielTempo(95)).toBe(190);
  });

  it("halbiert ein zu schnelles, wenn es dadurch passt", () => {
    expect(tekkZielTempo(360)).toBe(180);
  });

  it("passt keine Oktave, kommt die Mitte des Tekk-Bereichs heraus", () => {
    // 127 ist der Fall, der das nötig gemacht hat: weder 127 noch 254 liegen
    // im Tekk-Bereich, und rechnerisch gewann 254 um 0,006 — damit wäre aus
    // einem Rap-Track Speedcore geworden statt Tekk.
    expect(tekkZielTempo(127)).toBe(TEKK_MITTE);
    expect(tekkZielTempo(128)).toBe(TEKK_MITTE);
  });

  it("unsinnige Eingaben ergeben die Mitte statt NaN", () => {
    expect(tekkZielTempo(0)).toBe(TEKK_MITTE);
    expect(tekkZielTempo(-5)).toBe(TEKK_MITTE);
    expect(tekkZielTempo(Number.NaN)).toBe(TEKK_MITTE);
  });

  it("das Ergebnis liegt immer im Tekk-Bereich", () => {
    for (const bpm of [60, 75, 94, 100, 127, 133, 150, 170, 200, 240, 254, 300]) {
      const t = tekkZielTempo(bpm);
      expect(t).toBeGreaterThanOrEqual(TEKK_MIN);
      expect(t).toBeLessThanOrEqual(TEKK_MAX);
    }
  });
});

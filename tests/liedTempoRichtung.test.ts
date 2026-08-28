import { describe, it, expect } from "vitest";
import { analysiereLied } from "../src/core/liedAnalyse";

const SR = 44100;

/** Klicks in festem Abstand — ein Lied, dessen Tempo unstrittig ist. */
function klickLied(bpm: number, sekunden: number): Float32Array {
  const pcm = new Float32Array(Math.round(SR * sekunden));
  const abstand = Math.round((60 / bpm) * SR);
  for (let s = 0; s < pcm.length; s += abstand) {
    for (let i = 0; i < 400 && s + i < pcm.length; i++) {
      // kurzer Impuls mit Abklingen — laut genug, dass die Analyse ihn sieht
      pcm[s + i] = Math.sin((2 * Math.PI * 1200 * i) / SR) * Math.exp(-i / 120);
    }
  }
  return pcm;
}

/** Mittlerer Abstand aufeinanderfolgender Impulse in Sekunden. */
function klickAbstand(pcm: Float32Array): number {
  const schwelle = 0.25;
  const stellen: number[] = [];
  let letzte = -Infinity;
  for (let i = 0; i < pcm.length; i++) {
    if (Math.abs(pcm[i]) > schwelle && i - letzte > SR * 0.05) {
      stellen.push(i);
      letzte = i;
    }
  }
  if (stellen.length < 2) return Number.NaN;
  let summe = 0;
  for (let i = 1; i < stellen.length; i++) summe += stellen[i] - stellen[i - 1];
  return summe / (stellen.length - 1) / SR;
}

describe("Tempoanpassung: Richtung", () => {
  it("ein langsameres Lied wird SCHNELLER gemacht, nicht langsamer", () => {
    // Der Nutzerbefund (2026-08-29): „bei Stein zu Stein und Freigetränk musste
    // ich hochpitchen, weil das zu tief war". Genau das passiert, wenn ein Lied
    // auf dem Weg zum Ziel-Tempo verlangsamt statt beschleunigt wird.
    // Aufgefallen ist es nie, weil bisher nur Tekk-Lieder verarbeitet wurden —
    // dort ist das Verhaeltnis rund 1 und die Richtung egal.
    //
    // 160 gegen 180: die Oktave ist eindeutig (×1), es bleibt nur die Richtung.
    const r = analysiereLied(klickLied(160, 40), SR, { zielBpm: 180, bpmHinweis: 160, fensterTakte: 2 });
    expect(r.fenster.length).toBeGreaterThan(0);
    // Bei 180 BPM liegt ein Schlag alle 0,333 s. Falsche Richtung ergaebe 0,42 s.
    expect(klickAbstand(r.fenster[0].pcm)).toBeCloseTo(60 / 180, 2);
  });

  it("ein schnelleres Lied wird langsamer gemacht", () => {
    const r = analysiereLied(klickLied(200, 40), SR, { zielBpm: 180, bpmHinweis: 200, fensterTakte: 2 });
    expect(klickAbstand(r.fenster[0].pcm)).toBeCloseTo(60 / 180, 2);
  });

  it("passt das Tempo schon, bleibt das Lied unangetastet", () => {
    const r = analysiereLied(klickLied(180, 30), SR, { zielBpm: 180, bpmHinweis: 180, fensterTakte: 2 });
    expect(klickAbstand(r.fenster[0].pcm)).toBeCloseTo(60 / 180, 2);
  });

  it("die Oktavwahl bleibt eine eigene Entscheidung", () => {
    // 120 gegen 180: im Log-Mass ist 240 naeher als 120, die Analyse liest das
    // Lied also als Doppeltempo. Dann landen die Klicks bei 90 — jeder zweite
    // Schlag des 180er Rasters. Das ist kein Fehler der Richtung, sondern die
    // Oktave; wer sie anders will, gibt einen bpmHinweis oder ein anderes Ziel.
    const r = analysiereLied(klickLied(120, 40), SR, { zielBpm: 180, bpmHinweis: 120, fensterTakte: 2 });
    expect(r.k).toBe(2);
    expect(klickAbstand(r.fenster[0].pcm)).toBeCloseTo(60 / 90, 1);
  });
});

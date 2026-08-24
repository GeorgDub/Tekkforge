import { describe, it, expect } from "vitest";
import { schneideDrums, drumOnsets } from "../src/core/drumSchnitt";

const SR = 44100;

function burst(pcm: Float32Array, startSek: number, freq: number, dauerSek: number, amp: number): void {
  const start = Math.round(startSek * SR);
  const n = Math.round(dauerSek * SR);
  for (let i = 0; i < n && start + i < pcm.length; i++) {
    pcm[start + i] += Math.sin((2 * Math.PI * freq * i) / SR) * amp * Math.exp(-i / (n / 4));
  }
}

/** Synthetischer Drums-Stem: 60-Hz-Kicks, 400-Hz-Snares, 8-kHz-Hats. */
function stem(): Float32Array {
  const pcm = new Float32Array(2 * SR);
  for (const t of [0.05, 0.55, 1.05, 1.55]) burst(pcm, t, 60, 0.15, 0.8);
  for (const t of [0.3, 1.3]) burst(pcm, t, 400, 0.1, 0.6);
  for (const t of [0.18, 0.68, 1.18, 1.68]) burst(pcm, t, 8000, 0.05, 0.5);
  return pcm;
}

describe("drumSchnitt", () => {
  it("drumOnsets: findet alle zehn Anschlaege mit Mindestabstand", () => {
    const onsets = drumOnsets(stem(), SR);
    expect(onsets.length).toBe(10);
    for (let i = 1; i < onsets.length; i++) expect(onsets[i] - onsets[i - 1]).toBeGreaterThanOrEqual(0.06 * SR);
  });
  it("schneideDrums: klassifiziert Kick/Snare/Hat, hoechstens 2 je Rolle, Shots kurz", () => {
    const treffer = schneideDrums(stem(), SR);
    const rollen = (r: string) => treffer.filter((t) => t.rolle === r);
    expect(rollen("kick").length).toBeGreaterThanOrEqual(1);
    expect(rollen("snare").length).toBeGreaterThanOrEqual(1);
    expect(rollen("hat").length).toBeGreaterThanOrEqual(1);
    for (const r of ["kick", "snare", "hat"]) expect(rollen(r).length).toBeLessThanOrEqual(2);
    for (const t of treffer) {
      expect(t.pcm.length).toBeLessThanOrEqual(Math.round(0.4 * SR));
      expect(t.pcm.length).toBeGreaterThanOrEqual(1024);
      expect(t.rmsDb).toBeGreaterThan(-40);
    }
    // Startzeiten passen zur Rolle
    const kickStarts = rollen("kick").map((t) => Math.round(t.startSek * 100) / 100);
    for (const s of kickStarts) expect([0.05, 0.55, 1.05, 1.55].some((t) => Math.abs(t - s) < 0.03)).toBe(true);
  });
  it("stiller Stem → keine Treffer", () => {
    expect(schneideDrums(new Float32Array(SR), SR)).toEqual([]);
  });
});

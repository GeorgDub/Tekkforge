import { describe, it, expect } from "vitest";
import { planeBank } from "../src/core/bankPlan";
import { zusammenfassung } from "../src/core/generatorSession";
import { ramBytesFuer } from "../src/core/sampleRam";
import type { ScanEintrag } from "../src/core/sampleScan";

const SR = 44100;
/** Helles Rauschen (bleibt bei voller Rate) oder dunkler Ton (Rolloff tief). */
function pcmFuer(sek: number, hell: boolean, seed = 1): Float32Array {
  const n = Math.round(sek * SR);
  const out = new Float32Array(n);
  let z = seed;
  for (let i = 0; i < n; i++) {
    z = (z * 1664525 + 1013904223) >>> 0;
    out[i] = hell ? (z / 4294967296) * 1.4 - 0.7 : 0.7 * Math.sin((2 * Math.PI * 110 * i) / SR);
  }
  return out;
}
function eintrag(name: string, rolle: ScanEintrag["rolle"], pcm: Float32Array, sampleRate = SR): ScanEintrag {
  return { datei: `${name}.wav`, stem: name, rolle, familie: name.toLowerCase(), sekunden: pcm.length / sampleRate, rmsDb: -12, peak: 0.7, pcm, sampleRate } as ScanEintrag;
}

describe("Budget-Waechter und Byte-Rechnung", () => {
  it("zusammenfassung zaehlt einen 22 050-Hz-Eintrag halb", () => {
    const voll = eintrag("A", "fx", pcmFuer(2, true), SR);
    const halb = eintrag("B", "fx", pcmFuer(2, true).slice(0, SR), SR / 2);
    const z = zusammenfassung([voll, halb]);
    expect(z.megabyte).toBeCloseTo((ramBytesFuer(voll) + ramBytesFuer(halb)) / 1048576, 6);
    expect(ramBytesFuer(halb)).toBe(ramBytesFuer(voll) / 2);
  });

  it("Rolloff-Regel: dunkle Slots halbiert, helle nicht, Hinweis nennt die Zahl", () => {
    const r = planeBank([eintrag("Dunkel", "fx", pcmFuer(1, false)), eintrag("Hell", "fx", pcmFuer(1, true))], { name: "t", bpm: 180, bankZeit: "x" });
    const dunkel = r.projekt.samples.find((s) => s.name.startsWith("Dunkel"))!;
    const hell = r.projekt.samples.find((s) => s.name.startsWith("Hell"))!;
    expect(dunkel.sampleRate).toBe(22050);
    expect(hell.sampleRate).toBe(44100);
    expect(dunkel.sekunden).toBeCloseTo(1, 2);
    expect(r.hinweise.join(" ")).toMatch(/1 Slot\(s\) mit 22 050 Hz/);
    expect(r.warnungen).toEqual([]);
    const aus = planeBank([eintrag("Dunkel", "fx", pcmFuer(1, false))], { name: "t", bpm: 180, bankZeit: "x", rateNachRolloff: false });
    expect(aus.projekt.samples[0].sampleRate).toBe(44100);
    expect(aus.hinweise).toEqual([]);
  });

  it("ueber dem Budget: erst Vocals auf halbe Rate, dann FX, zuletzt Slots weg — mit Warnung im Hinweis", () => {
    // drei helle Slots je 2 s = je 176 400 Bytes; Grenze knapp unter der Summe
    const vox = eintrag("Vox", "vox", pcmFuer(2, true, 2));
    const fx = eintrag("Fx", "fx", pcmFuer(2, true, 3));
    const kick = eintrag("Kick", "kick", pcmFuer(2, true, 4));
    const bytes = 3 * 2 * SR * 2;
    const r = planeBank([vox, fx, kick], { name: "t", bpm: 180, bankZeit: "x", budgetSekunden: 1000, ramBytes: bytes - 1000 });
    expect(r.projekt.samples.find((s) => s.rolle === "vox")!.sampleRate).toBe(22050);
    expect(r.projekt.samples.find((s) => s.rolle === "fx")!.sampleRate).toBe(44100);
    expect(r.projekt.samples).toHaveLength(3);
    expect(r.hinweise.join(" ")).toMatch(/Budget: 1 vox-Slot/);
    // noch enger: Vocals UND FX halb
    // Vocals UND FX halbiert sparen 2 × 88 200 Bytes; die Grenze liegt 1000 Bytes darueber
    const r2 = planeBank([vox, fx, kick], { name: "t", bpm: 180, bankZeit: "x", budgetSekunden: 1000, ramBytes: bytes - 2 * SR * 2 + 1000 });
    expect(r2.projekt.samples.find((s) => s.rolle === "fx")!.sampleRate).toBe(22050);
    expect(r2.projekt.samples).toHaveLength(3);
    // zu eng fuer alles: der letzte Slot faellt weg, Warnzeichen im Hinweis
    const r3 = planeBank([vox, fx, kick], { name: "t", bpm: 180, bankZeit: "x", budgetSekunden: 1000, ramBytes: 2 * SR * 2 + 1000 });
    expect(r3.projekt.samples.length).toBeLessThan(3);
    expect(r3.hinweise.join(" ")).toMatch(/⚠ Budget/);
    // die Bank enthaelt genau die Slots des Projekts (Nummern luecken nicht)
    expect(r3.projekt.samples.map((s) => s.nr)).toEqual(r3.projekt.samples.map((_, i) => 501 + i));
  });
});

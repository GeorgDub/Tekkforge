import { describe, it, expect } from "vitest";
import { loopPunkte, loopPunkteAufNull, nulldurchgang, aehnlichkeit, wiederholtSich, taktFrames } from "../src/core/loopPunkte";
import { slicesFuer, sliceAnzahl, SLICE_MAX } from "../src/core/sliceMarker";
import { planeBank } from "../src/core/bankPlan";
import { parseE2sBank } from "../src/core/e2sBankReader";
import { pruefeLoop } from "../src/core/sampleEdit";
import { LOOP_TYPE_FORWARD, LOOP_TYPE_ONESHOT } from "../src/core/constants";
import type { ScanEintrag } from "../src/core/sampleScan";

const SR = 44100;
const BPM = 180;
const takt = taktFrames(SR, BPM);

/** Ein Takt Melodie: vier Toene, deterministisch. */
function taktMelodie(seed: number): Float32Array {
  const out = new Float32Array(Math.round(takt));
  for (let i = 0; i < out.length; i++) {
    const viertel = Math.floor((i / out.length) * 4);
    const hz = [220, 277, 330, 262][(viertel + seed) % 4];
    out[i] = 0.6 * Math.sin((2 * Math.PI * hz * i) / SR) * (1 - ((i % (out.length / 4)) / out.length) * 4 * 0.5);
  }
  return out;
}
function takte(...seeds: number[]): Float32Array {
  const teile = seeds.map(taktMelodie);
  const out = new Float32Array(teile.reduce((n, t) => n + t.length, 0));
  let p = 0;
  for (const t of teile) {
    out.set(t, p);
    p += t.length;
  }
  return out;
}
const eintrag = (name: string, rolle: ScanEintrag["rolle"], pcm: Float32Array): ScanEintrag =>
  ({ datei: `${name}.wav`, stem: name, rolle, familie: name.toLowerCase(), sekunden: pcm.length / SR, rmsDb: -12, peak: 0.6, pcm, sampleRate: SR }) as ScanEintrag;

describe("loopPunkte", () => {
  it("Ende liegt auf der letzten vollen Taktgrenze, Start bei 0", () => {
    const p = loopPunkte(Math.round(4 * takt), 4, SR, BPM);
    expect(p.start).toBe(0);
    expect(p.ende).toBe(Math.round(4 * takt));
    expect(p.takte).toBe(4);
    // ein Sample mit 3,5 Takten: drei volle
    const q = loopPunkte(Math.round(3.5 * takt), 4, SR, BPM);
    expect(q.takte).toBe(3);
    expect(q.ende).toBe(Math.round(3 * takt));
    // kuerzer als ein Takt: Ende = Laenge
    const k = loopPunkte(1000, 1, SR, BPM);
    expect(k).toEqual({ start: 0, ende: 1000, takte: 0 });
  });

  it("nulldurchgang findet den naechsten Vorzeichenwechsel", () => {
    const pcm = new Float32Array(200).map((_, i) => Math.sin((2 * Math.PI * i) / 50));
    expect([25, 26]).toContain(nulldurchgang(pcm, 27)); // sin(π) ist in Float nicht exakt 0
    expect([50, 51]).toContain(nulldurchgang(pcm, 49, 5));
    const p = loopPunkteAufNull(takte(0, 1, 2, 3), 4, SR, BPM);
    expect(Math.abs(p.ende - Math.round(4 * takt))).toBeLessThanOrEqual(64);
    expect(pruefeLoop(p.start, p.ende, Math.round(4 * takt)).ok).toBe(true);
  });

  it("aehnlichkeit und wiederholtSich: AB AB wiederholt sich, AB CD nicht", () => {
    const abab = takte(0, 1, 0, 1);
    const abcd = takte(0, 1, 2, 3);
    expect(aehnlichkeit(abab.subarray(0, Math.round(2 * takt)), abab.subarray(Math.round(2 * takt)))).toBeGreaterThan(0.99);
    expect(wiederholtSich(abab, 4, SR, BPM)).toBe(2);
    expect(wiederholtSich(abcd, 4, SR, BPM)).toBeNull();
    expect(wiederholtSich(abab, 3, SR, BPM)).toBeNull();
    expect(wiederholtSich(abab, 1, SR, BPM)).toBeNull();
  });
});

describe("sliceMarker", () => {
  it("16 Marker je Takt, gedeckelt auf 64; Marker monoton und innerhalb der Laenge", () => {
    expect(sliceAnzahl(4)).toBe(64);
    expect(sliceAnzahl(8)).toBe(SLICE_MAX);
    expect(sliceAnzahl(2)).toBe(32);
    expect(sliceAnzahl(0)).toBe(0);
    const pcm = takte(0, 1, 2, 3);
    const s = slicesFuer(pcm, 64)!;
    expect(s.slices).toHaveLength(64);
    for (let i = 1; i < 64; i++) expect(s.slices[i].start).toBeGreaterThan(s.slices[i - 1].start);
    const letzte = s.slices[63];
    expect(letzte.start + letzte.length).toBe(pcm.length);
    expect(s.sliceSteps.filter((x) => x !== 255).length).toBe(64);
    expect(s.slicingNumActive).toBe(64);
    expect(slicesFuer(pcm, 0)).toBeNull();
  });
});

describe("planeBank: Loop-Punkte und Slices im Generator-Weg", () => {
  it("Loops bekommen forward-Loop auf der Taktgrenze und 64 Marker, One-Shots nicht", () => {
    const melo = eintrag("Melo Loop", "melo", takte(0, 1, 2, 3));
    const kick = eintrag("Kick", "kick", takte(0).subarray(0, 4000));
    const r = planeBank([melo, kick], { name: "t", bpm: BPM, bankZeit: "x", rateNachRolloff: false });
    const bank = parseE2sBank(new Uint8Array(r.bank), "t.all");
    const m = bank.slots.find((s) => s?.name.trim().startsWith("Melo"))!;
    const k = bank.slots.find((s) => s?.name.trim().startsWith("Kick"))!;
    expect(m.loopType).toBe(LOOP_TYPE_FORWARD);
    expect(m.loopStart).toBe(0);
    expect(Math.abs(m.loopEnd - m.frames)).toBeLessThanOrEqual(64);
    expect(m.slices.length).toBe(64);
    expect(k.loopType).toBe(LOOP_TYPE_ONESHOT);
    expect(k.slices.length).toBe(0);
    const ps = r.projekt.samples.find((s) => s.rolle === "melo")!;
    expect(ps.loop).toMatchObject({ start: 0, takte: 4 });
  });

  it("ein Vier-Takter aus zwei gleichen Haelften wird als zwei Takte gespeichert — aber nicht bei Vocals", () => {
    const abab = takte(0, 1, 0, 1);
    const r = planeBank([eintrag("Melo AB", "melo", abab), eintrag("Vox AB", "vox", abab)], { name: "t", bpm: BPM, bankZeit: "x", rateNachRolloff: false });
    const melo = r.projekt.samples.find((s) => s.rolle === "melo")!;
    const vox = r.projekt.samples.find((s) => s.rolle === "vox")!;
    expect(melo.takte).toBe(4);
    expect(melo.loop?.gespeicherteTakte).toBe(2);
    expect(melo.sekunden).toBeCloseTo((2 * takt) / SR, 1);
    expect(vox.loop?.gespeicherteTakte).toBe(4);
    expect(vox.sekunden).toBeCloseTo((4 * takt) / SR, 1);
    expect(r.hinweise.join(" ")).toMatch(/wiederholt sich/);
  });
});

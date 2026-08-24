import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { scanne } from "../src/core/sampleScan";
import { bereiteAuf, waehleVolumes, planeBank } from "../src/core/bankPlan";
import { parseE2sBank } from "../src/core/e2sBankReader";
import { oscToDisplayNumber } from "../src/core/e2sPatternSampleLink";

const KORG3 = path.resolve("examples/e2s/korg3");
const TEKK4 = path.resolve("examples/e2s/tekk4.all");
function eingaben(dateien: string[]) {
  return dateien.map((f) => {
    const w = parseWav(new Uint8Array(fs.readFileSync(path.join(KORG3, f))));
    return { name: f, pcm: w.pcm, sampleRate: w.sampleRate };
  });
}
const alle = fs.readdirSync(KORG3).filter((f) => f.endsWith(".wav"));

describe("bankPlan", () => {
  it("bereiteAuf: One-Shot wird getrimmt, normalisiert, bleibt oneshot", () => {
    const { eintraege } = scanne(eingaben(["Klatsch.wav"]));
    const t = bereiteAuf(eintraege[0], 180).teile;
    expect(t).toHaveLength(1);
    expect(t[0].kind).toBe("oneshot");
    let peak = 0;
    for (const v of t[0].pcm) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeCloseTo(0.95, 2);
  });
  it("bereiteAuf: 4-Takt-Melo bleibt EIN Loop mit takte=4 und exakter Laenge", () => {
    const { eintraege } = scanne(eingaben(["BaReTT MeLo.wav"]));
    const t = bereiteAuf(eintraege[0], 180).teile;
    expect(t).toHaveLength(1);
    expect(t[0].kind).toBe("loop");
    expect(t[0].takte).toBe(4);
    expect(t[0].pcm.length).toBe(Math.round((240 / 180) * 4 * 44100));
  });
  it("bereiteAuf: 8-Takt-Melo bleibt ein Sample", () => {
    const sr = 44100;
    const pcm = new Float32Array(Math.round(8 * (240 / 180) * sr)).map((_, i) => Math.sin(i / 25) * 0.5);
    const { eintraege } = scanne([{ name: "HyPer MeLo.wav", pcm, sampleRate: sr }]);
    const t = bereiteAuf(eintraege[0], 180).teile;
    expect(t).toHaveLength(1);
    expect(t[0].takte).toBe(8);
  });
  it("bereiteAuf: 10-Takt-Vocal wird in genau zwei Haelften geteilt", () => {
    const sr = 44100;
    const pcm = new Float32Array(Math.round(10 * (240 / 180) * sr)).map((_, i) => Math.sin(i / 20) * 0.5);
    const { eintraege } = scanne([{ name: "GZUZ lang.wav", pcm, sampleRate: sr }]);
    const t = bereiteAuf(eintraege[0], 180).teile;
    expect(t.map((x) => x.name)).toEqual(["GZUZ lang A", "GZUZ lang B"]);
    expect(t.map((x) => x.takte)).toEqual([5, 5]);
    expect(t.map((x) => x.chunk)).toEqual([0, 1]);
  });
  it("bereiteAuf: 4.4 Takte werden per Varispeed auf 4 Takte gebracht", () => {
    const sr = 44100;
    const pcm = new Float32Array(Math.round(4.4 * (240 / 180) * sr)).map((_, i) => Math.sin(i / 30) * 0.5);
    const { eintraege } = scanne([{ name: "HpBe MeLo.wav", pcm, sampleRate: sr }]);
    const t = bereiteAuf(eintraege[0], 180).teile[0];
    expect(t.kind).toBe("loop");
    expect(t.takte).toBe(4);
    expect(t.pcm.length).toBe(Math.round(4 * (240 / 180) * sr));
  });
  it("bereiteAuf: Off-Grid-Melo (Eigentempo 155) wird per Varispeed auf 2 Takte @180 gezogen statt One-Shot", () => {
    const sr = 44100;
    // 8 Beats bei 155 BPM: klare Onsets, damit tempoSchaetzen das Eigentempo findet
    const beat = 60 / 155;
    const dauer = 8 * beat; // ≈ 3,097 s → bei 180 BPM: 2,32 Takte → Abweichung 16 % > Toleranz
    const pcm = new Float32Array(Math.round(dauer * sr));
    for (let b = 0; b < 8; b++) {
      const start = Math.round(b * beat * sr);
      for (let i = 0; i < 4000 && start + i < pcm.length; i++) {
        pcm[start + i] = Math.sin((2 * Math.PI * 800 * i) / sr) * 0.7 * Math.exp(-i / 800);
      }
    }
    const { eintraege } = scanne([{ name: "OffGrid MeLo.wav", pcm, sampleRate: sr }]);
    expect(eintraege[0].rolle).toBe("melo");
    const t = bereiteAuf(eintraege[0], 180).teile[0];
    expect(t.kind).toBe("loop");
    expect(t.takte).toBe(2);
    expect(t.pcm.length).toBe(Math.round(2 * (240 / 180) * sr));
  });
  it("planeBank: Melo-Loops tragen ein 64er-Raster (Onset/Bass)", () => {
    const { eintraege } = scanne(eingaben(["BaReTT MeLo.wav"]));
    const { projekt } = planeBank(eintraege, { name: "r", bpm: 180, bankZeit: "x" });
    const melo = projekt.samples.find((s) => s.rolle === "melo" && s.kind === "loop")!;
    expect(melo.raster).toBeDefined();
    expect(melo.raster!.onset).toHaveLength(64);
    expect(melo.raster!.bass).toHaveLength(64);
    expect(Math.max(...melo.raster!.onset)).toBeCloseTo(1, 5);
  });
  it("waehleVolumes: Budget teilt in Scheiben, nichts geht verloren", () => {
    const { eintraege } = scanne(eingaben(alle));
    const vol = waehleVolumes(eintraege, 180, 30);
    expect(vol.length).toBeGreaterThan(1);
    const summe = (v: typeof eintraege) => v.reduce((s, e) => s + e.sekunden, 0);
    for (const v of vol) expect(summe(v)).toBeLessThanOrEqual(30 + 15);
    expect(vol.flat().length).toBe(eintraege.length);
  });
  it("planeBank: korg3 ohne tekk-Drums → Nummern ab 501, Bank lesbar, Projekt stimmig", () => {
    const { eintraege } = scanne(eingaben(alle));
    const { projekt, bank, warnungen } = planeBank(eintraege, { name: "korg3", bpm: 180, bankZeit: "2026-08-22T12:00:00Z" });
    expect(warnungen).toEqual([]);
    expect(projekt.samples[0].nr).toBe(501);
    expect(projekt.tekkDrums).toBe(false);
    expect(projekt.status).toBe("gebaut");
    const gelesen = parseE2sBank(new Uint8Array(bank), "korg3.all");
    const nummern = gelesen.slots.filter(Boolean).map((s) => oscToDisplayNumber(s!.sampleNumber)).sort((a, b) => a - b);
    expect(nummern).toEqual(projekt.samples.map((s) => s.nr).sort((a, b) => a - b));
    for (const s of projekt.samples) expect(s.name.length).toBeLessThanOrEqual(16);
    expect(projekt.samples.filter((s) => s.rolle === "melo" && s.kind === "loop").every((s) => s.takte <= 8)).toBe(true);
    expect(new Set(projekt.samples.map((s) => s.name.toLowerCase())).size).toBe(projekt.samples.length);
  });
  it("planeBank: mit tekk4-Drums liegen die auf 501–535, eigene ab 601", () => {
    const { eintraege } = scanne(eingaben(["BaReTT MeLo.wav", "Klatsch.wav"]));
    const { projekt } = planeBank(eintraege, { name: "t", bpm: 180, tekkDrumsBank: new Uint8Array(fs.readFileSync(TEKK4)) });
    expect(projekt.tekkDrums).toBe(true);
    const tekk = projekt.samples.filter((s) => s.gruppe === "tekk");
    expect(tekk.length).toBe(10);
    expect(tekk.every((s) => s.nr >= 501 && s.nr <= 535)).toBe(true);
    expect(projekt.samples.filter((s) => s.gruppe !== "tekk")[0].nr).toBe(601);
  });
});

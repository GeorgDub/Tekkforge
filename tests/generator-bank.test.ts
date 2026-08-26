import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { scanne } from "../src/core/sampleScan";
import { bereiteAuf, waehleVolumes, planeBank } from "../src/core/bankPlan";
import { parseE2sBank } from "../src/core/e2sBankReader";
import { buildE2sBank } from "../src/core/e2sBankBuilder";
import { oscToDisplayNumber, displayNumberToOsc, displayNumberToSlotIndex } from "../src/core/e2sPatternSampleLink";

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
  it("bereiteAuf: 8-Takt-Vocal wird in zwei 4-Takt-Haelften geteilt (Melo bleibt ganz)", () => {
    const sr = 44100;
    const pcm = new Float32Array(Math.round(8 * (240 / 180) * sr)).map((_, i) => Math.sin(i / 20) * 0.5);
    const { eintraege } = scanne([{ name: "GZUZ Vers.wav", pcm, sampleRate: sr }]);
    expect(eintraege[0].rolle).toBe("vox");
    const t = bereiteAuf(eintraege[0], 180).teile;
    expect(t.map((x) => x.name)).toEqual(["GZUZ Vers A", "GZUZ Vers B"]);
    expect(t.map((x) => x.takte)).toEqual([4, 4]);
    expect(t.map((x) => x.chunk)).toEqual([0, 1]);
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
  it("waehleVolumes: Vocals haben Vorrang vor gleichwertigen Melos", () => {
    const sr = 44100;
    const frames = Math.round(4 * (240 / 180) * sr);
    const melo = new Float32Array(frames).map((_, i) => Math.sin(i / 30) * 0.5);
    const vox = new Float32Array(frames).map((_, i) => Math.sin(i / 24) * 0.5);
    const { eintraege } = scanne([
      { name: "HyPer MeLo.wav", pcm: melo, sampleRate: sr },
      { name: "GZUZ V01.wav", pcm: vox, sampleRate: sr },
    ]);
    expect(eintraege.map((e) => e.rolle).sort()).toEqual(["melo", "vox"]);
    const dauer = frames / sr;
    const vol = waehleVolumes(eintraege, 180, dauer + 0.5);
    expect(vol[0][0].rolle).toBe("vox");
  });
  it("waehleVolumes: Vocals fressen hoechstens ~45 % des Budgets — Melo/Drums bleiben in Volume 1", () => {
    const sr = 44100;
    const frames = Math.round(8 * (240 / 180) * sr);
    // 20 Vocal-Segmente (je ~10,7 s) + eine Melo + eine Kick bei knappem Budget
    const voxE = Array.from({ length: 20 }, (_, n) => {
      const pcm = new Float32Array(frames).map((_, i) => Math.sin(i / (15 + n)) * 0.5);
      return { datei: `L V${n + 1}.wav`, stem: `L V${n + 1}`, rolle: "vox" as const, familie: `l v${n + 1}`, sekunden: frames / sr, rmsDb: -12, peak: 0.5, pcm, sampleRate: sr };
    });
    const { eintraege } = scanne(eingaben(["BaReTT MeLo.wav", "Kick 4.wav"]));
    const budget = 60;
    const vol = waehleVolumes(eintraege.concat(voxE), 180, budget);
    const erste = vol[0];
    const voxSek = erste.filter((e) => e.rolle === "vox").reduce((s, e) => s + e.sekunden, 0);
    expect(voxSek).toBeLessThanOrEqual(budget * 0.5);
    expect(erste.some((e) => e.rolle === "melo")).toBe(true);
    expect(erste.some((e) => e.rolle === "kick")).toBe(true);
  });
  it("bereiteAuf: Vocal-Segment mit stillen Raendern behaelt sein 8-Takt-Fenster (kein Trim)", () => {
    const sr = 44100;
    const frames = Math.round(8 * (240 / 180) * sr);
    const taktFrames = Math.round((240 / 180) * sr);
    // Vocals nur in den Takten 2-7 — Takt 1 und 8 sind still
    const pcm = new Float32Array(frames);
    for (let i = taktFrames; i < 7 * taktFrames; i++) pcm[i] = Math.sin(i / 18) * 0.5;
    const { eintraege } = scanne([{ name: "GZUZ V03.wav", pcm, sampleRate: sr }], { "GZUZ V03.wav": "vox" });
    const t = bereiteAuf(eintraege[0], 180).teile;
    expect(t.map((x) => x.takte)).toEqual([4, 4]);
    expect(t[0].pcm.length + t[1].pcm.length).toBe(frames);
  });
  it("sparsameVocals: Vocal-Loops belegen halb so viel, Melos bleiben unberuehrt", () => {
    const sr = 44100;
    const frames = Math.round(8 * (240 / 180) * sr);
    const mach = (name: string) => {
      const pcm = new Float32Array(frames).map((_, i) => Math.sin(i / 20) * 0.5);
      return scanne([{ name, pcm, sampleRate: sr }]).eintraege[0];
    };
    const vox = mach("GZUZ V01.wav");
    const melo = mach("HyPer MeLo.wav");
    expect([vox.rolle, melo.rolle]).toEqual(["vox", "melo"]);
    const voll = planeBank([vox, melo], { name: "v", bpm: 180, bankZeit: "x" });
    const sparsam = planeBank([vox, melo], { name: "s", bpm: 180, bankZeit: "x", sparsameVocals: true });
    const sek = (p: typeof voll.projekt, rolle: string) =>
      p.samples.filter((s) => s.rolle === rolle).reduce((a, b) => a + b.sekunden, 0);
    // Vocals: halbe Abtastrate -> halbe Datenmenge bei gleicher Spieldauer
    const vollVox = voll.projekt.samples.filter((s) => s.rolle === "vox");
    const sparVox = sparsam.projekt.samples.filter((s) => s.rolle === "vox");
    expect(sparVox.length).toBe(vollVox.length);
    expect(sparsam.projekt.samples.find((s) => s.rolle === "vox")!.sampleRate).toBe(22050);
    expect(voll.projekt.samples.find((s) => s.rolle === "vox")!.sampleRate).toBe(44100);
    // Spieldauer bleibt gleich (Takte unveraendert), nur die Rate halbiert sich
    expect(sek(sparsam.projekt, "vox")).toBeCloseTo(sek(voll.projekt, "vox"), 2);
    // Melos ruehrt das nicht an
    expect(sparsam.projekt.samples.find((s) => s.rolle === "melo")!.sampleRate).toBe(44100);
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
  it("planeBank: STEREO-Basissample wird zu Mono gemischt (sonst frisst es zwei Parts)", () => {
    const sr = 44100;
    // Fremdbank mit einem STEREO-Slot unter einem tekk-Basisnamen
    const frames = 4410;
    const stereo = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      stereo[i * 2] = Math.sin(i / 12) * 0.6;
      stereo[i * 2 + 1] = Math.sin(i / 9) * 0.6;
    }
    const fremd = buildE2sBank([
      { slotIndex: displayNumberToSlotIndex(501), sampleNumber: displayNumberToOsc(501), name: "HaimKind Stereo", category: 2, pcmData: stereo, sampleRate: sr, channels: 2 },
    ]);
    const { eintraege } = scanne(eingaben(["Klatsch.wav"]));
    const { bank } = planeBank(eintraege, { name: "st", bpm: 180, tekkDrumsBank: new Uint8Array(fremd.buffer) });
    const gelesen = parseE2sBank(new Uint8Array(bank), "st.all");
    for (const s of gelesen.slots.filter(Boolean)) expect(s!.channels).toBe(1);
  });
  it("planeBank: JEDER Slot ist mono — die Electribe legt Stereo sonst auf zwei Parts", () => {
    const { eintraege } = scanne(eingaben(["BaReTT MeLo.wav", "Klatsch.wav"]));
    const { projekt, bank } = planeBank(eintraege, { name: "m", bpm: 180, tekkDrumsBank: new Uint8Array(fs.readFileSync(TEKK4)) });
    const gelesen = parseE2sBank(new Uint8Array(bank), "m.all");
    const belegt = gelesen.slots.filter(Boolean);
    expect(belegt.length).toBe(projekt.samples.length);
    for (const s of belegt) expect(s!.channels).toBe(1);
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

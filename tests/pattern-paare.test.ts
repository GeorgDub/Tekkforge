import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { scanne } from "../src/core/sampleScan";
import { planeBank } from "../src/core/bankPlan";
import { regelRezept } from "../src/core/rezept";
import { bauePaare, bauePaareProMelo, baueRezept, voxPaare } from "../src/core/patternGen";
import { voxSegmentEintrag, erzeuge } from "../src/core/generatorSession";
import { e2PatternRefToBankNumber } from "../src/core/e2sPatternSampleLink";
import type { E2PatternInput } from "../src/core/electribePatternBuilder";

const KORG3 = path.resolve("examples/e2s/korg3");
const eingaben = fs
  .readdirSync(KORG3)
  .filter((f) => f.endsWith(".wav"))
  .map((f) => {
    const w = parseWav(new Uint8Array(fs.readFileSync(path.join(KORG3, f))));
    return { name: f, pcm: w.pcm, sampleRate: w.sampleRate };
  });

/** Projekt mit drei Vocal-Segmenten (je 8 Takte → Haelften A/B) und einem 8-Takt-Melo. */
function projektMitVox() {
  const frames = Math.round(8 * (240 / 180) * 44100);
  const voxE = [1, 2, 3].map((n) => voxSegmentEintrag("Amph", n, new Float32Array(frames).map((_, i) => Math.sin(i / (18 + 3 * n)) * 0.5)));
  const meloLang = { name: "HyPer MeLo.wav", pcm: new Float32Array(frames).map((_, i) => Math.sin(i / 25) * 0.5), sampleRate: 44100 };
  const { projekt } = planeBank(scanne(eingaben.concat(meloLang)).eintraege.concat(voxE), { name: "amph", bpm: 180, bankZeit: "x", rateNachRolloff: false });
  return projekt;
}
const nr = (p: E2PatternInput, idx: number) => (p.parts[idx].sampleId ? e2PatternRefToBankNumber(p.parts[idx].sampleId!) : 0);
const aktiv = (p: E2PatternInput, idx: number) => p.parts[idx].steps.filter((s) => s.active).length;

describe("bauePaare", () => {
  const projekt = projektMitVox();
  const lang = projekt.samples.find((s) => s.rolle === "melo" && s.takte === 8)!;
  const rezept = regelRezept(projekt, { modus: "jam", melo: lang.name });
  const { patterns, hinweise } = bauePaare(rezept, projekt, { startSlot: 1, variation: false });
  const paare = voxPaare(projekt, lang.name);

  it("je Vocal-Paar drei Patterns: A, B, KICK — A ↔ B gekettet, KICK ohne Kette", () => {
    expect(paare.length).toBeGreaterThanOrEqual(2);
    expect(patterns).toHaveLength(3 * paare.length);
    paare.forEach((_, k) => {
      const a = patterns[3 * k];
      const b = patterns[3 * k + 1];
      const kick = patterns[3 * k + 2];
      expect(a.name).toMatch(new RegExp(`V${k + 1}A$`));
      expect(b.name).toMatch(new RegExp(`V${k + 1}B$`));
      expect(kick.name).toMatch(new RegExp(`KICK${k + 1}$`));
      // 1-basierte Slots: A zeigt auf B, B zurueck auf A, KICK auf nichts
      expect(a.chainTo).toBe(3 * k + 2);
      expect(b.chainTo).toBe(3 * k + 1);
      expect(kick.chainTo).toBe(0);
      expect(a.chainRepeat).toBe(1);
      expect(b.chainRepeat).toBe(1);
    });
    expect(hinweise.join(" ")).toMatch(/A ↔ B/);
  });

  it("kein Alternate, Vocal nur auf Part 16 (A-Haelfte in A, B-Haelfte in B), Part 15 leer", () => {
    for (const p of patterns) {
      expect(p.alternate13_14).toBe(false);
      expect(p.alternate15_16).toBe(false);
      expect(aktiv(p, 14)).toBe(0);
      expect(p.parts[14].muted).toBe(true);
    }
    paare.forEach((pa, k) => {
      const a = patterns[3 * k];
      const b = patterns[3 * k + 1];
      const pb = projekt.samples.find((x) => x.gruppe === pa.gruppe && x.chunk === 1)!;
      expect(nr(a, 15)).toBe(pa.nr);
      expect(nr(b, 15)).toBe(pb.nr);
      expect(nr(a, 15)).not.toBe(nr(b, 15));
      expect(aktiv(a, 15)).toBe(1);
      expect(aktiv(b, 15)).toBe(1);
      expect(a.parts[15].muted).toBe(false);
      expect(b.parts[15].muted).toBe(false);
    });
  });

  it("Acht-Takt-Melo: Trigger nur im A-Pattern, im B-Pattern laeuft sie weiter (wach, kein Trigger); Part 14 leer", () => {
    const a = patterns[0];
    const b = patterns[1];
    expect(nr(a, 12)).toBe(lang.nr);
    expect(aktiv(a, 12)).toBe(1);
    expect(a.parts[12].muted).toBe(false);
    expect(aktiv(b, 12)).toBe(0);
    expect(b.parts[12].muted).toBe(false);
    expect(aktiv(a, 13)).toBe(0);
    expect(a.parts[13].muted).toBe(true);
  });

  it("KICK: Drums wie A, Melodie und Vocal gemutet, Steps bleiben zum Entmuten", () => {
    const a = patterns[0];
    const kick = patterns[2];
    expect(kick.parts[0].muted).toBe(false);
    expect(aktiv(kick, 0)).toBe(aktiv(a, 0));
    for (const idx of [12, 13, 14, 15]) expect(kick.parts[idx].muted).toBe(true);
    expect(aktiv(kick, 15)).toBe(1);
    expect(kick.motionSlots).toBeUndefined();
    expect(a.motionSlots).toBeUndefined();
  });

  it("Vier-Takt-Melo triggert in A und B; Jam-Pattern nutzt dasselbe Layout ohne Alternate", () => {
    const vier = projekt.samples.find((s) => s.rolle === "melo" && s.takte === 4)!;
    const r = regelRezept(projekt, { modus: "jam", melo: vier.name });
    const p = bauePaare(r, projekt, { variation: false }).patterns;
    expect(aktiv(p[0], 12)).toBe(1);
    expect(aktiv(p[1], 12)).toBe(1);
    const jam = baueRezept(r, projekt).patterns[0];
    expect(jam.alternate13_14).toBe(false);
    expect(jam.alternate15_16).toBe(false);
    expect(aktiv(jam, 13)).toBe(0);
    expect(aktiv(jam, 14)).toBe(0);
  });

  it("bauePaareProMelo verteilt die Paare reihum auf die Melodien — jedes Paar genau einmal", () => {
    const melos = projekt.samples.filter((s) => s.rolle === "melo" && s.kind === "loop").slice(0, 2);
    const rezepte = melos.map((m) => regelRezept(projekt, { modus: "jam", melo: m.name }));
    const { patterns: pm } = bauePaareProMelo(rezepte, projekt);
    expect(pm).toHaveLength(3 * paare.length);
    const vocals = pm.filter((_, i) => i % 3 === 0).map((p) => nr(p, 15));
    expect(new Set(vocals).size).toBe(paare.length);
  });

  it("erzeuge(aufbau) liefert Paare mit KICK und passendem Dateinamen", () => {
    const e = erzeuge(projekt, { modus: "jam", bpm: 180, aufbau: true, melo: lang.name });
    expect(e.dateiname).toMatch(/-paare\.e2sallpat$/);
    expect(e.patterns.some((p) => /KICK1$/.test(p.name))).toBe(true);
    expect(e.warumSo).toMatch(/A ↔ B/);
  });
});

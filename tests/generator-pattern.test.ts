import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { scanne } from "../src/core/sampleScan";
import { planeBank } from "../src/core/bankPlan";
import { regelRezept, regelRezeptProMelo } from "../src/core/rezept";
import { baueRezept, baueProMelo, baueAufbau, baueProMeloAufbau, alsAllPat, alsPat } from "../src/core/patternGen";
import { parseElectribeAllPatBank, parseElectribePattern } from "../src/core/electribeImport";
import { e2PatternRefToBankNumber } from "../src/core/e2sPatternSampleLink";

const KORG3 = path.resolve("examples/e2s/korg3");
const eingaben = fs
  .readdirSync(KORG3)
  .filter((f) => f.endsWith(".wav"))
  .map((f) => {
    const w = parseWav(new Uint8Array(fs.readFileSync(path.join(KORG3, f))));
    return { name: f, pcm: w.pcm, sampleRate: w.sampleRate };
  });
const { projekt } = planeBank(scanne(eingaben).eintraege, { name: "korg3", bpm: 180, bankZeit: "x" });
const nummern = new Set(projekt.samples.map((s) => s.nr));

describe("patternGen", () => {
  it("jam: ein Pattern, 64 Steps, alle Refs in der Bank, Parts ohne Steps gemutet", () => {
    const { patterns } = baueRezept(regelRezept(projekt, { modus: "jam" }), projekt);
    expect(patterns).toHaveLength(1);
    const p = patterns[0];
    expect(p.stepLength).toBe(64);
    expect(p.bpm).toBe(180);
    expect(p.parts).toHaveLength(16);
    for (const part of p.parts) {
      const aktiv = part.steps.some((s) => s.active);
      expect(part.muted).toBe(!aktiv);
      if (aktiv) expect(nummern.has(e2PatternRefToBankNumber(part.sampleId!))).toBe(true);
    }
    expect(p.parts.filter((x) => !x.muted).length).toBeGreaterThanOrEqual(8);
  });
  it("jam: 4-Takt-Melo triggert 13 und 14; 8-Takt-Melo triggert nur 13, 14 schweigt", () => {
    const vier = baueRezept(regelRezept(projekt, { modus: "jam", melo: "BaReTT MeLo" }), projekt).patterns[0];
    expect(vier.parts[12].steps.filter((s) => s.active)).toHaveLength(1);
    expect(vier.parts[13].steps.filter((s) => s.active)).toHaveLength(1);
    const lang = projekt.samples.find((s) => s.rolle === "melo" && s.takte === 8)!;
    expect(lang).toBeDefined();
    const p = baueRezept(regelRezept(projekt, { modus: "jam", melo: lang.name }), projekt).patterns[0];
    expect(p.parts[12].steps.filter((s) => s.active)).toHaveLength(1);
    expect(p.parts[13].muted).toBe(true);
    expect(p.alternate13_14).toBe(true);
  });
  it("miniset: Kette ueber 6 Patterns, letztes ohne Ziel, Intensitaet steuert Mutes, Namen", () => {
    const { patterns } = baueRezept(regelRezept(projekt, { modus: "miniset" }), projekt, { startSlot: 10 });
    expect(patterns).toHaveLength(6);
    expect(patterns.map((p) => p.chainTo)).toEqual([11, 12, 13, 14, 15, 0]);
    expect(patterns[0].chainRepeat).toBe(2);
    const wach = (p: (typeof patterns)[0]) => p.parts.filter((x) => !x.muted).length;
    expect(wach(patterns[2])).toBeGreaterThan(wach(patterns[0]));
    expect(patterns.map((p) => p.name)).toEqual(["BaRe INTRO", "BaRe AUFBAU", "BaRe DROP 1", "BaRe BREAK", "BaRe DROP 2", "BaRe OUTRO"]);
  });
  it("promelo: ein Pattern je Melodie, alsAllPat liefert 250 Slots und ist rueckparsbar", () => {
    const { patterns } = baueProMelo(regelRezeptProMelo(projekt), projekt);
    const melos = projekt.samples.filter((s) => s.rolle === "melo" && s.kind === "loop" && s.takte >= 2 && (s.chunk === undefined || s.chunk === 0));
    expect(patterns.length).toBe(melos.length);
    const buf = alsAllPat(patterns);
    const bank = parseElectribeAllPatBank(buf);
    expect(bank.patterns).toHaveLength(250);
    expect(bank.patterns[0].bpm).toBe(180);
    expect(bank.patterns[patterns.length].name.trim()).toBe("-");
  });
  it("alsPat: Einzelpattern als .e2spat (16640 Bytes) und rueckparsbar", () => {
    const { patterns } = baueRezept(regelRezept(projekt, { modus: "jam" }), projekt);
    const bytes = alsPat(patterns[0]);
    expect(bytes.byteLength).toBe(16640);
    const p = parseElectribePattern(bytes);
    expect(p.bpm).toBe(180);
    expect(p.name.trim()).toBe(patterns[0].name);
  });
  it("aufbau: identische Steps ueberall, Mutes wachsen monoton, Kick erst im Drop, Kette mit 2 Durchgaengen", () => {
    const { patterns } = baueAufbau(regelRezept(projekt, { modus: "jam" }), projekt, { startSlot: 5 });
    expect(patterns.length).toBeGreaterThanOrEqual(3);
    const drop = patterns[patterns.length - 1];
    expect(drop.name.endsWith("DROP")).toBe(true);
    // Steps in jedem Pattern identisch zum Drop — nur die Mutes unterscheiden sich
    for (const p of patterns) {
      for (let idx = 0; idx < 16; idx++) expect(p.parts[idx].steps).toEqual(drop.parts[idx].steps);
    }
    // Kicks (Part 1/2) bis zum Drop gemutet, aber mit gesetzten Steps
    for (const p of patterns.slice(0, -1)) {
      expect(p.parts[0].muted).toBe(true);
      expect(p.parts[0].steps.some((s) => s.active)).toBe(true);
    }
    expect(drop.parts[0].muted).toBe(false);
    // Stufe 1 hat die Melo wach
    expect(patterns[0].parts[12].muted).toBe(false);
    // einmal entmutet bleibt entmutet
    for (let i = 1; i < patterns.length; i++) {
      for (let idx = 0; idx < 16; idx++) {
        if (!patterns[i - 1].parts[idx].muted) expect(patterns[i].parts[idx].muted).toBe(false);
      }
    }
    patterns.slice(0, -1).forEach((p, i) => {
      expect(p.chainTo).toBe(5 + i + 1);
      expect(p.chainRepeat).toBe(2);
    });
    expect(drop.chainTo).toBe(0);
  });
  it("aufbau pro melo: je Melodie eine Kette, Slots fortlaufend", () => {
    const rezepte = regelRezeptProMelo(projekt);
    const { patterns } = baueProMeloAufbau(rezepte, projekt);
    expect(patterns.length).toBeGreaterThan(rezepte.length);
    const dropIdx = patterns.map((p, i) => (p.name.endsWith("DROP") ? i : -1)).filter((i) => i >= 0);
    expect(dropIdx.length).toBe(rezepte.length);
    for (const i of dropIdx) expect(patterns[i].chainTo).toBe(0);
    // Ketten zeigen jeweils auf den naechsten Slot (1-basiert = Index + 1)
    patterns.forEach((p, i) => {
      if (!p.name.endsWith("DROP")) expect(p.chainTo).toBe(i + 2);
    });
  });
  it("golden: gleiches Rezept → gleiche Bytes", () => {
    const r = regelRezept(projekt, { modus: "miniset" });
    const a = alsAllPat(baueRezept(r, projekt).patterns);
    const b = alsAllPat(baueRezept(r, projekt).patterns);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

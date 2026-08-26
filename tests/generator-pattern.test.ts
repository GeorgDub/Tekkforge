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
import { voxSegmentEintrag } from "../src/core/generatorSession";
import { voxPaare } from "../src/core/patternGen";
import { fillSchlaege } from "../src/core/patternVarianten";
import { E2S_ALLPAT_PREFIX_SIZE, E2S_BODY_SIZE, PATTERN_CHAIN_TO_OFF } from "../src/core/e2sExport";

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

/** korg3 plus drei synthetische 8-Takt-Vocal-Segmente eines Lieds "Amph". */
function projektMitVox() {
  const frames = Math.round(8 * (240 / 180) * 44100);
  const voxE = [1, 2, 3].map((n) => voxSegmentEintrag("Amph", n, new Float32Array(frames).map((_, i) => Math.sin(i / (18 + 3 * n)) * 0.5)));
  const { projekt: pv } = planeBank(scanne(eingaben).eintraege.concat(voxE), { name: "amph", bpm: 180, bankZeit: "x" });
  const paarA = pv.samples.filter((s) => s.rolle === "vox" && s.chunk === 0 && /^Amph V/.test(s.name)).sort((a, b) => a.nr - b.nr);
  return { projekt: pv, paarA };
}

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
  it("aufbau: Steps ueberall positionsgleich, Mutes wachsen monoton, Kick erst im Drop, Kette verbunden", () => {
    const { patterns } = baueAufbau(regelRezept(projekt, { modus: "jam" }), projekt, { startSlot: 5 });
    expect(patterns.length).toBeGreaterThanOrEqual(3);
    const dropIdx = patterns.findIndex((p) => p.name.endsWith("DROP"));
    const drop = patterns[dropIdx];
    // Aktive Step-Positionen in jedem Pattern wie im Drop (Velocities duerfen
    // abweichen: Aufbau gedimmt, Fill/Punch) — nur die Mutes unterscheiden sich.
    // Ausnahme: Snare-Fill (Part 3) im letzten Takt der letzten Aufbau-Stufe.
    const aktivMuster = (p: (typeof patterns)[0], idx: number) => p.parts[idx].steps.map((s) => !!s.active).join("");
    patterns.forEach((p, i) => {
      for (let idx = 0; idx < 16; idx++) {
        if (idx === 2 && i === dropIdx - 1) continue;
        expect(aktivMuster(p, idx)).toBe(aktivMuster(drop, idx));
      }
    });
    // Kicks (Part 1/2) bis zum Drop gemutet, aber mit gesetzten Steps
    for (const p of patterns.slice(0, dropIdx)) {
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
      expect(p.chainRepeat).toBe(i === dropIdx ? 4 : 2);
    });
    expect(patterns[patterns.length - 1].chainTo).toBe(0);
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
  it("vocal-abdeckung: AUF traegt Paar 1, DROP Paar 2, VRS-Patterns den Rest — alle Segmente kommen vor", () => {
    const { projekt: pv, paarA } = projektMitVox();
    const { patterns } = baueAufbau(regelRezept(pv, { modus: "jam" }), pv, { startSlot: 1 });
    const dropIdx = patterns.findIndex((p) => p.name.endsWith("DROP"));
    expect(dropIdx).toBeGreaterThan(0);
    const nrVon = (p: (typeof patterns)[0], idx: number) => e2PatternRefToBankNumber(p.parts[idx].sampleId!);
    // AUF-Patterns: erstes Paar; DROP: zweites; VRS-Patterns: die uebrigen in Liedreihenfolge
    for (const p of patterns.slice(0, dropIdx)) expect(nrVon(p, 14)).toBe(paarA[0].nr);
    expect(nrVon(patterns[dropIdx], 14)).toBe(paarA[1].nr);
    const extras = patterns.slice(dropIdx + 1);
    expect(extras.map((p) => p.name.replace(/^\S+ /, ""))).toEqual(paarA.slice(2).map((_, k) => `VRS${k + 3}`));
    extras.forEach((p, k) => expect(nrVon(p, 14)).toBe(paarA[k + 2].nr));
    // Kette laeuft bis zum letzten VRS-Pattern durch
    patterns.slice(0, -1).forEach((p, i) => expect(p.chainTo).toBe(i + 2));
    expect(patterns[patterns.length - 1].chainTo).toBe(0);
    expect(patterns[dropIdx].chainRepeat).toBe(4);
    for (const p of extras) expect(p.chainRepeat).toBe(2);
  });
  it("vocal-abdeckung: Paar liegt als A/B auf Parts 15/16, beide mit Steps, im Drop wach", () => {
    const { projekt: pv, paarA } = projektMitVox();
    const { patterns } = baueAufbau(regelRezept(pv, { modus: "jam" }), pv);
    const drop = patterns.find((p) => p.name.endsWith("DROP"))!;
    expect(e2PatternRefToBankNumber(drop.parts[14].sampleId!)).toBe(paarA[1].nr);
    expect(e2PatternRefToBankNumber(drop.parts[15].sampleId!)).toBe(paarA[1].nr + 1);
    expect(drop.parts[14].steps.some((s) => s.active)).toBe(true);
    expect(drop.parts[15].steps.some((s) => s.active)).toBe(true);
    expect(drop.parts[14].muted).toBe(false);
    expect(drop.parts[15].muted).toBe(false);
    expect(drop.alternate15_16).toBe(true);
  });
  it("drop-punch: Kicks im Drop auf 127, Aufbau gedimmt, Snare-Fill vor dem Drop, Bass lauter", () => {
    const { projekt: pv } = projektMitVox();
    const { patterns } = baueAufbau(regelRezept(pv, { modus: "jam" }), pv);
    const dropIdx = patterns.findIndex((p) => p.name.endsWith("DROP"));
    const drop = patterns[dropIdx];
    const auf1 = patterns[0];
    const letzteAuf = patterns[dropIdx - 1];
    for (const s of drop.parts[0].steps) if (s.active) expect(s.velocity).toBe(127);
    // Hats im Aufbau leiser als im Drop (Velocity gedimmt)
    const vel = (p: (typeof patterns)[0], idx: number) => p.parts[idx].steps.find((s) => s.active)!.velocity!;
    expect(vel(auf1, 4)).toBeLessThan(vel(drop, 4));
    // Melo bleibt ungedimmt
    expect(vel(auf1, 12)).toBe(vel(drop, 12));
    // Snare-Fill im letzten Takt der letzten Aufbau-Stufe
    const fill = letzteAuf.parts[2].steps.slice(48).filter((s) => s.active).length;
    expect(fill).toBeGreaterThanOrEqual(6);
    expect(drop.parts[2].steps.slice(48).filter((s) => s.active).length).toBeLessThan(fill);
    expect(drop.parts[8].volume!).toBeGreaterThan(auf1.parts[8].volume!);
  });
  it("der Snare-Fill kommt aus derselben Definition wie im Editor", () => {
    // Generator und Editor bauten den Wirbel frueher getrennt und mit
    // verschiedenen Werten. Dieser Test faellt, sobald sie wieder auseinander-
    // laufen — und nicht erst, wenn es jemand am Geraet hoert.
    const { projekt: pv } = projektMitVox();
    const { patterns } = baueAufbau(regelRezept(pv, { modus: "jam" }), pv);
    const dropIdx = patterns.findIndex((p) => p.name.endsWith("DROP"));
    const letzteAuf = patterns[dropIdx - 1];
    for (const schlag of fillSchlaege(64)) {
      const s = letzteAuf.parts[2].steps[schlag.index];
      expect(s.active).toBe(true);
      expect(s.velocity).toBe(schlag.velocity);
      expect(s.gate).toBe(schlag.gate);
    }
  });
  it("vocal-abdeckung pro melo: Paare laufen ueber die Ketten weiter, Extras nur am Ende", () => {
    const { projekt: pv, paarA } = projektMitVox();
    const rezepte = regelRezeptProMelo(pv);
    expect(rezepte.length).toBeGreaterThanOrEqual(2);
    const { patterns } = baueProMeloAufbau(rezepte, pv);
    const nrVon = (p: (typeof patterns)[0]) => e2PatternRefToBankNumber(p.parts[14].sampleId!);
    const dropIdx = patterns.map((p, i) => (p.name.endsWith("DROP") ? i : -1)).filter((i) => i >= 0);
    // Kette 1: AUF -> Paar 1, DROP -> Paar 2; Kette 2 macht bei Paar 3 weiter
    expect(nrVon(patterns[0])).toBe(paarA[0].nr);
    expect(nrVon(patterns[dropIdx[0]])).toBe(paarA[1].nr);
    expect(nrVon(patterns[dropIdx[0] + 1])).toBe(paarA[2 % paarA.length].nr);
    // jedes Paar ist irgendwo hoerbar (AUF5/DROP/VRS zusammen decken alles ab)
    const getragen = new Set(patterns.map(nrVon));
    for (const p of paarA) expect(getragen.has(p.nr)).toBe(true);
    // VRS-Extras haengen hoechstens an der LETZTEN Kette
    const vrsIdx = patterns.map((p, i) => (/ VRS\d+$/.test(p.name) ? i : -1)).filter((i) => i >= 0);
    for (const i of vrsIdx) expect(i).toBeGreaterThan(dropIdx[dropIdx.length - 1]);
  });
  it("alsAllPat: Ketten ueber Slot 250 werden gekappt statt Selbstschleife", () => {
    const { projekt: pv } = projektMitVox();
    const { patterns } = baueAufbau(regelRezept(pv, { modus: "jam" }), pv, { startSlot: 248 });
    expect(patterns.length).toBeGreaterThanOrEqual(4);
    const buf = new Uint8Array(alsAllPat(patterns, 248));
    // Slot 250 (Index 249) darf nicht auf sich selbst oder ueber 250 zeigen —
    // chainTo als u16 LE direkt aus dem Pattern-Body gelesen
    const off = E2S_ALLPAT_PREFIX_SIZE + 249 * E2S_BODY_SIZE + PATTERN_CHAIN_TO_OFF;
    const chainTo = buf[off] | (buf[off + 1] << 8);
    expect(chainTo).toBe(0);
  });
  it("voxPaare: nur Paare des eigenen Lieds; fremdes Lied ohne Vocals bekommt keine", () => {
    const frames = Math.round(8 * (240 / 180) * 44100);
    const pcmVon = (f: number) => new Float32Array(frames).map((_, i) => Math.sin(i / f) * 0.5);
    const voxA = [1, 2].map((n) => ({ ...voxSegmentEintrag("LiedA", n, pcmVon(20 + n)), lied: "LiedA" }));
    const voxB = [1].map((n) => ({ ...voxSegmentEintrag("LiedB", n, pcmVon(30)), lied: "LiedB" }));
    const eintr = scanne(eingaben).eintraege.map((e) => ({ ...e, lied: "LiedB" }));
    const { projekt: pv } = planeBank(eintr.concat(voxA, voxB), { name: "zwei", bpm: 180, bankZeit: "x" });
    const meloB = pv.samples.find((s) => s.rolle === "melo" && s.kind === "loop")!;
    expect(meloB.lied).toBe("LiedB");
    const paareB = voxPaare(pv, meloB.name);
    expect(paareB.length).toBe(1);
    expect(paareB[0].name.startsWith("LiedB")).toBe(true);
  });
  it("golden: gleiches Rezept → gleiche Bytes", () => {
    const r = regelRezept(projekt, { modus: "miniset" });
    const a = alsAllPat(baueRezept(r, projekt).patterns);
    const b = alsAllPat(baueRezept(r, projekt).patterns);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });
});

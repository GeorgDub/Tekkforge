import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { scanne } from "../src/core/sampleScan";
import { planeBank } from "../src/core/bankPlan";
import { regelRezept } from "../src/core/rezept";
import { bauePaare } from "../src/core/patternGen";
import { erzeuge } from "../src/core/generatorSession";
import { e2PatternRefToBankNumber } from "../src/core/e2sPatternSampleLink";
import { wendeBesetzungAn, besetzungAusThema, besetzungKandidaten, besetzungLeer, BESETZUNG_FELDER } from "../src/core/besetzung";

const KORG3 = path.resolve("examples/e2s/korg3");
const eingaben = fs
  .readdirSync(KORG3)
  .filter((f) => f.endsWith(".wav"))
  .map((f) => {
    const w = parseWav(new Uint8Array(fs.readFileSync(path.join(KORG3, f))));
    return { name: f, pcm: w.pcm, sampleRate: w.sampleRate };
  });
const { projekt } = planeBank(scanne(eingaben).eintraege, { name: "korg3", bpm: 180, bankZeit: "x", rateNachRolloff: false });
const nr = (p: { parts: { sampleId?: number }[] }, idx: number) => e2PatternRefToBankNumber(p.parts[idx].sampleId!);

describe("besetzung", () => {
  const rezept = regelRezept(projekt, { modus: "jam" });
  const kicks = projekt.samples.filter((s) => s.rolle === "kick");
  const snares = projekt.samples.filter((s) => s.rolle === "snare");
  const hats = projekt.samples.filter((s) => s.rolle === "hat");

  it("Felder und Kandidaten: passende Rollen zuerst, alles andere dahinter", () => {
    expect(BESETZUNG_FELDER.map((f) => f.key)).toContain("kick");
    const k = besetzungKandidaten(projekt, BESETZUNG_FELDER.find((f) => f.key === "kick")!);
    expect(k.passend.length).toBe(kicks.length);
    expect(k.passend.every((s) => s.rolle === "kick")).toBe(true);
    expect(k.andere.length + k.passend.length).toBe(projekt.samples.length);
  });

  it("besetzungAusThema spiegelt das Rezept, leer bleibt leer", () => {
    const b = besetzungAusThema(rezept.thema, projekt);
    expect(b.snare).toBe(rezept.thema.snare);
    expect(b.hat1).toBe(rezept.thema.hats[0]);
    expect(kicks.map((k) => k.name)).toContain(b.kick);
    expect(besetzungLeer({})).toBe(true);
    expect(besetzungLeer({ snare: "x" })).toBe(false);
  });

  it("wendeBesetzungAn setzt die gewaehlten Samples fuer alle Patterns, Unbekanntes wird gemeldet", () => {
    const andererKick = kicks.find((k) => k.familie !== rezept.thema.kickFamilie) ?? kicks[kicks.length - 1];
    const snare = snares[snares.length - 1];
    const hat = hats[0];
    const { rezept: r2, unbekannt } = wendeBesetzungAn(rezept, { kick: andererKick.name, snare: snare.name, hat1: hat.name, clap: "gibt es nicht" }, projekt);
    expect(unbekannt).toEqual(["gibt es nicht"]);
    expect(r2.thema.snare).toBe(snare.name);
    expect(r2.thema.hats[0]).toBe(hat.name);
    expect(r2.thema.hats[1]).toBe(rezept.thema.hats[1]);
    expect(r2.thema.clap).toBe(rezept.thema.clap);
    expect(rezept.thema.snare).not.toBe(snare.name === rezept.thema.snare ? "" : snare.name); // Quelle unangetastet
    const { patterns } = bauePaare(r2, projekt, { variation: false });
    for (const p of patterns) {
      expect(nr(p, 0)).toBe(kicks.find((k) => k.familie === r2.thema.kickFamilie)!.nr === andererKick.nr ? andererKick.nr : nr(p, 0));
      expect(nr(p, 2)).toBe(snare.nr);
      expect(nr(p, 4)).toBe(hat.nr);
    }
    expect(patterns.some((p) => nr(p, 0) === andererKick.nr)).toBe(true);
  });

  it("erzeuge nimmt die Besetzung fuer jam und promelo", () => {
    const snare = snares[snares.length - 1];
    const e = erzeuge(projekt, { modus: "jam", bpm: 180, aufbau: true, besetzung: { snare: snare.name } });
    expect(e.patterns.every((p) => nr(p, 2) === snare.nr)).toBe(true);
    expect(e.rezepte[0].thema.snare).toBe(snare.name);
    const pm = erzeuge(projekt, { modus: "promelo", bpm: 180, aufbau: false, besetzung: { snare: snare.name } });
    expect(pm.rezepte.every((r) => r.thema.snare === snare.name)).toBe(true);
    expect(pm.patterns.every((p) => nr(p, 2) === snare.nr)).toBe(true);
  });
});

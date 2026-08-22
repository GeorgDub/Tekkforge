import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { scanne } from "../src/core/sampleScan";
import { planeBank } from "../src/core/bankPlan";
import { zusammenfassung, tekkDrumsEmpfohlen, dateiArt, erzeuge } from "../src/core/generatorSession";
import { parseElectribeAllPatBank, parseElectribePattern } from "../src/core/electribeImport";

const KORG3 = path.resolve("examples/e2s/korg3");
const eingaben = fs
  .readdirSync(KORG3)
  .filter((f) => f.endsWith(".wav"))
  .map((f) => {
    const w = parseWav(new Uint8Array(fs.readFileSync(path.join(KORG3, f))));
    return { name: f, pcm: w.pcm, sampleRate: w.sampleRate };
  });
const { eintraege } = scanne(eingaben);
const { projekt } = planeBank(eintraege, { name: "korg3", bpm: 180, bankZeit: "x" });

describe("generatorSession", () => {
  it("zusammenfassung: Rollen, Sekunden, MB, Tempo 180, ein Volume, keine tekk-Drums noetig", () => {
    const z = zusammenfassung(eintraege);
    expect(z.anzahl).toBe(eintraege.length);
    expect(z.rollen.kick).toBe(16);
    expect(z.tempoVorschlag).toBe(180);
    expect(z.sekunden).toBeGreaterThan(80);
    expect(z.megabyte).toBeCloseTo((z.sekunden * 2 * 44100) / 1048576, 1);
    expect(z.volumesNoetig).toBe(1);
    expect(z.tekkEmpfohlen).toBe(false);
  });
  it("tekkDrumsEmpfohlen: ohne Kick oder ohne Hat oder ohne Snare/Clap → true", () => {
    expect(tekkDrumsEmpfohlen(eintraege.filter((e) => e.rolle !== "kick"))).toBe(true);
    expect(tekkDrumsEmpfohlen(eintraege.filter((e) => e.rolle !== "hat"))).toBe(true);
    expect(tekkDrumsEmpfohlen(eintraege.filter((e) => e.rolle !== "snare" && e.rolle !== "clap"))).toBe(true);
    expect(tekkDrumsEmpfohlen(eintraege)).toBe(false);
  });
  it("dateiArt", () => {
    expect(dateiArt("Kick.WAV")).toBe("wav");
    expect(dateiArt("x.mp3")).toBe("audio");
    expect(dateiArt("x.m4a")).toBe("audio");
    expect(dateiArt("x.flp")).toBe("skip");
    expect(dateiArt("manifest.json")).toBe("skip");
  });
  it("erzeuge jam → .e2spat mit einem Pattern und Begruendung", () => {
    const e = erzeuge(projekt, { modus: "jam", bpm: 180 });
    expect(e.patterns).toHaveLength(1);
    expect(e.dateiname).toBe("KORG3-jam.e2spat");
    expect(e.bytes.byteLength).toBe(16640);
    expect(parseElectribePattern(e.bytes).bpm).toBe(180);
    expect(e.warumSo).toContain("BaReTT");
  });
  it("erzeuge miniset → .e2sallpat ab Slot 10 mit Kette", () => {
    const e = erzeuge(projekt, { modus: "miniset", bpm: 176, startSlot: 10, beschreibung: "hart" });
    expect(e.patterns).toHaveLength(6);
    expect(e.dateiname).toBe("KORG3-miniset.e2sallpat");
    expect(e.startSlot).toBe(10);
    const bank = parseElectribeAllPatBank(e.bytes);
    expect(bank.patterns[9].bpm).toBe(176);
    expect(bank.patterns[9].name.trim()).toBe("BaRe INTRO");
    expect(bank.patterns[0].name.trim()).toBe("-");
  });
  it("erzeuge promelo → ein Rezept je Melodie", () => {
    const e = erzeuge(projekt, { modus: "promelo", bpm: 180 });
    expect(e.rezepte.length).toBe(e.patterns.length);
    expect(e.patterns.length).toBeGreaterThanOrEqual(6);
    expect(e.dateiname).toBe("KORG3-promelo.e2sallpat");
    expect(e.warumSo).toContain("Melodien");
  });
});

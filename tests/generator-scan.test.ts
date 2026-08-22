import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { rolleFuer, familie, sauberName, scanne, type ScanEingabe } from "../src/core/sampleScan";

const KORG3 = path.resolve("examples/e2s/korg3");
const manifest = JSON.parse(fs.readFileSync(path.join(KORG3, "manifest.json"), "utf8")) as {
  samples: { file: string; role: string; family: string; seconds: number }[];
};

function lade(datei: string): ScanEingabe {
  const w = parseWav(new Uint8Array(fs.readFileSync(path.join(KORG3, datei))));
  return { name: datei, pcm: w.pcm, sampleRate: w.sampleRate };
}

describe("sampleScan", () => {
  it("rolleFuer: Namen-Heuristik", () => {
    expect(rolleFuer("RoBBaFFerT_KicK_30", 0.36, -6)).toBe("kick");
    expect(rolleFuer("HD_HaT", 0.18, -17)).toBe("hat");
    expect(rolleFuer("ZaHnI_To[N]-154", 0.17, -11)).toBe("ton");
    expect(rolleFuer("Klatsch", 0.7, -5)).toBe("clap");
    expect(rolleFuer("marviis 170 bass", 0.46, -6)).toBe("bass");
    expect(rolleFuer("GZUZ GHETTO KING", 13.3, -19)).toBe("vox");
    expect(rolleFuer("_jfxb_SweepDown_01", 12, -22)).toBe("fx");
    expect(rolleFuer("HyPer__MeLo", 10.6, -13)).toBe("melo");
    expect(rolleFuer("Tommi Schore - Track 1", 217, -9)).toBe("track");
  });
  it("rolleFuer: Fallback ueber Laenge/Pegel", () => {
    expect(rolleFuer("exo2", 0.3, -2.4)).toBe("kick");
    expect(rolleFuer("irgendwas", 0.3, -15)).toBe("perc");
    expect(rolleFuer("irgendwas", 1.5, -15)).toBe("ton");
    expect(rolleFuer("irgendwas", 6, -15)).toBe("melo");
  });
  it("familie: Nummern und Klammern weg, Unterstriche zu Leerzeichen", () => {
    expect(familie("Teetoo_VoGeL_KicK103!")).toBe("teetoo vogel kick");
    expect(familie("TetoKI (11)")).toBe("tetoki");
    expect(familie("1TetoKick")).toBe("tetokick");
    expect(familie("bd 1-01")).toBe("bd");
  });
  it("sauberName: ASCII, 16 Zeichen, Umlaute", () => {
    expect(sauberName("Für Sehn sucht1_AUDIO_2")).toBe("Fuer Sehn sucht1");
    expect(sauberName("RoBBaFFerT_KicK_30")).toBe("RoBBaFFerT KicK");
  });
  it("scanne: Rollen der korg3-Samples stimmen mit dem Manifest ueberein", () => {
    const eingaben = manifest.samples.map((m) => lade(m.file));
    const { eintraege } = scanne(eingaben);
    expect(eintraege.length).toBe(manifest.samples.length);
    for (const m of manifest.samples) {
      const e = eintraege.find((x) => x.datei === m.file)!;
      expect(e.rolle, m.file).toBe(m.role);
      expect(Math.abs(e.sekunden - m.seconds)).toBeLessThan(0.02);
    }
  });
  it("scanne: exakte Dublette und stille Datei fallen weg, overrides greifen", () => {
    const a = lade("Klatsch.wav");
    const still: ScanEingabe = { name: "still.wav", pcm: new Float32Array(4410).fill(0.001), sampleRate: 44100 };
    const { eintraege, uebersprungen } = scanne([a, { ...a, name: "Klatsch Kopie.wav" }, still], { "Klatsch.wav": "snare" });
    expect(eintraege.map((e) => e.datei)).toEqual(["Klatsch.wav"]);
    expect(eintraege[0].rolle).toBe("snare");
    expect(uebersprungen.map((u) => u.datei).sort()).toEqual(["Klatsch Kopie.wav", "still.wav"]);
  });
});

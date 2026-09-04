import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { klangProfil } from "../src/core/klangProfil";
import { rolleAusKlang, rolleFuer, scanne, KLANG_DUBLETTE, type ScanEingabe } from "../src/core/sampleScan";

const KORG3 = path.resolve("examples/e2s/korg3");
function lade(datei: string): ScanEingabe {
  const w = parseWav(new Uint8Array(fs.readFileSync(path.join(KORG3, datei))));
  return { name: datei, pcm: w.pcm, sampleRate: w.sampleRate };
}
const profilVon = (datei: string) => {
  const e = lade(datei);
  return klangProfil(e.pcm, e.sampleRate);
};

describe("rolleAusKlang: die Messung an echten Samples", () => {
  it("erkennt Kicks am Bassanteil", () => {
    for (const datei of ["RoBBaFFerT KicK4.wav", "KeTTeR KicK.wav", "A-DLL-KicK-1!.wav", "SpeKeR KiCK 777.wav"]) {
      const k = rolleAusKlang(profilVon(datei));
      expect(k.rolle, datei).toBe("kick");
      expect(k.sicherheit, datei).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("erkennt Hats an Helligkeit und spitzer Transiente", () => {
    for (const datei of ["RoBBaFFerT HaT 1.wav", "Puff hat2.wav", "spetzial-hat25.wav", "spetzial-hat35.wav"]) {
      expect(rolleAusKlang(profilVon(datei)).rolle, datei).toBe("hat");
    }
  });

  it("haelt eine Snare fuer einen Schlag, nicht fuer ein Zischen", () => {
    // Hell wie eine Hat, aber flach — der Scheitelfaktor macht den Unterschied.
    expect(rolleAusKlang(profilVon("Morbid SnaRRe 1.wav")).rolle).toBe("snare");
  });

  it("haelt lange Dateien fuer Melodien und sehr lange fuer ganze Tracks", () => {
    expect(rolleAusKlang(profilVon("HyPer MeLo.wav")).rolle).toBe("melo");
    const lang = klangProfil(new Float32Array(44100 * 90).fill(0.1), 44100);
    expect(rolleAusKlang(lang).rolle).toBe("track");
  });

  it("nennt einen Grund — sonst ist die Zuordnung nicht nachvollziehbar", () => {
    expect(rolleAusKlang(profilVon("KeTTeR KicK.wav")).grund).toMatch(/150 Hz/);
  });
});

describe("rolleFuer: der Klang ersetzt das Raten, nicht den Namen", () => {
  const hatProfil = profilVon("RoBBaFFerT HaT 1.wav");
  const kickProfil = profilVon("KeTTeR KicK.wav");

  it("die alte Verlegenheitsregel haelt eine laute Hat fuer eine Kick", () => {
    // Genau dieser Fall: kurz und laut, Name ohne Hinweis.
    expect(rolleFuer("0451", hatProfil.sekunden, -5)).toBe("kick");
  });

  it("mit gemessenem Klang wird daraus eine Hat", () => {
    expect(rolleFuer("0451", hatProfil.sekunden, -5, hatProfil)).toBe("hat");
  });

  it("und eine echte Kick bleibt eine Kick", () => {
    expect(rolleFuer("0452", kickProfil.sekunden, -5, kickProfil)).toBe("kick");
  });

  it("der Name schlaegt die Messung — er traegt, was der Nutzer weiss", () => {
    // Das Profil sagt "Hat", der Name sagt "Kick". Der Name gewinnt.
    expect(rolleFuer("RoBBaFFerT KicK", hatProfil.sekunden, -5, hatProfil)).toBe("kick");
    expect(rolleFuer("GZUZ GHETTO KING", 13.3, -19, hatProfil)).toBe("vox");
  });

  it("Rueckfall: ohne Profil bleibt alles wie vorher", () => {
    expect(rolleFuer("irgendwas", 0.3, -15)).toBe("perc");
    expect(rolleFuer("irgendwas", 1.5, -15)).toBe("ton");
    expect(rolleFuer("irgendwas", 6, -15)).toBe("melo");
  });
});

describe("scanne: Klangfarben-Dubletten", () => {
  const original = lade("KeTTeR KicK.wav");

  it("dieselbe Kick mit Vorlauf und halber Aussteuerung kommt nicht zweimal in die Bank", () => {
    // Genau der Fall, den der Wellenform-Vergleich NICHT findet: er verlangt
    // gleiche Laenge auf 50 ms genau, und 80 ms Stille davor reichen schon.
    const vorlauf = Math.round(0.08 * original.sampleRate);
    const pcm = new Float32Array(vorlauf + original.pcm.length);
    pcm.set(Float32Array.from(original.pcm, (v) => v * 0.45), vorlauf);
    const kopie: ScanEingabe = { name: "kopie mit vorlauf.wav", pcm, sampleRate: original.sampleRate };
    // Der alte Vergleich laesst sie durch …
    const laenge = pcm.length / original.sampleRate;
    expect(Math.abs(laenge - original.pcm.length / original.sampleRate)).toBeGreaterThan(0.05);
    // … der Klangvergleich nicht.
    const { eintraege, uebersprungen } = scanne([original, kopie]);
    expect(eintraege.map((e) => e.datei)).toEqual(["KeTTeR KicK.wav"]);
    expect(uebersprungen[0].grund).toMatch(/klanglich identisch/i);
  });

  it("zwei verschiedene Kicks bleiben zwei Kicks — die Schwelle trennt sauber", () => {
    const { eintraege } = scanne([lade("KeTTeR KicK.wav"), lade("RoBBaFFerT KicK4.wav")]);
    expect(eintraege).toHaveLength(2);
  });

  it("gleiche Klangfarbe bei sehr verschiedener Laenge bleibt getrennt", () => {
    // Ein 1-Takt-Ausschnitt und der ganze Loop klingen gleich und sind
    // trotzdem zwei Werkzeuge.
    const melo = lade("HyPer MeLo.wav");
    const kurz: ScanEingabe = { name: "kurz.wav", pcm: melo.pcm.slice(0, Math.round(melo.pcm.length / 4)), sampleRate: melo.sampleRate };
    const { eintraege } = scanne([melo, kurz]);
    expect(eintraege).toHaveLength(2);
  });

  it("jeder Eintrag traegt sein Profil weiter", () => {
    const { eintraege } = scanne([original]);
    expect(eintraege[0].klang.baender).toHaveLength(24);
    expect(eintraege[0].klang.tiefe).toBeGreaterThan(0.5);
    expect(KLANG_DUBLETTE).toBeGreaterThan(0);
  });
});

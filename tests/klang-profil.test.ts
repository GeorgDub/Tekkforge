import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import {
  klangProfil,
  konflikt,
  ergaenzung,
  klangAbstand,
  maxKonflikt,
  profilText,
  konfliktText,
  rauschigkeitAus,
  helligkeitAus,
  stilleAnteil,
  rhythmusDichte,
  anschlagZahl,
  BAENDER,
} from "../src/core/klangProfil";

const SR = 44100;

function sinus(hz: number, sekunden: number, amp = 0.6): Float32Array {
  const n = Math.round(sekunden * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  return out;
}

function rauschen(sekunden: number, amp = 0.4): Float32Array {
  const n = Math.round(sekunden * SR);
  const out = new Float32Array(n);
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((seed / 0x7fffffff) * 2 - 1) * amp;
  }
  return out;
}

const KORG3 = path.resolve("examples/e2s/korg3");
function lade(datei: string): { pcm: Float32Array; sampleRate: number } {
  const w = parseWav(new Uint8Array(fs.readFileSync(path.join(KORG3, datei))));
  return { pcm: w.pcm, sampleRate: w.sampleRate };
}
const profilVon = (datei: string) => {
  const { pcm, sampleRate } = lade(datei);
  return klangProfil(pcm, sampleRate);
};

describe("klangProfil", () => {
  it("misst einen tiefen Sinus als tief, dunkel und tonal", () => {
    const p = klangProfil(sinus(80, 2), SR);
    expect(p.tiefe).toBeGreaterThan(0.9);
    expect(p.helligkeit).toBeLessThan(0.2);
    expect(p.rauschig).toBeLessThan(0.2);
    expect(p.baender).toHaveLength(BAENDER);
    expect(p.baender.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 3);
    expect(p.sekunden).toBeCloseTo(2, 3);
  });

  it("misst Rauschen als hell und rauschig", () => {
    const p = klangProfil(rauschen(2), SR);
    expect(p.rauschig).toBeGreaterThan(0.7);
    expect(p.helligkeit).toBeGreaterThan(0.6);
    expect(p.tiefe).toBeLessThan(0.1);
  });

  it("Grenzfall: leerer und zu kurzer Puffer geben ein Nullprofil ohne Absturz", () => {
    for (const pcm of [new Float32Array(0), new Float32Array(100)]) {
      const p = klangProfil(pcm, SR);
      expect(p.baender.every((b) => b === 0)).toBe(true);
      expect(p.schwerpunktHz).toBe(0);
      expect(p.helligkeit).toBe(0);
      expect(Number.isFinite(p.pegelDb)).toBe(true);
    }
  });

  it("erkennt Vollaussteuerung und Gleichanteil", () => {
    const sauber = sinus(200, 1, 0.5);
    expect(klangProfil(sauber, SR).uebersteuert).toBe(false);
    expect(Math.abs(klangProfil(sauber, SR).gleichanteil)).toBeLessThan(0.01);
    const geklemmt = Float32Array.from(sinus(200, 1, 2), (v) => Math.max(-1, Math.min(1, v)));
    expect(klangProfil(geklemmt, SR).uebersteuert).toBe(true);
    const versetzt = Float32Array.from(sauber, (v) => v * 0.3 + 0.2);
    expect(klangProfil(versetzt, SR).gleichanteil).toBeGreaterThan(0.1);
  });

  it("stilleAnteil zaehlt die leisen Bloecke", () => {
    const laut = sinus(300, 1);
    const halb = new Float32Array(laut.length * 2);
    halb.set(laut, 0);
    expect(stilleAnteil(halb, SR)).toBeGreaterThan(0.45);
    expect(stilleAnteil(halb, SR)).toBeLessThan(0.55);
    expect(stilleAnteil(laut, SR)).toBe(0);
  });

  it("rhythmusDichte zaehlt Anschlaege je Takt", () => {
    // Vier Schlaege in einem Takt bei 180 BPM (1,333 s)
    const takt = Math.round((240 / 180) * SR);
    const pcm = new Float32Array(takt);
    for (let s = 0; s < 4; s++) {
      const start = Math.round((s * takt) / 4);
      for (let i = 0; i < 2000; i++) pcm[start + i] = Math.sin((2 * Math.PI * 120 * i) / SR) * Math.exp(-i / 400);
    }
    expect(anschlagZahl(pcm, SR)).toBe(4);
    expect(rhythmusDichte(pcm, SR, 180)).toBeCloseTo(4, 0);
    expect(rhythmusDichte(new Float32Array(0), SR, 180)).toBe(0);
    expect(rhythmusDichte(pcm, SR, 0)).toBe(0);
  });

  it("Abbildungen: Flachheit und Schwerpunkt landen im 0..1-Fenster", () => {
    expect(rauschigkeitAus(1)).toBeCloseTo(1, 6);
    expect(rauschigkeitAus(0.001)).toBeCloseTo(0, 6);
    expect(rauschigkeitAus(0)).toBe(0);
    expect(helligkeitAus(60)).toBeCloseTo(0, 6);
    expect(helligkeitAus(10000)).toBeCloseTo(1, 6);
    expect(helligkeitAus(0)).toBe(0);
    expect(helligkeitAus(-5)).toBe(0);
  });
});

describe("klangProfil: Konflikt und Ergaenzung", () => {
  const tief = klangProfil(sinus(80, 2), SR);
  const hoch = klangProfil(sinus(8000, 2), SR);

  it("derselbe Klang steht sich maximal im Weg, getrennte Baender gar nicht", () => {
    expect(konflikt(tief, tief)).toBeGreaterThan(0.99);
    expect(konflikt(tief, hoch)).toBeLessThan(0.05);
    expect(ergaenzung(tief, hoch)).toBeGreaterThan(0.95);
    expect(klangAbstand(tief, hoch)).toBeGreaterThan(0.5);
    expect(klangAbstand(tief, tief)).toBeCloseTo(0, 6);
  });

  it("Rueckfall: ohne Profil gibt es keine erfundene Aussage", () => {
    expect(konflikt(undefined, tief)).toBe(0);
    expect(konflikt(tief, undefined)).toBe(0);
    expect(ergaenzung(undefined, undefined)).toBe(0);
    expect(klangAbstand(tief, undefined)).toBe(0);
    expect(maxKonflikt(tief, [])).toBe(0);
  });

  it("maxKonflikt nimmt den schlechtesten Partner, nicht den Mittelwert", () => {
    expect(maxKonflikt(tief, [hoch, hoch, tief])).toBeGreaterThan(0.99);
    expect(maxKonflikt(tief, [hoch, hoch])).toBeLessThan(0.05);
  });

  it("Text: Profil und Konflikt lassen sich anzeigen", () => {
    expect(profilText(undefined)).toBe("nicht analysiert");
    expect(profilText(tief)).toContain("tonal");
    expect(profilText(hoch)).toContain("Mitte");
    expect(konfliktText(0.9)).toContain("verdecken");
    expect(konfliktText(0.1)).toContain("ergänzen");
  });
});

describe("klangProfil: echte Samples", () => {
  it("Kicks sind tief und dunkel, Hats hell und ohne Bass", () => {
    for (const datei of ["RoBBaFFerT KicK4.wav", "KeTTeR KicK.wav", "A-DLL-KicK-1!.wav"]) {
      const { pcm, sampleRate } = lade(datei);
      const p = klangProfil(pcm, sampleRate);
      expect(p.tiefe, datei).toBeGreaterThan(0.55);
      expect(p.helligkeit, datei).toBeLessThan(0.45);
    }
    for (const datei of ["RoBBaFFerT HaT 1.wav", "Puff hat2.wav", "spetzial-hat25.wav"]) {
      const { pcm, sampleRate } = lade(datei);
      const p = klangProfil(pcm, sampleRate);
      expect(p.helligkeit, datei).toBeGreaterThan(0.6);
      expect(p.tiefe, datei).toBeLessThan(0.1);
    }
  });

  it("Kick und Hat ergaenzen sich, zwei Kicks derselben Familie nicht", () => {
    const kick = profilVon("RoBBaFFerT KicK4.wav");
    const hat = profilVon("RoBBaFFerT HaT 1.wav");
    const kick2 = profilVon("RoBBaFFerT KicK5.wav");
    expect(konflikt(kick, hat)).toBeLessThan(konflikt(kick, kick2));
    expect(ergaenzung(kick, hat)).toBeGreaterThan(0.5);
  });

  it("Persistenz: das Profil uebersteht den Weg durch JSON", () => {
    const { pcm, sampleRate } = lade("KeTTeR KicK.wav");
    const p = klangProfil(pcm, sampleRate);
    const zurueck = JSON.parse(JSON.stringify(p)) as typeof p;
    expect(zurueck.baender).toEqual(p.baender);
    expect(konflikt(zurueck, p)).toBeGreaterThan(0.99);
  });
});

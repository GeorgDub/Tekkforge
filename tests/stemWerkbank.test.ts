import { describe, it, expect } from "vitest";
import {
  neueSpur,
  setzeMarke,
  entferneMarke,
  abschnitte,
  rasterMarken,
  schneideSpur,
  nullDurchgang,
  zeitachse,
  MARKE_TOLERANZ_MS,
  type Spur,
} from "../src/core/stemWerkbank";

const SR = 44100;

/** Sinus, damit es echte Nulldurchgaenge gibt. */
function ton(sekunden: number, hz = 100): Float32Array {
  const pcm = new Float32Array(Math.round(SR * sekunden));
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin((2 * Math.PI * hz * i) / SR) * 0.8;
  return pcm;
}

function spur(sekunden = 4, name = "VOX"): Spur {
  return neueSpur(name, ton(sekunden), SR, "vox");
}

describe("Marken setzen und entfernen", () => {
  it("eine gesetzte Marke steht in der Spur", () => {
    const s = spur();
    setzeMarke(s, SR);
    expect(s.marken).toHaveLength(1);
    expect(Math.abs(s.marken[0] - SR)).toBeLessThan(SR * 0.01);
  });

  it("Marken bleiben aufsteigend sortiert, egal in welcher Reihenfolge man klickt", () => {
    const s = spur();
    setzeMarke(s, SR * 3);
    setzeMarke(s, SR * 1);
    setzeMarke(s, SR * 2);
    expect([...s.marken]).toEqual([...s.marken].sort((a, b) => a - b));
  });

  it("zweimal fast dieselbe Stelle gibt nur EINE Marke", () => {
    // Sonst sammeln sich beim Zielen mit der Maus unsichtbare Doppelmarken an,
    // und man schneidet Abschnitte von null Laenge heraus.
    const s = spur();
    setzeMarke(s, SR);
    setzeMarke(s, SR + Math.round((SR * MARKE_TOLERANZ_MS) / 1000 / 2));
    expect(s.marken).toHaveLength(1);
  });

  it("Anfang und Ende sind keine Marken", () => {
    const s = spur();
    setzeMarke(s, 0);
    setzeMarke(s, s.pcm.length);
    expect(s.marken).toHaveLength(0);
  });

  it("entfernen trifft die Marke in der Naehe des Klicks", () => {
    const s = spur();
    setzeMarke(s, SR * 2);
    expect(entferneMarke(s, SR * 2 + 200)).toBe(true);
    expect(s.marken).toHaveLength(0);
  });

  it("entfernen weit daneben laesst die Marke stehen", () => {
    const s = spur();
    setzeMarke(s, SR * 2);
    expect(entferneMarke(s, SR * 3)).toBe(false);
    expect(s.marken).toHaveLength(1);
  });

  it("schnappt auf den Nulldurchgang — sonst knackt jeder Schnitt", () => {
    const s = spur(2, "MELO");
    // Mitten in der Halbwelle klicken; die Marke soll auf dem Nulldurchgang landen.
    const ziel = 1000 + Math.round(SR / 400);
    setzeMarke(s, ziel);
    const wert = Math.abs(s.pcm[s.marken[0]]);
    expect(wert).toBeLessThan(0.05);
  });

  it("ohne Schnappen bleibt die Marke, wo geklickt wurde", () => {
    const s = spur(2);
    const ziel = 1000 + Math.round(SR / 400);
    setzeMarke(s, ziel, { schnappen: false });
    expect(s.marken[0]).toBe(ziel);
  });
});

describe("nullDurchgang", () => {
  it("findet die naechste Nullstelle", () => {
    const pcm = ton(1, 100);
    const nah = nullDurchgang(pcm, 500, 2000);
    expect(Math.abs(pcm[nah])).toBeLessThan(0.05);
  });

  it("gibt die Stelle zurueck, wenn im Fenster keine Null liegt", () => {
    const pcm = new Float32Array(1000).fill(0.5);
    expect(nullDurchgang(pcm, 500, 50)).toBe(500);
  });
});

describe("Abschnitte", () => {
  it("ohne Marke ist die ganze Spur EIN Abschnitt", () => {
    const s = spur(4);
    expect(abschnitte(s)).toEqual([{ von: 0, bis: s.pcm.length, index: 0 }]);
  });

  it("zwei Marken ergeben drei Abschnitte, luecken- und ueberlappungsfrei", () => {
    const s = spur(4);
    setzeMarke(s, SR, { schnappen: false });
    setzeMarke(s, SR * 2, { schnappen: false });
    const a = abschnitte(s);
    expect(a).toHaveLength(3);
    expect(a[0].von).toBe(0);
    expect(a[2].bis).toBe(s.pcm.length);
    for (let i = 1; i < a.length; i++) expect(a[i].von).toBe(a[i - 1].bis);
  });
});

describe("rasterMarken", () => {
  it("legt Marken auf die Taktgrenzen", () => {
    // 180 BPM, 4/4 → ein Takt sind 4 · 60/180 s = 1,333 s
    const marken = rasterMarken(SR * 8, SR, 180, 1);
    const taktFrames = (4 * 60 * SR) / 180;
    expect(marken[0]).toBeCloseTo(taktFrames, -2);
    expect(marken.every((m, i) => i === 0 || m > marken[i - 1])).toBe(true);
  });

  it("keine Marke auf oder hinter dem Ende", () => {
    const marken = rasterMarken(SR * 8, SR, 180, 1);
    expect(marken.every((m) => m > 0 && m < SR * 8)).toBe(true);
  });

  it("alle 8 Takte ist gröber als jeder Takt", () => {
    expect(rasterMarken(SR * 60, SR, 180, 8).length).toBeLessThan(rasterMarken(SR * 60, SR, 180, 1).length);
  });

  it("unsinniges Tempo ergibt kein Raster statt einer Endlosschleife", () => {
    expect(rasterMarken(SR * 8, SR, 0, 1)).toEqual([]);
    expect(rasterMarken(SR * 8, SR, -5, 1)).toEqual([]);
  });
});

describe("schneideSpur", () => {
  it("aus drei Abschnitten werden drei Samples mit fortlaufenden Nummern", () => {
    const s = spur(4);
    setzeMarke(s, SR, { schnappen: false });
    setzeMarke(s, SR * 2, { schnappen: false });
    const r = schneideSpur(s, { basisNummer: 501 });
    expect(r.samples.map((x) => x.number)).toEqual([501, 502, 503]);
    expect(r.samples[0].name).toMatch(/VOX/);
    expect(r.samples[0].pcm.length).toBe(SR);
  });

  it("winzige Schnipsel fallen raus, statt als Klick in der Bank zu landen", () => {
    const s = spur(4);
    setzeMarke(s, 100, { schnappen: false });
    const r = schneideSpur(s, { basisNummer: 501 });
    expect(r.samples).toHaveLength(1);
    expect(r.hinweise.join(" ")).toMatch(/zu kurz/i);
  });

  it("warnt, wenn eine Melodie in mehr als zwei Teile zerfällt", () => {
    // Feste Regel des Nutzers: Melodien bleiben ganz, höchstens zwei Hälften.
    // Von Hand darf man es trotzdem — aber nicht aus Versehen.
    const s = neueSpur("MELO", ton(8), SR, "melo");
    for (let i = 1; i <= 3; i++) setzeMarke(s, SR * i * 2, { schnappen: false });
    const r = schneideSpur(s, { basisNummer: 501 });
    expect(r.samples).toHaveLength(4);
    expect(r.hinweise.join(" ")).toMatch(/Melodie/i);
  });

  it("Vocals in viele Teile zu schneiden ist normal und wird nicht bemängelt", () => {
    const s = spur(8, "VOX");
    for (let i = 1; i <= 3; i++) setzeMarke(s, SR * i * 2, { schnappen: false });
    expect(schneideSpur(s, { basisNummer: 501 }).hinweise.join(" ")).not.toMatch(/Melodie/i);
  });

  it("meldet, was der Schnitt im Sample-RAM kostet", () => {
    const s = spur(4);
    const r = schneideSpur(s, { basisNummer: 501 });
    expect(r.bytes).toBe(Math.round(4 * SR) * 2);
  });
});

describe("zeitachse", () => {
  it("richtet sich nach der längsten Spur", () => {
    const a = spur(4, "A");
    const b = spur(9, "B");
    expect(zeitachse([a, b])).toBe(b.pcm.length);
  });

  it("ohne Spuren ist sie nicht null — sonst teilt die Anzeige durch null", () => {
    expect(zeitachse([])).toBeGreaterThan(0);
  });
});

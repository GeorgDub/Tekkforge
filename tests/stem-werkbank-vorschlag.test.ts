import { describe, it, expect } from "vitest";
import {
  neueSpur,
  vorschlagMarken,
  pausenMarken,
  novitaetsMarken,
  anschlagRaster,
  setzeMarken,
  schneideSpur,
  spurProfil,
  spurText,
  MIN_ABSCHNITT_MS,
  type Spur,
  type SpurRolle,
} from "../src/core/stemWerkbank";

const SR = 44100;
const BPM = 180;
/** Ein Takt bei 180 BPM: 4 · 60/180 s = 1,333 s */
const TAKT = Math.round((4 * 60 * SR) / BPM);

function schreibe(ziel: Float32Array, ab: number, laenge: number, fn: (i: number) => number): void {
  for (let i = 0; i < laenge && ab + i < ziel.length; i++) ziel[ab + i] = fn(i);
}

const sinus = (hz: number, amp = 0.6) => (i: number) => amp * Math.sin((2 * Math.PI * hz * i) / SR);
function rauschQuelle(amp = 0.5): (i: number) => number {
  let seed = 987654321;
  return () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return ((seed / 0x7fffffff) * 2 - 1) * amp;
  };
}

/** Ein Schlag: kurzer, gedaempfter Ton — hat einen echten Einschwinger. */
function schlag(ziel: Float32Array, ab: number, hz = 120, laenge = 6000): void {
  schreibe(ziel, ab, laenge, (i) => Math.sin((2 * Math.PI * hz * i) / SR) * Math.exp(-i / 1200));
}

function spur(pcm: Float32Array, rolle: SpurRolle, name = "T"): Spur {
  return neueSpur(name, pcm, SR, rolle);
}

/** Vier Takte tief, vier Takte mittig, vier Takte hell — zwei klare Uebergaenge. */
function dreiTeile(): Float32Array {
  const pcm = new Float32Array(TAKT * 12);
  schreibe(pcm, 0, TAKT * 4, sinus(90));
  schreibe(pcm, TAKT * 4, TAKT * 4, sinus(700));
  schreibe(pcm, TAKT * 8, TAKT * 4, sinus(4000));
  return pcm;
}

/** Dasselbe, aber der Mittelteil ist Rauschen — Klangfarbe statt Tonhoehe. */
function mitRauschen(): Float32Array {
  const pcm = new Float32Array(TAKT * 12);
  schreibe(pcm, 0, TAKT * 4, sinus(90));
  schreibe(pcm, TAKT * 4, TAKT * 4, rauschQuelle());
  schreibe(pcm, TAKT * 8, TAKT * 4, sinus(4000));
  return pcm;
}

describe("vorschlagMarken: Vocals werden an ihren Pausen getrennt", () => {
  /** Vier gesungene Bloecke mit deutlichen Pausen dazwischen — nicht im Taktraster. */
  function vocalSpur(): Spur {
    const pcm = new Float32Array(SR * 12);
    const bloecke = [0.4, 3.1, 6.3, 9.2];
    for (const sek of bloecke) schreibe(pcm, Math.round(sek * SR), Math.round(1.8 * SR), sinus(300));
    return spur(pcm, "vox", "VOX");
  }

  it("findet die Grenzen in den Pausen, nicht auf den Taktlinien", () => {
    const s = vocalSpur();
    const v = vorschlagMarken(s, { bpm: BPM });
    expect(v.verfahren).toBe("pausen");
    expect(v.frames.length).toBe(3);
    // Jede Marke liegt in einer der drei Luecken (2,2 s / 5,2 s / 8,1 s ± Vorlauf)
    for (const f of v.frames) {
      const sek = f / SR;
      const inLuecke = [
        [2.2, 3.15],
        [4.9, 6.35],
        [8.1, 9.25],
      ].some(([a, b]) => sek >= a && sek <= b);
      expect(inLuecke, `Marke bei ${sek.toFixed(2)} s`).toBe(true);
    }
  });

  it("schneidet dort, wo nichts klingt — die Phrasen bleiben ganz", () => {
    const s = vocalSpur();
    setzeMarken(s, vorschlagMarken(s, { bpm: BPM }).frames);
    const r = schneideSpur(s, { basisNummer: 501 });
    // Jeder Schnipsel faengt leise an und traegt genau EINE Phrase.
    for (const p of r.profile) expect(p.anschlaege).toBeLessThanOrEqual(2);
    expect(r.samples.length).toBe(4);
  });

  it("bei zu vielen Pausen zaehlen die laengsten", () => {
    const pcm = new Float32Array(SR * 12);
    for (let i = 0; i < 20; i++) schreibe(pcm, Math.round(i * 0.55 * SR), Math.round(0.35 * SR), sinus(300));
    const s = spur(pcm, "vox");
    expect(pausenMarken(s, { maxMarken: 4 }).length).toBeLessThanOrEqual(4);
  });

  it("eine durchgesungene Spur faellt auf den Klangwechsel zurueck, statt nichts zu liefern", () => {
    const v = vorschlagMarken(spur(dreiTeile(), "vox"), { bpm: BPM });
    expect(v.verfahren).toBe("novitaet");
    expect(v.hinweise.join(" ")).toMatch(/Keine Pausen/i);
    expect(v.frames.length).toBeGreaterThan(0);
  });
});

describe("vorschlagMarken: Melodien und Mixe nur beim Klangwechsel", () => {
  it("trifft die beiden Uebergaenge und nicht die zehn anderen Taktgrenzen", () => {
    const s = spur(dreiTeile(), "mix", "MIX");
    const v = vorschlagMarken(s, { bpm: BPM, takte: 1, maxMarken: 4 });
    expect(v.verfahren).toBe("novitaet");
    expect(v.frames.length).toBeLessThanOrEqual(4);
    // Beide echten Uebergaenge (Takt 4 und Takt 8) sind dabei, auf 0,2 s genau.
    for (const ziel of [TAKT * 4, TAKT * 8]) {
      expect(v.frames.some((f) => Math.abs(f - ziel) < 0.2 * SR), `Uebergang bei ${ziel / SR} s`).toBe(true);
    }
  });

  it("eine gleichfoermige Spur bekommt keine Marken — es gibt nichts zu trennen", () => {
    const pcm = new Float32Array(TAKT * 12);
    schreibe(pcm, 0, pcm.length, sinus(220));
    const v = vorschlagMarken(spur(pcm, "mix"), { bpm: BPM, takte: 1 });
    expect(v.frames).toEqual([]);
    expect(v.hinweise.join(" ")).toMatch(/Kein deutlicher Klangwechsel/i);
  });

  it("Melodien bekommen von sich aus hoechstens EINE Marke", () => {
    const v = vorschlagMarken(spur(dreiTeile(), "melo"), { bpm: BPM });
    expect(v.frames.length).toBeLessThanOrEqual(1);
    // …und daraus werden hoechstens zwei Haelften, also keine Melodie-Warnung.
    const s = spur(dreiTeile(), "melo", "MELO");
    setzeMarken(s, v.frames);
    expect(schneideSpur(s, { basisNummer: 501 }).hinweise.join(" ")).not.toMatch(/Melodie/i);
  });

  it("findet auch einen reinen Klangfarbenwechsel (Ton → Rauschen)", () => {
    const v = vorschlagMarken(spur(mitRauschen(), "mix"), { bpm: BPM, takte: 1, maxMarken: 4 });
    for (const ziel of [TAKT * 4, TAKT * 8]) {
      expect(v.frames.some((f) => Math.abs(f - ziel) < 0.2 * SR), `Uebergang bei ${ziel / SR} s`).toBe(true);
    }
  });

  it("die Marken liegen auf einem Nulldurchgang — sonst knackt der Schnitt", () => {
    const s = spur(dreiTeile(), "mix");
    for (const f of vorschlagMarken(s, { bpm: BPM, takte: 1 }).frames) {
      expect(Math.abs(s.pcm[f])).toBeLessThan(0.15);
    }
  });
});

describe("vorschlagMarken: Drums auf den Anschlag statt auf den Rechenwert", () => {
  /** Kicks alle vier Takte, aber 40 ms hinter dem gerechneten Raster. */
  function drumSpur(versatz: number): Spur {
    const pcm = new Float32Array(TAKT * 16);
    for (let t = 0; t < 16; t++) {
      for (let v = 0; v < 4; v++) schlag(pcm, t * TAKT + (v * TAKT) / 4 + (t > 0 ? versatz : 0));
    }
    return spur(pcm, "drums", "DRUMS");
  }

  it("zieht die Marke auf den gespielten Schlag", () => {
    const versatz = Math.round(0.04 * SR);
    const s = drumSpur(versatz);
    const marken = anschlagRaster(s, { bpm: BPM, takte: 4 });
    expect(marken.length).toBeGreaterThan(0);
    for (const m of marken) {
      const takt = Math.round(m / TAKT);
      // ohne Schnappen laege die Marke bei takt*TAKT, also 40 ms vor dem Schlag
      expect(Math.abs(m - (takt * TAKT + versatz))).toBeLessThan(0.02 * SR);
    }
  });

  it("Drums nutzen von sich aus das Raster und schneiden jeden Takt", () => {
    const v = vorschlagMarken(drumSpur(0), { bpm: BPM });
    expect(v.verfahren).toBe("raster");
    expect(v.frames.length).toBe(15);
  });
});

describe("vorschlagMarken: Grenzfaelle", () => {
  it("ohne Tempo gibt es einen Hinweis statt eines Rasters", () => {
    const v = vorschlagMarken(spur(dreiTeile(), "mix"), { bpm: 0 });
    expect(v.frames).toEqual([]);
    expect(v.hinweise.join(" ")).toMatch(/Tempo/i);
  });

  it("eine stumme Spur liefert keine Marken", () => {
    const s = spur(new Float32Array(SR * 8), "mix");
    expect(vorschlagMarken(s, { bpm: BPM }).frames).toEqual([]);
    expect(pausenMarken(spur(new Float32Array(SR * 8), "vox"))).toEqual([]);
  });

  it("eine Spur kuerzer als ein Takt bekommt keine Marke", () => {
    const pcm = new Float32Array(Math.round(0.2 * SR));
    schreibe(pcm, 0, pcm.length, sinus(300));
    expect(vorschlagMarken(spur(pcm, "mix"), { bpm: BPM }).frames).toEqual([]);
  });

  it("Vorschlaege halten die Mindestlaenge ein", () => {
    const s = spur(dreiTeile(), "mix");
    const f = novitaetsMarken(s, { bpm: BPM, takte: 1, maxMarken: 20 });
    const min = (MIN_ABSCHNITT_MS * SR) / 1000;
    for (let i = 0; i < f.length; i++) {
      expect(f[i] - (f[i - 1] ?? 0)).toBeGreaterThanOrEqual(min);
    }
    expect(s.pcm.length - (f[f.length - 1] ?? 0)).toBeGreaterThanOrEqual(min);
  });

  it("setzeMarken kann ersetzen statt anhaengen", () => {
    const s = spur(dreiTeile(), "mix");
    setzeMarken(s, [TAKT, TAKT * 2]);
    expect(s.marken).toHaveLength(2);
    setzeMarken(s, [TAKT * 3], { ersetzen: true });
    expect(s.marken).toEqual([TAKT * 3]);
  });
});

describe("Güteprüfung beim Schneiden", () => {
  it("stille Abschnitte landen nicht in der Bank", () => {
    const pcm = new Float32Array(SR * 6);
    schreibe(pcm, 0, SR * 2, sinus(300));
    schreibe(pcm, SR * 4, SR * 2, sinus(300));
    const s = spur(pcm, "vox", "VOX");
    setzeMarken(s, [SR * 2, SR * 4]);
    const r = schneideSpur(s, { basisNummer: 501 });
    expect(r.samples).toHaveLength(2);
    expect(r.hinweise.join(" ")).toMatch(/ohne hoerbaren Inhalt/i);
    expect(r.profile).toHaveLength(2);
  });

  it("meldet Uebersteuerung und fuehrende Stille, entscheidet aber nicht darueber", () => {
    const pcm = new Float32Array(SR * 2);
    schreibe(pcm, Math.round(SR * 0.2), Math.round(SR * 1.5), (i) => Math.max(-1, Math.min(1, sinus(300, 3)(i))));
    const s = spur(pcm, "mix", "LAUT");
    const r = schneideSpur(s, { basisNummer: 501 });
    expect(r.samples).toHaveLength(1);
    expect(r.hinweise.join(" ")).toMatch(/Vollaussteuerung/i);
    expect(r.hinweise.join(" ")).toMatch(/ms Stille/i);
  });

  it("spurProfil und spurText beschreiben die Spur", () => {
    const s = spur(dreiTeile(), "mix");
    const p = spurProfil(s, BPM);
    expect(p.sekunden).toBeCloseTo((TAKT * 12) / SR, 1);
    expect(spurText(s, BPM)).toContain("Mitte");
  });
});

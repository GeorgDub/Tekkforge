/**
 * keyAnalyse.ts — Tonart-Erkennung (Chromagramm + Krumhansl-Profile) und
 * Camelot-Rad fuers Mixen (MKM-Angleich Paket 4). Rein und DOM-frei.
 *
 * Verfahren: Goertzel-Energie je Halbton C2..B6 in Fenstern, aufaddiert zu
 * 12 Pitch-Klassen; die Klassenverteilung wird gegen die 24 gedrehten
 * Krumhansl-Kessler-Profile korreliert. Konfidenz = Abstand des besten zum
 * zweitbesten Treffer (0..1 grob).
 */

/** Krumhansl-Kessler-Dur-Profil (C-Dur). */
const PROFIL_DUR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
/** Krumhansl-Kessler-Moll-Profil (c-Moll). */
const PROFIL_MOLL = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

const NAMEN = ["C", "Cis", "D", "Es", "E", "F", "Fis", "G", "As", "A", "B", "H"];

/** Camelot-Rad: Dur (B-Seite) — Position je Pitch-Klasse (C=8B). */
const CAMELOT_DUR = [8, 3, 10, 5, 12, 7, 2, 9, 4, 11, 6, 1];
/** Moll (A-Seite) — a-Moll = 8A. */
const CAMELOT_MOLL = [5, 12, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10];

export interface Tonart {
  /** Pitch-Klasse 0..11 (0 = C). */
  grundton: number;
  dur: boolean;
  /** "A-Moll", "C-Dur" … (deutsch, B = engl. Bb, H = engl. B). */
  name: string;
  /** "8A" … fuers Mixen. */
  camelot: string;
  /** 0..1 — unter ~0.2 ist die Aussage wackelig. */
  konfidenz: number;
  /** Chroma-Verteilung (normalisiert), fuer Anzeige/Debug. */
  chroma: number[];
}

export function camelotVon(grundton: number, dur: boolean): string {
  const k = ((grundton % 12) + 12) % 12;
  return dur ? `${CAMELOT_DUR[k]}B` : `${CAMELOT_MOLL[k]}A`;
}

export function tonartName(grundton: number, dur: boolean): string {
  const k = ((grundton % 12) + 12) % 12;
  return `${NAMEN[k]}-${dur ? "Dur" : "Moll"}`;
}

/** Goertzel-Leistung einer Frequenz in einem Fenster. */
function goertzel(pcm: Float32Array, start: number, len: number, freq: number, sampleRate: number): number {
  const w = (2 * Math.PI * freq) / sampleRate;
  const koeff = 2 * Math.cos(w);
  let s0 = 0;
  let s1 = 0;
  let s2 = 0;
  for (let i = 0; i < len; i++) {
    s0 = pcm[start + i] + koeff * s1 - s2;
    s2 = s1;
    s1 = s0;
  }
  return s1 * s1 + s2 * s2 - koeff * s1 * s2;
}

/** 12-Klassen-Chromagramm ueber C2..B6; nutzt hoechstens ~30 s der Mitte. */
export function chromaAusPcm(pcm: Float32Array, sampleRate: number): number[] {
  const chroma = new Array<number>(12).fill(0);
  const fenster = Math.min(8192, pcm.length);
  if (fenster < 1024) return chroma;
  const maxDauer = 30 * sampleRate;
  const start = pcm.length > maxDauer ? Math.floor((pcm.length - maxDauer) / 2) : 0;
  const ende = Math.min(pcm.length, start + maxDauer);
  const hop = fenster * 2; // duenn abtasten reicht fuer eine Tonart
  for (let pos = start; pos + fenster <= ende; pos += hop) {
    for (let midi = 36; midi < 96; midi++) {
      const freq = 440 * Math.pow(2, (midi - 69) / 12);
      if (freq > sampleRate / 2 - 100) break;
      const p = goertzel(pcm, pos, fenster, freq, sampleRate);
      chroma[midi % 12] += Math.sqrt(Math.max(0, p)) / fenster;
    }
  }
  return chroma;
}

function korrelation(a: readonly number[], b: readonly number[]): number {
  const ma = a.reduce((x, y) => x + y, 0) / 12;
  const mb = b.reduce((x, y) => x + y, 0) / 12;
  let oben = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < 12; i++) {
    const da = a[i] - ma;
    const db = b[i] - mb;
    oben += da * db;
    na += da * da;
    nb += db * db;
  }
  const unten = Math.sqrt(na * nb);
  return unten > 0 ? oben / unten : 0;
}

export function tonartErkennen(pcm: Float32Array, sampleRate: number): Tonart {
  const chroma = chromaAusPcm(pcm, sampleRate);
  const summe = chroma.reduce((a, b) => a + b, 0);
  if (summe <= 1e-6) {
    return { grundton: 0, dur: true, name: tonartName(0, true), camelot: camelotVon(0, true), konfidenz: 0, chroma };
  }
  const norm = chroma.map((c) => c / summe);
  let beste = { grundton: 0, dur: true, wert: -2 };
  let zweite = -2;
  for (const dur of [true, false]) {
    const profil = dur ? PROFIL_DUR : PROFIL_MOLL;
    for (let g = 0; g < 12; g++) {
      const gedreht = norm.map((_, i) => norm[(i + g) % 12]);
      const wert = korrelation(gedreht, profil);
      if (wert > beste.wert) {
        zweite = beste.wert;
        beste = { grundton: g, dur, wert };
      } else if (wert > zweite) {
        zweite = wert;
      }
    }
  }
  const konfidenz = Math.max(0, Math.min(1, beste.wert - zweite));
  return {
    grundton: beste.grundton,
    dur: beste.dur,
    name: tonartName(beste.grundton, beste.dur),
    camelot: camelotVon(beste.grundton, beste.dur),
    konfidenz,
    chroma: norm,
  };
}

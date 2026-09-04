/**
 * dsp — kleine Signalbausteine ohne Abhaengigkeiten: radix-2-FFT (in place),
 * ein gemitteltes Leistungsspektrum als gemeinsame Grundlage und daraus
 * abgeleitete Kennzahlen: Bandenergien (log-Baender 60 Hz–10 kHz) als
 * Klangfarben-Vektor, Bassanteil, Schwerpunkt, Rolloff, Flachheit.
 */

/** In-place-FFT, Laenge muss eine Zweierpotenz sein. */
export function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  if (n !== im.length || (n & (n - 1)) !== 0) throw new Error("fft: Laenge muss eine Zweierpotenz sein");
  // Bit-Umkehr
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = i + j;
        const b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci;
        const xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Bandgrenzen logarithmisch zwischen fMin und fMax (baender+1 Werte). */
function bandGrenzen(baender: number, fMin: number, fMax: number): number[] {
  const out: number[] = [];
  for (let b = 0; b <= baender; b++) out.push(fMin * Math.pow(fMax / fMin, b / baender));
  return out;
}

/**
 * Gemitteltes Leistungsspektrum — die gemeinsame Grundlage aller Kennzahlen.
 *
 * Vorher rechnete jede Kennzahl ihre eigene FFT: Bandenergien hier,
 * Bassanteil dort, und fuer Helligkeit gab es gar keine. Bei einem ganzen Lied
 * sind das mehrere tausend FFTs je Kennzahl. Einmal rechnen und mehrfach
 * auswerten ist nicht nur schneller, sondern haelt die Zahlen auch
 * untereinander konsistent — Schwerpunkt und Bandenergie beschreiben dann
 * denselben Ausschnitt, nicht zwei aehnliche.
 */
export interface Spektrum {
  /** Mittlere Leistung je Bin; Bin k liegt bei k * sampleRate / n. Index 0 bleibt 0. */
  leistung: Float64Array;
  /** FFT-Laenge. */
  n: number;
  sampleRate: number;
  /** Wie viele Fenster gemittelt wurden; 0 = Ausschnitt kuerzer als ein Fenster. */
  frames: number;
}

const HANN = new Map<number, Float32Array>();
function hann(n: number): Float32Array {
  let w = HANN.get(n);
  if (!w) {
    w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    HANN.set(n, w);
  }
  return w;
}

/**
 * Mittleres Leistungsspektrum ueber Fenster von `n` Samples (Hann, kein Ueberlapp).
 *
 * `maxSekunden` begrenzt den ausgewerteten Ausschnitt und nimmt ihn aus der
 * MITTE: der Anfang eines Lieds ist oft ein Intro und beschreibt den Klang des
 * Stuecks schlechter als die Mitte. Ohne Grenze wird alles ausgewertet — so
 * rechnen die alten Aufrufer weiter wie bisher.
 */
export function mittleresSpektrum(pcm: Float32Array, sr: number, n = 2048, maxSekunden = Infinity): Spektrum {
  const leistung = new Float64Array(n / 2);
  const grenze = Number.isFinite(maxSekunden) ? Math.max(n, Math.round(maxSekunden * sr)) : Infinity;
  const start = pcm.length > grenze ? Math.floor((pcm.length - grenze) / 2) : 0;
  const ende = Number.isFinite(grenze) ? Math.min(pcm.length, start + grenze) : pcm.length;
  const w = hann(n);
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  let frames = 0;
  for (let s = start; s + n <= ende; s += n) {
    for (let i = 0; i < n; i++) {
      re[i] = pcm[s + i] * w[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 1; k < n / 2; k++) leistung[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  if (frames > 1) for (let k = 1; k < n / 2; k++) leistung[k] /= frames;
  return { leistung, n, sampleRate: sr, frames };
}

/** Gesamtleistung eines Spektrums (Bin 1 aufwaerts — der Gleichanteil zaehlt nicht mit). */
export function gesamtLeistung(spek: Spektrum): number {
  let s = 0;
  for (let k = 1; k < spek.n / 2; k++) s += spek.leistung[k];
  return s;
}

/** Bandenergien aus einem fertigen Spektrum — normiert auf Summe 1. */
export function bandEnergienAus(spek: Spektrum, baender = 24): Float32Array {
  const out = new Float32Array(baender);
  const fMax = Math.min(10000, spek.sampleRate / 2 - 1);
  if (!spek.frames || fMax <= 60) return out;
  const grenzen = bandGrenzen(baender, 60, fMax);
  const summe = new Float64Array(baender);
  for (let k = 1; k < spek.n / 2; k++) {
    const f = (k * spek.sampleRate) / spek.n;
    if (f < grenzen[0] || f >= grenzen[baender]) continue;
    let b = 0;
    while (b < baender - 1 && f >= grenzen[b + 1]) b++;
    summe[b] += spek.leistung[k];
  }
  let total = 0;
  for (let b = 0; b < baender; b++) total += summe[b];
  if (total <= 0) return out;
  for (let b = 0; b < baender; b++) out[b] = summe[b] / total;
  return out;
}

/**
 * Mittlere Energie je log-Band (60 Hz–10 kHz) ueber Frames von 2048 Samples,
 * normiert auf Summe 1 — Klangfarben-Vektor fuer Abstandsvergleiche.
 */
export function bandEnergien(pcm: Float32Array, sr: number, baender = 24): Float32Array {
  return bandEnergienAus(mittleresSpektrum(pcm, sr, 2048), baender);
}

/** Anteil der Energie unterhalb `fGrenze` in einem fertigen Spektrum. */
export function anteilUnter(spek: Spektrum, fGrenze: number): number {
  let tief = 0;
  let alles = 0;
  for (let k = 1; k < spek.n / 2; k++) {
    const e = spek.leistung[k];
    alles += e;
    if ((k * spek.sampleRate) / spek.n < fGrenze) tief += e;
  }
  return alles > 0 ? tief / alles : 0;
}

/** Anteil der Energie unterhalb `fGrenze` (Bassanteil) eines Ausschnitts. */
export function bassAnteil(pcm: Float32Array, sr: number, fGrenze = 150): number {
  const N = 2048;
  if (pcm.length < N) return 0;
  return anteilUnter(mittleresSpektrum(pcm.subarray(0, N), sr, N), fGrenze);
}

/**
 * Spektraler Schwerpunkt in Hz — der "Mittelpunkt" des Klangs.
 *
 * Das ist die Zahl hinter dem, was man Helligkeit nennt: eine Hi-Hat liegt bei
 * 6–9 kHz, eine Kick bei 80–200 Hz, ein Vocal irgendwo um 700–2000 Hz. Anders
 * als eine Bandenergie ist es EIN Wert und laesst sich damit sortieren,
 * vergleichen und anzeigen.
 */
export function schwerpunkt(spek: Spektrum): number {
  let oben = 0;
  let unten = 0;
  for (let k = 1; k < spek.n / 2; k++) {
    const e = spek.leistung[k];
    oben += ((k * spek.sampleRate) / spek.n) * e;
    unten += e;
  }
  return unten > 0 ? oben / unten : 0;
}

/** Frequenz, unterhalb der `anteil` der Energie liegt (Vorgabe 85 %). */
export function rolloff(spek: Spektrum, anteil = 0.85): number {
  const ziel = gesamtLeistung(spek) * anteil;
  if (ziel <= 0) return 0;
  let s = 0;
  for (let k = 1; k < spek.n / 2; k++) {
    s += spek.leistung[k];
    if (s >= ziel) return (k * spek.sampleRate) / spek.n;
  }
  return spek.sampleRate / 2;
}

/**
 * Spektrale Flachheit (0..1) — geometrisches durch arithmetisches Mittel.
 *
 * Nahe 1 heisst: die Energie ist ueber alle Frequenzen verteilt, also Rauschen
 * — eine Hi-Hat, ein Crash, das Zischen einer Aufnahme. Nahe 0 heisst: die
 * Energie sitzt auf wenigen Linien, also ein Ton — Bass, Melodie, Stab.
 *
 * Genau diese Unterscheidung fehlte bisher: eine kurze, laute Datei ohne
 * passenden Namen wurde nach Dauer und Pegel zur Kick erklaert, auch wenn sie
 * ein Rauschen war. Ausgewertet wird nur 60 Hz–10 kHz; darunter und darueber
 * steht bei Tekk-Material meist nur Dreck, der die Zahl verwaessert.
 */
export function flachheit(spek: Spektrum): number {
  const fMax = Math.min(10000, spek.sampleRate / 2 - 1);
  let logSumme = 0;
  let summe = 0;
  let zahl = 0;
  for (let k = 1; k < spek.n / 2; k++) {
    const f = (k * spek.sampleRate) / spek.n;
    if (f < 60 || f > fMax) continue;
    const e = spek.leistung[k] + 1e-20;
    logSumme += Math.log(e);
    summe += e;
    zahl++;
  }
  if (!zahl || summe <= 0) return 0;
  const geo = Math.exp(logSumme / zahl);
  const arith = summe / zahl;
  return Math.max(0, Math.min(1, geo / arith));
}

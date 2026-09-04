/**
 * timeStretch — Dehnen ohne Tonhoehenwechsel (WSOLA).
 *
 * Bisher zog `bereiteAuf` jede Schleife per Varispeed aufs Bank-Tempo:
 * schneller heisst hoeher, langsamer heisst tiefer. Bis ±23 % ist das Tekk
 * (und gewollt — die ganze Lied-Pipeline arbeitet so), darueber degradierte
 * die Schleife zum One-Shot und lief asynchron. Jetzt wird sie gedehnt:
 * Waveform-Similarity Overlap-Add — Hann-Fenster im festen Ausgaberaster,
 * je Fenster die Stelle in der Quelle gesucht, die am besten an die letzte
 * Ausgabe anschliesst (Kreuzkorrelation im Toleranzbereich), dann
 * ueberblendet. Tonhoehe und Klangfarbe bleiben, nur die Zeit aendert sich.
 *
 * Reine Rechnung, kein Python — laeuft im Browser wie in der CLI.
 * Qualitaet: fuer Schlagzeug und Synth-Schleifen gut, fuer Solo-Gesang
 * hoerbar (leichtes Flattern bei grossen Faktoren) — Vocals bleiben in
 * `bereiteAuf` ohnehin bei Varispeed innerhalb der Grenze.
 */

/** Fensterlaenge (46 ms bei 44,1 kHz). */
export const STRETCH_FENSTER = 2048;
/** Suchbereich um die Sollstelle in der Quelle. */
const TOLERANZ = STRETCH_FENSTER / 4;
/** Grobsuche in Vierer-Schritten, dann Feinsuche ±4. */
const GROB = 4;

function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}

function korrelation(pcm: Float32Array, a: number, b: number, n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += pcm[a + i] * pcm[b + i];
  return s;
}

/**
 * `faktor` = Ausgabelaenge / Eingabelaenge (2 = doppelt so lang, 0,5 = halb).
 * Faktoren nahe 1 (±0,2 %) geben die Quelle unveraendert zurueck.
 */
export function timeStretch(pcm: Float32Array, faktor: number): Float32Array {
  if (!Number.isFinite(faktor) || faktor <= 0) throw new Error(`Stretch-Faktor ${faktor} ist keine Laenge`);
  if (Math.abs(faktor - 1) < 0.002 || pcm.length < 2 * STRETCH_FENSTER) return pcm.slice();
  const N = STRETCH_FENSTER;
  const Ha = N / 2;
  const laenge = Math.round(pcm.length * faktor);
  const out = new Float32Array(laenge);
  const norm = new Float32Array(laenge);
  const w = hann(N);
  // erstes Fenster: Anfang der Quelle
  let vorher = 0;
  const kopiere = (quelle: number, ziel: number) => {
    for (let i = 0; i < N; i++) {
      const z = ziel + i;
      const q = quelle + i;
      if (z >= laenge || q >= pcm.length) break;
      out[z] += pcm[q] * w[i];
      norm[z] += w[i];
    }
  };
  kopiere(0, 0);
  for (let k = 1; k * Ha < laenge; k++) {
    const ziel = k * Ha;
    const soll = Math.round(ziel / faktor);
    // natuerliche Fortsetzung des letzten Fensters
    const fort = vorher + Ha;
    if (fort + N > pcm.length) break;
    let bestPos = Math.max(0, Math.min(pcm.length - N, soll));
    let best = -Infinity;
    const von = Math.max(0, soll - TOLERANZ);
    const bis = Math.min(pcm.length - N, soll + TOLERANZ);
    for (let p = von; p <= bis; p += GROB) {
      const c = korrelation(pcm, fort, p, N);
      if (c > best) {
        best = c;
        bestPos = p;
      }
    }
    for (let p = Math.max(von, bestPos - GROB + 1); p <= Math.min(bis, bestPos + GROB - 1); p++) {
      const c = korrelation(pcm, fort, p, N);
      if (c > best) {
        best = c;
        bestPos = p;
      }
    }
    kopiere(bestPos, ziel);
    vorher = bestPos;
  }
  for (let i = 0; i < laenge; i++) if (norm[i] > 1e-6) out[i] /= norm[i];
  return out;
}

/** Auf genau `frames` Bilder dehnen oder stauchen. */
export function stretchAufLaenge(pcm: Float32Array, frames: number): Float32Array {
  if (!pcm.length || frames <= 0) return new Float32Array(Math.max(0, frames));
  const y = timeStretch(pcm, frames / pcm.length);
  if (y.length === frames) return y;
  const out = new Float32Array(frames);
  out.set(y.subarray(0, Math.min(frames, y.length)));
  return out;
}

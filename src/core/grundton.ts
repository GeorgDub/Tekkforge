/**
 * grundton — Grundton eines Bass-Ausschnitts (YIN) und die Bassline eines
 * Fensters als Noten je Viertel.
 *
 * Der Bass-Stem von Demucs war bisher nur ein weiteres Sample. Dabei steckt
 * darin die eigentliche Information: WELCHE Toene der Bass spielt. Mit den
 * Noten kann der Synth-Bass des Geraets die Linie des Originals spielen —
 * mit jedem der 362 Oszillatoren, nicht nur mit dem einen Sample.
 *
 * YIN (de Cheveigné & Kawahara 2002): Differenzfunktion, kumulativ
 * normiert, erste Stelle unter der Schwelle, Parabel-Feinabstimmung. Der
 * Bass liegt zwischen 30 und 300 Hz; Fenster 4096 Bilder bei 44,1 kHz
 * reichen bis 30 Hz hinunter (Lag 1470).
 */

export const BASS_F_MIN = 30;
export const BASS_F_MAX = 300;
/** YIN-Schwelle: darunter gilt der erste Einbruch als Periode. */
export const YIN_SCHWELLE = 0.15;
const FENSTER = 4096;
/** Leiser als das ist keine Note, sondern Pause. */
const STILL_DB = -40;

export interface Grundton {
  hz: number;
  /** 0…1 — 1 minus der normierten Differenz an der gefundenen Periode. */
  sicherheit: number;
}

/** MIDI-Note (gerundet) zu einer Frequenz. */
export const midiVon = (hz: number): number => Math.round(69 + 12 * Math.log2(hz / 440));

function rmsDb(pcm: Float32Array, von: number, bis: number): number {
  let s = 0;
  const n = Math.max(1, bis - von);
  for (let i = von; i < bis; i++) s += pcm[i] * pcm[i];
  return 10 * Math.log10(s / n + 1e-12);
}

/**
 * Grundton eines Ausschnitts (mono). null bei Stille, zu kurzem Material oder
 * ohne klare Periode.
 */
export function grundtonYin(pcm: Float32Array, sr: number, fMin = BASS_F_MIN, fMax = BASS_F_MAX, schwelle = YIN_SCHWELLE): Grundton | null {
  const tauMax = Math.min(Math.floor(sr / fMin), Math.floor(pcm.length / 2));
  const tauMin = Math.max(2, Math.floor(sr / fMax));
  if (tauMax <= tauMin + 2) return null;
  const w = Math.min(pcm.length - tauMax, FENSTER);
  if (w < tauMax) return null;
  if (rmsDb(pcm, 0, pcm.length) < STILL_DB) return null;
  // Differenzfunktion d(tau) ueber das Fenster
  const d = new Float64Array(tauMax + 1);
  for (let tau = 1; tau <= tauMax; tau++) {
    let s = 0;
    for (let i = 0; i < w; i++) {
      const x = pcm[i] - pcm[i + tau];
      s += x * x;
    }
    d[tau] = s;
  }
  // kumulativ normiert
  const dn = new Float64Array(tauMax + 1);
  dn[0] = 1;
  let summe = 0;
  for (let tau = 1; tau <= tauMax; tau++) {
    summe += d[tau];
    dn[tau] = summe > 0 ? (d[tau] * tau) / summe : 1;
  }
  // erste Stelle unter der Schwelle (dann bis zum lokalen Minimum weiter), sonst globales Minimum
  let tau = -1;
  for (let t = tauMin; t <= tauMax; t++) {
    if (dn[t] < schwelle) {
      while (t + 1 <= tauMax && dn[t + 1] < dn[t]) t++;
      tau = t;
      break;
    }
  }
  if (tau < 0) {
    let best = Infinity;
    for (let t = tauMin; t <= tauMax; t++) if (dn[t] < best) (best = dn[t]), (tau = t);
    if (tau < 0 || best > 0.5) return null;
  }
  // Parabel durch die drei Werte um das Minimum
  let fein = tau;
  if (tau > tauMin && tau < tauMax) {
    const y0 = dn[tau - 1];
    const y1 = dn[tau];
    const y2 = dn[tau + 1];
    const nenner = y0 - 2 * y1 + y2;
    if (nenner !== 0) fein = tau + Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / nenner));
  }
  return { hz: sr / fein, sicherheit: Math.max(0, Math.min(1, 1 - dn[tau])) };
}

/**
 * Bassline eines Fensters: eine MIDI-Note je Raster-Schlag (Vorgabe Viertel,
 * `raster` Schlaege je Takt), null bei Pause oder unsicherem Ton. Gemessen
 * wird im ersten Teil jedes Schlags (dort sitzt der Anschlag), mit
 * Sicherheit ≥ 0,6.
 */
export function bassNoten(pcm: Float32Array, sr: number, bpm: number, takte: number, raster = 4): (number | null)[] {
  const schlagFrames = ((240 / bpm) * sr) / raster;
  const out: (number | null)[] = [];
  for (let k = 0; k < takte * raster; k++) {
    const von = Math.round(k * schlagFrames);
    const bis = Math.min(pcm.length, Math.round(von + Math.min(schlagFrames, FENSTER + Math.floor(sr / BASS_F_MIN))));
    if (bis - von < FENSTER / 2) {
      out.push(null);
      continue;
    }
    const g = grundtonYin(pcm.subarray(von, bis), sr);
    out.push(g && g.sicherheit >= 0.6 ? midiVon(g.hz) : null);
  }
  return out;
}

/**
 * Tonklasse einer Linie in den Bereich 48…59 legen — eine Oktave unter der
 * Originaltonhoehe des Samples (Note 60). Das setzt voraus, dass das
 * Bass-Sample auf C steht (Unison_Bass_C3, Kick als Bass); die Intervalle
 * der Linie bleiben modulo Oktave erhalten.
 */
export const noteFuerBassSample = (midi: number): number => 48 + ((((midi % 12) + 12) % 12) as number);

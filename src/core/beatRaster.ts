/**
 * beatRaster — Beat-Tracking per dynamischer Programmierung (Ellis 2007).
 *
 * Bisher lag ueber dem Lied ein starres Raster: ein Tempo, eine Phase ueber
 * vier Beats (Bassenergie), fertig. Bei einem Stueck, das um ein halbes BPM
 * treibt, liegt das Raster nach zwei Minuten einen halben Beat daneben —
 * jeder Schnitt ab dort sitzt zwischen den Schlaegen. `anschlagRaster` in
 * der Stem-Werkbank flickte das erst beim Schneiden.
 *
 * Hier stattdessen: die Onset-Kurve wird mit einem Beat-Muster abgetastet,
 * und ein Pfad durch die Kurve gesucht, der moeglichst auf Anschlaegen
 * liegt UND moeglichst gleichmaessig im Tempo bleibt (Kostenterm
 * −(log τ/P)²·Straffheit). Das ergibt einen Beat je Schlag, der dem Lied
 * folgt, statt ihm ein Lineal aufzulegen. Downbeats danach wie gehabt ueber
 * die Bassenergie je Phase.
 *
 * Reine Rechnung auf Mono-PCM. Das Tempo kommt von aussen (`tempoSchaetzen`
 * oder Hinweis) — das Lied ist zu diesem Zeitpunkt schon auf das Bank-Tempo
 * gedehnt, also ist P bekannt.
 */
import { onsetKurve } from "./tempoAnalyse";
import { bassAnteil } from "./dsp";

const HOP = 256;
/** Straffheit: wie stark ein Tempowechsel bestraft wird (librosa: 100). */
export const STRAFFHEIT = 100;

export interface BeatRaster {
  /** Beat-Positionen in Frames, aufsteigend. */
  beats: number[];
  /** Jede vierte Beat-Position ab der Phase mit dem meisten Bass. */
  downbeats: number[];
  /** Mittlere Abweichung der Beat-Abstaende vom Soll, in Prozent (0 = wie das Lineal). */
  drift: number;
  /** Anteil der Beats, die auf einem deutlichen Anschlag liegen (0…1) — Vertrauen. */
  belegt: number;
}

function normiert(kurve: Float32Array): Float64Array {
  let s = 0;
  for (const v of kurve) s += v;
  const m = s / Math.max(1, kurve.length);
  let q = 0;
  for (const v of kurve) q += (v - m) * (v - m);
  const sd = Math.sqrt(q / Math.max(1, kurve.length)) || 1;
  return Float64Array.from(kurve, (v) => (v - m) / sd);
}

/** Onset-Kurve mit einer Gauss-Glocke der Breite P/32 glaetten (wie librosa). */
function lokal(onset: Float64Array, P: number): Float64Array {
  const sigma = P / 32;
  const r = Math.max(1, Math.round(3 * sigma));
  const out = new Float64Array(onset.length);
  for (let t = 0; t < onset.length; t++) {
    let s = 0;
    let w = 0;
    for (let k = -r; k <= r; k++) {
      const i = t + k;
      if (i < 0 || i >= onset.length) continue;
      const g = Math.exp(-0.5 * (k / sigma) ** 2);
      s += g * onset[i];
      w += g;
    }
    out[t] = w ? s / w : 0;
  }
  return out;
}

export function beatRaster(pcm: Float32Array, sr: number, bpm: number, straffheit = STRAFFHEIT): BeatRaster {
  const P = ((60 / bpm) * sr) / HOP;
  if (!pcm.length || P < 2) return { beats: [], downbeats: [], drift: 0, belegt: 0 };
  const onset = lokal(normiert(onsetKurve(pcm, sr, HOP)), P);
  const n = onset.length;
  const tauMin = Math.max(1, Math.round(P / 2));
  const tauMax = Math.round(2 * P);
  const strafe = new Float64Array(tauMax + 1);
  for (let tau = tauMin; tau <= tauMax; tau++) strafe[tau] = -straffheit * Math.log(tau / P) ** 2;
  const score = new Float64Array(n);
  const rueck = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    let best = 0;
    let bestVon = -1;
    for (let tau = tauMin; tau <= tauMax && t - tau >= 0; tau++) {
      const v = score[t - tau] + strafe[tau];
      if (v > best || bestVon < 0) {
        if (bestVon < 0 || v > best) {
          best = v;
          bestVon = t - tau;
        }
      }
    }
    // Ohne Vorgaenger (Anfang) zaehlt nur die Kurve selbst
    score[t] = onset[t] + (bestVon >= 0 ? best : 0);
    rueck[t] = bestVon;
  }
  // Ende: bester Score im letzten Beat-Fenster, dann zurueckverfolgen
  let ende = n - 1;
  for (let t = Math.max(0, n - tauMax); t < n; t++) if (score[t] > score[ende]) ende = t;
  const pfad: number[] = [];
  for (let t = ende; t >= 0; t = rueck[t]) {
    pfad.push(t);
    if (rueck[t] < 0) break;
  }
  pfad.reverse();
  const beats = pfad.map((t) => t * HOP);
  // Vertrauen: Beats auf deutlichen Anschlaegen (ueber dem Mittel der Kurve)
  let treffer = 0;
  for (const t of pfad) if (onset[t] > 0.5) treffer++;
  const belegt = pfad.length ? treffer / pfad.length : 0;
  // Drift: mittlere relative Abweichung der Abstaende vom Soll
  let d = 0;
  for (let i = 1; i < pfad.length; i++) d += Math.abs((pfad[i] - pfad[i - 1]) / P - 1);
  const drift = pfad.length > 1 ? (100 * d) / (pfad.length - 1) : 0;
  // Downbeats: Phase mit dem meisten Bass
  const summen = [0, 0, 0, 0];
  beats.forEach((b, i) => {
    if (b + 2048 <= pcm.length && i < 256) summen[i % 4] += bassAnteil(pcm.subarray(b, b + 2048), sr);
  });
  let phase = 0;
  for (let p = 1; p < 4; p++) if (summen[p] > summen[phase]) phase = p;
  const downbeats = beats.filter((_, i) => i % 4 === phase);
  return { beats, downbeats, drift, belegt };
}

/**
 * drumSchnitt — Kick/Snare/Hat-One-Shots aus einem Drums-Stem (mono):
 * Onsets per Peak-Picking auf der Onset-Kurve (Mindestabstand 60 ms),
 * Segmente bis zum naechsten Onset (max. 0,4 s, kurzer Fade-Out),
 * Klassifikation ueber Bassanteil (< 150 Hz → Kick) und Helligkeit
 * (Energie oberhalb 3 kHz → Hat), Dubletten per Korrelation, Auswahl
 * der lautesten je Rolle. Reine Funktionen, kein DOM.
 */
import { onsetKurve } from "./tempoAnalyse";
import { bassAnteil } from "./dsp";
import { rmsDb } from "./sampleScan";

export type DrumRolle = "kick" | "snare" | "hat";

export interface DrumTreffer {
  rolle: DrumRolle;
  pcm: Float32Array;
  rmsDb: number;
  /** Startzeit im Stem (Sekunden) */
  startSek: number;
}

const HOP = 256;
const MIN_ABSTAND_SEK = 0.06;
const MAX_SHOT_SEK = 0.4;
const MIN_FRAMES = 1024;

function korrelationKurz(a: Float32Array, b: Float32Array, frames: number): number {
  const n = Math.min(a.length, b.length, frames);
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < n; i++) {
    sab += a[i] * b[i];
    saa += a[i] * a[i];
    sbb += b[i] * b[i];
  }
  return sab / (Math.sqrt(saa * sbb) + 1e-9);
}

function fadeOut(pcm: Float32Array, sekunden: number, sr: number): Float32Array {
  const out = pcm.slice();
  const n = Math.min(out.length, Math.round(sekunden * sr));
  for (let i = 0; i < n; i++) out[out.length - 1 - i] *= i / n;
  return out;
}

/** Onset-Startframes: lokale Maxima ueber 30 % des staerksten Onsets, Mindestabstand 60 ms. */
export function drumOnsets(pcm: Float32Array, sr: number): number[] {
  const on = onsetKurve(pcm, sr, HOP);
  let max = 0;
  for (const v of on) if (v > max) max = v;
  const schwelle = 0.3 * max;
  const minHops = Math.max(1, Math.round((MIN_ABSTAND_SEK * sr) / HOP));
  const out: number[] = [];
  for (let i = 1; i < on.length - 1; i++) {
    if (on[i] <= schwelle || on[i] < on[i - 1] || on[i + 1] > on[i]) continue;
    if (out.length && i * HOP - out[out.length - 1] < minHops * HOP) continue;
    out.push(i * HOP);
  }
  return out;
}

export function schneideDrums(
  pcm: Float32Array,
  sr: number,
  opts: { jeRolle?: number } = {},
): DrumTreffer[] {
  const jeRolle = opts.jeRolle ?? 2;
  const onsets = drumOnsets(pcm, sr);
  const kandidaten: DrumTreffer[] = [];
  for (let i = 0; i < onsets.length; i++) {
    const start = onsets[i];
    const ende = Math.min(onsets[i + 1] ?? pcm.length, start + Math.round(MAX_SHOT_SEK * sr), pcm.length);
    if (ende - start < MIN_FRAMES) continue;
    const seg = fadeOut(pcm.subarray(start, ende), 0.01, sr);
    const db = rmsDb(seg);
    if (db < -40) continue;
    const bass = bassAnteil(seg, sr, 150);
    const dunkel = bassAnteil(seg, sr, 3000); // Anteil unterhalb 3 kHz
    const rolle: DrumRolle = bass > 0.3 ? "kick" : dunkel < 0.5 ? "hat" : "snare";
    kandidaten.push({ rolle, pcm: seg, rmsDb: db, startSek: start / sr });
  }
  const out: DrumTreffer[] = [];
  for (const rolle of ["kick", "snare", "hat"] as DrumRolle[]) {
    const sortiert = kandidaten.filter((k) => k.rolle === rolle).sort((a, b) => b.rmsDb - a.rmsDb);
    const genommen: DrumTreffer[] = [];
    for (const k of sortiert) {
      if (genommen.length >= jeRolle) break;
      if (genommen.some((g) => korrelationKurz(g.pcm, k.pcm, Math.round(0.15 * sr)) > 0.9)) continue;
      genommen.push(k);
    }
    out.push(...genommen);
  }
  return out;
}

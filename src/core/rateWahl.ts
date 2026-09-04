/**
 * rateWahl — welche Abtastrate ein Slot wirklich braucht.
 *
 * Die Electribe speichert je Slot die Rate und beachtet sie beim Abspielen
 * (am Geraet bestaetigt 2026-08-30, RATETEST). Ein Slot mit 22 050 Hz kostet
 * die Haelfte des Sample-RAM — und klingt identisch, wenn das Material
 * oberhalb von 11 kHz ohnehin nichts traegt. Genau das misst der Rolloff:
 * die Frequenz, unter der 95 % der Energie liegen. Ein Bass, ein Sub, viele
 * Kicks, dunkle Vocals liegen weit darunter; Hi-Hats, Claps und helle Snares
 * nicht — die bleiben bei voller Rate, ausdruecklich, nicht nur durch die
 * Messung.
 *
 * Vorher galt nur EINE Regel: Vocal-Loops auf Wunsch halbieren
 * (`sparsameVocals`). Die bleibt, als Wunsch des Nutzers; die Messung kommt
 * dazu und gilt fuer alle Rollen.
 */
import { mittleresSpektrum, rolloff } from "./dsp";
import type { Rolle } from "./sampleScan";

export const RATE_VOLL = 44100;
export const RATE_HALB = 22050;
/** 95 % der Energie unter dieser Frequenz: die halbe Rate verliert nichts Hoerbares. */
export const ROLLOFF_GRENZE_HZ = 9000;
export const ROLLOFF_ANTEIL = 0.95;
/** Rollen, die nie halbiert werden — ihr Glanz sitzt oben. */
export const IMMER_VOLL: readonly Rolle[] = ["hat", "snare", "clap"];
/** Kuerzer lohnt die Rechnung nicht, und Stille hat keinen Rolloff. */
const MIN_FRAMES = 2048;

/** Rolloff in Hz (95 % der Energie) — 0 bei Stille oder zu kurzem Material. */
export function rolloffHz(pcm: Float32Array, sr: number): number {
  if (pcm.length < MIN_FRAMES) return 0;
  const spek = mittleresSpektrum(pcm, sr, 2048, 30);
  if (!spek.frames) return 0;
  return rolloff(spek, ROLLOFF_ANTEIL);
}

export interface RateOptionen {
  /** Rolloff-Grenze in Hz (Vorgabe 9000). */
  grenzeHz?: number;
  /** Wunsch des Nutzers: Vocal-Loops immer halbieren. */
  sparsameVocals?: boolean;
  /** Messung aus (dann zaehlt nur `sparsameVocals`). */
  messen?: boolean;
}

export type Rate = typeof RATE_VOLL | typeof RATE_HALB;

/** 22 050, wenn der Rolloff unter der Grenze liegt oder der Nutzer es fuer Vocals will; sonst 44 100. */
export function rateFuer(pcm: Float32Array, sr: number, rolle: Rolle, opts: RateOptionen = {}): Rate {
  if (opts.sparsameVocals && rolle === "vox") return RATE_HALB;
  if (opts.messen === false || IMMER_VOLL.includes(rolle)) return RATE_VOLL;
  const hz = rolloffHz(pcm, sr);
  if (hz <= 0) return RATE_VOLL;
  return hz < (opts.grenzeHz ?? ROLLOFF_GRENZE_HZ) ? RATE_HALB : RATE_VOLL;
}

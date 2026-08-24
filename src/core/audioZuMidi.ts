/**
 * audioZuMidi — einstimmige Audio-zu-MIDI-Transkription (MKMs "Audio zu Korg",
 * bewusst nachgereicht). Je 16tel-Step eine Autokorrelations-Tonhoehe; Steps
 * gleicher Hoehe verschmelzen zu Noten, ein Pegelsprung auf gleicher Hoehe
 * beginnt eine neue Note. Das Ergebnis ist ein kuenstliches SmfLied und laeuft
 * unveraendert durch Piano Roll und Pattern-Bau des MIDI-Wizards.
 */
import type { SmfNote, SmfLied } from "./midiImport";

export const AUDIO_TPQ = 480;
const T16 = AUDIO_TPQ / 4;
const STILL_DB = -48;
const FENSTER_MAX = 2048;

export interface TranskriptionOpts {
  bpm: number;
  /** Suchbereich der Grundfrequenz (Standard 55–1050 Hz ≈ A1–C6). */
  minHz?: number;
  maxHz?: number;
  /** Mindest-Klarheit der Autokorrelation 0..1; darunter gilt der Step als stimmlos. */
  klarheit?: number;
}

/**
 * Grundfrequenz per normierter Autokorrelation. Gegen Oktavfehler nach unten
 * gewinnt der FRUEHESTE Peak, der mindestens 90 % des besten erreicht;
 * parabolische Verfeinerung fuer sauberes Cent-Raster.
 */
function f0Schaetzen(fenster: Float32Array, sr: number, minHz: number, maxHz: number): { hz: number; klarheit: number } | null {
  const n = fenster.length;
  const maxLag = Math.min(Math.floor(sr / minHz), n - 2);
  const minLag = Math.max(2, Math.floor(sr / maxHz));
  if (minLag >= maxLag) return null;
  let mittel = 0;
  for (let i = 0; i < n; i++) mittel += fenster[i];
  mittel /= n;
  const x = new Float32Array(n);
  let r0 = 0;
  for (let i = 0; i < n; i++) {
    x[i] = fenster[i] - mittel;
    r0 += x[i] * x[i];
  }
  if (r0 < 1e-6) return null;
  const r = new Float32Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    r[lag] = s / r0;
  }
  let best = minLag;
  for (let lag = minLag + 1; lag <= maxLag; lag++) if (r[lag] > r[best]) best = lag;
  const schwelle = 0.9 * r[best];
  let wahl = best;
  for (let lag = minLag + 1; lag < best; lag++) {
    if (r[lag] >= schwelle && r[lag] >= r[lag - 1] && r[lag] >= r[lag + 1]) {
      wahl = lag;
      break;
    }
  }
  const a = r[wahl - 1] ?? r[wahl];
  const b = r[wahl];
  const c = r[wahl + 1] ?? r[wahl];
  const nenner = a - 2 * b + c;
  const delta = nenner ? (a - c) / (2 * nenner) : 0;
  const lagFein = wahl + (Math.abs(delta) < 1 ? delta : 0);
  return { hz: sr / lagFein, klarheit: r[wahl] };
}

/** Mono-PCM → Notenliste im 16tel-Raster (Ticks: AUDIO_TPQ pro Viertel). */
export function transkribiereAudio(pcm: Float32Array, sr: number, opts: TranskriptionOpts): SmfNote[] {
  const minHz = opts.minHz ?? 55;
  const maxHz = opts.maxHz ?? 1050;
  const klarheitMin = opts.klarheit ?? 0.5;
  const stepFrames = Math.max(1, Math.round(((60 / opts.bpm) * sr) / 4));
  const fensterLen = Math.min(FENSTER_MAX, stepFrames);
  // runden statt abschneiden: ein um Rundungsreste verkuerzter letzter Step zaehlt noch
  const steps = Math.round(pcm.length / stepFrames);
  const proStep: ({ midi: number; rms: number } | null)[] = [];
  let rmsMax = 0;
  for (let s = 0; s < steps; s++) {
    const start = s * stepFrames;
    const fenster = pcm.subarray(start, Math.min(start + fensterLen, pcm.length));
    let quad = 0;
    for (let i = 0; i < fenster.length; i++) quad += fenster[i] * fenster[i];
    const rms = Math.sqrt(quad / Math.max(1, fenster.length));
    if (20 * Math.log10(rms + 1e-9) < STILL_DB) {
      proStep.push(null);
      continue;
    }
    const f0 = f0Schaetzen(fenster, sr, minHz, maxHz);
    if (!f0 || f0.klarheit < klarheitMin) {
      proStep.push(null);
      continue;
    }
    const midi = Math.max(24, Math.min(96, Math.round(69 + 12 * Math.log2(f0.hz / 440))));
    proStep.push({ midi, rms });
    rmsMax = Math.max(rmsMax, rms);
  }
  const noten: SmfNote[] = [];
  let akt: { midi: number; start: number; rms: number } | null = null;
  const schliesse = (endStep: number): void => {
    if (!akt) return;
    const velocity = Math.max(1, Math.min(127, Math.round(45 + 82 * Math.sqrt(akt.rms / (rmsMax || 1)))));
    noten.push({ tick: akt.start * T16, dauer: (endStep - akt.start) * T16, note: akt.midi, velocity, kanal: 0 });
    akt = null;
  };
  for (let s = 0; s < steps; s++) {
    const cur = proStep[s];
    if (!cur) {
      schliesse(s);
      continue;
    }
    const vorher = s > 0 ? proStep[s - 1] : null;
    const neuAnschlag = !!akt && cur.midi === akt.midi && !!vorher && cur.rms > 2 * vorher.rms;
    if (!akt || cur.midi !== akt.midi || neuAnschlag) {
      schliesse(s);
      akt = { midi: cur.midi, start: s, rms: cur.rms };
    } else {
      akt.rms = Math.max(akt.rms, cur.rms);
    }
  }
  schliesse(steps);
  return noten;
}

/** Notenliste als kuenstliches SMF-Lied — Eingang fuer den MIDI-Wizard. */
export function alsSmfLied(noten: SmfNote[], bpm: number, name: string): SmfLied {
  return { format: 0, ticksProViertel: AUDIO_TPQ, bpm, spuren: [{ name, kanal: 0, programm: null, noten }] };
}

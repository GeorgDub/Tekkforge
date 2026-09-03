/**
 * drumsZuMidi — Schlagzeug-Transkription: Anschlaege finden, nach Klangfarbe
 * einteilen, als Drum-Spuren (Kanal 10) fuer den Wizard „MIDI zu Korg".
 *
 * Verfahren, bewusst einfach und nachvollziehbar:
 *   1. Onsets aus der Energie-Differenz je 256er-Hop (`onsetKurve`), Peak-
 *      Picking mit gleitender Schwelle und Mindestabstand 60 ms.
 *   2. Je Onset ein 2048er-Fenster: Bandenergien (tief < 160 Hz, tiefmittel
 *      160–600, mittel 600–3000, hoch > 5000), spektraler Schwerpunkt, und
 *      die Ausklingzeit (bis −20 dB, hoechstens 400 ms).
 *   3. Regeln: viel Tief und Schwerpunkt unten → Kick; hoch dominant und kurz
 *      → HiHat geschlossen, lang → HiHat offen; mittel + hoch und 100–250 ms
 *      → Snare; sehr kurz und rauschig ohne Tief → Clap; sonst Perc.
 *   4. Aufs 16tel-Raster bei `bpm` runden, je Klasse eine Spur mit dem
 *      Part-Namen des Editors (Kick, Snare, Clap, HiHat cl, HiHat op, Perc 1),
 *      damit `vorschlagZiel` sie auf den passenden Drum-Part legt.
 *
 * Am besten mit einem Drum-Stem (Demucs) oder trockenen Loops; ein Vollmix
 * liefert Bass-Anschlaege als Kicks.
 */
import type { SmfLied, SmfNote, SmfSpur } from "./midiImport";
import { onsetKurve } from "./tempoAnalyse";
import { fft } from "./dsp";
import { AUDIO_TPQ } from "./audioZuMidi";

export type DrumKlasse = "Kick" | "Snare" | "Clap" | "HiHat cl" | "HiHat op" | "Perc 1";
/** GM-Noten je Klasse (Kanal 10). */
export const DRUM_NOTEN: Record<DrumKlasse, number> = { Kick: 36, Snare: 38, Clap: 39, "HiHat cl": 42, "HiHat op": 46, "Perc 1": 47 };
const REIHENFOLGE: DrumKlasse[] = ["Kick", "Snare", "Clap", "HiHat cl", "HiHat op", "Perc 1"];

export interface DrumSchlag {
  /** Sekunden */
  zeit: number;
  klasse: DrumKlasse;
  /** 1…127 */
  velocity: number;
  merkmale: { tief: number; mittel: number; hoch: number; schwerpunktHz: number; ausklingMs: number };
}

export interface DrumsOpts {
  bpm: number;
  /** Empfindlichkeit 0…1 (Standard 0,5): hoeher = mehr Anschlaege. */
  empfindlichkeit?: number;
  hop?: number;
}

/** Onset-Zeiten in Sekunden — gleitende Schwelle ueber ±0,35 s, Mindestabstand 60 ms. */
export function findeOnsets(pcm: Float32Array, sr: number, empfindlichkeit = 0.5, hop = 256): { zeit: number; staerke: number }[] {
  const kurve = onsetKurve(pcm, sr, hop);
  const n = kurve.length;
  if (!n) return [];
  const fenster = Math.max(1, Math.round((0.35 * sr) / hop));
  let max = 0;
  for (let i = 0; i < n; i++) if (kurve[i] > max) max = kurve[i];
  if (max <= 0) return [];
  const faktor = 1.6 - 1.2 * Math.min(1, Math.max(0, empfindlichkeit)); // 0,4 … 1,6 × Umgebungsmittel
  // Echte Anschlaege liegen in der Log-Energie-Differenz um 4…6, das Phasen-
  // Flimmern tiefer Kicks bei 0,2…0,9 — ein Boden relativ zum Maximum trennt das.
  const boden = max * (0.3 - 0.25 * Math.min(1, Math.max(0, empfindlichkeit)));
  const minAbstand = Math.round((0.06 * sr) / hop);
  const out: { zeit: number; staerke: number }[] = [];
  let letzter = -minAbstand;
  for (let i = 1; i < n - 1; i++) {
    const v = kurve[i];
    if (v <= boden || v < kurve[i - 1] || v < kurve[i + 1]) continue;
    let s = 0;
    let k = 0;
    for (let j = Math.max(0, i - fenster); j <= Math.min(n - 1, i + fenster); j++) {
      s += kurve[j];
      k++;
    }
    const mittel = s / k;
    if (v < mittel * faktor) continue;
    if (i - letzter < minAbstand) {
      // dichter Nachbar: der staerkere gewinnt
      if (out.length && v > out[out.length - 1].staerke) {
        out[out.length - 1] = { zeit: (i * hop) / sr, staerke: v };
        letzter = i;
      }
      continue;
    }
    out.push({ zeit: (i * hop) / sr, staerke: v });
    letzter = i;
  }
  return out;
}

const N = 2048;

/** `bisMs`: wie lange nach dem Anschlag gemessen werden darf — bis zum naechsten Onset, sonst faerbt der naechste Schlag die Ausklingzeit. */
function merkmale(pcm: Float32Array, sr: number, ab: number, bisMs = 400): DrumSchlag["merkmale"] {
  const re = new Float32Array(N);
  const im = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = pcm[ab + i] ?? 0;
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
    re[i] = x * w;
  }
  fft(re, im);
  let tief = 0;
  let tiefmittel = 0;
  let mittel = 0;
  let hoch = 0;
  let gesamt = 0;
  let gewichtet = 0;
  for (let k = 1; k < N / 2; k++) {
    const hz = (k * sr) / N;
    const e = re[k] * re[k] + im[k] * im[k];
    gesamt += e;
    gewichtet += e * hz;
    if (hz < 160) tief += e;
    else if (hz < 600) tiefmittel += e;
    else if (hz < 3000) mittel += e;
    else if (hz > 5000) hoch += e;
  }
  const norm = gesamt || 1;
  // Ausklingzeit: RMS in 10-ms-Bloecken, bis −20 dB unter dem Maximum
  const block = Math.round(sr * 0.01);
  let spitze = 0;
  const rms: number[] = [];
  const bloecke = Math.max(3, Math.min(40, Math.floor(bisMs / 10)));
  for (let b = 0; b < bloecke; b++) {
    let s = 0;
    for (let i = 0; i < block; i++) {
      const x = pcm[ab + b * block + i] ?? 0;
      s += x * x;
    }
    const r = Math.sqrt(s / block);
    rms.push(r);
    if (r > spitze) spitze = r;
  }
  let ausklingMs = bloecke * 10;
  for (let b = 0; b < rms.length; b++) {
    if (rms[b] < spitze * 0.1 && b > 0 && rms.slice(0, b).some((r) => r >= spitze * 0.5)) {
      ausklingMs = b * 10;
      break;
    }
  }
  return { tief: tief / norm, mittel: (tiefmittel + mittel) / norm, hoch: hoch / norm, schwerpunktHz: gewichtet / norm, ausklingMs };
}

export function klassifiziere(m: DrumSchlag["merkmale"]): DrumKlasse {
  if (m.tief > 0.45 && m.schwerpunktHz < 500) return "Kick";
  if (m.hoch > 0.5 && m.schwerpunktHz > 4000) return m.ausklingMs >= 150 ? "HiHat op" : "HiHat cl";
  if (m.tief < 0.2 && m.hoch > 0.25 && m.ausklingMs < 90) return "Clap";
  if (m.mittel + m.hoch > 0.55 && m.ausklingMs >= 90 && m.ausklingMs <= 300) return "Snare";
  if (m.tief > 0.3) return "Kick";
  return "Perc 1";
}

/** Anschlaege mit Klasse und Velocity (Onset-Staerke, auf 40…127 gespreizt). */
export function drumSchlaege(pcm: Float32Array, sr: number, opts: DrumsOpts): DrumSchlag[] {
  const onsets = findeOnsets(pcm, sr, opts.empfindlichkeit ?? 0.5, opts.hop ?? 256);
  if (!onsets.length) return [];
  const maxS = Math.max(...onsets.map((o) => o.staerke));
  return onsets.map((o, i) => {
    const ab = Math.max(0, Math.round(o.zeit * sr) - 64);
    const bisMs = i + 1 < onsets.length ? (onsets[i + 1].zeit - o.zeit) * 1000 - 10 : 400;
    const m = merkmale(pcm, sr, ab, bisMs);
    return { zeit: o.zeit, klasse: klassifiziere(m), velocity: Math.max(40, Math.min(127, Math.round(40 + (87 * o.staerke) / maxS))), merkmale: m };
  });
}

/** Je Klasse eine Drum-Spur (Kanal 10), Noten aufs 16tel-Raster gerundet, Doppelte im selben Step verschmolzen. */
export function drumsZuSmf(schlaege: readonly DrumSchlag[], bpm: number, name: string): SmfLied {
  const t16 = AUDIO_TPQ / 4;
  const spuren: SmfSpur[] = [];
  for (const klasse of REIHENFOLGE) {
    const eigene = schlaege.filter((s) => s.klasse === klasse);
    if (!eigene.length) continue;
    const proStep = new Map<number, SmfNote>();
    for (const s of eigene) {
      const tick = Math.round((s.zeit * bpm) / 60 / (t16 / AUDIO_TPQ)) * t16;
      const da = proStep.get(tick);
      if (!da || da.velocity < s.velocity) proStep.set(tick, { tick, dauer: t16, note: DRUM_NOTEN[klasse], velocity: s.velocity, kanal: 9 });
    }
    spuren.push({ name: klasse, kanal: 9, programm: null, noten: [...proStep.values()].sort((a, b) => a.tick - b.tick) });
  }
  return { format: 1, ticksProViertel: AUDIO_TPQ, bpm, spuren: spuren.length ? spuren : [{ name, kanal: 9, programm: null, noten: [] }] };
}

/** Alles in einem: Audio → Drum-Lied. */
export function transkribiereDrums(pcm: Float32Array, sr: number, opts: DrumsOpts, name = "Drums"): { lied: SmfLied; schlaege: DrumSchlag[] } {
  const schlaege = drumSchlaege(pcm, sr, opts);
  return { lied: drumsZuSmf(schlaege, opts.bpm, name), schlaege };
}

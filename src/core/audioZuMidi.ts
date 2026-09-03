/**
 * audioZuMidi — einstimmige Audio-zu-MIDI-Transkription (MKMs "Audio zu Korg",
 * bewusst nachgereicht). Je 16tel-Step eine Autokorrelations-Tonhoehe; Steps
 * gleicher Hoehe verschmelzen zu Noten, ein Pegelsprung auf gleicher Hoehe
 * beginnt eine neue Note. Das Ergebnis ist ein kuenstliches SmfLied und laeuft
 * unveraendert durch Piano Roll und Pattern-Bau des MIDI-Wizards.
 */
import type { SmfNote, SmfLied } from "./midiImport";
import { polyPhaseResample } from "./audioProcessor";
import { fft } from "./dsp";

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
  /** Gleichzeitige Toene je Step: 1 = einstimmig (Autokorrelation), 2..4 = polyphon (Spektrum). */
  stimmen?: number;
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
  // Verfeinerung nur mit ECHTEN Nachbarn: ausserhalb [minLag, maxLag] steht in
  // der Float32Array eine unberechnete 0, kein undefined — die wuerde die
  // Parabel an den Raendern um bis zu einen halben Lag verziehen
  let delta = 0;
  if (wahl > minLag && wahl < maxLag) {
    const a = r[wahl - 1];
    const b = r[wahl];
    const c = r[wahl + 1];
    const nenner = a - 2 * b + c;
    const roh = nenner ? (a - c) / (2 * nenner) : 0;
    if (Math.abs(roh) < 1) delta = roh;
  }
  return { hz: sr / (wahl + delta), klarheit: r[wahl] };
}

// ─── Polyphon: Harmonische Summe je Step, iterativ mit Spektral-Abzug ────────

const HARMONISCHE = 8;
/** Anteil des staerksten Tons, ab dem ein weiterer Ton noch als eigener gilt. */
const NEBEN_SCHWELLE = 0.42;
const MIDI_MIN = 24;
const MIDI_MAX = 96;
const hzVon = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Groesster Betrag in den Bins um `hz` (±1 Bin gegen Raster-Versatz). */
function betragBei(mag: Float32Array, hz: number, sr: number, n: number): number {
  const bin = (hz * n) / sr;
  const von = Math.max(1, Math.floor(bin) - 1);
  const bis = Math.min(mag.length - 1, Math.ceil(bin) + 1);
  let m = 0;
  for (let k = von; k <= bis; k++) if (mag[k] > m) m = mag[k];
  return m;
}

/** Betraege um `hz` daempfen — der erkannte Ton verschwindet aus dem Spektrum. */
function zieheAb(mag: Float32Array, hz: number, sr: number, n: number): void {
  const bin = (hz * n) / sr;
  const von = Math.max(1, Math.floor(bin) - 1);
  const bis = Math.min(mag.length - 1, Math.ceil(bin) + 1);
  for (let k = von; k <= bis; k++) mag[k] = 0;
}

/** Salienz eines Tons: gewichtete Summe seiner Harmonischen (1/h). */
function salienz(mag: Float32Array, midi: number, sr: number, n: number): number {
  const f0 = hzVon(midi);
  let s = 0;
  for (let h = 1; h <= HARMONISCHE; h++) {
    const f = f0 * h;
    if (f >= sr / 2) break;
    s += betragBei(mag, f, sr, n) / h;
  }
  return s;
}

/** Bis zu `stimmen` Toene eines Fensters — staerkster zuerst, danach abgezogen. */
function toeneImFenster(mag: Float32Array, sr: number, n: number, stimmen: number, midiVon: number, midiBis: number): { midi: number; staerke: number }[] {
  const out: { midi: number; staerke: number }[] = [];
  let erste = 0;
  for (let runde = 0; runde < stimmen; runde++) {
    let best = -1;
    let bestS = 0;
    for (let m = midiVon; m <= midiBis; m++) {
      if (out.some((o) => o.midi === m)) continue;
      const s = salienz(mag, m, sr, n);
      if (s > bestS) {
        bestS = s;
        best = m;
      }
    }
    if (best < 0) break;
    if (runde === 0) erste = bestS;
    else if (bestS < erste * NEBEN_SCHWELLE) break;
    out.push({ midi: best, staerke: bestS });
    const f0 = hzVon(best);
    for (let h = 1; h <= HARMONISCHE && f0 * h < sr / 2; h++) zieheAb(mag, f0 * h, sr, n);
  }
  return out;
}

/** Betragsspektrum eines Hann-gefensterten Ausschnitts (nullgepolstert auf n). */
function spektrum(pcm: Float32Array, start: number, n: number): Float32Array {
  const re = new Float32Array(n);
  const im = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = start + i < pcm.length ? pcm[start + i] : 0;
    re[i] = v * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  fft(re, im);
  const mag = new Float32Array(n / 2);
  for (let k = 0; k < n / 2; k++) mag[k] = Math.hypot(re[k], im[k]);
  return mag;
}

function polyphonTranskribieren(pcm: Float32Array, sr: number, opts: TranskriptionOpts, stimmen: number): SmfNote[] {
  const stepFrames = Math.max(1, Math.round(((60 / opts.bpm) * sr) / 4));
  let n = 2048;
  while (n < stepFrames) n <<= 1;
  const steps = Math.round(pcm.length / stepFrames);
  const midiVon = Math.max(MIDI_MIN, Math.round(69 + 12 * Math.log2((opts.minHz ?? 55) / 440)));
  const midiBis = Math.min(MIDI_MAX, Math.round(69 + 12 * Math.log2((opts.maxHz ?? 1050) / 440)));
  const jeStep: Map<number, number>[] = [];
  let maxStaerke = 0;
  for (let s = 0; s < steps; s++) {
    const start = s * stepFrames;
    let quad = 0;
    for (let i = start; i < Math.min(start + stepFrames, pcm.length); i++) quad += pcm[i] * pcm[i];
    const rms = Math.sqrt(quad / Math.max(1, Math.min(stepFrames, pcm.length - start)));
    if (20 * Math.log10(rms + 1e-9) < STILL_DB) {
      jeStep.push(new Map());
      continue;
    }
    const treffer = toeneImFenster(spektrum(pcm, start, n), sr, n, stimmen, midiVon, midiBis);
    const karte = new Map<number, number>();
    for (const t of treffer) {
      karte.set(t.midi, t.staerke);
      if (t.staerke > maxStaerke) maxStaerke = t.staerke;
    }
    jeStep.push(karte);
  }
  // Steps zu Noten verschmelzen: gleiche Tonhoehe in Folge = eine Note.
  // Die **Stimme** (tiefster Ton = 0) landet im Kanal-Feld — damit lassen sich
  // die Linien spaeter auf eigene Parts verteilen, statt alles als Akkord auf
  // einen zu legen.
  const noten: SmfNote[] = [];
  const offen = new Map<number, { start: number; staerke: number; stimme: number }>();
  const schliesse = (midi: number, endStep: number): void => {
    const o = offen.get(midi);
    if (!o) return;
    offen.delete(midi);
    const velocity = Math.max(1, Math.min(127, Math.round(45 + 82 * Math.sqrt(o.staerke / (maxStaerke || 1)))));
    noten.push({ tick: o.start * T16, dauer: (endStep - o.start) * T16, note: midi, velocity, kanal: o.stimme });
  };
  for (let s = 0; s < steps; s++) {
    const karte = jeStep[s];
    for (const midi of [...offen.keys()]) if (!karte.has(midi)) schliesse(midi, s);
    // Stimme nach Tonhoehe: der tiefste Ton dieses Steps ist Stimme 0. Das
    // trennt Bass von Melodie zuverlaessiger als die Reihenfolge, in der die
    // Toene gefunden wurden (die richtet sich nach der Lautstaerke).
    const nachHoehe = [...karte.keys()].sort((a, b) => a - b);
    for (const [midi, staerke] of karte) {
      const stimme = nachHoehe.indexOf(midi);
      const o = offen.get(midi);
      if (o) o.staerke = Math.max(o.staerke, staerke);
      else offen.set(midi, { start: s, staerke, stimme });
    }
  }
  for (const midi of [...offen.keys()]) schliesse(midi, steps);
  return noten.sort((a, b) => a.tick - b.tick || a.note - b.note);
}

/**
 * Mono-PCM → Notenliste im 16tel-Raster (Ticks: AUDIO_TPQ pro Viertel).
 * `stimmen` > 1 schaltet auf den polyphonen Spektral-Pfad um.
 */
export function transkribiereAudio(pcm: Float32Array, sr: number, opts: TranskriptionOpts): SmfNote[] {
  // Runter auf 22,05 kHz: der Suchbereich endet bei ~1 kHz, und die
  // Autokorrelation wird dadurch rund vierfach billiger (UI bleibt fluessig)
  if (sr > 24000) {
    pcm = polyPhaseResample(pcm, sr, 22050, 1);
    sr = 22050;
  }
  const stimmen = Math.max(1, Math.min(4, Math.round(opts.stimmen ?? 1)));
  if (stimmen > 1) return polyphonTranskribieren(pcm, sr, opts, stimmen);
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

/** Notenliste als kuenstliches SMF-Lied — alles auf einer Spur. */
export function alsSmfLied(noten: SmfNote[], bpm: number, name: string): SmfLied {
  return { format: 0, ticksProViertel: AUDIO_TPQ, bpm, spuren: [{ name, kanal: 0, programm: null, noten }] };
}

/** Lagenamen fuer bis zu vier Stimmen — verstaendlicher als "Stimme 3". */
const LAGE = ["tief", "mittel", "hoch", "oben"];

/**
 * Wie {@link alsSmfLied}, aber **je Stimme eine eigene Spur**. Im Wizard
 * landet dann jede Linie auf einem eigenen Part: Bass und Melodie lassen sich
 * getrennt mit Samples belegen, statt als Akkord auf einem Part zu kleben.
 * Einstimmiges Material ergibt weiterhin genau eine Spur.
 */
export function alsSmfLiedProStimme(noten: SmfNote[], bpm: number, name: string): SmfLied {
  const stimmen = [...new Set(noten.map((n) => n.kanal))].sort((a, b) => a - b);
  const spuren = stimmen.map((stimme, i) => ({
    name: `${name} ${i + 1} (${LAGE[i] ?? i + 1})`.slice(0, 24),
    // Eigener Kanal je Spur — sonst schlaegt der Wizard fuer alle denselben Part vor
    kanal: Math.min(15, i),
    programm: null,
    noten: noten.filter((n) => n.kanal === stimme).map((n) => ({ ...n, kanal: Math.min(15, i) })),
  }));
  return { format: 1, ticksProViertel: AUDIO_TPQ, bpm, spuren };
}

/**
 * Ein fremdes SMF (basic-pitch schreibt 120 BPM als Zeitbasis) auf das
 * geschaetzte Lied-Tempo legen: die Zeiten bleiben, die Ticks werden so
 * umgerechnet, dass das 16tel-Raster des Wizards bei `bpm` stimmt.
 */
export function smfAufTempo(lied: SmfLied, bpm: number): SmfLied {
  if (!(bpm > 0) || !(lied.bpm > 0) || bpm === lied.bpm) return { ...lied, bpm: bpm > 0 ? bpm : lied.bpm };
  const f = bpm / lied.bpm;
  return {
    ...lied,
    bpm,
    spuren: lied.spuren.map((s) => ({
      ...s,
      noten: s.noten.map((n) => ({ ...n, tick: Math.round(n.tick * f), dauer: Math.max(1, Math.round(n.dauer * f)) })),
    })),
  };
}

/**
 * Alle Noten eines Lieds nach Tonlage auf bis zu `n` Stimmen verteilen —
 * gleich grosse Gruppen nach Tonhoehe (tief → hoch), damit Bass und Melodie
 * getrennt auf Parts landen. Liefert das Lied mit einer Spur je Stimme
 * (Kanal = Stimmenindex), wie {@link alsSmfLiedProStimme}.
 */
export function stimmenNachLage(lied: SmfLied, n: number, name: string): SmfLied {
  const alle = lied.spuren.flatMap((s) => s.noten);
  if (!alle.length) return lied;
  const k = Math.max(1, Math.min(4, Math.floor(n)));
  if (k === 1) return alsSmfLied(alle.map((x) => ({ ...x, kanal: 0 })), lied.bpm, name);
  const hoehen = [...new Set(alle.map((x) => x.note))].sort((a, b) => a - b);
  // Grenzen: gleich viele verschiedene Tonhoehen je Stimme
  const grenzen: number[] = [];
  for (let i = 1; i < k; i++) grenzen.push(hoehen[Math.min(hoehen.length - 1, Math.floor((hoehen.length * i) / k))]);
  const stimme = (note: number): number => {
    let s = 0;
    while (s < grenzen.length && note >= grenzen[s]) s++;
    return s;
  };
  const noten = alle.map((x) => ({ ...x, kanal: stimme(x.note) })).sort((a, b) => a.tick - b.tick || a.note - b.note);
  const r = alsSmfLiedProStimme(noten, lied.bpm, name);
  return { ...r, ticksProViertel: lied.ticksProViertel };
}

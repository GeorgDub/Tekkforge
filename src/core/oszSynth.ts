/**
 * oszSynth — Ersatzklaenge fuer die Synth-Oszillatoren der Firmware, damit
 * das Vorhoeren nicht stumm bleibt, wenn ein Part auf 1…362 zeigt.
 *
 * Das ist KEIN Nachbau der Electribe-Engine, sondern eine grobe Naeherung nach
 * Name und Kategorie der Oszillator-Liste (core/oszNamen.ts): Saegezahn,
 * Puls, Dreieck, Sinus; UNI/DUAL als verstimmte Doppel, OCT mit Oktave, SYNC
 * als hart synchronisierter Saegezahn, RING als Ringmodulation, CHIP als
 * schmaler Puls, NOISE gefiltert; X-… als Zwei-Operator-FM mit dem Halbton aus
 * dem Namen als Modulatorverhaeltnis; VPM als Phasenmodulation mit dem Ratio
 * aus dem Namen. Audio In bleibt still. Alles auf C4 (MIDI 60), 2 s, damit
 * das Vorhoeren wie bei Samples die Tonhoehe ueber die Abspielrate setzt.
 */
import type { PoolSample } from "./editorModel";
import { OSZ_LISTEN, oszListeWahl, type OszListe } from "./oszNamen";

const SR = 44100;
const DAUER_S = 2;
const C4 = 261.6256;

const saw = (ph: number): number => 2 * (ph - Math.floor(ph + 0.5));
const tri = (ph: number): number => 1 - 4 * Math.abs(ph - Math.floor(ph + 0.5));
const puls = (ph: number, breite = 0.5): number => (ph - Math.floor(ph) < breite ? 1 : -1);
const sinus = (ph: number): number => Math.sin(2 * Math.PI * ph);
const welle = (form: string, ph: number): number =>
  form === "SAW" ? saw(ph) : form === "TRI" || form === "TRIANGLE" ? tri(ph) : form === "SINE" || form === "SIN" ? sinus(ph) : form === "PULSE" || form === "SQU" || form === "SQUARE" ? puls(ph) : saw(ph);

/** Kleines deterministisches Rauschen. */
function rauschen(n: number): Float32Array {
  const out = new Float32Array(n);
  let x = 0x2545f491;
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out[i] = (x / 0xffffffff) * 2 - 1;
  }
  return out;
}

function huelle(i: number, n: number): number {
  return Math.min(1, i / (SR * 0.004), (n - i) / (SR * 0.02));
}

/** Das PCM eines Eintrags nach Name/Kategorie. */
export function oszPcm(name: string, kategorie: string): Float32Array {
  const n = Math.round(SR * DAUER_S);
  const out = new Float32Array(n);
  const N = name.toUpperCase();
  if (kategorie === "Audio In") return out;
  const f = C4;
  if (kategorie === "FM") {
    // „X-SAW -3“: Traeger nach Wellenform, Modulator um den Halbton verstimmt
    const m = /^X-([A-Z]+)\s*([-+]?\d+)?/.exec(N);
    const form = m?.[1] ?? "SAW";
    const halb = Number(m?.[2] ?? 0);
    const ratio = Math.pow(2, halb / 12);
    const index = 1.2;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const mod = Math.sin(2 * Math.PI * f * ratio * t) * index;
      out[i] = welle(form, f * t + mod / (2 * Math.PI)) * 0.5 * huelle(i, n);
    }
    return out;
  }
  if (kategorie === "VPM") {
    const m = /^VPM-([A-Z]+)\s*([\d.]+)?/.exec(N);
    const form = m?.[1] ?? "SINE";
    const ratio = Number(m?.[2] ?? 1) || 1;
    for (let i = 0; i < n; i++) {
      const t = i / SR;
      const mod = Math.sin(2 * Math.PI * f * ratio * t) * 0.8;
      out[i] = welle(form, f * t + mod / (2 * Math.PI)) * 0.5 * huelle(i, n);
    }
    return out;
  }
  // Analog
  if (/NOISE/.test(N)) {
    const r = rauschen(n);
    let y = 0;
    for (let i = 0; i < n; i++) {
      // HPF: Differenz; LPF/LOFI/REZ: einfacher Tiefpass — grob, aber unterscheidbar
      if (/HPF/.test(N)) y = i ? r[i] - r[i - 1] : 0;
      else y += (r[i] - y) * (/REZ/.test(N) ? 0.08 : 0.2);
      out[i] = y * (/HPF/.test(N) ? 0.35 : 0.6) * huelle(i, n);
    }
    return out;
  }
  const grund = /SAW/.test(N) ? "SAW" : /SQU|PULSE/.test(N) ? "PULSE" : /TRI/.test(N) ? "TRI" : /SINE/.test(N) ? "SINE" : "SAW";
  const zweit = /UNI|DUAL/.test(N) ? Math.pow(2, 7 / 1200) : /OCT/.test(N) ? 2 : /RING/.test(N) ? 1.5 : /SYNC/.test(N) ? 1.37 : 0;
  const chip = /CHIP/.test(N);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    let y: number;
    if (chip) y = /NOISE/.test(N) ? 0 : puls(f * t, 0.25);
    else if (/SYNC/.test(N)) {
      // Slave laeuft mit zweit·f, wird je Master-Periode zurueckgesetzt
      const master = f * t - Math.floor(f * t);
      y = welle(grund, master * zweit);
    } else if (/RING/.test(N)) y = welle(grund, f * t) * sinus(f * zweit * t);
    else if (zweit) y = 0.5 * (welle(grund, f * t) + welle(grund, f * zweit * t));
    else y = welle(grund, f * t);
    out[i] = y * 0.5 * huelle(i, n);
  }
  return out;
}

const cache = new Map<string, PoolSample>();

/** Ein Ersatz-PoolSample fuer die Oszillator-Nummer (1-basiert) — null, wenn die Liste sie nicht kennt. */
export function oszSample(nummer: number, liste: OszListe = oszListeWahl()): PoolSample | null {
  const e = OSZ_LISTEN[liste][nummer - 1];
  if (!e) return null;
  const key = `${liste}:${nummer}`;
  const da = cache.get(key);
  if (da) return da;
  const s: PoolSample = { number: nummer, name: e[0], sampleRate: SR, pcm: oszPcm(e[0], e[1]) };
  cache.set(key, s);
  return s;
}

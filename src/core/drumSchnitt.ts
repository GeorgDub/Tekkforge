/**
 * drumSchnitt — Kick/Snare/Hat-One-Shots aus einem Drums-Stem (mono):
 * Onsets per Peak-Picking auf der Onset-Kurve (Mindestabstand 60 ms), dann
 * in ZWEI Durchgaengen: erst kurz schneiden und einordnen, dann die Laenge
 * nach der Rolle festlegen (Kick bis 0,45 s durch die Hats hindurch, Snare
 * bis 0,3 s, Hat bis zum naechsten Schlag), kurzer Fade-Out,
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
/** Kicks duerfen laenger klingen — der Ausklang ist bei Tekk der halbe Klang. */
const KICK_MAX_SEK = 0.45;
/**
 * Kuerzer als das wird ein Kick nicht geschnitten — egal was danach kommt.
 *
 * Noetig, weil der nachklingende Kick unter den Hats selbst wieder bassreich
 * ist und die Einordnung die Hats dann ebenfalls fuer Kicks haelt. Ohne diese
 * Untergrenze schnitte sich der Kick weiter selbst ab. Bei 200 BPM liegen
 * echte Kicks auf den Vierteln, also 300 ms auseinander; 180 ms nehmen im
 * schlimmsten Fall einen Hauch des naechsten mit — deutlich besser als ein
 * Kick ohne Bauch.
 */
const KICK_MIN_SEK = 0.18;
const SNARE_MAX_SEK = 0.3;
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

  // ── Erster Durchgang: kurz schneiden und einordnen ────────────────────────
  //
  // Fuer die Einordnung reicht der Anfang eines Schlags — Bassanteil und
  // Helligkeit stehen nach wenigen Millisekunden fest.
  const rollen: (DrumRolle | null)[] = onsets.map((start, i) => {
    const ende = Math.min(onsets[i + 1] ?? pcm.length, start + Math.round(MAX_SHOT_SEK * sr), pcm.length);
    if (ende - start < MIN_FRAMES) return null;
    const seg = pcm.subarray(start, ende);
    if (rmsDb(seg) < -40) return null;
    const bass = bassAnteil(seg, sr, 150);
    const dunkel = bassAnteil(seg, sr, 3000); // Anteil unterhalb 3 kHz
    return bass > 0.3 ? "kick" : dunkel < 0.5 ? "hat" : "snare";
  });

  // ── Zweiter Durchgang: die Laenge richtet sich nach der ROLLE ─────────────
  //
  // Vorher endete jeder Schnitt am naechsten Onset. In einem dichten Stem sitzt
  // dort schon die naechste Hat — und der Kick verlor genau seinen Bauch. Am
  // echten Lied gemessen kamen 0,09 s heraus; die tekk4-Kicks sind 0,32 bis
  // 0,37 s lang. Ein Tekk-Kick IST der lange, gestimmte Ausklang, 90 ms sind
  // nur der Anschlag — deshalb "hat es nicht gekickt".
  //
  // Ein Kick darf also durch die Hats hindurchklingen (im Original tut er das
  // auch), aber nicht in den naechsten Kick hineinlaufen; sonst steckte er
  // zweimal im selben Sample. Fuer die Snare gilt dasselbe eine Stufe kuerzer,
  // die Hat bleibt kurz — sie hat keinen Bauch zu verlieren.
  const grenze: Record<DrumRolle, { maxSek: number; stoppBei: DrumRolle[] }> = {
    kick: { maxSek: KICK_MAX_SEK, stoppBei: ["kick"] },
    snare: { maxSek: SNARE_MAX_SEK, stoppBei: ["kick", "snare"] },
    hat: { maxSek: MAX_SHOT_SEK, stoppBei: ["kick", "snare", "hat"] },
  };
  const kandidaten: DrumTreffer[] = [];
  for (let i = 0; i < onsets.length; i++) {
    const rolle = rollen[i];
    if (!rolle) continue;
    const start = onsets[i];
    const g = grenze[rolle];
    let ende = Math.min(start + Math.round(g.maxSek * sr), pcm.length);
    for (let j = i + 1; j < onsets.length; j++) {
      const r = rollen[j];
      if (r && g.stoppBei.includes(r)) {
        ende = Math.min(ende, onsets[j]);
        break;
      }
    }
    if (rolle === "kick") ende = Math.max(ende, Math.min(start + Math.round(KICK_MIN_SEK * sr), pcm.length));
    if (ende - start < MIN_FRAMES) continue;
    const seg = fadeOut(pcm.subarray(start, ende), 0.01, sr);
    const db = rmsDb(seg);
    if (db < -40) continue;
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

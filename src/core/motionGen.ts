/**
 * motionGen — Motion-Sequenzen fuer erzeugte Patterns.
 *
 * Das Pattern-Format traegt acht Motion-Slots (ParamID, Ziel-Part, 64 Werte),
 * `writeMotionTable` schreibt sie seit langem — nur setzte der Generator nie
 * einen. Dabei ist genau das der Tekk-Sound: der Filter geht ueber den Aufbau
 * auf, der Master-FX faehrt im Drop hoch, die Kick faellt im letzten Takt.
 *
 * ParamIDs (Werksbank e2s-2016, 248 belegte Slots, Auswertung 2026-09-04):
 *
 * | ID | Beleg |
 * |----|-------|
 * | 4  | Osc Edit — ✔ am Geraet gemessen |
 * | 5  | Filter Cutoff — 45 Slots, 31 davon Rampen 0…106 auf Drum- UND Synth-Parts: die haeufigste Automation der Werksbank, so sieht ein Sweep aus |
 * | 2  | Pitch — vermutet: 4 Slots, Werte 43…65 um die Mitte 64 (wie oscPitch signiert um 0) |
 * | 16 | Master-FX Edit — global (Ziel 0), 29 Slots, 23 Rampen 0…69 |
 * | 15 | Master-FX an/aus — global, 21 von 29 Slots binaer 0/127 |
 * | 17 | IFX an/aus — 25 Slots, fast nur Synth-Parts, binaer |
 *
 * Alles ausser 4 ist aus der Verteilung abgeleitet, nicht gemessen —
 * `MOTTEST.e2spat` (scripts/make-mottest.mjs) prueft es am Ohr.
 */
import type { E2MotionSlot } from "./electribePatternBuilder";

export const MOTION_PARAM = {
  oscEdit: 4,
  cutoff: 5,
  pitch: 2,
  mfxEdit: 16,
  mfxOn: 15,
  ifxOn: 17,
} as const;

export const MOTION_STEPS = 64;
export const MOTION_MAX = 127;
/** Mehr Slots kennt das Pattern nicht. */
export const MOTION_SLOTS = 8;

const klemme = (v: number): number => Math.max(0, Math.min(MOTION_MAX, Math.round(v)));

/** Lineare Rampe von `von` nach `bis` ueber n Werte (n = 1 → nur `von`). */
export function rampe(von: number, bis: number, n = MOTION_STEPS): number[] {
  return Array.from({ length: n }, (_, i) => klemme(n > 1 ? von + ((bis - von) * i) / (n - 1) : von));
}

/** Bis Step `ab` konstant `von`, danach linear auf `bis` am letzten Step. */
export function fall(ab: number, von: number, bis: number, n = MOTION_STEPS): number[] {
  const a = Math.max(0, Math.min(n - 1, ab));
  return Array.from({ length: n }, (_, i) => (i < a ? klemme(von) : klemme(n - 1 > a ? von + ((bis - von) * (i - a)) / (n - 1 - a) : bis)));
}

/** Die Melo-Parts 13/14 (0-basiert 12/13) — dort sitzt der Filter-Sweep des Aufbaus. */
export const AUFBAU_CUTOFF_ZIELE: readonly number[] = [12, 13];
export const AUFBAU_CUTOFF_VON = 30;
export const AUFBAU_CUTOFF_BIS = 127;

/**
 * Filter-Sweep ueber den Aufbau: Stufe i von `anzahl` deckt den Abschnitt
 * i/anzahl … (i+1)/anzahl der Strecke 30 → 127 ab, so dass die Kette als
 * ganze einen durchgehenden Anstieg spielt und die letzte Stufe offen endet.
 */
export function aufbauMotion(stufe: number, anzahl: number, ziele: readonly number[] = AUFBAU_CUTOFF_ZIELE): E2MotionSlot[] {
  const n = Math.max(1, anzahl);
  const i = Math.max(0, Math.min(n - 1, stufe));
  const spanne = AUFBAU_CUTOFF_BIS - AUFBAU_CUTOFF_VON;
  const von = AUFBAU_CUTOFF_VON + (spanne * i) / n;
  const bis = AUFBAU_CUTOFF_VON + (spanne * (i + 1)) / n;
  return ziele.slice(0, MOTION_SLOTS).map((part) => ({ paramId: MOTION_PARAM.cutoff, targetPart: part, values: rampe(von, bis) }));
}

export const DROP_MFX_BIS = 80;
export const DROP_PITCH_AB = 56;
export const DROP_PITCH_VON = 64;
export const DROP_PITCH_BIS = 40;

/**
 * Drop: der Master-FX faehrt ueber die vier Takte hoch (global), die Kick
 * (Part 1) faellt im letzten halben Takt in der Tonhoehe — der Anlauf in den
 * naechsten Durchlauf.
 */
export function dropMotion(kickPart = 0): E2MotionSlot[] {
  return [
    { paramId: MOTION_PARAM.mfxEdit, targetPart: -1, values: rampe(0, DROP_MFX_BIS) },
    { paramId: MOTION_PARAM.pitch, targetPart: kickPart, values: fall(DROP_PITCH_AB, DROP_PITCH_VON, DROP_PITCH_BIS) },
  ];
}

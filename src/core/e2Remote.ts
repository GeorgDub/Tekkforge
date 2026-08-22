/**
 * e2Remote.ts — Fernbedienung der Electribe 2 über STOCK-MIDI: Program
 * Change (Patternwechsel), Noten (Pad-Trigger/Keyboard), Realtime Start/Stop
 * und die Schalter-Logik der LED-Buttons (Filterband, IFX On, Amp EG, MFX
 * Send). Reine Byte-/Zustandslogik ohne DOM, damit sie testbar ist.
 *
 * Gerätestand (gemessen, siehe partParams.ts / panelState.ts):
 *   filterType 0 = aus, 1–6 LPF, 7–11 HPF, 12–16 BPF — Stock nutzt 1/7/12.
 *   Part n hört auf MIDI-Kanal n (Regler-CCs so gemessen, e2KnobCc.ts).
 *   Patternwechsel (KORG „electribe sampler MIDI Implementation" Rev 1.00,
 *   Note *2/*6 — Programmnummern sind 1-BASIERT, Program 0 gibt es nicht):
 *     Pattern 001–127 → Bank MSB 0, LSB 0, Program 1–127
 *     Pattern 128–250 → Bank MSB 0, LSB 1, Program 1–123 (KORGs Tabelle sagt
 *                       „1–121", das deckt aber nur 248 Patterns — wir bilden
 *                       lückenlos N−127 ab)
 *   Gilt nur, wenn der Global-RECEIVE-FILTER auf „Off" oder „Short" steht.
 *   Befund 2026-08-22 am Nutzergerät (gestoppt, Clock Internal, Filter Off):
 *   nach dem Program Change lieferte der Edit-Buffer-Dump (0x10) weiterhin
 *   das alte Pattern — das Gerät merkt den Wechsel offenbar nur vor und lädt
 *   beim nächsten Start. Am laufenden Gerät noch nicht gemessen.
 *   IFX On/Off = CC 104, MFX Send = CC 105, Master FX On/Off = CC 106 (Stock).
 */

/** Stock-CCs für die Schalter (KORG MIDI-Implementation, Klasse S = Filter „Off"). */
export const SCHALTER_CC: Record<string, number> = {
  ifxOn: 104,
  mfxSend: 105,
};

/** CC-Nachricht für einen 0/1-Schalter auf dem Kanal des Parts, oder null ohne CC. */
export function buildSchalterCc(part0: number, key: string, an: boolean): Uint8Array | null {
  const cc = SCHALTER_CC[key];
  if (cc === undefined) return null;
  return Uint8Array.from([0xb0 | (part0 & 0x0f), cc, an ? 127 : 0]);
}

/** Bank-LSB + Program (1-basiert) → Pattern-Index 0..249, oder null bei Program 0. */
export function patternIndexFromProgram(bankLsb: number, program: number): number | null {
  if (program < 1) return null;
  const idx = (bankLsb ? 127 : 0) + program - 1;
  return idx <= 249 ? idx : null;
}

import type { FilterBand } from "./panelState";

export const MIDI_START = 0xfa;
export const MIDI_STOP = 0xfc;

/** Filtertyp, den ein Band-Button setzt (Stock-Werte der drei Familien). */
export const BAND_FILTER_TYPE: Record<Exclude<FilterBand, "off" | "ext">, number> = {
  lpf: 1,
  hpf: 7,
  bpf: 12,
};

/**
 * Band-Button gedrückt: anderes Band → dessen Stock-Typ; dasselbe Band
 * nochmal → Filter aus (0), wie ein Umschalter am Gerät.
 */
export function filterTypeNachBandKlick(aktuellesBand: FilterBand, band: "lpf" | "hpf" | "bpf"): number {
  return aktuellesBand === band ? 0 : BAND_FILTER_TYPE[band];
}

/** 0/1-Schalter kippen (undefined zählt als aus). */
export function kippeSchalter(wert: number | undefined): number {
  return wert === 1 ? 0 : 1;
}

/** Program Change für Pattern-Index 0..249 (Anzeige = Index + 1). */
export function buildProgramChange(globalChannel0: number, patternIdx0: number): Uint8Array[] {
  if (!Number.isInteger(patternIdx0) || patternIdx0 < 0 || patternIdx0 > 249) {
    throw new RangeError(`Pattern-Index ${patternIdx0} außerhalb 0..249`);
  }
  const ch = globalChannel0 & 0x0f;
  const bankLsb = patternIdx0 >= 127 ? 1 : 0;
  const program = bankLsb ? patternIdx0 - 127 + 1 : patternIdx0 + 1;
  return [
    Uint8Array.from([0xb0 | ch, 0x00, 0x00]),
    Uint8Array.from([0xb0 | ch, 0x20, bankLsb]),
    Uint8Array.from([0xc0 | ch, program]),
  ];
}

/** Note On/Off auf dem Kanal des Parts (Kanal = Part, 0-basiert). */
export function buildNoteOn(part0: number, note: number, velocity = 100): Uint8Array {
  return Uint8Array.from([0x90 | (part0 & 0x0f), note & 0x7f, Math.max(1, Math.min(127, velocity))]);
}

export function buildNoteOff(part0: number, note: number): Uint8Array {
  return Uint8Array.from([0x80 | (part0 & 0x0f), note & 0x7f, 0]);
}

/** Keyboard-Modus: Pad 0..15 → chromatisch ab C3 (MIDI 48). */
export const KEYBOARD_BASIS = 48;

export function keyboardNote(pad: number): number {
  return KEYBOARD_BASIS + Math.max(0, Math.min(15, pad));
}

/** Trigger-Modus: Part spielt seinen Originalton (C4 = 60, wie im Editor). */
export const TRIGGER_NOTE = 60;

/**
 * Pattern-Set-Modus: Takt-Buttons 1–4 = Seiten à 16 Patterns (1–64).
 * Pad i auf Seite s → Pattern-Index s*16 + i.
 */
export function patternSetIndex(seite: number, pad: number): number {
  return Math.max(0, Math.min(3, seite)) * 16 + Math.max(0, Math.min(15, pad));
}

/** Zyklisches Weiterschalten eines Auswahlwerts (Sample/Mod-Typ/IFX-Typ/Pattern). */
export function schritt(wert: number, delta: number, min: number, max: number): number {
  const n = max - min + 1;
  return min + ((((wert - min + delta) % n) + n) % n);
}

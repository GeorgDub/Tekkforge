/**
 * e2Remote.ts — Fernbedienung der Electribe 2 über STOCK-MIDI: Program
 * Change (Patternwechsel), Noten (Pad-Trigger/Keyboard), Realtime Start/Stop
 * und die Schalter-Logik der LED-Buttons (Filterband, IFX On, Amp EG, MFX
 * Send). Reine Byte-/Zustandslogik ohne DOM, damit sie testbar ist.
 *
 * Gerätestand (gemessen, siehe partParams.ts / panelState.ts):
 *   filterType 0 = aus, 1–6 LPF, 7–11 HPF, 12–16 BPF — Stock nutzt 1/7/12.
 *   Part n hört auf MIDI-Kanal n (Regler-CCs so gemessen, e2KnobCc.ts).
 *   Patternwechsel — ✔ AM GERÄT GEMESSEN 2026-08-22 (E2 Sampler v2.2, Display
 *   abgelesen, Sequencer LÄUFT): das Gerät zählt 0-BASIERT, entgegen KORGs
 *   MIDI-Implementation (die „Pattern 001 = Program 1" behauptet):
 *     Program 100 → Pattern 101 · Program 1 → Pattern 2 · Program 2 → Pattern 3
 *     Bank MSB 0, dann LSB 1, dann Program 0 → Pattern 129
 *   Also: Pattern-Index i (0..249) → CC0=0, CC32=i div 128, Program=i mod 128,
 *   als drei getrennte Nachrichten in dieser Reihenfolge. Bank im MSB wird
 *   ignoriert. ⚠ CC0 ist PFLICHT: CC32=1 + Program 5 OHNE CC0 → Pattern 6
 *   (Bank ignoriert), MIT CC0=0 davor → Pattern 134 (gemessen 2026-08-22).
 *   Synthstudios e2sPatternOut.ts lässt CC0 bewusst weg und erreicht damit
 *   Bank 1 nicht. Gilt nur bei Global-RECEIVE-FILTER „Off"/„Short".
 *   ⚠ Bei GESTOPPTEM Sequencer ignoriert das Gerät den Program Change komplett
 *   (mehrfach gemessen: Display bleibt, Edit-Buffer bleibt) — Wechsel per MIDI
 *   funktioniert nur während der Wiedergabe (greift am Taktende).
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

/** Bank-LSB + Program (0-basiert, gemessen) → Pattern-Index 0..249, sonst null. */
export function patternIndexFromProgram(bankLsb: number, program: number): number | null {
  const idx = (bankLsb & 1) * 128 + (program & 0x7f);
  return idx <= 249 ? idx : null;
}

import type { FilterBand } from "./panelState";

export const MIDI_START = 0xfa;
export const MIDI_CONTINUE = 0xfb;
export const MIDI_STOP = 0xfc;
export const MIDI_CLOCK = 0xf8;

/** Abstand zweier Clock-Ticks (24 ppqn) in Millisekunden. */
export function clockIntervalMs(bpm: number): number {
  return 60000 / (Math.max(20, Math.min(300, bpm)) * 24);
}

/** Master-FX-CCs (KORG MIDI-Implementation, Klasse S) — auf dem Global-Kanal. */
export const MFX_CC = { x: 102, y: 103, on: 106 } as const;

export function buildMfxCc(globalChannel0: number, was: keyof typeof MFX_CC, value: number): Uint8Array {
  return Uint8Array.from([0xb0 | (globalChannel0 & 0x0f), MFX_CC[was], Math.max(0, Math.min(127, Math.round(value)))]);
}

/**
 * Panic — alles zum Schweigen bringen.
 *
 * ⚠ **All Sound Off und All Notes Off allein reichen nicht.** Sie beenden nur
 * Toene, die das Geraet wegen eingehender MIDI-Noten spielt. Laeuft der interne
 * Sequencer, triggert er munter weiter — genau deshalb sah der alte Panik-Knopf
 * wirkungslos aus. Darum steht **MIDI-Stop zuerst**.
 *
 * Bleibt auch das ohne Wirkung, steht am Geraet „Clock Mode" auf Internal; dann
 * ignoriert es Start/Stop von aussen und nur die Stop-Taste am Geraet hilft.
 *
 * @param opts.noten     Gemerkte klingende Noten, die einzeln abgeschaltet
 *                       werden — praeziser als die Sammelbefehle.
 * @param opts.alleNoten Alle 128 Noten auf allen 16 Kanaelen abfahren (2048
 *                       Nachrichten). Gruendlich, aber langsam — und eine Flut
 *                       kann den Eingangspuffer des Geraets ueberfahren.
 */
export function buildPanic(opts: { noten?: readonly { kanal: number; note: number }[]; alleNoten?: boolean } = {}): Uint8Array[] {
  const out: Uint8Array[] = [Uint8Array.from([MIDI_STOP])];
  for (let ch = 0; ch < 16; ch++) {
    out.push(Uint8Array.from([0xb0 | ch, 120, 0])); // All Sound Off
    out.push(Uint8Array.from([0xb0 | ch, 123, 0])); // All Notes Off
  }
  for (const n of opts.noten ?? []) {
    out.push(Uint8Array.from([0x80 | (n.kanal & 0x0f), n.note & 0x7f, 0]));
  }
  if (opts.alleNoten) {
    for (let ch = 0; ch < 16; ch++) {
      for (let note = 0; note < 128; note++) out.push(Uint8Array.from([0x80 | ch, note, 0]));
    }
  }
  return out;
}

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
  return [
    Uint8Array.from([0xb0 | ch, 0x00, 0x00]),
    Uint8Array.from([0xb0 | ch, 0x20, Math.floor(patternIdx0 / 128)]),
    Uint8Array.from([0xc0 | ch, patternIdx0 % 128]),
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

/**
 * e2KnobCc.ts — die CC-Nummern, die die electribe sampler beim Drehen ihrer
 * Panel-Regler SENDET. Vollstaendig am Geraet gemessen (2026-08-15, Hacktribe,
 * Sequencer gestoppt, Regler in angesagter Reihenfolge gedreht und der
 * CC-Strom im MIDI-Monitor mitgeschnitten — zwei Messfenster, Nachfassrunde
 * fuer Decay/Level/EG Int):
 *
 *     Cutoff        CC 74   (MIDI-Standard "Brightness")
 *     Resonance     CC 71   (Standard "Harmonic Intensity")
 *     EG Int        CC 83
 *     Pitch/Glide   CC 80   (um Mitte 64 — bipolar)
 *     Osc Edit      CC 81
 *     Mod Depth     CC 82
 *     Mod Speed     CC 86
 *     Attack        CC 73   (Standard "Attack Time")
 *     Decay/Release CC 72   (Standard "Release Time")
 *     Level         CC 7    (Standard "Channel Volume")
 *     Pan           CC 10   (Standard "Pan")
 *     IFX Edit      CC 87
 *
 * ✔ KANAL = PART-NUMMER (Nutzer-Auskunft 2026-08-15): die Messung lief mit
 * Part 1 aktiv, daher Kanal 1; die uebrigen Parts senden auf dem Kanal ihrer
 * Nummer. Passt zu den beobachteten Note-Events je Part-Kanal bei laufendem
 * Sequencer. Der Empfaenger ordnet den Wert also ueber den Kanal dem
 * richtigen Part zu — und beim SENDEN adressiert der CC-Kanal den Part.
 *
 * ⚠ Offen: welche CCs die grossen Auswahlregler (Sample / Mod-Typ /
 * IFX-Typ) senden.
 *
 * Die `key`s entsprechen den PART_PARAMS-Schluesseln (partParams.ts);
 * `volume`/`pan` sind die Festfelder des Parts. Bipolare Regler (Pitch,
 * EG Int) laufen auf dem Draht um Mitte 64 — abgeleitet aus der
 * Pitch-Messung (Ruhelage sendete 64).
 */

export interface KnobCc {
  /** PART_PARAMS-Key bzw. "volume"/"pan". */
  key: string;
  label: string;
}

export const KNOB_CCS: ReadonlyMap<number, KnobCc> = new Map<number, KnobCc>([
  [74, { key: "cutoff", label: "Cutoff" }],
  [71, { key: "resonance", label: "Resonance" }],
  [83, { key: "egInt", label: "EG Int" }],
  [80, { key: "oscPitch", label: "Pitch/Glide" }],
  [81, { key: "oscEdit", label: "Osc Edit" }],
  [82, { key: "modDepth", label: "Mod Depth" }],
  [86, { key: "modSpeed", label: "Mod Speed" }],
  [73, { key: "egAttack", label: "Attack" }],
  [72, { key: "egDecay", label: "Decay/Release" }],
  [7, { key: "volume", label: "Level" }],
  [10, { key: "pan", label: "Pan" }],
  [87, { key: "ifxEdit", label: "IFX Edit" }],
]);

export interface KnobCcEvent {
  /** 0-basierter MIDI-Kanal. */
  channel0: number;
  cc: number;
  /** Roher CC-Wert 0..127. */
  value: number;
  /** Zuordnung, falls die CC-Nummer zu einem bekannten Regler gehoert. */
  knob: KnobCc | null;
}

/**
 * Dekodiert eine eingehende MIDI-Nachricht als Regler-CC. Gibt null zurueck,
 * wenn es kein Control-Change ist. Unbekannte CC-Nummern kommen mit
 * `knob: null` — der Aufrufer entscheidet, ob er sie anzeigt.
 */
export function decodeKnobCc(bytes: ArrayLike<number>): KnobCcEvent | null {
  if (bytes.length < 3) return null;
  const status = bytes[0];
  if ((status & 0xf0) !== 0xb0) return null;
  const cc = bytes[1];
  // NRPN-Rahmen-CCs (0x62/0x63/0x06/0x26) sind Teil unserer eigenen Sendungen
  // bzw. der Hacktribe-Schicht — keine Reglerbewegungen.
  if (cc === 0x62 || cc === 0x63 || cc === 0x06 || cc === 0x26) return null;
  return {
    channel0: status & 0x0f,
    cc,
    value: bytes[2],
    knob: KNOB_CCS.get(cc) ?? null,
  };
}

/** Regler, die auf dem Draht um Mitte 64 laufen (Speicherwert −63..+63). */
export const BIPOLARE_KNOB_KEYS: ReadonlySet<string> = new Set(["egInt", "oscPitch"]);

const CC_BY_KEY = new Map([...KNOB_CCS.entries()].map(([cc, k]) => [k.key, cc]));

/** CC-Nummer zu einem Regler-Key — null, wenn der Key keinen gemessenen CC hat. */
export function ccForKey(key: string): number | null {
  return CC_BY_KEY.get(key) ?? null;
}

/** Draht-Wert (0..127) → Speicherwert (bipolar: −63..+63). */
export function ccValueToParam(key: string, value: number): number {
  return BIPOLARE_KNOB_KEYS.has(key) ? value - 64 : value;
}

/** Speicherwert → Draht-Wert 0..127 (geclamped). */
export function paramToCcValue(key: string, wert: number): number {
  const roh = BIPOLARE_KNOB_KEYS.has(key) ? wert + 64 : wert;
  return Math.max(0, Math.min(127, Math.round(roh)));
}

/** Baut die CC-Nachricht, die den Regler eines Parts stellt (Kanal = Part). */
export function buildKnobCc(part0: number, key: string, wert: number): Uint8Array | null {
  const cc = ccForKey(key);
  if (cc === null) return null;
  return new Uint8Array([0xb0 | (part0 & 0x0f), cc, paramToCcValue(key, wert)]);
}

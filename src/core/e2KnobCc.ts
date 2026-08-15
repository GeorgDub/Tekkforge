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
 * Alle Ereignisse kamen auf Kanal 1 (dem Global-/Suchkanal des Geraets).
 * ⚠ Offen: ob der Kanal dem am Geraet AKTIVEN Part folgt (die Messung lief
 * durchgehend mit Part 1) und welche CCs die grossen Auswahlregler
 * (Sample / Mod-Typ / IFX-Typ) senden. Bis dahin ordnet der Empfaenger den
 * Wert dem in der UI aktiven Part zu.
 *
 * Die `key`s entsprechen den PART_PARAMS-Schluesseln (partParams.ts);
 * `volume`/`pan` sind die Festfelder des Parts.
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

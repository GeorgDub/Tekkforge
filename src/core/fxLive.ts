/**
 * fxLive — Effekt-Parameter live per Controller verstellen, waehrend das Geraet
 * spielt. Ein Regler am Controller schickt eine NRPN-Folge an den gewaehlten
 * Part (oder den Master-Effekt); das Geraet aendert den Effekt sofort hoerbar.
 *
 * Vorbild ist die Controller-Schicht des `ht-cli`-Zweigs von
 * bangcorrupt/hacktribe-editor-legacy (**AGPL-3.0**, `ht_control.py` +
 * `midi_map.py`): 24 Regler auf die FX-Parameter 0..23, Tasten waehlen den
 * Part. Die Standardbelegung stammt aus `midi_map.py` und passt zu einem Akai
 * MIDImix mit dem dort beiliegenden Preset.
 *
 * ⚠ Nur mit Hacktribe. Laut Hacktribe-Wiki (MIDI.md) nimmt das Geraet **nur**
 * die Kategorien „FX Edit" und „FX Control Map" per NRPN entgegen — genau die
 * werden hier benutzt.
 */
import { buildSetFxParam, fxSlotForPart, buildGlobalParam, MFX_SLOT, type MidiTriple } from "./hacktribeNrpn";

/**
 * CC-Nummern der 24 Regler in der Reihenfolge der FX-Parameter 0..23.
 * Wortgleich aus `midi_map.py` (FX_PARAM_0_CC … FX_PARAM_23_CC); die Luecken
 * (19, 23, 27 …) sind echt — der MIDImix zaehlt seine Regler so.
 */
export const MIDIMIX_FX_CCS: readonly number[] = [
  16, 17, 18, 20, 21, 22, 24, 25, 26, 28, 29, 30, 46, 47, 48, 50, 51, 52, 54, 55, 56, 58, 59, 60,
];

/** Belegung als veraenderbare Liste: Index = FX-Parameter, Wert = CC-Nummer. */
export function standardControllerMap(): number[] {
  return [...MIDIMIX_FX_CCS];
}

/** Welcher FX-Parameter haengt an dieser CC-Nummer? null = keiner. */
export function paramFuerCc(map: readonly number[], cc: number): number | null {
  const i = map.indexOf(cc);
  return i >= 0 ? i : null;
}

export type FxLiveZiel = { art: "part"; part: number; slot: 0 | 1 } | { art: "mfx" };

/** FX-Slot des Ziels: je Part zwei Insert-Slots, dazu der Master-Slot. */
export function fxSlotFuerZiel(ziel: FxLiveZiel): number {
  return ziel.art === "mfx" ? MFX_SLOT : fxSlotForPart(ziel.part, ziel.slot);
}

/**
 * Controller-CC → NRPN-Folge. null, wenn dieser Regler nicht belegt ist —
 * dann darf die Nachricht weiterlaufen (z. B. an ein Pad mit MIDI-Learn).
 */
export function baueFxLiveNachricht(opts: {
  ziel: FxLiveZiel;
  map: readonly number[];
  cc: number;
  wert: number;
  kanal0: number;
}): MidiTriple[] | null {
  const param = paramFuerCc(opts.map, opts.cc);
  if (param === null) return null;
  return buildSetFxParam(opts.kanal0, fxSlotFuerZiel(opts.ziel), param, opts.wert);
}

/**
 * Byte-Index der versteckten Global-Einstellung „MIDI Thru".
 *
 * Quelle: bangcorrupt in Diskussion #189 des hacktribe-Repos — die Einstellung
 * gibt es nur ueber NRPN, im Menue des Geraets taucht sie nicht auf.
 * **Damit sie einen Neustart ueberlebt, muss danach im Global-Menue „Write"
 * gedrueckt werden.** Die ebenfalls erwaehnten Schalter fuer NRPN-Ausgabe und
 * Motion-CC sind bisher nirgends mit ihrem Index dokumentiert.
 */
export const GLOBAL_MIDI_THRU = 0x2c;

export function baueMidiThru(kanal0: number, an: boolean): MidiTriple[] {
  return buildGlobalParam(kanal0, GLOBAL_MIDI_THRU, an ? 1 : 0);
}

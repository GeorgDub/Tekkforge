/**
 * panelState.ts — reine Zustandslogik für das E2S-Panel (Hardware-Lookalike).
 *
 * Übersetzt ein EditorPattern in das, was am Gerät leuchtet: Mute-LEDs der
 * Pads, die Zustands-LEDs der Sektionen (Amp EG, MFX Send, IFX On,
 * Filterband) und die Step-Zustände je Takt. Kein DOM, kein MIDI — damit die
 * Abbildung testbar ist und die GUI nur noch rendert.
 */

import type { EditorPattern } from "./editorModel";

/** Filterband nach der am Gerät gemessenen Struktur (partParams.ts):
 *  0 = off, 1–6 = LPF-Familie, 7–11 = HPF, 12–16 = BPF. Hacktribe kann
 *  darüber hinaus erweitern — dann ist der Filter aktiv, aber keinem der
 *  drei Band-Buttons zuordenbar. */
export type FilterBand = "off" | "lpf" | "hpf" | "bpf" | "ext";

export function filterBand(filterType: number | undefined): FilterBand {
  if (filterType === undefined || filterType <= 0) return "off";
  if (filterType <= 6) return "lpf";
  if (filterType <= 11) return "hpf";
  if (filterType <= 16) return "bpf";
  return "ext";
}

export interface PartLeds {
  /** true = Part ist gemutet (Pad-LED aus). */
  mute: boolean;
  ampEg: boolean;
  mfxSend: boolean;
  ifxOn: boolean;
  band: FilterBand;
}

/** LED-Zustände eines Parts, wie die Sektions-Buttons am Gerät leuchten. */
export function partLeds(pattern: EditorPattern, partIdx: number): PartLeds {
  const part = pattern.parts[partIdx];
  const p = part?.params ?? {};
  return {
    mute: !!part?.muted,
    ampEg: p.ampEgOn === 1,
    mfxSend: p.mfxSend === 1,
    ifxOn: p.ifxOn === 1,
    band: filterBand(p.filterType),
  };
}

/**
 * Aktive Steps eines Parts im gegebenen Takt (0..3) als 16 Booleans.
 * Steps jenseits der Pattern-Steplänge sind aus — wie am Gerät, das bei
 * einem 16er-Pattern die Takte 2..4 leer zeigt.
 */
export function stepStates(pattern: EditorPattern, partIdx: number, takt: number): boolean[] {
  const part = pattern.parts[partIdx];
  const von = takt * 16;
  return Array.from({ length: 16 }, (_, s) => {
    const idx = von + s;
    if (idx >= pattern.stepLength) return false;
    return !!part?.steps[idx]?.on;
  });
}

export interface DisplayInfo {
  /** Patternname, wie er in der obersten Displayzeile steht. */
  name: string;
  bpm: number;
  /** 1-basierte Part-Nummer für die "Part:NN"-Zeile. */
  partNo: number;
  partLabel: string;
  /** Anzeige-Sample-Nummer des Parts oder null. */
  sampleNumber: number | null;
}

/** Inhalt des LCD-Bereichs für den aktiven Part. */
export function displayInfo(pattern: EditorPattern, partIdx: number): DisplayInfo {
  const part = pattern.parts[partIdx];
  return {
    name: pattern.name,
    bpm: pattern.bpm,
    partNo: partIdx + 1,
    partLabel: part?.label ?? `Part ${partIdx + 1}`,
    sampleNumber: part?.sampleNumber ?? null,
  };
}

/** Anzahl Takte, die die 1–4-Buttons anbieten (16er-Pattern = 1 Takt usw.). */
export function taktAnzahl(pattern: EditorPattern): number {
  return Math.max(1, Math.ceil(pattern.stepLength / 16));
}

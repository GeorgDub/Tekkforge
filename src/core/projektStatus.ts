/**
 * projektStatus — Lade-Marker („diese Bank steckt im Geraet"), Status-
 * Ableitung, Sperrgrund fuer „→ Geraet", SD-Zielpfad und die Umwandlung
 * E2PatternInput → EditorPattern fuer den Slot-Weg. Reine Funktionen.
 */
import type { Projekt } from "./bankPlan";
import type { E2PatternInput } from "./electribePatternBuilder";
import { buildE2PatternBody } from "./e2sExport";
import { editorPatternFromBody, type EditorPattern } from "./editorModel";

export const MARKER_KEY = "tekkforge.generator.geladen";

export interface GeladenMarker {
  name: string;
  bankZeit: string;
}
export interface MarkerSpeicher {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export function markerLesen(sp: MarkerSpeicher): GeladenMarker | null {
  try {
    const roh = sp.getItem(MARKER_KEY);
    if (!roh) return null;
    const m = JSON.parse(roh) as Partial<GeladenMarker>;
    return typeof m.name === "string" && typeof m.bankZeit === "string" ? { name: m.name, bankZeit: m.bankZeit } : null;
  } catch {
    return null;
  }
}

export function markerSchreiben(sp: MarkerSpeicher, p: Projekt): GeladenMarker {
  const m = { name: p.name, bankZeit: p.bankZeit };
  sp.setItem(MARKER_KEY, JSON.stringify(m));
  return m;
}

export function istGeladen(p: Projekt, m: GeladenMarker | null): boolean {
  return !!m && m.name === p.name && m.bankZeit === p.bankZeit;
}

export function statusMit(p: Projekt, m: GeladenMarker | null): Projekt["status"] {
  return istGeladen(p, m) ? "geladen" : p.status;
}

/** null = frei; sonst der Grund, warum „→ Geraet" gesperrt ist. */
export function geraetSperrgrund(p: Projekt | null, m: GeladenMarker | null, midiReady: boolean): string | null {
  if (!p) return "Erst Bank bauen";
  if (!istGeladen(p, m)) return `Bank "${p.name}" ist nicht als geladen markiert`;
  if (!midiReady) return "Kein Geraet verbunden — MIDI im Editor aktivieren";
  return null;
}

export function sdZielpfad(laufwerk: string, ordner = "2026"): string {
  return `${laufwerk.replace(/[\\/]+$/, "")}\\${ordner}`;
}

export function patternFuerGeraet(input: E2PatternInput): EditorPattern {
  return editorPatternFromBody(buildE2PatternBody(input));
}

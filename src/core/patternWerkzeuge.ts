/**
 * patternWerkzeuge — Handgriffe, die im Editor fehlten (Nutzerbefund 2026-09-04):
 *
 * - **Steps verdoppeln**: 16 → 32 oder 32 → 64, wobei die vorhandenen Steps
 *   in die neue Haelfte kopiert werden. Vorher aenderte „Laenge“ nur die
 *   Zahl, die zweite Haelfte blieb leer.
 * - **Part kopieren / einfuegen**: die Steps eines Parts (wahlweise samt
 *   Sample und Klangparametern) in einen anderen Part oder ein anderes
 *   Pattern — so wandern MIDI-Noten aus einem importierten Pattern in den
 *   Song.
 * - **Patterns anhaengen**: ein zweiter MIDI-Import landet HINTER den
 *   vorhandenen Patterns statt sie zu ersetzen; Ketten der neuen Patterns
 *   werden um den Versatz verschoben.
 *
 * Reine Funktionen auf dem Editor-Modell, ohne DOM.
 */
import { EDITOR_MAX_STEPS, type EditorPattern, type EditorPart, type EditorProject, type EditorStep } from "./editorModel";

const stepKopie = (s: EditorStep): EditorStep => ({ ...s, ...(s.notes ? { notes: [...s.notes] } : {}) });

/**
 * Verdoppelt die Laenge und kopiert die erste Haelfte in die zweite.
 * false, wenn das Pattern schon 64 Steps hat.
 */
export function verdoppleSteps(p: EditorPattern): boolean {
  if (p.stepLength >= EDITOR_MAX_STEPS) return false;
  const alt = p.stepLength;
  for (const part of p.parts) for (let s = 0; s < alt; s++) part.steps[alt + s] = stepKopie(part.steps[s]);
  p.stepLength = (alt * 2) as 16 | 32 | 64;
  return true;
}

export interface PartAblage {
  label: string;
  sampleNumber: number | null;
  volume: number;
  pan: number;
  steps: EditorStep[];
  params?: Record<string, number>;
  /** Steplaenge des Quell-Patterns — beim Einfuegen in ein laengeres Pattern wird wiederholt. */
  stepLength: number;
}

/** Ein Part als Zwischenablage (tiefe Kopie). */
export function kopierePart(part: EditorPart, stepLength: number): PartAblage {
  return {
    label: part.label,
    sampleNumber: part.sampleNumber,
    volume: part.volume,
    pan: part.pan,
    steps: part.steps.map(stepKopie),
    ...(part.params ? { params: { ...part.params } } : {}),
    stepLength,
  };
}

export interface EinfuegeOptionen {
  /** Sample-Nummer, Volume, Pan und Klangparameter mitnehmen (Vorgabe: nur die Steps). */
  mitKlang?: boolean;
  /** Steps hinter der Quell-Laenge bis zur Ziel-Laenge wiederholen (Vorgabe an). */
  wiederholen?: boolean;
}

/** Die Ablage in einen Part legen; die Steps der Quelle fuellen die Ziel-Laenge, wiederholt falls kuerzer. */
export function fuegePartEin(ziel: EditorPart, ablage: PartAblage, zielLaenge: number, opts: EinfuegeOptionen = {}): void {
  const quelle = Math.max(1, Math.min(EDITOR_MAX_STEPS, ablage.stepLength));
  const wiederholen = opts.wiederholen !== false;
  for (let s = 0; s < EDITOR_MAX_STEPS; s++) {
    if (s < quelle) ziel.steps[s] = stepKopie(ablage.steps[s]);
    else if (wiederholen && s < zielLaenge) ziel.steps[s] = stepKopie(ablage.steps[s % quelle]);
    else ziel.steps[s] = { on: false, velocity: ablage.steps[s]?.velocity ?? 100, note: 60, gate: 48 };
  }
  if (opts.mitKlang) {
    ziel.sampleNumber = ablage.sampleNumber;
    ziel.volume = ablage.volume;
    ziel.pan = ablage.pan;
    if (ablage.params) ziel.params = { ...ablage.params };
  }
}

/**
 * Patterns hinter die vorhandenen haengen. Ketten der neuen Patterns
 * (1-basierte Listenplaetze) werden um den Versatz verschoben; ein leeres
 * Vorgabe-Pattern („PATTERN 1“ ohne einen einzigen Step und ohne Sample)
 * am Anfang wird ersetzt statt stehen gelassen. Liefert den Index des
 * ersten neuen Patterns.
 */
export function haengePatternsAn(project: EditorProject, neue: readonly EditorPattern[]): number {
  const leer = project.patterns.length === 1 && istUnberuehrt(project.patterns[0]);
  if (leer) project.patterns.length = 0;
  const versatz = project.patterns.length;
  for (const p of neue) {
    const k = { ...p, parts: p.parts.map((part) => ({ ...part, steps: part.steps.map(stepKopie), ...(part.params ? { params: { ...part.params } } : {}) })) };
    if (k.chainTo) k.chainTo += versatz;
    project.patterns.push(k);
  }
  return versatz;
}

/** Ein Pattern ohne einen einzigen Step und ohne zugewiesenes Sample. */
export function istUnberuehrt(p: EditorPattern): boolean {
  return p.parts.every((part) => part.sampleNumber === null && part.steps.every((s) => !s.on));
}

/**
 * +12-dB-Flag fuer viele Samples auf einmal (Nutzerwunsch 2026-09-05: nicht
 * jedes einzeln). Liefert, wie viele sich geaendert haben.
 */
export function setzeGain12(samples: readonly { gain12db?: boolean }[], an: boolean): number {
  let n = 0;
  for (const s of samples) {
    if (an && !s.gain12db) {
      s.gain12db = true;
      n++;
    } else if (!an && s.gain12db) {
      delete s.gain12db;
      n++;
    }
  }
  return n;
}

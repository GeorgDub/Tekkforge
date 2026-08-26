/**
 * patternStimmen — was in einem Pattern wann und wie klingt.
 *
 * EINE Definition fuer zwei Verbraucher: das Vorhoeren im Fenster (Web Audio,
 * `gui/preview.ts`) und das Ausrechnen zu einer Datei (`patternRender.ts`).
 * Sie muessen gleich klingen, sonst waere die eine Vorschau eine Luege ueber
 * die andere — und genau deshalb steht die Umrechnung hier und nicht zweimal.
 *
 * ⚠ Das ist die Rechnung des VORHOERENS, nicht die des Geraets: Samples werden
 * angetriggert, Anschlag wird zu Pegel, Note zu Abspielrate, Gate zu Dauer.
 * Filter, Huellkurven, Insert- und Master-Effekte gibt es hier nicht. Alles,
 * was daraus gemessen wird, ist eine Aussage ueber das Arrangement — nicht
 * darueber, was am Ende aus dem Geraet kommt.
 */

import { EDITOR_DEFAULT_NOTE, EDITOR_GATE_MAX, type EditorPattern } from "./editorModel";
import { resolveStepNotes } from "./e2StepNote";

export interface Stimme {
  /** Step-Index im Pattern (0-basiert). */
  step: number;
  /** Part-Index — nur zur Nachverfolgung, fuer den Klang ohne Bedeutung. */
  part: number;
  /** Geraete-/Bank-Sample-Nummer. */
  sampleNumber: number;
  /** Pegel 0..1 (Anschlag × Part-Lautstaerke). */
  gain: number;
  /** Panorama -1 (links) .. +1 (rechts). */
  pan: number;
  /** Abspielrate; 1 = Originaltonhoehe. */
  rate: number;
  /** Dauer in Steps, oder null fuer "ausklingen lassen" (Gate 96 = Tie). */
  dauerSteps: number | null;
}

const klemme = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Alle klingenden Stimmen eines Patterns, nach Step sortiert.
 *
 * Ein Akkord-Step ergibt eine Stimme JE TON — das Geraet spielt auf einem
 * Poly-Part auch alle. Der Vorhoer-Spieler hat frueher nur den ersten Ton
 * genommen und Akkorde damit zu Einzeltoenen gemacht.
 */
export function stimmen(pattern: EditorPattern): Stimme[] {
  const raus: Stimme[] = [];
  for (let pi = 0; pi < pattern.parts.length; pi++) {
    const part = pattern.parts[pi];
    if (part.muted || part.sampleNumber === null) continue;
    const gainPart = klemme(part.volume / 127, 0, 1);
    const pan = klemme((part.pan - 64) / 63, -1, 1);
    for (let s = 0; s < pattern.stepLength; s++) {
      const st = part.steps[s];
      if (!st?.on) continue;
      const gain = klemme(st.velocity / 127, 0, 1) * gainPart;
      // Gate zaehlt relativ: 96 (Tie) = ausklingen, sonst Anteil von vier Steps.
      const dauerSteps = st.gate >= EDITOR_GATE_MAX ? null : (st.gate / EDITOR_GATE_MAX) * 4;
      for (const note of resolveStepNotes(st.notes, st.note)) {
        raus.push({
          step: s,
          part: pi,
          sampleNumber: part.sampleNumber,
          gain,
          pan,
          rate: Math.pow(2, (note - EDITOR_DEFAULT_NOTE) / 12),
          dauerSteps,
        });
      }
    }
  }
  raus.sort((a, b) => a.step - b.step || a.part - b.part);
  return raus;
}

/** Sekunden je Step bei diesem Tempo (16tel). */
export function stepDauer(bpm: number): number {
  return 60 / Math.max(1, bpm) / 4;
}

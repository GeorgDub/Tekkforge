/**
 * bibliothekAblage — ein Bibliothekseintrag als Text und zurueck.
 *
 * Ein Eintrag ist im Kern ein winziges Projekt: EIN Pattern und die Samples,
 * die es braucht. Deshalb wird hier nicht neu serialisiert, sondern genau der
 * Projekt-Codec benutzt, der beim Speichern eines ganzen Projekts laeuft. Das
 * ist kein Sparsamkeitstrick, sondern der Punkt: der Roh-Body eines Patterns
 * traegt Filter, Amp, IFX und Motion — Felder, die der Editor gar nicht alle
 * kennt. Ein eigenes, „schlankes" Format haette sie beim Ablegen still
 * verloren, und man merkt das erst am Geraet.
 *
 * Die Samples liegen als 16-Bit-WAV in Base64. Das ist genau die Aufloesung,
 * mit der das Geraet spielt — mehr abzulegen kostet Platz ohne Gewinn.
 */

import {
  serializeProject,
  deserializeProject,
  createPattern,
  type EditorProject,
} from "./editorModel";
import type { BibliothekEintrag } from "./bibliothek";

const MARKE = "tekkforge-bib";
const VERSION = 1;

interface AbgelegterEintrag {
  app: string;
  version: number;
  id: string;
  name: string;
  wann: number;
  /**
   * Wie viele Samples dranhaengen — im Kopf, nicht nur im Projekt.
   *
   * Die Ablage listet bewusst nur Kopfdaten (sonst laege die ganze Bibliothek
   * im Speicher), und sie soll dafuer nicht in den inneren Aufbau des
   * Projekts greifen muessen.
   */
  sampleAnzahl: number;
  /** Das Ein-Pattern-Projekt, so wie serializeProject es schreibt. */
  projekt: unknown;
}

export function eintragZuJson(e: BibliothekEintrag): string {
  const projekt: EditorProject = { version: 1, patterns: [e.pattern], samples: [...e.samples] };
  const doc: AbgelegterEintrag = {
    app: MARKE,
    version: VERSION,
    id: e.id,
    name: e.name,
    wann: e.wann,
    sampleAnzahl: e.samples.length,
    projekt: JSON.parse(serializeProject(projekt)),
  };
  return JSON.stringify(doc);
}

export function eintragAusJson(text: string): BibliothekEintrag {
  let doc: AbgelegterEintrag;
  try {
    doc = JSON.parse(text) as AbgelegterEintrag;
  } catch {
    throw new Error("Bibliothek: Eintrag ist keine gueltige JSON-Datei");
  }
  if (!doc || doc.app !== MARKE || doc.version !== VERSION)
    throw new Error("Bibliothek: Datei stammt nicht aus der TekkForge-Bibliothek");
  if (!doc.projekt || typeof doc.projekt !== "object")
    throw new Error("Bibliothek: Eintrag enthaelt kein Pattern");
  let projekt: EditorProject;
  try {
    projekt = deserializeProject(JSON.stringify(doc.projekt));
  } catch (err) {
    throw new Error(`Bibliothek: Eintrag laesst sich nicht lesen — ${(err as Error).message}`);
  }
  const name = typeof doc.name === "string" && doc.name ? doc.name : projekt.patterns[0]?.name || "PATTERN";
  return {
    id: String(doc.id || ""),
    name,
    pattern: projekt.patterns[0] ?? createPattern(name),
    samples: projekt.samples,
    wann: Number.isFinite(doc.wann) ? doc.wann : 0,
  };
}

/**
 * zielBank — eine Bank aus mehreren Quellen zusammenstellen.
 *
 * Das Arbeitsmodell, das TekkForge bisher fehlte: nicht EIN Pool, sondern eine
 * Zielbank, in die man aus beliebig vielen Quellbaenken einsammelt. Genau das
 * braucht man fuer „nimm die Samples dieser drei Patterns und mach EINE .all
 * daraus" — und dafuer muessen die Verweise in den Patterns mitwandern.
 *
 * Der gefaehrliche Teil ist nicht das Sammeln, sondern das Nachfuehren. Zwei
 * Baenke haben beide ein Sample 501; landen beide in der Zielbank, kann nur
 * eines die 501 behalten. Bliebe im Pattern die alte Nummer stehen, spielte
 * das Geraet dort ein FREMDES Sample — still und falsch, und man merkt es erst
 * beim Hoeren. Deshalb wandert jede Nummer ueber eine Abbildung, und ein
 * Verweis ohne Ziel wird geleert und gemeldet statt geraten.
 */

import { ramBytesFuer } from "./sampleRam";
import { EDITOR_SAMPLE_BASE, EDITOR_SAMPLE_MAX, clonePattern, type EditorPattern, type PoolSample } from "./editorModel";

/** Sample-RAM des Geraets in Bytes (16 Bit Mono bei 44,1 kHz, rund 24 MB). */
export const RAM_BUDGET_BYTES = 24 * 1024 * 1024;

export interface ZielEintrag {
  /** Nummer in der Zielbank (501+). */
  nummer: number;
  name: string;
  sampleRate: number;
  pcm: Float32Array;
  gain12db?: boolean;
  kategorie?: string;
  /** Woher es kam — fuer die Anzeige und zum Nachvollziehen. */
  quelle: string;
  quellNummer: number;
}

export interface ZielBank {
  eintraege: ZielEintrag[];
}

export interface HinzuErgebnis {
  aufgenommen: number;
  /** Alte Nummer → neue Nummer, fuer das Nachfuehren der Patterns. */
  abbildung: Map<number, number>;
  hinweise: string[];
}

export function leereZielBank(): ZielBank {
  return { eintraege: [] };
}

/** Belegter Geraete-Speicher in Bytes. */
export function ramBytes(bank: ZielBank): number {
  let b = 0;
  for (const e of bank.eintraege) b += ramBytesFuer(e);
  return b;
}

/** Naechste freie Nummer ab 501. */
function naechsteNummer(bank: ZielBank): number | null {
  const belegt = new Set(bank.eintraege.map((e) => e.nummer));
  for (let n = EDITOR_SAMPLE_BASE; n <= EDITOR_SAMPLE_MAX; n++) if (!belegt.has(n)) return n;
  return null;
}

/**
 * Samples aus einer Quelle aufnehmen.
 *
 * Gleiche Quellnummern aus verschiedenen Baenken stossen sich nicht: jedes
 * Sample bekommt die naechste freie Nummer, und die Abbildung merkt sich, wohin
 * es gewandert ist. Die Abbildung gilt NUR fuer diesen Aufruf — wer Patterns
 * aus zwei Baenken uebernimmt, braucht zwei Abbildungen.
 */
export function fuegeHinzu(
  bank: ZielBank,
  samples: readonly PoolSample[],
  opts: { quelle: string },
): HinzuErgebnis {
  const abbildung = new Map<number, number>();
  const hinweise: string[] = [];
  let aufgenommen = 0;
  for (const s of samples) {
    const nr = naechsteNummer(bank);
    if (nr === null) {
      hinweise.push(`Kein freier Platz mehr (501–${EDITOR_SAMPLE_MAX}) — ${s.name} blieb draußen.`);
      break;
    }
    bank.eintraege.push({
      nummer: nr,
      name: s.name,
      sampleRate: s.sampleRate,
      pcm: s.pcm,
      ...(s.gain12db ? { gain12db: true } : {}),
      ...(s.kategorie ? { kategorie: s.kategorie } : {}),
      quelle: opts.quelle,
      quellNummer: s.number,
    });
    abbildung.set(s.number, nr);
    aufgenommen++;
  }
  const belegt = ramBytes(bank);
  if (belegt > RAM_BUDGET_BYTES) {
    hinweise.push(
      `Die Bank passt nicht mehr ins Sample-RAM: ${(belegt / 1048576).toFixed(1)} MB von ${(RAM_BUDGET_BYTES / 1048576).toFixed(0)} MB.`,
    );
  }
  return { aufgenommen, abbildung, hinweise };
}

/** Einträge herausnehmen. Die übrigen Nummern bleiben, wo sie sind. */
export function entferne(bank: ZielBank, nummern: readonly number[]): number {
  const weg = new Set(nummern);
  const vorher = bank.eintraege.length;
  bank.eintraege = bank.eintraege.filter((e) => !weg.has(e.nummer));
  return vorher - bank.eintraege.length;
}

export interface UebernahmeBericht {
  /** Kopien der Patterns mit nachgefuehrten Verweisen — die Originale bleiben. */
  patterns: EditorPattern[];
  /** Wie viele Parts auf ein Sample zeigten, das nicht mitgekommen ist. */
  verwaist: number;
  hinweise: string[];
}

/**
 * Patterns in die Zielbank uebernehmen: Verweise umschreiben.
 *
 * Ein Part, dessen Sample nicht in der Abbildung steht, wird GELEERT und
 * stummgeschaltet — nicht mit der alten Nummer stehengelassen. Die alte Nummer
 * zeigt in der Zielbank auf ein anderes Sample, und ein Pattern, das
 * unbemerkt den falschen Klang spielt, ist schlimmer als eines, das schweigt.
 */
export function uebernehmeMuster(
  bank: ZielBank,
  patterns: readonly EditorPattern[],
  abbildung: ReadonlyMap<number, number>,
): UebernahmeBericht {
  const hinweise: string[] = [];
  const fehlend = new Set<number>();
  let verwaist = 0;
  const raus = patterns.map((p) => {
    const kopie = clonePattern(p);
    for (const part of kopie.parts) {
      if (part.sampleNumber === null) continue;
      const neu = abbildung.get(part.sampleNumber);
      if (neu === undefined) {
        fehlend.add(part.sampleNumber);
        part.sampleNumber = null;
        part.muted = true;
        verwaist++;
        continue;
      }
      part.sampleNumber = neu;
    }
    return kopie;
  });
  if (fehlend.size) {
    hinweise.push(
      `${verwaist} Part(s) zeigten auf Samples, die nicht in der Bank sind (${[...fehlend].sort((a, b) => a - b).join(", ")}) — sie wurden geleert und stummgeschaltet.`,
    );
  }
  void bank;
  return { patterns: raus, verwaist, hinweise };
}

/** Zielbank als Pool-Samples, wie der Bank-Bauer sie erwartet. */
export function alsPool(bank: ZielBank): PoolSample[] {
  return bank.eintraege.map((e) => ({
    number: e.nummer,
    name: e.name,
    sampleRate: e.sampleRate,
    pcm: e.pcm,
    ...(e.gain12db ? { gain12db: true } : {}),
    ...(e.kategorie ? { kategorie: e.kategorie } : {}),
  }));
}

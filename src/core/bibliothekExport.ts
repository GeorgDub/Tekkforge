/**
 * bibliothekExport — aus markierten Bibliothekseintraegen werden Dateien.
 *
 * Es gibt genau ZWEI Wege, mehrere Patterns aufs Geraet zu bringen, und der
 * Unterschied liegt nicht in der Bequemlichkeit, sondern in den Verweisen:
 *
 * - **separat**: jedes Pattern behaelt seine eigenen Sample-Nummern, und jede
 *   Bank kommt als eigene `.all` mit. Am Geraet laedt man die Bank, die zum
 *   Pattern gehoert. Zwei Patterns duerfen beide ein 501 haben — sie sind ja
 *   nie gleichzeitig geladen.
 * - **gemeinsam**: alle Samples wandern in EINE Bank, die Nummern werden neu
 *   vergeben und die Verweise in den Patterns nachgezogen (`fuehreZusammen`).
 *   Eine Bank, ein Import, alle Patterns spielbar.
 *
 * Die Regel, die hier fest verdrahtet ist: **wer eine Pattern-Datei schreibt,
 * schreibt die Bank(en) dazu, in denselben Ordner, im selben Klick.** Sonst
 * kann man eine Pattern-Datei mit neu vergebenen Nummern neben eine Bank mit
 * alten Nummern legen — das Geraet laedt beides klaglos und spielt fremde
 * Samples. Das faellt nicht auf, es klingt nur falsch.
 */

import {
  buildPatternFile,
  buildSampleBank,
  patternToE2Input,
  type EditorPattern,
  type PoolSample,
} from "./editorModel";
import { buildE2AllPatFile } from "./e2sExport";
import { fuehreZusammen, type BibliothekEintrag } from "./bibliothek";
import { RAM_BUDGET_BYTES } from "./zielBank";

export interface ExportDatei {
  name: string;
  bytes: Uint8Array;
}

export interface ExportErgebnis {
  dateien: ExportDatei[];
  hinweise: string[];
  /** true, wenn eine der Baenke groesser ist als das Sample-RAM des Geraets. */
  ueberBudget: boolean;
}

const BASIS = "bibliothek";

/** Dateiname aus einem Pattern-Namen: nur Zeichen, die jede SD-Karte vertraegt. */
export function dateiName(name: string): string {
  const s = name
    .trim()
    .replace(/[^A-Za-z0-9 _-]/g, "")
    .replace(/\s+/g, "_")
    .slice(0, 24);
  return s || "PATTERN";
}

/** Namen eindeutig halten — zwei Eintraege duerfen gleich heissen, Dateien nicht. */
function eindeutig(vergeben: Set<string>, wunsch: string, endung: string): string {
  let n = `${wunsch}${endung}`;
  let i = 2;
  while (vergeben.has(n.toLowerCase())) n = `${wunsch}_${i++}${endung}`;
  vergeben.add(n.toLowerCase());
  return n;
}

/** Belegter Geraetespeicher einer Sample-Liste in Bytes (16 Bit bei 44,1 kHz). */
function ramBytesVon(samples: readonly PoolSample[]): number {
  let b = 0;
  for (const s of samples) b += Math.round((s.pcm.length / s.sampleRate) * 44100) * 2;
  return b;
}

function budgetHinweis(samples: readonly PoolSample[], was: string): string | null {
  const belegt = ramBytesVon(samples);
  if (belegt <= RAM_BUDGET_BYTES) return null;
  return `${was} passt nicht ins Sample-RAM: ${(belegt / 1048576).toFixed(1)} MB von ${(RAM_BUDGET_BYTES / 1048576).toFixed(0)} MB — das Geraet laedt sie nicht.`;
}

/**
 * Bank bauen — oder sagen, warum nicht.
 *
 * Der Bank-Bauer wirft bei einem Sample ueber 10 MB. Als Ausnahme in der
 * Oberflaeche waere das ein Absturz mitten im Schreiben; als Hinweis ist es
 * eine Aussage, mit der der Nutzer etwas anfangen kann.
 */
function bankOderHinweis(samples: readonly PoolSample[], was: string): { bank: Uint8Array | null; fehler: string | null } {
  try {
    return { bank: buildSampleBank(samples), fehler: null };
  } catch (err) {
    return { bank: null, fehler: `${was} liess sich nicht bauen: ${(err as Error).message}` };
  }
}

function allpatVon(patterns: readonly EditorPattern[]): Uint8Array {
  return new Uint8Array(buildE2AllPatFile(patterns.slice(0, 250).map(patternToE2Input)));
}

/**
 * Je Eintrag eine `.e2spat` und die Bank dazu.
 *
 * Fuer den Weg ueber den Pattern-Ordner der Karte: einzelne Patterns laedt das
 * Geraet direkt, ohne eine ganze Bank zu ueberschreiben.
 */
export function dateienEinzeln(eintraege: readonly BibliothekEintrag[]): ExportErgebnis {
  const dateien: ExportDatei[] = [];
  const hinweise: string[] = [];
  const vergeben = new Set<string>();
  let ueberBudget = false;
  for (const e of eintraege) {
    const basis = dateiName(e.name);
    const h = budgetHinweis(e.samples, `Die Bank von „${e.name}"`);
    if (h) {
      // Ueber Budget: gar nichts von diesem Eintrag schreiben. Eine
      // Pattern-Datei ohne ladbare Bank ist schlimmer als keine Datei.
      hinweise.push(h);
      ueberBudget = true;
      continue;
    }
    const { bank, fehler } = bankOderHinweis(e.samples, `Die Bank von „${e.name}"`);
    if (fehler) {
      hinweise.push(fehler);
      ueberBudget = true;
      continue;
    }
    dateien.push({ name: eindeutig(vergeben, basis, ".e2spat"), bytes: buildPatternFile(e.pattern) });
    if (bank) dateien.push({ name: eindeutig(vergeben, basis, ".all"), bytes: bank });
    else hinweise.push(`„${e.name}" hat keine Samples — nur die Pattern-Datei geschrieben.`);
  }
  return { dateien, hinweise, ueberBudget };
}

/**
 * EINE `.e2sallpat` mit den unveraenderten Nummern, dazu je Eintrag seine Bank.
 *
 * Am Geraet gehoert zu Pattern n die n-te Bank; sie werden einzeln geladen.
 */
export function dateienSeparat(eintraege: readonly BibliothekEintrag[]): ExportErgebnis {
  if (!eintraege.length) return { dateien: [], hinweise: [], ueberBudget: false };
  const dateien: ExportDatei[] = [];
  const hinweise: string[] = [];
  const vergeben = new Set<string>();
  let ueberBudget = false;
  const baenke: ExportDatei[] = [];
  eintraege.forEach((e, i) => {
    const basis = `${String(i + 1).padStart(2, "0")}_${dateiName(e.name)}`;
    const h = budgetHinweis(e.samples, `Die Bank von „${e.name}"`);
    if (h) {
      hinweise.push(h);
      ueberBudget = true;
      return;
    }
    const { bank, fehler } = bankOderHinweis(e.samples, `Die Bank von „${e.name}"`);
    if (fehler) {
      hinweise.push(fehler);
      ueberBudget = true;
      return;
    }
    if (bank) baenke.push({ name: `${basis}.all`, bytes: bank });
    else hinweise.push(`„${e.name}" hat keine Samples — dafuer gibt es keine Bank.`);
  });
  // Keine halben Sets: geht eine Bank nicht, bleibt auch die Pattern-Datei aus.
  if (ueberBudget) return { dateien: [], hinweise, ueberBudget };
  dateien.push({ name: eindeutig(vergeben, BASIS, ".e2sallpat"), bytes: allpatVon(eintraege.map((e) => e.pattern)) });
  for (const b of baenke) dateien.push({ name: eindeutig(vergeben, b.name.replace(/\.all$/, ""), ".all"), bytes: b.bytes });
  hinweise.push(
    `Pattern-Platz n gehoert zur Bank mit der Nummer n — am Geraet immer die passende Bank laden, sonst spielt das Pattern fremde Samples.`,
  );
  return { dateien, hinweise, ueberBudget };
}

/** EINE `.e2sallpat` und EINE gemeinsame `.all`, Verweise nachgezogen. */
export function dateienGemeinsam(
  eintraege: readonly BibliothekEintrag[],
  opts: { verketten?: boolean } = {},
): ExportErgebnis {
  if (!eintraege.length) return { dateien: [], hinweise: [], ueberBudget: false };
  const r = fuehreZusammen(eintraege, opts);
  const hinweise = [...r.hinweise];
  const h = budgetHinweis(r.samples, "Die gemeinsame Bank");
  if (h) {
    if (!hinweise.some((x) => /RAM|passt nicht/i.test(x))) hinweise.push(h);
    return { dateien: [], hinweise, ueberBudget: true };
  }
  const { bank, fehler } = bankOderHinweis(r.samples, "Die gemeinsame Bank");
  if (fehler) return { dateien: [], hinweise: [...hinweise, fehler], ueberBudget: true };
  const dateien: ExportDatei[] = [];
  const vergeben = new Set<string>();
  dateien.push({ name: eindeutig(vergeben, BASIS, ".e2sallpat"), bytes: allpatVon(r.patterns) });
  if (bank) dateien.push({ name: eindeutig(vergeben, BASIS, ".all"), bytes: bank });
  else hinweise.push("Kein einziges Sample dabei — nur die Pattern-Datei geschrieben.");
  return { dateien, hinweise, ueberBudget: false };
}

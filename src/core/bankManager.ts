/**
 * bankManager — Ordnung in die Sample-Bank bringen, ohne die Patterns zu
 * zerschiessen.
 *
 * Ein Part zeigt ueber die **Nummer** auf sein Sample. Wer Nummern verschiebt,
 * ohne die Parts mitzuziehen, hat danach Patterns, die auf fremde oder leere
 * Plaetze zeigen — und merkt es erst am Geraet. Darum aendert hier keine
 * Funktion eine Nummer, ohne im selben Zug alle Verweise nachzufuehren.
 *
 * Alle Funktionen arbeiten **in place** auf dem Projekt, damit der Editor
 * danach nur neu zeichnen muss.
 */
import { EDITOR_SAMPLE_BASE, EDITOR_SAMPLE_MAX, type EditorProject } from "./editorModel";

export interface UmnummernBericht {
  verschoben: number;
  aenderungen: { von: number; nach: number }[];
}

/** Alle Part-Verweise von `von` auf `nach` umhaengen. */
function verweiseUmhaengen(projekt: EditorProject, von: number, nach: number): void {
  for (const p of projekt.patterns) {
    for (const part of p.parts) if (part.sampleNumber === von) part.sampleNumber = nach;
  }
}

/**
 * Nummern in einem Rutsch neu vergeben. `reihenfolge` bestimmt, welches Sample
 * welche Nummer bekommt (Index 0 → erste freie Nummer).
 *
 * Der Umweg ueber Zwischennummern ist noetig: wuerde man direkt zuweisen,
 * kollidierte eine neue Nummer womoeglich mit einer noch nicht verschobenen —
 * und der Verweis eines Parts liefe auf das falsche Sample.
 */
function nummeriereNeu(projekt: EditorProject, reihenfolge: readonly number[]): UmnummernBericht {
  const aenderungen: { von: number; nach: number }[] = [];
  reihenfolge.forEach((alt, i) => {
    const neu = EDITOR_SAMPLE_BASE + i;
    if (alt !== neu) aenderungen.push({ von: alt, nach: neu });
  });
  if (!aenderungen.length) return { verschoben: 0, aenderungen };

  // Schritt 1: alles auf freie Zwischennummern heben (oberes Ende der Skala)
  const zwischen = new Map<number, number>();
  let frei = EDITOR_SAMPLE_MAX;
  for (const { von } of aenderungen) {
    while (projekt.samples.some((s) => s.number === frei) || [...zwischen.values()].includes(frei)) frei--;
    zwischen.set(von, frei);
    const s = projekt.samples.find((x) => x.number === von)!;
    s.number = frei;
    verweiseUmhaengen(projekt, von, frei);
    frei--;
  }
  // Schritt 2: von dort auf die Zielnummern
  for (const { von, nach } of aenderungen) {
    const tmp = zwischen.get(von)!;
    const s = projekt.samples.find((x) => x.number === tmp)!;
    s.number = nach;
    verweiseUmhaengen(projekt, tmp, nach);
  }
  return { verschoben: aenderungen.length, aenderungen };
}

/** Luecken schliessen: die vorhandene Reihenfolge bleibt, die Nummern ruecken auf. */
export function packeNummernNeu(projekt: EditorProject): UmnummernBericht {
  const sortiert = [...projekt.samples].sort((a, b) => a.number - b.number).map((s) => s.number);
  return nummeriereNeu(projekt, sortiert);
}

export type SortierSchluessel = "name" | "laenge" | "nummer";

/** Bank nach einem Merkmal ordnen und lueckenlos neu durchnummerieren. */
export function sortiereBank(projekt: EditorProject, nach: SortierSchluessel): UmnummernBericht {
  const sortiert = [...projekt.samples].sort((a, b) => {
    if (nach === "name") return a.name.localeCompare(b.name, "de");
    if (nach === "laenge") return a.pcm.length - b.pcm.length;
    return a.number - b.number;
  });
  return nummeriereNeu(projekt, sortiert.map((s) => s.number));
}

/**
 * Zwei Samples die Plaetze tauschen lassen. Gibt false zurueck, wenn eine der
 * Nummern nicht belegt ist — stilles Nichtstun waere hier die schlechtere
 * Antwort, weil der Nutzer eine Umsortierung erwartet.
 */
export function tauscheNummern(projekt: EditorProject, a: number, b: number): boolean {
  if (a === b) return true;
  const sa = projekt.samples.find((s) => s.number === a);
  const sb = projekt.samples.find((s) => s.number === b);
  if (!sa || !sb) return false;
  // freie Zwischennummer, damit sich die beiden nicht gegenseitig ueberschreiben
  let frei = EDITOR_SAMPLE_MAX;
  while (projekt.samples.some((s) => s.number === frei)) frei--;
  sa.number = frei;
  verweiseUmhaengen(projekt, a, frei);
  sb.number = a;
  verweiseUmhaengen(projekt, b, a);
  sa.number = b;
  verweiseUmhaengen(projekt, frei, b);
  return true;
}

/** Freie Nummern zwischen der kleinsten und groessten belegten. */
export function luecken(projekt: EditorProject): number[] {
  const belegt = new Set(projekt.samples.map((s) => s.number));
  const zahlen = [...belegt].sort((a, b) => a - b);
  if (zahlen.length < 2) return [];
  const out: number[] = [];
  for (let n = zahlen[0]; n < zahlen[zahlen.length - 1]; n++) if (!belegt.has(n)) out.push(n);
  return out;
}

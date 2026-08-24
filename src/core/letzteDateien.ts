/**
 * letzteDateien.ts — „Letzte Dateien" fuers Start-Dashboard.
 *
 * Reine Listenlogik + Persistenz-Codierung; wo die Liste liegt
 * (localStorage), entscheidet die GUI.
 */

export type DateiArt = "all" | "esx" | "projekt" | "e2spat" | "lied";

export interface LetzteDatei {
  name: string;
  art: DateiArt;
  /** Zeitstempel (Date.now()) der letzten Verwendung. */
  wann: number;
  /** Voller Pfad, falls die Dateisystem-Bridge ihn kennt. */
  pfad?: string;
}

export const LETZTE_MAX = 8;

/** Neuen Eintrag vorn einreihen; gleicher Name ersetzt, Deckel LETZTE_MAX. */
export function dateiMerken(liste: LetzteDatei[], eintrag: LetzteDatei): LetzteDatei[] {
  return [eintrag, ...liste.filter((e) => e.name !== eintrag.name)].slice(0, LETZTE_MAX);
}

export function dateienLesen(raw: string | null): LetzteDatei[] {
  if (!raw) return [];
  try {
    const o = JSON.parse(raw) as unknown;
    if (!Array.isArray(o)) return [];
    if (!o.every((e) => e && typeof e === "object" && typeof (e as LetzteDatei).name === "string" && typeof (e as LetzteDatei).wann === "number")) return [];
    return (o as LetzteDatei[]).slice(0, LETZTE_MAX);
  } catch {
    return [];
  }
}

export function dateienSchreiben(liste: LetzteDatei[]): string {
  return JSON.stringify(liste.slice(0, LETZTE_MAX));
}

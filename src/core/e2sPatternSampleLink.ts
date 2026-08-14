/**
 * e2sPatternSampleLink.ts — Pure-Helper: verknüpft E2-Pattern-Parts mit ihren
 * Samples aus einer SEPARATEN .all-Sample-Bank, und hält die am Gerät
 * gemessenen Nummerierungs-Regeln an EINER Stelle.
 *
 * Anders als ESX (Samples + Patterns in EINER Datei) liegen beim E2 Sampler die
 * Patterns (.e2sallpat) und die Samples (.all = e2sSample.all) in zwei Dateien.
 *
 * ## Die drei Zahlen eines Samples
 *
 *   - ANZEIGE     — was das Gerät im Display zeigt (User-Samples 501+).
 *   - OSC_0index  — das Nummernfeld im korg/esli-Chunk (`E2sSlot.sampleNumber`).
 *   - Tabellenindex — die Position in der 1020er-Offset-Tabelle der .all.
 *
 * ## Gemessene Regeln (SLOTNUM2.all, entkoppelte Probe, 2026-08-15)
 *
 *     Anzeige          == OSC_0index + 1     (der Tabellenindex ist für die
 *                                             Anzeige IRRELEVANT)
 *     Pattern-Referenz == OSC_0index         (== Anzeige − 1; SLOTNUM-Set:
 *                                             Ref 500 spielte das Sample mit
 *                                             OSC 500)
 *
 * Geräte-Konvention fürs Bauen (vom Gerät geschriebene e2sSample.all):
 * Tabellenindex == OSC_0index. TekkForge baut so und prüft beim Einlesen
 * dagegen (`E2sSlotNumbering`).
 *
 * Dieser Helper ist rein (kein Audio/DOM). Das WAV-Encoding + Blob-URL bleibt
 * im Aufrufer (Seiteneffekt).
 */

import type { E2sBank, E2sSlot } from "./e2sBankReader";
import { E2S_DISPLAY_OSC_SHIFT } from "./constants";

/**
 * Anzeigenummer → `esli.OSC_0index` (Nummernfeld). **Am Gerät gemessen**
 * (SLOTNUM2.all, 2026-08-15, siehe `E2S_DISPLAY_OSC_SHIFT`): das Gerät zeigt
 * jedes Sample unter OSC + 1, unabhängig vom Tabellenindex.
 */
export function displayNumberToOsc(displayNumber: number): number {
  return displayNumber - E2S_DISPLAY_OSC_SHIFT;
}

/** Umkehrung von `displayNumberToOsc`: Nummernfeld → Anzeigenummer. */
export function oscToDisplayNumber(osc: number): number {
  return osc + E2S_DISPLAY_OSC_SHIFT;
}

/**
 * Anzeigenummer → Tabellenindex beim BAUEN einer Bank. Für die Anzeige selbst
 * ist der Index irrelevant (siehe oben); das Gerät schreibt seine eigenen
 * Bänke aber mit Tabellenindex == OSC_0index, und TekkForge folgt dieser
 * Konvention.
 */
export function displayNumberToSlotIndex(displayNumber: number): number {
  return displayNumberToOsc(displayNumber);
}

/** Umkehrung von `displayNumberToSlotIndex` (gilt für konventionskonforme
 *  Bänke mit Index == OSC). */
export function slotIndexToDisplayNumber(slotIndex: number): number {
  return oscToDisplayNumber(slotIndex);
}

/**
 * Pattern-Referenz → Anzeigenummer. **Am Gerät gemessen**: die Referenz im
 * Pattern (part +0x08) liegt um eins unter der Anzeige und trifft das Sample
 * über dessen OSC_0index (Ref == OSC == Anzeige − 1). Beleg: das SLOTNUM-Set —
 * der Part mit Referenz 500 spielte den Ton mit OSC 500, der am Gerät als 501
 * erscheint; die alte HARDTEKK-Bank ohne OSC 500 ließ denselben Part leer.
 *
 * 0 heißt „kein Sample" und bleibt 0 — sonst bände ein leerer Part an Slot 1.
 */
export function e2PatternRefToBankNumber(ref: number): number {
  return ref > 0 ? ref + 1 : ref;
}

/**
 * Umkehrung von `e2PatternRefToBankNumber` — Anzeigenummer → Pattern-Referenz.
 *
 * Soll ein Part das Sample spielen, das am Gerät als Nummer `n` erscheint,
 * muss im Pattern `n − 1` stehen (== dessen OSC_0index). Ohne diese Umrechnung
 * trifft jeder exportierte Part das jeweils nächsthöhere Sample.
 *
 * 0 bleibt 0 (kein Sample). Nummer 1 kann keine gültige Referenz erzeugen und
 * wird ebenfalls zu 0 — besser „kein Sample" als der Wraparound auf -1.
 */
export function bankNumberToE2PatternRef(bankNumber: number): number {
  return bankNumber > 1 ? bankNumber - 1 : 0;
}

/**
 * Baut eine Lookup-Map `Anzeigenummer → E2sSlot` (Anzeige = OSC_0index + 1,
 * am Gerät gemessen). Erster-Treffer-gewinnt (stabile Slot-Reihenfolge).
 * OSC 0 = "keins" und wird übersprungen, damit unassigned-Parts nicht
 * fälschlich binden.
 */
export function buildE2sSampleMap(bank: E2sBank): Map<number, E2sSlot> {
  const map = new Map<number, E2sSlot>();
  for (const slot of bank.slots) {
    if (!slot) continue;
    if (slot.sampleNumber <= 0) continue;
    const display = oscToDisplayNumber(slot.sampleNumber);
    if (!map.has(display)) map.set(display, slot);
  }
  return map;
}

/**
 * Wie viele der gegebenen Part-Sample-Nummern (ANZEIGE-Nummern, z.B. via
 * `e2PatternRefToBankNumber`) ein Sample in der Map finden würden.
 * Nützlich für User-Feedback ("12/16 Parts mit Sample verlinkt").
 */
export function countLinkableE2Parts(
  sampleIds: ReadonlyArray<number>,
  map: Map<number, E2sSlot>,
): number {
  return sampleIds.reduce((n, id) => (map.has(id) ? n + 1 : n), 0);
}

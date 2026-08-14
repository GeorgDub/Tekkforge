/**
 * e2sPatternSampleLink.ts — Pure-Helper: verknüpft E2-Pattern-Parts mit ihren
 * Samples aus einer SEPARATEN .all-Sample-Bank.
 *
 * Anders als ESX (Samples + Patterns in EINER Datei) liegen beim E2 Sampler die
 * Patterns (.e2sallpat) und die Samples (.all = e2sSample.all) in zwei Dateien.
 * Verknüpft werden sie über die GERÄTE-SAMPLE-NUMMER:
 *   - Pattern-Part trägt seine Sample-Ref bei esli/part +0x08 →
 *     `ParsedPart.sampleId`.
 *   - .all-Sample trägt seine Nummer als OSC_0index (esli +0x08) →
 *     `E2sSlot.sampleNumber`.
 *
 * ⚠ Die beiden Zahlen sind NICHT dieselbe — es liegt genau eins dazwischen,
 * siehe `e2PatternRefToBankNumber`. Match per VALUE (Nummer), nicht per
 * Offset-Tabellen-Position — robust auch bei Lücken/Nicht-501-Basis.
 *
 * Dieser Helper ist rein (kein Audio/DOM). Das WAV-Encoding + Blob-URL bleibt
 * im Aufrufer (Seiteneffekt).
 */

import type { E2sBank, E2sSlot } from "./e2sBankReader";
import { E2S_DISPLAY_SLOT_SHIFT } from "./constants";

/**
 * Anzeigenummer → Tabellenindex in der `.all`. **Am Gerät gemessen**
 * (SLOTNUM.all, 2026-08-14, siehe `E2S_DISPLAY_SLOT_SHIFT`): das Gerät zählt
 * nach der Tabellenposition, Anzeige = Index + 2. Ein Sample, das als Nummer
 * `n` erscheinen (und von Pattern-Refs auf `n` getroffen werden) soll, gehört
 * deshalb auf Tabellenplatz `n − 2`; `esli.OSC_0index` trägt `n` selbst.
 *
 * Konsistenz mit der Pattern-Seite: Ref = n − 1 = Tabellenindex + 1.
 *
 * ⚠ Offen bleibt luknkicks.all (gleiche Struktur, laut Nutzer trotzdem ab 501
 * sichtbar) — solange das unerklärt ist, gilt die gemessene Regel, nicht die
 * Analogie. Details: scripts/make-hardtekk-bank.mjs.
 */
export function displayNumberToSlotIndex(displayNumber: number): number {
  return displayNumber - E2S_DISPLAY_SLOT_SHIFT;
}

/** Umkehrung von `displayNumberToSlotIndex`: Tabellenindex → Anzeigenummer. */
export function slotIndexToDisplayNumber(slotIndex: number): number {
  return slotIndex + E2S_DISPLAY_SLOT_SHIFT;
}

/**
 * Pattern-Referenz → Bank-Slot-Nummer. **Am Gerät gemessen** (echtes E2S,
 * Omnitribe-Prüfprotokoll 2026-08-10):
 *
 *     Bank-Slot (OSC_0index) == Pattern-Referenz + 1
 *
 * Beleg (dreifach, unabhängig): die Parts 1–3 referenzieren 584/586/588, das
 * Gerät spielt bei allen dreien `Jumpkick`; in der Bank liegt `Jumpkick` auf
 * 585/587/589, während 584/586/588 `KICK9`/`L3oN_HaT`/`ZaHnI_ki` sind. Deckt
 * sich mit der Anzeige-Regel `Anzeige = Pattern-Ref + 1` (2026-08-09) und
 * schließt die dort offene Frage: **`esli` gleicht der Anzeige**, nicht der
 * Pattern-Referenz.
 *
 * Der Fehler war schwer zu sehen, weil ein Versatz von eins **immer ein
 * plausibles Sample** liefert — nur eben das falsche. Nichts bleibt leer,
 * nichts schlägt fehl.
 *
 * 0 heißt „kein Sample" und bleibt 0 — sonst bände ein leerer Part an Slot 1.
 */
export function e2PatternRefToBankNumber(ref: number): number {
  return ref > 0 ? ref + 1 : ref;
}

/**
 * Umkehrung von `e2PatternRefToBankNumber` — Bank-Slot-Nummer → Pattern-Referenz.
 *
 * Beim SCHREIBEN eines Patterns gilt dieselbe Messung rückwärts: soll ein Part
 * das Sample spielen, das am Gerät als Nummer `n` erscheint (= dessen
 * OSC_0index/Tabellen-Index), muss im Pattern `n − 1` stehen. Ohne diese
 * Umrechnung trifft jeder exportierte Part das jeweils nächsthöhere Sample.
 *
 * 0 bleibt 0 (kein Sample). Nummer 1 kann keine gültige Referenz erzeugen und
 * wird ebenfalls zu 0 — besser „kein Sample" als der Wraparound auf -1.
 */
export function bankNumberToE2PatternRef(bankNumber: number): number {
  return bankNumber > 1 ? bankNumber - 1 : 0;
}

/**
 * Baut eine Lookup-Map `Geräte-Sample-Nummer (OSC_0index) → E2sSlot`.
 * Erster-Treffer-gewinnt (stabile Slot-Reihenfolge). Nummer 0 = "keins" und wird
 * übersprungen, damit unassigned-Parts nicht fälschlich an Slot 0 binden.
 */
export function buildE2sSampleMap(bank: E2sBank): Map<number, E2sSlot> {
  const map = new Map<number, E2sSlot>();
  for (const slot of bank.slots) {
    if (!slot) continue;
    if (slot.sampleNumber <= 0) continue;
    if (!map.has(slot.sampleNumber)) map.set(slot.sampleNumber, slot);
  }
  return map;
}

/**
 * Wie viele der gegebenen Part-Sample-IDs ein Sample in der Map finden würden.
 * Nützlich für User-Feedback ("12/16 Parts mit Sample verlinkt").
 */
export function countLinkableE2Parts(
  sampleIds: ReadonlyArray<number>,
  map: Map<number, E2sSlot>,
): number {
  return sampleIds.reduce((n, id) => (map.has(id) ? n + 1 : n), 0);
}

/**
 * e2sPatternSampleLink.ts — Pure-Helper: verknüpft E2-Pattern-Parts mit ihren
 * Samples aus einer SEPARATEN .all-Sample-Bank.
 *
 * Anders als ESX (Samples + Patterns in EINER Datei) liegen beim E2 Sampler die
 * Patterns (.e2sallpat) und die Samples (.all = e2sSample.all) in zwei Dateien.
 * Verknüpft werden sie über die GERÄTE-SAMPLE-NUMMER:
 *   - Pattern-Part trägt seine Sample-Ref bei esli/part +0x08 (z.B. 501+) →
 *     `ParsedPart.sampleId` bzw. `SynthstudioDrumPartImport.sampleId`.
 *   - .all-Sample trägt dieselbe Nummer als OSC_0index (esli +0x08) →
 *     `E2sSlot.sampleNumber`.
 * Match per VALUE (Nummer), nicht per Offset-Tabellen-Position — robust auch bei
 * Lücken/Nicht-501-Basis (Position bzw. "id − 501" bräche bei realen Bänken).
 *
 * Dieser Helper ist rein (kein Audio/DOM). Das WAV-Encoding + Blob-URL bleibt
 * im Aufrufer (Seiteneffekt), analog zum ESX-Pfad (KorgBankModal).
 */

import type { E2sBank, E2sSlot } from "./e2sBankReader";

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

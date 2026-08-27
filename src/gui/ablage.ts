/**
 * ablage — Dateien wirklich auf die Platte legen, nicht nur anbieten.
 *
 * Der uebliche Weg im Browser ist ein `<a download>` auf ein Blob. Das ist
 * bequem und hat einen Haken, den man erst merkt, wenn man ihn braucht: die
 * Anwendung erfaehrt NICHT, ob eine Datei entstanden ist. Sie kann den Dialog
 * nicht sehen, kein Abbrechen bemerken und keinen Pfad nennen. Fuer einen
 * Export ist das hinnehmbar — fuer eine SICHERUNG nicht. „Gesichert" zu
 * melden, ohne es zu wissen, ist die schlechteste Art von Fehler: sie faellt
 * erst auf, wenn man die Sicherung braucht.
 *
 * Deshalb schreibt die Desktop-Fassung ueber die Dateibruecke und gibt den
 * Pfad zurueck. Nur im reinen Browser bleibt der Download — dort gibt es
 * nichts Besseres, und dann sagt das Ergebnis das auch.
 */

import { download } from "./shared";
import { tekkFs } from "./tekkFs";

export interface AblageErgebnis {
  /** Wohin geschrieben wurde — null, wenn es ueber den Download ging. */
  pfad: string | null;
  /** true, wenn nur der Browser-Download blieb (Pfad unbekannt). */
  ueberDownload: boolean;
}

const kodiere = (daten: Uint8Array | string): Uint8Array =>
  typeof daten === "string" ? new TextEncoder().encode(daten) : daten;

/**
 * Datei ablegen. `unterordner` haengt unter dem Standardordner der App
 * (`<Downloads>\TekkForge`), damit Zusammengehoeriges beieinander liegt.
 */
export async function legeAb(
  name: string,
  daten: Uint8Array | string,
  unterordner = "",
  mime = "application/octet-stream",
): Promise<AblageErgebnis> {
  const fs = tekkFs();
  const wurzel = fs?.standardOrdner ? await fs.standardOrdner() : "";
  if (!fs || !wurzel) {
    download(daten, name, mime);
    return { pfad: null, ueberDownload: true };
  }
  const ordner = unterordner ? `${wurzel}\\${unterordner}` : wurzel;
  const res = await fs.schreibe(ordner, [{ name, bytes: kodiere(daten) }]);
  return { pfad: res.geschrieben[0] ?? ordner, ueberDownload: false };
}

/** Den Ordner einer abgelegten Datei im Explorer zeigen (soweit moeglich). */
export async function zeigeAblage(pfad: string): Promise<void> {
  const fs = tekkFs();
  if (!fs?.ordnerOeffnen) return;
  const i = Math.max(pfad.lastIndexOf("\\"), pfad.lastIndexOf("/"));
  await fs.ordnerOeffnen(i > 0 ? pfad.slice(0, i) : pfad);
}

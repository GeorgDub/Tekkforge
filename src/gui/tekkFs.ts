/**
 * tekkFs — typisierter Zugriff auf die Electron-Dateibruecke (preload.cjs).
 * Im reinen Browser gibt es sie nicht → undefined; Aufrufer blenden dann
 * Platten-/SD-Funktionen aus und bleiben beim Download.
 */
export interface TekkFs {
  available: boolean;
  /** Absoluter Pfad einer gewaehlten Datei ("" wenn unbekannt). */
  pfadVon(file: File): string;
  /** Dateien in einen (absoluten) Ordner schreiben; Ordner wird angelegt. */
  schreibe(ordner: string, dateien: { name: string; bytes: Uint8Array }[]): Promise<{ ordner: string; geschrieben: string[] }>;
  /**
   * Wechselmedien, z. B. [{ pfad: "H:", label: "SD", korg: true }].
   * KORG-Karten stehen vorn; leere Kartenschaechte sind schon aussortiert.
   */
  wechselmedien(): Promise<{ pfad: string; label: string; korg?: boolean }[]>;
  /** examples/e2s/tekk4.all als Byte-Array, sonst null. */
  tekkDrums(): Promise<number[] | null>;
  /** Auto-Backups eines Ordners (neueste zuerst); fehlt bei aelteren Bridges. */
  backups?(ordner: string): Promise<{ name: string; original: string; wann: number; bytes: number }[]>;
  /** Backup zuruecklegen (aktueller Stand wird vorher gesichert). */
  backupZurueck?(ordner: string, name: string): Promise<{ original: string }>;
  /** Ordner im Explorer oeffnen. */
  ordnerOeffnen?(ordner: string): Promise<string>;
  /**
   * Ausweichordner, wenn keine Karte steckt (<Downloads>\TekkForge).
   * Fehlt bei aelteren Bruecken — dann bleibt nur der Browser-Download.
   */
  standardOrdner?(): Promise<string>;
}

export function tekkFs(): TekkFs | undefined {
  const w = globalThis as unknown as { tekkFs?: TekkFs };
  return w.tekkFs?.available ? w.tekkFs : undefined;
}

/** Verzeichnisanteil eines absoluten Pfads (Windows oder POSIX). */
export function ordnerVon(pfad: string): string {
  const i = Math.max(pfad.lastIndexOf("\\"), pfad.lastIndexOf("/"));
  return i > 0 ? pfad.slice(0, i) : "";
}

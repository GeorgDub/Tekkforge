/**
 * tekkBib — typisierter Zugriff auf die Bibliotheks-Ablage (preload.cjs).
 *
 * Die Eintraege liegen als je eine JSON-Datei in `userData/bibliothek`. Im
 * reinen Browser gibt es die Bruecke nicht → undefined; die Oberflaeche sagt
 * dann, dass die Bibliothek nur in der Desktop-App existiert, statt still
 * nichts zu tun.
 */

/** Kopfdaten eines Eintrags — ohne die Samples, die auf der Platte bleiben. */
export interface BibKopf {
  id: string;
  name: string;
  wann: number;
  /** Anzahl der abgelegten Samples. */
  samples: number;
  /** Groesse der Ablagedatei in Bytes. */
  bytes: number;
}

export interface TekkBib {
  available: boolean;
  liste(): Promise<BibKopf[]>;
  speichern(id: string, text: string): Promise<{ pfad: string; bytes: number }>;
  lesen(id: string): Promise<string | null>;
  loeschen(id: string): Promise<boolean>;
  ordner(): Promise<string>;
}

export function tekkBib(): TekkBib | undefined {
  const w = globalThis as unknown as { tekkBib?: TekkBib };
  return w.tekkBib?.available ? w.tekkBib : undefined;
}

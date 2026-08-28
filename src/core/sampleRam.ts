/**
 * sampleRam — was ein Sample im Geraet wirklich belegt.
 *
 * Die Electribe legt Samples als 16-Bit-Bilder ab: zwei Bytes je Bild, mit der
 * Rate, mit der sie gespeichert wurden. Der Speicherbedarf haengt also an der
 * BILDZAHL, nicht an der Spieldauer.
 *
 * Vorher stand an acht Stellen dieselbe Rechnung `(laenge / rate) * 44100 * 2`
 * — die Dauer auf 44,1 kHz hochgerechnet. Fuer Samples mit voller Rate kommt
 * dasselbe heraus, fuer alle anderen zu viel. Konkret hat das die sparsamen
 * Vocals entwertet: 22 050 Hz halbiert den Speicher (am Geraet bestaetigt am
 * 2026-08-27 — die gespeicherte Rate wird beachtet), aber jede Rechnung im
 * Programm zaehlte sie voll. In einem Set aus drei Liedern blieben deshalb
 * 7 MB ungenutzt, waehrend die Vocals eines ganzen Liedes hinten runterfielen.
 */

/** Sample-RAM des Geraets in Bytes (rund 24 MB). */
export const RAM_BUDGET_BYTES = 24 * 1024 * 1024;

/** Abspielrate des Geraets — Bezugsgroesse fuer Dauer-Rechnungen. */
export const GERAET_RATE = 44100;

export interface RamSample {
  pcm: { length: number };
  sampleRate: number;
}

/** Belegter Geraetespeicher eines Samples in Bytes: zwei je Bild. */
export function ramBytesFuer(sample: RamSample): number {
  return sample.pcm.length * 2;
}

/** Summe ueber mehrere Samples. */
export function ramBytesSumme(samples: readonly RamSample[]): number {
  let b = 0;
  for (const s of samples) b += ramBytesFuer(s);
  return b;
}

/**
 * Wie teuer eine Sekunde bei dieser Rate ist, gemessen an voller Rate.
 *
 * 22 050 Hz ergibt 0,5 — eine Sekunde kostet dort den halben Platz. Damit
 * koennen Budgets in Sekunden rechnen und trotzdem die Rate beruecksichtigen.
 */
export function ratenFaktor(sampleRate: number): number {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) return 1;
  return sampleRate / GERAET_RATE;
}

/**
 * poolFilter.ts — Filter-, Such- und Speicherlogik der Sample-Bibliothek
 * (Editor-Pool und Start-Dashboard). Rein und DOM-frei.
 */

export type PoolFilter = "alle" | "factory" | "user";

/** Erste User-Sample-Nummer am Geraet (1–500 = Factory). */
export const POOL_USER_BASIS = 501;

/** Sample-RAM des Electribe 2 Samplers (~24 MB, 16-Bit-Mono bei 44,1 kHz). */
export const POOL_RAM_LIMIT_MB = 24;

export interface PoolFilterbar {
  number: number;
  name: string;
  kategorie?: string;
}

export function filterePool<S extends PoolFilterbar>(samples: readonly S[], filter: PoolFilter, suche: string): S[] {
  const s = suche.trim().toLowerCase();
  return samples.filter((x) => {
    if (filter === "factory" && x.number >= POOL_USER_BASIS) return false;
    if (filter === "user" && x.number < POOL_USER_BASIS) return false;
    if (!s) return true;
    return x.name.toLowerCase().includes(s) || (x.kategorie ?? "").toLowerCase().includes(s);
  });
}

/** Geraete-RAM-Belegung in MB: Sekunden × 44100 × 2 Bytes (16-Bit-Mono). */
export function poolRamMb(samples: readonly { pcm: { length: number }; sampleRate: number }[]): number {
  let bytes = 0;
  for (const s of samples) bytes += (s.pcm.length / s.sampleRate) * 44100 * 2;
  return bytes / (1024 * 1024);
}

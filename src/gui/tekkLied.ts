/**
 * tekkLied — typisierter Zugriff auf die Lied-Bruecke (preload.cjs):
 * Python/Demucs-Probe und Stems ueber scripts/stems.py. Im Browser undefined.
 */
export interface TekkLied {
  available: boolean;
  /** `gpu` sagt, ob Torch eine Grafikkarte sieht — der groesste Zeitfaktor. */
  pythonStatus(): Promise<{ python: string | null; demucs: boolean; version: string; gpu?: boolean; meldung: string }>;
  /**
   * Fenster als WAV-Bytes rein, Stems als WAV-Bytes raus (vox null, wenn leiser
   * als −36 dB; drums null, wenn praktisch still). `nurVox: true` liefert fuer
   * das Fenster nur die Vocals (Vocal-Vollabdeckung), melo/drums sind dann null.
   */
  stems(anfrage: {
    fenster: { id: string; bytes: Uint8Array | number[]; nurVox?: boolean }[];
    /** „schnell" spart rund ein Fuenftel der Zeit, „genau" mittelt zusaetzlich. */
    qualitaet?: "schnell" | "genau";
    /**
     * Welche Teile herausfallen sollen. Ohne Angabe melo/vox/drums wie bisher.
     * Steht "bass" drin, faellt der Bass als EIGENER Teil heraus und wird aus
     * der Melodie herausgenommen — sonst haette man ihn zweimal im Set.
     */
    teile?: StemTeil[];
  }): Promise<{
    fenster: StemErgebnis[];
  }>;
  onFortschritt(cb: (text: string) => void): () => void;
}

/** Die vier Teile, die Demucs trennt. */
export type StemTeil = "melo" | "vox" | "drums" | "bass";

export interface StemErgebnis {
  id: string;
  melo: Uint8Array | number[] | null;
  vox: Uint8Array | number[] | null;
  drums?: Uint8Array | number[] | null;
  bass?: Uint8Array | number[] | null;
  voxDb: number;
}

export function tekkLied(): TekkLied | undefined {
  const w = globalThis as unknown as { tekkLied?: TekkLied };
  return w.tekkLied?.available ? w.tekkLied : undefined;
}

/**
 * tekkLied — typisierter Zugriff auf die Lied-Bruecke (preload.cjs):
 * Python/Demucs-Probe und Stems ueber scripts/stems.py. Im Browser undefined.
 */
export interface TekkLied {
  available: boolean;
  pythonStatus(): Promise<{ python: string | null; demucs: boolean; version: string; meldung: string }>;
  /**
   * Fenster als WAV-Bytes rein, Stems als WAV-Bytes raus (vox null, wenn leiser
   * als −36 dB; drums null, wenn praktisch still). `nurVox: true` liefert fuer
   * das Fenster nur die Vocals (Vocal-Vollabdeckung), melo/drums sind dann null.
   */
  stems(anfrage: { fenster: { id: string; bytes: Uint8Array | number[]; nurVox?: boolean }[] }): Promise<{
    fenster: { id: string; melo: Uint8Array | number[] | null; vox: Uint8Array | number[] | null; drums?: Uint8Array | number[] | null; voxDb: number }[];
  }>;
  onFortschritt(cb: (text: string) => void): () => void;
}

export function tekkLied(): TekkLied | undefined {
  const w = globalThis as unknown as { tekkLied?: TekkLied };
  return w.tekkLied?.available ? w.tekkLied : undefined;
}

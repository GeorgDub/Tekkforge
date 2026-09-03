/**
 * tekkAudio — typisierter Zugriff auf die Audio-Bruecke (preload.cjs):
 * beliebige Audio-/Video-Datei → WAV ueber ffmpeg (imageio-ffmpeg in der
 * Python-Umgebung). Der Rueckfallweg, wenn Chromium ein Format nicht
 * dekodiert (WMA, APE, WavPack, AC3, DTS, AMR, CAF, Video-Container …).
 * Im Browser undefined.
 */
export interface TekkAudio {
  available: boolean;
  /** Probe: ffmpeg erreichbar? */
  probe(): Promise<{ ok: boolean; meldung: string; pfad?: string }>;
  /** Datei-Bytes → 16-Bit-WAV (Kanaele und Rate bleiben), wirft mit deutscher Meldung. */
  dekodieren(name: string, bytes: Uint8Array): Promise<{ name: string; bytes: Uint8Array }>;
}

export function tekkAudio(): TekkAudio | undefined {
  const w = globalThis as unknown as { tekkAudio?: TekkAudio };
  return w.tekkAudio?.available ? w.tekkAudio : undefined;
}

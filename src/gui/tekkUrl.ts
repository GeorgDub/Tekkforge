/**
 * tekkUrl — typisierter Zugriff auf die URL-Bruecke (preload.cjs):
 * YouTube/SoundCloud → WAV ueber yt-dlp + ffmpeg. Im Browser undefined.
 */
export interface TekkUrl {
  available: boolean;
  /** Probe: yt-dlp (python -m yt_dlp) + ffmpeg (imageio-ffmpeg) vorhanden? */
  probe(): Promise<{ ok: boolean; version?: string; meldung: string }>;
  /** Laedt eine YouTube-/SoundCloud-URL als 44,1-kHz-WAV; wirft mit deutscher Meldung. */
  laden(url: string): Promise<{ name: string; bytes: Uint8Array }>;
  onFortschritt(cb: (text: string) => void): () => void;
}

export function tekkUrl(): TekkUrl | undefined {
  const w = globalThis as unknown as { tekkUrl?: TekkUrl };
  return w.tekkUrl?.available ? w.tekkUrl : undefined;
}

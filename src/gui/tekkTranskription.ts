/**
 * tekkTranskription — typisierter Zugriff auf die KI-Transkription
 * (preload.cjs → electron/main.cjs → scripts/audio-zu-midi.py, basic-pitch
 * ueber ONNX in der py-cuda-Umgebung). Im Browser undefined.
 */
export interface TranskriptionOptionen {
  /** Anschlagschwelle 0…1 (Standard 0,5) — hoeher = weniger, sicherere Noten. */
  onset?: number;
  /** Rahmenschwelle 0…1 (Standard 0,3). */
  frame?: number;
  /** Mindestlaenge einer Note in ms (Standard 58). */
  minMs?: number;
  minHz?: number;
  maxHz?: number;
  /** Glaettung fuer einstimmige Melodien. */
  melodia?: boolean;
}

export interface TranskriptionErgebnis {
  /** Standard-MIDI-Datei (eine Spur, 120 BPM als Zeitbasis). */
  midi: Uint8Array;
  noten: number;
  tiefste: number;
  hoechste: number;
  dauer: number;
  sekunden: number;
}

export interface TekkTranskription {
  available: boolean;
  /** { ok, meldung } — basic-pitch in einer Python-Umgebung gefunden? */
  probe(): Promise<{ ok: boolean; meldung: string }>;
  /** WAV-Bytes (mono 44,1 k reicht) → MIDI; wirft mit deutscher Meldung. */
  laufen(bytes: Uint8Array, optionen?: TranskriptionOptionen): Promise<TranskriptionErgebnis>;
}

export function tekkTranskription(): TekkTranskription | undefined {
  const w = globalThis as unknown as { tekkTranskription?: TekkTranskription };
  return w.tekkTranskription?.available ? w.tekkTranskription : undefined;
}

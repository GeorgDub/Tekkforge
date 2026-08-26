/**
 * tekkAutosave — typisierter Zugriff auf die Notfall-Ablage (preload.cjs).
 * Im reinen Browser gibt es sie nicht → undefined; der Editor laeuft dann ohne
 * Notfall-Sicherung weiter, statt bei jeder Aenderung ins Leere zu greifen.
 */
import type { AutosaveAblage, AutosaveStand } from "../core/autosicherung";

interface TekkAutosaveBridge {
  available: boolean;
  schreiben(text: string): Promise<unknown>;
  lesen(): Promise<AutosaveStand | null>;
  loeschen(): Promise<unknown>;
}

export function autosaveAblage(): AutosaveAblage | undefined {
  const w = globalThis as unknown as { tekkAutosave?: TekkAutosaveBridge };
  const b = w.tekkAutosave;
  if (!b?.available) return undefined;
  return {
    schreiben: (text) => b.schreiben(text),
    lesen: () => b.lesen(),
    loeschen: () => b.loeschen(),
  };
}

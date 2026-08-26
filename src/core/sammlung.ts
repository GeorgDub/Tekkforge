/**
 * sammlung — mehrere Effekt-Presets und Groove-Vorlagen in einer Datei.
 *
 * Einzelne Presets lassen sich schon weitergeben, aber niemand verschickt
 * dreissig Dateien. Eine Sammlung buendelt sie mit Titel und Urheber, so dass
 * daraus etwas wird, das man veroeffentlichen kann.
 *
 * Wie bei der Geraetesicherung JSON mit Base64: ansehbar, versionierbar, und
 * bei Bedarf von Hand zu reparieren.
 */
import { FX_PRESET_SIZE } from "./e2FxPreset";
import { GROOVE_SIZE } from "./e2Groove";
import { bytesToBase64, base64ToBytes } from "./wavCodec";

export const SAMMLUNG_VERSION = 1;
/** Namen so lang, wie das Geraetemenue sie zeigt. */
const NAME_MAX = 15;

export type SammlungsArt = "ifx" | "mfx" | "groove";

export interface SammlungsEintrag {
  art: SammlungsArt;
  name: string;
  bytes: Uint8Array;
}

export interface Sammlung {
  version: number;
  titel: string;
  autor: string;
  wann: string;
  eintraege: SammlungsEintrag[];
}

/** Erwartete Blockgroesse je Art — die Pruefung faengt vertauschte Arten ab. */
export function groesseFuer(art: SammlungsArt): number {
  return art === "groove" ? GROOVE_SIZE : FX_PRESET_SIZE;
}

export function baueSammlung(
  eintraege: readonly SammlungsEintrag[],
  meta: { titel?: string; autor?: string; wann?: string },
): string {
  return JSON.stringify(
    {
      version: SAMMLUNG_VERSION,
      titel: meta.titel ?? "Sammlung",
      autor: meta.autor ?? "",
      wann: meta.wann ?? new Date().toISOString(),
      eintraege: eintraege.map((e) => ({
        art: e.art,
        name: e.name.slice(0, NAME_MAX),
        daten: bytesToBase64(e.bytes),
      })),
    },
    null,
    1,
  );
}

/** Sammlung einlesen; wirft mit klarer Begruendung statt halb zu laden. */
export function leseSammlung(text: string): Sammlung {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    throw new Error("Das ist keine lesbare Sammlung (kein JSON).");
  }
  const x = (typeof roh === "object" && roh ? roh : {}) as Record<string, unknown>;
  if (x.version !== SAMMLUNG_VERSION) {
    throw new Error(`Unbekannte Version ${String(x.version)} — erwartet ${SAMMLUNG_VERSION}.`);
  }
  if (!Array.isArray(x.eintraege) || x.eintraege.length === 0) throw new Error("Die Sammlung ist leer.");
  const eintraege: SammlungsEintrag[] = x.eintraege.map((e, i) => {
    const o = (typeof e === "object" && e ? e : {}) as Record<string, unknown>;
    const art = o.art;
    if (art !== "ifx" && art !== "mfx" && art !== "groove") throw new Error(`Eintrag ${i + 1}: unbekannte Art "${String(art)}".`);
    if (typeof o.daten !== "string") throw new Error(`Eintrag ${i + 1} hat keine Daten.`);
    const bytes = base64ToBytes(o.daten);
    const soll = groesseFuer(art);
    if (bytes.length !== soll) {
      throw new Error(`Eintrag ${i + 1} ("${String(o.name)}"): ${bytes.length} Bytes, für ${art} sind ${soll} nötig.`);
    }
    return { art, name: String(o.name ?? `Eintrag ${i + 1}`).slice(0, NAME_MAX), bytes };
  });
  return {
    version: SAMMLUNG_VERSION,
    titel: String(x.titel ?? "Sammlung"),
    autor: String(x.autor ?? ""),
    wann: String(x.wann ?? ""),
    eintraege,
  };
}

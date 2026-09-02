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

/**
 * Hoechster Ziel-Platz je Art — GERAETE-Zaehlung, ab 1 (das Menue am Geraet
 * zaehlt ab 1, TekkForge intern ab 0; siehe examples/fx-presets/README.md).
 * Entspricht den Schreibgrenzen: IFX 0..95, MFX 0..31, Groove 0..95.
 */
export const PLATZ_MAX: Record<SammlungsArt, number> = { ifx: 96, mfx: 32, groove: 96 };

export interface SammlungsEintrag {
  art: SammlungsArt;
  name: string;
  bytes: Uint8Array;
  /** Ziel-Platz am Geraet, 1-basiert wie das Geraetemenue; ohne = nicht zugewiesen. */
  platz?: number;
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
        ...(e.platz !== undefined ? { platz: e.platz } : {}),
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
    let platz: number | undefined;
    if (o.platz !== undefined) {
      const p = o.platz;
      if (typeof p !== "number" || !Number.isInteger(p) || p < 1 || p > PLATZ_MAX[art]) {
        throw new Error(`Eintrag ${i + 1} ("${String(o.name)}"): Platz ${String(p)} gibt es nicht — für ${art} zählt das Gerät 1..${PLATZ_MAX[art]}.`);
      }
      platz = p;
    }
    return { art, name: String(o.name ?? `Eintrag ${i + 1}`).slice(0, NAME_MAX), bytes, ...(platz !== undefined ? { platz } : {}) };
  });
  return {
    version: SAMMLUNG_VERSION,
    titel: String(x.titel ?? "Sammlung"),
    autor: String(x.autor ?? ""),
    wann: String(x.wann ?? ""),
    eintraege,
  };
}

export interface Verteilung {
  /** Zu schreibende Eintraege in Listen-Reihenfolge, mit ihrem Index in der Sammlung. */
  schritte: { index: number; eintrag: SammlungsEintrag }[];
  /** Indizes der Eintraege ohne Ziel-Platz. */
  uebersprungen: number[];
  /** Mehrfach vergebene Plaetze derselben Art — dann darf nichts geschrieben werden. */
  doppelt: { art: SammlungsArt; platz: number }[];
}

/**
 * Plant das Verteilen einer Sammlung aufs Geraet: wer einen Platz hat, wird
 * geschrieben, wer keinen hat, uebersprungen. Doppelte Plaetze derselben Art
 * werden gemeldet statt stillschweigend nacheinander in denselben Platz zu
 * schreiben — dieselbe Nummer bei IFX und MFX ist dagegen kein Konflikt,
 * das sind getrennte Bereiche.
 */
export function planeVerteilung(eintraege: readonly SammlungsEintrag[]): Verteilung {
  const schritte: Verteilung["schritte"] = [];
  const uebersprungen: number[] = [];
  const gesehen = new Map<string, number>();
  const doppelt: Verteilung["doppelt"] = [];
  eintraege.forEach((eintrag, index) => {
    if (eintrag.platz === undefined) {
      uebersprungen.push(index);
      return;
    }
    const key = `${eintrag.art}:${eintrag.platz}`;
    gesehen.set(key, (gesehen.get(key) ?? 0) + 1);
    if (gesehen.get(key) === 2) doppelt.push({ art: eintrag.art, platz: eintrag.platz });
    schritte.push({ index, eintrag });
  });
  return { schritte, uebersprungen, doppelt };
}

// ─── Plaetze durchnummerieren ────────────────────────────────────────────────

export type NummerierRichtung = "auf" | "ab";

export interface Nummerierung {
  /** Kopien der Eintraege mit neu vergebenen Plaetzen — die Eingabe bleibt unangetastet. */
  eintraege: SammlungsEintrag[];
  vergeben: number;
  /** Eintraege, fuer die hinter der Art-Grenze kein Platz mehr uebrig war. */
  ohnePlatz: number;
}

/**
 * Vergibt die Ziel-Plaetze einer Sammlung in Listen-Reihenfolge, je Art als
 * eigene Reihe (IFX und MFX sind getrennte Bereiche, dieselbe Nummer ist dort
 * kein Konflikt). `start` ist der eingetippte Startplatz; fehlt er, zaehlt die
 * Reihe vom Platz des ersten Eintrags der Art aus — und gibt es auch den
 * nicht, beginnt ▲ bei 1 und ▼ am oberen Ende der Art.
 *
 * ▲ (`auf`) heisst groessere Nummern, ▼ (`ab`) kleinere — dieselbe Lesart wie
 * bei den Pfeilen im Pattern-Editor. Hinter der Art-Grenze bricht die Reihe
 * nicht um, sondern laesst den Platz leer; wer das uebersieht, bekaeme sonst
 * still einen zweiten Eintrag auf Platz 1.
 */
export function nummerierePlaetze(
  eintraege: readonly SammlungsEintrag[],
  start: number | undefined,
  richtung: NummerierRichtung,
): Nummerierung {
  const naechster = new Map<SammlungsArt, number>();
  const schritt = richtung === "auf" ? 1 : -1;
  let vergeben = 0;
  let ohnePlatz = 0;
  const out = eintraege.map((e) => {
    let n = naechster.get(e.art);
    if (n === undefined) {
      const ersterMitPlatz = eintraege.find((x) => x.art === e.art && x.platz !== undefined)?.platz;
      n = start ?? ersterMitPlatz ?? (richtung === "auf" ? 1 : PLATZ_MAX[e.art]);
    }
    naechster.set(e.art, n + schritt);
    const kopie: SammlungsEintrag = { art: e.art, name: e.name, bytes: e.bytes };
    if (n >= 1 && n <= PLATZ_MAX[e.art]) {
      kopie.platz = n;
      vergeben++;
    } else {
      ohnePlatz++;
    }
    return kopie;
  });
  return { eintraege: out, vergeben, ohnePlatz };
}

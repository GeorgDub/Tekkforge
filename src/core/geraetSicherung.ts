/**
 * geraetSicherung — alles, was sich aus dem Geraetespeicher lesen laesst, in
 * einer Datei sichern und wieder vergleichen.
 *
 * Bisher gab es einen Rueckweg nur fuer den zuletzt gelesenen Block. Wer an
 * Effekt-Presets oder Groove-Vorlagen herumprobiert, will aber den Stand von
 * vorher als Ganzes zurueckholen koennen — besonders beim ersten Schreiben mit
 * neuen Werkzeugen.
 *
 * Die Datei ist bewusst JSON mit Base64-Bloecken statt eines eigenen
 * Binaerformats: sie laesst sich ansehen, versionieren und notfalls von Hand
 * reparieren. Der Umfang (rund 100 kB roh) rechtfertigt kein knapperes Format.
 */
import { E2_RAM_MAP } from "./hacktribeRam";
import { bytesToBase64, base64ToBytes } from "./wavCodec";

export const SICHERUNG_VERSION = 1;

export interface SicherungsPlanEintrag {
  key: string;
  label: string;
  adresse: number;
  laenge: number;
}

export interface SicherungsBlock extends SicherungsPlanEintrag {
  bytes: Uint8Array;
}

export interface Sicherung {
  version: number;
  geraet: string;
  firmware: string;
  wann: string;
  bloecke: SicherungsBlock[];
}

/**
 * Was gesichert wird: jeder Bereich der RAM-Karte in voller Laenge. Die Karte
 * ist die einzige Quelle — kommt dort ein Bereich dazu, ist er automatisch
 * dabei, statt hier ein zweites Mal gepflegt werden zu muessen.
 */
export function sicherungsPlan(): SicherungsPlanEintrag[] {
  return E2_RAM_MAP.map((e) => ({
    key: e.key,
    label: e.label,
    adresse: e.base,
    laenge: e.stride * e.count,
  }));
}

export function baueSicherung(
  bloecke: readonly SicherungsBlock[],
  meta: { geraet?: string; firmware?: string; wann?: string },
): string {
  return JSON.stringify(
    {
      version: SICHERUNG_VERSION,
      geraet: meta.geraet ?? "E2S",
      firmware: meta.firmware ?? "hacktribe",
      wann: meta.wann ?? new Date().toISOString(),
      bloecke: bloecke.map((b) => ({
        key: b.key,
        label: b.label,
        adresse: b.adresse,
        laenge: b.laenge,
        daten: bytesToBase64(b.bytes),
      })),
    },
    null,
    1,
  );
}

/**
 * Sicherung einlesen. Wirft bei allem, was nicht stimmt — eine halb geladene
 * Sicherung waere schlimmer als gar keine, weil sie beim Zurueckschreiben
 * Luecken hinterliesse.
 */
export function leseSicherung(text: string): Sicherung {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    throw new Error("Das ist keine lesbare Sicherungsdatei (kein JSON).");
  }
  const x = (typeof roh === "object" && roh ? roh : {}) as Record<string, unknown>;
  if (x.version !== SICHERUNG_VERSION) {
    throw new Error(`Unbekannte Version ${String(x.version)} — diese Sicherung stammt aus einer anderen Fassung (erwartet ${SICHERUNG_VERSION}).`);
  }
  if (!Array.isArray(x.bloecke) || x.bloecke.length === 0) throw new Error("Sicherung enthält keine Bereiche.");
  const bloecke: SicherungsBlock[] = x.bloecke.map((b, i) => {
    const e = (typeof b === "object" && b ? b : {}) as Record<string, unknown>;
    const key = String(e.key ?? `block${i}`);
    if (typeof e.daten !== "string") throw new Error(`Bereich "${key}" hat keine Daten.`);
    const bytes = base64ToBytes(e.daten);
    const laenge = Number(e.laenge);
    if (!Number.isFinite(laenge) || bytes.length !== laenge) {
      throw new Error(`Bereich "${key}": Länge stimmt nicht (${bytes.length} Bytes, ${laenge} erwartet).`);
    }
    return { key, label: String(e.label ?? key), adresse: Number(e.adresse) || 0, laenge, bytes };
  });
  return {
    version: SICHERUNG_VERSION,
    geraet: String(x.geraet ?? "?"),
    firmware: String(x.firmware ?? "?"),
    wann: String(x.wann ?? ""),
    bloecke,
  };
}

export interface SicherungsUnterschied {
  key: string;
  label: string;
  abweichendeBytes: number;
  /** Offset des ersten Unterschieds im Block, −1 wenn der Block ganz fehlt. */
  ersteStelle: number;
  hinweis?: string;
}

/** Zwei Sicherungen (oder frisch gelesene Bloecke) gegenueberstellen. */
export function vergleicheSicherung(
  a: readonly SicherungsBlock[],
  b: readonly SicherungsBlock[],
): SicherungsUnterschied[] {
  const out: SicherungsUnterschied[] = [];
  for (const links of a) {
    const rechts = b.find((x) => x.key === links.key);
    if (!rechts) {
      out.push({ key: links.key, label: links.label, abweichendeBytes: links.laenge, ersteStelle: -1, hinweis: "fehlt in der zweiten Sicherung" });
      continue;
    }
    if (rechts.bytes.length !== links.bytes.length) {
      out.push({ key: links.key, label: links.label, abweichendeBytes: Math.abs(rechts.bytes.length - links.bytes.length), ersteStelle: -1, hinweis: "unterschiedliche Länge" });
      continue;
    }
    let anzahl = 0;
    let erste = -1;
    for (let i = 0; i < links.bytes.length; i++) {
      if (links.bytes[i] !== rechts.bytes[i]) {
        anzahl++;
        if (erste < 0) erste = i;
      }
    }
    if (anzahl) out.push({ key: links.key, label: links.label, abweichendeBytes: anzahl, ersteStelle: erste });
  }
  for (const rechts of b) {
    if (!a.some((x) => x.key === rechts.key)) {
      out.push({ key: rechts.key, label: rechts.label, abweichendeBytes: rechts.laenge, ersteStelle: -1, hinweis: "fehlt in der ersten Sicherung" });
    }
  }
  return out;
}

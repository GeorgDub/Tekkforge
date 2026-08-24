/**
 * generatorSession — die Entscheidungen des Generator-Tabs ohne DOM:
 * Zusammenfassung eines Scans, tekk-Drums-Empfehlung, Dateiarten und
 * erzeuge() = Modus → Rezept(e) → Patterns → Bytes + Dateiname.
 */
import type { ScanEintrag } from "./sampleScan";
import { tempoVorschlag } from "./tempoAnalyse";
import { type Projekt, BUDGET_SEKUNDEN, waehleVolumes } from "./bankPlan";
import { type Rezept, type Modus, regelRezept, regelRezeptProMelo } from "./rezept";
import { baueRezept, baueProMelo, baueAufbau, baueProMeloAufbau, alsAllPat, alsPat } from "./patternGen";
import type { E2PatternInput } from "./electribePatternBuilder";

export interface Zusammenfassung {
  anzahl: number;
  rollen: Record<string, number>;
  sekunden: number;
  megabyte: number;
  tempoVorschlag: number;
  volumesNoetig: number;
  tekkEmpfohlen: boolean;
}

/** tekk4-Drums dazunehmen, wenn Kick, Hat oder Snare/Clap fehlen. */
export function tekkDrumsEmpfohlen(eintraege: ScanEintrag[]): boolean {
  const hat = (r: ScanEintrag["rolle"]) => eintraege.some((e) => e.rolle === r);
  return !hat("kick") || !hat("hat") || !(hat("snare") || hat("clap"));
}

export function zusammenfassung(eintraege: ScanEintrag[], budgetSekunden = BUDGET_SEKUNDEN): Zusammenfassung {
  const rollen: Record<string, number> = {};
  for (const e of eintraege) rollen[e.rolle] = (rollen[e.rolle] ?? 0) + 1;
  const sekunden = eintraege.reduce((s, e) => s + e.sekunden, 0);
  const bpm = tempoVorschlag(eintraege.map((e) => e.sekunden));
  return {
    anzahl: eintraege.length,
    rollen,
    sekunden,
    megabyte: (sekunden * 2 * 44100) / 1048576,
    tempoVorschlag: bpm,
    volumesNoetig: Math.max(1, waehleVolumes(eintraege, bpm, budgetSekunden).length),
    tekkEmpfohlen: tekkDrumsEmpfohlen(eintraege),
  };
}

export function dateiArt(name: string): "wav" | "audio" | "skip" {
  const ext = name.toLowerCase().replace(/^.*\./, "");
  if (ext === "wav" || ext === "wave") return "wav";
  if (["mp3", "m4a", "aac", "ogg", "flac", "aif", "aiff"].includes(ext)) return "audio";
  return "skip";
}

/**
 * Gehoert eine Datei aus dem gewaehlten Verzeichnis (inkl. Unterordner) in den
 * Scan? Ausgenommen: der eigene TekkForge-Ausgabeordner und versteckte Ordner.
 */
export function dateiRelevant(relPfad: string, name: string): boolean {
  if (dateiArt(name) === "skip") return false;
  const teile = relPfad.split(/[\\/]/).slice(0, -1);
  return !teile.some((t) => t.toLowerCase() === "tekkforge" || t.startsWith("."));
}

export interface Erzeugt {
  modus: Modus;
  rezepte: Rezept[];
  patterns: E2PatternInput[];
  bytes: Uint8Array;
  dateiname: string;
  hinweise: string[];
  warumSo: string;
  /** erster Slot (1-basiert), auf den die Patterns zeigen */
  startSlot: number;
}

export function erzeuge(
  projekt: Projekt,
  wunsch: {
    modus: Modus;
    bpm: number;
    melo?: string;
    beschreibung?: string;
    startSlot?: number;
    rezept?: Rezept;
    rezepte?: Rezept[];
    /** Aufbau-Kette: identische Steps in allen Patterns, Mutes wachsen bis zum Drop */
    aufbau?: boolean;
  },
): Erzeugt {
  const basis = projekt.name.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (wunsch.modus === "promelo") {
    const rezepte = wunsch.rezepte?.length ? wunsch.rezepte.map((r) => ({ ...r, bpm: wunsch.bpm })) : regelRezeptProMelo(projekt, wunsch.bpm);
    const { patterns, hinweise } = wunsch.aufbau ? baueProMeloAufbau(rezepte, projekt) : baueProMelo(rezepte, projekt);
    return {
      modus: "promelo",
      rezepte,
      patterns,
      bytes: new Uint8Array(alsAllPat(patterns)),
      dateiname: `${basis}-promelo${wunsch.aufbau ? "-aufbau" : ""}.e2sallpat`,
      hinweise,
      startSlot: 1,
      warumSo:
        `${rezepte.length} Melodien, je ${wunsch.aufbau ? "eine Aufbau-Kette (Entmuten bis zum Drop)" : "ein Jam-Pattern"}; ` +
        `Kick-Familien rotieren: ${rezepte.map((r) => `${r.thema.melo} → ${r.thema.kickFamilie}`).join(", ")}.`,
    };
  }
  const rezept =
    wunsch.rezept && wunsch.rezept.modus === wunsch.modus
      ? wunsch.rezept
      : regelRezept(projekt, { modus: wunsch.modus, bpm: wunsch.bpm, melo: wunsch.melo, beschreibung: wunsch.beschreibung });
  const start = wunsch.startSlot ?? 1;
  if (wunsch.aufbau) {
    const { patterns, hinweise } = baueAufbau(rezept, projekt, { startSlot: start });
    return {
      modus: wunsch.modus,
      rezepte: [rezept],
      patterns,
      bytes: new Uint8Array(alsAllPat(patterns, start)),
      dateiname: `${basis}-aufbau.e2sallpat`,
      hinweise,
      warumSo:
        rezept.begruendung +
        ` Aufbau-Kette: ${patterns.length} Patterns, alle Steps ueberall gesetzt, entmutet wird stufenweise — Kick erst im Drop; am Geraet frei weiter entmuten.`,
      startSlot: start,
    };
  }
  const jam = wunsch.modus === "jam";
  const { patterns, hinweise } = baueRezept(rezept, projekt, { startSlot: start });
  return {
    modus: wunsch.modus,
    rezepte: [rezept],
    patterns,
    bytes: jam ? alsPat(patterns[0]) : new Uint8Array(alsAllPat(patterns, start)),
    dateiname: jam ? `${basis}-jam.e2spat` : `${basis}-miniset.e2sallpat`,
    hinweise,
    warumSo: rezept.begruendung,
    startSlot: start,
  };
}

export function projektJson(projekt: Projekt): string {
  return JSON.stringify(projekt, null, 1);
}

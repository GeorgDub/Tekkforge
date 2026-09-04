/**
 * generatorSession — die Entscheidungen des Generator-Tabs ohne DOM:
 * Zusammenfassung eines Scans, tekk-Drums-Empfehlung, Dateiarten und
 * erzeuge() = Modus → Rezept(e) → Patterns → Bytes + Dateiname.
 */
import { type ScanEintrag, rmsDb, peakVon } from "./sampleScan";
import { klangProfil } from "./klangProfil";
import { ramBytesFuer } from "./sampleRam";
import { tempoVorschlag } from "./tempoAnalyse";
import { type Projekt, BUDGET_SEKUNDEN, waehleVolumes } from "./bankPlan";
import { type Rezept, type Modus, regelRezept, regelRezeptProMelo } from "./rezept";
import { baueRezept, baueProMelo, bauePaare, bauePaareProMelo, alsAllPat, alsPat } from "./patternGen";
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
    // Bytes wie in der Bank: zwei je Bild bei der Rate des Eintrags — ein
    // 22 050-Hz-Eintrag zaehlt halb, statt auf 44,1 kHz hochgerechnet zu werden.
    megabyte: eintraege.reduce((b, e) => b + ramBytesFuer({ pcm: e.pcm, sampleRate: e.sampleRate }), 0) / 1048576,
    tempoVorschlag: bpm,
    volumesNoetig: Math.max(1, waehleVolumes(eintraege, bpm, budgetSekunden).length),
    tekkEmpfohlen: tekkDrumsEmpfohlen(eintraege),
  };
}

/** Was Chromiums decodeAudioData kennt (mp3/aac/ogg/opus/flac/webm/aiff …). */
export const AUDIO_CHROMIUM = ["mp3", "m4a", "aac", "ogg", "oga", "opus", "flac", "aif", "aiff", "webm", "mp4", "m4b", "weba"];
/** Was nur ffmpeg dekodiert — unter Electron ueber die Audio-Bruecke, im Browser nicht. */
export const AUDIO_FFMPEG = ["wma", "wv", "ape", "mpc", "ac3", "dts", "amr", "au", "snd", "caf", "aifc", "mka", "mkv", "avi", "mov", "m4v", "3gp", "mpg", "mpeg", "ts", "tta", "spx", "voc", "w64", "rf64", "gsm", "dsf", "dff", "mp2", "mpa", "ra", "rm", "asf", "wmv", "flv", "ogv"];

/**
 * "wav" = parseWav, "audio" = Chromium (ffmpeg als Rueckfall), "ffmpeg" = nur
 * ueber die Audio-Bruecke, "skip" = kein Audio.
 */
export function dateiArt(name: string): "wav" | "audio" | "ffmpeg" | "skip" {
  const ext = name.toLowerCase().replace(/^.*\./, "");
  if (ext === "wav" || ext === "wave") return "wav";
  if (AUDIO_CHROMIUM.includes(ext)) return "audio";
  if (AUDIO_FFMPEG.includes(ext)) return "ffmpeg";
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

/**
 * Eindeutige Lied-Kuerzel (max 10 Zeichen, ohne Endung) fuer Sample-Namen —
 * bei Kollision ersetzt eine laufende Ziffer das letzte Zeichen.
 */
export function eindeutigeKuerzel(dateinamen: readonly string[]): string[] {
  const vergeben = new Set<string>();
  return dateinamen.map((n) => {
    const basis = n.replace(/\.[^.]+$/, "").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 10).trim() || "Lied";
    let kurz = basis;
    for (let i = 2; vergeben.has(kurz); i++) kurz = `${basis.slice(0, 10 - String(i).length)}${i}`;
    vergeben.add(kurz);
    return kurz;
  });
}

/**
 * Ein Vocal-Segment der Lied-Vollabdeckung als Scan-Eintrag: Name "<Lied> V01",
 * eigene Familie je Segment (sonst dedupliziert die Budget-Auswahl die Segmente
 * und die A/B-Chunk-Paarung teilt sich eine Gruppe).
 */
export function voxSegmentEintrag(liedName: string, nr: number, pcm: Float32Array): ScanEintrag {
  const label = `V${String(nr).padStart(2, "0")}`;
  const kurz = liedName.slice(0, Math.max(3, 16 - label.length - 1));
  const stem = `${kurz} ${label}`;
  return {
    datei: `${stem}.wav`, stem, rolle: "vox", familie: stem.toLowerCase(), sekunden: pcm.length / 44100,
    rmsDb: rmsDb(pcm), peak: peakVon(pcm), pcm, sampleRate: 44100, lied: liedName, klang: klangProfil(pcm, 44100),
  };
}

export interface LiedGruppe {
  vonLied: number;
  bisLied: number;
  /** geschaetzte Patternzahl der Gruppe */
  patterns: number;
}

/**
 * Teilt Lieder in Gruppen, deren geschaetzte Patternzahl (Melos x
 * patternsProMelo + Extras des Lieds, z. B. VRS-Patterns der Vocal-Abdeckung)
 * je Gruppe hoechstens max betraegt — Schnitt immer an der Liedgrenze. Ein
 * einzelnes Lied ueber dem Deckel bildet eine eigene Gruppe (und wird spaeter
 * beim Packen auf 250 gedeckelt).
 */
export function teileLieder(
  melosJeLied: readonly number[],
  patternsProMelo: number,
  max: number,
  extrasJeLied: readonly number[] = [],
): LiedGruppe[] {
  const gruppen: LiedGruppe[] = [];
  let von = 0;
  let summe = 0;
  for (let i = 0; i < melosJeLied.length; i++) {
    const kosten = melosJeLied[i] * patternsProMelo + (extrasJeLied[i] ?? 0);
    if (i > von && summe + kosten > max) {
      gruppen.push({ vonLied: von, bisLied: i - 1, patterns: summe });
      von = i;
      summe = 0;
    }
    summe += kosten;
  }
  if (von < melosJeLied.length) gruppen.push({ vonLied: von, bisLied: melosJeLied.length - 1, patterns: summe });
  return gruppen;
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

/**
 * Der Dichte-Schalter der Oberflaeche schaltet den dichten Satz EIN — er nimmt
 * ihn aber nicht weg.
 *
 * Der Unterschied ist wichtig: die Dichte kann auch aus der Beschreibung
 * kommen ("fett", "dicht", "wall of …" in `figurenAus`) oder aus einem Rezept,
 * das die KI geliefert oder der Nutzer gespeichert hat. Wuerde der Schalter im
 * ausgeschalteten Zustand "schlank" erzwingen, ueberschriebe er beides wortlos
 * — zwei Stellen, die sich still widersprechen, und der Nutzer sieht nur, dass
 * sein "fett" nichts bewirkt.
 *
 * Ohne Angabe von irgendwoher gilt schlank; das war die Antwort auf
 * "ueberladen und anstrengend zu hoeren".
 */
function mitDichte(r: Rezept, voll?: boolean): Rezept {
  const dichte = voll ? "voll" : (r.figuren.dichte ?? "schlank");
  return { ...r, figuren: { ...r.figuren, dichte } };
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
    /** Erste Aufbau-Stufe nur mit jedem zweiten Schlagzeug-Schlag (Vorgabe: aus). */
    duennesIntro?: boolean;
    /** Alter, dichter Satz statt des schlanken (Vorgabe: aus, also schlank). */
    dichteVoll?: boolean;
  },
): Erzeugt {
  const basis = projekt.name.toUpperCase().replace(/[^A-Z0-9]+/g, "");
  if (wunsch.modus === "promelo") {
    const rezepte = (wunsch.rezepte?.length ? wunsch.rezepte.map((r) => ({ ...r, bpm: wunsch.bpm })) : regelRezeptProMelo(projekt, wunsch.bpm)).map(
      (r) => mitDichte(r, wunsch.dichteVoll),
    );
    const { patterns, hinweise } = wunsch.aufbau ? bauePaareProMelo(rezepte, projekt) : baueProMelo(rezepte, projekt);
    return {
      modus: "promelo",
      rezepte,
      patterns,
      bytes: new Uint8Array(alsAllPat(patterns)),
      dateiname: `${basis}-promelo${wunsch.aufbau ? "-paare" : ""}.e2sallpat`,
      hinweise,
      startSlot: 1,
      warumSo:
        `${rezepte.length} Melodien, ${wunsch.aufbau ? "Vocal-Paare reihum als A ↔ B plus KICK" : "je ein Jam-Pattern"}; ` +
        `Kick-Familien rotieren: ${rezepte.map((r) => `${r.thema.melo} → ${r.thema.kickFamilie}`).join(", ")}.`,
    };
  }
  const rezept = mitDichte(
    wunsch.rezept && wunsch.rezept.modus === wunsch.modus
      ? wunsch.rezept
      : regelRezept(projekt, { modus: wunsch.modus, bpm: wunsch.bpm, melo: wunsch.melo, beschreibung: wunsch.beschreibung }),
    wunsch.dichteVoll,
  );
  const start = wunsch.startSlot ?? 1;
  if (wunsch.aufbau) {
    const { patterns, hinweise } = bauePaare(rezept, projekt, { startSlot: start });
    return {
      modus: wunsch.modus,
      rezepte: [rezept],
      patterns,
      bytes: new Uint8Array(alsAllPat(patterns, start)),
      dateiname: `${basis}-paare.e2sallpat`,
      hinweise,
      warumSo:
        rezept.begruendung +
        ` Paare: ${patterns.length} Patterns — je Vocal-Paar A ↔ B (Vocal auf Part 16, kein Alternate), danach ein KICK-Pattern ohne Kette; ` +
        `Steps ueberall gesetzt, Melodie und Vocal im KICK gemutet. Am Geraet frei weiter entmuten.` +
        (rezept.figuren.dichte === "voll" ? " Dichter Satz (voll)." : ""),
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

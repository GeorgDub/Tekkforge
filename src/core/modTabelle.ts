/**
 * modTabelle — die Modulationstypen-Tabelle der Firmware und eigene Typen.
 *
 * Befund 2026-09-03 (Disassembly + Abbildvergleich Stock ↔ Hacktribe):
 *
 *   - Ein Eintrag hat 88 Bytes: Name (NUL-terminiert, bis 20 Zeichen), dann
 *     Kurven-/Bereichsdaten. Stock: 72 Eintraege bei RAM 0xC00D81F0 (12
 *     Quellen × 6 Ziele), Hacktribe verlegt die Tabelle nach 0xC01A0000 und
 *     haengt 24 Sinus-Typen an (96). Der Zeiger steht in den Literal-Pools
 *     zweier Funktionen (0xC0098D3C, 0xC0099498); die Funktionen greifen zur
 *     Laufzeit direkt in DIESE Tabelle (Werte werden dort hineingeschrieben) —
 *     sie ist also live, ein fluechtiger Eintrag wirkt ohne Neustart. Hinter
 *     Hacktribes 96 Eintraegen sind 0xFF-Bytes fuer 645 weitere.
 *   - Felder (aus dem Vergleich der 96 Eintraege): +0x15 Kennung/Symbol,
 *     +0x16/+0x17 Vorgabewerte fuer Speed/Depth-Knopf, +0x18 Wellenform
 *     (0 Saw, 1 Square, 2 Dreieck bzw. EG, 3 S&H, 4 Random, 6 Sinus),
 *     +0x19/+0x1A BPM-Sync-Flags, +0x1B Speed-Vorgabe, +0x1C Speed-Min,
 *     +0x1D Speed-Max (0x7F frei, 0x10 = 16 Taktteiler bei BPM), +0x28 = 1
 *     bei LFOs, +0x29 Ziel (3 Filter, 1 Pitch, 2 OSC, 8 Level, 9 Pan, 10 IFX),
 *     +0x2A Depth-Vorgabe, +0x2B Depth-Min, +0x2C Depth-Max (signiert; „Up"
 *     = 0…63, „Dwn" = −63…0). EG-Typen haben ab +0x19 ein anderes Layout.
 *   - ⚠ Wo das Menue seine Obergrenze (96) hernimmt, ist NICHT gefunden: im
 *     Code-Diff gibt es kein 72 → 96, und vier Funktionen klemmen den Typ
 *     unveraendert bei 71 (0xC0098D14 u. a.). Ob ein 97. Eintrag im Menue
 *     erscheint, entscheidet nur der Versuch am Geraet („fluechtig").
 *
 * Eigene Typen entstehen als KOMBINATIONEN vorhandener: Wellenform und
 * BPM-Flags sind getrennte Bytes, also gibt es zu jedem BPM-Typ (SawUpB,
 * SawDwnB, SquUpB, SquDwnB, S&HBPM) eine freilaufende Fassung und zu Random
 * eine BPM-Fassung — 6 Quellen × 6 Ziele = 36 neue Typen. Der DSP kennt alle
 * beteiligten Wellenformen schon; ob er die Flags unabhaengig liest, zeigt
 * die Hoerprobe.
 */
import { dateiOffset, VSB_GROESSE } from "./firmwareBau";

export const MOD_TABELLE_ADDR_HACKTRIBE = 0xc01a0000;
export const MOD_TABELLE_ADDR_STOCK = 0xc00d81f0;
export const MOD_EINTRAG = 0x58;
export const MOD_NAME_LAENGE = 20;
/** Hacktribe: 96 belegt; dahinter frei bis zum Ende des 0xFF-Bereichs (645 Eintraege). */
export const MOD_MAX = 96 + 645;
export const MOD_ZIEL_CODES: Record<string, number> = { Filter: 3, Pitch: 1, OSC: 2, Level: 8, Pan: 9, IFX: 10 };
export const MOD_ZIEL_NAMEN: Record<number, string> = { 3: "Filter", 1: "Pitch", 2: "OSC", 8: "Level", 9: "Pan", 10: "IFX" };
export const MOD_WELLEN: Record<number, string> = { 0: "Saw", 1: "Square", 2: "Tri/EG", 3: "S&H", 4: "Random", 6: "Sin" };

export interface ModEintrag {
  name: string;
  welle: number;
  bpm: boolean;
  ziel: number;
  speedVorgabe: number;
  speedMax: number;
  depthVorgabe: number;
  depthMin: number;
  depthMax: number;
  roh: Uint8Array;
}

export interface ModEintragMitPlatz {
  /** 0-basiert wie gespeichert; Anzeige = platz + 1. */
  platz: number;
  bytes: Uint8Array;
}

const s8 = (b: number): number => (b > 127 ? b - 256 : b);

export function istModLeer(bytes: Uint8Array): boolean {
  return bytes.length === MOD_EINTRAG && (bytes[0] === 0xff || bytes[0] === 0);
}

export function decodeMod(bytes: Uint8Array): ModEintrag {
  if (bytes.length !== MOD_EINTRAG) throw new Error(`${bytes.length} Bytes — ein Modulations-Eintrag hat ${MOD_EINTRAG}`);
  let name = "";
  for (let i = 0; i < MOD_NAME_LAENGE && bytes[i]; i++) name += String.fromCharCode(bytes[i]);
  return {
    name,
    welle: bytes[0x18],
    bpm: bytes[0x19] === 1 && bytes[0x1a] === 1,
    ziel: bytes[0x29],
    speedVorgabe: bytes[0x1b],
    speedMax: bytes[0x1d],
    depthVorgabe: s8(bytes[0x2a]),
    depthMin: s8(bytes[0x2b]),
    depthMax: s8(bytes[0x2c]),
    roh: bytes.slice(),
  };
}

export function modName(bytes: Uint8Array): string {
  return decodeMod(bytes).name;
}

/** Quelle („SawUpB") und Ziel („Pitch") aus dem Namen. */
export function modQuelleZiel(name: string): { quelle: string; ziel: string } {
  const i = name.lastIndexOf(" ");
  return i < 0 ? { quelle: name, ziel: "" } : { quelle: name.slice(0, i), ziel: name.slice(i + 1) };
}

export function liesModTabelle(fw: Uint8Array, addr = MOD_TABELLE_ADDR_HACKTRIBE): Uint8Array[] {
  const out: Uint8Array[] = [];
  const start = dateiOffset(addr);
  for (let i = 0; i < MOD_MAX; i++) {
    const off = start + i * MOD_EINTRAG;
    if (off + MOD_EINTRAG > fw.length) break;
    const b = fw.slice(off, off + MOD_EINTRAG);
    if (istModLeer(b)) break;
    out.push(b);
  }
  return out;
}

/** Ein Eintrag mit neuem Namen; ASCII, hoechstens 20 Zeichen. */
export function modUmbenennen(vorlage: Uint8Array, name: string): Uint8Array {
  const out = vorlage.slice();
  out.fill(0, 0, 0x15);
  const n = name.slice(0, MOD_NAME_LAENGE);
  for (let i = 0; i < n.length; i++) {
    const c = n.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) throw new Error(`Name „${name}“: nur ASCII-Zeichen (Position ${i + 1})`);
    out[i] = c;
  }
  return out;
}

/**
 * Freilaufende Fassung eines BPM-Typs: Wellenform und Depth-Bereich bleiben,
 * die Speed-Bytes (+0x16, +0x17, +0x19…+0x1D) kommen von der freilaufenden
 * Dreieck-Vorlage desselben Ziels — so, wie sich LFOTri und LFOTriB
 * unterscheiden.
 */
export function modFreilaufend(bpmVorlage: Uint8Array, freieVorlage: Uint8Array, name: string): Uint8Array {
  const out = modUmbenennen(bpmVorlage, name);
  for (const o of [0x16, 0x17, 0x19, 0x1a, 0x1b, 0x1c, 0x1d]) out[o] = freieVorlage[o];
  return out;
}

/** BPM-synchrone Fassung eines freilaufenden Typs — spiegelbildlich. */
export function modBpm(freieVorlage: Uint8Array, bpmVorlage: Uint8Array, name: string): Uint8Array {
  const out = modUmbenennen(freieVorlage, name);
  for (const o of [0x16, 0x17, 0x19, 0x1a, 0x1b, 0x1c, 0x1d]) out[o] = bpmVorlage[o];
  return out;
}

export const MOD_KOMBI_ZIELE = ["Filter", "Pitch", "OSC", "Level", "Pan", "IFX"] as const;
/** Die freilaufenden Fassungen der BPM-Typen und die BPM-Fassung von Random. */
export const MOD_KOMBINATIONEN: readonly { neu: string; vonBpm?: string; vonFrei?: string }[] = [
  { neu: "SawUp", vonBpm: "SawUpB" },
  { neu: "SawDwn", vonBpm: "SawDwnB" },
  { neu: "SquUp", vonBpm: "SquUpB" },
  { neu: "SquDwn", vonBpm: "SquDwnB" },
  { neu: "S&H", vonBpm: "S&HBPM" },
  { neu: "RandomB", vonFrei: "Random" },
];

/**
 * Die 36 Kombinationen aus einer Tabelle, die es dort noch nicht gibt.
 * Vorlagen fuer die Speed-Bytes: „LFOTri <Ziel>" (frei) und „LFOTriB <Ziel>"
 * (BPM). Fehlt eine Vorlage, faellt die Kombination weg (Bericht sagt es).
 */
export function modKombinationen(tabelle: readonly Uint8Array[]): { eintraege: { name: string; bytes: Uint8Array }[]; fehlend: string[] } {
  const byName = new Map(tabelle.map((b) => [modName(b), b]));
  const eintraege: { name: string; bytes: Uint8Array }[] = [];
  const fehlend: string[] = [];
  for (const k of MOD_KOMBINATIONEN) {
    for (const z of MOD_KOMBI_ZIELE) {
      const name = `${k.neu} ${z}`;
      if (byName.has(name)) continue;
      const frei = byName.get(`LFOTri ${z}`);
      const bpm = byName.get(`LFOTriB ${z}`);
      const quelle = byName.get(`${k.vonBpm ?? k.vonFrei} ${z}`);
      if (!frei || !bpm || !quelle) {
        fehlend.push(name);
        continue;
      }
      eintraege.push({ name, bytes: k.vonBpm ? modFreilaufend(quelle, frei, name) : modBpm(quelle, bpm, name) });
    }
  }
  return { eintraege, fehlend };
}

export interface ModBauErgebnis {
  ok: true;
  bytes: Uint8Array;
  anzahlVorher: number;
  anzahlNachher: number;
}

/** Eintraege hinter die belegten Plaetze der Tabelle schreiben (Datei-Abbild). */
export function setzeModTabelle(fw: Uint8Array, neu: readonly ModEintragMitPlatz[], addr = MOD_TABELLE_ADDR_HACKTRIBE): ModBauErgebnis | { ok: false; reason: string } {
  if (fw.length !== VSB_GROESSE) return { ok: false, reason: `${fw.length} Bytes — eine SYSTEM.VSB hat ${VSB_GROESSE}` };
  const vorhanden = liesModTabelle(fw, addr).length;
  if (!vorhanden) return { ok: false, reason: `Bei ${addr.toString(16)} liegt keine Modulationstabelle` };
  const out = fw.slice();
  const sortiert = [...neu].sort((a, b) => a.platz - b.platz);
  let erwartet = vorhanden;
  for (const e of sortiert) {
    if (e.bytes.length !== MOD_EINTRAG) return { ok: false, reason: `Platz ${e.platz + 1}: ${e.bytes.length} Bytes statt ${MOD_EINTRAG}` };
    if (e.platz !== erwartet) return { ok: false, reason: `Platz ${e.platz + 1} lässt eine Lücke — erwartet ${erwartet + 1}` };
    if (e.platz >= MOD_MAX) return { ok: false, reason: `Platz ${e.platz + 1} liegt hinter dem freien Bereich (${MOD_MAX})` };
    try {
      decodeMod(e.bytes);
    } catch (err) {
      return { ok: false, reason: err instanceof Error ? err.message : String(err) };
    }
    if (!e.bytes[0] || e.bytes[0] === 0xff) return { ok: false, reason: `Platz ${e.platz + 1}: Eintrag ohne Namen` };
    out.set(e.bytes, dateiOffset(addr) + e.platz * MOD_EINTRAG);
    erwartet++;
  }
  return { ok: true, bytes: out, anzahlVorher: vorhanden, anzahlNachher: erwartet };
}

/**
 * oszTabelle — die Oszillator-/Sample-Tabelle der Firmware (Plaetze 1–421).
 *
 * Was am Geraet unter „Sample 001 SAW, 002 PULSE, … 274 VPM-SINE 32" steht,
 * ist keine PCM-Liste, sondern eine Tabelle von 32-Byte-Eintraegen in der
 * Firmware (RAM 0xC00D9AB0, Datei 0xD9BB0). Befund 2026-09-03 am Vergleich
 * Stock 2.02 ↔ Hacktribe:
 *
 *   - Stock fuehrt dort 421 Eintraege: 1–18 die DSP-Oszillatoren (SAW … Audio
 *     In St), ab 19 die Namen der Werks-Samples („Hippy", „BigBreaks", …).
 *   - Hacktribe ersetzt 19–274 durch DSP-Varianten (DUAL/OCT/RING/CHIP, dann
 *     108 FM „X-…" und 132 VPM) und leert 275–421 (0xFF). Die PCM der
 *     Werks-Samples liegt NICHT hier (Sample-Flash), nur ihr Name und Index.
 *   - Zwei Beschreiber im Code kennen die Tabelle: {Zeiger 0xC00D9AB0, Bytes
 *     n×32, Anzahl n, 999} bei 0xC004E3B8 und 0xC004FAF4 — Stock n = 421,
 *     Hacktribe n = 274. Genau wie beim IFX-Menue entscheidet die Anzahl,
 *     wie viele Plaetze das Geraet anbietet.
 *
 * Eintrag (32 Bytes):
 *   +0x00  Name, 15 Zeichen + NUL
 *   +0x10  Kategorie (0 Analog, 1 Audio In, 0x0A FM, 0x10 VPM; Stock: Sample-Kategorie)
 *   +0x12  u16 LE DSP-Programm (1 SAW … 36 CHIP-TRI 2, 45 Audio In; Stock-Samples: Sample-Index)
 *   +0x14  Zusatz A (DUAL: 251 = −5 Verstimmung), +0x15 Zusatz B (RING: 33), +0x16 Modus (193/208)
 *   +0x17  Pegel (0x7F), +0x18 Vorgabewert des Edit-Parameters (Detune, Cutoff …), +0x19 = 1
 *   +0x1C  Parameter, signiert: FM −63…63 (≙ −24…+24 Halbtoene), VPM 0…32 (Ratio-Stufe)
 *
 * Damit lassen sich die freien Plaetze 275–421 mit VARIANTEN der vorhandenen
 * DSP-Programme fuellen — andere Verstimmung, anderes Ratio, anderer Pegel —
 * genau das, was Hacktribe mit FM und VPM gemacht hat. Neue PCM geht so
 * nicht. ⚠ Ob das Geraet neue Eintraege annimmt, ist am Geraet noch offen;
 * der Mechanismus ist derselbe wie beim IFX-Menue (dort belegt).
 */
import { dateiOffset, VSB_GROESSE } from "./firmwareBau";

export const OSZ_TABELLE_ADDR = 0xc00d9ab0;
export const OSZ_EINTRAG = 32;
/** Plaetze, die der Stock-Beschreiber kennt — dahinter liegen andere Daten. */
export const OSZ_MAX = 421;
export const OSZ_NAME_LAENGE = 15;

export interface OszZaehler {
  addr: number;
  /** "anzahl" = n, "bytes" = n × 32 */
  art: "anzahl" | "bytes";
}
/** Die vier u32-Zellen (LE) der beiden Beschreiber. */
export const OSZ_ZAEHLER: readonly OszZaehler[] = [
  { addr: 0xc004e3bc, art: "bytes" },
  { addr: 0xc004e3c0, art: "anzahl" },
  { addr: 0xc004faf8, art: "bytes" },
  { addr: 0xc004fafc, art: "anzahl" },
];
/** Der Zeiger vor jedem Beschreiber — zur Probe, dass man die richtige Stelle hat. */
export const OSZ_ZEIGER_ADDRS: readonly number[] = [0xc004e3b8, 0xc004faf4];

export interface OszEintrag {
  name: string;
  kategorie: number;
  programm: number;
  zusatzA: number;
  zusatzB: number;
  modus: number;
  pegel: number;
  vorgabe: number;
  /** signiert −128…127 */
  parameter: number;
  roh: Uint8Array;
}

export const KATEGORIE_NAMEN: Record<number, string> = { 0: "Analog", 1: "Audio In", 0x0a: "FM", 0x10: "VPM" };

export function leererOsz(): Uint8Array {
  return new Uint8Array(OSZ_EINTRAG).fill(0xff);
}

export function istOszLeer(bytes: Uint8Array): boolean {
  return bytes.length === OSZ_EINTRAG && bytes.every((b) => b === 0xff);
}

export function decodeOsz(bytes: Uint8Array): OszEintrag {
  if (bytes.length !== OSZ_EINTRAG) throw new Error(`${bytes.length} Bytes — ein Oszillator-Eintrag hat ${OSZ_EINTRAG}`);
  let name = "";
  for (let i = 0; i < OSZ_NAME_LAENGE && bytes[i]; i++) name += String.fromCharCode(bytes[i]);
  const p = bytes[0x1c];
  return {
    name,
    kategorie: bytes[0x10],
    programm: bytes[0x12] | (bytes[0x13] << 8),
    zusatzA: bytes[0x14],
    zusatzB: bytes[0x15],
    modus: bytes[0x16],
    pegel: bytes[0x17],
    vorgabe: bytes[0x18],
    parameter: p > 127 ? p - 256 : p,
    roh: bytes.slice(),
  };
}

/** Kodieren: die rohen Bytes bleiben Vorlage, nur die benannten Felder werden gesetzt. */
export function encodeOsz(e: Omit<OszEintrag, "roh"> & { roh?: Uint8Array }): Uint8Array {
  const out = e.roh && e.roh.length === OSZ_EINTRAG ? e.roh.slice() : new Uint8Array(OSZ_EINTRAG);
  out.fill(0, 0, 16);
  const name = e.name.slice(0, OSZ_NAME_LAENGE);
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    if (c < 0x20 || c > 0x7e) throw new Error(`Name „${e.name}“: nur ASCII-Zeichen (Position ${i + 1})`);
    out[i] = c;
  }
  if (e.programm < 0 || e.programm > 0xffff) throw new Error("Programm ausserhalb 0…65535");
  if (e.parameter < -128 || e.parameter > 127) throw new Error("Parameter ausserhalb −128…127");
  for (const [k, v] of [
    ["kategorie", e.kategorie],
    ["zusatzA", e.zusatzA],
    ["zusatzB", e.zusatzB],
    ["modus", e.modus],
    ["pegel", e.pegel],
    ["vorgabe", e.vorgabe],
  ] as const) {
    if (v < 0 || v > 255) throw new Error(`${k} ausserhalb 0…255`);
  }
  out[0x10] = e.kategorie;
  out[0x11] = 0;
  out[0x12] = e.programm & 0xff;
  out[0x13] = e.programm >> 8;
  out[0x14] = e.zusatzA;
  out[0x15] = e.zusatzB;
  out[0x16] = e.modus;
  out[0x17] = e.pegel;
  out[0x18] = e.vorgabe;
  out[0x19] = 1;
  out[0x1c] = e.parameter & 0xff;
  return out;
}

/** Eine Variante aus einer Vorlage: gleiche Engine, anderer Name/Parameter/Pegel/Vorgabe. */
export function oszVariante(vorlage: Uint8Array, aenderung: { name: string; parameter?: number; pegel?: number; vorgabe?: number; zusatzA?: number }): Uint8Array {
  const v = decodeOsz(vorlage);
  return encodeOsz({ ...v, ...aenderung });
}

/** FM-Halbtoene ↔ Parameter (hacktribe: −24…+24 Halbtoene auf −63…63). */
export const fmHalbtonZuParameter = (halbton: number): number => Math.max(-63, Math.min(63, Math.round((halbton * 63) / 24)));
export const fmParameterZuHalbton = (p: number): number => Math.round((p * 24) / 63);

export interface OszSchreibwert {
  addr: number;
  wert: number;
}

/** Die vier Beschreiber-Zellen fuer eine Anzahl n. */
export function oszZaehlerSchreibliste(anzahl: number): OszSchreibwert[] {
  return OSZ_ZAEHLER.map((z) => ({ addr: z.addr, wert: z.art === "anzahl" ? anzahl : anzahl * OSZ_EINTRAG }));
}

export type OszStand = { ok: true; anzahl: number } | { ok: false; reason: string };

const hex = (n: number): string => `0x${n.toString(16).toUpperCase()}`;

/** Aus den vier gelesenen Zellen (und den zwei Zeigern) die Anzahl ableiten — nur wenn alles zusammenpasst. */
export function leseOszStand(zellen: readonly OszSchreibwert[], zeiger?: readonly number[]): OszStand {
  const map = new Map(zellen.map((z) => [z.addr, z.wert]));
  for (const z of OSZ_ZAEHLER) if (!map.has(z.addr)) return { ok: false, reason: `Zelle ${hex(z.addr)} fehlt` };
  if (zeiger) for (const [i, p] of zeiger.entries()) if (p !== OSZ_TABELLE_ADDR) return { ok: false, reason: `Zeiger ${hex(OSZ_ZEIGER_ADDRS[i])} zeigt auf ${hex(p)}, nicht auf die Tabelle` };
  const anzahl = map.get(OSZ_ZAEHLER[1].addr)!;
  for (const z of OSZ_ZAEHLER) {
    const soll = z.art === "anzahl" ? anzahl : anzahl * OSZ_EINTRAG;
    if (map.get(z.addr) !== soll) return { ok: false, reason: `Zelle ${hex(z.addr)} sagt ${map.get(z.addr)}, erwartet ${soll} — Beschreiber widersprüchlich` };
  }
  if (anzahl < 1 || anzahl > OSZ_MAX) return { ok: false, reason: `Anzahl ${anzahl} ausserhalb 1…${OSZ_MAX}` };
  return { ok: true, anzahl };
}

export type OszPlan = { ok: true; schreiben: OszSchreibwert[]; neuePlaetze: number[] } | { ok: false; reason: string };

/**
 * Die Tabelle von `aktuell` auf `ziel` Eintraege erweitern oder kuerzen: die
 * Zellen dafuer, und welche Plaetze (1-basiert) dadurch neu sichtbar werden.
 * Erweitern verlangt, dass jeder neu sichtbare Platz belegt ist (istBelegt).
 */
export function planeOszErweiterung(aktuell: number, ziel: number, istBelegt: (platz: number) => boolean): OszPlan {
  if (ziel < 1 || ziel > OSZ_MAX) return { ok: false, reason: `Ziel ${ziel} ausserhalb 1…${OSZ_MAX}` };
  const neuePlaetze: number[] = [];
  for (let p = aktuell + 1; p <= ziel; p++) {
    if (!istBelegt(p)) return { ok: false, reason: `Platz ${p} ist leer — die Liste bekäme eine Lücke` };
    neuePlaetze.push(p);
  }
  return { ok: true, schreiben: oszZaehlerSchreibliste(ziel), neuePlaetze };
}

// ─── Firmware-Datei ──────────────────────────────────────────────────────────

const u32 = (b: Uint8Array, off: number): number => (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
const setU32 = (b: Uint8Array, off: number, v: number): void => {
  b[off] = v & 0xff;
  b[off + 1] = (v >>> 8) & 0xff;
  b[off + 2] = (v >>> 16) & 0xff;
  b[off + 3] = (v >>> 24) & 0xff;
};

export const oszOffset = (platz: number): number => dateiOffset(OSZ_TABELLE_ADDR + (platz - 1) * OSZ_EINTRAG);

/** Den Eintrag eines Platzes (1-basiert) aus dem Abbild. */
export function liesOsz(fw: Uint8Array, platz: number): Uint8Array {
  if (platz < 1 || platz > OSZ_MAX) throw new Error(`Platz ${platz} ausserhalb 1…${OSZ_MAX}`);
  const off = oszOffset(platz);
  return fw.slice(off, off + OSZ_EINTRAG);
}

/** Beschreiber lesen: Zeiger, Bytes, Anzahl — beide Kopien muessen passen. */
export function leseOszStandAusFirmware(fw: Uint8Array): OszStand {
  if (fw.length !== VSB_GROESSE) return { ok: false, reason: `${fw.length} Bytes — eine SYSTEM.VSB hat ${VSB_GROESSE}` };
  const zellen = OSZ_ZAEHLER.map((z) => ({ addr: z.addr, wert: u32(fw, dateiOffset(z.addr)) }));
  const zeiger = OSZ_ZEIGER_ADDRS.map((a) => u32(fw, dateiOffset(a)));
  return leseOszStand(zellen, zeiger);
}

/** Alle Plaetze 1…OSZ_MAX als Bytes — leer heisst 0xFF×32. */
export function liesOszTabelle(fw: Uint8Array): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let p = 1; p <= OSZ_MAX; p++) out.push(liesOsz(fw, p));
  return out;
}

export interface OszEintragMitPlatz {
  platz: number;
  bytes: Uint8Array;
}

export type OszBauErgebnis =
  | { ok: true; bytes: Uint8Array; anzahlVorher: number; anzahlNachher: number; geschrieben: number[] }
  | { ok: false; reason: string };

/**
 * Eintraege in die Tabelle schreiben und die Beschreiber nachziehen: die
 * Anzahl folgt dem hoechsten belegten Platz (erweitern nur ohne Luecke,
 * kuerzen, wenn oben geleert wurde). Leere Bytes (0xFF×32) leeren den Platz.
 */
export function setzeOszTabelle(fw: Uint8Array, eintraege: readonly OszEintragMitPlatz[]): OszBauErgebnis {
  const stand = leseOszStandAusFirmware(fw);
  if (!stand.ok) return { ok: false, reason: `Oszillator-Tabelle: ${stand.reason}` };
  const out = fw.slice();
  const geschrieben: number[] = [];
  for (const e of eintraege) {
    if (e.platz < 1 || e.platz > OSZ_MAX) return { ok: false, reason: `Oszillator-Platz ${e.platz} ausserhalb 1…${OSZ_MAX}` };
    if (e.bytes.length !== OSZ_EINTRAG) return { ok: false, reason: `Platz ${e.platz}: ${e.bytes.length} Bytes, erwartet ${OSZ_EINTRAG}` };
    if (!istOszLeer(e.bytes)) {
      try {
        decodeOsz(e.bytes);
      } catch (err) {
        return { ok: false, reason: `Platz ${e.platz}: ${err instanceof Error ? err.message : String(err)}` };
      }
      if (!e.bytes[0]) return { ok: false, reason: `Platz ${e.platz}: Eintrag ohne Namen` };
    }
    out.set(e.bytes, oszOffset(e.platz));
    geschrieben.push(e.platz);
  }
  const belegt = (p: number): boolean => !istOszLeer(liesOsz(out, p));
  let hoechster = 0;
  for (let p = OSZ_MAX; p >= 1; p--) {
    if (belegt(p)) {
      hoechster = p;
      break;
    }
  }
  const ziel = Math.max(1, hoechster);
  if (ziel !== stand.anzahl) {
    const plan = planeOszErweiterung(Math.min(stand.anzahl, ziel), ziel, belegt);
    if (!plan.ok) return { ok: false, reason: `Oszillator-Tabelle: ${plan.reason}` };
    for (const z of plan.schreiben) setU32(out, dateiOffset(z.addr), z.wert);
  } else {
    // Auch ohne Aenderung der Anzahl: die Liste darf keine Luecke haben
    for (let p = 1; p <= ziel; p++) if (!belegt(p)) return { ok: false, reason: `Oszillator-Tabelle: Platz ${p} ist leer — Lücke vor Platz ${ziel}` };
  }
  return { ok: true, bytes: out, anzahlVorher: stand.anzahl, anzahlNachher: ziel, geschrieben };
}

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
 *     Code-Diff gibt es kein 72 → 96. Die vier Funktionen mit `cmp #71`
 *     (0xC0098D14, 0xC00994DC, 0xC00995D0, 0xC0099614) bedienen ein Feld je
 *     Part von 72 × 2 Bytes (0xC0099458 kopiert beim Start +0x16/+0x17 jedes
 *     Typs hinein: die Regler-Vorgaben Speed/Depth je Typ, Stride 0x90) —
 *     Typen ab 73 bekommen dort keinen Platz, ihre Reglerwerte werden also
 *     nicht je Typ gemerkt. Hacktribes Sinus-Typen laufen trotzdem; ein 97.
 *     Eintrag wuerde es genauso. Ob das MENUE ihn zeigt, entscheidet nur der
 *     Versuch am Geraet („fluechtig").
 *   - ⚠ Gemessen (2026-09-04, Edit-Buffer-Roundtrip per SysEx): ein Pattern
 *     mit Mod-Typ 71 kommt mit 71 zurueck, mit 72, 80, 95, 96, 131, 200, 255
 *     jeweils mit 0. Das Geraet setzt beim Laden ueber SysEx ALLES ab Typ 73
 *     (Anzeige) auf 1 zurueck — auch Hacktribes Sinus-Typen. Eigene Typen
 *     (und Hacktribes) lassen sich also nur am Geraet per Regler setzen; ob
 *     der SD-Pattern-Import denselben Lader nimmt, ist offen. Wer
 *     zurueckstellt (Befund 2026-09-04): die Grenze 72 steckt nicht in EINER
 *     Tabelle, sondern in ~15 `cmp #71`-Stellen (0xC000B6B0, 0xC000C380,
 *     0xC000C52C/5A0/620, 0xC00402F8, 0xC0048E80, 0xC0049BA0, 0xC004A0D8,
 *     0xC0098D14, 0xC00994DC, 0xC0099558/584, 0xC00995D0, 0xC0099614,
 *     0xC00A1954/19E4) plus `cmp #72` bei 0xC0072068 — der Pattern-Lader
 *     (Schleife ueber 16 Parts bei 0xC004AA34) holt den Typ ueber den Getter
 *     0xC0048E70, der ihn bei > 71 auf 0 setzt, und schreibt ihn so zurueck.
 *     Dazu zwei Felder je Part von 72 × 2 Bytes (Basis 0xC06924DD/0xC069256D,
 *     Stride 0x90). Mehr als 72 Typen richtig freizuschalten heisst: alle
 *     Stellen auf N setzen, die Felder auf 16 × 2N Bytes verlegen (frei waere
 *     0xC01A3000+), Init-Kopierer 0xC0099458 anpassen — umgesetzt am
 *     2026-09-04 in `setzeModGrenze` (unten), Feld jetzt bei 0xC01B0000.
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
  /** Grenze im Code nachgezogen (null: reichte schon). */
  grenze: ModGrenzeBefund | null;
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
  // Die Grenze 72 im Code muss die Tabelle abdecken — sonst setzt das Geraet
  // jeden Typ darueber beim Laden auf 1 zurueck (Befund 2026-09-04).
  const g = addr === MOD_TABELLE_ADDR_HACKTRIBE && erwartet > 72 ? setzeModGrenze(out, erwartet - 1) : { ok: true as const, befund: null };
  if (!g.ok) return { ok: false, reason: g.reason };
  return { ok: true, bytes: out, anzahlVorher: vorhanden, anzahlNachher: erwartet, grenze: g.befund };
}

// ─── Die Grenze 72 der Modulationstypen im Code ─────────────────────────────
//
// Befund 2026-09-04 (Disassembly ALLES2 = Hacktribe = Stock an allen Stellen):
// die Grenze steckt in neun `cmp rX, #71`, fuenf `mov rX, #72` (Typen je
// Part), vier `#144` (Bytes je Part) und sieben Literal-Pools mit der Basis
// eines Feldes von 16 Parts × 72 × 2 Bytes (Speed/Depth-Vorgabe je Typ,
// 0xC069256D im BSS). Die uebrigen `cmp #0x47` der Nacht-Liste (0xC000B6B0,
// 0xC000C380, 0xC000C52C/5A0/620, 0xC00402F8, 0xC0072068, 0xC00A1954/19E4)
// sind Zeichenvergleiche (Buchstabe G) und Parameter-Schalter — keine Typgrenze.
// 0xC06924DD ist KEIN Typfeld, sondern 16 × 9 Bytes Rechenwerte je Part.
// ⚠ Wo das Menue seine Obergrenze hernimmt, ist weiterhin offen — SysEx und
// Pattern-Datei halten Typen ueber 72 mit diesem Patch, der Regler vielleicht nicht.

/** Ein Wort im Code: Adresse und was dort in Hacktribe (und Stock) steht. */
export interface ModGrenzeStelle {
  addr: number;
  wort: number;
}

/** `cmp rX, #71` — Typen ueber 71 werden auf 0 gesetzt oder abgewiesen. */
export const MOD_GRENZE_VERGLEICHE: readonly ModGrenzeStelle[] = [
  { addr: 0xc0048e80, wort: 0xe3500047 }, // Getter: Typ aus dem Part-Block (+0x814), movhi r0,#0
  { addr: 0xc0049ba0, wort: 0xe3520047 }, // Setter: movhi r5,#0 vor dem strb
  { addr: 0xc004a0d8, wort: 0xe3520047 }, // Pattern-Lader: Typ aus der Datei vor dem Setter
  { addr: 0xc0098d14, wort: 0xe3500047 }, // Zeiger auf den Tabelleneintrag: Typ > 71 → Eintrag 0
  { addr: 0xc00994dc, wort: 0xe3550047 }, // Speed/Depth je (Part, Typ) setzen
  { addr: 0xc0099558, wort: 0xd3510047 }, // Speed lesen (cmple)
  { addr: 0xc0099584, wort: 0xd3510047 }, // Depth lesen (cmple)
  { addr: 0xc00995d0, wort: 0xe3530047 }, // Depth aus dem Part merken
  { addr: 0xc0099614, wort: 0xe3530047 }, // Speed aus dem Part merken
];
/** `mov rX, #72` — Typen je Part im Feld (Schrittweite der mla). */
export const MOD_GRENZE_SCHRITTE: readonly ModGrenzeStelle[] = [
  { addr: 0xc00994e4, wort: 0xe3a03048 },
  { addr: 0xc0099564, wort: 0xd3a03048 },
  { addr: 0xc0099590, wort: 0xd3a03048 },
  { addr: 0xc00995d4, wort: 0xe3a02048 },
  { addr: 0xc0099604, wort: 0xe3a01048 },
];
/** `#144` — Bytes je Part im Feld (72 × 2): Init-Kopierer und Part-Kopie. */
export const MOD_GRENZE_BLOECKE: readonly ModGrenzeStelle[] = [
  { addr: 0xc0099460, wort: 0xe3a01090 },
  { addr: 0xc0099480, wort: 0xe3520090 },
  { addr: 0xc0099520, wort: 0xe3a02090 },
  { addr: 0xc0099544, wort: 0xe3540090 },
];
/** Literal-Pools mit der Basis des Feldes. */
export const MOD_FELD_ZEIGER: readonly number[] = [0xc0099494, 0xc0099500, 0xc0099550, 0xc009957c, 0xc00995ac, 0xc00995ec, 0xc0099630];
export const MOD_FELD_BASIS_STOCK = 0xc069256d;
/** Neue Basis im freien 0xFF-Bereich hinter der Tabelle (MOD_MAX endet bei 0xC01AFEB8, Abbild bei 0xC0200000). */
export const MOD_FELD_BASIS_NEU = 0xc01b0000;
export const MOD_FELD_PARTS = 16;
/** Ein Typ ist ein Byte im Part-Block — mehr geht nicht. */
export const MOD_TYPEN_MAX = 256;

const u32 = (b: Uint8Array, off: number): number => (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
const setU32 = (b: Uint8Array, off: number, w: number): void => {
  b[off] = w & 0xff;
  b[off + 1] = (w >>> 8) & 0xff;
  b[off + 2] = (w >>> 16) & 0xff;
  b[off + 3] = (w >>> 24) & 0xff;
};

/** ARM-Immediate (imm8 ror 2·rot) exakt kodieren — null, wenn es die Zahl nicht gibt. */
export function armImmediateKodieren(v: number): number | null {
  v >>>= 0;
  for (let rot = 0; rot < 16; rot++) {
    const s = rot * 2;
    const imm = s === 0 ? v : ((v << s) | (v >>> (32 - s))) >>> 0;
    if (imm <= 0xff) return (rot << 8) | imm;
  }
  return null;
}

/** Immediate eines Datenverarbeitungs-Worts (cmp/mov/… rX, #imm) — null, wenn es keins ist. */
export function armImmediateWert(wort: number): number | null {
  if (((wort >>> 25) & 7) !== 1) return null;
  const imm = wort & 0xff;
  const rot = ((wort >>> 8) & 0xf) * 2;
  return rot === 0 ? imm : ((imm >>> rot) | (imm << (32 - rot))) >>> 0;
}

const mitImmediate = (wort: number, kodiert: number): number => ((wort & 0xfffff000) | kodiert) >>> 0;

/** Kleinstes N ≥ maxIndex+1 (mindestens 72), bei dem N−1, N und 2N als Immediate kodierbar sind. */
export function modGrenzeWert(maxIndex: number): { n: number; vergleich: number; schritt: number; block: number } | null {
  for (let n = Math.max(72, maxIndex + 1); n <= MOD_TYPEN_MAX; n++) {
    const a = armImmediateKodieren(n - 1);
    const b = armImmediateKodieren(n);
    const c = armImmediateKodieren(2 * n);
    if (a !== null && b !== null && c !== null) return { n, vergleich: a, schritt: b, block: c };
  }
  return null;
}

export interface ModGrenzeStand {
  /** Hoechster erlaubter 0-basierter Typ (Stock/Hacktribe: 71). */
  maxIndex: number;
  feldBasis: number;
}

/** Die Grenze aus dem Abbild lesen — alle 25 Stellen muessen zusammenpassen. */
export function liesModGrenze(fw: Uint8Array): { ok: true; stand: ModGrenzeStand } | { ok: false; reason: string } {
  const lies = (stellen: readonly ModGrenzeStelle[], was: string): number | { reason: string } => {
    const werte: number[] = [];
    for (const s of stellen) {
      const w = u32(fw, dateiOffset(s.addr));
      const v = armImmediateWert(w);
      if (v === null || (w & 0xfffff000) >>> 0 !== (s.wort & 0xfffff000) >>> 0) return { reason: `Mod-Grenze: bei ${s.addr.toString(16)} steht nicht das erwartete ${was} — fremde Firmware?` };
      werte.push(v);
    }
    if (new Set(werte).size !== 1) return { reason: `Mod-Grenze: die ${was}-Stellen sind uneinheitlich (${werte.join(", ")})` };
    return werte[0];
  };
  const v = lies(MOD_GRENZE_VERGLEICHE, "cmp");
  if (typeof v !== "number") return { ok: false, reason: v.reason };
  const s = lies(MOD_GRENZE_SCHRITTE, "mov");
  if (typeof s !== "number") return { ok: false, reason: s.reason };
  const b = lies(MOD_GRENZE_BLOECKE, "Blockmass");
  if (typeof b !== "number") return { ok: false, reason: b.reason };
  if (s !== v + 1 || b !== 2 * s) return { ok: false, reason: `Mod-Grenze: cmp ${v}, Schritt ${s}, Block ${b} passen nicht zusammen` };
  const zeiger = MOD_FELD_ZEIGER.map((a) => u32(fw, dateiOffset(a)));
  if (new Set(zeiger).size !== 1) return { ok: false, reason: `Mod-Grenze: die Feld-Zeiger sind uneinheitlich (${zeiger.map((z) => z.toString(16)).join(", ")})` };
  if (zeiger[0] !== MOD_FELD_BASIS_STOCK && zeiger[0] !== MOD_FELD_BASIS_NEU) return { ok: false, reason: `Mod-Grenze: Feld-Basis ${zeiger[0].toString(16)} ist weder Stock noch TekkForge` };
  return { ok: true, stand: { maxIndex: v, feldBasis: zeiger[0] } };
}

/** Inhalt des Feldes: je Part die Regler-Vorgaben (+0x16 Speed, +0x17 Depth) jedes Typs — so, wie es der Init-Kopierer fuellt. */
export function modFeldInhalt(tabelle: readonly Uint8Array[], n: number): Uint8Array {
  const part = new Uint8Array(2 * n);
  for (let i = 0; i < n && i < tabelle.length; i++) {
    part[2 * i] = tabelle[i][0x16];
    part[2 * i + 1] = tabelle[i][0x17];
  }
  const out = new Uint8Array(MOD_FELD_PARTS * 2 * n);
  for (let p = 0; p < MOD_FELD_PARTS; p++) out.set(part, p * 2 * n);
  return out;
}

export interface ModGrenzeSchreibliste {
  /** Code-Woerter und Zeiger (4 Bytes je Eintrag). */
  woerter: { addr: number; wert: number }[];
  /** Das verlegte Feld — null, wenn nichts zu tun ist. */
  feld: { addr: number; bytes: Uint8Array } | null;
  nachher: number;
}

/** Was zu schreiben ist, damit Index `maxIndex` gilt — leer, wenn die Grenze schon reicht. */
export function modGrenzeSchreibliste(stand: ModGrenzeStand, maxIndex: number, tabelle: readonly Uint8Array[]): ModGrenzeSchreibliste | { ok: false; reason: string } {
  if (stand.maxIndex >= maxIndex) return { woerter: [], feld: null, nachher: stand.maxIndex };
  const g = modGrenzeWert(maxIndex);
  if (!g) return { ok: false, reason: `Mod-Grenze: fuer Typ ${maxIndex + 1} gibt es keine kodierbare Grenze unter ${MOD_TYPEN_MAX}` };
  const bytes = MOD_FELD_PARTS * 2 * g.n;
  if (MOD_FELD_BASIS_NEU + bytes > 0xc0200000) return { ok: false, reason: `Mod-Grenze: das Feld fuer ${g.n} Typen passt nicht mehr ins Abbild` };
  const woerter: { addr: number; wert: number }[] = [];
  for (const s of MOD_GRENZE_VERGLEICHE) woerter.push({ addr: s.addr, wert: mitImmediate(s.wort, g.vergleich) });
  for (const s of MOD_GRENZE_SCHRITTE) woerter.push({ addr: s.addr, wert: mitImmediate(s.wort, g.schritt) });
  for (const s of MOD_GRENZE_BLOECKE) woerter.push({ addr: s.addr, wert: mitImmediate(s.wort, g.block) });
  for (const a of MOD_FELD_ZEIGER) woerter.push({ addr: a, wert: MOD_FELD_BASIS_NEU });
  return { woerter, feld: { addr: MOD_FELD_BASIS_NEU, bytes: modFeldInhalt(tabelle, g.n) }, nachher: g.n - 1 };
}

export interface ModGrenzeBefund {
  vorher: number;
  nachher: number;
  feldBasis: number;
  feldBytes: number;
}

/**
 * Die Grenze im Abbild so setzen, dass Typ-Index `maxIndex` noch gilt: alle
 * Vergleiche, Schrittweiten und Blockmasse nachziehen, das Feld je Part in
 * den freien Bereich verlegen und mit den Tabellen-Vorgaben fuellen.
 * Unveraendert, wenn die vorhandene Grenze schon reicht.
 */
export function setzeModGrenze(fw: Uint8Array, maxIndex: number): { ok: true; befund: ModGrenzeBefund | null } | { ok: false; reason: string } {
  const st = liesModGrenze(fw);
  if (!st.ok) return st;
  const l = modGrenzeSchreibliste(st.stand, maxIndex, liesModTabelle(fw));
  if ("ok" in l) return l;
  if (!l.woerter.length) return { ok: true, befund: null };
  if (l.feld && st.stand.feldBasis !== MOD_FELD_BASIS_NEU) {
    const off = dateiOffset(l.feld.addr);
    for (let i = 0; i < l.feld.bytes.length; i++) if (fw[off + i] !== 0xff) return { ok: false, reason: `Mod-Grenze: der Bereich ${l.feld.addr.toString(16)} fuer das Feld ist nicht frei` };
  }
  for (const w of l.woerter) setU32(fw, dateiOffset(w.addr), w.wert);
  if (l.feld) fw.set(l.feld.bytes, dateiOffset(l.feld.addr));
  return { ok: true, befund: { vorher: st.stand.maxIndex, nachher: l.nachher, feldBasis: MOD_FELD_BASIS_NEU, feldBytes: l.feld ? l.feld.bytes.length : 0 } };
}

/**
 * dspPatch — gleichlange Aenderungen im eingebetteten BF523-DSP-Abbild.
 *
 * Die Klangerzeugung der Electribe laeuft nicht auf dem ARM, sondern auf
 * einem ADSP-BF523. Sein Code wird beim Start vom ARM ueber SPI eingespielt —
 * und dieses Abbild liegt als ADI-LDR-Bootstrom **in der SYSTEM.VSB**:
 * 157 Bloecke ab Payload-Offset 0xF9E10 (Datei 0xF9F10), 113 davon fuer das
 * SDRAM (der Grossteil der Engine), 44 fuer das L1. Omnitribe hat das am
 * Geraet bewiesen (`docs/reverse/am1802_bf523_ldr_feed_v202.md`): der ARM
 * streamt das Abbild als dumme Byte-Pipe, ohne Pruefsumme; nur die
 * 16-Byte-Blockkoepfe tragen eine XOR-Pruefziffer, die den Kopf allein
 * abdeckt. Eine Aenderung gleicher Laenge innerhalb eines Datenblocks laesst
 * also jeden Kopf gueltig — und wirkt hoerbar (ein genullter Block toetete die
 * Sample-Wiedergabe, Stock stellte sie wieder her).
 *
 * Was hier NICHT geht: Bloecke verlaengern, Code umbauen, Samples tauschen.
 * Was geht: Datentabellen und Konstanten byteweise ersetzen — Wellentabellen,
 * Kurven, Parametertabellen. Jeder Patch nennt die alten Bytes; sie werden
 * als Fingerabdruck gesucht und muessen genau einmal vorkommen, sonst wird
 * nichts angefasst. Nach dem Anwenden wird die ganze Kette neu geprueft.
 *
 * ⚠ Alles Experiment: welche Tabelle was tut, ist nur teilweise sicher. Das
 * Register (`dspPatchRegister.ts`) fuehrt je Patch, was Omnitribe dazu weiss.
 */
export interface LdrBlock {
  /** Datei-Offset des 16-Byte-Kopfs in der VSB. */
  kopf: number;
  /** Datei-Offset des ersten Nutzbytes (kopf + 16). */
  daten: number;
  ziel: number;
  laenge: number;
  flags: number;
  /** Fuell-Block ohne Nutzdaten (Nullen), kein Datenblock. */
  fuellung: boolean;
  letzter: boolean;
}

export type LdrKette = { ok: true; bloecke: LdrBlock[]; ende: number } | { ok: false; reason: string; bloecke: LdrBlock[] };

/** Start des Bootstroms in der Datei (Payload 0xF9E10 + 0x100 Header). */
export const LDR_START = 0xf9f10;
const HDRSGN = 0xad;

function u32(b: Uint8Array, off: number): number {
  return (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
}

/** Die LDR-Kette lesen und jeden Kopf pruefen (Signatur 0xAD, XOR aller 16 Bytes = 0). */
export function leseLdrKette(fw: Uint8Array, start = LDR_START): LdrKette {
  const bloecke: LdrBlock[] = [];
  let off = start;
  for (let n = 0; n < 4096; n++) {
    if (off + 16 > fw.length) return { ok: false, reason: `Kette läuft über das Dateiende (Block ${n})`, bloecke };
    let x = 0;
    for (let i = 0; i < 16; i++) x ^= fw[off + i];
    const code = u32(fw, off);
    if (code >>> 24 !== HDRSGN || x !== 0) {
      return { ok: false, reason: `Block ${n} bei 0x${off.toString(16).toUpperCase()}: Kopf ungültig (Signatur 0x${(code >>> 24).toString(16)}, XOR ${x})`, bloecke };
    }
    const flags = code & 0xffff;
    const ziel = u32(fw, off + 4);
    const laenge = u32(fw, off + 8);
    const fuellung = (flags & 0x0100) !== 0;
    const block: LdrBlock = { kopf: off, daten: off + 16, ziel, laenge, flags, fuellung, letzter: (flags & 0x8000) !== 0 };
    bloecke.push(block);
    off += 16 + (fuellung ? 0 : laenge);
    if (block.letzter) return { ok: true, bloecke, ende: off };
  }
  return { ok: false, reason: "Kette ohne Ende-Block", bloecke };
}

/** Datei-Offset zu einer DSP-Adresse (L1 0xFF8xxxxx… oder SDRAM), wenn sie in einem Datenblock liegt. */
export function vaddrZuDatei(kette: LdrBlock[], vaddr: number, laenge = 1): number | null {
  for (const b of kette) {
    if (b.fuellung) continue;
    if (vaddr >= b.ziel && vaddr + laenge <= b.ziel + b.laenge) return b.daten + (vaddr - b.ziel);
  }
  return null;
}

export interface DspEdit {
  /** DSP-Adresse, wenn bekannt — sonst wird nur der Fingerabdruck gesucht. */
  vaddr?: number;
  alt: Uint8Array;
  neu: Uint8Array;
}

export interface DspPatch {
  id: string;
  titel: string;
  beschreibung: string;
  edits: DspEdit[];
  /** Woher der Patch stammt (Repo/Doku). */
  quelle: string;
  /** Was ueber die Wirkung bekannt ist — ehrlich, nicht werbend. */
  status: "hoerprobe-offen" | "am-geraet-gehoert" | "diskriminator";
}

export type DspErgebnis =
  | { ok: true; bytes: Uint8Array; stellen: { vaddr?: number; offset: number; bytes: number }[] }
  | { ok: false; reason: string };

const hex = (n: number): string => `0x${n.toString(16).toUpperCase()}`;

function gleich(fw: Uint8Array, off: number, b: Uint8Array): boolean {
  for (let i = 0; i < b.length; i++) if (fw[off + i] !== b[i]) return false;
  return true;
}

/** Alle Vorkommen eines Byte-Musters in der Datei. */
export function sucheMuster(fw: Uint8Array, muster: Uint8Array, von = 0, bis = fw.length): number[] {
  const out: number[] = [];
  if (!muster.length) return out;
  const erstes = muster[0];
  for (let i = von; i <= bis - muster.length; i++) {
    if (fw[i] !== erstes) continue;
    let k = 1;
    while (k < muster.length && fw[i + k] === muster[k]) k++;
    if (k === muster.length) out.push(i);
  }
  return out;
}

/**
 * Einen Patch anwenden. Jede Aenderung muss gleich lang sein, innerhalb eines
 * Datenblocks der Kette liegen. Bei bekannter DSP-Adresse muessen die alten
 * Bytes genau dort stehen; ohne Adresse muessen sie in der Kette genau einmal
 * vorkommen (4-Byte-Konstanten stehen sonst zigmal).
 * Danach wird die Kette erneut gelesen; ist sie nicht mehr gueltig, gibt es
 * kein Ergebnis.
 */
export function wendeDspPatchAn(fw: Uint8Array, patch: DspPatch): DspErgebnis {
  const kette = leseLdrKette(fw);
  if (!kette.ok) return { ok: false, reason: `DSP-Kette unlesbar: ${kette.reason}` };
  const out = fw.slice();
  const stellen: { vaddr?: number; offset: number; bytes: number }[] = [];
  for (const [i, e] of patch.edits.entries()) {
    if (e.alt.length !== e.neu.length) return { ok: false, reason: `${patch.titel}, Änderung ${i + 1}: ${e.alt.length} alte gegen ${e.neu.length} neue Bytes — nur gleiche Länge` };
    if (!e.alt.length) return { ok: false, reason: `${patch.titel}, Änderung ${i + 1}: leer` };
    // Bekannte DSP-Adresse: sie ist der Schluessel, die alten Bytes dort die Probe.
    // Ohne Adresse muessen die alten Bytes in der Kette genau einmal vorkommen.
    let offset: number;
    const soll = e.vaddr !== undefined ? vaddrZuDatei(kette.bloecke, e.vaddr, e.alt.length) : null;
    if (soll !== null) {
      if (!gleich(fw, soll, e.alt)) {
        const schon = gleich(fw, soll, e.neu);
        return { ok: false, reason: `${patch.titel}, Änderung ${i + 1}: an DSP-Adresse ${hex(e.vaddr!)} stehen ${schon ? "schon die neuen" : "andere"} Bytes — ${schon ? "bereits gepatcht" : "andere Firmware"}` };
      }
      offset = soll;
    } else {
      const funde = sucheMuster(fw, e.alt, LDR_START, kette.ende);
      if (funde.length === 0) return { ok: false, reason: `${patch.titel}, Änderung ${i + 1}: die alten Bytes stehen nicht in der DSP-Kette — andere Firmware oder schon gepatcht` };
      if (funde.length > 1) return { ok: false, reason: `${patch.titel}, Änderung ${i + 1}: die alten Bytes kommen ${funde.length}-mal vor — kein eindeutiger Fingerabdruck` };
      offset = funde[0];
    }
    const block = kette.bloecke.find((b) => !b.fuellung && offset >= b.daten && offset + e.alt.length <= b.daten + b.laenge);
    if (!block) return { ok: false, reason: `${patch.titel}, Änderung ${i + 1}: liegt nicht vollständig in einem Datenblock` };
    out.set(e.neu, offset);
    stellen.push({ vaddr: e.vaddr, offset, bytes: e.neu.length });
  }
  const danach = leseLdrKette(out);
  if (!danach.ok || danach.bloecke.length !== kette.bloecke.length) return { ok: false, reason: `Nach dem Patch ist die DSP-Kette nicht mehr gültig${danach.ok ? "" : `: ${danach.reason}`}` };
  return { ok: true, bytes: out, stellen };
}

/**
 * Ist ein Patch schon drin? Bei bekannter DSP-Adresse entscheidet der Inhalt
 * an genau dieser Stelle; sonst gilt: alte Bytes genau einmal → original,
 * neue Bytes irgendwo → gepatcht (schwaecher, weil z. B. Nullen ueberall stehen).
 */
export function dspPatchStand(fw: Uint8Array, patch: DspPatch): "original" | "gepatcht" | "unbekannt" {
  const kette = leseLdrKette(fw);
  const ende = kette.ok ? kette.ende : fw.length;
  let alt = 0;
  let neu = 0;
  for (const e of patch.edits) {
    const soll = e.vaddr !== undefined ? vaddrZuDatei(kette.bloecke, e.vaddr, e.alt.length) : null;
    if (soll !== null) {
      if (gleich(fw, soll, e.alt)) alt++;
      else if (gleich(fw, soll, e.neu)) neu++;
      continue;
    }
    if (sucheMuster(fw, e.alt, LDR_START, ende).length === 1) alt++;
    else if (sucheMuster(fw, e.neu, LDR_START, ende).length >= 1) neu++;
  }
  if (alt === patch.edits.length) return "original";
  if (neu === patch.edits.length) return "gepatcht";
  return "unbekannt";
}

export function hexZuBytes(h: string): Uint8Array {
  const s = h.replace(/[^0-9a-fA-F]/g, "");
  if (s.length % 2) throw new Error("ungerade Hex-Länge");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** Bytes als Hex-Text (fuer Bauplaene und Patch-Dateien). */
export function bytesZuHex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** Einen Patch als schlichtes JSON-Objekt — Gegenstueck zu dspPatchAusObjekt. */
export function dspPatchZuObjekt(p: DspPatch): Record<string, unknown> {
  return {
    id: p.id,
    titel: p.titel,
    beschreibung: p.beschreibung,
    quelle: p.quelle,
    status: p.status,
    edits: p.edits.map((e) => ({ ...(e.vaddr !== undefined ? { vaddr: hex(e.vaddr) } : {}), old: bytesZuHex(e.alt), new: bytesZuHex(e.neu) })),
  };
}

const STATUS: DspPatch["status"][] = ["hoerprobe-offen", "am-geraet-gehoert", "diskriminator"];

/**
 * Einen Patch aus JSON-Daten lesen: entweder eine Liste von {vaddr?, old, new, label?}
 * (Omnitribes Form) oder ein Objekt mit `edits` und optional id/titel/beschreibung/status.
 */
export function dspPatchAusObjekt(roh: unknown, id = "eigen"): DspPatch {
  const liste = Array.isArray(roh) ? roh : ((roh as Record<string, unknown> | null)?.edits as unknown[]);
  if (!Array.isArray(liste) || !liste.length) throw new Error("Die Patch-Datei enthält keine Änderungen (Liste von {vaddr, old, new}).");
  const edits: DspEdit[] = liste.map((x, i) => {
    const o = (typeof x === "object" && x ? x : {}) as Record<string, unknown>;
    if (typeof o.old !== "string" || typeof o.new !== "string") throw new Error(`Änderung ${i + 1}: old/new fehlen`);
    const alt = hexZuBytes(o.old);
    const neu = hexZuBytes(o.new);
    if (alt.length !== neu.length) throw new Error(`Änderung ${i + 1}: ${alt.length} alte gegen ${neu.length} neue Bytes`);
    if (!alt.length) throw new Error(`Änderung ${i + 1}: leer`);
    const vaddr = typeof o.vaddr === "string" ? Number(o.vaddr) : typeof o.vaddr === "number" ? o.vaddr : undefined;
    return { ...(vaddr !== undefined && Number.isFinite(vaddr) ? { vaddr } : {}), alt, neu };
  });
  const kopf = Array.isArray(roh) ? {} : (roh as Record<string, unknown>);
  const status = STATUS.includes(kopf.status as DspPatch["status"]) ? (kopf.status as DspPatch["status"]) : "hoerprobe-offen";
  return {
    id: String(kopf.id ?? id),
    titel: String(kopf.name ?? kopf.titel ?? kopf.id ?? id),
    beschreibung: String(kopf.desc ?? kopf.beschreibung ?? (liste[0] as Record<string, unknown>)?.label ?? ""),
    edits,
    quelle: String(kopf.quelle ?? "Datei"),
    status,
  };
}

/** Eine Patch-Datei (JSON-Text) lesen — siehe dspPatchAusObjekt. */
export function leseDspPatchDatei(text: string, id = "eigen"): DspPatch {
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    throw new Error("Keine lesbare Patch-Datei (kein JSON).");
  }
  return dspPatchAusObjekt(roh, id);
}

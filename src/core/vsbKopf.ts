/**
 * vsbKopf — der 0x100-Byte-Kopf der Korg-Update-Dateien (SYSTEM/BOOT/PCM/USER/SLICE.VSB),
 * so wie die Firmware ihn beim SD-Update PRÜFT — nicht, wie er aussieht.
 *
 * Quelle: Dekompilate der Sampler-/Hacktribe-Firmware (Ghidra-Projekt von vanasoft23,
 * `Omnitribe/docs/reverse/vendor/electribe2-re/ghidra-export/HACKTRIBE_decomp.txt`):
 *   ValidateVsbResourceHeaderMagic  0xC00367C4  memcmp(+0x00, "KORG SYSTEM FILE", 16)
 *   ValidateVsbResourceHeaderType   0xC00367E8  +0x2C == 0, +0x2D == 1, +0x2E: Modus 0 → genau die
 *                                               eigene Variante (0x24 im Sampler-Abbild),
 *                                               Modus 1 (nur BOOT) → 0x23 oder 0x24
 *   GetVsbPayloadLength             0xC0036898  u32 little-endian bei +0x3C
 *   GetVsbHeaderProductIdentity     0xC0036854  (+0x2C<<16)|(+0x2D<<8)|+0x2E  → 0x000123 / 0x000124
 *   IsCpuResourceRevisionAtLeast    0xC0036790  (+0x2A, +0x2B) lexikographisch, vorzeichenbehaftet
 *   Load*VsbToSerialFlash           Name bei +0x20 (SYSTEM 6, BOOT 4, PCM 3, USER 4, SLIC 4 Zeichen),
 *                                   Längenregel je Region (siehe REGION_SPANNE)
 *   Selektor → Flash-Offset         MapSerialFlashRegionIndex 0xC0029C14: s << 16
 *
 * Nicht geprüft werden vom Gerät: das Kürzel bei +0x10 („E2S“/„E2“), die Bytes ab +0x30 außer
 * +0x3C..+0x3F, die 0xFF-Füllung. `crossgrade.ts` setzt +0x12 trotzdem mit um, weil vanasofts
 * Bootloader (`boot_image.c`) auf „KORG SYSTEM FILEE2“ klassifiziert.
 */
import { VARIANTEN, type Variante } from "./crossgrade";

export const VSB_KOPF = 0x100;
export const VSB_MAGIC = "KORG SYSTEM FILE";

export type VsbArt = "SYSTEM" | "BOOT" | "PCM" | "USER" | "SLICE";
export const VSB_ARTEN: readonly VsbArt[] = ["SYSTEM", "BOOT", "PCM", "USER", "SLICE"];

/** Wie viele Zeichen des Namens die Firmware vergleicht. */
export const NAME_VERGLEICH: Record<VsbArt, number> = { SYSTEM: 6, BOOT: 4, PCM: 3, USER: 4, SLICE: 4 };

/** Längenregel je Region: `genau` wird verlangt, `max` klemmt die Nutzlast (USER/SLICE). */
export const REGION_SPANNE: Record<VsbArt, { genau?: number; max?: number }> = {
  BOOT: { genau: 0x20000 },
  SYSTEM: { genau: 0x200000 },
  PCM: { genau: 0x800000 },
  USER: { max: 0x490000 },
  SLICE: { max: 0x90000 },
};

/** Mindestrevision (Major, Minor) des produktbewussten SYSTEM-Installers (InstallSystemVsbForCurrentProduct 0xC003AC74). */
export const MINDEST_REVISION: Record<Variante, [number, number]> = { sampler: [2, 2], synth: [1, 0x11] };

export interface FlashSelektor {
  selektor: number;
  offset: number;
  groesse: number;
  inhalt: string;
  vsb?: VsbArt;
}

/** Die belegten Regionen des 16-MiB-Flash (Selektor << 16). */
export const FLASH_SELEKTOREN: readonly FlashSelektor[] = [
  { selektor: 0x00, offset: 0x000000, groesse: 0x20000, inhalt: "AIS-Bootskript + SBL (Boot-Sektor)", vsb: "BOOT" },
  { selektor: 0x02, offset: 0x020000, groesse: 0x200000, inhalt: "ARM-Firmware (2 MiB)", vsb: "SYSTEM" },
  { selektor: 0x21, offset: 0x21fff0, groesse: 0x10, inhalt: "Main-Versionsrecord (Bytes +4/+5/+6 = „Main : xx.xx.xx“)" },
  { selektor: 0x22, offset: 0x220000, groesse: 0x490000, inhalt: "User-Region; +4 = elec2USR (Synth) / ele2sUSR (Sampler)", vsb: "USER" },
  { selektor: 0x23, offset: 0x230000, groesse: 0x10000, inhalt: "0x100-Record (GLDE) + e2sallpat-Patternbank ohne Kopf" },
  { selektor: 0x24, offset: 0x240000, groesse: 0x3e8000, inhalt: "Voice-Assignment-Image (250 × 0x4000)" },
  { selektor: 0x63, offset: 0x630000, groesse: 0x10000, inhalt: "0x100-Record (GLDE)" },
  { selektor: 0x64, offset: 0x640000, groesse: 0x110000, inhalt: "SQEZ-Strom (LZ/Huffman-komprimierte Pattern-Tabelle)" },
  { selektor: 0x6b, offset: 0x6b0000, groesse: 0xa0000, inhalt: "persistentes PCM-Katalog-Image (SIST…SIED)" },
  { selektor: 0x75, offset: 0x750000, groesse: 0x90000, inhalt: "Slice-Metadaten (0x444-Byte-Records)", vsb: "SLICE" },
  { selektor: 0x80, offset: 0x800000, groesse: 0x800000, inhalt: "PCM-Image (KORG…elec2PCM / X11100PC)", vsb: "PCM" },
];

export function selektorOffset(selektor: number): number {
  return selektor < 0x100 ? selektor << 16 : 0;
}

export interface VsbKopf {
  magicOk: boolean;
  /** Kürzel bei +0x10, z. B. „E2S“ / „E2“ — vom Gerät nicht geprüft. */
  kuerzel: string;
  /** Name bei +0x20 (bis zum ersten NUL, max. 8). */
  name: string;
  art: VsbArt | null;
  revision: [number, number];
  /** 24-Bit-Identität aus +0x2C..+0x2E (0x000123 Synth, 0x000124 Sampler). */
  identitaet: number;
  /** Nutzlastlänge u32 LE bei +0x3C. */
  laenge: number;
}

function ascii(b: Uint8Array, off: number, max: number): string {
  let s = "";
  for (let i = 0; i < max && off + i < b.length; i++) {
    const c = b[off + i];
    if (c === 0) break;
    s += c >= 0x20 && c < 0x7f ? String.fromCharCode(c) : "?";
  }
  return s;
}

function artAusName(name: string): VsbArt | null {
  for (const art of VSB_ARTEN) if (name.slice(0, NAME_VERGLEICH[art]) === art.slice(0, NAME_VERGLEICH[art]) && name.length >= NAME_VERGLEICH[art]) return art;
  return null;
}

export function liesVsbKopf(bytes: Uint8Array): VsbKopf {
  const at = (i: number): number => (i < bytes.length ? bytes[i] : 0);
  const magicOk = bytes.length >= VSB_KOPF && ascii(bytes, 0, 16) === VSB_MAGIC;
  const name = ascii(bytes, 0x20, 8);
  return {
    magicOk,
    kuerzel: ascii(bytes, 0x10, 8),
    name,
    art: magicOk ? artAusName(name) : null,
    revision: [at(0x2a), at(0x2b)],
    identitaet: (at(0x2c) << 16) | (at(0x2d) << 8) | at(0x2e),
    laenge: (at(0x3c) | (at(0x3d) << 8) | (at(0x3e) << 16) | (at(0x3f) << 24)) >>> 0,
  };
}

export interface VsbPruefung {
  titel: string;
  ok: boolean;
  detail: string;
}

export interface VsbPruefErgebnis {
  art: VsbArt | null;
  kopf: VsbKopf;
  ok: boolean;
  pruefungen: VsbPruefung[];
}

const hex = (n: number): string => `0x${n.toString(16).toUpperCase()}`;

/**
 * Prüft einen Kopf so, wie der Updater der LAUFENDEN Firmware-Variante ihn prüfen würde.
 * Jede rote Zeile ist ein Grund, aus dem das Gerät „Invalid File“ meldet (bzw. Status 0x18).
 */
export function pruefeVsbKopf(bytes: Uint8Array, laufend: Variante): VsbPruefErgebnis {
  const kopf = liesVsbKopf(bytes);
  const p: VsbPruefung[] = [];
  p.push({ titel: "Magic „KORG SYSTEM FILE“", ok: kopf.magicOk, detail: kopf.magicOk ? "vorhanden" : "fehlt — die Firmware liest die Datei gar nicht erst" });
  if (!kopf.magicOk) return { art: null, kopf, ok: false, pruefungen: p };

  const art = kopf.art;
  p.push({
    titel: "Name bei +0x20",
    ok: art !== null,
    detail: art ? `„${kopf.name}“ → ${art} (${NAME_VERGLEICH[art]} Zeichen verglichen)` : `„${kopf.name}“ ist keine der fünf Arten SYSTEM, BOOT, PCM, USER, SLICE`,
  });
  if (!art) return { art: null, kopf, ok: false, pruefungen: p };

  const idLow = kopf.identitaet & 0xff;
  const hi = (kopf.identitaet >> 8) & 0xffff;
  const modus1 = art === "BOOT";
  const eigene = VARIANTEN[laufend].idLow;
  const idOk = hi === 0x0001 && (modus1 ? idLow === 0x23 || idLow === 0x24 : idLow === eigene);
  p.push({
    titel: `Identität +0x2C..+0x2E (${modus1 ? "Modus 1: Synth oder Sampler" : `Modus 0: nur die laufende ${VARIANTEN[laufend].label}`})`,
    ok: idOk,
    detail: idOk
      ? `${hex(kopf.identitaet)} angenommen`
      : hi !== 0x0001
        ? `${hex(kopf.identitaet)} — die Bytes +0x2C/+0x2D müssen 00 01 sein`
        : modus1
          ? `${hex(kopf.identitaet)} — nur 0x000123 oder 0x000124 werden angenommen`
          : `${hex(kopf.identitaet)} — der ${VARIANTEN[laufend].label}-Updater nimmt nur ${hex(0x000100 | eigene)}; sonst „Invalid File“`,
  });

  const spanne = REGION_SPANNE[art];
  if (spanne.genau !== undefined) {
    const ok = kopf.laenge === spanne.genau;
    p.push({ titel: "Länge +0x3C (u32 LE)", ok, detail: ok ? `${hex(kopf.laenge)} = genau ${hex(spanne.genau)}` : `${hex(kopf.laenge)} — verlangt wird genau ${hex(spanne.genau)}` });
  } else {
    const max = spanne.max!;
    p.push({
      titel: "Länge +0x3C (u32 LE)",
      ok: true,
      detail: kopf.laenge > max ? `${hex(kopf.laenge)} > ${hex(max)} — wird auf ${hex(max)} geklemmt (Rest bleibt in der Datei)` : `${hex(kopf.laenge)} ≤ ${hex(max)}`,
    });
  }
  if (bytes.length === VSB_KOPF) {
    p.push({ titel: "Dateigröße", ok: true, detail: "nur der Kopf liegt vor — Nutzlast nicht geprüft" });
  } else if (bytes.length > VSB_KOPF) {
    const nutz = bytes.length - VSB_KOPF;
    const ok = spanne.genau !== undefined ? nutz >= kopf.laenge : nutz >= Math.min(kopf.laenge, spanne.max!);
    p.push({ titel: "Dateigröße", ok, detail: ok ? `${nutz} Bytes Nutzlast nach dem Kopf` : `nur ${nutz} Bytes Nutzlast — kürzer als die Kopfangabe; das Gerät liest dann alte Puffer-Reste mit (Kurz-Lesung wird nicht erkannt)` });
  }

  if (art === "SYSTEM") {
    const [mj, mn] = MINDEST_REVISION[laufend];
    const s8 = (x: number): number => (x << 24) >> 24;
    const [a, b] = kopf.revision;
    const ok = s8(a) > mj || (s8(a) === mj && s8(b) >= mn);
    p.push({
      titel: "Revision +0x2A/+0x2B (produktbewusster Installer)",
      ok,
      detail: ok ? `${a}.${b} ≥ ${mj}.${mn}` : `${a}.${b} < ${mj}.${mn} — der produktbewusste SYSTEM-Installer lehnt ab (die einfache Update-Folge prüft das nicht)`,
    });
  }

  return { art, kopf, ok: p.every((x) => x.ok), pruefungen: p };
}

export interface KopfFelder {
  art: VsbArt;
  laenge: number;
  /** Low-Byte der Identität (0x23 Synth, 0x24 Sampler). */
  idLow: number;
}

/**
 * Baut aus einer Vorlage (irgendein gültiger Korg-Kopf) einen Kopf mit Name, Länge (bei +0x34 UND
 * +0x3C, wie Korgs Dateien es tragen) und Identität. Alles andere bleibt, wie es die Vorlage hat.
 */
export function baueVsbKopf(vorlage: Uint8Array, felder: KopfFelder): Uint8Array {
  const k = new Uint8Array(VSB_KOPF).fill(0xff);
  k.set(vorlage.subarray(0, Math.min(VSB_KOPF, vorlage.length)));
  k.fill(0, 0x20, 0x28);
  for (let i = 0; i < felder.art.length; i++) k[0x20 + i] = felder.art.charCodeAt(i);
  k[0x2c] = 0x00;
  k[0x2d] = 0x01;
  k[0x2e] = felder.idLow & 0xff;
  for (const off of [0x34, 0x3c]) {
    k[off] = felder.laenge & 0xff;
    k[off + 1] = (felder.laenge >>> 8) & 0xff;
    k[off + 2] = (felder.laenge >>> 16) & 0xff;
    k[off + 3] = (felder.laenge >>> 24) & 0xff;
  }
  return k;
}

/**
 * Ein Kopf ohne Vorlage — nach dem Muster der offiziellen v2.02-Dateien (Revision 2.2 Sampler /
 * 1.17 Synth, Kürzel E2S/E2, +0x40 = 02 00, Rest 0xFF).
 */
export function standardKopf(variante: Variante, art: VsbArt, laenge?: number): Uint8Array {
  const k = new Uint8Array(VSB_KOPF).fill(0xff);
  k.fill(0, 0, 0x42);
  for (let i = 0; i < VSB_MAGIC.length; i++) k[i] = VSB_MAGIC.charCodeAt(i);
  const kuerzel = variante === "sampler" ? "E2S" : "E2";
  for (let i = 0; i < kuerzel.length; i++) k[0x10 + i] = kuerzel.charCodeAt(i);
  k[0x28] = 0x00;
  k[0x29] = 0x01;
  const [mj, mn] = MINDEST_REVISION[variante];
  k[0x2a] = mj;
  k[0x2b] = mn;
  k[0x2f] = 0xff;
  k[0x40] = 0x02;
  const sp = REGION_SPANNE[art];
  return baueVsbKopf(k, { art, laenge: laenge ?? sp.genau ?? sp.max!, idLow: VARIANTEN[variante].idLow });
}

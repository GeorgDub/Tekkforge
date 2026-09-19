/**
 * bootSektor — der erste 128-KiB-Block des Electribe-2-Flash: AM1802-AIS-Bootskript + SBL
 * (Second-Stage-Bootloader). Bauen, lesen, prüfen, als BOOT.VSB verpacken.
 *
 * Nachbau von vanasoft23/freetribe (Branch `bootloader-mess`) `cpu/src/bootloader/service/
 * boot_section.c` — genau so schreibt das Menü „Install bootloader“ den Sektor:
 *
 *   AIS-Kopf (40 B)  „TIPA“ · Sequential Read Enable · Function Execute 6 (PLL/Clock, 3 Argumente)
 *                    · Section Load → 0x80000000, u32 LE Größe
 *   SBL              genau 131022 B (= 0x20000 − 40 − 8 − 2); kürzere werden mit Nullen aufgefüllt
 *   AIS-Schwanz (8 B) Jump and Close → 0x80000000
 *   Prüfsumme (2 B)  16-Bit-LE-Wortsumme über alles davor (vanasoft-Konvention; Korgs Werksflash
 *                    hat sie nicht — darum ist eine falsche Summe ein Hinweis, kein Verbot)
 *
 * Die Python-Fassung `scripts/make_bootsect.py` erzeugt dieselben Bytes (Golden-Test).
 *
 * ⚠ Dieses Modul schreibt nichts ins Gerät. Ein falscher Boot-Sektor macht das Gerät nur noch
 * über JTAG (J9) erreichbar; das Flashen bleibt dem SD-Update des Geräts (BOOT.VSB) oder dem
 * Bootloader-Menü überlassen — beides Ein-Schuss-Wege.
 */
import { VSB_KOPF, baueVsbKopf } from "./vsbKopf";

export const BOOTSEKTOR_GROESSE = 0x20000;
export const SBL_LADEADRESSE = 0x80000000;
/** On-Chip-RAM des AM1802: 128 KiB ab 0x80000000 (die letzten 16 KiB trägt die MMU-Seitentabelle). */
export const OC_RAM_GROESSE = 0x20000;

/** AIS-Kopf ohne die abschließende Größe (die kommt beim Bauen dazu). */
export const AIS_KOPF: Uint8Array = Uint8Array.from([
  0x54, 0x49, 0x50, 0x41, // "TIPA"
  0x63, 0x59, 0x53, 0x58, // Sequential Read Enable
  0x0d, 0x59, 0x53, 0x58, 0x06, 0x00, 0x03, 0x00, // Function Execute 6, 3 Argumente
  0x01, 0x00, 0x18, 0x00, 0x05, 0x02, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00,
  0x01, 0x59, 0x53, 0x58, // Section Load
  0x00, 0x00, 0x00, 0x80, // → 0x80000000
]);
export const AIS_SCHWANZ: Uint8Array = Uint8Array.from([0x06, 0x59, 0x53, 0x58, 0x00, 0x00, 0x00, 0x80]);
const PRUEFSUMME_LAENGE = 2;
export const SBL_GROESSE = BOOTSEKTOR_GROESSE - (AIS_KOPF.length + 4) - AIS_SCHWANZ.length - PRUEFSUMME_LAENGE; // 131022

const u32 = (b: Uint8Array, off: number): number => (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;
const hex = (n: number): string => `0x${n.toString(16).toUpperCase()}`;

/** 16-Bit-LE-Wortsumme modulo 2^16 (ein einzelnes Restbyte zählt nicht). */
export function wortsumme16(buf: Uint8Array): number {
  let s = 0;
  for (let i = 0; i + 1 < buf.length; i += 2) s = (s + buf[i] + (buf[i + 1] << 8)) & 0xffff;
  return s;
}

export function baueBootSektor(sbl: Uint8Array): Uint8Array {
  if (sbl.length > SBL_GROESSE) throw new Error(`SBL zu groß: ${sbl.length} > ${SBL_GROESSE} Bytes — passt nicht in den 128-KiB-Boot-Sektor`);
  const out = new Uint8Array(BOOTSEKTOR_GROESSE);
  let p = 0;
  out.set(AIS_KOPF, p);
  p += AIS_KOPF.length;
  out[p++] = SBL_GROESSE & 0xff;
  out[p++] = (SBL_GROESSE >>> 8) & 0xff;
  out[p++] = (SBL_GROESSE >>> 16) & 0xff;
  out[p++] = (SBL_GROESSE >>> 24) & 0xff;
  out.set(sbl, p);
  p += SBL_GROESSE;
  out.set(AIS_SCHWANZ, p);
  p += AIS_SCHWANZ.length;
  const summe = wortsumme16(out.subarray(0, p));
  out[p] = summe & 0xff;
  out[p + 1] = (summe >>> 8) & 0xff;
  return out;
}

export interface BootSektion {
  addr: number;
  size: number;
}

export interface BootSektorBefund {
  /** Struktur brauchbar: TIPA, alle Section Loads ins On-Chip-RAM, Jump ins On-Chip-RAM. */
  ok: boolean;
  kommandos: string[];
  /** Section Loads in Reihenfolge. vanasoft: eine (0x80000000); Korg-Werk: drei (0x80000000 / +0x40 / +0x55F0). */
  sektionen: BootSektion[];
  /** Ladeadresse der ersten Sektion. */
  ladeAdresse?: number;
  einsprung?: number;
  /** Speicherbild ab 0x80000000 bis zum Ende der letzten Sektion (Lücken 0) — bei vanasoft genau die bootloader.bin. */
  sbl: Uint8Array;
  /** Summe der geladenen Bytes. */
  sblGroesse: number;
  pruefsumme: { gespeichert: number | null; berechnet: number; ok: boolean };
  /** „werk“ = Korg-Layout (mehrere Sektionen, keine Wortsumme), „vanasoft“ = eine Sektion + Wortsumme, sonst „fremd“. */
  layout: "werk" | "vanasoft" | "fremd";
  hinweise: string[];
}

/** Liest die ersten 128 KiB (auch aus einem größeren Flash-Dump). */
export function liesBootSektor(bytes: Uint8Array): BootSektorBefund {
  const leer = (h: string): BootSektorBefund => ({ ok: false, kommandos: [], sektionen: [], sbl: new Uint8Array(0), sblGroesse: 0, pruefsumme: { gespeichert: null, berechnet: 0, ok: false }, layout: "fremd", hinweise: [h] });
  if (bytes.length < BOOTSEKTOR_GROESSE) return leer(`zu kurz: ${bytes.length} Bytes, ein Boot-Sektor hat ${BOOTSEKTOR_GROESSE}`);
  const b = bytes.subarray(0, BOOTSEKTOR_GROESSE);
  if (!(b[0] === 0x54 && b[1] === 0x49 && b[2] === 0x50 && b[3] === 0x41)) return leer("kein AIS-Magic „TIPA“ am Anfang — das ist kein AM1802-Boot-Sektor");
  const kommandos: string[] = [];
  const hinweise: string[] = [];
  let ok = true;
  let pos = 4;
  const sektionen: BootSektion[] = [];
  const bild = new Uint8Array(OC_RAM_GROESSE);
  let bildEnde = 0;
  let geladen = 0;
  let ladeAdresse: number | undefined;
  let einsprung: number | undefined;
  while (pos + 4 <= b.length) {
    if (!(b[pos + 1] === 0x59 && b[pos + 2] === 0x53 && b[pos + 3] === 0x58)) {
      kommandos.push(`@${hex(pos)}: unbekanntes Wort — Ende der Kommandos`);
      ok = false;
      break;
    }
    const code = b[pos];
    if (code === 0x63) {
      kommandos.push(`@${hex(pos)}: Sequential Read Enable`);
      pos += 4;
    } else if (code === 0x0d) {
      const fn = b[pos + 4] | (b[pos + 5] << 8);
      const argc = b[pos + 6] | (b[pos + 7] << 8);
      const args: string[] = [];
      for (let i = 0; i < argc; i++) args.push(hex(u32(b, pos + 8 + 4 * i)));
      kommandos.push(`@${hex(pos)}: Function Execute ${fn} (${args.join(", ")})`);
      pos += 8 + 4 * argc;
    } else if (code === 0x01) {
      const addr = u32(b, pos + 4);
      const size = u32(b, pos + 8);
      kommandos.push(`@${hex(pos)}: Section Load → ${hex(addr)}, ${size} Bytes`);
      if (ladeAdresse === undefined) ladeAdresse = addr;
      const rel = addr - SBL_LADEADRESSE;
      const imRam = rel >= 0 && rel + size <= OC_RAM_GROESSE;
      if (!imRam) {
        ok = false;
        hinweise.push(`Section Load ${hex(addr)} (+${size}) liegt nicht im On-Chip-RAM ${hex(SBL_LADEADRESSE)}…+0x20000`);
      }
      if (pos + 12 + size > b.length) {
        ok = false;
        hinweise.push("Section Load reicht über den Sektor hinaus");
        break;
      }
      if (imRam) {
        bild.set(b.subarray(pos + 12, pos + 12 + size), rel);
        bildEnde = Math.max(bildEnde, rel + size);
      }
      sektionen.push({ addr, size });
      geladen += size;
      pos += 12 + size;
    } else if (code === 0x06) {
      einsprung = u32(b, pos + 4);
      kommandos.push(`@${hex(pos)}: Jump and Close → ${hex(einsprung)}`);
      pos += 8;
      if (einsprung < SBL_LADEADRESSE || einsprung >= SBL_LADEADRESSE + OC_RAM_GROESSE) {
        ok = false;
        hinweise.push(`Einsprung ${hex(einsprung)} liegt nicht im On-Chip-RAM`);
      }
      break;
    } else {
      kommandos.push(`@${hex(pos)}: AIS-Opcode ${hex(code)} (nicht ausgewertet)`);
      ok = false;
      break;
    }
  }
  if (sektionen.length === 0) {
    ok = false;
    hinweise.push("kein Section Load gefunden");
  }
  if (einsprung === undefined) {
    ok = false;
    hinweise.push("kein Jump and Close gefunden");
  }
  const berechnet = wortsumme16(b.subarray(0, pos));
  const gespeichert = pos + 2 <= b.length ? b[pos] | (b[pos + 1] << 8) : null;
  const summeOk = gespeichert === berechnet;
  const layout: BootSektorBefund["layout"] = !ok ? "fremd" : sektionen.length === 1 && sektionen[0].addr === SBL_LADEADRESSE && summeOk ? "vanasoft" : sektionen.length >= 2 && !summeOk ? "werk" : "fremd";
  if (!summeOk) hinweise.push(layout === "werk" ? "keine vanasoft-Wortsumme — Korg-Werkslayout (mehrere Sektionen), das ist in Ordnung" : `Prüfsumme ${gespeichert === null ? "fehlt" : hex(gespeichert)} ≠ berechnet ${hex(berechnet)}`);
  return { ok, kommandos, sektionen, ladeAdresse, einsprung, sbl: bild.slice(0, bildEnde), sblGroesse: geladen, pruefsumme: { gespeichert, berechnet, ok: summeOk }, layout, hinweise };
}

/**
 * BOOT.VSB = Korg-Kopf (Name BOOT, Länge 0x20000, Identität 0x0001xx) + Boot-Sektor. Der
 * Kopf kommt aus einer Vorlage (z. B. der SYSTEM.VSB der laufenden Firmware); der BOOT-Lader
 * nimmt 0x23 und 0x24 an (Modus 1).
 */
export function baueBootVsb(bootSektor: Uint8Array, vorlageKopf: Uint8Array, idLow = 0x24): Uint8Array {
  if (bootSektor.length !== BOOTSEKTOR_GROESSE) throw new Error(`Boot-Sektor muss genau 0x20000 Bytes haben, hat ${bootSektor.length}`);
  const out = new Uint8Array(VSB_KOPF + BOOTSEKTOR_GROESSE);
  out.set(baueVsbKopf(vorlageKopf, { art: "BOOT", laenge: BOOTSEKTOR_GROESSE, idLow }), 0);
  out.set(bootSektor, VSB_KOPF);
  return out;
}

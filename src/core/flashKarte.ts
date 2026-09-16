/**
 * flashKarte — einen kompletten 16-MiB-Dump des seriellen Flash der Electribe 2 kartieren
 * und in Update-Dateien zerlegen.
 *
 * Woher so ein Dump kommt: vanasofts Bootloader-Menü „Dump flash to SD“ (FLASHDMP.BIN),
 * Hacktribes SysEx 0x55 oder JTAG. Lage der Regionen: electribe2-re `storage-and-updates.md`
 * (Selektor << 16), ImHex-Pattern `e2s-flash-bin.hexpat`; Versionsrecord aus
 * ReadMainVersionRecord 0xC0029DEC (Selektor 0x21 + 0xFFF0, Bytes +4/+5/+6); USER-Stempel aus
 * Probe_KORGelec2USR_existance 0xC0029D78 (Selektor 0x22, Bytes +4..+0xB).
 */
import { liesBootSektor, type BootSektorBefund } from "./bootSektor";
import { FLASH_SELEKTOREN, REGION_SPANNE, VSB_KOPF, baueVsbKopf, standardKopf, type VsbArt } from "./vsbKopf";
import { VARIANTEN, type Variante } from "./crossgrade";
import { erkenneKarte, type Familie } from "./firmwareKarte";

export const FLASH_GROESSE = 0x1000000;

export interface FlashRegion {
  name: string;
  selektor: number;
  offset: number;
  groesse: number;
  vsb?: VsbArt;
  befund: string;
}

export interface FlashDumpBefund {
  ok: true;
  boot: BootSektorBefund;
  system: { vektorOk: boolean; familie: Familie | null; karte: string | null; nutzlast: Uint8Array };
  mainVersion: [number, number, number] | null;
  userIdentitaet: "elec2USR" | "ele2sUSR" | null;
  variante: Variante | null;
  pcm: { magicOk: boolean; format: string | null };
  regionen: FlashRegion[];
}

const ascii = (b: Uint8Array, off: number, n: number): string => {
  let s = "";
  for (let i = 0; i < n; i++) s += String.fromCharCode(b[off + i]);
  return s;
};
const leer = (b: Uint8Array, off: number, n: number): boolean => {
  for (let i = 0; i < n; i++) if (b[off + i] !== 0xff) return false;
  return true;
};

export function liesFlashDump(bytes: Uint8Array): FlashDumpBefund | { ok: false; grund: string } {
  if (bytes.length !== FLASH_GROESSE) return { ok: false, grund: `ein Flash-Dump hat genau 16 MiB (${FLASH_GROESSE} Bytes), diese Datei hat ${bytes.length}` };
  const boot = liesBootSektor(bytes);

  const sysOff = 0x20000;
  const nutzlast = bytes.subarray(sysOff, sysOff + 0x200000);
  // ARM-Vektortabelle: acht `ldr pc,[pc,#imm]` (0xE59FFxxx) am Anfang.
  let vektorOk = true;
  for (let i = 0; i < 8; i++) if (!(nutzlast[4 * i + 3] === 0xe5 && nutzlast[4 * i + 2] === 0x9f && (nutzlast[4 * i + 1] & 0xf0) === 0xf0)) vektorOk = false;
  // Karte erkennen: erkenneKarte will eine ganze VSB mit Kopf — wir geben ihr einen synthetischen.
  let familie: Familie | null = null;
  let karte: string | null = null;
  const probe = new Uint8Array(VSB_KOPF + 0x200000);
  probe.set(standardKopf("sampler", "SYSTEM"), 0);
  probe.set(nutzlast, VSB_KOPF);
  const k = erkenneKarte(probe);
  if (k.ok) {
    familie = k.karte.familie;
    karte = k.karte.label;
  } else {
    // Rückfall: das „PTST“ des Init-Patterns liegt je Familie an fester Stelle
    // (Sampler RAM 0xC00CFF58, Synth 0xC00BA8B0 — firmwareKarte.ts).
    if (ascii(nutzlast, 0xcff58, 4) === "PTST") familie = "sampler";
    else if (ascii(nutzlast, 0xba8b0, 4) === "PTST") familie = "synth";
  }

  const ver = 0x21fff0;
  const mainVersion: [number, number, number] | null = leer(bytes, ver, 0x10) ? null : [bytes[ver + 4], bytes[ver + 5], bytes[ver + 6]];

  const stempel = ascii(bytes, 0x220004, 8);
  const userIdentitaet = stempel === "elec2USR" || stempel === "ele2sUSR" ? stempel : null;
  const variante: Variante | null = userIdentitaet === "elec2USR" ? "synth" : userIdentitaet === "ele2sUSR" ? "sampler" : null;

  const pcmMagic = ascii(bytes, 0x800000, 4) === "KORG";
  const fmt = ascii(bytes, 0x800004, 8);
  const pcm = { magicOk: pcmMagic, format: pcmMagic && (fmt === "elec2PCM" || fmt === "X11100PC") ? fmt : null };

  const regionen: FlashRegion[] = FLASH_SELEKTOREN.map((s) => {
    let befund: string;
    if (leer(bytes, s.offset, Math.min(s.groesse, 0x100))) befund = "leer (0xFF)";
    else if (s.vsb === "BOOT") befund = boot.ok ? `AIS + SBL, ${boot.sblGroesse} Bytes in ${boot.sektionen.length} Sektion(en), ${boot.layout === "werk" ? "Korg-Werkslayout" : boot.layout === "vanasoft" ? "Custom-Bootloader (vanasoft)" : "fremdes Layout"}` : `unbrauchbar: ${boot.hinweise[0] ?? "?"}`;
    else if (s.vsb === "SYSTEM") befund = `${vektorOk ? "ARM-Vektortabelle OK" : "keine ARM-Vektortabelle"}${karte ? `, ${karte}` : ""}`;
    else if (s.vsb === "USER") befund = userIdentitaet ? `Stempel ${userIdentitaet} (${variante === "synth" ? "Synth 0x123" : "Sampler 0x124"})` : `kein Produktstempel bei +4 („${stempel.replace(/[^\x20-\x7e]/g, "?")}“)`;
    else if (s.vsb === "PCM") befund = pcm.magicOk ? `KORG ${pcm.format ?? fmt.replace(/[^\x20-\x7e]/g, "?")}` : "kein KORG-Magic";
    else if (s.selektor === 0x21) befund = mainVersion ? `Main ${mainVersion.map((x) => String(x).padStart(2, "0")).join(".")}` : "leer";
    else befund = "belegt";
    return { name: s.inhalt, selektor: s.selektor, offset: s.offset, groesse: s.groesse, vsb: s.vsb, befund };
  });

  return { ok: true, boot, system: { vektorOk, familie, karte, nutzlast }, mainVersion, userIdentitaet, variante, pcm, regionen };
}

/**
 * Schneidet eine Region aus dem Dump. Mit Vorlage-Kopf entsteht eine Update-Datei (VSB), ohne
 * Vorlage die rohe Nutzlast. USER/SLICE haben keine feste Länge — geliefert wird die volle Spanne.
 */
export function schneideRegion(bytes: Uint8Array, art: VsbArt, vorlageKopf?: Uint8Array): Uint8Array {
  if (bytes.length !== FLASH_GROESSE) throw new Error("kein 16-MiB-Flash-Dump");
  const s = FLASH_SELEKTOREN.find((x) => x.vsb === art)!;
  const sp = REGION_SPANNE[art];
  const laenge = sp.genau ?? sp.max!;
  const nutz = bytes.slice(s.offset, s.offset + laenge);
  if (!vorlageKopf) return nutz;
  const idLow = vorlageKopf[0x2e] === VARIANTEN.synth.idLow ? VARIANTEN.synth.idLow : VARIANTEN.sampler.idLow;
  const out = new Uint8Array(VSB_KOPF + laenge);
  out.set(baueVsbKopf(vorlageKopf, { art, laenge, idLow }), 0);
  out.set(nutz, VSB_KOPF);
  return out;
}

/**
 * geraeteFlash — was sich aus dem Flash des laufenden Geräts lesen lässt, ohne einen ganzen
 * 16-MiB-Dump zu ziehen: die Kennungen (Gerätestempel, Main-Version, PCM-Kopf) in ein paar
 * hundert Bytes und der 128-KiB-Boot-Sektor (Werks-SBL — der Rückweg, BEVOR man einen eigenen
 * Bootloader installiert).
 *
 * Der Lesepfad (`LesenFlash`) kommt von außen: die GUI hängt Hacktribes 0x55 dahinter, Tests
 * einen Nachbau. Lage der Records wie in `flashKarte.ts` (electribe2-re, storage-and-updates.md).
 */
import { liesBootSektor, BOOTSEKTOR_GROESSE, type BootSektorBefund } from "./bootSektor";
import { PATTERN_BANK, PATTERN_BANK_FLASH_GROESSE, baueE2sallpat, patternNamenAusBank, regionLage, verpackeRegion } from "./flashKarte";
import type { VsbArt } from "./vsbKopf";
import type { Variante } from "./crossgrade";

/** Flash lesen; `chunk` (optional) = Bytes je SysEx-Anfrage, sonst der Standard 0x100. */
export type LesenFlash = (addr: number, len: number, chunk?: number) => Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }>;

export const KENNUNG = {
  mainVersion: 0x21fff0,
  userStempel: 0x220000,
  pcmKopf: 0x800000,
  bootSektor: 0x000000,
} as const;

export interface FlashKennungen {
  stempel: string | null;
  variante: Variante | null;
  mainVersion: [number, number, number] | null;
  pcm: { magicOk: boolean; format: string | null };
  fehler: string[];
}

const ascii = (b: Uint8Array, off: number, n: number): string => {
  let s = "";
  for (let i = 0; i < n && off + i < b.length; i++) s += String.fromCharCode(b[off + i]);
  return s;
};
const druckbar = (s: string): string => s.replace(/[^\x20-\x7e]/g, "?");

export async function liesFlashKennungen(lesen: LesenFlash): Promise<FlashKennungen> {
  const fehler: string[] = [];
  let stempel: string | null = null;
  let variante: Variante | null = null;
  let mainVersion: [number, number, number] | null = null;
  let pcm: FlashKennungen["pcm"] = { magicOk: false, format: null };

  const u = await lesen(KENNUNG.userStempel, 16);
  if (u.ok) {
    const s = ascii(u.bytes, 4, 8);
    stempel = druckbar(s);
    variante = s === "elec2USR" ? "synth" : s === "ele2sUSR" ? "sampler" : null;
  } else fehler.push(`Gerätestempel: ${u.reason}`);

  const v = await lesen(KENNUNG.mainVersion, 16);
  if (v.ok) mainVersion = v.bytes.every((x) => x === 0xff) ? null : [v.bytes[4], v.bytes[5], v.bytes[6]];
  else fehler.push(`Main-Version: ${v.reason}`);

  const p = await lesen(KENNUNG.pcmKopf, 16);
  if (p.ok) {
    const magicOk = ascii(p.bytes, 0, 4) === "KORG";
    const fmt = ascii(p.bytes, 4, 8);
    pcm = { magicOk, format: magicOk && (fmt === "elec2PCM" || fmt === "X11100PC") ? fmt : magicOk ? druckbar(fmt) : null };
  } else fehler.push(`PCM-Kopf: ${p.reason}`);

  return { stempel, variante, mainVersion, pcm, fehler };
}

export function kennungenText(k: FlashKennungen): string[] {
  const z: string[] = [];
  z.push(`Gerätestempel (Flash 0x220004): ${k.stempel ? `„${k.stempel}“` : "nicht lesbar"}${k.variante ? ` → ${k.variante === "synth" ? "electribe 2 (Synth, 0x123)" : "electribe 2 sampler (0x124)"}` : k.stempel ? " → unbekannt" : ""}`);
  z.push(`Main-Version (Flash 0x21FFF0): ${k.mainVersion ? k.mainVersion.map((x) => String(x).padStart(2, "0")).join(".") : "leer/nicht lesbar"}`);
  z.push(`PCM-Image (Flash 0x800000): ${k.pcm.magicOk ? `KORG ${k.pcm.format ?? "?"}` : "kein KORG-Magic"}`);
  for (const f of k.fehler) z.push(`Fehler: ${f}`);
  return z;
}

/**
 * Größte Häppchengröße, die das Gerät bei 0x55 korrekt beantwortet: Kandidaten absteigend
 * probieren und jeweils gegen die 0x100-Lesung derselben Stelle vergleichen. Ein Timeout oder
 * eine Abweichung schließt den Kandidaten aus. Ergebnis mindestens 0x100.
 */
export async function probeHaeppchen(lesen: LesenFlash, kandidaten: readonly number[] = [0x400, 0x200], probeAddr = KENNUNG.userStempel): Promise<{ chunk: number; hinweis: string }> {
  const referenz = await lesen(probeAddr, Math.max(...kandidaten, 0x100), 0x100);
  if (!referenz.ok) return { chunk: 0x100, hinweis: `Referenzlesung fehlgeschlagen (${referenz.reason}) — bleibe bei 0x100` };
  for (const k of kandidaten) {
    if (k <= 0x100) continue;
    const r = await lesen(probeAddr, k, k);
    if (r.ok && r.bytes.length === k && r.bytes.every((b, i) => b === referenz.bytes[i])) return { chunk: k, hinweis: `Häppchen 0x${k.toString(16)} bestätigt` };
  }
  return { chunk: 0x100, hinweis: "größere Häppchen nicht bestätigt — 0x100" };
}

export interface DumpFortschritt {
  gelesen: number;
  gesamt: number;
  chunk: number;
}

export interface DumpOptionen {
  fortschritt?: (f: DumpFortschritt) => void;
  /** true → nach dem laufenden Block abbrechen; das Teilergebnis kommt zurück. */
  abbruch?: () => boolean;
  /** Bytes je Anfrage (aus probeHaeppchen); Standard 0x100. */
  chunk?: number;
  /** Bytes je Fortschritts-Block; Standard 64 KiB. */
  block?: number;
  /** Gesamtgröße (Tests); Standard 16 MiB. */
  gesamt?: number;
  start?: number;
}

export type DumpErgebnis = { ok: true; bytes: Uint8Array } | { ok: false; reason: string; teil: Uint8Array; gelesen: number };

/** Den Flash blockweise lesen (Standard: alle 16 MiB ab 0). Bricht bei Lesefehler oder Abbruchwunsch ab und liefert das Teilstück. */
export async function liesFlashKomplett(lesen: LesenFlash, opts: DumpOptionen = {}): Promise<DumpErgebnis> {
  const gesamt = opts.gesamt ?? 0x1000000;
  const start = opts.start ?? 0;
  const block = opts.block ?? 0x10000;
  const chunk = opts.chunk ?? 0x100;
  const out = new Uint8Array(gesamt);
  let gelesen = 0;
  opts.fortschritt?.({ gelesen, gesamt, chunk });
  while (gelesen < gesamt) {
    if (opts.abbruch?.()) return { ok: false, reason: "abgebrochen", teil: out.slice(0, gelesen), gelesen };
    const n = Math.min(block, gesamt - gelesen);
    const r = await lesen(start + gelesen, n, chunk);
    if (!r.ok) return { ok: false, reason: r.reason, teil: out.slice(0, gelesen), gelesen };
    out.set(r.bytes.subarray(0, n), gelesen);
    gelesen += n;
    opts.fortschritt?.({ gelesen, gesamt, chunk });
  }
  return { ok: true, bytes: out };
}

export type PatternBankErgebnis = { ok: true; bank: Uint8Array; namen: string[] } | { ok: false; reason: string };

/**
 * Nur die Pattern-Bank vom Gerät lesen (Flash 0x230000..0x628000, gut 4 MiB — mit 0x400-Häppchen
 * etwa eine halbe Minute) und als `.e2sallpat` liefern. Kein 16-MiB-Dump nötig.
 */
export async function liesPatternBankVomGeraet(lesen: LesenFlash, opts: Pick<DumpOptionen, "fortschritt" | "abbruch" | "chunk"> = {}): Promise<PatternBankErgebnis> {
  const r = await liesFlashKomplett(lesen, { ...opts, start: PATTERN_BANK.glst, gesamt: PATTERN_BANK_FLASH_GROESSE });
  if (!r.ok) return { ok: false, reason: r.reason };
  try {
    const bank = baueE2sallpat(r.bytes);
    return { ok: true, bank, namen: patternNamenAusBank(bank) };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

export type RegionErgebnis = { ok: true; nutz: Uint8Array; datei: Uint8Array } | { ok: false; reason: string; gelesen: number };

/**
 * Eine Flash-Region (SYSTEM 2 MiB, PCM 8 MiB, USER, SLICE, BOOT) direkt vom Gerät lesen und —
 * mit Kopfvorlage — als Update-Datei (.VSB) verpacken. Ohne Vorlage kommt die rohe Nutzlast.
 */
export async function liesRegionVomGeraet(lesen: LesenFlash, art: VsbArt, vorlageKopf?: Uint8Array, opts: Pick<DumpOptionen, "fortschritt" | "abbruch" | "chunk"> = {}): Promise<RegionErgebnis> {
  const { offset, laenge } = regionLage(art);
  const r = await liesFlashKomplett(lesen, { ...opts, start: offset, gesamt: laenge });
  if (!r.ok) return { ok: false, reason: r.reason, gelesen: r.gelesen };
  return { ok: true, nutz: r.bytes, datei: verpackeRegion(r.bytes, art, vorlageKopf) };
}

export async function liesBootSektorVomGeraet(lesen: LesenFlash): Promise<{ ok: true; bytes: Uint8Array; befund: BootSektorBefund } | { ok: false; reason: string }> {
  const r = await lesen(KENNUNG.bootSektor, BOOTSEKTOR_GROESSE);
  if (!r.ok) return { ok: false, reason: r.reason };
  if (r.bytes.length !== BOOTSEKTOR_GROESSE) return { ok: false, reason: `nur ${r.bytes.length} von ${BOOTSEKTOR_GROESSE} Bytes gelesen` };
  return { ok: true, bytes: r.bytes, befund: liesBootSektor(r.bytes) };
}

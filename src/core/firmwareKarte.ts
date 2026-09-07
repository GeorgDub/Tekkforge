/**
 * firmwareKarte — WO in einer electribe-2-SYSTEM.VSB was liegt, je Variante.
 *
 * Bis v0.6 kannte die Werkbank genau ein Abbild: die Hacktribe-Firmware
 * (Sampler v2.02 + bsdiff-Patch), mit festen Adressen in `hacktribeRam`,
 * `ifxErweiterung`, `firmwareBau`. Wer eine Synth-Firmware oder die
 * unveraenderte Sampler-Firmware laden wollte, lief gegen das E2S-Gate oder
 * gegen falsche Adressen. Diese Karte macht die Lage zur Eigenschaft der
 * Datei: eine Karte je Layout, erkannt am Payload — nicht am Kopf, denn ein
 * umgekoepftes Abbild (Synth-Payload mit Sampler-Kopf, `crossgrade.ts`)
 * traegt den Kopf der einen und das Layout der anderen Variante.
 *
 * Drei Karten (alle Adressen sind DDR2-RAM, Datei-Offset = RAM − 0xC0000000 + 0x100):
 *
 *   hacktribe      Sampler-Layout, flache IFX-Bank 0xC00A80F0 (100 × 0x20C,
 *                  Name im Block ab +1), MFX-Bank 0xC00B4F30 (32), Groove-Bank
 *                  0xC0143B00 (96 × 0x140), 13 IFX-Zaehler, 4 Groove-Zaehler,
 *                  Osz-Tabelle 0xC00D9AB0 (274 von 421), Mod-Tabelle nach
 *                  0xC01A0000 verlegt (96), Startbild 0xC00F9854, DSP-Kette
 *                  ab Datei 0xF9F10 — alles wie bisher, byte-genau.
 *   sampler-stock  Offizielle Sampler v2.02. Presets NICHT als Bank, sondern
 *                  ueber Zeigertabellen: 38 IFX-Zeiger ab 0xC00ADF94, 32
 *                  MFX-Zeiger ab 0xC00AF390, jeder auf einen 0x20C-Block mit
 *                  Name ab +1 (belegt 2026-09-07: die 38 gezeigten IFX-Bloecke
 *                  sind byte-gleich mit Hacktribes Bank-Slots 0–37). Keine
 *                  Groove-Bank (0xC0143B00 ist 0xFF), Mod-Tabelle 0xC00D81F0
 *                  (72), Osz-Tabelle 421 Eintraege, Startbild und Init-Bloecke
 *                  wie Hacktribe (der Patch verschiebt sie nicht).
 *   synth-stock    Offizielle Synth v2.02. Gleiche Bauart, andere Lage:
 *                  IFX-Zeiger 0xC009898C, MFX-Zeiger 0xC0099D88 (gleiche 38/32
 *                  Namen), Init-Global 0xC00BA7B0, Init-Pattern 0xC00BA8B0
 *                  (beide „GLST“/„PTST“ am Abbild belegt), Osz-Tabelle
 *                  0xC00C13E8 (84 × 32: SAW, BOOST-SAW, PULSE …), Mod-Tabelle
 *                  0xC00C1E68 (72), DSP-Kette ab Datei 0xDFC80 (154 Bloecke).
 *                  IFX-Zaehler: der Getter (mov r0,#38) bei 0xC0039BFC und elf
 *                  Spiegel per Befehlskontext gefunden; die zwoelfte Zelle
 *                  (Analog zu 0xC004A1F8) fehlt — darum nicht erweiterbar.
 *                  Startbild: Lage im Synth NICHT gefunden (kein Baustein).
 *
 * Was eine Karte NICHT kann, sagt sie selbst (`ifxErweiterbar`, fehlende
 * Baenke, fehlendes Startbild) — die Werkbank blendet dann aus, statt zu raten.
 * Quelle der Synth-Adressen: Omnitribe-Probes vom 2026-09-07 an
 * `stock_e2synth_v202.vsb` (SHA-256 41fc5f1c…), Gegenprobe `firmware-karte.test.ts`
 * gegen die echten Abbilder, wenn sie lokal liegen.
 */
import { DDR2_BASE, E2_RAM_MAP, IFX_PRESET_WRITE_MAX, MFX_PRESET_WRITE_MAX } from "./hacktribeRam";
import { IFX_ZAEHLER, type IfxZaehler } from "./ifxErweiterung";
import { VARIANTEN, VSB_TOTAL, OFF_ID_LOW, OFF_SUFFIX, type Variante } from "./crossgrade";

export const VSB_HEADER = 0x100;

export function dateiOffset(ramAddr: number): number {
  return ramAddr - DDR2_BASE + VSB_HEADER;
}
export function ramAdresse(dateiOff: number): number {
  return dateiOff - VSB_HEADER + DDR2_BASE;
}

export type KartenId = "hacktribe" | "sampler-stock" | "synth-stock";
/** Das Payload-Layout — Sampler-Bauart oder Synth-Bauart. */
export type Familie = "sampler" | "synth";

export interface Bank {
  /** RAM-Adresse von Platz 0. */
  base: number;
  stride: number;
  count: number;
}

/** Stock: eine Tabelle von LE32-RAM-Zeigern, jeder auf einen 0x20C-Preset-Block mit Name ab +1. */
export interface ZeigerTabelle {
  addr: number;
  count: number;
}

export interface Zaehler {
  addr: number;
  plusEins: boolean;
}

export interface Tabelle {
  base: number;
  stride: number;
  count: number;
  /** Hacktribe: Anhaengen mit Beschreiber-/Grenz-Nachzug moeglich (oszTabelle.ts / modTabelle.ts). */
  erweiterbar: boolean;
}

export interface FirmwareKarte {
  id: KartenId;
  label: string;
  familie: Familie;
  /** Die Kopf-Variante, die zu diesem Payload gehoert. */
  variante: Variante;
  /** SHA-256 des unveraenderten Abbilds, wenn bekannt. */
  sha256?: string;
  /** Flache IFX-Bank (Hacktribe) … */
  ifxBank?: Bank;
  /** … oder Stock-Zeigertabelle. Genau eins von beiden. */
  ifxZeiger?: ZeigerTabelle;
  /** Hoechster schreibbarer IFX-Platz (0-basiert). */
  ifxSchreibMax: number;
  mfxBank?: Bank;
  mfxZeiger?: ZeigerTabelle;
  mfxSchreibMax: number;
  grooveBank?: Bank;
  grooveZaehler?: readonly Zaehler[];
  ifxZaehler: readonly Zaehler[];
  /** false: nicht alle Spiegelzellen bekannt — Zaehler nur lesen, nie schreiben. */
  ifxZaehlerVollstaendig: boolean;
  /** Menue ueber neue Plaetze erweitern (braucht flache Bank + alle Zaehler). */
  ifxErweiterbar: boolean;
  /** RAM-Adresse des 0x3C00-Init-Pattern-Blocks („PTST“ … „PTED“). */
  initPattern: number;
  /** RAM-Adresse des 0x100-Init-Global-Blocks („GLST“ … „GLED“). */
  initGlobal: number;
  /** RAM-Adresse des 1024-Byte-Startbilds; fehlt, wo die Lage unbekannt ist. */
  splash?: number;
  oszTabelle?: Tabelle;
  modTabelle?: Tabelle;
  /** Datei-Offset des ersten LDR-Blocks der BF523-DSP-Kette. */
  ldrStart?: number;
  /** Kennung im .e2spat/.e2pat-Kopf und die Dateiendung des Init-Patterns. */
  patternKennung: "e2sampler" | "e2";
  patternEndung: ".e2spat" | ".e2pat";
  sdOrdner: string;
}

const ramMap = (key: string) => E2_RAM_MAP.find((e) => e.key === key)!;

/**
 * Die vier Groove-Zaehler aus hacktribe `add_groove` — zwei auf den
 * Max-Index, zwei auf Max-Index + 1 (0xC007BB88 ist die Read-Quelle). In der
 * gepatchten Firmware stehen sie auf 61/62 bei 62 Werks-Vorlagen.
 */
export const GROOVE_ZAEHLER: readonly Zaehler[] = [
  { addr: 0xc0049da4, plusEins: false },
  { addr: 0xc007bb90, plusEins: false },
  { addr: 0xc007bb88, plusEins: true },
  { addr: 0xc007bb94, plusEins: true },
];

/** hacktribe/hash/hacked-SYSTEM.VSB.sha — die unveraenderte Hacktribe-Firmware. */
export const HACKTRIBE_SHA256 = "7cb4825c184a7e3fa92224304be22a788c96c4b748c277e63a496baa9faae7ee";
/** Offizielle Sampler v2.02 (aus dem hacktribe-Repo, hier nachgerechnet). */
export const SAMPLER_STOCK_SHA256 = "1d0f0689d5a12c8a8bde9f821f2a59adc5f6cd6012ddb201ebb192b72468a646";
/** Offizielle Synth v2.02 (Korg-Download, 2026-09-07 nachgerechnet). */
export const SYNTH_STOCK_SHA256 = "41fc5f1c33209ef381d1c9fef21a72380bcd8d3431c9c1350a964f5c619ab8b8";

const ifxMap = ramMap("ifxPreset");
const mfxMap = ramMap("mfxPreset");
const grooveMap = ramMap("groove");
const oszMap = ramMap("oszTabelle");

const sampler = VARIANTEN.sampler;
const synth = VARIANTEN.synth;

export const KARTE_HACKTRIBE: FirmwareKarte = {
  id: "hacktribe",
  label: "Hacktribe (Sampler v2.02 + Patch)",
  familie: "sampler",
  variante: "sampler",
  sha256: HACKTRIBE_SHA256,
  ifxBank: { base: ifxMap.base, stride: ifxMap.stride, count: ifxMap.count },
  ifxSchreibMax: IFX_PRESET_WRITE_MAX,
  mfxBank: { base: mfxMap.base, stride: mfxMap.stride, count: mfxMap.count },
  mfxSchreibMax: MFX_PRESET_WRITE_MAX,
  grooveBank: { base: grooveMap.base, stride: grooveMap.stride, count: grooveMap.count },
  grooveZaehler: GROOVE_ZAEHLER,
  ifxZaehler: IFX_ZAEHLER as readonly IfxZaehler[],
  ifxZaehlerVollstaendig: true,
  ifxErweiterbar: true,
  initPattern: ramMap("initPattern").base,
  initGlobal: ramMap("initGlobal").base,
  splash: ramMap("splash").base,
  oszTabelle: { base: oszMap.base, stride: oszMap.stride, count: oszMap.count, erweiterbar: true },
  modTabelle: { base: 0xc01a0000, stride: 0x58, count: 96 + 645, erweiterbar: true },
  ldrStart: 0xf9f10,
  patternKennung: "e2sampler",
  patternEndung: ".e2spat",
  sdOrdner: sampler.sdOrdner,
};

export const KARTE_SAMPLER_STOCK: FirmwareKarte = {
  id: "sampler-stock",
  label: "electribe 2 sampler v2.02 (offiziell)",
  familie: "sampler",
  variante: "sampler",
  sha256: SAMPLER_STOCK_SHA256,
  ifxZeiger: { addr: 0xc00adf94, count: 38 },
  ifxSchreibMax: 37,
  mfxZeiger: { addr: 0xc00af390, count: 32 },
  mfxSchreibMax: 31,
  ifxZaehler: IFX_ZAEHLER as readonly IfxZaehler[],
  ifxZaehlerVollstaendig: true,
  ifxErweiterbar: false,
  initPattern: ramMap("initPattern").base,
  initGlobal: ramMap("initGlobal").base,
  splash: ramMap("splash").base,
  oszTabelle: { base: oszMap.base, stride: oszMap.stride, count: oszMap.count, erweiterbar: false },
  modTabelle: { base: 0xc00d81f0, stride: 0x58, count: 72, erweiterbar: false },
  ldrStart: 0xf9f10,
  patternKennung: "e2sampler",
  patternEndung: ".e2spat",
  sdOrdner: sampler.sdOrdner,
};

/**
 * Synth: Getter `mov r0,#38` bei Datei 0x39CFC, dazu elf Spiegelzellen, per
 * Befehlskontext (cmp/ldrb/movle) am Sampler-Gegenstueck wiedergefunden.
 * Reihenfolge wie im Sampler; die Zelle zu 0xC004A1F8 fehlt.
 */
export const IFX_ZAEHLER_SYNTH: readonly Zaehler[] = [
  { addr: ramAdresse(0x39cfc), plusEins: true }, // Getter (0xC003EFDC im Sampler)
  { addr: ramAdresse(0x43240), plusEins: false }, // 0xC0048F80
  { addr: ramAdresse(0x4410c), plusEins: false }, // 0xC0049EF0
  { addr: ramAdresse(0x85844), plusEins: false }, // 0xC009814C
  { addr: ramAdresse(0x85848), plusEins: true }, // 0xC0098150
  { addr: ramAdresse(0x85880), plusEins: false }, // 0xC0098188
  { addr: ramAdresse(0x8588c), plusEins: true }, // 0xC0098194
  { addr: ramAdresse(0x857e0), plusEins: false }, // 0xC00980E8
  { addr: ramAdresse(0x857e4), plusEins: true }, // 0xC00980EC
  { addr: ramAdresse(0x85794), plusEins: true }, // 0xC009809C
  { addr: ramAdresse(0x85814), plusEins: true }, // 0xC009811C
  { addr: ramAdresse(0x85830), plusEins: true }, // 0xC0098138
];

export const KARTE_SYNTH_STOCK: FirmwareKarte = {
  id: "synth-stock",
  label: "electribe 2 (Synth) v2.02 (offiziell)",
  familie: "synth",
  variante: "synth",
  sha256: SYNTH_STOCK_SHA256,
  ifxZeiger: { addr: ramAdresse(0x98a8c), count: 38 },
  ifxSchreibMax: 37,
  mfxZeiger: { addr: ramAdresse(0x99e88), count: 32 },
  mfxSchreibMax: 31,
  ifxZaehler: IFX_ZAEHLER_SYNTH,
  ifxZaehlerVollstaendig: false,
  ifxErweiterbar: false,
  initPattern: ramAdresse(0xba9b0),
  initGlobal: ramAdresse(0xba8b0),
  oszTabelle: { base: ramAdresse(0xc14e8), stride: 0x20, count: 84, erweiterbar: false },
  modTabelle: { base: ramAdresse(0xc1f68), stride: 0x58, count: 72, erweiterbar: false },
  ldrStart: 0xdfc80,
  patternKennung: "e2",
  patternEndung: ".e2pat",
  sdOrdner: synth.sdOrdner,
};

export const KARTEN: Record<KartenId, FirmwareKarte> = {
  hacktribe: KARTE_HACKTRIBE,
  "sampler-stock": KARTE_SAMPLER_STOCK,
  "synth-stock": KARTE_SYNTH_STOCK,
};

// ─── Erkennung ───────────────────────────────────────────────────────────────

const ascii = (b: Uint8Array, off: number, len: number): string => {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[off + i] ?? 0);
  return s;
};

export interface KartenBefund {
  ok: true;
  karte: FirmwareKarte;
  familie: Familie;
  /** Was der Kopf sagt — „?“ bei unbekannter Device-ID. */
  kopfVariante: Variante | "?";
  /** Kopf und Payload gehoeren zu verschiedenen Varianten (Crossgrade). */
  umgekoepft: boolean;
  /** Sampler-Layout mit Hacktribe-Baenken (flache IFX-Bank mit Namen / Groove-Bank). */
  hacktribe: boolean;
}
export type KartenErkennung = KartenBefund | { ok: false; reason: string };

/**
 * Bauart an den Init-Bloecken erkennen — „PTST“ und „GLST“ an den Stellen
 * der Karte; die liegen in Stock und Hacktribe gleich. Die Endmarken
 * („PTED“/„GLED“) prueft die Freigabe getrennt, damit ein nachgebautes
 * Abbild ohne sie noch erkannt (und dann klar abgelehnt) wird.
 */
const hatFamilie = (bytes: Uint8Array, k: FirmwareKarte): boolean =>
  ascii(bytes, dateiOffset(k.initPattern), 4) === "PTST" && ascii(bytes, dateiOffset(k.initGlobal), 4) === "GLST";

/**
 * Welche Karte passt zu diesem Abbild? Kopf (Groesse, Magic, Tag) und dann
 * das Layout: Init-Bloecke an der Sampler- oder der Synth-Stelle. Im
 * Sampler-Layout entscheidet die flache IFX-Bank (Name in Slot 0) oder die
 * Groove-Bank („GVST“ in Slot 0) fuer Hacktribe — Stock hat dort Nullen bzw.
 * 0xFF. Ein Synth-Payload wird auch dann erkannt, wenn der Kopf „Sampler“ sagt.
 */
export function erkenneKarte(bytes: Uint8Array): KartenErkennung {
  if (bytes.length !== VSB_TOTAL) return { ok: false, reason: `${bytes.length} Bytes — eine E2-SYSTEM.VSB hat ${VSB_TOTAL}` };
  if (ascii(bytes, 0, 16) !== "KORG SYSTEM FILE") return { ok: false, reason: "Kein „KORG SYSTEM FILE“-Kopf" };
  // Der Dateityp-Tag („SYSTEM“ bei 0x20) ist Kopfsache und wird in der Freigabe geprueft — hier zaehlt das Layout.
  let kopfVariante: Variante | "?" = "?";
  for (const v of Object.keys(VARIANTEN) as Variante[]) {
    if (bytes[OFF_ID_LOW] === VARIANTEN[v].idLow && bytes[OFF_SUFFIX] === VARIANTEN[v].suffix) kopfVariante = v;
  }
  let karte: FirmwareKarte;
  if (hatFamilie(bytes, KARTE_HACKTRIBE)) {
    const bank = KARTE_HACKTRIBE.ifxBank!;
    const groove = KARTE_HACKTRIBE.grooveBank!;
    const ifxName = bytes[dateiOffset(bank.base) + 1] !== 0;
    const gvst = ascii(bytes, dateiOffset(groove.base), 4) === "GVST";
    karte = ifxName || gvst ? KARTE_HACKTRIBE : KARTE_SAMPLER_STOCK;
  } else if (hatFamilie(bytes, KARTE_SYNTH_STOCK)) {
    karte = KARTE_SYNTH_STOCK;
  } else {
    return { ok: false, reason: "Weder an der Sampler- noch an der Synth-Stelle stehen Init-Pattern und Init-Global („PTST“/„GLST“) — unbekanntes Layout" };
  }
  return { ok: true, karte, familie: karte.familie, kopfVariante, umgekoepft: kopfVariante !== "?" && kopfVariante !== karte.variante, hacktribe: karte.id === "hacktribe" };
}

// ─── Plaetze aufloesen ───────────────────────────────────────────────────────

export type PresetArt = "ifx" | "mfx";

const gueltigeRam = (v: number): boolean => v >= DDR2_BASE + VSB_HEADER && v + 0x20c <= DDR2_BASE + 0x200000;

/**
 * Datei-Offset des Preset-Blocks fuer Platz `slot` (0-basiert) — aus der
 * flachen Bank oder ueber die Stock-Zeigertabelle (dafuer braucht es die
 * Bytes). null, wenn es den Platz in dieser Karte nicht gibt oder der Zeiger
 * ins Leere zeigt.
 */
export function presetOffset(karte: FirmwareKarte, bytes: Uint8Array, art: PresetArt, slot: number): number | null {
  const bank = art === "ifx" ? karte.ifxBank : karte.mfxBank;
  if (bank) return slot >= 0 && slot < bank.count ? dateiOffset(bank.base + slot * bank.stride) : null;
  const z = art === "ifx" ? karte.ifxZeiger : karte.mfxZeiger;
  if (!z || slot < 0 || slot >= z.count) return null;
  const o = dateiOffset(z.addr) + 4 * slot;
  const v = (bytes[o] | (bytes[o + 1] << 8) | (bytes[o + 2] << 16) | (bytes[o + 3] << 24)) >>> 0;
  return gueltigeRam(v) ? dateiOffset(v) : null;
}

/** Wie viele Preset-Plaetze die Karte fuehrt (Bank-Groesse bzw. Zeigerzahl). */
export function presetPlaetze(karte: FirmwareKarte, art: PresetArt): number {
  const bank = art === "ifx" ? karte.ifxBank : karte.mfxBank;
  if (bank) return bank.count;
  return (art === "ifx" ? karte.ifxZeiger : karte.mfxZeiger)?.count ?? 0;
}

export function grooveOffset(karte: FirmwareKarte, slot: number): number | null {
  const b = karte.grooveBank;
  return b && slot >= 0 && slot < b.count ? dateiOffset(b.base + slot * b.stride) : null;
}

export type ZaehlerStand = { ok: true; maxIndex: number } | { ok: false; reason: string };

/** Einen Zaehlersatz aus dem Abbild lesen — stimmig nur, wenn alle Zellen zusammenpassen. */
export function leseZaehler(bytes: Uint8Array, zaehler: readonly Zaehler[]): ZaehlerStand {
  if (!zaehler.length) return { ok: false, reason: "keine Zählerzellen bekannt" };
  const werte = zaehler.map((z) => ({ ...z, wert: bytes[dateiOffset(z.addr)] }));
  const erste = werte.find((w) => !w.plusEins) ?? werte[0];
  const max = erste.plusEins ? erste.wert - 1 : erste.wert;
  for (const w of werte) {
    const soll = w.plusEins ? max + 1 : max;
    if (w.wert !== soll) {
      return { ok: false, reason: `Zähler widersprechen sich: 0x${w.addr.toString(16).toUpperCase()} steht auf ${w.wert}, nach Max-Index ${max} müsste dort ${soll} stehen` };
    }
  }
  return { ok: true, maxIndex: max };
}

/** Name eines Preset-Blocks (ASCII ab +1, NUL-terminiert, max. 15). */
export function presetName(block: Uint8Array): string {
  let t = "";
  for (let i = 1; i < 16 && block[i]; i++) t += String.fromCharCode(block[i]);
  return t;
}

export function karteLabel(b: KartenBefund): string {
  const kopf = b.kopfVariante === "?" ? "unbekannter Kopf" : VARIANTEN[b.kopfVariante].label;
  return b.umgekoepft ? `${b.karte.label}, umgeköpft auf ${kopf}` : b.karte.label;
}

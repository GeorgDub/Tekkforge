/**
 * Nachgebaute Abbilder fuer die drei Karten — ohne Korg-Bytes, aber mit
 * denselben Stellen: Kopf, Init-Bloecke, Preset-Baenke bzw. Zeigertabellen,
 * Zaehler, Groove-Bank (Hacktribe), Osz-/Mod-Tabelle, Startbild, LDR-Kette.
 */
import { VSB_TOTAL, VARIANTEN, OFF_ID_LOW, OFF_SUFFIX, OFF_TAG, type Variante } from "../../src/core/crossgrade";
import { KARTE_HACKTRIBE, KARTE_SAMPLER_STOCK, KARTE_SYNTH_STOCK, dateiOffset, ramAdresse, type FirmwareKarte } from "../../src/core/firmwareKarte";
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes } from "../../src/core/e2FxPreset";
import { decodeGroove, encodeGroove, initGrooveBytes, GROOVE_SIZE } from "../../src/core/e2Groove";
import { OSZ_ZEIGER_ADDRS, OSZ_GRENZE_STELLEN, oszZaehlerSchreibliste, OSZ_TABELLE_ADDR } from "../../src/core/oszTabelle";

export const asc = (b: Uint8Array, off: number, s: string): void => {
  for (let i = 0; i < s.length; i++) b[off + i] = s.charCodeAt(i);
};
export const setU32 = (b: Uint8Array, off: number, v: number): void => {
  b[off] = v & 0xff;
  b[off + 1] = (v >>> 8) & 0xff;
  b[off + 2] = (v >>> 16) & 0xff;
  b[off + 3] = (v >>> 24) & 0xff;
};

export function presetBytes(name: string, mfx = false): Uint8Array {
  const p = decodeFxPreset(initFxPresetBytes(), mfx);
  p.name = name;
  return encodeFxPreset(p);
}
export function grooveBytes(name: string): Uint8Array {
  const g = decodeGroove(initGrooveBytes());
  g.name = name;
  return encodeGroove(g);
}

const OSZ_SAW = Uint8Array.from("53415700000000000000000000000000000001000000007f0001000000000000".match(/../g)!.map((x) => parseInt(x, 16)));
export function oszEintrag(name: string): Uint8Array {
  const e = OSZ_SAW.slice();
  e.fill(0, 0, 16);
  asc(e, 0, name.slice(0, 15));
  return e;
}
export function modEintrag(name: string): Uint8Array {
  const e = new Uint8Array(0x58);
  asc(e, 0, name.slice(0, 19));
  e[0x14] = 3; // Ziel Filter
  e[0x15] = 1;
  e[0x16] = 100;
  return e;
}

/** Ein LDR-Blockkopf (Signatur 0xAD, XOR aller 16 Bytes = 0). */
export function ldrKopf(flags: number, ziel: number, laenge: number): Uint8Array {
  const h = new Uint8Array(16);
  const dv = new DataView(h.buffer);
  dv.setUint32(0, ((0xad << 24) | flags) >>> 0, true);
  dv.setUint32(4, ziel >>> 0, true);
  dv.setUint32(8, laenge >>> 0, true);
  let x = 0;
  for (const b of h) x ^= b;
  h[2] = x;
  return h;
}
/** Kleine DSP-Kette: L1-Block 64 B, SDRAM-Block 32 B, Ende-Block. */
export function fakeDspKette(fw: Uint8Array, start: number): { l1: number; sdram: number } {
  fw.set(ldrKopf(0x0001, 0xff800000, 64), start);
  const l1 = start + 16;
  for (let i = 0; i < 64; i++) fw[l1 + i] = 0x10 + i;
  fw.set(ldrKopf(0x0001, 0x00002000, 32), l1 + 64);
  const sdram = l1 + 64 + 16;
  for (let i = 0; i < 32; i++) fw[sdram + i] = 0xa0 + i;
  fw.set(ldrKopf(0x0100 | 0x8000, 0x00010000, 4096), sdram + 32);
  return { l1, sdram };
}

function kopf(fw: Uint8Array, variante: Variante): void {
  asc(fw, 0, "KORG SYSTEM FILE");
  asc(fw, 0x10, variante === "sampler" ? "E2S" : "E2");
  asc(fw, OFF_TAG, "SYSTEM");
  fw[0x2a] = 2;
  fw[0x2b] = 2;
  fw[0x2d] = 0x01;
  fw[OFF_ID_LOW] = VARIANTEN[variante].idLow;
  fw[OFF_SUFFIX] = VARIANTEN[variante].suffix;
  fw.fill(0xff, 0x42, 0x100);
  // Vektortabelle: acht ldr pc,[pc,#0x18]
  for (let i = 0; i < 8; i++) setU32(fw, 0x100 + i * 4, 0xe59ff018);
}

function initBloecke(fw: Uint8Array, k: FirmwareKarte, name: string): void {
  const ip = dateiOffset(k.initPattern);
  asc(fw, ip, "PTST");
  asc(fw, ip + 0x10, name);
  asc(fw, ip + 0x3c00 - 4, "PTED");
  const ig = dateiOffset(k.initGlobal);
  asc(fw, ig, "GLST");
  fw[ig + 0x1f] = 0;
  fw[ig + 0x28] = 1;
  asc(fw, ig + 0xfc, "GLED");
}

export const STOCK_IFX_NAMEN = ["Punch", "Overdrive", "Distortion", "Decimator", "Bit Crusher", "Ring Modulator", "Sustainer", "Limiter"];
export const STOCK_MFX_NAMEN = ["Mod Delay", "Tape Delay", "High Pass Delay", "Hall Reverb"];
const stockIfxName = (i: number): string => STOCK_IFX_NAMEN[i] ?? `Werk IFX ${i + 1}`;
const stockMfxName = (i: number): string => STOCK_MFX_NAMEN[i] ?? `Werk MFX ${i + 1}`;

/** Wo die Stock-Fakes ihre gezeigten Preset-Bloecke ablegen (frei in beiden Layouts). */
export const STOCK_BLOCK_START = 0x150000;

function stockPresets(fw: Uint8Array, k: FirmwareKarte): void {
  let off = STOCK_BLOCK_START;
  for (let i = 0; i < k.ifxZeiger!.count; i++) {
    fw.set(presetBytes(stockIfxName(i)), off);
    setU32(fw, dateiOffset(k.ifxZeiger!.addr) + 4 * i, ramAdresse(off));
    off += 0x20c;
  }
  for (let i = 0; i < k.mfxZeiger!.count; i++) {
    fw.set(presetBytes(stockMfxName(i), true), off);
    setU32(fw, dateiOffset(k.mfxZeiger!.addr) + 4 * i, ramAdresse(off));
    off += 0x20c;
  }
  for (const z of k.ifxZaehler) fw[dateiOffset(z.addr)] = z.plusEins ? 38 : 37;
}

function tabellen(fw: Uint8Array, k: FirmwareKarte, oszAnzahl: number, modAnzahl: number): void {
  const o = k.oszTabelle!;
  fw.fill(0xff, dateiOffset(o.base), dateiOffset(o.base) + o.count * o.stride);
  for (let i = 0; i < oszAnzahl; i++) fw.set(oszEintrag(i === 0 ? "SAW" : `SAW ${i + 1}`), dateiOffset(o.base) + i * o.stride);
  const m = k.modTabelle!;
  fw.fill(0, dateiOffset(m.base), dateiOffset(m.base) + Math.min(m.count, 100) * m.stride);
  for (let i = 0; i < modAnzahl; i++) fw.set(modEintrag(i === 0 ? "EG+ Filter" : `Mod ${i + 1}`), dateiOffset(m.base) + i * m.stride);
}

/** Stock-Sampler: Zeigertabellen, 38/37-Zaehler, keine Groove-Bank, Osz 421 (hier 12), Mod 72 (hier 4), Startbild, DSP-Kette. */
export function fakeSamplerStock(): Uint8Array {
  const fw = new Uint8Array(VSB_TOTAL);
  const k = KARTE_SAMPLER_STOCK;
  kopf(fw, "sampler");
  initBloecke(fw, k, "Init Pattern");
  stockPresets(fw, k);
  tabellen(fw, k, 12, 4);
  fw.fill(0xff, dateiOffset(KARTE_HACKTRIBE.grooveBank!.base), dateiOffset(KARTE_HACKTRIBE.grooveBank!.base) + 96 * GROOVE_SIZE);
  fakeDspKette(fw, k.ldrStart!);
  return fw;
}

/** Stock-Synth: gleiche Bauart, andere Lage; kein Startbild. */
export function fakeSynthStock(): Uint8Array {
  const fw = new Uint8Array(VSB_TOTAL);
  const k = KARTE_SYNTH_STOCK;
  kopf(fw, "synth");
  initBloecke(fw, k, "Init Pattern");
  stockPresets(fw, k);
  tabellen(fw, k, 12, 4);
  fakeDspKette(fw, k.ldrStart!);
  return fw;
}

/**
 * Hacktribe: wie der Stock-Sampler (Init-Bloecke, DSP-Kette, Osz-/Mod-Tabelle
 * an den Stock-Stellen bleiben), dazu flache IFX-Bank (49 belegt), MFX-Bank,
 * Groove-Bank (62), Zaehler 48/49 und 61/62, Mod-Tabelle bei 0xC01A0000,
 * Osz-Beschreiber und Grenze.
 */
export function fakeHacktribe(opts: { ifxBelegt?: number; grooves?: number; oszAnzahl?: number; modAnzahl?: number } = {}): Uint8Array {
  const fw = fakeSamplerStock();
  const k = KARTE_HACKTRIBE;
  const ifxBelegt = opts.ifxBelegt ?? 49;
  const bank = k.ifxBank!;
  for (let s = 0; s < bank.count; s++) {
    const name = s < 38 ? stockIfxName(s) : s < ifxBelegt ? `Hack IFX ${s + 1}` : "";
    fw.set(presetBytes(name), dateiOffset(bank.base + s * bank.stride));
  }
  const mb = k.mfxBank!;
  for (let s = 0; s < mb.count; s++) fw.set(presetBytes(stockMfxName(s), true), dateiOffset(mb.base + s * mb.stride));
  for (const z of k.ifxZaehler) fw[dateiOffset(z.addr)] = z.plusEins ? ifxBelegt : ifxBelegt - 1;
  const gb = k.grooveBank!;
  const grooves = opts.grooves ?? 62;
  for (let s = 0; s < gb.count; s++) {
    const off = dateiOffset(gb.base + s * gb.stride);
    if (s < grooves) fw.set(grooveBytes(`Groove ${s + 1}`), off);
    else fw.fill(0xff, off, off + GROOVE_SIZE);
  }
  for (const z of k.grooveZaehler!) fw[dateiOffset(z.addr)] = z.plusEins ? grooves : grooves - 1;
  // Osz-Tabelle mit Beschreibern und Grenze wie in der echten Hacktribe-Datei
  const oszAnzahl = opts.oszAnzahl ?? 12;
  const o = k.oszTabelle!;
  fw.fill(0xff, dateiOffset(o.base), dateiOffset(o.base) + o.count * o.stride);
  for (let i = 0; i < oszAnzahl; i++) fw.set(oszEintrag(i === 0 ? "SAW" : `SAW ${i + 1}`), dateiOffset(o.base) + i * o.stride);
  for (const a of OSZ_ZEIGER_ADDRS) setU32(fw, dateiOffset(a), OSZ_TABELLE_ADDR);
  for (const z of oszZaehlerSchreibliste(oszAnzahl)) setU32(fw, dateiOffset(z.addr), z.wert);
  for (const a of OSZ_GRENZE_STELLEN) setU32(fw, dateiOffset(a), 0xe3500e11);
  // Mod-Tabelle bei 0xC01A0000 (72 Stock + Hacktribe-Anhang)
  const m = k.modTabelle!;
  const modAnzahl = opts.modAnzahl ?? 4;
  fw.fill(0, dateiOffset(m.base), dateiOffset(m.base) + 120 * m.stride);
  for (let i = 0; i < modAnzahl; i++) fw.set(modEintrag(i === 0 ? "EG+ Filter" : `Mod ${i + 1}`), dateiOffset(m.base) + i * m.stride);
  return fw;
}

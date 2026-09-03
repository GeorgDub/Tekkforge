import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initFxPresetPanel } from "../src/gui/fxPreset";
import { initPresetManager, pmAktion } from "../src/gui/presetManager";
import {
  initFirmwareWerkbank,
  fwBaueAbbild,
  fwBaueAusSicherung,
  fwSetzePixel,
  fwPixel,
  fwInitPatternName,
  fwTextSchreiben,
  fwBauplanText,
  fwBauplanLaden,
  fwDspPatches,
  fwDspWaehlen,
  fwDspAufnehmen,
  fwOszAnhaengen,
  fwOszFmSerie,
  fwOszEntfernen,
  fwOszNeu,
  fwGeraetVergleich,
} from "../src/gui/firmwareWerkbank";
import { LDR_START, hexZuBytes, type DspPatch } from "../src/core/dspPatch";
import { OSZ_TABELLE_ADDR, OSZ_LAUFZEIT_ADDR, OSZ_MAX, OSZ_ZEIGER_ADDRS, OSZ_GRENZE_STELLEN, oszZaehlerSchreibliste, oszOffset, oszVariante, decodeOsz, liesOsz, leseOszStandAusFirmware } from "../src/core/oszTabelle";
import { pmZustand } from "../src/gui/presetManager";
import { leseBauplan } from "../src/core/bauplan";
import { textBreite } from "../src/core/pixelSchrift";
import { baueSicherung } from "../src/core/geraetSicherung";
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes, FX_PRESET_SIZE } from "../src/core/e2FxPreset";
import { E2_RAM_MAP, addressForSlot } from "../src/core/hacktribeRam";
import { IFX_ZAEHLER } from "../src/core/ifxErweiterung";
import {
  VSB_GROESSE,
  dateiOffset,
  GROOVE_ZAEHLER,
  INIT_PATTERN_OFFSET,
  INIT_PATTERN_GROESSE,
  SPLASH_OFFSET,
  liesSplash,
  INIT_GLOBAL_OFFSET,
  INIT_GLOBAL_GROESSE,
} from "../src/core/firmwareBau";
import { leererBlock, nameVon } from "../src/core/presetManager";
import { initGrooveBytes, decodeGroove, encodeGroove, GROOVE_SIZE } from "../src/core/e2Groove";
import { buildE2PatternFile } from "../src/core/electribePatternBuilder";
import { baueSammlung } from "../src/core/sammlung";
import { SPLASH_BREITE, SPLASH_HOEHE, splashZuPixel } from "../src/core/splash";

/**
 * Die Firmware-Werkbank ueber den DOM-Stub: Basis laden, Bausteine anhaken,
 * Abbild bauen — Presets aus dem Manager, Grooves aus einer Sammlung, das
 * Editor-Pattern als Init-Pattern, das gemalte Startbild.
 */

type Listener = (e?: unknown) => void;

class StubElement {
  value = "";
  checked = false;
  textContent = "";
  innerHTML = "";
  files: unknown[] = [];
  dataset: Record<string, string> = {};
  href = "";
  download = "";
  width = 0;
  height = 0;
  readonly classList = {
    klassen: new Set<string>(),
    add: (k: string) => void this.classList.klassen.add(k),
    remove: (k: string) => void this.classList.klassen.delete(k),
    toggle: (k: string, an?: boolean) => {
      const soll = an ?? !this.classList.klassen.has(k);
      if (soll) this.classList.klassen.add(k);
      else this.classList.klassen.delete(k);
      return soll;
    },
    contains: (k: string) => this.classList.klassen.has(k),
  };
  private listeners = new Map<string, Listener[]>();
  addEventListener(typ: string, fn: Listener): void {
    const l = this.listeners.get(typ) ?? [];
    l.push(fn);
    this.listeners.set(typ, l);
  }
  feuere(typ: string): void {
    for (const fn of this.listeners.get(typ) ?? []) fn();
  }
  querySelectorAll(): StubElement[] {
    return [];
  }
  click(): void {
    this.feuere("click");
  }
}

const elemente = new Map<string, StubElement>();
const el = (id: string): StubElement => {
  let e = elemente.get(id);
  if (!e) {
    e = new StubElement();
    elemente.set(id, e);
  }
  return e;
};
const g = globalThis as unknown as { document?: unknown; URL: { createObjectURL?: unknown; revokeObjectURL?: unknown } };

const warte = () => new Promise((r) => setTimeout(r, 0));

function presetBytes(name: string, mfx = false): Uint8Array {
  const p = decodeFxPreset(initFxPresetBytes(), mfx);
  p.name = name;
  return encodeFxPreset(p);
}
function grooveBytes(name: string): Uint8Array {
  const gv = decodeGroove(initGrooveBytes());
  gv.name = name;
  return encodeGroove(gv);
}
const fakeDatei = (name: string, bytes: Uint8Array): File =>
  ({ name, arrayBuffer: async () => bytes.slice().buffer, text: async () => new TextDecoder().decode(bytes) }) as unknown as File;
const fakeTextDatei = (name: string, text: string): File => ({ name, text: async () => text }) as unknown as File;

const ifxMap = E2_RAM_MAP.find((e) => e.key === "ifxPreset")!;
const mfxMap = E2_RAM_MAP.find((e) => e.key === "mfxPreset")!;
const grooveMap = E2_RAM_MAP.find((e) => e.key === "groove")!;

/** Ein LDR-Blockkopf (Signatur 0xAD, XOR aller 16 Bytes = 0). */
function ldrKopf(flags: number, ziel: number, laenge: number): Uint8Array {
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
/** Eine kleine DSP-Kette: ein L1-Block (64 Bytes 0x10…0x4F), ein SDRAM-Block (32 Bytes 0xA0…0xBF), Ende. */
const DSP_L1 = LDR_START + 16;
const DSP_SDRAM = DSP_L1 + 64 + 16;
function fakeDspKette(fw: Uint8Array): void {
  fw.set(ldrKopf(0x0001, 0xff800000, 64), LDR_START);
  for (let i = 0; i < 64; i++) fw[DSP_L1 + i] = 0x10 + i;
  fw.set(ldrKopf(0x0001, 0x00002000, 32), DSP_L1 + 64);
  for (let i = 0; i < 32; i++) fw[DSP_SDRAM + i] = 0xa0 + i;
  fw.set(ldrKopf(0x0100 | 0x8000, 0x00010000, 4096), DSP_SDRAM + 32);
}

const OSZ_SAW = Uint8Array.from("53415700000000000000000000000000000001000000007f0001000000000000".match(/../g)!.map((x) => parseInt(x, 16)));
const OSZ_XSAW = Uint8Array.from("582d534157202d3234000000000000000a0019000000004420010000c1000000".match(/../g)!.map((x) => parseInt(x, 16)));
const setU32 = (b: Uint8Array, off: number, v: number): void => {
  b[off] = v & 0xff;
  b[off + 1] = (v >>> 8) & 0xff;
  b[off + 2] = (v >>> 16) & 0xff;
  b[off + 3] = (v >>> 24) & 0xff;
};
/** Oszillator-Tabelle: 1 = SAW, 2 = X-SAW -24, 3…10 SAW-Varianten; Beschreiber auf 10. */
function fakeOszTabelle(fw: Uint8Array): void {
  fw.fill(0xff, oszOffset(1), oszOffset(OSZ_MAX) + 32);
  fw.set(OSZ_SAW, oszOffset(1));
  fw.set(OSZ_XSAW, oszOffset(2));
  for (let p = 3; p <= 10; p++) fw.set(oszVariante(OSZ_SAW, { name: `SAW ${p}` }), oszOffset(p));
  for (const a of OSZ_ZEIGER_ADDRS) setU32(fw, dateiOffset(a), OSZ_TABELLE_ADDR);
  for (const z of oszZaehlerSchreibliste(10)) setU32(fw, dateiOffset(z.addr), z.wert);
  // die drei cmp r0,#272 (Oszillator-Grenze) wie in der Hacktribe-Firmware
  for (const a of OSZ_GRENZE_STELLEN) setU32(fw, dateiOffset(a), 0xe3500e11);
}

/** Ein Abbild wie die Hacktribe-Firmware: 49 IFX, 32 MFX, 62 Grooves, Init-Pattern, leeres Startbild, kleine DSP-Kette, Oszillator-Tabelle. */
function fakeFirmware(): Uint8Array {
  const fw = new Uint8Array(VSB_GROESSE);
  fakeDspKette(fw);
  fakeOszTabelle(fw);
  fw.set(new TextEncoder().encode("KORG SYSTEM FILE"), 0);
  fw.set(new TextEncoder().encode("E2S"), 0x10);
  for (let s = 0; s < ifxMap.count; s++) fw.set(s < 49 ? presetBytes(`Werk ${s + 1}`) : leererBlock("ifx"), dateiOffset(addressForSlot(ifxMap, s)));
  for (let s = 0; s < mfxMap.count; s++) fw.set(presetBytes(`Master ${s + 1}`, true), dateiOffset(addressForSlot(mfxMap, s)));
  for (const z of IFX_ZAEHLER) fw[dateiOffset(z.addr)] = z.plusEins ? 49 : 48;
  for (let s = 0; s < grooveMap.count; s++) {
    const off = dateiOffset(addressForSlot(grooveMap, s));
    if (s < 62) fw.set(grooveBytes(`Groove ${s + 1}`), off);
    else fw.fill(0xff, off, off + GROOVE_SIZE);
  }
  for (const z of GROOVE_ZAEHLER) fw[dateiOffset(z.addr)] = z.plusEins ? 62 : 61;
  const init = new Uint8Array(buildE2PatternFile({ name: "WERK INIT", parts: [] } as never));
  fw.set(init.subarray(0x100, 0x100 + INIT_PATTERN_GROESSE), INIT_PATTERN_OFFSET);
  fw.fill(0x00, SPLASH_OFFSET, SPLASH_OFFSET + 1024);
  const gl = new Uint8Array(INIT_GLOBAL_GROESSE);
  gl.set(new TextEncoder().encode("GLST"), 0);
  gl.set(new TextEncoder().encode("GLED"), 0xfc);
  fw.set(gl, INIT_GLOBAL_OFFSET);
  return fw;
}

async function basisLaden(fw: Uint8Array): Promise<void> {
  el("fwBasisInfo").textContent = "";
  el("fwBasisIn").files = [fakeDatei("SYSTEM.VSB", fw)];
  el("fwBasisIn").feuere("change");
  // Die Anzeige entsteht erst nach dem asynchronen Hash — darauf warten, nicht Ticks zaehlen.
  for (let i = 0; i < 100 && !el("fwBasisInfo").textContent; i++) await new Promise((r) => setTimeout(r, 2));
}

beforeEach(() => {
  elemente.clear();
  g.document = {
    getElementById: (id: string) => el(id),
    createElement: () => new StubElement(),
  };
  g.URL.createObjectURL = () => "blob:x";
  g.URL.revokeObjectURL = () => undefined;
  const hooks = {
    lesen: async () => ({ ok: true as const, bytes: presetBytes("GERAETPRESET") }),
    schreiben: async () => true,
  };
  initFxPresetPanel(hooks);
  initPresetManager(hooks);
  initFirmwareWerkbank({
    aktuellesPattern: () => ({ name: "TEKK INIT", bytes: new Uint8Array(buildE2PatternFile({ name: "TEKK INIT", parts: [] } as never)) }),
  });
  el("fwPresets").checked = true;
  el("fwInitQuelle").value = "editor";
  el("fwSplashSchwelle").value = "128";
});

afterEach(() => {
  delete g.document;
});

describe("Firmware-Werkbank", () => {
  it("lehnt eine Datei ohne stimmige Struktur ab und meldet den Grund", async () => {
    const kaputt = fakeFirmware();
    kaputt[dateiOffset(0xc004a1f8)] = 47;
    await basisLaden(kaputt);
    expect(el("fwBasisInfo").textContent).toMatch(/abgelehnt/);
    expect(fwBaueAbbild().ok).toBe(false);
  });

  it("nimmt eine Basis mit stimmiger Struktur an und beschreibt sie", async () => {
    await basisLaden(fakeFirmware());
    expect(el("fwBasisInfo").textContent).toMatch(/IFX-Menü bis 49, Grooves bis 62, Init-Pattern „WERK INIT“/);
  });

  it("ein Manager ohne geladenen Stand schreibt KEINE Presets — die leere Bank ist nur Vorschau", async () => {
    await basisLaden(fakeFirmware());
    el("fwPresets").checked = true;
    el("fwSplash").checked = true; // damit es ueberhaupt etwas zu bauen gibt
    const r = fwBaueAbbild();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const off = dateiOffset(addressForSlot(ifxMap, 0));
    expect(nameVon(r.bytes.subarray(off, off + FX_PRESET_SIZE))).toBe("Werk 1");
    for (const z of IFX_ZAEHLER) expect(r.bytes[dateiOffset(z.addr)]).toBe(z.plusEins ? 49 : 48);
    expect(r.zeilen.join("\n")).toMatch(/kein Stand geladen/);
  });

  it("ohne angehakten Baustein gibt es nichts zu bauen", async () => {
    await basisLaden(fakeFirmware());
    el("fwPresets").checked = false;
    const r = fwBaueAbbild();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/nichts zu bauen/);
  });

  it("Presets aus dem Manager: die Unterschiede zur DATEI werden eingebrannt, das Menü nachgezogen", async () => {
    const fw = fakeFirmware();
    await basisLaden(fw);
    // Manager laedt dieselbe Firmware als Stand und legt Platz 50 neu
    el("pmFirmwareIn").files = [fakeDatei("SYSTEM.VSB", fw)];
    el("pmFirmwareIn").feuere("change");
    await warte();
    el("pmDateiIn").files = [fakeDatei("ring-lfo.e2fxp", presetBytes("Ring LFO"))];
    el("pmDateiIn").feuere("change");
    await warte();
    await pmAktion("name", "mfx", 3, "Neu M3");
    const r = fwBaueAbbild();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const off = dateiOffset(addressForSlot(ifxMap, 49));
    expect(nameVon(r.bytes.subarray(off, off + FX_PRESET_SIZE))).toBe("Ring LFO");
    const offM = dateiOffset(addressForSlot(mfxMap, 2));
    expect(nameVon(r.bytes.subarray(offM, offM + FX_PRESET_SIZE))).toBe("Neu M3");
    for (const z of IFX_ZAEHLER) expect(r.bytes[dateiOffset(z.addr)]).toBe(z.plusEins ? 50 : 49);
    expect(r.zeilen.join("\n")).toMatch(/IFX-Menü: bis 49 → bis 50/);
  });

  it("Grooves aus einer Sammlung mit Platz, Zaehler nachgezogen", async () => {
    await basisLaden(fakeFirmware());
    el("fwPresets").checked = false;
    const text = baueSammlung(
      [
        { art: "groove", name: "Swing A", bytes: grooveBytes("Swing A"), platz: 63 },
        { art: "groove", name: "Ohne", bytes: grooveBytes("Ohne") },
      ],
      { titel: "Grooves" },
    );
    el("fwGrooveIn").files = [fakeTextDatei("g.tfsam", text)];
    el("fwGrooveIn").feuere("change");
    await warte();
    expect(el("fwGroovesInfo").textContent).toMatch(/1 mit Platz, 1 ohne Platz/);
    expect(el("fwGrooves").checked).toBe(true);
    const r = fwBaueAbbild();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const off = dateiOffset(addressForSlot(grooveMap, 62));
    expect(decodeGroove(r.bytes.subarray(off, off + GROOVE_SIZE)).name).toBe("Swing A");
    for (const z of GROOVE_ZAEHLER) expect(r.bytes[dateiOffset(z.addr)]).toBe(z.plusEins ? 63 : 62);
  });

  it("Init-Pattern aus dem Editor und das gemalte Startbild landen im Abbild", async () => {
    await basisLaden(fakeFirmware());
    el("fwPresets").checked = false;
    el("fwInit").checked = true;
    el("fwSplash").checked = true;
    const px = new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE);
    px[0] = 1;
    px[63 * SPLASH_BREITE + 127] = 1;
    fwSetzePixel(px);
    expect(Array.from(fwPixel())).toEqual(Array.from(px));
    const r = fwBaueAbbild();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(fwInitPatternName(r.bytes)).toBe("TEKK INIT");
    expect(Array.from(splashZuPixel(liesSplash(r.bytes)))).toEqual(Array.from(px));
    expect(r.zeilen.join("\n")).toMatch(/Init-Pattern: „TEKK INIT“ aus dem Editor/);
    expect(r.zeilen.join("\n")).toMatch(/2 dunkle Pixel/);
  });

  it("Sicherung einbrennen: der ganze Geraetestand kommt in die Basis, Zaehler wie am Geraet", async () => {
    await basisLaden(fakeFirmware());
    const ifx = new Uint8Array(100 * FX_PRESET_SIZE);
    for (let i = 0; i < 100; i++) ifx.set(i < 55 ? presetBytes(`RAM ${i + 1}`) : leererBlock("ifx"), i * FX_PRESET_SIZE);
    const mfx = new Uint8Array(32 * FX_PRESET_SIZE);
    for (let i = 0; i < 32; i++) mfx.set(presetBytes(`RAM M${i + 1}`, true), i * FX_PRESET_SIZE);
    const gv = new Uint8Array(96 * GROOVE_SIZE).fill(0xff);
    for (let i = 0; i < 62; i++) gv.set(grooveBytes(`G${i + 1}`), i * GROOVE_SIZE);
    const splash = new Uint8Array(1024).fill(0x00);
    splash[5] = 0x00;
    const text = baueSicherung(
      [
        { key: "ifxPreset", label: "IFX", adresse: ifxMap.base, laenge: ifx.length, bytes: ifx },
        { key: "mfxPreset", label: "MFX", adresse: mfxMap.base, laenge: mfx.length, bytes: mfx },
        { key: "groove", label: "Groove", adresse: grooveMap.base, laenge: gv.length, bytes: gv },
        { key: "maxIfxIndex", label: "Max", adresse: 0xc0048f80, laenge: 1, bytes: new Uint8Array([54]) },
        { key: "grooveMaxIndex", label: "GMax", adresse: 0xc007bb88, laenge: 1, bytes: new Uint8Array([62]) },
        { key: "splash", label: "Splash", adresse: 0xc00f9854, laenge: 1024, bytes: splash },
      ],
      { geraet: "E2S", firmware: "hacktribe", wann: "2026-09-03T00:00:00.000Z" },
    );
    const r = fwBaueAusSicherung(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const off = dateiOffset(addressForSlot(ifxMap, 54));
    expect(nameVon(r.bytes.subarray(off, off + FX_PRESET_SIZE))).toBe("RAM 55");
    for (const z of IFX_ZAEHLER) expect(r.bytes[dateiOffset(z.addr)]).toBe(z.plusEins ? 55 : 54);
    for (const z of GROOVE_ZAEHLER) expect(r.bytes[dateiOffset(z.addr)]).toBe(z.plusEins ? 62 : 61);
    expect(r.bytes[SPLASH_OFFSET + 5]).toBe(0x00);
    expect(fwInitPatternName(r.bytes)).toBe("WERK INIT"); // nicht in der Sicherung → aus der Basis
    expect(r.zeilen.join("\n")).toMatch(/bleibt aus der Basis: initPattern/);
    expect(fwBaueAusSicherung("kein json").ok).toBe(false);
  });

  it("Text schreiben: die Pixelschrift landet zentriert im Startbild und damit im Abbild", async () => {
    await basisLaden(fakeFirmware());
    el("fwPresets").checked = false;
    el("fwSplash").checked = true;
    fwSetzePixel(new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE));
    fwTextSchreiben("TEKK", 2, "mitte");
    const px = fwPixel();
    const dunkel = px.reduce((a, b) => a + b, 0);
    expect(dunkel).toBeGreaterThan(40);
    // zentriert: links und rechts vom Text gleich viel Luft (±1), Zeile 25..38
    const b = textBreite("TEKK", 2);
    const x0 = Math.floor((SPLASH_BREITE - b) / 2);
    expect(px[25 * SPLASH_BREITE + x0]).toBe(1); // T-Balken beginnt hier
    expect(px[25 * SPLASH_BREITE + x0 - 1]).toBe(0);
    expect(px[10 * SPLASH_BREITE + 64]).toBe(0); // darueber leer
    const r = fwBaueAbbild();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.from(splashZuPixel(liesSplash(r.bytes)))).toEqual(Array.from(px));
    expect(el("fwStatus").textContent).toMatch(/„TEKK“ geschrieben/);
    fwTextSchreiben("   ", 2, "mitte");
    expect(el("fwStatus").textContent).toMatch(/Erst einen Text/);
  });

  it("DSP-Patches: das Register steht in der Liste, ein eigener Patch wird eingebrannt, ein fremder klar abgelehnt, der Bauplan nimmt ihn mit", async () => {
    await basisLaden(fakeFirmware());
    expect(fwDspPatches().length).toBeGreaterThanOrEqual(11);
    expect(el("fwDspListe").innerHTML).toMatch(/data-dsp="bf523_coslut_zero"/);
    expect(el("fwDspListe").innerHTML).toMatch(/passt nicht zur Basis/); // Register-Patches gehoeren zur echten Hacktribe-Datei
    el("fwPresets").checked = false;

    // Register-Patch auf die Fake-Basis: sauber abgelehnt, nichts gebaut
    fwDspWaehlen("bf523_coslut_zero", true);
    const ab = fwBaueAbbild();
    expect(ab.ok).toBe(false);
    if (!ab.ok) expect(ab.reason).toMatch(/Wellentabelle nullen/);
    fwDspWaehlen("bf523_coslut_zero", false);
    expect(fwBaueAbbild().ok).toBe(false); // nichts angehakt

    // eigener Patch mit Adresse im SDRAM-Block: Bytes 4..7
    const eigen: DspPatch = { id: "probe", titel: "Probe", beschreibung: "", quelle: "test", status: "hoerprobe-offen", edits: [{ vaddr: 0x2004, alt: hexZuBytes("a4a5a6a7"), neu: hexZuBytes("01020304") }] };
    fwDspAufnehmen(eigen);
    expect(el("fwDspListe").innerHTML).toMatch(/data-dsp="probe" checked/);
    const r = fwBaueAbbild();
    expect(r.ok, r.ok ? "" : r.reason).toBe(true);
    if (!r.ok) return;
    expect(Array.from(r.bytes.subarray(DSP_SDRAM + 4, DSP_SDRAM + 8))).toEqual([1, 2, 3, 4]);
    expect(r.zeilen.join("\n")).toMatch(/DSP-Patches \(⚠ experimentell\): Probe/);
    // Kette drumherum unangetastet
    expect(Array.from(r.bytes.subarray(LDR_START, LDR_START + 16))).toEqual(Array.from(fakeFirmware().subarray(LDR_START, LDR_START + 16)));

    // Bauplan: Patch drin, nach frischem Start wieder da und angehakt
    const b = fwBauplanText("DSP-Probe");
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    expect(leseBauplan(b.text).dsp?.map((p) => p.id)).toEqual(["probe"]);
    initFirmwareWerkbank({ aktuellesPattern: () => ({ name: "X", bytes: new Uint8Array(buildE2PatternFile({ name: "X", parts: [] } as never)) }) });
    expect(fwDspPatches().some((p) => p.id === "probe")).toBe(false);
    await basisLaden(fakeFirmware());
    const l = fwBauplanLaden(b.text, "dsp.tfbau");
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(l.zeilen.join("\n")).toMatch(/DSP-Patches: 1 übernommen/);
    el("fwPresets").checked = false;
    const wieder = fwBaueAbbild();
    expect(wieder.ok).toBe(true);
    if (wieder.ok) expect(wieder.bytes[DSP_SDRAM + 4]).toBe(1);

    // Patch-Datei ueber den Knopf: Omnitribes Listenform
    el("fwDspIn").files = [fakeTextDatei("meiner.json", JSON.stringify([{ vaddr: "0xFF800010", old: "20212223", new: "00000000", label: "L1-Probe" }]))];
    el("fwDspIn").feuere("change");
    await warte();
    expect(fwDspPatches().some((p) => p.id === "meiner" && p.beschreibung === "L1-Probe")).toBe(true);
    const drei = fwBaueAbbild();
    expect(drei.ok).toBe(true);
    if (drei.ok) expect(drei.bytes[DSP_L1 + 0x10]).toBe(0);
    expect(fwBaueAbbild().ok).toBe(true);
  });

  it("Oszillator-Varianten: Vorlagen aus der Basis, anhaengen ab 11, FM-Serie, bauen zieht die Beschreiber nach, Bauplan nimmt sie mit, fluechtig schreibt Eintraege und Zellen", async () => {
    const schreibungen: { addr: number; bytes: number[] }[] = [];
    const fw = fakeFirmware();
    initFirmwareWerkbank({
      aktuellesPattern: () => ({ name: "X", bytes: new Uint8Array(buildE2PatternFile({ name: "X", parts: [] } as never)) }),
      lesen: async (addr, len) => ({ ok: true as const, bytes: fw.slice(dateiOffset(addr), dateiOffset(addr) + len) }),
      schreiben: async (addr, bytes) => {
        schreibungen.push({ addr, bytes: Array.from(bytes) });
        return true;
      },
    });
    await basisLaden(fw);
    expect(el("fwOszInfo").textContent).toMatch(/10 belegt, 411 frei/);
    expect(el("fwOszVorlage").innerHTML).toMatch(/<option value="2">2: X-SAW -24 \(FM\)/);
    el("fwPresets").checked = false;

    expect(fwOszAnhaengen(99, "X", 0)).toMatchObject({ ok: false });
    expect(fwOszAnhaengen(1, "  ", 0)).toMatchObject({ ok: false, reason: expect.stringMatching(/Name/) });
    expect(fwOszAnhaengen(1, "SAW LEISE", undefined, 40)).toEqual({ ok: true, platz: 11 });
    expect(fwOszAnhaengen(2, "X-SAW -7", -28)).toEqual({ ok: true, platz: 12 });
    expect(el("fwOsz").checked).toBe(true);
    expect(el("fwOszListe").innerHTML).toMatch(/12.*X-SAW -7.*-7 Halbtöne \(-28\)/);
    // Serie nur fuer FM — und nur die Halbtoene, die es fuer das Programm noch nicht gibt (−24 in der Basis, −7 vorgemerkt)
    expect(fwOszFmSerie(1)).toMatchObject({ ok: false, reason: expect.stringMatching(/kein FM/) });
    expect(fwOszFmSerie(2)).toEqual({ ok: true, anzahl: 47 });
    expect(fwOszNeu()).toHaveLength(49);
    expect(decodeOsz(fwOszNeu()[2].bytes)).toMatchObject({ name: "X-SAW -23", parameter: -62 });
    expect(el("fwOszListe").innerHTML).toMatch(/X-SAW -23.*-23 Halbtöne \(-62, geschätzt\)/);
    expect(fwOszNeu().map((o) => decodeOsz(o.bytes).name)).not.toContain("X-SAW -24");
    expect(fwOszNeu().filter((o) => decodeOsz(o.bytes).name === "X-SAW -7")).toHaveLength(1);
    expect(fwOszFmSerie(2)).toEqual({ ok: true, anzahl: 0 }); // zweimal aendert nichts
    fwOszEntfernen(0); // SAW LEISE weg → alles rueckt auf
    expect(fwOszNeu()[0]).toMatchObject({ platz: 11 });
    expect(decodeOsz(fwOszNeu()[0].bytes).name).toBe("X-SAW -7");
    expect(fwOszNeu()).toHaveLength(48);

    const r = fwBaueAbbild();
    expect(r.ok, r.ok ? "" : r.reason).toBe(true);
    if (!r.ok) return;
    expect(leseOszStandAusFirmware(r.bytes)).toEqual({ ok: true, anzahl: 58 });
    expect(decodeOsz(liesOsz(r.bytes, 11))).toMatchObject({ name: "X-SAW -7", parameter: -28, kategorie: 0x0a, programm: 25 });
    expect(r.zeilen.join("\n")).toMatch(/Oszillatoren: 48 Variante\(n\) auf 11–58/);
    expect(r.zeilen.join("\n")).toMatch(/Oszillator-Tabelle: Liste bis 10 → bis 58/);

    // Bauplan hin und zurueck
    const b = fwBauplanText("Osz");
    expect(b.ok).toBe(true);
    if (!b.ok) return;
    const plan = leseBauplan(b.text);
    expect(plan.osz).toHaveLength(48);
    expect(plan.osz?.[0]).toMatchObject({ platz: 11 });
    initFirmwareWerkbank({ aktuellesPattern: () => ({ name: "X", bytes: new Uint8Array(buildE2PatternFile({ name: "X", parts: [] } as never)) }) });
    await basisLaden(fakeFirmware());
    const l = fwBauplanLaden(b.text, "osz.tfbau");
    expect(l.ok).toBe(true);
    expect(fwOszNeu()).toHaveLength(48);
    expect(el("fwOsz").checked).toBe(true);

    // Fluechtig: erst die Laufzeitkopie (die Anzeige liest sie), dann die Tabelle im Abbild, dann vier Zellen (Bytes, Anzahl, Bytes, Anzahl).
    // Das „Geraet“ liefert die Laufzeitkopie aus derselben Tabelle wie das Abbild — so, wie der Start sie anlegt.
    let laufzeitKopie = (addr: number, len: number): Uint8Array => {
      const o = dateiOffset(OSZ_TABELLE_ADDR + (addr - OSZ_LAUFZEIT_ADDR));
      return fw.slice(o, o + len);
    };
    initFirmwareWerkbank({
      aktuellesPattern: () => ({ name: "X", bytes: new Uint8Array(buildE2PatternFile({ name: "X", parts: [] } as never)) }),
      lesen: async (addr, len) => ({
        ok: true as const,
        bytes: addr >= OSZ_LAUFZEIT_ADDR && addr < OSZ_LAUFZEIT_ADDR + OSZ_MAX * 32 ? laufzeitKopie(addr, len) : fw.slice(dateiOffset(addr), dateiOffset(addr) + len),
      }),
      schreiben: async (addr, bytes) => {
        schreibungen.push({ addr, bytes: Array.from(bytes) });
        return true;
      },
    });
    await basisLaden(fw);
    fwOszAnhaengen(2, "X-SAW -1", -3);
    el("fwOszGeraet").feuere("click");
    await warte();
    await warte();
    // Der DOM-Stub behaelt die Klick-Handler frueherer Inits — deshalb nach Adresse pruefen, nicht nach Reihenfolge der Laeufe.
    expect([...new Set(schreibungen.map((s) => s.addr))]).toEqual([OSZ_LAUFZEIT_ADDR + 10 * 32, OSZ_TABELLE_ADDR + 10 * 32, 0xc004e3bc, 0xc004e3c0, 0xc004faf8, 0xc004fafc]);
    const nachAddr = new Map(schreibungen.map((s) => [s.addr, s.bytes]));
    expect(nachAddr.get(0xc004e3bc)).toEqual([(11 * 32) & 0xff, (11 * 32) >> 8, 0, 0]);
    expect(nachAddr.get(0xc004e3c0)).toEqual([11, 0, 0, 0]);
    expect(nachAddr.get(OSZ_TABELLE_ADDR + 10 * 32)?.slice(0, 8)).toEqual(Array.from(new TextEncoder().encode("X-SAW -1")));
    expect(nachAddr.get(OSZ_LAUFZEIT_ADDR + 10 * 32)).toEqual(nachAddr.get(OSZ_TABELLE_ADDR + 10 * 32));

    // Passt die Laufzeitkopie nicht zur Basis (Platz 1 dort heisst anders), wird nichts geschrieben.
    schreibungen.length = 0;
    // basisLaden leert die Vormerkliste, sobald der Hash fertig ist — deshalb hier neu vormerken.
    expect(fwOszAnhaengen(2, "X-SAW -1", -3)).toMatchObject({ ok: true });
    laufzeitKopie = () => oszVariante(OSZ_SAW, { name: "FREMD" });
    el("fwOszGeraet").feuere("click");
    await warte();
    await warte();
    expect(schreibungen).toEqual([]);
    expect(el("fwStatus").textContent).toMatch(/Laufzeitkopie.*FREMD.*nichts geschrieben/);
    // (Die Statuszeile ist hier nicht belastbar: basisLaden setzt sie nach dem asynchronen Hash noch einmal.)
  });

  it("Bauplan: sichern nimmt die angehakten Bausteine mit, laden legt sie zurueck in Manager und Werkbank", async () => {
    const fw = fakeFirmware();
    await basisLaden(fw);
    // Manager mit demselben Stand, ein Preset auf 50; Startbild gemalt; Init aus dem Editor
    el("pmFirmwareIn").files = [fakeDatei("SYSTEM.VSB", fw)];
    el("pmFirmwareIn").feuere("change");
    await warte();
    el("pmDateiIn").files = [fakeDatei("ring-lfo.e2fxp", presetBytes("Ring LFO"))];
    el("pmDateiIn").feuere("change");
    await warte();
    el("fwPresets").checked = true;
    el("fwInit").checked = true;
    el("fwSplash").checked = true;
    const px = new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE);
    px[7] = 1;
    fwSetzePixel(px);
    const r = fwBauplanText("Mein Umbau");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const plan = leseBauplan(r.text);
    expect(plan.eintraege.map((e) => `${e.art}:${e.platz}:${e.name}`)).toEqual(["ifx:50:Ring LFO"]);
    expect(plan.initPattern).toBeDefined();
    expect(plan.splash?.[0]).toBe(0x00); // Pixel 7 in Zeile 0 → Byte 7, nicht Byte 0
    expect(plan.splash?.[7]).toBe(0x80);

    // Frisch starten, Basis laden, Bauplan laden: alles wieder da
    initFirmwareWerkbank({ aktuellesPattern: () => ({ name: "X", bytes: new Uint8Array(buildE2PatternFile({ name: "X", parts: [] } as never)) }) });
    await basisLaden(fakeFirmware());
    await pmAktion("weg", "ifx", 50); // Manager: Platz 50 wieder leer
    const l = fwBauplanLaden(r.text, "test.tfbau");
    expect(l.ok).toBe(true);
    if (!l.ok) return;
    expect(nameVon(pmZustand()!.ifx[49])).toBe("Ring LFO");
    expect(el("fwInit").checked).toBe(true);
    expect(el("fwInitQuelle").value).toBe("datei");
    expect(el("fwSplash").checked).toBe(true);
    expect(fwPixel()[7]).toBe(1);
    expect(l.zeilen.join("\n")).toMatch(/1 in den Manager gelegt/);
    const gebaut = fwBaueAbbild();
    expect(gebaut.ok).toBe(true);
    if (!gebaut.ok) return;
    expect(fwInitPatternName(gebaut.bytes)).toBe("TEKK INIT");
    expect(gebaut.bytes[SPLASH_OFFSET + 7]).toBe(0x80);
    expect(fwBauplanLaden("kaputt", "x").ok).toBe(false);
  });

  it("Init-Pattern aus einer Datei; „aus Firmware“ holt das Startbild der Basis", async () => {
    const fw = fakeFirmware();
    fw[SPLASH_OFFSET] = 0x80; // Pixel (0,0) dunkel
    await basisLaden(fw);
    el("fwPresets").checked = false;
    const datei = new Uint8Array(buildE2PatternFile({ name: "AUS DATEI", parts: [] } as never));
    el("fwInitIn").files = [fakeDatei("init.e2spat", datei)];
    el("fwInitIn").feuere("change");
    await warte();
    expect(el("fwInitQuelle").value).toBe("datei");
    expect(el("fwInit").checked).toBe(true);
    el("fwSplashAusFw").feuere("click");
    expect(fwPixel()[0]).toBe(1);
    el("fwSplash").checked = true;
    const r = fwBaueAbbild();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(fwInitPatternName(r.bytes)).toBe("AUS DATEI");
    expect(r.bytes[SPLASH_OFFSET]).toBe(0x80);
  });

  it("Init-Global aus einer Datei landet im Abbild; eine falsche Datei wird abgelehnt", async () => {
    await basisLaden(fakeFirmware());
    el("fwPresets").checked = false;
    const gl = new Uint8Array(INIT_GLOBAL_GROESSE);
    gl.set(new TextEncoder().encode("GLST"), 0);
    gl[0x28] = 2;
    gl.set(new TextEncoder().encode("GLED"), 0xfc);
    el("fwGlobalIn").files = [fakeDatei("global.bin", gl)];
    el("fwGlobalIn").feuere("change");
    await warte();
    expect(el("fwGlobal").checked).toBe(true);
    expect(el("fwGlobalInfo").textContent).toMatch(/global\.bin \(Chain 0, Clock 2\)/);
    const r = fwBaueAbbild();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bytes[INIT_GLOBAL_OFFSET + 0x28]).toBe(2);
    el("fwGlobalIn").files = [fakeDatei("kaputt.bin", new Uint8Array(256))];
    el("fwGlobalIn").feuere("change");
    await warte();
    expect(el("fwStatus").textContent).toMatch(/kein Global-Block/);
  });
  it("Gerät ↔ Basis: Laufzeitkopie, Beschreiber, Grenze und Modulationstabelle vom Geraet gegen die Basis", async () => {
    const fw = fakeFirmware();
    const geraet = fw.slice();
    // am „Geraet“: Platz 3 heisst anders, die Grenze steht auf 272
    geraet.set(oszVariante(OSZ_SAW, { name: "FREMD 3" }), oszOffset(3));
    const lesen = async (addr: number, len: number) => {
      if (addr >= OSZ_LAUFZEIT_ADDR && addr < OSZ_LAUFZEIT_ADDR + OSZ_MAX * 32) {
        const o = dateiOffset(OSZ_TABELLE_ADDR + (addr - OSZ_LAUFZEIT_ADDR));
        return { ok: true as const, bytes: geraet.slice(o, o + len) };
      }
      if (addr >= 0xc01a0000 && addr < 0xc01a0000 + 0x20000) return { ok: true as const, bytes: new Uint8Array(len).fill(0xff) };
      return { ok: true as const, bytes: geraet.slice(dateiOffset(addr), dateiOffset(addr) + len) };
    };
    initFirmwareWerkbank({ aktuellesPattern: () => ({ name: "X", bytes: new Uint8Array(buildE2PatternFile({ name: "X", parts: [] } as never)) }), lesen });
    await basisLaden(fw);
    const z = await fwGeraetVergleich();
    const text = z.join("\n");
    expect(text).toMatch(/Gerät zählt 10, Basis 10/);
    expect(text).toMatch(/1 „SAW“ … 10 „SAW 10“/);
    expect(text).toMatch(/1 Platz\/Plätze anders.*3: Gerät „FREMD 3“ ↔ Basis „SAW 3“/);
    expect(text).toMatch(/Grenze im Code: 272 ✓/);
    expect(text).toMatch(/Modulationstypen am Gerät: 0 \(Basis 0\)/);
    expect(el("fwStatus").textContent).toMatch(/10 Oszillatoren \(1 anders\), Grenze 272, 0 Modulationstypen/);
    // ohne Leseweg
    initFirmwareWerkbank({ aktuellesPattern: () => ({ name: "X", bytes: new Uint8Array(buildE2PatternFile({ name: "X", parts: [] } as never)) }) });
    await basisLaden(fw);
    expect((await fwGeraetVergleich()).length).toBe(0);
    expect(el("fwStatus").textContent).toMatch(/Kein Geräte-Leseweg/);
  });
});

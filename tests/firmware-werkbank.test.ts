import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initFxPresetPanel } from "../src/gui/fxPreset";
import { initPresetManager, pmAktion } from "../src/gui/presetManager";
import { initFirmwareWerkbank, fwBaueAbbild, fwBaueAusSicherung, fwSetzePixel, fwPixel, fwInitPatternName, fwTextSchreiben } from "../src/gui/firmwareWerkbank";
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

/** Ein Abbild wie die Hacktribe-Firmware: 49 IFX, 32 MFX, 62 Grooves, Init-Pattern, leeres Startbild. */
function fakeFirmware(): Uint8Array {
  const fw = new Uint8Array(VSB_GROESSE);
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
  fw.fill(0xff, SPLASH_OFFSET, SPLASH_OFFSET + 1024);
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
    const splash = new Uint8Array(1024).fill(0xff);
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

  it("Init-Pattern aus einer Datei; „aus Firmware“ holt das Startbild der Basis", async () => {
    const fw = fakeFirmware();
    fw[SPLASH_OFFSET] = 0x7f; // Pixel (0,0) dunkel
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
    expect(r.bytes[SPLASH_OFFSET]).toBe(0x7f);
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
});

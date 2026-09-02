import { describe, it, expect } from "vitest";
import {
  VSB_HEADER,
  VSB_GROESSE,
  HACKTRIBE_SHA256,
  dateiOffset,
  pruefeFirmware,
  baueFirmware,
  GROOVE_ZAEHLER,
  INIT_PATTERN_OFFSET,
  INIT_PATTERN_GROESSE,
  E2SPAT_GROESSE,
  SPLASH_OFFSET,
  SPLASH_GROESSE,
  liesInitPattern,
  setzeInitPattern,
  liesSplash,
  setzeSplash,
  istGroovePlatzLeer,
  firmwareAusSicherung,
} from "../src/core/firmwareBau";
import { initGrooveBytes, decodeGroove, encodeGroove, GROOVE_SIZE } from "../src/core/e2Groove";
import { leererSplash, pixelZuSplash, SPLASH_BREITE, SPLASH_HOEHE } from "../src/core/splash";
import { E2_RAM_MAP, addressForSlot, DDR2_BASE } from "../src/core/hacktribeRam";
import { IFX_ZAEHLER, IFX_ANZAHL_ADDR } from "../src/core/ifxErweiterung";
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes, FX_PRESET_SIZE } from "../src/core/e2FxPreset";
import type { SammlungsEintrag } from "../src/core/sammlung";

/**
 * Presets dauerhaft machen: in die Hacktribe-SYSTEM.VSB einbrennen. Die
 * Datei ist ein 1:1-Abbild des RAM hinter einem 0x100-Header (an der
 * gepatchten Firmware und der Geraetesicherung byteweise belegt, 2026-09-02).
 * Hier ohne echte Firmware: ein nachgebautes Abbild mit denselben Stellen.
 */

const ifxMap = E2_RAM_MAP.find((e) => e.key === "ifxPreset")!;
const mfxMap = E2_RAM_MAP.find((e) => e.key === "mfxPreset")!;

function presetBytes(name: string, mfx = false): Uint8Array {
  const p = decodeFxPreset(initFxPresetBytes(), mfx);
  p.name = name;
  return encodeFxPreset(p);
}

/** Ein Abbild wie die Hacktribe-Firmware: Magic, Init-Bloecke, Zaehler 48/49. */
function fakeFirmware(maxIndex = 48): Uint8Array {
  const fw = new Uint8Array(VSB_GROESSE);
  fw.set(new TextEncoder().encode("KORG SYSTEM FILE"), 0);
  fw.set(new TextEncoder().encode("E2S"), 0x10);
  for (let slot = 0; slot < ifxMap.count; slot++) {
    const off = dateiOffset(addressForSlot(ifxMap, slot));
    // Leere Plaetze wie auf dem Geraet: Init-Block OHNE Namen
    fw.set(slot <= maxIndex ? presetBytes(`Werk ${slot + 1}`) : presetBytes(""), off);
  }
  for (let slot = 0; slot < mfxMap.count; slot++) {
    fw.set(presetBytes(`Master ${slot + 1}`, true), dateiOffset(addressForSlot(mfxMap, slot)));
  }
  for (const z of IFX_ZAEHLER) fw[dateiOffset(z.addr)] = z.plusEins ? maxIndex + 1 : maxIndex;
  // Groove-Bank: 62 Werksvorlagen, Rest 0xFF; Zaehler 61/62
  const grooveMap = E2_RAM_MAP.find((e) => e.key === "groove")!;
  for (let slot = 0; slot < grooveMap.count; slot++) {
    const off = dateiOffset(addressForSlot(grooveMap, slot));
    if (slot < 62) fw.set(grooveBytes(`Groove ${slot + 1}`), off);
    else fw.fill(0xff, off, off + GROOVE_SIZE);
  }
  for (const z of GROOVE_ZAEHLER) fw[dateiOffset(z.addr)] = z.plusEins ? 62 : 61;
  // Init-Pattern: ein PTST-Block; Startbild: leer
  fw.set(new TextEncoder().encode("PTST"), INIT_PATTERN_OFFSET);
  fw.set(new TextEncoder().encode("PTED"), INIT_PATTERN_OFFSET + INIT_PATTERN_GROESSE - 4);
  fw.set(leererSplash(), SPLASH_OFFSET);
  return fw;
}

function grooveBytes(name: string): Uint8Array {
  const g = decodeGroove(initGrooveBytes());
  g.name = name;
  return encodeGroove(g);
}

const namensByte = (fw: Uint8Array, addr: number): string => {
  let t = "";
  for (let i = 1; i < 16 && fw[dateiOffset(addr) + i]; i++) t += String.fromCharCode(fw[dateiOffset(addr) + i]);
  return t;
};

describe("firmwareBau — Abbild", () => {
  it("Datei-Offset = RAM − DDR2-Basis + Header (IFX-Bank bei 0xA81F0, Anzahl-Zelle bei 0x3F0DC)", () => {
    expect(VSB_HEADER).toBe(0x100);
    expect(dateiOffset(ifxMap.base)).toBe(0xa81f0);
    expect(dateiOffset(mfxMap.base)).toBe(0xb5030);
    expect(dateiOffset(IFX_ANZAHL_ADDR)).toBe(0x3f0dc);
    expect(dateiOffset(0xc0048f80)).toBe(0x49080);
    expect(dateiOffset(DDR2_BASE)).toBe(VSB_HEADER);
  });

  it("pruefeFirmware: Groesse, Magic und Geraetekennung — alles andere wird abgelehnt", () => {
    expect(pruefeFirmware(fakeFirmware()).ok).toBe(true);
    expect(pruefeFirmware(new Uint8Array(100)).ok).toBe(false);
    const falsch = fakeFirmware();
    falsch.set(new TextEncoder().encode("E2\0"), 0x10);
    const r = pruefeFirmware(falsch);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/E2S/);
  });

  it("der Hacktribe-Hash ist der aus hacktribe/hash/hacked-SYSTEM.VSB.sha", () => {
    expect(HACKTRIBE_SHA256).toBe("7cb4825c184a7e3fa92224304be22a788c96c4b748c277e63a496baa9faae7ee");
  });
});

describe("firmwareBau — bauen", () => {
  const zwei = (): SammlungsEintrag[] => [
    { art: "ifx", name: "Ring LFO", bytes: presetBytes("Ring LFO"), platz: 50 },
    { art: "ifx", name: "Trem Square", bytes: presetBytes("Trem Square"), platz: 51 },
  ];

  it("schreibt die Presets an ihre Plaetze und zieht die 13 Zaehler auf 50/51", () => {
    const r = baueFirmware(fakeFirmware(), zwei());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(namensByte(r.bytes, addressForSlot(ifxMap, 49))).toBe("Ring LFO");
    expect(namensByte(r.bytes, addressForSlot(ifxMap, 50))).toBe("Trem Square");
    expect(namensByte(r.bytes, addressForSlot(ifxMap, 48))).toBe("Werk 49"); // Nachbar unangetastet
    for (const z of IFX_ZAEHLER) expect(r.bytes[dateiOffset(z.addr)]).toBe(z.plusEins ? 51 : 50);
    expect(r.bericht.ifxMaxVorher).toBe(48);
    expect(r.bericht.ifxMaxNachher).toBe(50);
    expect(r.bericht.geschrieben.map((g) => g.platz)).toEqual([50, 51]);
    expect(r.bytes.length).toBe(VSB_GROESSE);
  });

  it("veraendert ausserhalb der Presets und Zaehler kein einziges Byte", () => {
    const basis = fakeFirmware();
    const r = baueFirmware(basis, zwei());
    if (!r.ok) throw new Error(r.reason);
    const erlaubt = new Set<number>();
    for (const slot of [49, 50]) for (let i = 0; i < FX_PRESET_SIZE; i++) erlaubt.add(dateiOffset(addressForSlot(ifxMap, slot)) + i);
    for (const z of IFX_ZAEHLER) erlaubt.add(dateiOffset(z.addr));
    let fremd = 0;
    for (let i = 0; i < basis.length; i++) if (basis[i] !== r.bytes[i] && !erlaubt.has(i)) fremd++;
    expect(fremd).toBe(0);
    expect(basis[dateiOffset(IFX_ANZAHL_ADDR)]).toBe(49); // Eingabe bleibt unangetastet
  });

  it("eine Luecke im neuen Bereich stoppt den Bau — nichts wird geliefert", () => {
    const r = baueFirmware(fakeFirmware(), [{ art: "ifx", name: "B", bytes: presetBytes("B"), platz: 51 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Platz 50/);
  });

  it("belegte Plaetze ueberschreiben geht ohne Zaehler-Aenderung; MFX ebenso", () => {
    const r = baueFirmware(fakeFirmware(), [
      { art: "ifx", name: "Neu 41", bytes: presetBytes("Neu 41"), platz: 41 },
      { art: "mfx", name: "Neu M9", bytes: presetBytes("Neu M9", true), platz: 9 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(namensByte(r.bytes, addressForSlot(ifxMap, 40))).toBe("Neu 41");
    expect(namensByte(r.bytes, addressForSlot(mfxMap, 8))).toBe("Neu M9");
    expect(r.bytes[dateiOffset(IFX_ANZAHL_ADDR)]).toBe(49);
    expect(r.bericht.ifxMaxNachher).toBe(48);
  });

  it("doppelte Plaetze, Plaetze ohne Eintrag und ein widerspruechlicher Zaehlersatz werden abgelehnt", () => {
    expect(
      baueFirmware(fakeFirmware(), [
        { art: "ifx", name: "A", bytes: presetBytes("A"), platz: 50 },
        { art: "ifx", name: "B", bytes: presetBytes("B"), platz: 50 },
      ]).ok,
    ).toBe(false);
    expect(baueFirmware(fakeFirmware(), [{ art: "ifx", name: "A", bytes: presetBytes("A") }]).ok).toBe(false);
    const kaputt = fakeFirmware();
    kaputt[dateiOffset(0xc004a1f8)] = 49;
    const r = baueFirmware(kaputt, zwei());
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/widersprechen/);
  });

  it("die unbekannten Bytes des Platzes bleiben als Unterlage erhalten", () => {
    const basis = fakeFirmware();
    const off = dateiOffset(addressForSlot(ifxMap, 49));
    basis[off + 0x130] = 0x5a; // ein Byte, das der Dekoder nicht kennt
    const r = baueFirmware(basis, [{ art: "ifx", name: "A", bytes: presetBytes("A"), platz: 50 }]);
    if (!r.ok) throw new Error(r.reason);
    expect(r.bytes[off + 0x130]).toBe(0x5a);
  });
});

describe("firmwareBau — Grooves, Init-Pattern, Startbild", () => {
  const grooveMap = E2_RAM_MAP.find((e) => e.key === "groove")!;

  it("Groove-Vorlagen hinter dem Zaehler ziehen die vier Groove-Zaehler nach", () => {
    const r = baueFirmware(fakeFirmware(), [
      { art: "groove", name: "Mein Swing", bytes: grooveBytes("Mein Swing"), platz: 63 },
      { art: "groove", name: "Noch einer", bytes: grooveBytes("Noch einer"), platz: 64 },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bericht.grooveMaxVorher).toBe(61);
    expect(r.bericht.grooveMaxNachher).toBe(63);
    for (const z of GROOVE_ZAEHLER) expect(r.bytes[dateiOffset(z.addr)]).toBe(z.plusEins ? 64 : 63);
    const off = dateiOffset(addressForSlot(grooveMap, 62));
    expect(decodeGroove(r.bytes.subarray(off, off + GROOVE_SIZE)).name).toBe("Mein Swing");
    // IFX-Zaehler unangetastet
    expect(r.bytes[dateiOffset(IFX_ANZAHL_ADDR)]).toBe(49);
  });

  it("eine Luecke im Groove-Bereich stoppt den Bau", () => {
    const r = baueFirmware(fakeFirmware(), [{ art: "groove", name: "X", bytes: grooveBytes("X"), platz: 64 }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/Groove.*Platz 63/);
  });

  it("istGroovePlatzLeer: 0xFF-Bloecke sind leer, GVST-Bloecke nicht", () => {
    expect(istGroovePlatzLeer(new Uint8Array(GROOVE_SIZE).fill(0xff))).toBe(true);
    expect(istGroovePlatzLeer(grooveBytes("A"))).toBe(false);
  });

  it("Init-Pattern: lesen liefert eine gueltige .e2spat, setzen brennt den Block ein", () => {
    const fw = fakeFirmware();
    const pat = liesInitPattern(fw);
    expect(pat.length).toBe(E2SPAT_GROESSE);
    expect(String.fromCharCode(...pat.subarray(0, 4))).toBe("KORG");
    expect(String.fromCharCode(...pat.subarray(0x10, 0x19))).toBe("e2sampler");
    expect(String.fromCharCode(...pat.subarray(0x100, 0x104))).toBe("PTST");
    // eigenes Pattern: Name an PTST+0x10 (aus dem Builder-Layout)
    const neu = pat.slice();
    neu.set(new TextEncoder().encode("TEKK INIT"), 0x110);
    const fw2 = setzeInitPattern(fw, neu);
    expect(String.fromCharCode(...fw2.subarray(INIT_PATTERN_OFFSET + 0x10, INIT_PATTERN_OFFSET + 0x19))).toBe("TEKK INIT");
    expect(fw[INIT_PATTERN_OFFSET + 0x10]).toBe(0); // Eingabe unangetastet
    // der nackte Block geht auch
    expect(neu.length).toBe(0x4100); // wie eine echte .e2spat: Header, Block, 0x400 Nullen
    expect(Array.from(setzeInitPattern(fw, neu.subarray(0x100, 0x100 + INIT_PATTERN_GROESSE)))).toEqual(Array.from(fw2));
    expect(() => setzeInitPattern(fw, new Uint8Array(100))).toThrow(/Bytes/);
    const kaputt = neu.slice();
    kaputt.set(new TextEncoder().encode("XXXX"), 0x100);
    expect(() => setzeInitPattern(fw, kaputt)).toThrow(/PTST/);
  });

  it("Startbild: lesen und setzen, 1024 Bytes an 0xF9954", () => {
    const fw = fakeFirmware();
    expect(liesSplash(fw).every((b) => b === 0xff)).toBe(true);
    const px = new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE);
    px[0] = 1;
    const fw2 = setzeSplash(fw, pixelZuSplash(px));
    expect(fw2[SPLASH_OFFSET]).toBe(0x7f);
    expect(liesSplash(fw2)[0]).toBe(0x7f);
    expect(fw[SPLASH_OFFSET]).toBe(0xff);
    expect(() => setzeSplash(fw, new Uint8Array(10))).toThrow(/Bytes/);
    expect(SPLASH_GROESSE).toBe(1024);
  });
});

describe("firmwareBau — den ganzen Geraetestand einbrennen", () => {
  const ifxMapL = E2_RAM_MAP.find((e) => e.key === "ifxPreset")!;
  const grooveMapL = E2_RAM_MAP.find((e) => e.key === "groove")!;

  /** Eine Sicherung wie vom Geraet, aber mit eigenem Stand: 60 IFX, andere MFX, 70 Grooves, eigenes Init-Pattern und Startbild. */
  function sicherung() {
    const ifx = new Uint8Array(100 * FX_PRESET_SIZE);
    for (let i = 0; i < 100; i++) ifx.set(i < 60 ? presetBytes(`RAM ${i + 1}`) : presetBytes(""), i * FX_PRESET_SIZE);
    const mfx = new Uint8Array(32 * FX_PRESET_SIZE);
    for (let i = 0; i < 32; i++) mfx.set(presetBytes(`RAM M${i + 1}`, true), i * FX_PRESET_SIZE);
    const gv = new Uint8Array(96 * GROOVE_SIZE).fill(0xff);
    for (let i = 0; i < 70; i++) gv.set(grooveBytes(`RAM G${i + 1}`), i * GROOVE_SIZE);
    const init = new Uint8Array(INIT_PATTERN_GROESSE);
    init.set(new TextEncoder().encode("PTST"), 0);
    init.set(new TextEncoder().encode("RAM INIT"), 0x10);
    const splash = leererSplash();
    splash[0] = 0x7f;
    return [
      { key: "ifxPreset", bytes: ifx },
      { key: "mfxPreset", bytes: mfx },
      { key: "groove", bytes: gv },
      { key: "maxIfxIndex", bytes: new Uint8Array([59]) },
      { key: "grooveMaxIndex", bytes: new Uint8Array([70]) },
      { key: "initPattern", bytes: init },
      { key: "splash", bytes: splash },
    ];
  }

  it("uebernimmt Baenke, Zaehler, Init-Pattern und Startbild aus der Sicherung", () => {
    const r = firmwareAusSicherung(fakeFirmware(), sicherung());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(namensByte(r.bytes, addressForSlot(ifxMapL, 0))).toBe("RAM 1");
    expect(namensByte(r.bytes, addressForSlot(ifxMapL, 59))).toBe("RAM 60");
    expect(namensByte(r.bytes, addressForSlot(ifxMapL, 60))).toBe("");
    expect(namensByte(r.bytes, addressForSlot(mfxMap, 31))).toBe("RAM M32");
    for (const z of IFX_ZAEHLER) expect(r.bytes[dateiOffset(z.addr)]).toBe(z.plusEins ? 60 : 59);
    for (const z of GROOVE_ZAEHLER) expect(r.bytes[dateiOffset(z.addr)]).toBe(z.plusEins ? 70 : 69);
    const g = dateiOffset(addressForSlot(grooveMapL, 69));
    expect(decodeGroove(r.bytes.subarray(g, g + GROOVE_SIZE)).name).toBe("RAM G70");
    expect(String.fromCharCode(...r.bytes.subarray(INIT_PATTERN_OFFSET + 0x10, INIT_PATTERN_OFFSET + 0x18))).toBe("RAM INIT");
    expect(r.bytes[SPLASH_OFFSET]).toBe(0x7f);
    expect(r.bericht.ifxMaxIndex).toBe(59);
    expect(r.bericht.grooveMaxIndex).toBe(69);
    expect(r.bericht.fehlend).toEqual([]);
    expect(r.bericht.bereiche.map((b) => b.key)).toEqual(["ifxPreset", "mfxPreset", "groove", "ifxZaehler", "grooveZaehler", "initPattern", "splash"]);
  });

  it("eine aeltere Sicherung ohne Init-Pattern, Startbild und Groove-Zaehler laesst diese Teile in der Basis", () => {
    const alt = sicherung().filter((b) => ["ifxPreset", "mfxPreset", "groove", "maxIfxIndex"].includes(b.key));
    const basis = fakeFirmware();
    const r = firmwareAusSicherung(basis, alt);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bericht.fehlend).toEqual(["grooveMaxIndex", "initPattern", "splash"]);
    expect(r.bytes[SPLASH_OFFSET]).toBe(basis[SPLASH_OFFSET]);
    for (const z of GROOVE_ZAEHLER) expect(r.bytes[dateiOffset(z.addr)]).toBe(basis[dateiOffset(z.addr)]);
    expect(namensByte(r.bytes, addressForSlot(ifxMapL, 0))).toBe("RAM 1");
  });

  it("lehnt eine Sicherung ohne passende Bereiche ab", () => {
    const r = firmwareAusSicherung(fakeFirmware(), [{ key: "fxEditBuffer", bytes: new Uint8Array(10) }]);
    expect(r.ok).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  VSB_HEADER,
  VSB_GROESSE,
  HACKTRIBE_SHA256,
  dateiOffset,
  pruefeFirmware,
  baueFirmware,
} from "../src/core/firmwareBau";
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
  return fw;
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

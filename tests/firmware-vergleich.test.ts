import { describe, it, expect } from "vitest";
import { vergleicheFirmware } from "../src/core/firmwareVergleich";
import { VSB_GROESSE, dateiOffset, GROOVE_ZAEHLER, INIT_PATTERN_OFFSET, INIT_PATTERN_GROESSE, SPLASH_OFFSET, baueFirmware } from "../src/core/firmwareBau";
import { E2_RAM_MAP, addressForSlot } from "../src/core/hacktribeRam";
import { IFX_ZAEHLER } from "../src/core/ifxErweiterung";
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes } from "../src/core/e2FxPreset";
import { initGrooveBytes, decodeGroove, encodeGroove, GROOVE_SIZE } from "../src/core/e2Groove";
import { leererSplash } from "../src/core/splash";
import { LDR_START } from "../src/core/dspPatch";

const ifxMap = E2_RAM_MAP.find((e) => e.key === "ifxPreset")!;
const grooveMap = E2_RAM_MAP.find((e) => e.key === "groove")!;

function presetBytes(name: string, mfx = false): Uint8Array {
  const p = decodeFxPreset(initFxPresetBytes(), mfx);
  p.name = name;
  return encodeFxPreset(p);
}
function grooveBytes(name: string): Uint8Array {
  const g = decodeGroove(initGrooveBytes());
  g.name = name;
  return encodeGroove(g);
}
function fakeFirmware(): Uint8Array {
  const fw = new Uint8Array(VSB_GROESSE);
  fw.set(new TextEncoder().encode("KORG SYSTEM FILE"), 0);
  fw.set(new TextEncoder().encode("E2S"), 0x10);
  for (let s = 0; s < ifxMap.count; s++) fw.set(s < 49 ? presetBytes(`Werk ${s + 1}`) : presetBytes(""), dateiOffset(addressForSlot(ifxMap, s)));
  for (const z of IFX_ZAEHLER) fw[dateiOffset(z.addr)] = z.plusEins ? 49 : 48;
  for (let s = 0; s < grooveMap.count; s++) {
    const off = dateiOffset(addressForSlot(grooveMap, s));
    if (s < 62) fw.set(grooveBytes(`G${s + 1}`), off);
    else fw.fill(0xff, off, off + GROOVE_SIZE);
  }
  for (const z of GROOVE_ZAEHLER) fw[dateiOffset(z.addr)] = z.plusEins ? 62 : 61;
  fw.set(new TextEncoder().encode("PTST"), INIT_PATTERN_OFFSET);
  fw.set(new TextEncoder().encode("WERK INIT"), INIT_PATTERN_OFFSET + 0x10);
  fw.set(new TextEncoder().encode("PTED"), INIT_PATTERN_OFFSET + INIT_PATTERN_GROESSE - 4);
  fw.set(leererSplash(), SPLASH_OFFSET);
  return fw;
}

describe("firmwareVergleich", () => {
  it("identische Abbilder: gleich, eine Zeile", () => {
    const v = vergleicheFirmware(fakeFirmware(), fakeFirmware());
    expect(v.gleich).toBe(true);
    expect(v.unterschiede).toEqual([]);
    expect(v.zeilen).toEqual(["Die beiden Abbilder sind byteweise identisch."]);
  });

  it("ein Bau mit zwei Presets zeigt genau die zwei Plaetze und die Zaehler — sonst nichts", () => {
    const basis = fakeFirmware();
    const r = baueFirmware(basis, [
      { art: "ifx", name: "Ring LFO", bytes: presetBytes("Ring LFO"), platz: 50 },
      { art: "ifx", name: "Trem Square", bytes: presetBytes("Trem Square"), platz: 51 },
    ]);
    if (!r.ok) throw new Error(r.reason);
    const v = vergleicheFirmware(basis, r.bytes);
    expect(v.gleich).toBe(false);
    const ifx = v.unterschiede.filter((u) => u.bereich === "ifx");
    expect(ifx.map((u) => [u.platz, u.links, u.rechts])).toEqual([
      [50, "— leer —", "Ring LFO"],
      [51, "— leer —", "Trem Square"],
    ]);
    expect(v.unterschiede.filter((u) => u.bereich === "zaehler")).toHaveLength(13);
    expect(v.sonstige).toEqual([]);
    expect(v.zeilen[0]).toMatch(/IFX: 2 Platz\/Plätze anders — 50: „— leer —“ ↔ „Ring LFO“/);
    expect(v.zeilen[1]).toMatch(/Zähler: IFX-Anzahl 49 → 51/);
  });

  it("Init-Pattern, Startbild, Grooves und fremde Bytes werden getrennt gemeldet", () => {
    const a = fakeFirmware();
    const b = a.slice();
    b.set(new TextEncoder().encode("TEKK INIT"), INIT_PATTERN_OFFSET + 0x10);
    b[SPLASH_OFFSET] = 0x80;
    b.set(grooveBytes("Neu"), dateiOffset(addressForSlot(grooveMap, 3)));
    b[0x12345] = 0xaa;
    b[0x12350] = 0xbb; // innerhalb 16 Bytes → derselbe Lauf
    b[0x20000] = 0xcc;
    const v = vergleicheFirmware(a, b);
    const je = (bereich: string) => v.unterschiede.filter((u) => u.bereich === bereich);
    expect(je("initPattern")[0]).toMatchObject({ links: "WERK INIT", rechts: "TEKK INIT" });
    expect(je("splash")[0]).toMatchObject({ links: "0 dunkle Pixel", rechts: "1 dunkle Pixel" });
    expect(je("groove")[0]).toMatchObject({ platz: 4, links: "G4", rechts: "Neu" });
    expect(v.sonstige).toEqual([
      { von: 0x12345, bis: 0x12350, bytes: 2 },
      { von: 0x20000, bis: 0x20000, bytes: 1 },
    ]);
    expect(v.sonstigeBytes).toBe(3);
    expect(v.zeilen.join("\n")).toMatch(/Außerhalb der bekannten Bereiche: 3 Bytes in 2 Lauf/);
  });

  it("Aenderungen im DSP-Abbild werden je Block gemeldet, nicht als fremde Bytes", () => {
    const kopf = (flags: number, ziel: number, laenge: number): Uint8Array => {
      const h = new Uint8Array(16);
      const dv = new DataView(h.buffer);
      dv.setUint32(0, ((0xad << 24) | flags) >>> 0, true);
      dv.setUint32(4, ziel >>> 0, true);
      dv.setUint32(8, laenge >>> 0, true);
      let x = 0;
      for (const b of h) x ^= b;
      h[2] = x;
      return h;
    };
    const a = new Uint8Array(VSB_GROESSE);
    a.set(kopf(0x0001, 0x9400, 32), LDR_START);
    for (let i = 0; i < 32; i++) a[LDR_START + 16 + i] = 0x80 + i;
    a.set(kopf(0x0100 | 0x8000, 0x10000, 16), LDR_START + 48);
    const b = a.slice();
    b[LDR_START + 20] = 0;
    b[LDR_START + 21] = 0;
    const v = vergleicheFirmware(a, b);
    expect(v.sonstige).toEqual([]);
    expect(v.unterschiede).toEqual([{ bereich: "dsp", platz: 0, links: "Block 0 @ 0x9400", rechts: "32 Bytes lang", bytes: 2, offset: LDR_START + 16 }]);
    expect(v.zeilen.join("\n")).toMatch(/DSP-Abbild: 1 Block\/Blöcke anders — Block 0 @ 0x9400 \(2 Bytes/);
    // ein kaputter Kopf wird als solcher benannt
    const c = a.slice();
    c[LDR_START + 5] ^= 1;
    expect(vergleicheFirmware(a, c).unterschiede[0]).toMatchObject({ bereich: "dsp", links: "Kopf von Block 0" });
  });

  it("verlangt zwei vollstaendige Abbilder", () => {
    expect(() => vergleicheFirmware(new Uint8Array(10), fakeFirmware())).toThrow(/Bytes/);
  });
});

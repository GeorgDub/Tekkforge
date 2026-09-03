import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import {
  LDR_START,
  leseLdrKette,
  vaddrZuDatei,
  wendeDspPatchAn,
  dspPatchStand,
  sucheMuster,
  hexZuBytes,
  leseDspPatchDatei,
  dspPatchZuObjekt,
  dspPatchAusObjekt,
  type DspPatch,
} from "../src/core/dspPatch";
import { DSP_PATCH_REGISTER } from "../src/core/dspPatchRegister";
import { VSB_GROESSE } from "../src/core/firmwareBau";

/**
 * Das BF523-Abbild in der VSB: ein ADI-LDR-Bootstrom mit 16-Byte-Koepfen,
 * deren XOR 0 ergibt. Hier ein synthetischer Strom mit drei Bloecken (L1,
 * SDRAM, Fuellung) — und, wenn die Hacktribe-Datei da ist, die echte Kette.
 */

/** Einen LDR-Kopf bauen: Signatur 0xAD, Pruefziffer so, dass alles zu 0 xort. */
function kopf(flags: number, ziel: number, laenge: number): Uint8Array {
  const h = new Uint8Array(16);
  const dv = new DataView(h.buffer);
  dv.setUint32(0, ((0xad << 24) | flags) >>> 0, true);
  dv.setUint32(4, ziel >>> 0, true);
  dv.setUint32(8, laenge >>> 0, true);
  dv.setUint32(12, 0, true);
  let x = 0;
  for (const b of h) x ^= b;
  h[2] = x; // HDRCHK-Byte (Bits 23..16 des BlockCode) — danach XOR aller 16 Bytes = 0
  return h;
}

function synthetischeFirmware(): { fw: Uint8Array; l1: number; sdram: number } {
  const fw = new Uint8Array(VSB_GROESSE);
  fw.set(new TextEncoder().encode("KORG SYSTEM FILE"), 0);
  fw.set(new TextEncoder().encode("E2S"), 0x10);
  let off = LDR_START;
  // Block 0: L1-Daten, 64 Bytes mit einer erkennbaren Tabelle
  fw.set(kopf(0x0001, 0xff803bd8, 64), off);
  const l1 = off + 16;
  for (let i = 0; i < 64; i++) fw[l1 + i] = 0x10 + i;
  off += 16 + 64;
  // Block 1: SDRAM-Daten, 32 Bytes
  fw.set(kopf(0x0001, 0x00004ccc, 32), off);
  const sdram = off + 16;
  for (let i = 0; i < 32; i++) fw[sdram + i] = 0xa0 + i;
  off += 16 + 32;
  // Block 2: Fuellung (keine Nutzdaten), letzter Block
  fw.set(kopf(0x0100 | 0x8000, 0x00010000, 4096), off);
  return { fw, l1, sdram };
}

describe("dspPatch — LDR-Kette", () => {
  it("liest die Bloecke, prueft die Koepfe und findet das Ende", () => {
    const { fw } = synthetischeFirmware();
    const k = leseLdrKette(fw);
    expect(k.ok).toBe(true);
    if (!k.ok) return;
    expect(k.bloecke).toHaveLength(3);
    expect(k.bloecke[0]).toMatchObject({ ziel: 0xff803bd8, laenge: 64, fuellung: false, letzter: false });
    expect(k.bloecke[2]).toMatchObject({ fuellung: true, letzter: true });
    expect(k.ende).toBe(LDR_START + 16 + 64 + 16 + 32 + 16);
  });

  it("ein kaputter Kopf stoppt die Kette mit Block-Nummer und Offset", () => {
    const { fw } = synthetischeFirmware();
    fw[LDR_START + 16 + 64 + 5] ^= 0x01; // ein Byte im zweiten Kopf
    const k = leseLdrKette(fw);
    expect(k.ok).toBe(false);
    if (!k.ok) expect(k.reason).toMatch(/Block 1/);
  });

  it("vaddrZuDatei bildet L1- und SDRAM-Adressen auf Datei-Offsets ab, Fuellbloecke nicht", () => {
    const { fw, l1, sdram } = synthetischeFirmware();
    const k = leseLdrKette(fw);
    if (!k.ok) throw new Error(k.reason);
    expect(vaddrZuDatei(k.bloecke, 0xff803bd8)).toBe(l1);
    expect(vaddrZuDatei(k.bloecke, 0xff803bd8 + 10, 4)).toBe(l1 + 10);
    expect(vaddrZuDatei(k.bloecke, 0x4ccc + 31)).toBe(sdram + 31);
    expect(vaddrZuDatei(k.bloecke, 0x4ccc + 31, 2)).toBeNull(); // ragt heraus
    expect(vaddrZuDatei(k.bloecke, 0x00010000)).toBeNull(); // Fuellung
  });
});

describe("dspPatch — anwenden", () => {
  const patch = (alt: string, neu: string, vaddr?: number): DspPatch => ({
    id: "t",
    titel: "Test",
    beschreibung: "",
    quelle: "test",
    status: "hoerprobe-offen",
    edits: [{ ...(vaddr !== undefined ? { vaddr } : {}), alt: hexZuBytes(alt), neu: hexZuBytes(neu) }],
  });

  it("ersetzt die alten Bytes an ihrem eindeutigen Fundort, die Kette bleibt gueltig", () => {
    const { fw, l1 } = synthetischeFirmware();
    const r = wendeDspPatchAn(fw, patch("14151617", "00000000", 0xff803bd8 + 4));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.from(r.bytes.subarray(l1 + 4, l1 + 8))).toEqual([0, 0, 0, 0]);
    expect(r.stellen[0]).toMatchObject({ offset: l1 + 4, bytes: 4 });
    expect(fw[l1 + 4]).toBe(0x14); // Eingabe unangetastet
    expect(dspPatchStand(fw, patch("14151617", "00000000"))).toBe("original");
    expect(dspPatchStand(r.bytes, patch("14151617", "00000000"))).toBe("gepatcht");
  });

  it("lehnt ab: ungleiche Laenge, Fingerabdruck fehlt, Fingerabdruck mehrdeutig, Adresse passt nicht", () => {
    const { fw } = synthetischeFirmware();
    expect(wendeDspPatchAn(fw, patch("1415", "000000")).ok).toBe(false);
    const fehlt = wendeDspPatchAn(fw, patch("deadbeef", "00000000"));
    expect(fehlt.ok).toBe(false);
    if (!fehlt.ok) expect(fehlt.reason).toMatch(/stehen nicht/);
    // 0xA0 A1 kommt einmal vor; ein 1-Byte-Muster 0xA5 mehrfach? Im synthetischen Strom nicht — Doppel erzeugen:
    const doppelt = synthetischeFirmware().fw;
    doppelt.set([0x10, 0x11, 0x12, 0x13], doppelt.length - 100); // ausserhalb der Kette → zaehlt nicht
    expect(wendeDspPatchAn(doppelt, patch("10111213", "00000000")).ok).toBe(true);
    const inKette = synthetischeFirmware();
    inKette.fw.set([0x10, 0x11, 0x12, 0x13], inKette.sdram + 4); // zweites Vorkommen innerhalb der Kette
    const mehr = wendeDspPatchAn(inKette.fw, patch("10111213", "00000000"));
    expect(mehr.ok).toBe(false);
    if (!mehr.ok) expect(mehr.reason).toMatch(/2-mal/);
    const falsch = wendeDspPatchAn(fw, patch("14151617", "00000000", 0xff803bd8)); // Adresse zeigt auf Byte 0, Fund liegt bei +4
    expect(falsch.ok).toBe(false);
    if (!falsch.ok) expect(falsch.reason).toMatch(/DSP-Adresse/);
  });

  it("lehnt eine Aenderung ab, die einen Blockkopf traefe", () => {
    const { fw } = synthetischeFirmware();
    // die letzten 2 Bytes von Block 0 plus die ersten 2 des naechsten Kopfs
    const alt = Array.from(fw.subarray(LDR_START + 16 + 62, LDR_START + 16 + 66));
    const r = wendeDspPatchAn(fw, patch(Buffer.from(alt).toString("hex"), "00000000"));
    expect(r.ok).toBe(false);
  });

  it("sucheMuster findet alle Vorkommen im Fenster", () => {
    const fw = new Uint8Array(100);
    fw.set([1, 2, 3], 10);
    fw.set([1, 2, 3], 50);
    expect(sucheMuster(fw, new Uint8Array([1, 2, 3]))).toEqual([10, 50]);
    expect(sucheMuster(fw, new Uint8Array([1, 2, 3]), 20)).toEqual([50]);
  });

  it("leseDspPatchDatei nimmt Listen und Objekte mit edits, verlangt gleiche Laengen", () => {
    const p = leseDspPatchDatei(JSON.stringify([{ vaddr: "0xFFA00810", old: "42e1ff7f", new: "42e10070", label: "x" }]), "probe");
    expect(p.edits[0].vaddr).toBe(0xffa00810);
    expect(p.edits[0].alt.length).toBe(4);
    expect(p.beschreibung).toBe("x");
    expect(() => leseDspPatchDatei("nix")).toThrow(/JSON/);
    expect(() => leseDspPatchDatei(JSON.stringify([{ old: "00", new: "0000" }]))).toThrow(/alte gegen/);
    expect(() => leseDspPatchDatei(JSON.stringify({ edits: [] }))).toThrow(/keine Änderungen/);
  });
});

describe("dspPatch — Objekt-Rundreise", () => {
  it("dspPatchZuObjekt → JSON → dspPatchAusObjekt ergibt denselben Patch, Status und Adresse inklusive", () => {
    const p: DspPatch = { id: "x", titel: "X", beschreibung: "b", quelle: "q", status: "diskriminator", edits: [{ vaddr: 0xff803bd8, alt: hexZuBytes("0102"), neu: hexZuBytes("0304") }] };
    const zurueck = dspPatchAusObjekt(JSON.parse(JSON.stringify(dspPatchZuObjekt(p))));
    expect(zurueck).toEqual(p);
    expect(dspPatchAusObjekt({ edits: [{ old: "00", new: "01" }], status: "quatsch" }).status).toBe("hoerprobe-offen");
  });
});

describe("dspPatch — Register", () => {
  it("jeder Register-Eintrag hat gleichlange, nicht-leere Aenderungen und einen Status", () => {
    expect(DSP_PATCH_REGISTER.length).toBeGreaterThanOrEqual(8);
    for (const p of DSP_PATCH_REGISTER) {
      expect(p.edits.length).toBeGreaterThan(0);
      for (const e of p.edits) {
        expect(e.alt.length).toBe(e.neu.length);
        expect(e.alt.length).toBeGreaterThan(0);
        expect(Array.from(e.alt)).not.toEqual(Array.from(e.neu));
      }
      expect(["hoerprobe-offen", "am-geraet-gehoert", "diskriminator"]).toContain(p.status);
    }
  });

  const VSB = "G:/IdeaProjects/hacktribe/fertige firmwares/SYSTEM.VSB";
  const daVsb = fs.existsSync(VSB);

  it.skipIf(!daVsb)("die echte Hacktribe-Datei: 157 Bloecke, jeder Register-Patch findet seinen Fingerabdruck genau einmal und laesst die Kette gueltig", () => {
    const fw = new Uint8Array(fs.readFileSync(VSB));
    const k = leseLdrKette(fw);
    expect(k.ok).toBe(true);
    if (!k.ok) return;
    expect(k.bloecke).toHaveLength(157);
    for (const p of DSP_PATCH_REGISTER) {
      expect(dspPatchStand(fw, p), p.id).toBe("original");
      const r = wendeDspPatchAn(fw, p);
      expect(r.ok, `${p.id}: ${r.ok ? "" : r.reason}`).toBe(true);
      if (!r.ok) continue;
      expect(dspPatchStand(r.bytes, p)).toBe("gepatcht");
      // ausserhalb der Stellen kein Byte anders
      let fremd = 0;
      const erlaubt = new Set<number>();
      for (const s of r.stellen) for (let i = 0; i < s.bytes; i++) erlaubt.add(s.offset + i);
      for (let i = 0; i < fw.length; i++) if (fw[i] !== r.bytes[i] && !erlaubt.has(i)) fremd++;
      expect(fremd).toBe(0);
    }
  });
});

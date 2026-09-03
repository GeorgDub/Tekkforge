import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import {
  OSZ_TABELLE_ADDR,
  OSZ_EINTRAG,
  OSZ_MAX,
  OSZ_ZAEHLER,
  OSZ_ZEIGER_ADDRS,
  decodeOsz,
  encodeOsz,
  oszVariante,
  istOszLeer,
  leererOsz,
  fmHalbtonZuParameter,
  fmParameterZuHalbton,
  fmHalbtonGemessen,
  FM_STUETZEN,
  oszZaehlerSchreibliste,
  leseOszStand,
  planeOszErweiterung,
  liesOsz,
  oszOffset,
  leseOszStandAusFirmware,
  setzeOszTabelle,
  liesOszTabelle,
} from "../src/core/oszTabelle";
import { VSB_GROESSE, dateiOffset } from "../src/core/firmwareBau";
import { E2_RAM_MAP } from "../src/core/hacktribeRam";

/**
 * Die Oszillator-Tabelle: 32-Byte-Eintraege ab RAM 0xC00D9AB0, zwei
 * Beschreiber im Code mit Zeiger/Bytes/Anzahl. Die Bytes hier sind echte
 * Eintraege aus der Hacktribe-Firmware (SAW, UNI-SAW, X-SAW −24, VPM-SINE 32).
 */
const hexZu = (h: string): Uint8Array => Uint8Array.from(h.match(/../g)!.map((x) => parseInt(x, 16)));
const SAW = hexZu("53415700000000000000000000000000" + "000001000000007f0001000000000000");
const UNI_SAW = hexZu("554e492d534157000000000000000000" + "00000d000000007f3c01000000000000");
const X_SAW_M24 = hexZu("582d534157202d323400000000000000" + "0a0019000000004420010000c1000000");
const VPM_SINE_32 = hexZu("56504d2d53494e452033320000000000" + "100020000000007f2001000020000000");

const setU32 = (b: Uint8Array, off: number, v: number): void => {
  b[off] = v & 0xff;
  b[off + 1] = (v >>> 8) & 0xff;
  b[off + 2] = (v >>> 16) & 0xff;
  b[off + 3] = (v >>> 24) & 0xff;
};

/** Ein Abbild mit 20 Eintraegen und stimmigen Beschreibern. */
function fakeFirmware(anzahl = 20): Uint8Array {
  const fw = new Uint8Array(VSB_GROESSE);
  fw.fill(0xff, oszOffset(1), oszOffset(OSZ_MAX) + OSZ_EINTRAG);
  for (let p = 1; p <= anzahl; p++) fw.set(oszVariante(SAW, { name: `OSZ ${p}`, parameter: p }), oszOffset(p));
  for (const a of OSZ_ZEIGER_ADDRS) setU32(fw, dateiOffset(a), OSZ_TABELLE_ADDR);
  for (const z of oszZaehlerSchreibliste(anzahl)) setU32(fw, dateiOffset(z.addr), z.wert);
  return fw;
}

describe("oszTabelle — Eintrag", () => {
  it("dekodiert die echten Eintraege", () => {
    expect(decodeOsz(SAW)).toMatchObject({ name: "SAW", kategorie: 0, programm: 1, pegel: 0x7f, vorgabe: 0, parameter: 0 });
    expect(decodeOsz(UNI_SAW)).toMatchObject({ name: "UNI-SAW", programm: 13, vorgabe: 0x3c });
    expect(decodeOsz(X_SAW_M24)).toMatchObject({ name: "X-SAW -24", kategorie: 0x0a, programm: 25, pegel: 0x44, vorgabe: 0x20, parameter: -63 });
    expect(decodeOsz(VPM_SINE_32)).toMatchObject({ name: "VPM-SINE 32", kategorie: 0x10, programm: 32, parameter: 32 });
    expect(() => decodeOsz(new Uint8Array(10))).toThrow(/32/);
  });

  it("encode(decode(x)) ist byte-identisch; Varianten aendern nur die genannten Felder", () => {
    for (const e of [SAW, UNI_SAW, X_SAW_M24, VPM_SINE_32]) expect(Array.from(encodeOsz(decodeOsz(e)))).toEqual(Array.from(e));
    const v = oszVariante(X_SAW_M24, { name: "X-SAW -7", parameter: fmHalbtonZuParameter(-7) });
    const d = decodeOsz(v);
    expect(d.name).toBe("X-SAW -7");
    expect(d.parameter).toBe(-28); // Hacktribes Stuetzpunkt, nicht linear
    expect(fmParameterZuHalbton(d.parameter)).toBe(-7);
    // Rest wie die Vorlage
    expect(Array.from(v.subarray(0x10, 0x1c))).toEqual(Array.from(X_SAW_M24.subarray(0x10, 0x1c)));
    expect(fmHalbtonZuParameter(24)).toBe(63);
    expect(fmHalbtonZuParameter(-24)).toBe(-63);
    expect(fmHalbtonZuParameter(99)).toBe(63);
    // Hacktribes Kennlinie aus dem Abbild: 1→14, 2→17, 5→22, 6…12 → 24…48, 16→53, 20→58
    expect([1, 2, 5, 6, 11, 12, 16, 20].map(fmHalbtonZuParameter)).toEqual([14, 17, 22, 24, 44, 48, 53, 58]);
    expect(fmHalbtonZuParameter(0)).toBe(0);
    // Luecken linear geschaetzt: 3 → 19, 4 → 20, 13 → 49, 23 → 62; Vorzeichen gespiegelt
    expect([3, 4, 13, 23, -3, -23].map(fmHalbtonZuParameter)).toEqual([19, 20, 49, 62, -19, -62]);
    expect([3, 4, 13, 23].map(fmHalbtonGemessen)).toEqual([false, false, false, false]);
    expect(fmHalbtonGemessen(-12)).toBe(true);
    // Rueckweg: jeder Stuetzpunkt landet auf seinem Halbton, Hacktribes vertauschte −11/−12 auf −12/−11
    for (const [h, p] of FM_STUETZEN) expect(fmParameterZuHalbton(-p)).toBe(-h);
    expect([-48, -44, -19, 62, -63].map(fmParameterZuHalbton)).toEqual([-12, -11, -3, 23, -24]);
  });

  it("lehnt Unbrauchbares ab: Nicht-ASCII, Parameter ausserhalb, Programm ausserhalb", () => {
    expect(() => oszVariante(SAW, { name: "SÄGE" })).toThrow(/ASCII/);
    expect(() => oszVariante(SAW, { name: "X", parameter: 200 })).toThrow(/Parameter/);
    expect(() => encodeOsz({ ...decodeOsz(SAW), programm: 70000 })).toThrow(/Programm/);
    expect(decodeOsz(oszVariante(SAW, { name: "EIN SEHR LANGER NAME HIER" })).name).toBe("EIN SEHR LANGER");
  });

  it("leer heisst 0xFF×32", () => {
    expect(istOszLeer(leererOsz())).toBe(true);
    expect(istOszLeer(SAW)).toBe(false);
    expect(istOszLeer(new Uint8Array(31).fill(0xff))).toBe(false);
  });
});

describe("oszTabelle — Beschreiber", () => {
  it("Schreibliste: Bytes = Anzahl × 32, beide Kopien", () => {
    const l = oszZaehlerSchreibliste(300);
    expect(l.map((x) => x.wert)).toEqual([9600, 300, 9600, 300]);
    expect(l.map((x) => x.addr)).toEqual(OSZ_ZAEHLER.map((z) => z.addr));
  });

  it("Stand lesen: stimmig, widerspruechlich, falscher Zeiger, ausserhalb", () => {
    expect(leseOszStand(oszZaehlerSchreibliste(274), [OSZ_TABELLE_ADDR, OSZ_TABELLE_ADDR])).toEqual({ ok: true, anzahl: 274 });
    const kaputt = oszZaehlerSchreibliste(274);
    kaputt[0].wert = 100;
    expect(leseOszStand(kaputt)).toMatchObject({ ok: false, reason: expect.stringMatching(/widersprüchlich/) });
    expect(leseOszStand(oszZaehlerSchreibliste(274), [0xc0000000, OSZ_TABELLE_ADDR])).toMatchObject({ ok: false, reason: expect.stringMatching(/Zeiger/) });
    expect(leseOszStand(oszZaehlerSchreibliste(500))).toMatchObject({ ok: false, reason: expect.stringMatching(/ausserhalb/) });
    expect(leseOszStand([])).toMatchObject({ ok: false });
  });

  it("Erweiterung: nur ohne Luecke, kuerzen geht immer", () => {
    const belegt = (p: number) => p <= 276;
    expect(planeOszErweiterung(274, 276, belegt)).toMatchObject({ ok: true, neuePlaetze: [275, 276] });
    expect(planeOszErweiterung(274, 278, belegt)).toMatchObject({ ok: false, reason: expect.stringMatching(/Platz 277 ist leer/) });
    expect(planeOszErweiterung(274, 200, belegt)).toMatchObject({ ok: true, neuePlaetze: [] });
    expect(planeOszErweiterung(274, 422, belegt).ok).toBe(false);
  });
});

describe("oszTabelle — Firmware", () => {
  it("die RAM-Karte kennt die Tabelle mit denselben Massen", () => {
    const m = E2_RAM_MAP.find((e) => e.key === "oszTabelle")!;
    expect(m).toMatchObject({ base: OSZ_TABELLE_ADDR, stride: OSZ_EINTRAG, count: OSZ_MAX, size: OSZ_EINTRAG });
    expect(oszOffset(1)).toBe(0xd9bb0);
  });

  it("Stand aus dem Abbild, Eintraege lesen", () => {
    const fw = fakeFirmware();
    expect(leseOszStandAusFirmware(fw)).toEqual({ ok: true, anzahl: 20 });
    expect(decodeOsz(liesOsz(fw, 20)).name).toBe("OSZ 20");
    expect(istOszLeer(liesOsz(fw, 21))).toBe(true);
    expect(liesOszTabelle(fw)).toHaveLength(OSZ_MAX);
    expect(leseOszStandAusFirmware(new Uint8Array(10)).ok).toBe(false);
  });

  it("setzeOszTabelle: anhaengen zieht die Anzahl nach, Luecke wird abgelehnt, oben leeren kuerzt", () => {
    const fw = fakeFirmware();
    const r = setzeOszTabelle(fw, [
      { platz: 21, bytes: oszVariante(X_SAW_M24, { name: "X-SAW -7", parameter: -18 }) },
      { platz: 22, bytes: oszVariante(VPM_SINE_32, { name: "VPM-SINE 16", parameter: 16 }) },
    ]);
    expect(r.ok, r.ok ? "" : r.reason).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ anzahlVorher: 20, anzahlNachher: 22, geschrieben: [21, 22] });
    expect(leseOszStandAusFirmware(r.bytes)).toEqual({ ok: true, anzahl: 22 });
    expect(decodeOsz(liesOsz(r.bytes, 21)).name).toBe("X-SAW -7");
    expect(fw[oszOffset(21)]).toBe(0xff); // Eingabe unangetastet

    const luecke = setzeOszTabelle(fw, [{ platz: 25, bytes: SAW }]);
    expect(luecke.ok).toBe(false);
    if (!luecke.ok) expect(luecke.reason).toMatch(/Platz 21 ist leer/);

    const kuerzer = setzeOszTabelle(r.bytes, [{ platz: 22, bytes: leererOsz() }, { platz: 21, bytes: leererOsz() }]);
    expect(kuerzer.ok).toBe(true);
    if (kuerzer.ok) expect(kuerzer.anzahlNachher).toBe(20);

    const ohneName = setzeOszTabelle(fw, [{ platz: 21, bytes: new Uint8Array(32) }]);
    expect(ohneName.ok).toBe(false);
    expect(setzeOszTabelle(fw, [{ platz: 0, bytes: SAW }]).ok).toBe(false);
  });

  const VSB = "G:/IdeaProjects/hacktribe/fertige firmwares/SYSTEM.VSB";
  const STOCK = "G:/IdeaProjects/hacktribe/hacktribe/SYSTEM.VSB";
  it.skipIf(!fs.existsSync(VSB))("echte Hacktribe-Datei: 274 Eintraege, SAW … VPM-SINE 32, Beschreiber stimmig; 275 anhaengen", () => {
    const fw = new Uint8Array(fs.readFileSync(VSB));
    expect(leseOszStandAusFirmware(fw)).toEqual({ ok: true, anzahl: 274 });
    expect(decodeOsz(liesOsz(fw, 1)).name).toBe("SAW");
    expect(decodeOsz(liesOsz(fw, 13)).name).toBe("HPF NOISE");
    expect(decodeOsz(liesOsz(fw, 35))).toMatchObject({ name: "X-SAW -24", parameter: -63 });
    expect(decodeOsz(liesOsz(fw, 274)).name).toBe("VPM-SINE 32");
    for (let p = 275; p <= OSZ_MAX; p++) expect(istOszLeer(liesOsz(fw, p)), `Platz ${p}`).toBe(true);
    const r = setzeOszTabelle(fw, [{ platz: 275, bytes: oszVariante(liesOsz(fw, 35), { name: "X-SAW -7", parameter: fmHalbtonZuParameter(-7) }) }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(leseOszStandAusFirmware(r.bytes)).toEqual({ ok: true, anzahl: 275 });
    // nur der Platz und die vier Zellen sind anders
    let anders = 0;
    for (let i = 0; i < fw.length; i++) if (fw[i] !== r.bytes[i]) anders++;
    expect(anders).toBeLessThanOrEqual(32 + 4 * 2 + 4 * 2);
  });

  it.skipIf(!fs.existsSync(STOCK))("Stock 2.02: 421 Eintraege, ab 19 die Werks-Sample-Namen", () => {
    const fw = new Uint8Array(fs.readFileSync(STOCK));
    expect(leseOszStandAusFirmware(fw)).toEqual({ ok: true, anzahl: 421 });
    expect(decodeOsz(liesOsz(fw, 19))).toMatchObject({ name: "Hippy", kategorie: 2, programm: 50 });
  });
});

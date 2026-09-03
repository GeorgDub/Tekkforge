import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { leseOszAbbildung, remapOszDatei } from "../src/core/oszRemap";
import { parseElectribePattern, parseElectribeAllPatBank } from "../src/core/electribeImport";
import { E2S_ALLPAT_FILE_SIZE, E2S_ALLPAT_PREFIX_SIZE, E2S_BODY_SIZE } from "../src/core/e2sExport";

describe("oszRemap — Verweise umnummerieren", () => {
  it("liest die Abbildung aus der Bau-JSON oder flach", () => {
    expect(leseOszAbbildung(JSON.stringify({ altNachNeu: { "35": 35, "36": 39, "143": 231 }, umbenannt: [] }))).toEqual({ 35: 35, 36: 39, 143: 231 });
    expect(leseOszAbbildung(JSON.stringify({ "1": 1, "2": 5 }))).toEqual({ 1: 1, 2: 5 });
    expect(() => leseOszAbbildung("{}")).toThrow(/Zuordnungen/);
  });

  it(".e2spat: AMTTEST1 — 501/502 bleiben, SAW (1) wird abgebildet, Bericht stimmt", () => {
    const datei = new Uint8Array(fs.readFileSync("examples/e2s/AMTTEST1.e2spat"));
    const r = remapOszDatei(datei, { 1: 7, 501: 999 });
    expect(r.art).toBe("e2spat");
    // Parts 2, 4, 6 spielen SAW (Verweis 0 = Anzeige 1) → 7; Samples 501/502 (Verweise 500/501) werden nicht angefasst, obwohl 501 in der Abbildung steht: ueber 500 gilt sie nicht … doch: sie steht drin, also wird sie angewandt
    const p = parseElectribePattern(r.bytes);
    const refs = p.parts.map((pt) => (pt as { sampleId?: number }).sampleId);
    expect(refs[1]).toBe(6);
    expect(refs[3]).toBe(6);
    expect(refs[0]).toBe(998); // 501 → 999 (Anzeige) = Verweis 998
    expect(refs[6]).toBe(501); // 502 nicht in der Abbildung
    expect(r.bericht.geaendert.filter(([, , alt]) => alt === 1)).toHaveLength(3);
    expect(r.bericht.unbekannt).toEqual([]); // 502 liegt ueber 500 und zaehlt nicht als unbekannt
    // Original unveraendert
    expect(parseElectribePattern(datei).parts[1]).toMatchObject({ sampleId: 0 });
  });

  it(".e2sallpat: nur PTST-Slots, Bericht je Pattern", () => {
    const bank = new Uint8Array(E2S_ALLPAT_FILE_SIZE).fill(0xff);
    const spat = new Uint8Array(fs.readFileSync("examples/e2s/AMTTEST1.e2spat"));
    bank.set(spat.subarray(0x100), E2S_ALLPAT_PREFIX_SIZE);
    bank.set(spat.subarray(0x100), E2S_ALLPAT_PREFIX_SIZE + 3 * E2S_BODY_SIZE);
    const r = remapOszDatei(bank, { 1: 2 });
    expect(r.art).toBe("e2sallpat");
    expect(r.bericht.geaendert.map(([pat]) => pat)).toEqual([0, 0, 0, 3, 3, 3]);
    const b = parseElectribeAllPatBank(r.bytes);
    expect((b.patterns[3].parts[1] as { sampleId?: number }).sampleId).toBe(1);
    expect(() => remapOszDatei(new Uint8Array(10), { 1: 2 })).toThrow(/weder/);
  });
});

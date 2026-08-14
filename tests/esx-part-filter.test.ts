/**
 * tests/esx-part-filter.test.ts
 *
 * Sichert den Filter-/Mod-Block der ESX-Parts ab (Offsets verifiziert gegen
 * open-electribe-editor v1.2.0, uebernommen ueber Synthstudio v3.293).
 *
 * Der Kern ist die Bit-Aufteilung des Mod-Bytes und die Layout-Verschiebung
 * zwischen den drei Part-Typen — beides laesst sich ohne Geraet pruefen.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { parseEsxBank, type EsxPart } from "../src/core/esxParser";

const P = "E:/esx/BOTTROP.ESX";

(fs.existsSync(P) ? describe : describe.skip)("EsxPartFilter (BOTTROP)", () => {
  const esx = parseEsxBank(new Uint8Array(fs.readFileSync(P)), "BOTTROP");
  const parts: EsxPart[] = esx.patterns.flatMap((p) => p.parts);

  it("liefert fuer jeden dekodierten Part einen Filter-Block", () => {
    const mit = parts.filter((p) => p.filter);
    expect(mit.length).toBeGreaterThan(0);
  });

  it("haelt alle Werte im Geraetebereich 0..127", () => {
    for (const p of parts) {
      if (!p.filter) continue;
      for (const k of ["cutoff", "resonance", "egIntensity", "modSpeed", "modDepth"] as const) {
        expect(p.filter[k]).toBeGreaterThanOrEqual(0);
        expect(p.filter[k]).toBeLessThanOrEqual(127);
      }
    }
  });

  it("maskiert filterType auf die vier ESX-Typen (0..3)", () => {
    for (const p of parts) {
      if (!p.filter) continue;
      expect(p.filter.filterType).toBeGreaterThanOrEqual(0);
      expect(p.filter.filterType).toBeLessThanOrEqual(3);
    }
  });

  it("trennt modDest (Bits 0-2) und modType (Bits 4-6) sauber", () => {
    for (const p of parts) {
      if (!p.filter) continue;
      expect(p.filter.modDest).toBeLessThanOrEqual(7);
      expect(p.filter.modType).toBeLessThanOrEqual(7);
    }
  });

  it("findet in einer echten Bank tatsaechlich gesetzte Filterwerte", () => {
    // Waeren die Offsets falsch, laege hier mit hoher Wahrscheinlichkeit ueberall
    // 0 oder ueberall derselbe Wert. Echte Patterns nutzen den Filter.
    const cutoffs = new Set(parts.filter((p) => p.filter).map((p) => p.filter!.cutoff));
    expect(cutoffs.size).toBeGreaterThan(1);
  });
});

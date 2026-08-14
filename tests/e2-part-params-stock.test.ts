/**
 * tests/e2-part-params-stock.test.ts
 *
 * Prueft die Wertebereiche in `partParams.ts` gegen eine KORG-WERKSBANK
 * (`e2s-2016.e2sallpat`, direkt von der offiziellen Korg-Seite — weder von
 * Hacktribe noch von einem Editor erzeugt).
 *
 * Die Beweisrichtung: was in einer Werksbank steht, ist per Definition ein
 * gueltiger Geraetewert. Faellt ein Byte aus dem deklarierten Bereich, ist der
 * BEREICH falsch — nicht die Datei. Genau so wurden oscPitch und egInt als
 * bipolar erkannt.
 *
 * ☠ Die Bank liefert eine UNTERgrenze, keine Obergrenze: Hacktribe erweitert
 * u.a. die Filterliste, kann also hoehere Werte erzeugen. Der Test prueft
 * deshalb NUR, dass kein Werkswert aus dem deklarierten Bereich faellt — er
 * darf NICHT dazu verleiten, die Bereiche auf das Stock-Maximum zu verengen.
 *
 * Der Test ueberspringt sich, wenn die Datei fehlt (sie liegt nicht im Repo).
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { PART_PARAMS, readPartParamsFromBody, clampParamValue } from "../src/core/partParams";
import {
  ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET as FIRST,
  ELECTRIBE_ALLPAT_PATTERN_STRIDE as STRIDE,
} from "../src/core/electribeImport";

const F = path.resolve(process.cwd(), "files zum lernen", "e2s-2016.e2sallpat");
const DA = fs.existsSync(F);

(DA ? describe : describe.skip)("Part-Parameter gegen die KORG-Werksbank", () => {
  const buf = new Uint8Array(fs.readFileSync(F));

  /** Alle 250 Patterns x 16 Parts als Parameter-Objekte. */
  function alleParts(): Record<string, number>[] {
    const out: Record<string, number>[] = [];
    for (let pi = 0; pi < 250; pi++) {
      const base = FIRST + pi * STRIDE;
      if (base + STRIDE > buf.length) break;
      const body = buf.subarray(base, base + STRIDE);
      for (let p = 0; p < 16; p++) out.push(readPartParamsFromBody(body, p));
    }
    return out;
  }

  it("liest 4000 Parts", () => {
    expect(alleParts()).toHaveLength(4000);
  });

  it("haelt JEDEN Werkswert innerhalb des deklarierten Bereichs", () => {
    const parts = alleParts();
    const verletzt: string[] = [];
    for (const p of PART_PARAMS) {
      const werte = parts.map((x) => x[p.key]).filter((v) => v !== undefined);
      const mn = Math.min(...werte);
      const mx = Math.max(...werte);
      if (mn < p.min || mx > p.max) verletzt.push(`${p.key}: ${mn}..${mx} ausserhalb ${p.min}..${p.max}`);
    }
    expect(verletzt).toEqual([]);
  });

  it("erkennt die bipolaren Felder als vorzeichenbehaftet", () => {
    const parts = alleParts();
    // Werksbank: oscPitch laeuft exakt von -63 bis +63.
    const pitch = parts.map((x) => x.oscPitch);
    expect(Math.min(...pitch)).toBe(-63);
    expect(Math.max(...pitch)).toBe(63);
    // egInt ebenfalls negativ belegt.
    expect(Math.min(...parts.map((x) => x.egInt))).toBeLessThan(0);
  });

  it("laesst die von Hacktribe erweiterbaren Felder offen", () => {
    // Stock nutzt nur einen Teilbereich; ein Clamp darauf wuerde
    // Hacktribe-Filter/-FX abschneiden. Siehe Kopfkommentar in partParams.ts.
    for (const key of ["filterType", "modType", "grooveType", "ifxType"]) {
      const def = PART_PARAMS.find((p) => p.key === key)!;
      expect(def.max).toBe(255);
    }
  });

  it("verbiegt Werkswerte beim Klemmen nicht", () => {
    // Genau das war der Fehler der alten Bereiche: ein Pitch von -3 wurde als
    // 253 gelesen und auf 63 geklemmt.
    for (const p of alleParts()) {
      for (const def of PART_PARAMS) {
        const v = p[def.key];
        if (v === undefined) continue;
        expect(clampParamValue(def.key, v)).toBe(v);
      }
    }
  });
});

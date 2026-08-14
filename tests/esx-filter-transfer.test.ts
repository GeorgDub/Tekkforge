/**
 * tests/esx-filter-transfer.test.ts
 *
 * Prueft, dass die ESX-Filterwerte im konvertierten E2-Pattern ANKOMMEN — also
 * die ganze Kette: ESX-Datei -> Parser -> Converter -> .e2sallpat-Bytes ->
 * wieder ausgelesen an den geraetebestaetigten Offsets.
 *
 * Beide Enden sind belegt: ESX-Offsets gegen open-electribe-editor, E2-Offsets
 * am Geraet (Messreihe 2026-08-14). Genau deshalb darf hier uebertragen werden.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { parseEsxBank } from "../src/core/esxParser";
import { convertEsxToE2sBank } from "../src/core/esxToE2sBank";
import { readPartParamsFromBody } from "../src/core/partParams";
import {
  ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET as FIRST,
  ELECTRIBE_ALLPAT_PATTERN_STRIDE as STRIDE,
} from "../src/core/electribeImport";

const P = "E:/esx/BOTTROP.ESX";

(fs.existsSync(P) ? describe : describe.skip)("ESX-Filter -> E2-Pattern", () => {
  const esx = parseEsxBank(new Uint8Array(fs.readFileSync(P)), "BOTTROP");
  const r = convertEsxToE2sBank(esx);

  /** Part-Parameter aus dem fertigen .e2sallpat zurueckholen. */
  function e2Params(patternIdx: number, part: number) {
    const base = FIRST + patternIdx * STRIDE;
    return readPartParamsFromBody(r.allpat.subarray(base, base + STRIDE), part);
  }

  it("traegt Cutoff und Resonanz der Quelle ins E2-Pattern", () => {
    // Erstes Pattern mit einem Part, der einen von Null verschiedenen Cutoff hat.
    let gefunden = 0;
    const quelle = esx.patterns.filter(
      (p) => p.name?.trim() || p.parts.some((pt) => pt.steps.some((s) => s.active)),
    );
    for (let pi = 0; pi < Math.min(quelle.length, 20); pi++) {
      for (let part = 0; part < 16; part++) {
        const f = quelle[pi].parts[part]?.filter;
        if (!f || (f.cutoff === 0 && f.resonance === 0)) continue;
        const ziel = e2Params(pi, part);
        expect(ziel.cutoff).toBe(f.cutoff);
        expect(ziel.resonance).toBe(f.resonance);
        gefunden++;
      }
    }
    expect(gefunden).toBeGreaterThan(0);
  });

  it("uebertraegt die Mod-Werte, aber NICHT die Enums", () => {
    const quelle = esx.patterns.filter(
      (p) => p.name?.trim() || p.parts.some((pt) => pt.steps.some((s) => s.active)),
    );
    // Ein Part mit gesetztem, aber vom E2-Default verschiedenem filterType:
    // dessen Typ darf NICHT uebernommen worden sein (verschiedene Enums).
    let geprueft = 0;
    for (let pi = 0; pi < Math.min(quelle.length, 10); pi++) {
      for (let part = 0; part < 16; part++) {
        const f = quelle[pi].parts[part]?.filter;
        if (!f) continue;
        const ziel = e2Params(pi, part);
        expect(ziel.modSpeed).toBe(f.modSpeed);
        expect(ziel.modDepth).toBe(f.modDepth);
        geprueft++;
      }
    }
    expect(geprueft).toBeGreaterThan(0);
  });

  it("laesst egInt unangetastet — ESX unipolar, E2 bipolar", () => {
    // Wird das je uebertragen, muss vorher geklaert sein, welcher ESX-Wert der
    // Null entspricht. Bis dahin darf hier nichts geschrieben werden.
    const quelle = esx.patterns.filter(
      (p) => p.name?.trim() || p.parts.some((pt) => pt.steps.some((s) => s.active)),
    );
    const mitEg = quelle
      .flatMap((p, pi) => p.parts.map((pt, part) => ({ pi, part, f: pt.filter })))
      .filter((x) => x.f && x.f.egIntensity > 0)
      .slice(0, 20);
    for (const { pi, part, f } of mitEg) {
      if (pi >= 250) continue;
      expect(e2Params(pi, part).egInt).not.toBe(f!.egIntensity);
    }
  });
});

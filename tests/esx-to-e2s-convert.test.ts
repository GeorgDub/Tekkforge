import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { parseEsxBank } from "../src/core/esxParser";
import { convertEsxToE2sBank } from "../src/core/esxToE2sBank";
import { parseE2sBank } from "../src/core/e2sBankReader";
import { parseElectribeAllPatBank } from "../src/core/electribeImport";
import {
  buildE2sSampleMap,
  e2PatternRefToBankNumber,
} from "../src/core/e2sPatternSampleLink";

const P = "E:/esx/BOTTROP.ESX";
(fs.existsSync(P) ? describe : describe.skip)("convertEsxToE2sBank (BOTTROP)", () => {
  it("produces valid .all + .e2sallpat with linked, in-memory samples", () => {
    const esx = parseEsxBank(new Uint8Array(fs.readFileSync(P)), "BOTTROP");
    const r = convertEsxToE2sBank(esx);
    console.log("[convert] stats:", JSON.stringify(r.stats));
    // sizes / markers
    expect(r.allpat.byteLength).toBe(4_161_792);
    expect([...r.allpat.slice(0, 4)]).toEqual([0x4b, 0x4f, 0x52, 0x47]); // KORG
    expect(r.all.byteLength).toBeGreaterThan(0x1000);
    expect(r.stats.audioSeconds).toBeLessThanOrEqual(260);
    // .all samples numbered from 501
    const bank = parseE2sBank(r.all, "out.all");
    const map = buildE2sSampleMap(bank);
    expect([...map.keys()].every((k) => k >= 501)).toBe(true);
    expect(map.size).toBe(r.stats.samples);
    // every repointed (>=501) active part links to a sample
    const pat = parseElectribeAllPatBank(r.allpat);
    let repointed = 0, linked = 0;
    for (const p of pat.patterns) for (const part of p.parts) {
      if (!part.steps.some((s) => s.active)) continue;
      // Datei-Referenz → Bank-Nummer (+1) VOR dem Nachschlagen; ohne die
      // Umrechnung träfe jeder Part das nächsthöhere Sample.
      const bankNr = e2PatternRefToBankNumber(part.sampleId);
      if (bankNr >= 501) { repointed++; if (map.has(bankNr)) linked++; }
    }
    expect(repointed).toBeGreaterThan(0);
    expect(linked).toBe(repointed);
    expect(r.mapping).toContain("Geräte-Nr.");
    // Filter/Mod der Quelle wird berichtet, aber NICHT in die Pattern-Bytes
    // geschrieben — die E2-Offsets dafuer sind unbestaetigt.
    expect(r.mapping).toContain("Filter/Mod der ESX-Quelle");
    expect(r.mapping).toMatch(/\| (LPF|HPF|BPF|BPF\+) \|/);
    const filterZeilen = r.mapping
      .split(/\r?\n/)
      .filter((l) => /^\| .* \| \d+ \| (LPF|HPF|BPF)/.test(l));
    expect(filterZeilen.length).toBeGreaterThan(0);
    console.log("[filter] Berichtszeilen:", filterZeilen.length);
  });
});

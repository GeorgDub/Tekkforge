/**
 * tests/features/e2s-pattern-sample-link.test.ts
 *
 * v3.272 — verifiziert die VALUE-basierte Verknüpfung von E2-Pattern-Parts mit
 * Samples einer separaten .all-Bank über die Geräte-Sample-Nummer (OSC_0index).
 *
 *   Pattern-Part.sampleId (+0x08, z.B. 501+)  ==  E2sSlot.sampleNumber (+0x08)
 *
 * Pure-Map-Test immer; Full-Chain gegen die generierten BOTTROP-Artefakte nur
 * wenn vorhanden (examples/e2s/).
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { buildE2sSampleMap, countLinkableE2Parts } from "../src/core/e2sPatternSampleLink";
import { parseE2sBank } from "../src/core/e2sBankReader";
import { parseElectribeAllPatBank } from "../src/core/electribeImport";

describe("e2sPatternSampleLink — buildE2sSampleMap (pure)", () => {
  it("keyed by sampleNumber (OSC_0index), skips 0, first-wins", () => {
    const bank = {
      version: 1,
      slots: [
        { sampleNumber: 501, name: "a" },
        null,
        { sampleNumber: 502, name: "b" },
        { sampleNumber: 0, name: "empty" }, // ignored
        { sampleNumber: 501, name: "dup" }, // first wins → "a"
      ],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const map = buildE2sSampleMap(bank);
    expect(map.size).toBe(2);
    expect(map.get(501)?.name).toBe("a");
    expect(map.get(502)?.name).toBe("b");
    expect(map.has(0)).toBe(false);
    expect(countLinkableE2Parts([501, 502, 999], map)).toBe(2);
  });
});

const EXAMPLE_DIR = path.resolve(process.cwd(), "examples", "e2s");
const ALL = path.join(EXAMPLE_DIR, "bottrop-samples.all");
const PAT = path.join(EXAMPLE_DIR, "bottrop-test.e2sallpat");
const AVAILABLE = (() => {
  try {
    return fs.existsSync(ALL) && fs.existsSync(PAT);
  } catch {
    return false;
  }
})();

(AVAILABLE ? describe : describe.skip)("e2sPatternSampleLink — BOTTROP full-chain", () => {
  it("every active pattern part resolves to a sample by device number", () => {
    const bank = parseE2sBank(new Uint8Array(fs.readFileSync(ALL)), "bottrop-samples.all");
    const map = buildE2sSampleMap(bank);
    // The .all numbers run 501..N; the bank parser must expose them.
    expect(map.size).toBeGreaterThan(0);
    expect([...map.keys()].every((k) => k >= 501)).toBe(true);

    const patBank = parseElectribeAllPatBank(new Uint8Array(fs.readFileSync(PAT)));
    let activeParts = 0;
    let linked = 0;
    let repointed = 0; // active parts that carry a user-sample ref (>= 501)
    let repointedLinked = 0;
    for (const pat of patBank.patterns) {
      for (const part of pat.parts) {
        if (!part.steps.some((s) => s.active)) continue;
        activeParts++;
        const isUserRef = part.sampleId >= 501;
        if (isUserRef) repointed++;
        if (map.has(part.sampleId)) {
          linked++;
          if (isUserRef) repointedLinked++;
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`[BOTTROP link] ${activeParts} active parts, ${linked} linked (${(100 * linked / activeParts).toFixed(0)}%), repointed(>=501)=${repointed}, map size ${map.size}`);
    expect(activeParts).toBeGreaterThan(0);
    // Every part repointed to a user sample (>= 501) MUST resolve — both sides
    // were written from the same map, so this is exact. Parts whose ESX sample
    // wasn't extractable keep a template ref (< 501) and legitimately don't link.
    expect(repointed).toBeGreaterThan(0);
    expect(repointedLinked).toBe(repointed);
  });
});

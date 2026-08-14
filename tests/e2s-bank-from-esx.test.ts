/**
 * tests/features/e2s-bank-from-esx.test.ts
 *
 * One-shot generator: ports a real ESX-1 backup (E:\esx\BOTTROP.ESX) to the
 * KORG Electribe 2 Sampler, producing THREE matching artifacts in examples/e2s/
 * (+ convenience copies next to the user's real files):
 *
 *   1. bottrop-test.e2sallpat  — the patterns (BPM, step triggers, vol/pan),
 *      with each part's sample reference REPOINTED to the imported user samples.
 *   2. bottrop-samples.all     — the part samples, placed in .all slots 0..N-1,
 *      which appear on the E2S as user-sample numbers 501..501+N-1.
 *   3. bottrop-mapping.md       — the manual: which .all slot / hardware number /
 *      ESX sample name, and which patterns/parts trigger each.
 *
 * Sample-reference offset: the per-part sample number lives at part+0x08 (u16 LE).
 * Verified empirically against all 16×250 parts of e2s-2016.e2sallpat — values
 * span 1..~500 (factory numbers); 0 = none. (The read-side parser historically
 * guessed +0x04, which is ~always 0.)
 *
 * "501" = E2S user-sample numbering (factory 1..~500, user 501+). This is a
 * documented ASSUMPTION about the device's .all import base — verify on hardware.
 *
 * Conditional: skips if the ESX file isn't present.
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

import { parseEsxBank } from "../src/core/esxParser";
import type { EsxPattern, EsxSample } from "../src/core/esxParser";
import { buildE2sBank, type E2sSlotInput } from "../src/core/e2sBankBuilder";
import { parseE2sBank } from "../src/core/e2sBankReader";
import {
  bankNumberToE2PatternRef,
  displayNumberToSlotIndex,
} from "../src/core/e2sPatternSampleLink";
import { buildE2AllPatFile, E2S_ALLPAT_FILE_SIZE } from "../src/core/e2sExport";
import type { E2PatternInput } from "../src/core/electribePatternBuilder";

const ESX_PATH = "E:/esx/BOTTROP.ESX";
const EXAMPLE_DIR = path.resolve(process.cwd(), "examples", "e2s");
const KORG_DIR = path.resolve(process.cwd(), "Korg e2s files");

const E2_BASE_NOTE = 0x48; // C5
const USER_SAMPLE_BASE = 501; // E2S user-sample numbering start (assumption)
const PART_SAMPLE_OFF = 0x08; // per-part sample ref, u16 LE (verified)
const PARTS_OFF = 0x800;
const PART_STRIDE = 816;
const ALLPAT_FIRST_SLOT = 0x10100;
const BODY_SIZE = 0x4000;

/** Simple linear resampler for a flat mono Float32 buffer. */
function resampleMono(pcm: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || pcm.length === 0) return pcm;
  const ratio = toRate / fromRate;
  const outLen = Math.max(1, Math.round(pcm.length * ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(pcm.length - 1, i0 + 1);
    const frac = src - i0;
    out[i] = pcm[i0] * (1 - frac) + pcm[i1] * frac;
  }
  return out;
}

const ESX_AVAILABLE = (() => {
  try {
    return fs.existsSync(ESX_PATH);
  } catch {
    return false;
  }
})();

describe("BOTTROP.ESX → matching .e2sallpat + .all (samples at 501+) + manual", () => {
  // The ESX file is user-private and absent on CI / fresh clones. Guard BEFORE
  // any fs read — a top-level read in the describe body runs even under
  // describe.skip and would crash collection. Register a skipped placeholder
  // and return early when the file isn't present.
  if (!ESX_AVAILABLE) {
    it.skip("requires E:/esx/BOTTROP.ESX (user-private, not in repo)", () => {});
    return;
  }

  const esx = parseEsxBank(new Uint8Array(fs.readFileSync(ESX_PATH)), "BOTTROP.ESX");

  // ── Patterns: select non-empty ─────────────────────────────────────────────
  const nonEmpty = esx.patterns.filter(
    (p) =>
      (p.name && p.name.trim().length > 0) ||
      p.parts.some((pt) => pt.steps.some((s) => s.active)),
  );
  const selected = nonEmpty.slice(0, 250);

  // ── Samples: ONLY those actually triggered by a pattern part (parts with at
  // least one active step). The full 166-sample set is ~275s of mono audio and
  // overflows the E2S sample RAM (~270s) → import error. Restricting to used
  // samples keeps the bank well within memory. ─────────────────────────────────
  const usedEsxIndices = new Set<number>();
  for (const p of selected) {
    for (const part of p.parts) {
      if (part.steps.some((s) => s.active)) usedEsxIndices.add(part.sampleId);
    }
  }
  const monos = esx.monoSamples.filter((s) => usedEsxIndices.has(s.index)).slice(0, 250);

  /** esxSampleIndex → { allSlot, hwNumber, name } */
  const sampleMap = new Map<number, { allSlot: number; hwNumber: number; name: string }>();
  const slots: E2sSlotInput[] = monos.map((s: EsxSample, j) => {
    const targetRate = s.sampleRate === 48000 ? 48000 : 44100;
    const pcm = resampleMono(s.pcmData, s.sampleRate, targetRate);
    const name = (s.name && s.name.trim()) || `BOTTROP ${s.index}`;
    const hwNumber = USER_SAMPLE_BASE + j;
    sampleMap.set(s.index, { allSlot: hwNumber, hwNumber, name });
    return {
      // Anzeige am Geraet = Tabellenindex + 2 (SLOTNUM-Messung 2026-08-14):
      // Nummer N gehoert auf Platz N − 2, esli traegt N selbst.
      slotIndex: displayNumberToSlotIndex(hwNumber),
      sampleNumber: hwNumber, // device-displayed number (esli +0x08/+0x56)
      category: 17, // "User" — wie echte User-Sample-Bänke
      name,
      pcmData: pcm,
      sampleRate: targetRate,
      channels: 1,
    };
  });

  function esxToE2(p: EsxPattern): E2PatternInput {
    const stepLength: 16 | 32 | 64 =
      p.lengthSteps === 32 ? 32 : p.lengthSteps === 64 ? 64 : 16;
    const parts = p.parts.map((part) => {
      const note = Math.max(0, Math.min(127, E2_BASE_NOTE + (part.pitch ?? 0)));
      const mapped = sampleMap.get(part.sampleId);
      const steps = part.steps.map((s) => ({
        active: !!s.active,
        velocity: typeof s.velocity === "number" ? s.velocity : undefined,
        accent: !!s.accent,
        note,
      }));
      return {
        volume: part.volume,
        pan: part.pan,
        // Pattern-Referenz liegt um eins unter der Geraete-Nummer.
        sampleId: mapped
          ? bankNumberToE2PatternRef(mapped.hwNumber)
          : undefined,
        steps,
      };
    });
    return { name: p.name || "ESX Pattern", bpm: p.bpm, stepLength, parts };
  }

  const e2Inputs = selected.map(esxToE2);
  const allpat = new Uint8Array(buildE2AllPatFile(e2Inputs));
  const bankResult = buildE2sBank(slots);
  const allBank = new Uint8Array(bankResult.buffer);

  // Small diagnostic bank: first 8 samples only — to test whether a *small*
  // mono .all imports without error (isolates "format/mono" from "memory full").
  const smallBank = new Uint8Array(buildE2sBank(slots.slice(0, 8)).buffer);

  it("logs the BOTTROP contents + sample-rate histogram", () => {
    const rates: Record<number, number> = {};
    esx.monoSamples.forEach((s) => (rates[s.sampleRate] = (rates[s.sampleRate] ?? 0) + 1));
    // eslint-disable-next-line no-console
    console.log(
      `[BOTTROP] patterns=${esx.patterns.length} non-empty=${selected.length}  ` +
        `mono samples=${esx.monoSamples.length} (using ${slots.length})  ` +
        `rates=${JSON.stringify(rates)}  warnings=${esx.warnings.length}`,
    );
    expect(slots.length).toBeGreaterThan(0);
  });

  it("builds a valid .all sample bank that round-trips", () => {
    expect(bankResult.slotCount).toBe(slots.length);
    const reparsed = parseE2sBank(allBank, "bottrop-samples.all");
    const nonEmptySlots = reparsed.slots.filter((s) => s && s.pcmData && s.pcmData.length > 0);
    expect(nonEmptySlots.length).toBe(slots.length);
  });

  it("builds a valid, exact-size .e2sallpat with repointed sample refs", () => {
    expect(allpat.byteLength).toBe(E2S_ALLPAT_FILE_SIZE);
    expect([...allpat.slice(0, 4)]).toEqual([0x4b, 0x4f, 0x52, 0x47]); // KORG

    // Verify the per-part sample number @ +0x08 matches the repoint map for at
    // least one well-populated pattern.
    const readPartSample = (patIdx: number, partIdx: number): number => {
      const o = ALLPAT_FIRST_SLOT + patIdx * BODY_SIZE + PARTS_OFF + partIdx * PART_STRIDE;
      return allpat[o + PART_SAMPLE_OFF] | (allpat[o + PART_SAMPLE_OFF + 1] << 8);
    };
    let checked = 0;
    selected.forEach((src, i) => {
      src.parts.forEach((part, p) => {
        const mapped = sampleMap.get(part.sampleId);
        if (mapped) {
          expect(readPartSample(i, p)).toBe(
            bankNumberToE2PatternRef(mapped.hwNumber),
          );
          expect(mapped.hwNumber).toBeGreaterThanOrEqual(USER_SAMPLE_BASE);
          checked++;
        }
      });
    });
    expect(checked).toBeGreaterThan(0);
  });

  it("writes the three artifacts to disk", () => {
    // ── Manual ────────────────────────────────────────────────────────────────
    const lines: string[] = [];
    lines.push("# BOTTROP → KORG Electribe 2 Sampler — Import-Anleitung");
    lines.push("");
    lines.push("Generiert aus `BOTTROP.ESX` (ESX-1) für die Electribe 2 Sampler.");
    lines.push("");
    lines.push("## Dateien");
    lines.push("- `bottrop-samples.all` → auf SD-Karte als `e2sSample.all`, am Gerät importieren.");
    lines.push("- `bottrop-test.e2sallpat` → Pattern-Bank importieren.");
    lines.push("");
    lines.push("## Sample-Nummerierung (am Gerät gemessen)");
    lines.push(
      "Die User-Samples beginnen am Gerät bei **501**. Die Anzeige am Gerät " +
        "ist der `.all`-Tabellenindex **plus zwei**: Sample **501** liegt auf " +
        "Slot 499, **502** auf Slot 500, usw. (SLOTNUM-Messung 2026-08-14). " +
        "In der Pattern-Datei steht die Referenz um eins unter der Anzeige " +
        "(am Gerät gemessen) — die Parts treffen dadurch genau diese Nummern.",
    );
    lines.push("");
    lines.push("## Sample-Liste (Geräte-Nummer → Name → ESX-Quelle)");
    lines.push("");
    lines.push("| Geräte-# (= .all-Slot) | Name | ESX-Sample-Index |");
    lines.push("|---:|---|---:|");
    for (const [esxIdx, m] of [...sampleMap.entries()].sort((a, b) => a[1].allSlot - b[1].allSlot)) {
      lines.push(`| ${m.hwNumber} | ${m.name} | ${esxIdx} |`);
    }
    lines.push("");
    lines.push("## Pattern → Part → Sample");
    lines.push("");
    selected.forEach((src, i) => {
      const used = src.parts
        .map((part, p) => {
          const m = sampleMap.get(part.sampleId);
          const hits = part.steps.filter((s) => s.active).length;
          if (!m || hits === 0) return null;
          return `P${p}=#${m.hwNumber}(${m.name}, ${hits} Steps)`;
        })
        .filter(Boolean);
      lines.push(`- **Pattern ${i + 1}** "${src.name || "(unbenannt)"}" — ${used.join(", ") || "—"}`);
    });
    const manual = lines.join("\n") + "\n";

    fs.mkdirSync(EXAMPLE_DIR, { recursive: true });
    fs.writeFileSync(path.join(EXAMPLE_DIR, "bottrop-test.e2sallpat"), allpat);
    fs.writeFileSync(path.join(EXAMPLE_DIR, "bottrop-samples.all"), allBank);
    fs.writeFileSync(path.join(EXAMPLE_DIR, "bottrop-samples-small.all"), smallBank);
    fs.writeFileSync(path.join(EXAMPLE_DIR, "bottrop-mapping.md"), manual);

    try {
      if (fs.existsSync(KORG_DIR)) {
        fs.writeFileSync(path.join(KORG_DIR, "bottrop-test.e2sallpat"), allpat);
        fs.writeFileSync(path.join(KORG_DIR, "bottrop-samples.all"), allBank);
        fs.writeFileSync(path.join(KORG_DIR, "bottrop-mapping.md"), manual);
      }
    } catch {
      /* non-fatal */
    }

    expect(fs.existsSync(path.join(EXAMPLE_DIR, "bottrop-samples.all"))).toBe(true);
  });
});

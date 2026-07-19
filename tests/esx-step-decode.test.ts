/**
 * Tests für die spec-korrekte ESX-Step-Dekodierung (TABLE23: bit-gepackt
 * LSB-first, 16 Bytes = 128 Steps) + Keyboard-Noten/Gates (TABLE7) +
 * Multi-Takt-Länge + Cut-Ziele im E2-Converter.
 */
import { describe, it, expect } from "vitest";
import { parseEsxPattern, ESX1_MAX_STEPS, type EsxBank } from "../src/core/esxParser";
import { convertEsxToE2sBank, suggestE2StepLength } from "../src/core/esxToE2sBank";
import { parseElectribeAllPatBank } from "../src/core/electribeImport";

const BLOCK = 4280;
const DRUM0 = 0x18;
const KB0 = 0x14a;
const ACCENT = 0x46a;

/** Baut einen synthetischen 4280-Byte-Pattern-Block. */
function makeBlock(opts: { bars: number; stepsPerBar?: number }): Uint8Array {
  const raw = new Uint8Array(BLOCK);
  // Name "TEST" → non-empty
  raw.set([0x54, 0x45, 0x53, 0x54, 0x20, 0x20, 0x20, 0x20], 0);
  // BPM 160 × 128 BE
  const bpm = 160 * 128;
  raw[8] = (bpm >> 8) & 0xff;
  raw[9] = bpm & 0xff;
  raw[0x0b] = (opts.bars - 1) & 0x07; // Flags: Länge-1 in Takten
  raw[0x0d] = ((opts.stepsPerBar ?? 16) - 1) & 0x0f; // Last Step
  return raw;
}

function setStepBit(raw: Uint8Array, partOff: number, headerBytes: number, step: number): void {
  raw[partOff + headerBytes + (step >> 3)] |= 1 << (step & 7);
}

describe("ESX Step-Decode (offizielle Spec)", () => {
  it("decodes bit-packed drum steps LSB-first across bars", () => {
    const raw = makeBlock({ bars: 2 });
    // Drum 1: Sample 5, Kick auf 0,4,8,12 (Takt 1) + 17 (Takt 2)
    raw[DRUM0] = 0;
    raw[DRUM0 + 1] = 5;
    for (const s of [0, 4, 8, 12, 17]) setStepBit(raw, DRUM0, 18, s);
    const p = parseEsxPattern(raw, 0)!;
    expect(p.lengthSteps).toBe(32);
    const d1 = p.parts[0];
    expect(d1.sampleId).toBe(5);
    expect(d1.steps).toHaveLength(ESX1_MAX_STEPS);
    const active = d1.steps.map((s, i) => (s.active ? i : -1)).filter((i) => i >= 0);
    expect(active).toEqual([0, 4, 8, 12, 17]);
  });

  it("length = bars × stepsPerBar (z.B. 4 Takte × 12 = 48)", () => {
    const p = parseEsxPattern(makeBlock({ bars: 4, stepsPerBar: 12 }), 0)!;
    expect(p.lengthSteps).toBe(48);
    expect(parseEsxPattern(makeBlock({ bars: 8 }), 0)!.lengthSteps).toBe(128);
  });

  it("keyboard part yields per-step notes + gates (bit7 = OFF)", () => {
    const raw = makeBlock({ bars: 1 });
    raw[KB0] = 0;
    raw[KB0 + 1] = 7; // Sample 7
    // Step 2: C4 (60), Gate 100; Step 5: E4 (64), Gate 30; Rest OFF (0x80)
    for (let s = 0; s < 128; s++) raw[KB0 + 18 + s] = 0x80;
    raw[KB0 + 18 + 2] = 60;
    raw[KB0 + 146 + 2] = 100;
    raw[KB0 + 18 + 5] = 64;
    raw[KB0 + 146 + 5] = 30;
    const p = parseEsxPattern(raw, 0)!;
    const kb = p.parts[9];
    expect(kb.sampleId).toBe(7);
    expect(kb.steps[2]).toMatchObject({ active: true, note: 60, gate: 100 });
    expect(kb.steps[5]).toMatchObject({ active: true, note: 64, gate: 30 });
    expect(kb.steps[3].active).toBe(false);
  });

  it("accent track boosts velocity to 127", () => {
    const raw = makeBlock({ bars: 1 });
    raw[DRUM0 + 1] = 3;
    setStepBit(raw, DRUM0, 18, 0);
    setStepBit(raw, DRUM0, 18, 4);
    setStepBit(raw, ACCENT, 1, 0); // Accent auf Step 0
    const p = parseEsxPattern(raw, 0)!;
    expect(p.parts[0].steps[0].velocity).toBe(127);
    expect(p.parts[0].steps[4].velocity).toBe(100);
  });

  it("suggestE2StepLength: 16/32/64-Brackets, 65+ → 64", () => {
    expect(suggestE2StepLength(16)).toBe(16);
    expect(suggestE2StepLength(17)).toBe(32);
    expect(suggestE2StepLength(32)).toBe(32);
    expect(suggestE2StepLength(48)).toBe(64);
    expect(suggestE2StepLength(128)).toBe(64);
  });
});

describe("ESX→E2 mit Step-Zielen", () => {
  function makeBank(): EsxBank {
    const raw = makeBlock({ bars: 8 }); // 128 Steps
    raw[DRUM0 + 1] = 1; // Sample-Index 1
    // Kick alle 4 Steps über die vollen 128
    for (let s = 0; s < 128; s += 4) setStepBit(raw, DRUM0, 18, s);
    // Keyboard-Melodie in Takt 1
    for (let s = 0; s < 128; s++) raw[KB0 + 18 + s] = 0x80;
    raw[KB0 + 1] = 1;
    raw[KB0 + 18 + 0] = 62; // D4
    raw[KB0 + 146 + 0] = 127; // volles Gate → E2 96 (Tie)
    const pattern = parseEsxPattern(raw, 0)!;
    const pcm = new Float32Array(500).fill(0.3);
    return {
      source: "synthetic",
      monoSamples: [
        {
          index: 1,
          name: "kick",
          channels: 1,
          sampleRate: 44100,
          frames: 500,
          pcmData: pcm,
          loopStart: 0,
          loopEnd: 499,
          level: 100,
        },
      ],
      stereoSamples: [],
      patterns: [pattern],
      songs: [],
      warnings: [],
    } as unknown as EsxBank;
  }

  it("default: 128 Steps → Vorschlag 64, Steps 65+ gecuttet", () => {
    const r = convertEsxToE2sBank(makeBank());
    const bank = parseElectribeAllPatBank(r.allpat);
    const p = bank.patterns[0];
    expect(p.stepLength).toBe(64);
    const kicks = p.parts[0].steps.map((s, i) => (s.active ? i : -1)).filter((i) => i >= 0);
    expect(kicks).toEqual([0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60]);
    // Keyboard-Note + Gate fließen durch
    expect(p.parts[9].steps[0].active).toBe(true);
    expect(p.parts[9].steps[0].note).toBe(62);
    expect(p.parts[9].steps[0].gate).toBe(96); // 127 → 96 (Tie)
  });

  it("stepTargets erzwingt Cut bei 16", () => {
    const r = convertEsxToE2sBank(makeBank(), { stepTargets: { 0: 16 } });
    const p = parseElectribeAllPatBank(r.allpat).patterns[0];
    expect(p.stepLength).toBe(16);
    const kicks = p.parts[0].steps.map((s, i) => (s.active ? i : -1)).filter((i) => i >= 0);
    expect(kicks).toEqual([0, 4, 8, 12]);
  });
});

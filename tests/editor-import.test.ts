import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import {
  createProject,
  createPattern,
  importSampleFromWav,
  buildBankFiles,
  buildPatternFile,
  importE2Patterns,
  importSamplesFromAll,
  editorProjectFromE2Files,
  editorPatternFromParsed,
  patternHasContent,
  EDITOR_GATE_MAX,
} from "../src/core/editorModel";
import { encodeWav16 } from "../src/core/wavCodec";
import { parseElectribeBank } from "../src/core/electribeImport";
import { parseEsxBank } from "../src/core/esxParser";
import { convertEsxToE2sBank } from "../src/core/esxToE2sBank";

function sineWav(frames: number, rate: number, channels: 1 | 2): Uint8Array {
  const pcm = new Float32Array(frames * channels);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 9) * 0.6;
  return encodeWav16(pcm, rate, channels);
}

/** Baut ein Referenz-Projekt mit Noten/Velocity/Gate/Sample-Refs. */
function buildRefProject() {
  const project = createProject();
  const p = project.patterns[0];
  p.name = "IMPORTME";
  p.bpm = 172;
  p.stepLength = 32;
  p.parts[0].sampleNumber = 501;
  p.parts[0].steps[0] = { on: true, velocity: 120, note: 60, gate: 30 };
  p.parts[0].steps[8] = { on: true, velocity: 90, note: 60, gate: EDITOR_GATE_MAX }; // Tie
  p.parts[8].sampleNumber = 502;
  p.parts[8].steps[4] = { on: true, velocity: 100, note: 67, gate: 48 }; // G4
  project.patterns.push(createPattern("ZWEITES"));
  project.patterns[1].parts[2].steps[3] = { on: true, velocity: 77, note: 72, gate: 12 };
  return project;
}

describe("editorModel — Import .e2sallpat/.e2spat zurück in den Editor", () => {
  it("round-trips a bank: build .e2sallpat → importE2Patterns matches steps/notes/vel/gate/sample", () => {
    const project = buildRefProject();
    const { allpat } = buildBankFiles(project);
    const res = importE2Patterns(allpat);
    // Nur die 2 belegten Patterns (nicht 250 init slots)
    expect(res.patterns).toHaveLength(2);
    expect(res.totalInFile).toBe(250);
    expect(res.filteredEmpty).toBe(true);

    const p0 = res.patterns[0];
    expect(p0.name).toBe("IMPORTME");
    expect(p0.bpm).toBeCloseTo(172, 0);
    expect(p0.stepLength).toBe(32);
    expect(p0.parts[0].sampleNumber).toBe(501);
    expect(p0.parts[0].steps[0]).toEqual({ on: true, velocity: 120, note: 60, gate: 30 });
    // Tie: gate 96 bleibt Tie
    expect(p0.parts[0].steps[8].gate).toBe(EDITOR_GATE_MAX);
    expect(p0.parts[0].steps[8].on).toBe(true);
    expect(p0.parts[8].sampleNumber).toBe(502);
    expect(p0.parts[8].steps[4]).toEqual({ on: true, velocity: 100, note: 67, gate: 48 });
    // Part-Labels aus Layout
    expect(p0.parts[0].label).toBe("Kick");
    expect(p0.parts[8].label).toBe("Bass");
    // Zweites Pattern
    expect(res.patterns[1].parts[2].steps[3]).toEqual({ on: true, velocity: 77, note: 72, gate: 12 });
  });

  it("round-trips a single .e2spat", () => {
    const project = buildRefProject();
    const file = buildPatternFile(project.patterns[0]);
    const res = importE2Patterns(file);
    expect(res.patterns).toHaveLength(1);
    expect(res.patterns[0].name).toBe("IMPORTME");
    expect(res.patterns[0].parts[0].steps[0].note).toBe(60);
  });

  it("onlyNonEmpty=false keeps all 250 slots", () => {
    const project = buildRefProject();
    const { allpat } = buildBankFiles(project);
    const res = importE2Patterns(allpat, false);
    expect(res.patterns).toHaveLength(250);
  });

  it("imports samples from .all with device numbers preserved", () => {
    const project = createProject();
    project.samples.push(importSampleFromWav(sineWav(1500, 44100, 1), "kick.wav", project.samples));
    project.samples.push(importSampleFromWav(sineWav(800, 44100, 1), "snare.wav", project.samples));
    project.patterns[0].parts[0].sampleNumber = 501;
    project.patterns[0].parts[0].steps[0].on = true;
    const { all } = buildBankFiles(project);
    expect(all).not.toBeNull();
    const pool = importSamplesFromAll(all!);
    expect(pool.map((s) => s.number)).toEqual([501, 502]);
    expect(pool[0].name).toBe("kick");
    expect(pool[0].pcm.length).toBeGreaterThan(0);
  });

  it("editorProjectFromE2Files reconstructs patterns + linked pool", () => {
    const project = createProject();
    project.samples.push(importSampleFromWav(sineWav(1200, 44100, 1), "hoover.wav", project.samples));
    const p = project.patterns[0];
    p.name = "FULLTRIP";
    p.parts[0].sampleNumber = 501;
    p.parts[0].steps[0] = { on: true, velocity: 111, note: 64, gate: 40 };
    const { allpat, all } = buildBankFiles(project);
    const restored = editorProjectFromE2Files(allpat, all);
    expect(restored.patterns[0].name).toBe("FULLTRIP");
    expect(restored.patterns[0].parts[0].sampleNumber).toBe(501);
    expect(restored.patterns[0].parts[0].steps[0]).toEqual({ on: true, velocity: 111, note: 64, gate: 40 });
    expect(restored.samples).toHaveLength(1);
    expect(restored.samples[0].number).toBe(501);
    expect(restored.samples[0].name).toBe("hoover");
    // Round-trip erneut exportierbar
    expect(buildBankFiles(restored).allpat.byteLength).toBe(allpat.byteLength);
  });

  it("patternHasContent detects active steps", () => {
    const empty = createPattern("X");
    expect(patternHasContent(empty)).toBe(false);
    empty.parts[3].steps[5].on = true;
    expect(patternHasContent(empty)).toBe(true);
  });

  it("editorPatternFromParsed maps a raw parsed pattern (defensive defaults)", () => {
    const project = buildRefProject();
    const { allpat } = buildBankFiles(project);
    const parsed = parseElectribeBank(allpat).patterns[0];
    const ed = editorPatternFromParsed(parsed);
    expect(ed.parts).toHaveLength(16);
    expect(ed.parts[0].steps).toHaveLength(64);
  });
});

const ESX = "E:/esx/BOTTROP.ESX";
(fs.existsSync(ESX) ? describe : describe.skip)("ESX-Converter-Ergebnis → Editor (BOTTROP)", () => {
  it("converted allpat+all open as an editable project with samples", () => {
    const esx = parseEsxBank(new Uint8Array(fs.readFileSync(ESX)), "BOTTROP");
    const r = convertEsxToE2sBank(esx);
    const project = editorProjectFromE2Files(r.allpat, r.all);
    // Nur belegte Patterns (die 32 realen), nicht 250
    expect(project.patterns.length).toBeGreaterThan(0);
    expect(project.patterns.length).toBeLessThanOrEqual(r.stats.patterns);
    // Samples ab 501 im Pool
    expect(project.samples.length).toBe(r.stats.samples);
    expect(project.samples.every((s) => s.number >= 501)).toBe(true);
    // Mindestens ein Part verlinkt auf ein Pool-Sample
    const poolNums = new Set(project.samples.map((s) => s.number));
    const linked = project.patterns.some((p) =>
      p.parts.some((pt) => pt.sampleNumber !== null && poolNums.has(pt.sampleNumber)),
    );
    expect(linked).toBe(true);
  });
});

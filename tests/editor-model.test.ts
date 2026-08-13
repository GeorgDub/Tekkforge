import { describe, it, expect } from "vitest";
import {
  createProject,
  createPattern,
  importSampleFromWav,
  nextFreeSampleNumber,
  patternToE2Input,
  buildPatternFile,
  buildBankFiles,
  serializeProject,
  deserializeProject,
  noteName,
  EDITOR_SAMPLE_BASE,
} from "../src/core/editorModel";
import { encodeWav16 } from "../src/core/wavCodec";
import { parseElectribeAllPatBank } from "../src/core/electribeImport";
import { parseE2sBank } from "../src/core/e2sBankReader";
import { buildE2sSampleMap } from "../src/core/e2sPatternSampleLink";
import { E2S_ALLPAT_FILE_SIZE, E2S_SINGLE_FILE_SIZE } from "../src/core/e2sExport";

function sineWav(frames: number, rate: number, channels: 1 | 2): Uint8Array {
  const pcm = new Float32Array(frames * channels);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 10) * 0.7;
  return encodeWav16(pcm, rate, channels);
}

describe("editorModel — Pattern-Erstellung ohne ESX", () => {
  it("creates a project with 16-part layout and exports a valid single .e2spat", () => {
    const project = createProject();
    const p = project.patterns[0];
    expect(p.parts).toHaveLength(16);
    expect(p.parts[0].label).toBe("Kick");
    p.name = "TESTKICK";
    p.bpm = 174.5;
    p.parts[0].steps[0].on = true;
    p.parts[0].steps[4].on = true;
    const file = buildPatternFile(p);
    expect(file.byteLength).toBe(E2S_SINGLE_FILE_SIZE);
    expect([...file.slice(0, 4)]).toEqual([0x4b, 0x4f, 0x52, 0x47]); // KORG
  });

  it("round-trips steps, notes, velocity, sample refs through .e2sallpat", () => {
    const project = createProject();
    const p = project.patterns[0];
    p.name = "ROUNDTRIP";
    p.bpm = 165;
    p.stepLength = 32;
    p.parts[0].sampleNumber = 501;
    p.parts[0].steps[0] = { on: true, velocity: 127, note: 72, gate: 30 };
    p.parts[8].sampleNumber = 502;
    p.parts[8].steps[3] = { on: true, velocity: 80, note: 60, gate: 96 }; // Bass C4, Tie
    const { allpat } = buildBankFiles(project);
    expect(allpat.byteLength).toBe(E2S_ALLPAT_FILE_SIZE);
    const bank = parseElectribeAllPatBank(allpat);
    const rp = bank.patterns[0];
    expect(rp.name).toBe("ROUNDTRIP");
    expect(rp.bpm).toBeCloseTo(165, 1);
    expect(rp.stepLength).toBe(32);
    // Rohwert IN DER DATEI liegt um eins unter der Geräte-/Bank-Nummer
    // (am Gerät gemessen, siehe bankNumberToE2PatternRef). Ein Part, der das
    // Sample 501 spielen soll, trägt in der Datei die 500.
    expect(rp.parts[0].sampleId).toBe(500);
    expect(rp.parts[0].steps[0].active).toBe(true);
    expect(rp.parts[0].steps[1].active).toBe(false);
    expect(rp.parts[8].sampleId).toBe(501);
    expect(rp.parts[8].steps[3].active).toBe(true);
    expect(rp.parts[8].steps[3].velocity).toBe(80);
    expect(rp.parts[8].steps[3].gate).toBe(96);
    expect(rp.parts[8].steps[3].note).toBe(60);
    expect(rp.parts[0].steps[0].gate).toBe(30);
    expect(rp.parts[0].steps[0].note).toBe(72);
  });

  it("imports WAV (stereo 22050 Hz) → mono 44100, numbers from 501, builds linkable .all", () => {
    const project = createProject();
    const s1 = importSampleFromWav(sineWav(2000, 22050, 2), "kick1_A.wav", project.samples);
    project.samples.push(s1);
    const s2 = importSampleFromWav(sineWav(1000, 44100, 1), "snare.wav", project.samples);
    project.samples.push(s2);
    expect(s1.number).toBe(EDITOR_SAMPLE_BASE);
    expect(s2.number).toBe(EDITOR_SAMPLE_BASE + 1);
    expect(s1.sampleRate).toBe(44100);
    expect(s1.name).toBe("kick1_A");
    // Resample 22050→44100 verdoppelt (±1 Frame)
    expect(Math.abs(s1.pcm.length - 4000)).toBeLessThanOrEqual(2);

    const p = project.patterns[0];
    p.parts[0].sampleNumber = s1.number;
    p.parts[0].steps[0].on = true;
    const { all, warnings } = buildBankFiles(project);
    expect(all).not.toBeNull();
    const bank = parseE2sBank(all!, "test.all");
    const map = buildE2sSampleMap(bank);
    expect(map.has(501)).toBe(true);
    expect(map.has(502)).toBe(true);
    expect(map.get(501)!.name).toBe("kick1_A");
    expect(warnings).toHaveLength(0);
  });

  it("warns on parts with steps but missing/unknown sample", () => {
    const project = createProject();
    const p = project.patterns[0];
    p.parts[0].steps[0].on = true; // kein Sample
    p.parts[1].sampleNumber = 777; // nicht im Pool
    p.parts[1].steps[0].on = true;
    const { warnings } = buildBankFiles(project);
    expect(warnings.some((w) => w.includes("kein Sample"))).toBe(true);
    expect(warnings.some((w) => w.includes("#777"))).toBe(true);
  });

  it("serializes and restores a full project (patterns + sample PCM)", () => {
    const project = createProject();
    project.patterns.push(createPattern("ZWEITES"));
    project.patterns[0].parts[2].steps[7] = { on: true, velocity: 66, note: 48, gate: 12 };
    project.samples.push(
      importSampleFromWav(sineWav(500, 44100, 1), "hoover.wav", project.samples),
    );
    const restored = deserializeProject(serializeProject(project));
    expect(restored.patterns).toHaveLength(2);
    expect(restored.patterns[1].name).toBe("ZWEITES");
    const st = restored.patterns[0].parts[2].steps[7];
    expect(st).toEqual({ on: true, velocity: 66, note: 48, gate: 12 });
    expect(restored.samples).toHaveLength(1);
    expect(restored.samples[0].number).toBe(501);
    expect(restored.samples[0].pcm.length).toBe(500);
    // Export aus restauriertem Projekt funktioniert
    expect(buildBankFiles(restored).allpat.byteLength).toBe(E2S_ALLPAT_FILE_SIZE);
  });

  it("rejects invalid project files", () => {
    expect(() => deserializeProject("not json")).toThrow(/JSON/);
    expect(() => deserializeProject('{"app":"other"}')).toThrow(/TekkForge/);
  });

  it("nextFreeSampleNumber fills gaps", () => {
    const samples = [
      { number: 501, name: "a", sampleRate: 44100, pcm: new Float32Array(1) },
      { number: 503, name: "b", sampleRate: 44100, pcm: new Float32Array(1) },
    ];
    expect(nextFreeSampleNumber(samples)).toBe(502);
  });

  it("patternToE2Input slices steps to stepLength and maps fields", () => {
    const p = createPattern("X");
    p.stepLength = 16;
    p.parts[0].steps[20].on = true; // jenseits stepLength → nicht exportiert
    const input = patternToE2Input(p);
    expect(input.parts[0].steps).toHaveLength(16);
  });

  it("noteName matches MIDI convention (60 = C4 = Originaltonhöhe)", () => {
    expect(noteName(72)).toBe("C5");
    expect(noteName(60)).toBe("C4");
    expect(noteName(61)).toBe("C#4");
  });
});

import { describe, it, expect } from "vitest";
import {
  createProject,
  importSampleFromWav,
  processWavToMono,
  sanitizeSampleName,
  buildSampleBank,
  renumberSample,
  importSamplesFromAll,
  EDITOR_SAMPLE_BASE,
} from "../src/core/editorModel";
import { encodeWav16 } from "../src/core/wavCodec";
import { parseE2sBank } from "../src/core/e2sBankReader";
import { buildE2sSampleMap } from "../src/core/e2sPatternSampleLink";

function wav(frames: number, rate = 44100, ch: 1 | 2 = 1): Uint8Array {
  const pcm = new Float32Array(frames * ch);
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 7) * 0.5;
  return encodeWav16(pcm, rate, ch);
}

describe("Sample-Bank bearbeiten (.all editieren)", () => {
  it("buildSampleBank produces a valid .all with device numbers preserved", () => {
    const project = createProject();
    project.samples.push(importSampleFromWav(wav(1000), "kick.wav", project.samples));
    project.samples.push(importSampleFromWav(wav(600), "hat.wav", project.samples));
    const all = buildSampleBank(project.samples);
    expect(all).not.toBeNull();
    const map = buildE2sSampleMap(parseE2sBank(all!, "x.all"));
    expect([...map.keys()].sort()).toEqual([501, 502]);
    expect(map.get(501)!.name).toBe("kick");
    expect(map.get(502)!.name).toBe("hat");
  });

  it("buildSampleBank returns null for empty pool", () => {
    expect(buildSampleBank([])).toBeNull();
  });

  it("renameeffect: sanitized name flows into the .all", () => {
    const project = createProject();
    const s = importSampleFromWav(wav(500), "raw.wav", project.samples);
    s.name = sanitizeSampleName("Über Kick #1!!");
    project.samples.push(s);
    const map = buildE2sSampleMap(parseE2sBank(buildSampleBank(project.samples)!, "x.all"));
    // "Über" → non-ASCII entfernt, max 16
    expect(map.get(501)!.name).toBe("ber Kick #1!!");
  });

  it("renumberSample moves the number and remaps all referencing parts", () => {
    const project = createProject();
    project.samples.push(importSampleFromWav(wav(500), "a.wav", project.samples)); // 501
    const p = project.patterns[0];
    p.parts[0].sampleNumber = 501;
    p.parts[3].sampleNumber = 501;
    p.parts[5].sampleNumber = 502; // anderer
    const ok = renumberSample(project, 501, 777);
    expect(ok).toBe(true);
    expect(project.samples[0].number).toBe(777);
    expect(p.parts[0].sampleNumber).toBe(777);
    expect(p.parts[3].sampleNumber).toBe(777);
    expect(p.parts[5].sampleNumber).toBe(502); // unverändert
  });

  it("renumberSample rejects collisions and out-of-range", () => {
    const project = createProject();
    project.samples.push(importSampleFromWav(wav(200), "a.wav", project.samples)); // 501
    project.samples.push(importSampleFromWav(wav(200), "b.wav", project.samples)); // 502
    expect(renumberSample(project, 501, 502)).toBe(false); // Kollision
    expect(renumberSample(project, 501, 5)).toBe(false); // < Base
    expect(renumberSample(project, 501, 9999)).toBe(false); // > Max
    expect(renumberSample(project, 888, 600)).toBe(false); // unbekannt
    expect(project.samples[0].number).toBe(501); // unverändert
  });

  it("processWavToMono replaces a slot's audio keeping its number", () => {
    const project = createProject();
    const s = importSampleFromWav(wav(500), "old.wav", project.samples);
    project.samples.push(s);
    const num = s.number;
    // Replace: neues (stereo, 22050) Audio in denselben Slot
    const rep = processWavToMono(wav(400, 22050, 2), "new snare.wav");
    s.pcm = rep.pcm;
    s.sampleRate = rep.sampleRate;
    s.name = rep.name;
    expect(s.number).toBe(num); // Nummer bleibt
    expect(s.name).toBe("new snare");
    expect(s.sampleRate).toBe(44100); // resampled
    expect(s.pcm.length).toBeGreaterThan(0);
  });

  it("round-trip: build .all → import → same numbers/names", () => {
    const project = createProject();
    project.samples.push(importSampleFromWav(wav(800), "kick.wav", project.samples));
    project.samples.push(importSampleFromWav(wav(300), "clap.wav", project.samples));
    renumberSample(project, 502, 610);
    const all = buildSampleBank(project.samples)!;
    const reimported = importSamplesFromAll(all);
    expect(reimported.map((s) => s.number).sort((a, b) => a - b)).toEqual([501, 610]);
    expect(reimported.find((s) => s.number === 610)!.name).toBe("clap");
  });

  it("sanitizeSampleName clamps to 16 chars and defaults empty", () => {
    expect(sanitizeSampleName("")).toBe("Sample");
    expect(sanitizeSampleName("0123456789ABCDEFGHIJ")).toHaveLength(16);
  });
});

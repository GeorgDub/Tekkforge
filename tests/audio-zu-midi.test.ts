import { describe, it, expect } from "vitest";
import { transkribiereAudio, alsSmfLied, AUDIO_TPQ } from "../src/core/audioZuMidi";
import { baueMidiPatterns } from "../src/core/midiImport";

const SR = 44100;
const BPM = 120;
const STEP_SEK = 60 / BPM / 4;

/** Ton mit Obertoenen (f, 2f, 3f) — prueft, dass die Oktave stimmt. */
function ton(hz: number, sek: number, pegel = 0.5): Float32Array {
  const out = new Float32Array(Math.round(sek * SR));
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const huell = Math.min(1, i / 400, (out.length - i) / 400);
    out[i] = pegel * huell * (Math.sin(2 * Math.PI * hz * t) + 0.5 * Math.sin(2 * Math.PI * 2 * hz * t) + 0.25 * Math.sin(2 * Math.PI * 3 * hz * t));
  }
  return out;
}

function stille(sek: number): Float32Array {
  return new Float32Array(Math.round(sek * SR));
}

function verkette(...teile: Float32Array[]): Float32Array {
  const out = new Float32Array(teile.reduce((s, t) => s + t.length, 0));
  let o = 0;
  for (const t of teile) {
    out.set(t, o);
    o += t.length;
  }
  return out;
}

describe("audioZuMidi", () => {
  it("transkribiert eine Sinus-Melodie mit Pausen auf die richtigen Steps und Noten", () => {
    // C4 (4 Steps), Pause (4 Steps), E4 (8 Steps)
    const pcm = verkette(ton(261.63, 4 * STEP_SEK), stille(4 * STEP_SEK), ton(329.63, 8 * STEP_SEK));
    const noten = transkribiereAudio(pcm, SR, { bpm: BPM });
    expect(noten.map((n) => n.note)).toEqual([60, 64]);
    expect(noten[0].tick).toBe(0);
    expect(noten[0].dauer).toBe(4 * (AUDIO_TPQ / 4));
    expect(noten[1].tick).toBe(8 * (AUDIO_TPQ / 4));
    expect(noten[1].dauer).toBe(8 * (AUDIO_TPQ / 4));
  });
  it("findet die Grundtonhoehe trotz Obertoenen (A3 bleibt 57, nicht 69/45)", () => {
    const noten = transkribiereAudio(ton(220, 8 * STEP_SEK), SR, { bpm: BPM });
    expect(noten).toHaveLength(1);
    expect(noten[0].note).toBe(57);
  });
  it("lauter Ton bekommt hoehere Velocity als leiser", () => {
    const pcm = verkette(ton(261.63, 4 * STEP_SEK, 0.7), stille(2 * STEP_SEK), ton(261.63, 4 * STEP_SEK, 0.15));
    const noten = transkribiereAudio(pcm, SR, { bpm: BPM });
    expect(noten).toHaveLength(2);
    expect(noten[0].velocity).toBeGreaterThan(noten[1].velocity);
  });
  it("alsSmfLied laeuft unveraendert durch den Pattern-Bau des MIDI-Wizards", () => {
    const pcm = verkette(ton(261.63, 4 * STEP_SEK), stille(4 * STEP_SEK), ton(329.63, 8 * STEP_SEK));
    const lied = alsSmfLied(transkribiereAudio(pcm, SR, { bpm: BPM }), BPM, "TON");
    expect(lied.spuren).toHaveLength(1);
    const { patterns } = baueMidiPatterns(lied, [{ spurIndex: 0, part: 10 }], { bpm: BPM, stepLength: 16, namensBasis: "TON" });
    expect(patterns).toHaveLength(1);
    const part = patterns[0].parts[10];
    expect(part.steps[0].on).toBe(true);
    expect(part.steps[0].note).toBe(60);
    expect(part.steps[8].on).toBe(true);
    expect(part.steps[8].note).toBe(64);
    expect(part.steps[5].on).toBe(false);
  });
});

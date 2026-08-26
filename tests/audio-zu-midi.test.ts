import { describe, it, expect } from "vitest";
import { transkribiereAudio, alsSmfLied, alsSmfLiedProStimme, AUDIO_TPQ } from "../src/core/audioZuMidi";
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

/** Toene uebereinanderlegen (gleiche Laenge) — Akkord. */
function mische(...teile: Float32Array[]): Float32Array {
  const out = new Float32Array(teile[0].length);
  for (const t of teile) for (let i = 0; i < out.length; i++) out[i] += t[i] / teile.length;
  return out;
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
  it("polyphon: Dur-Dreiklang wird zu drei gleichzeitigen Noten", () => {
    const dauer = 8 * STEP_SEK;
    const akkord = mische(ton(261.63, dauer), ton(329.63, dauer), ton(392.0, dauer));
    const noten = transkribiereAudio(akkord, SR, { bpm: BPM, stimmen: 3 });
    expect(noten.map((n) => n.note).sort((a, b) => a - b)).toEqual([60, 64, 67]);
    for (const n of noten) {
      expect(n.tick).toBe(0);
      expect(n.dauer).toBe(8 * (AUDIO_TPQ / 4));
    }
  });
  it("polyphon: ein einzelner Ton bleibt EINE Note (keine Oberton-Geister)", () => {
    const noten = transkribiereAudio(ton(261.63, 8 * STEP_SEK), SR, { bpm: BPM, stimmen: 3 });
    expect(noten).toHaveLength(1);
    expect(noten[0].note).toBe(60);
  });
  it("polyphon: Akkordwechsel trennt die Noten an der Wechselstelle", () => {
    const halb = 4 * STEP_SEK;
    const a = mische(ton(261.63, halb), ton(329.63, halb));
    const b = mische(ton(293.66, halb), ton(349.23, halb));
    const noten = transkribiereAudio(verkette(a, b), SR, { bpm: BPM, stimmen: 2 });
    const t16 = AUDIO_TPQ / 4;
    const ersteHaelfte = noten.filter((n) => n.tick === 0).map((n) => n.note).sort((x, y) => x - y);
    const zweiteHaelfte = noten.filter((n) => n.tick === 4 * t16).map((n) => n.note).sort((x, y) => x - y);
    expect(ersteHaelfte).toEqual([60, 64]);
    expect(zweiteHaelfte).toEqual([62, 65]);
  });
  it("polyphon: jede Stimme bekommt eine eigene Kennung, tief zuerst", () => {
    const dauer = 8 * STEP_SEK;
    const akkord = mische(ton(261.63, dauer), ton(329.63, dauer), ton(392.0, dauer));
    const noten = transkribiereAudio(akkord, SR, { bpm: BPM, stimmen: 3 });
    const nachStimme = [...noten].sort((a, b) => a.kanal - b.kanal);
    // Stimme 0 ist die tiefste, Stimme 2 die hoechste
    expect(nachStimme.map((n) => n.kanal)).toEqual([0, 1, 2]);
    expect(nachStimme.map((n) => n.note)).toEqual([60, 64, 67]);
  });

  it("alsSmfLiedProStimme macht aus jeder Stimme eine eigene Spur", () => {
    const dauer = 8 * STEP_SEK;
    const akkord = mische(ton(261.63, dauer), ton(329.63, dauer), ton(392.0, dauer));
    const lied = alsSmfLiedProStimme(transkribiereAudio(akkord, SR, { bpm: BPM, stimmen: 3 }), BPM, "AKK");
    expect(lied.spuren).toHaveLength(3);
    expect(lied.spuren.map((s) => s.noten.length)).toEqual([1, 1, 1]);
    expect(lied.spuren[0].noten[0].note).toBe(60);
    expect(lied.spuren[2].noten[0].note).toBe(67);
    // Namen benennen die Lage, damit die Zuordnung im Wizard verständlich ist
    expect(lied.spuren[0].name).toMatch(/tief|1/i);
    // Jede Spur liegt auf einem eigenen Kanal — sonst landen sie im selben Part
    expect(new Set(lied.spuren.map((s) => s.kanal)).size).toBe(3);
  });

  it("alsSmfLiedProStimme laesst einstimmiges Material bei einer Spur", () => {
    const noten = transkribiereAudio(ton(261.63, 8 * STEP_SEK), SR, { bpm: BPM, stimmen: 3 });
    const lied = alsSmfLiedProStimme(noten, BPM, "SOLO");
    expect(lied.spuren).toHaveLength(1);
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

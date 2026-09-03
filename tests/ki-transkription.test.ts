import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { parseSmf, type SmfLied } from "../src/core/midiImport";
import { smfAufTempo, stimmenNachLage } from "../src/core/audioZuMidi";

const lied = (noten: [number, number, number][], bpm = 120): SmfLied => ({
  format: 0,
  ticksProViertel: 480,
  bpm,
  spuren: [{ name: "x", kanal: 0, programm: null, noten: noten.map(([tick, dauer, note]) => ({ tick, dauer, note, velocity: 100, kanal: 0 })) }],
});

describe("KI-Transkription — Helfer", () => {
  it("smfAufTempo: Zeiten bleiben, Ticks folgen dem neuen Tempo", () => {
    const l = lied([[0, 480, 60], [960, 240, 64]], 120);
    const r = smfAufTempo(l, 150);
    expect(r.bpm).toBe(150);
    // 960 Ticks bei 120 BPM = 1 s; bei 150 BPM sind 1 s = 1200 Ticks
    expect(r.spuren[0].noten.map((n) => [n.tick, n.dauer])).toEqual([[0, 600], [1200, 300]]);
    expect(smfAufTempo(l, 120)).toEqual(l);
    expect(smfAufTempo(l, 0).bpm).toBe(120);
  });

  it("stimmenNachLage: gleich viele Tonhoehen je Stimme, tief zuerst, je Stimme eine Spur mit eigenem Kanal", () => {
    const l = lied([[0, 100, 36], [0, 100, 48], [0, 100, 60], [0, 100, 72], [480, 100, 40], [480, 100, 76]]);
    const r = stimmenNachLage(l, 2, "Amphe");
    expect(r.spuren).toHaveLength(2);
    expect(r.spuren[0].noten.map((n) => n.note)).toEqual([36, 48, 40]);
    expect(r.spuren[1].noten.map((n) => n.note)).toEqual([60, 72, 76]);
    expect(r.spuren.map((s) => s.kanal)).toEqual([0, 1]);
    expect(r.spuren[0].name).toMatch(/^Amphe 1 \(tief\)/);
    expect(r.ticksProViertel).toBe(480);
    // eine Stimme: alles in einer Spur
    expect(stimmenNachLage(l, 1, "A").spuren).toHaveLength(1);
    expect(stimmenNachLage(l, 1, "A").spuren[0].noten).toHaveLength(6);
    // leeres Lied bleibt leer
    expect(stimmenNachLage(lied([]), 3, "A").spuren[0].noten).toEqual([]);
  });

  const MID = "tests/fixtures/amphe12-basic-pitch.mid";
  it.skipIf(!fs.existsSync(MID))("ein echtes basic-pitch-MIDI laeuft durch parseSmf → Tempo → Lagen", () => {
    const roh = parseSmf(new Uint8Array(fs.readFileSync(MID)));
    expect(roh.bpm).toBe(120);
    const alle = roh.spuren.flatMap((s) => s.noten);
    expect(alle.length).toBeGreaterThan(30);
    const r = stimmenNachLage(smfAufTempo(roh, 140), 3, "Amphe");
    expect(r.bpm).toBe(140);
    expect(r.spuren).toHaveLength(3);
    expect(r.spuren.reduce((n, s) => n + s.noten.length, 0)).toBe(alle.length);
    const max = (s: (typeof r.spuren)[number]) => Math.max(...s.noten.map((n) => n.note));
    const min = (s: (typeof r.spuren)[number]) => Math.min(...s.noten.map((n) => n.note));
    expect(max(r.spuren[0])).toBeLessThan(min(r.spuren[2]));
  });
});

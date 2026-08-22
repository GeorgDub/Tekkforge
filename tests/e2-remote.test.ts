/**
 * tests/e2-remote.test.ts — Stock-Fernbedienung: Program Change mit Bank
 * Select, Noten je Part-Kanal, Band-/Schalter-Logik, Pattern-Set-Raster.
 */

import { describe, it, expect } from "vitest";
import {
  BAND_FILTER_TYPE,
  MIDI_START,
  MIDI_STOP,
  buildNoteOff,
  buildNoteOn,
  buildProgramChange,
  buildSchalterCc,
  patternIndexFromProgram,
  filterTypeNachBandKlick,
  keyboardNote,
  kippeSchalter,
  patternSetIndex,
  schritt,
} from "../src/core/e2Remote";
import { filterBand } from "../src/core/panelState";

describe("e2Remote — Program Change (am Gerät gemessen: 0-basiert, Bank im LSB)", () => {
  it("Pattern 1 → Bank 0/0, Program 0 auf dem Global-Kanal", () => {
    const m = buildProgramChange(0, 0).map((u) => Array.from(u));
    expect(m).toEqual([[0xb0, 0, 0], [0xb0, 0x20, 0], [0xc0, 0]]);
  });

  it("Messwerte 2026-08-22: Program 100 → Pattern 101, LSB 1 + Program 0 → Pattern 129", () => {
    expect(Array.from(buildProgramChange(0, 100)[2])).toEqual([0xc0, 100]);
    expect(Array.from(buildProgramChange(0, 128)[1])).toEqual([0xb0, 0x20, 1]);
    expect(Array.from(buildProgramChange(0, 128)[2])).toEqual([0xc0, 0]);
    expect(Array.from(buildProgramChange(0, 249)[1])).toEqual([0xb0, 0x20, 1]);
    expect(Array.from(buildProgramChange(0, 249)[2])).toEqual([0xc0, 121]);
  });

  it("Empfang ist die Umkehrung; jenseits 250 → null", () => {
    for (const idx of [0, 5, 100, 127, 128, 200, 249]) {
      const [, lsb, pc] = buildProgramChange(0, idx);
      expect(patternIndexFromProgram(lsb[2], pc[1])).toBe(idx);
    }
    expect(patternIndexFromProgram(1, 0)).toBe(128);
    expect(patternIndexFromProgram(1, 122)).toBeNull();
  });

  it("Schalter-CCs: IFX On 104, MFX Send 105 auf dem Part-Kanal; unbekannt → null", () => {
    expect(Array.from(buildSchalterCc(3, "ifxOn", true)!)).toEqual([0xb3, 104, 127]);
    expect(Array.from(buildSchalterCc(0, "mfxSend", false)!)).toEqual([0xb0, 105, 0]);
    expect(buildSchalterCc(0, "ampEgOn", true)).toBeNull();
  });

  it("Kanal landet im Statusbyte", () => {
    expect(buildProgramChange(9, 5)[2][0]).toBe(0xc9);
  });

  it("lehnt Indizes außerhalb 0..249 ab", () => {
    expect(() => buildProgramChange(0, -1)).toThrow(RangeError);
    expect(() => buildProgramChange(0, 250)).toThrow(RangeError);
  });
});

describe("e2Remote — Noten und Transport", () => {
  it("Note On/Off auf dem Kanal des Parts", () => {
    expect(Array.from(buildNoteOn(2, 60, 100))).toEqual([0x92, 60, 100]);
    expect(Array.from(buildNoteOff(2, 60))).toEqual([0x82, 60, 0]);
  });

  it("Velocity 0 wird zu 1 (sonst wäre es ein Note Off)", () => {
    expect(buildNoteOn(0, 60, 0)[2]).toBe(1);
  });

  it("Keyboard: Pad 0 = C3, Pad 15 = D#4", () => {
    expect(keyboardNote(0)).toBe(48);
    expect(keyboardNote(15)).toBe(63);
  });

  it("Realtime-Bytes", () => {
    expect(MIDI_START).toBe(0xfa);
    expect(MIDI_STOP).toBe(0xfc);
  });
});

describe("e2Remote — Schalter und Bänder", () => {
  it("Band-Typen liegen in der gemessenen Familie", () => {
    expect(filterBand(BAND_FILTER_TYPE.lpf)).toBe("lpf");
    expect(filterBand(BAND_FILTER_TYPE.hpf)).toBe("hpf");
    expect(filterBand(BAND_FILTER_TYPE.bpf)).toBe("bpf");
  });

  it("anderes Band setzt den Typ, gleiches Band schaltet aus", () => {
    expect(filterTypeNachBandKlick("off", "lpf")).toBe(1);
    expect(filterTypeNachBandKlick("lpf", "hpf")).toBe(7);
    expect(filterTypeNachBandKlick("bpf", "bpf")).toBe(0);
  });

  it("kippeSchalter: undefined und 0 → 1, 1 → 0", () => {
    expect(kippeSchalter(undefined)).toBe(1);
    expect(kippeSchalter(0)).toBe(1);
    expect(kippeSchalter(1)).toBe(0);
  });

  it("Pattern-Set: Seite 2, Pad 3 → Pattern-Index 35", () => {
    expect(patternSetIndex(2, 3)).toBe(35);
    expect(patternSetIndex(9, 99)).toBe(63);
  });

  it("schritt läuft zyklisch", () => {
    expect(schritt(48, 1, 0, 48)).toBe(0);
    expect(schritt(0, -1, 0, 48)).toBe(48);
    expect(schritt(501, 3, 501, 999)).toBe(504);
  });
});

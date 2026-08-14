/**
 * Notenkodierung der Step-Records — festgezurrt auf die Gerätemessung.
 *
 * Die vier Werte in `GEMESSEN` stammen aus einem direkten RAM-Auslesen des
 * Electribe 2 Sampler (2026-08-14): im Step-Editor wurden auf Part 1 / Step 1
 * vier Noten gesetzt und die Bytes anschließend gelesen. Sie sind der einzige
 * Primärbeleg für die Verschiebung — die Golden-Fixtures taugen dafür nicht,
 * weil sie dieselbe falsche Annahme enthielten wie der Code.
 */
import { describe, expect, it } from "vitest";
import {
  E2_STEP_NOTE_EMPTY,
  e2StepByteToMidiNote,
  midiNoteToE2StepByte,
} from "../src/core/e2StepNote";

/** Anzeige am Gerät → MIDI-Nummer → gelesenes Byte. */
const GEMESSEN: Array<[string, number, number]> = [
  ["G9", 127, 128],
  ["F#9", 126, 127],
  ["E9", 124, 125],
  ["C-1", 0, 1],
];

describe("E2-Step-Noten", () => {
  it("bildet die am Gerät gemessenen Noten exakt ab", () => {
    for (const [name, midi, byte] of GEMESSEN) {
      expect(midiNoteToE2StepByte(midi), name).toBe(byte);
      expect(e2StepByteToMidiNote(byte), name).toBe(midi);
    }
  });

  it("Byte 128 liegt über dem MIDI-Bereich — genau daran hängt der Beleg", () => {
    // Waeren die Noten roh gespeichert, koennte dieser Wert nicht vorkommen.
    const hoechstes = GEMESSEN.map(([, , b]) => b).reduce((a, b) => Math.max(a, b));
    expect(hoechstes).toBeGreaterThan(127);
  });

  it("hält die Halbtonabstände der Messung ein", () => {
    const [g9, fis9, e9] = GEMESSEN.map(([, , b]) => b);
    expect(g9 - fis9).toBe(1); // G9 → F#9 ist ein Halbton
    expect(fis9 - e9).toBe(2); // F#9 → E9 sind zwei
  });

  it("haelt die 0 als 'kein Ton' frei", () => {
    expect(e2StepByteToMidiNote(E2_STEP_NOTE_EMPTY)).toBeNull();
    expect(midiNoteToE2StepByte(undefined)).toBe(E2_STEP_NOTE_EMPTY);
    expect(midiNoteToE2StepByte(-1)).toBe(E2_STEP_NOTE_EMPTY);
    expect(midiNoteToE2StepByte(128)).toBe(E2_STEP_NOTE_EMPTY);
  });

  it("C4 (Originaltonhöhe) liegt als 0x3D im Speicher, nicht als 0x3C", () => {
    // Der haeufigste Notenwert der Factory-Bank ist 61 — unter dieser
    // Kodierung MIDI 60 = C4, also die erwartete Vorgabe eines Drum-Parts.
    expect(midiNoteToE2StepByte(60)).toBe(0x3d);
    expect(e2StepByteToMidiNote(0x3d)).toBe(60);
  });

  it("ist über den ganzen Bereich umkehrbar", () => {
    for (let midi = 0; midi <= 127; midi++) {
      expect(e2StepByteToMidiNote(midiNoteToE2StepByte(midi))).toBe(midi);
    }
  });
});

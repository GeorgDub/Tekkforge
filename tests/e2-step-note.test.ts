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
import {
  ELECTRIBE_REAL_GATE_MAX,
  ELECTRIBE_REAL_GATE_TIE_ALT,
  ELECTRIBE_REAL_GATE_TIE_SENTINEL,
} from "../src/core/electribeImport";

/** Anzeige am Gerät → MIDI-Nummer → gelesenes Byte. */
const GEMESSEN: Array<[string, number, number]> = [
  ["G9", 127, 128],
  ["F#9", 126, 127],
  ["E9", 124, 125],
  ["C-1", 0, 1],
  ["F-1", 5, 6],
  ["C4", 60, 61], // belegt durch eine ausbleibende Aenderung, siehe Modul-Doku
  // Zusammenhaengender Lauf ueber zwei Oktavgrenzen — alle elf Bytes wurden
  // vorher aus der Kodierung berechnet und danach am Geraet abgelesen.
  ["D-1", 2, 3],
  ["E-1", 4, 5],
  ["G-1", 7, 8],
  ["A-1", 9, 10],
  ["B-1", 11, 12],
  ["C0", 12, 13],
  ["D#0", 15, 16],
  ["G#4", 68, 69],
  ["G#8", 116, 117],
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

/**
 * Gate-Tie: das Gerät schreibt 127, Factory-Dateien führen daneben 255.
 * Beide müssen beim Einlesen als Tie ankommen — 127 wurde vorher auf 96
 * begrenzt und ging damit still verloren.
 */
describe("Gate-Tie beim Einlesen", () => {
  const tie = (byte: number) =>
    byte === ELECTRIBE_REAL_GATE_TIE_SENTINEL || byte === ELECTRIBE_REAL_GATE_TIE_ALT
      ? ELECTRIBE_REAL_GATE_TIE_SENTINEL
      : Math.min(ELECTRIBE_REAL_GATE_MAX, byte);

  it("erkennt beide Tie-Werte", () => {
    expect(tie(ELECTRIBE_REAL_GATE_TIE_ALT)).toBe(ELECTRIBE_REAL_GATE_TIE_SENTINEL);
    expect(tie(ELECTRIBE_REAL_GATE_TIE_SENTINEL)).toBe(ELECTRIBE_REAL_GATE_TIE_SENTINEL);
  });

  it("laesst regulaere Gate-Zeiten unveraendert", () => {
    // Am Geraet gemessen: Anzeige = Byte.
    for (const g of [32, 47, 60, 96]) expect(tie(g)).toBe(g);
  });

  it("haelt 96 als hoechste regulaere Gate-Zeit vom Tie getrennt", () => {
    expect(ELECTRIBE_REAL_GATE_MAX).toBeLessThan(ELECTRIBE_REAL_GATE_TIE_ALT);
  });
});

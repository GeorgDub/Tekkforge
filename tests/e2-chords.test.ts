/**
 * Akkorde: bis zu vier Noten je Step.
 *
 * Die Bezugsgröße ist ein am Gerät gelesener Step — Part 1 / Step 1 trug die
 * Bytes `128 127 125 1`, eingegeben als `G9 F#9 E9 C-1`. Die Reihenfolge ist die
 * der Eingabe, nicht die Tonhöhe: sortiert man, fällt der Test.
 */
import { describe, expect, it } from "vitest";
import { buildE2PatternBody } from "../src/core/e2sExport";
import type { E2PatternInput } from "../src/core/electribePatternBuilder";
import { readStepNotes, resolveStepNotes } from "../src/core/e2StepNote";

const PARTS_OFF = 0x800;
const STEPS_OFF = 0x30;
const STEP_SIZE = 12;
const NOTE_OFF = 4;

/** Am Gerät gemessen: Part 1 / Step 1. */
const AKKORD_MIDI = [127, 126, 124, 0];
const AKKORD_BYTES = [128, 127, 125, 1];

function baseInput(steps: E2PatternInput["parts"][number]["steps"]): E2PatternInput {
  const parts = Array.from({ length: 16 }, () => ({ steps: [] as never[] }));
  return {
    name: "CHORD",
    bpm: 120,
    stepLength: 16,
    parts: parts.map((p, i) => (i === 0 ? { steps } : p)),
  } as unknown as E2PatternInput;
}

function stepBytes(body: Uint8Array, step = 0): number[] {
  const so = PARTS_OFF + STEPS_OFF + step * STEP_SIZE;
  return [0, 1, 2, 3].map((i) => body[so + NOTE_OFF + i]);
}

describe("Akkorde im Export", () => {
  it("schreibt den am Gerät gemessenen Akkord byte-genau", () => {
    const body = buildE2PatternBody(baseInput([{ active: true, notes: AKKORD_MIDI }]));
    expect(stepBytes(body)).toEqual(AKKORD_BYTES);
  });

  it("behaelt die Eingabereihenfolge bei, statt zu sortieren", () => {
    const body = buildE2PatternBody(baseInput([{ active: true, notes: [0, 124, 126, 127] }]));
    expect(stepBytes(body)).toEqual([1, 125, 127, 128]);
  });

  it("nullt freie Plaetze, damit kein Rest eines frueheren Akkords stehen bleibt", () => {
    const body = buildE2PatternBody(baseInput([{ active: true, note: 60 }]));
    expect(stepBytes(body)).toEqual([61, 0, 0, 0]);
  });

  it("laesst inaktive Steps auf allen vier Plaetzen leer", () => {
    const body = buildE2PatternBody(baseInput([{ active: false, notes: AKKORD_MIDI }]));
    expect(stepBytes(body)).toEqual([0, 0, 0, 0]);
  });

  it("faellt ohne notes auf das einzelne note-Feld zurueck", () => {
    const body = buildE2PatternBody(baseInput([{ active: true, note: 72 }]));
    expect(stepBytes(body)).toEqual([73, 0, 0, 0]);
  });

  it("ist ueber Schreiben und Lesen umkehrbar", () => {
    const body = buildE2PatternBody(baseInput([{ active: true, notes: AKKORD_MIDI }]));
    expect(readStepNotes(stepBytes(body))).toEqual(AKKORD_MIDI);
  });
});

describe("resolveStepNotes", () => {
  it("verwirft Dubletten — das Geraet legt eine vorhandene Note nicht zweimal ab", () => {
    expect(resolveStepNotes([60, 64, 60, 67])).toEqual([60, 64, 67]);
  });

  it("nimmt hoechstens vier Noten", () => {
    expect(resolveStepNotes([1, 2, 3, 4, 5, 6])).toEqual([1, 2, 3, 4]);
  });

  it("verwirft Werte ausserhalb 0..127", () => {
    expect(resolveStepNotes([-1, 128, 60, 999])).toEqual([60]);
  });

  it("benutzt den Einzelwert nur, wenn keine Liste da ist", () => {
    expect(resolveStepNotes(undefined, 60)).toEqual([60]);
    expect(resolveStepNotes([], 60)).toEqual([60]);
    expect(resolveStepNotes([64], 60)).toEqual([64]);
  });
});

/**
 * Motion-Spuren: das Feld `motionSlots` wurde vom Export lange entgegengenommen
 * und stillschweigend verworfen. Aufgefallen ist das erst beim Zurücklesen aus
 * dem Gerät — im erzeugten Pattern waren die Kopftabellen durchgehend null.
 */
describe("Motion-Spuren im Export", () => {
  const mitMotion = () =>
    buildE2PatternBody({
      ...(baseInput([{ active: true, note: 60 }]) as any),
      motionSlots: [{ paramId: 4, targetPart: 10, values: Array.from({ length: 64 }, (_, i) => i + 1) }],
    });

  it("schreibt Ziel, Parameter und Werte an die gemessenen Offsets", () => {
    const body = mitMotion();
    expect(body[0x100]).toBe(11); // Ziel ist 1-basiert: Part-Index 10 -> 11
    expect(body[0x118]).toBe(4); // Osc Edit
    expect(body[0x130]).toBe(1);
    expect(body[0x130 + 63]).toBe(64);
  });

  it("laesst die Tabellen leer, wenn keine Spuren angegeben sind", () => {
    const body = buildE2PatternBody(baseInput([{ active: true, note: 60 }]));
    expect(body[0x100]).toBe(0);
    expect(body[0x118]).toBe(0);
    expect(body[0x130]).toBe(0);
  });
});

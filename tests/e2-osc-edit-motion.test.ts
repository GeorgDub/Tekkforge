/**
 * OSC-Edit-Motion-Skala — festgezurrt auf die vier Gerätemessungen.
 *
 * Zwei davon (64 und 65) wurden aus dem Modell vorhergesagt, BEVOR sie gemessen
 * wurden. Sie liegen beidseits des Umklapppunkts und sind damit die Stelle, an
 * der eine falsch gedachte Skala hätte auffliegen müssen.
 */
import { describe, expect, it } from "vitest";
import {
  decodeOscEditMotion,
  encodeOscEditMotion,
  motionValueOffset,
  OSC_EDIT_MOTION_MAX_VALUE,
  PATTERN_MOTION_LANES,
  PATTERN_MOTION_PARAM_OFF,
  PATTERN_MOTION_PART_OFF,
  PATTERN_MOTION_STEPS,
  PATTERN_MOTION_VALUES_OFF,
} from "../src/core/e2sExport";

/** Byte → Anzeige, wie am Gerät abgelesen (2026-08-14). */
const GEMESSEN: Array<[number, number, "fwd" | "rev"]> = [
  [59, 90, "fwd"],
  [64, 98, "fwd"], // vorhergesagt, dann gemessen
  [65, 98, "rev"], // vorhergesagt, dann gemessen
  [113, 23, "rev"],
  [9, 12, "fwd"], // vorhergesagt, dann gemessen
];

describe("OSC-Edit-Motion", () => {
  it("dekodiert alle gemessenen Bytes zur abgelesenen Anzeige", () => {
    for (const [byte, percent, direction] of GEMESSEN) {
      expect(decodeOscEditMotion(byte), String(byte)).toEqual({ percent, direction });
    }
  });

  it("kodiert die abgelesenen Anzeigen zurueck auf dieselben Bytes", () => {
    for (const [byte, percent, direction] of GEMESSEN) {
      expect(encodeOscEditMotion(percent, direction), `${percent}% ${direction}`).toBe(byte);
    }
  });

  it("legt den Umklapppunkt auf zwei benachbarte Bytes", () => {
    // 98 % FWD und 98 % REV sind derselbe Weg in beide Richtungen und muessen
    // deshalb direkt nebeneinander liegen.
    expect(encodeOscEditMotion(98, "rev") - encodeOscEditMotion(98, "fwd")).toBe(1);
  });

  it("haelt die Raender der Leiter ein", () => {
    expect(encodeOscEditMotion(0, "fwd")).toBe(1);
    expect(encodeOscEditMotion(0, "rev")).toBe(OSC_EDIT_MOTION_MAX_VALUE);
    // Beide Haelften sind gleich gross.
    expect(encodeOscEditMotion(98, "fwd") - encodeOscEditMotion(0, "fwd")).toBe(
      encodeOscEditMotion(0, "rev") - encodeOscEditMotion(98, "rev"),
    );
  });

  it("behandelt 0 als 'Off'", () => {
    expect(decodeOscEditMotion(0)).toBeNull();
    expect(decodeOscEditMotion(OSC_EDIT_MOTION_MAX_VALUE + 1)).toBeNull();
  });

  it("ist ueber die ganze Leiter umkehrbar", () => {
    for (let v = 1; v <= OSC_EDIT_MOTION_MAX_VALUE; v++) {
      const d = decodeOscEditMotion(v);
      expect(d, String(v)).not.toBeNull();
      expect(encodeOscEditMotion(d!.percent, d!.direction), String(v)).toBe(v);
    }
  });

  it("legt die Motion-Spuren dorthin, wo sie am Geraet gemessen wurden", () => {
    // Spur 0, Step 1 — die erste gesetzte Motion.
    expect(motionValueOffset(0, 0)).toBe(0x130);
    // Spur 1, Step 2 — dieser Offset liess sich nicht raten und hat die
    // Tabellenstruktur bestaetigt.
    expect(motionValueOffset(1, 1)).toBe(0x171);
  });

  it("passt mit 24 Spuren genau in den Kopfbereich vor 0x800", () => {
    const ende = PATTERN_MOTION_VALUES_OFF + PATTERN_MOTION_LANES * PATTERN_MOTION_STEPS;
    expect(ende).toBe(0x730);
    expect(ende).toBeLessThanOrEqual(0x800);
    // Die beiden Kopftabellen liegen davor und ueberlappen einander nicht.
    expect(PATTERN_MOTION_PARAM_OFF - PATTERN_MOTION_PART_OFF).toBe(PATTERN_MOTION_LANES);
    expect(PATTERN_MOTION_VALUES_OFF - PATTERN_MOTION_PARAM_OFF).toBe(PATTERN_MOTION_LANES);
  });
});

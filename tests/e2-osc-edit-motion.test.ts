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
  OSC_EDIT_MOTION_MAX_VALUE,
} from "../src/core/e2sExport";
import {
  ELECTRIBE_MOTION_DATA_TABLE_OFFSET,
  ELECTRIBE_MOTION_PARAM_TABLE_OFFSET,
  ELECTRIBE_MOTION_SLOT_STRIDE,
  ELECTRIBE_MOTION_TARGET_TABLE_OFFSET,
} from "../src/core/electribeImport";

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

  it("legt die Motion-Werte dorthin, wo sie am Geraet gemessen wurden", () => {
    const off = (slot: number, step: number) =>
      ELECTRIBE_MOTION_DATA_TABLE_OFFSET + slot * ELECTRIBE_MOTION_SLOT_STRIDE + step;
    // Slot 0, Step 1 — die erste gesetzte Motion.
    expect(off(0, 0)).toBe(0x130);
    // Slot 1, Step 2 — dieser Offset liess sich nicht raten und hat die
    // Tabellenstruktur bestaetigt.
    expect(off(1, 1)).toBe(0x171);
  });

  it("liest das Ziel vor der Parameter-Kennung", () => {
    // Am Geraet gemessen: derselbe Parameter auf zwei Parts ergab in 0x100
    // verschiedene Werte und in 0x118 denselben. Die Tabellen waren frueher
    // vertauscht dokumentiert.
    expect(ELECTRIBE_MOTION_TARGET_TABLE_OFFSET).toBe(0x100);
    expect(ELECTRIBE_MOTION_PARAM_TABLE_OFFSET).toBe(0x118);
  });
});

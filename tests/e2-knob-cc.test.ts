/**
 * tests/e2-knob-cc.test.ts — Dekoder fuer die am Geraet gemessenen Regler-CCs
 * (Messreihe 2026-08-15, siehe e2KnobCc.ts).
 */

import { describe, it, expect } from "vitest";
import { decodeKnobCc, KNOB_CCS } from "../src/core/e2KnobCc";

describe("decodeKnobCc", () => {
  it("dekodiert die gemessenen Regler (Cutoff-Beispiel aus dem Monitor)", () => {
    // Originalzeile der Messung: "b0 4a 27" — Cutoff auf Kanal 1, Wert 39.
    const ev = decodeKnobCc([0xb0, 0x4a, 0x27]);
    expect(ev).not.toBeNull();
    expect(ev!.channel0).toBe(0);
    expect(ev!.cc).toBe(74);
    expect(ev!.value).toBe(39);
    expect(ev!.knob?.key).toBe("cutoff");
  });

  it("kennt alle zwoelf gemessenen Regler", () => {
    const keys = [...KNOB_CCS.values()].map((k) => k.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "cutoff", "resonance", "egInt", "oscPitch", "oscEdit", "modDepth",
        "modSpeed", "egAttack", "egDecay", "volume", "pan", "ifxEdit",
      ]),
    );
    expect(KNOB_CCS.size).toBe(12);
  });

  it("liefert unbekannte CCs mit knob: null statt sie zu verwerfen", () => {
    const ev = decodeKnobCc([0xb2, 0x2c, 0x40]); // CC 44 auf Kanal 3
    expect(ev).not.toBeNull();
    expect(ev!.channel0).toBe(2);
    expect(ev!.knob).toBeNull();
  });

  it("ignoriert Nicht-CC-Nachrichten und den NRPN-Rahmen", () => {
    expect(decodeKnobCc([0x90, 0x3c, 0x70])).toBeNull(); // Note On
    expect(decodeKnobCc([0xf8])).toBeNull(); // Clock
    expect(decodeKnobCc([0xb0, 0x63, 0x00])).toBeNull(); // NRPN MSB
    expect(decodeKnobCc([0xb0, 0x26, 0x01])).toBeNull(); // NRPN DATA LSB
  });
});

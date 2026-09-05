import { describe, it, expect } from "vitest";
import { setzeGain12 } from "../src/core/patternWerkzeuge";

describe("setzeGain12 — +12 dB fuer viele Samples auf einmal", () => {
  it("setzt das Flag bei allen, zaehlt nur Aenderungen, entfernt es wieder", () => {
    const samples: { number: number; gain12db?: boolean }[] = [{ number: 501 }, { number: 502, gain12db: true }, { number: 503 }];
    expect(setzeGain12(samples, true)).toBe(2);
    expect(samples.every((s) => s.gain12db === true)).toBe(true);
    expect(setzeGain12(samples, true)).toBe(0);
    expect(setzeGain12(samples, false)).toBe(3);
    expect(samples.every((s) => s.gain12db === undefined)).toBe(true);
    expect(setzeGain12([], true)).toBe(0);
  });
});

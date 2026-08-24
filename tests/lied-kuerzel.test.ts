import { describe, expect, it } from "vitest";
import { eindeutigeKuerzel } from "../src/core/generatorSession";

describe("eindeutigeKuerzel", () => {
  it("kuerzt Dateinamen auf 10 Zeichen ohne Endung", () => {
    expect(eindeutigeKuerzel(["Amphegott v2.wav"])).toEqual(["Amphegott"]);
    expect(eindeutigeKuerzel(["Tommi Schore - Track 1.wav"])).toEqual(["Tommi Scho"]);
  });

  it("macht kollidierende Kuerzel per Ziffer eindeutig", () => {
    const k = eindeutigeKuerzel(["Tommi Schore - Track 1.wav", "Tommi Schore - Track 5.wav"]);
    expect(new Set(k).size).toBe(2);
    expect(k[0]).toBe("Tommi Scho");
    expect(k[1]).toMatch(/^Tommi Sch2$/);
  });

  it("faellt bei leeren Namen auf 'Lied' zurueck", () => {
    expect(eindeutigeKuerzel([".wav", "..."])).toEqual(["Lied", "Lied2"]);
  });
});

import { describe, it, expect } from "vitest";
import { OSZ_NAMEN_HACKTRIBE, OSZ_NAMEN_TEKKFORGE, OSZ_LISTEN, oszNameFuer, istOszillatorNummer } from "../src/core/oszNamen";

describe("oszNamen — Oszillator-Listen fuer den Editor", () => {
  it("Hacktribe 274 und TekkForge 362, Analog gleich, FM/VPM verschieden sortiert", () => {
    expect(OSZ_NAMEN_HACKTRIBE).toHaveLength(274);
    expect(OSZ_NAMEN_TEKKFORGE).toHaveLength(362);
    expect(OSZ_NAMEN_HACKTRIBE.slice(0, 34)).toEqual(OSZ_NAMEN_TEKKFORGE.slice(0, 34));
    expect(OSZ_NAMEN_HACKTRIBE[0]).toEqual(["SAW", "Analog"]);
    expect(OSZ_NAMEN_HACKTRIBE[16]).toEqual(["Audio In Mn", "Audio In"]);
    expect(OSZ_NAMEN_HACKTRIBE[142]).toEqual(["VPM-SAW 0.5", "VPM"]);
    expect(OSZ_NAMEN_TEKKFORGE[34]).toEqual(["X-SAW -24", "FM"]);
    expect(OSZ_NAMEN_TEKKFORGE[82]).toEqual(["X-SAW +24", "FM"]);
    expect(OSZ_NAMEN_TEKKFORGE[230]).toEqual(["VPM-SAW 0.5", "VPM"]);
    expect(OSZ_NAMEN_TEKKFORGE[361]).toEqual(["VPM-SINE 32", "VPM"]);
    expect(Object.keys(OSZ_LISTEN)).toEqual(["tekkforge", "hacktribe"]);
  });
  it("Namen und Nummernpruefung", () => {
    expect(oszNameFuer(35)).toBe("35 · X-SAW -24 (FM)");
    expect(oszNameFuer(35, "hacktribe")).toBe("35 · X-SAW -24 (FM)");
    expect(oszNameFuer(36, "hacktribe")).toBe("36 · X-SAW -20 (FM)");
    expect(oszNameFuer(36)).toBe("36 · X-SAW -23 (FM)");
    expect(oszNameFuer(400)).toBe("400");
    expect(istOszillatorNummer(35)).toBe(true);
    expect(istOszillatorNummer(501)).toBe(false);
    expect(istOszillatorNummer(null)).toBe(false);
  });
});

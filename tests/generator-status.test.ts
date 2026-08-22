import { describe, it, expect } from "vitest";
import type { Projekt } from "../src/core/bankPlan";
import {
  markerLesen, markerSchreiben, istGeladen, statusMit, geraetSperrgrund, sdZielpfad, patternFuerGeraet, MARKER_KEY,
} from "../src/core/projektStatus";
import type { E2PatternInput } from "../src/core/electribePatternBuilder";

const P: Projekt = {
  name: "korg3", bpm: 180, budgetSekunden: 235, volume: 1, volumes: 1, tekkDrums: false, samples: [], status: "gebaut", bankZeit: "2026-08-22T12:00:00Z",
};
function speicher() {
  const map = new Map<string, string>();
  return { map, sp: { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) } };
}

describe("projektStatus", () => {
  it("Marker schreiben/lesen, istGeladen nur bei gleichem Namen und bankZeit", () => {
    const { sp, map } = speicher();
    expect(markerLesen(sp)).toBeNull();
    const m = markerSchreiben(sp, P);
    expect(map.get(MARKER_KEY)).toContain("korg3");
    expect(markerLesen(sp)).toEqual(m);
    expect(istGeladen(P, m)).toBe(true);
    expect(istGeladen({ ...P, bankZeit: "anders" }, m)).toBe(false);
    expect(istGeladen({ ...P, name: "x" }, m)).toBe(false);
    expect(istGeladen(P, null)).toBe(false);
  });
  it("markerLesen ueberlebt kaputtes JSON", () => {
    const { sp } = speicher();
    sp.setItem(MARKER_KEY, "{kaputt");
    expect(markerLesen(sp)).toBeNull();
  });
  it("statusMit: geladen nur mit passendem Marker", () => {
    expect(statusMit(P, null)).toBe("gebaut");
    expect(statusMit({ ...P, status: "exportiert" }, null)).toBe("exportiert");
    expect(statusMit(P, { name: "korg3", bankZeit: P.bankZeit })).toBe("geladen");
  });
  it("geraetSperrgrund: Reihenfolge Bank → geladen → MIDI", () => {
    const m = { name: "korg3", bankZeit: P.bankZeit };
    expect(geraetSperrgrund(null, m, true)).toBe("Erst Bank bauen");
    expect(geraetSperrgrund(P, null, true)).toContain("nicht als geladen markiert");
    expect(geraetSperrgrund(P, m, false)).toContain("Kein Geraet");
    expect(geraetSperrgrund(P, m, true)).toBeNull();
  });
  it("sdZielpfad", () => {
    expect(sdZielpfad("H:")).toBe("H:\\2026");
    expect(sdZielpfad("H:\\")).toBe("H:\\2026");
    expect(sdZielpfad("H:", "KORG")).toBe("H:\\KORG");
  });
  it("patternFuerGeraet: E2PatternInput → EditorPattern mit Name, BPM und Steps", () => {
    const input: E2PatternInput = {
      name: "TEST JAM", bpm: 176, stepLength: 64,
      parts: [{ steps: [{ active: true, notes: [60], velocity: 100, gate: 40 }], volume: 120 }],
    };
    const p = patternFuerGeraet(input);
    expect(p.name.trim()).toBe("TEST JAM");
    expect(p.bpm).toBe(176);
    expect(p.parts[0].steps[0].on).toBe(true);
  });
});

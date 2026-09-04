import { describe, it, expect } from "vitest";
import { variiereKette, variierePattern } from "../src/core/kettenVariation";
import type { E2PatternInput, E2PartInput, E2StepInput } from "../src/core/electribePatternBuilder";

const N = 64;
const leer = (): E2StepInput[] => Array.from({ length: N }, () => ({ active: false }));
const hit = (vel: number): E2StepInput => ({ active: true, notes: [60], velocity: vel, gate: 20 });
const part = (fn: (s: number) => boolean, vel = 100): E2PartInput => ({ steps: leer().map((s, i) => (fn(i) ? hit(vel) : s)), muted: false });

/** Ein Drop-artiges Pattern: Kick auf Vierteln, Snare auf 4/12, Hats auf Achteln, Melo-Loop-Trigger. */
function pattern(name: string): E2PatternInput {
  const parts: E2PartInput[] = Array.from({ length: 16 }, () => ({ steps: leer(), muted: true }));
  parts[0] = part((s) => s % 4 === 0, 112);
  parts[2] = part((s) => s % 16 === 4 || s % 16 === 12, 106);
  parts[4] = part((s) => s % 2 === 0, 82);
  parts[8] = part((s) => s % 4 === 2, 110);
  parts[12] = part((s) => s === 0, 127);
  parts[14] = part((s) => s === 0 || s === 32, 127);
  return { name, bpm: 180, stepLength: 64, parts };
}

const velocities = (p: E2PatternInput, idx: number): number[] => p.parts[idx].steps.map((s) => (s.active ? (s.velocity ?? 0) : -1));
const aktiv = (p: E2PatternInput, idx: number) => p.parts[idx].steps.map((s, i) => (s.active ? i : -1)).filter((i) => i >= 0);

describe("kettenVariation", () => {
  const kette = [pattern("AUF1"), pattern("AUF2"), pattern("AUF3"), pattern("AUF4"), pattern("DROP"), pattern("VRS3")];
  const raus = variiereKette(kette, { drop: 4 });

  it("der Drop bleibt byteweise, wie er war", () => {
    expect(raus[4]).toBe(kette[4]);
    expect(JSON.stringify(raus[4])).toBe(JSON.stringify(pattern("DROP")));
  });

  it("Melodie und Vocals (Parts 12–15) bleiben ueberall unveraendert", () => {
    for (const p of raus) {
      expect(p.parts[12]).toEqual(kette[0].parts[12]);
      expect(p.parts[14]).toEqual(kette[0].parts[14]);
    }
  });

  it("die Quelle wird nicht veraendert", () => {
    expect(JSON.stringify(kette[1])).toBe(JSON.stringify(pattern("AUF2")));
  });

  it("jedes Pattern hat eine eigene Velocity-Streuung, in Grenzen und reproduzierbar", () => {
    const v0 = velocities(raus[0], 0);
    const v1 = velocities(raus[1], 0);
    expect(v0).not.toEqual(v1);
    // nur die Schlaege der Quelle (der Ghost-Kick auf Step 58 kommt mit eigener Staerke dazu)
    for (const p of raus) for (const i of aktiv(kette[0], 0)) expect(Math.abs((p.parts[0].steps[i].velocity ?? 0) - 112)).toBeLessThanOrEqual(10);
    expect(velocities(variiereKette(kette, { drop: 4 })[1], 0)).toEqual(v1);
    // Streuung 0: gleiche Velocities wie die Quelle
    expect(velocities(variierePattern(kette[0], 0, { streuung: 0 }), 0)).toEqual(velocities(kette[0], 0));
  });

  it("ungerade Patterns rotieren die Hat-Figur und setzen einen Ghost-Kick", () => {
    expect(aktiv(raus[0], 4)).toEqual(aktiv(kette[0], 4));
    // um zwei Steps gedreht: Achtel bleiben Achtel, aber die Akzente wechseln
    expect(aktiv(raus[1], 4)).toEqual(aktiv(kette[0], 4));
    const akz = velocities(raus[1], 4).filter((v) => v >= 0);
    expect(new Set(akz)).toEqual(new Set([82, 70]));
    expect(raus[1].parts[0].steps[58]).toMatchObject({ active: true, velocity: 70, gate: 8 });
    expect(raus[0].parts[0].steps[58].active).toBe(false);
    expect(raus[2].parts[0].steps[58].active).toBe(false);
  });

  it("jedes vierte Pattern (k % 4 === 3) endet mit einem Snare-Fill im letzten Takt", () => {
    const fill = raus[3].parts[2].steps.slice(48).filter((s) => s.active).length;
    expect(fill).toBe(16);
    expect(raus[3].parts[2].steps[63].velocity).toBe(127);
    expect(raus[2].parts[2].steps.slice(48).filter((s) => s.active).length).toBe(2);
  });

  it("ohne Drop-Angabe wird alles variiert, Pattern 0 nur gestreut", () => {
    const alle = variiereKette(kette);
    expect(alle[4]).not.toBe(kette[4]);
    expect(aktiv(alle[0], 0)).toEqual(aktiv(kette[0], 0));
    expect(aktiv(alle[0], 2)).toEqual(aktiv(kette[0], 2));
  });
});

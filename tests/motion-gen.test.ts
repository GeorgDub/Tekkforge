import { describe, it, expect } from "vitest";
import { rampe, fall, aufbauMotion, dropMotion, MOTION_PARAM, MOTION_SLOTS, AUFBAU_CUTOFF_VON, AUFBAU_CUTOFF_BIS, DROP_PITCH_AB } from "../src/core/motionGen";
import { buildE2PatternFileV2 } from "../src/core/e2sExport";
import { parseElectribePattern } from "../src/core/electribeImport";

describe("motionGen", () => {
  it("rampe: 64 Werte, linear, in Grenzen", () => {
    const r = rampe(0, 127);
    expect(r).toHaveLength(64);
    expect(r[0]).toBe(0);
    expect(r[63]).toBe(127);
    expect(r[32]).toBeGreaterThan(60);
    expect(r[32]).toBeLessThan(70);
    expect(rampe(200, -5).every((v) => v >= 0 && v <= 127)).toBe(true);
    expect(rampe(10, 20, 1)).toEqual([10]);
  });

  it("fall: konstant bis ab, dann bis zum letzten Step hinunter", () => {
    const f = fall(56, 64, 40);
    expect(f.slice(0, 56).every((v) => v === 64)).toBe(true);
    expect(f[56]).toBe(64);
    expect(f[63]).toBe(40);
    expect(f[60]).toBeLessThan(64);
    expect(f[60]).toBeGreaterThan(40);
  });

  it("aufbauMotion: Stufen setzen den Sweep fort — Stufe 0 beginnt bei 30, die letzte endet bei 127", () => {
    const n = 4;
    const stufen = Array.from({ length: n }, (_, i) => aufbauMotion(i, n));
    expect(stufen[0][0].values[0]).toBe(AUFBAU_CUTOFF_VON);
    expect(stufen[n - 1][0].values[63]).toBe(AUFBAU_CUTOFF_BIS);
    for (let i = 1; i < n; i++) expect(Math.abs(stufen[i][0].values[0] - stufen[i - 1][0].values[63])).toBeLessThanOrEqual(1);
    for (const s of stufen) {
      expect(s).toHaveLength(2);
      expect(s.map((x) => x.targetPart)).toEqual([12, 13]);
      expect(s.every((x) => x.paramId === MOTION_PARAM.cutoff)).toBe(true);
    }
    expect(aufbauMotion(0, 1)[0].values[63]).toBe(AUFBAU_CUTOFF_BIS);
    expect(aufbauMotion(0, 3, Array.from({ length: 12 }, (_, i) => i)).length).toBeLessThanOrEqual(MOTION_SLOTS);
  });

  it("dropMotion: MFX-Rampe global und Pitch-Fall auf der Kick ab Step 56", () => {
    const d = dropMotion();
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ paramId: MOTION_PARAM.mfxEdit, targetPart: -1 });
    expect(d[0].values[0]).toBe(0);
    expect(d[0].values[63]).toBe(80);
    expect(d[1]).toMatchObject({ paramId: MOTION_PARAM.pitch, targetPart: 0 });
    expect(d[1].values[DROP_PITCH_AB - 1]).toBe(64);
    expect(d[1].values[63]).toBe(40);
  });

  it("die Slots ueberleben den Weg durch die Pattern-Datei", () => {
    const bytes = buildE2PatternFileV2({
      name: "MOT",
      bpm: 180,
      stepLength: 64,
      parts: Array.from({ length: 16 }, () => ({ steps: [], muted: true })),
      motionSlots: [...aufbauMotion(0, 2), ...dropMotion()],
    });
    const p = parseElectribePattern(bytes);
    const slots = (p.patternMotion ?? []).filter((s) => s.enabled);
    expect(slots.map((s) => s.paramId)).toEqual([5, 5, 16, 2]);
    expect(slots[0].targetPart).toBe(12);
    expect(slots[0].values[0]).toBe(AUFBAU_CUTOFF_VON);
    expect(slots[3].values[63]).toBe(40);
  });
});

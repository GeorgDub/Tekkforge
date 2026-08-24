import { describe, expect, it } from "vitest";
import {
  THEMES,
  THEME_STANDARD,
  themeFinden,
  cssVars,
  themeWahlLesen,
  themeWahlSchreiben,
} from "../src/core/themes";

const PFLICHT = ["bg", "panel", "elevated", "border", "text", "muted", "dim", "accent", "accent2", "success", "danger"] as const;

describe("Theme-Presets", () => {
  it("bringt den TekkForge-Standard und mindestens fuenf weitere Paletten mit", () => {
    expect(THEMES.length).toBeGreaterThanOrEqual(6);
    expect(THEMES.some((t) => t.name === THEME_STANDARD)).toBe(true);
    const namen = THEMES.map((t) => t.name);
    expect(new Set(namen).size).toBe(namen.length);
  });

  it("hat in jeder Palette alle Farbvariablen als Hex-Werte", () => {
    for (const t of THEMES) {
      for (const k of PFLICHT) {
        expect(t.palette[k], `${t.name}.${k}`).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
      expect(t.titel.length).toBeGreaterThan(0);
    }
  });

  it("faellt bei unbekanntem Namen auf den Standard zurueck", () => {
    expect(themeFinden("gibt-es-nicht").name).toBe(THEME_STANDARD);
    expect(themeFinden(null).name).toBe(THEME_STANDARD);
    expect(themeFinden("midnight").name).toBe("midnight");
  });
});

describe("cssVars", () => {
  it("liefert je Farbvariable einen --praefix-Eintrag", () => {
    const vars = cssVars(themeFinden(THEME_STANDARD).palette);
    for (const k of PFLICHT) expect(vars[`--${k}`]).toMatch(/^#/);
  });

  it("laesst eine eigene Akzentfarbe die Preset-Akzentfarbe ueberschreiben", () => {
    const vars = cssVars(themeFinden(THEME_STANDARD).palette, "#123456");
    expect(vars["--accent"]).toBe("#123456");
  });

  it("ignoriert kaputte Akzentwerte", () => {
    const vars = cssVars(themeFinden(THEME_STANDARD).palette, "rot;evil{}");
    expect(vars["--accent"]).toBe(themeFinden(THEME_STANDARD).palette.accent);
  });
});

describe("Theme-Wahl (Persistenz)", () => {
  it("uebersteht die Runde schreiben -> lesen", () => {
    const raw = themeWahlSchreiben({ name: "deep-ocean", akzent: "#ff00aa" });
    expect(themeWahlLesen(raw)).toEqual({ name: "deep-ocean", akzent: "#ff00aa" });
  });

  it("liefert bei Muell oder leerem Speicher den Standard", () => {
    expect(themeWahlLesen(null).name).toBe(THEME_STANDARD);
    expect(themeWahlLesen("{kaputt").name).toBe(THEME_STANDARD);
    expect(themeWahlLesen(JSON.stringify({ name: 42 })).name).toBe(THEME_STANDARD);
  });
});

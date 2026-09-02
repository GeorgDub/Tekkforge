import { describe, it, expect } from "vitest";
import { schreibeText, textBreite, textHoehe, normalisiere, glyphe, SCHRIFT_BREITE, SCHRIFT_HOEHE } from "../src/core/pixelSchrift";
import { SPLASH_BREITE, SPLASH_HOEHE } from "../src/core/splash";

const leer = () => new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE);
const bild = (px: Uint8Array, x0: number, y0: number, b: number, h: number): string[] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: b }, (_, x) => (px[(y0 + y) * SPLASH_BREITE + x0 + x] ? "#" : ".")).join(""));

describe("pixelSchrift", () => {
  it("jede Glyphe ist 5 × 7 und besteht nur aus # und .", () => {
    for (const z of "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -.,:!?/+=*'()<>#&%_") {
      const g = glyphe(z);
      expect(g, z).toHaveLength(SCHRIFT_HOEHE);
      for (const zeile of g) expect(zeile, z).toMatch(/^[#.]{5}$/);
      expect(g.join("")).not.toBe(glyphe("").join("")); // kein bekanntes Zeichen ist das Kaestchen
    }
    expect(SCHRIFT_BREITE).toBe(5);
  });

  it("normalisiert: Grossschreibung, Umlaute ausgeschrieben", () => {
    expect(normalisiere("Tekkförge ü ß")).toBe("TEKKFOERGE UE SS");
  });

  it("schreibt ein A an die linke obere Ecke, Punkt fuer Punkt", () => {
    const px = schreibeText(leer(), "A", 0, 0);
    expect(bild(px, 0, 0, 5, 7)).toEqual([".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"]);
    // rechts daneben eine Spalte Luft, dann nichts
    expect(px[5]).toBe(0);
  });

  it("Breite und Hoehe: 5 je Zeichen plus 1 Luft, mal Skala", () => {
    expect(textBreite("TEKK")).toBe(4 * 5 + 3);
    expect(textBreite("TEKK", 3)).toBe((4 * 5 + 3) * 3);
    expect(textBreite("")).toBe(0);
    expect(textHoehe(2)).toBe(14);
  });

  it("Skala 2 macht aus jedem Punkt einen 2 × 2-Block", () => {
    const px = schreibeText(leer(), "I", 0, 0, 2);
    expect(bild(px, 0, 0, 10, 2)).toEqual(["##########", "##########"]);
    expect(bild(px, 0, 2, 10, 2)).toEqual(["....##....", "....##...."]);
  });

  it("„mitte“ zentriert, Ueberstand wird abgeschnitten statt zu wandern", () => {
    const px = schreibeText(leer(), "TEKKFORGE", "mitte", "mitte", 2);
    const b = textBreite("TEKKFORGE", 2);
    const x0 = Math.floor((128 - b) / 2);
    const y0 = Math.floor((64 - 14) / 2);
    // T oben links: volle Balkenzeile ab x0
    expect(bild(px, x0, y0, 10, 1)).toEqual(["##########"]);
    expect(px[y0 * SPLASH_BREITE + x0 - 1]).toBe(0);
    const rand = schreibeText(leer(), "XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX", 0, 60, 3); // ragt rechts und unten raus
    expect(rand.length).toBe(SPLASH_BREITE * SPLASH_HOEHE);
    expect(rand[63 * SPLASH_BREITE + 127]).toBeDefined();
  });

  it("unbekannte Zeichen werden zum Kaestchen, damit nichts still verschwindet", () => {
    const px = schreibeText(leer(), "€", 0, 0);
    expect(bild(px, 0, 0, 5, 7)).toEqual(["#####", "#...#", "#...#", "#...#", "#...#", "#...#", "#####"]);
  });
});

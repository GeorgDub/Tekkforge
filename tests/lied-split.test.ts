import { describe, expect, it } from "vitest";
import { teileLieder } from "../src/core/generatorSession";

describe("teileLieder", () => {
  it("laesst alles in einer Gruppe, wenn es passt", () => {
    // 2 Lieder x 3 Melos x 6 Patterns = 36
    expect(teileLieder([3, 3], 6, 250)).toEqual([{ vonLied: 0, bisLied: 1, patterns: 36 }]);
  });

  it("teilt an der Liedgrenze, sobald der Deckel reissen wuerde", () => {
    // je Lied 3 Melos x 6 = 18 Patterns -> 13 Lieder = 234 passt, das 14. nicht mehr
    const gruppen = teileLieder(Array.from({ length: 20 }, () => 3), 6, 250);
    expect(gruppen[0]).toEqual({ vonLied: 0, bisLied: 12, patterns: 234 });
    expect(gruppen[1].vonLied).toBe(13);
    expect(gruppen[gruppen.length - 1].bisLied).toBe(19);
    // alle Lieder abgedeckt, keine Luecken
    for (let i = 1; i < gruppen.length; i++) expect(gruppen[i].vonLied).toBe(gruppen[i - 1].bisLied + 1);
  });

  it("gruppiert ein einzelnes Ueber-Deckel-Lied allein", () => {
    const gruppen = teileLieder([50, 1], 6, 250);
    expect(gruppen.length).toBe(2);
    expect(gruppen[0]).toEqual({ vonLied: 0, bisLied: 0, patterns: 300 });
    expect(gruppen[1]).toEqual({ vonLied: 1, bisLied: 1, patterns: 6 });
  });

  it("leere Eingabe -> keine Gruppen", () => {
    expect(teileLieder([], 6, 250)).toEqual([]);
  });

  it("rechnet VRS-Extras je Lied in die Schaetzung ein", () => {
    // Lied 1: 3 Melos x 6 + 4 Extras = 22; Lied 2: 3 x 6 = 18
    expect(teileLieder([3, 3], 6, 250, [4, 0])).toEqual([{ vonLied: 0, bisLied: 1, patterns: 40 }]);
    // mit Extras reisst der Deckel frueher: 2 Lieder je 18 + 120 Extras = 156 -> zweites Lied faellt in Gruppe 2
    const gruppen = teileLieder([3, 3], 6, 250, [120, 120]);
    expect(gruppen.length).toBe(2);
    expect(gruppen[0].patterns).toBe(138);
  });
});

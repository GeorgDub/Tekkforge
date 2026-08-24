import { describe, expect, it } from "vitest";
import { dateiMerken, dateienLesen, dateienSchreiben, type LetzteDatei } from "../src/core/letzteDateien";

const d = (name: string, wann: number): LetzteDatei => ({ name, art: "all", wann });

describe("Letzte Dateien", () => {
  it("stellt den neuesten Eintrag nach vorn", () => {
    const liste = dateiMerken([d("a.all", 1)], d("b.all", 2));
    expect(liste.map((e) => e.name)).toEqual(["b.all", "a.all"]);
  });

  it("ersetzt einen vorhandenen Eintrag gleichen Namens statt zu doppeln", () => {
    const liste = dateiMerken([d("a.all", 1), d("b.all", 2)], d("a.all", 3));
    expect(liste.map((e) => e.name)).toEqual(["a.all", "b.all"]);
    expect(liste[0].wann).toBe(3);
  });

  it("deckelt auf acht Eintraege", () => {
    let liste: LetzteDatei[] = [];
    for (let i = 0; i < 12; i++) liste = dateiMerken(liste, d(`nr${i}.all`, i));
    expect(liste.length).toBe(8);
    expect(liste[0].name).toBe("nr11.all");
  });

  it("uebersteht die Runde schreiben -> lesen", () => {
    const liste = [d("a.all", 1), { name: "p.json", art: "projekt" as const, wann: 2, pfad: "G:/x" }];
    expect(dateienLesen(dateienSchreiben(liste))).toEqual(liste);
  });

  it("liefert bei Muell eine leere Liste", () => {
    expect(dateienLesen(null)).toEqual([]);
    expect(dateienLesen("{{{")).toEqual([]);
    expect(dateienLesen(JSON.stringify({ nicht: "liste" }))).toEqual([]);
    expect(dateienLesen(JSON.stringify([{ name: 1 }]))).toEqual([]);
  });
});

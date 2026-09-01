import { describe, it, expect } from "vitest";
import {
  baueSammlung,
  leseSammlung,
  planeVerteilung,
  SAMMLUNG_VERSION,
  type SammlungsEintrag,
} from "../src/core/sammlung";
import { FX_PRESET_SIZE, initFxPresetBytes } from "../src/core/e2FxPreset";
import { GROOVE_SIZE, initGrooveBytes } from "../src/core/e2Groove";

const eintraege = (): SammlungsEintrag[] => [
  { art: "ifx", name: "Mein Crusher", bytes: initFxPresetBytes() },
  { art: "mfx", name: "Weiter Hall", bytes: initFxPresetBytes() },
  { art: "groove", name: "Mein Swing", bytes: initGrooveBytes() },
];

describe("sammlung", () => {
  it("schreiben und lesen ergibt dieselben Einträge", () => {
    const s = leseSammlung(baueSammlung(eintraege(), { titel: "Tekk-Paket", autor: "Georg" }));
    expect(s.version).toBe(SAMMLUNG_VERSION);
    expect(s.titel).toBe("Tekk-Paket");
    expect(s.autor).toBe("Georg");
    expect(s.eintraege.map((e) => e.name)).toEqual(["Mein Crusher", "Weiter Hall", "Mein Swing"]);
    expect(s.eintraege.map((e) => e.art)).toEqual(["ifx", "mfx", "groove"]);
    expect(Array.from(s.eintraege[0].bytes)).toEqual(Array.from(initFxPresetBytes()));
    expect(s.eintraege[2].bytes.length).toBe(GROOVE_SIZE);
  });

  it("prüft die Größe je Art — ein Groove in einem Preset-Feld fällt auf", () => {
    const kaputt = JSON.parse(baueSammlung(eintraege(), {}));
    kaputt.eintraege[0].art = "groove"; // 524 Bytes, aber als Groove deklariert
    expect(() => leseSammlung(JSON.stringify(kaputt))).toThrow(/Größe|Groesse|Bytes/i);
  });

  it("lehnt fremde und kaputte Dateien ab", () => {
    expect(() => leseSammlung("kein json")).toThrow();
    expect(() => leseSammlung(JSON.stringify({ version: 99, eintraege: [] }))).toThrow(/Version/i);
    expect(() => leseSammlung(JSON.stringify({ version: SAMMLUNG_VERSION, eintraege: [] }))).toThrow(/leer|keine/i);
  });

  it("Namen werden gekürzt, damit sie ins Gerätemenü passen", () => {
    const s = leseSammlung(
      baueSammlung([{ art: "ifx", name: "Ein viel zu langer Preset-Name", bytes: initFxPresetBytes() }], {}),
    );
    expect(s.eintraege[0].name.length).toBeLessThanOrEqual(15);
  });

  it("Einträge behalten ihre Reihenfolge", () => {
    const viele: SammlungsEintrag[] = Array.from({ length: 8 }, (_, i) => ({
      art: "groove" as const,
      name: `G${i}`,
      bytes: initGrooveBytes(),
    }));
    expect(leseSammlung(baueSammlung(viele, {})).eintraege.map((e) => e.name)).toEqual(viele.map((e) => e.name));
  });

  it("Preset-Größe stimmt mit dem Bankformat überein", () => {
    expect(initFxPresetBytes().length).toBe(FX_PRESET_SIZE);
    expect(initGrooveBytes().length).toBe(GROOVE_SIZE);
  });

  it("der Ziel-Platz (wie am Gerät, ab 1) überlebt den Round-Trip — und fehlt, wo keiner gesetzt war", () => {
    const mitPlatz: SammlungsEintrag[] = [
      { art: "ifx", name: "A", bytes: initFxPresetBytes(), platz: 41 },
      { art: "mfx", name: "B", bytes: initFxPresetBytes() },
    ];
    const s = leseSammlung(baueSammlung(mitPlatz, {}));
    expect(s.eintraege[0].platz).toBe(41);
    expect(s.eintraege[1].platz).toBeUndefined();
  });

  it("lehnt unmögliche Plätze ab — 0, über der Art-Grenze, krumm", () => {
    const mit = (art: SammlungsEintrag["art"], platz: number): string => {
      const roh = JSON.parse(baueSammlung([{ art, name: "X", bytes: art === "groove" ? initGrooveBytes() : initFxPresetBytes() }], {}));
      roh.eintraege[0].platz = platz;
      return JSON.stringify(roh);
    };
    expect(() => leseSammlung(mit("ifx", 0))).toThrow(/Platz/);
    expect(() => leseSammlung(mit("ifx", 97))).toThrow(/Platz/);
    expect(() => leseSammlung(mit("mfx", 33))).toThrow(/Platz/);
    expect(() => leseSammlung(mit("groove", 97))).toThrow(/Platz/);
    expect(() => leseSammlung(mit("ifx", 1.5))).toThrow(/Platz/);
    expect(leseSammlung(mit("mfx", 32)).eintraege[0].platz).toBe(32);
  });

  it("planeVerteilung: nimmt Einträge mit Platz in Reihenfolge, überspringt die ohne", () => {
    const e: SammlungsEintrag[] = [
      { art: "ifx", name: "A", bytes: initFxPresetBytes(), platz: 41 },
      { art: "ifx", name: "B", bytes: initFxPresetBytes() },
      { art: "mfx", name: "C", bytes: initFxPresetBytes(), platz: 21 },
    ];
    const plan = planeVerteilung(e);
    expect(plan.schritte.map((s) => s.eintrag.name)).toEqual(["A", "C"]);
    expect(plan.uebersprungen).toEqual([1]);
    expect(plan.doppelt).toEqual([]);
  });

  it("planeVerteilung: meldet doppelte Plätze derselben Art — dieselbe Nummer bei IFX und MFX ist dagegen erlaubt", () => {
    const e: SammlungsEintrag[] = [
      { art: "ifx", name: "A", bytes: initFxPresetBytes(), platz: 41 },
      { art: "ifx", name: "B", bytes: initFxPresetBytes(), platz: 41 },
      { art: "mfx", name: "C", bytes: initFxPresetBytes(), platz: 41 },
    ];
    const plan = planeVerteilung(e);
    expect(plan.doppelt).toEqual([{ art: "ifx", platz: 41 }]);
  });
});

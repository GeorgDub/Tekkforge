import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { MOD_TYPEN, MOD_TYPEN_STOCK_ANZAHL, FILTER_TYPEN, modTypName, filterTypName } from "../src/core/e2ModTypen";
import { PART_PARAMS } from "../src/core/partParams";

describe("e2ModTypen — Namen aus der Firmware", () => {
  it("96 Modulationstypen: 12 Stock-Quellen und 4 Hacktribe-Quellen × 6 Ziele, in Tabellenreihenfolge", () => {
    expect(MOD_TYPEN).toHaveLength(132);
    expect(MOD_TYPEN_STOCK_ANZAHL).toBe(72);
    expect(MOD_TYPEN.slice(0, 6)).toEqual(["EG+ Filter", "EG+ Pitch", "EG+ OSC", "EG+ Level", "EG+ Pan", "EG+ IFX"]);
    expect(MOD_TYPEN[24]).toBe("LFOTri Filter");
    expect(MOD_TYPEN[71]).toBe("Random IFX");
    expect(MOD_TYPEN[72]).toBe("SinUp Filter");
    expect(MOD_TYPEN[95]).toBe("SinDwnB IFX");
    expect(MOD_TYPEN[96]).toBe("SawUp Filter");
    expect(MOD_TYPEN[131]).toBe("RandomB IFX");
    expect(modTypName(96)).toBe("97 · SawUp Filter (TekkForge)");
    expect(modTypName(0)).toBe("1 · EG+ Filter");
    expect(modTypName(72)).toBe("73 · SinUp Filter (Hacktribe)");
    expect(modTypName(200)).toBe("201");
  });

  it("16 Filtertypen, LPF/HPF/BPF je Modell", () => {
    expect(FILTER_TYPEN).toHaveLength(16);
    expect(FILTER_TYPEN[0]).toBe("electribe LPF");
    expect(FILTER_TYPEN[6]).toBe("electribe HPF");
    expect(FILTER_TYPEN[15]).toBe("Acid BPF");
    expect(filterTypName(2)).toBe("3 · MG LPF");
  });

  it("die Part-Parameter tragen die Namen fuer Filter- und Mod-Typ", () => {
    expect(PART_PARAMS.find((p) => p.key === "filterType")?.namen).toBe(FILTER_TYPEN);
    expect(PART_PARAMS.find((p) => p.key === "modType")?.namen).toBe(MOD_TYPEN);
  });

  const VSB = "G:/IdeaProjects/hacktribe/fertige firmwares/SYSTEM.VSB";
  it.skipIf(!fs.existsSync(VSB))("die Namen stehen genau so in der Hacktribe-Firmware (Tabelle 0xC01A0000, 88 Bytes je Eintrag)", () => {
    const b = fs.readFileSync(VSB);
    const name = (o: number): string => {
      let s = "";
      for (let i = o; i < o + 20 && b[i]; i++) s += String.fromCharCode(b[i]);
      return s;
    };
    for (let i = 0; i < 96; i++) expect(name(0x1a0100 + i * 0x58).replace(/ Osc$/, " OSC")).toBe(MOD_TYPEN[i]);
    // 96…131 stehen nicht in Hacktribes Datei — das sind TekkForges Kombinationen
    expect(b[0x1a0100 + 96 * 0x58]).toBe(0xff); // dahinter frei
  });
});

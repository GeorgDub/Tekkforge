import { describe, it, expect } from "vitest";
import {
  decodeFxPreset,
  encodeFxPreset,
  initFxPresetBytes,
  ifx2Moeglich,
  FX_PRESET_SIZE,
  FX_QUELLEN,
  IFX2_FAEHIG,
  type FxPreset,
} from "../src/core/e2FxPreset";

/** 524-B-Blob mit erkennbaren Fuellbytes in den unbekannten Bereichen. */
function testBlob(): Uint8Array {
  const b = new Uint8Array(FX_PRESET_SIZE).fill(0xab);
  // Name "Bit Crusher" ab +1, 15 Zeichen, mit Nullen aufgefuellt
  const name = "Bit Crusher";
  b[0] = 0x00;
  for (let i = 0; i < 15; i++) b[1 + i] = i < name.length ? name.charCodeAt(i) : 0;
  b[0x10] = 0;
  b[0x11] = 0;
  // Control-Map: Slot 0 = FX Edit X -> IFX 1, Param 2, 10..120
  for (let i = 0; i < 10; i++) {
    const o = 0x12 + i * 28;
    b.fill(0, o, o + 28);
  }
  b[0x12] = 0x42; // fx_edit_x
  b[0x13] = 0x00; // Kette: IFX 1
  b[0x14] = 0x02; // Ziel-Parameter
  b[0x16] = 10; // min
  b[0x18] = 120; // max
  // IFX 1 = Decimator (0x09) mit zwei Parametern
  b[0x12a] = 0x09;
  b[0x12b] = 0x40; // post level
  b[0x12e] = 0x00; // slot index
  b[0x12f] = 0x7f; // pre level
  b[0x135] = 100; // param 0
  b[0x137] = 6; // param 1
  // IFX 2 = Thru, MFX = Thru
  b[0x174] = 0x00;
  b[0x1be] = 0x00;
  b[0x209] = 0x7f;
  b[0x20a] = 0x7f;
  b[0x20b] = 0x00;
  return b;
}

describe("e2FxPreset", () => {
  it("liest Name, Algorithmus, Pegel und Parameter aus dem 524-B-Block", () => {
    const p = decodeFxPreset(testBlob());
    expect(p.name).toBe("Bit Crusher");
    expect(p.ifx1.device).toBe(0x09);
    expect(p.ifx1.algorithmus).toBe("Decimator");
    expect(p.ifx1.preLevel).toBe(0x7f);
    expect(p.ifx1.postLevel).toBe(0x40);
    expect(p.ifx1.params[0]).toBe(100);
    expect(p.ifx1.params[1]).toBe(6);
    // Parameternamen kommen aus der Algorithmus-Tabelle
    expect(p.ifx1.paramNamen[0]).toBe("dry_wet");
    expect(p.ifx1.paramNamen.length).toBe(p.ifx1.params.length);
  });

  it("liest die zehn Zuordnungen der X/Y-Flaeche", () => {
    const p = decodeFxPreset(testBlob());
    expect(p.controlMap).toHaveLength(10);
    const s0 = p.controlMap[0];
    expect(s0.quelle).toBe(0x42);
    expect(s0.quelleName).toBe("FX Edit X");
    expect(s0.kette).toBe(0);
    expect(s0.zielParam).toBe(2);
    expect(s0.min).toBe(10);
    expect(s0.max).toBe(120);
    expect(p.controlMap[1].quelle).toBe(0);
  });

  it("schreibt unveraendert zurueck — unbekannte Bytes bleiben erhalten", () => {
    const roh = testBlob();
    const zurueck = encodeFxPreset(decodeFxPreset(roh), roh);
    expect(Array.from(zurueck)).toEqual(Array.from(roh));
  });

  it("Aenderungen landen an den richtigen Byte-Positionen", () => {
    const roh = testBlob();
    const p = decodeFxPreset(roh);
    p.name = "Mein Crusher";
    p.ifx1.params[1] = 3;
    p.controlMap[0].max = 90;
    const neu = encodeFxPreset(p, roh);
    expect(String.fromCharCode(...neu.slice(1, 13))).toBe("Mein Crusher");
    expect(neu[14]).toBe(0); // Rest des Namensfeldes genullt
    expect(neu[0x137]).toBe(3);
    expect(neu[0x18]).toBe(90);
    // alles andere unveraendert
    expect(neu[0x135]).toBe(100);
    expect(neu[0x12a]).toBe(0x09);
  });

  it("Algorithmuswechsel setzt Parameter auf die Laenge des neuen Effekts", () => {
    const p = decodeFxPreset(testBlob());
    p.ifx1.device = 0x0a; // Filter
    const neu = decodeFxPreset(encodeFxPreset(p, testBlob()));
    expect(neu.ifx1.algorithmus).toBe("Filter");
    expect(neu.ifx1.paramNamen.length).toBeGreaterThan(0);
    expect(neu.ifx1.params.length).toBe(neu.ifx1.paramNamen.length);
  });

  it("Name wird auf 15 Zeichen gekuerzt und nicht-ASCII ersetzt", () => {
    const p = decodeFxPreset(testBlob());
    p.name = "Übermäßig langer Name";
    const neu = decodeFxPreset(encodeFxPreset(p, testBlob()));
    expect(neu.name.length).toBeLessThanOrEqual(15);
    expect(/^[\x20-\x7e]*$/.test(neu.name)).toBe(true);
  });

  it("zweiter Insert-Effekt nur nach den dafuer geeigneten ersten", () => {
    // Geraeteregel aus hacktribe-editor: IFX 2 gibt es nur hinter diesen
    expect(ifx2Moeglich(0x00)).toBe(true); // Thru
    expect(ifx2Moeglich(0x03)).toBe(true); // Cheap Comp
    expect(ifx2Moeglich(0x0a)).toBe(true); // Filter
    expect(ifx2Moeglich(0x09)).toBe(false); // Decimator
    expect(ifx2Moeglich(0x16)).toBe(false); // Ring Mod
    expect(IFX2_FAEHIG).toContain(0x10); // Acid Driver
  });

  it("initFxPresetBytes liefert einen gueltigen, lesbaren Leer-Block", () => {
    const b = initFxPresetBytes();
    expect(b.length).toBe(FX_PRESET_SIZE);
    const p = decodeFxPreset(b);
    expect(p.name).toBe("Init FX");
    expect(p.ifx1.device).toBe(0);
    expect(p.controlMap.every((s) => s.quelle === 0)).toBe(true);
    expect(b[0x209]).toBe(0x7f);
    expect(b[0x20a]).toBe(0x7f);
  });

  it("Quellenliste enthaelt die Bedienelemente des Geraets", () => {
    const namen = FX_QUELLEN.map((q) => q.name);
    expect(namen).toContain("FX Edit X");
    expect(namen).toContain("FX Edit Y");
    expect(namen).toContain("FX On");
    expect(FX_QUELLEN.find((q) => q.name === "FX Edit X")!.wert).toBe(0x42);
  });

  it("MFX-Presets nutzen die Master-Algorithmentabelle", () => {
    const roh = testBlob();
    roh[0x1be] = 0x2b; // ein Master-Algorithmus
    const p = decodeFxPreset(roh, true);
    expect(p.mfx.algorithmus).not.toBe("");
    expect(p.istMfx).toBe(true);
  });
});

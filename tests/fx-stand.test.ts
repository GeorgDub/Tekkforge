import { describe, it, expect } from "vitest";
import {
  setzeFxWert,
  fxWert,
  loescheFxWert,
  fxStandNachrichten,
  fxStandBeschreibung,
  fxStandNormalisieren,
  fxStandInPreset,
  partsMitFxStand,
  trifftZiel,
} from "../src/core/fxStand";
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes } from "../src/core/e2FxPreset";
import { fxSlotForPart, MFX_SLOT, NRPN_CC } from "../src/core/hacktribeNrpn";
import { createPattern, serializeProject, deserializeProject, clonePattern } from "../src/core/editorModel";

/**
 * Die Live-FX-Werte eines Patterns: das Geraet verwirft sie beim
 * Patternwechsel (Nutzerbefund 2026-09-06), TekkForge merkt sie je Pattern
 * und schickt sie nach.
 */
describe("fxStand — merken", () => {
  it("setzeFxWert ersetzt denselben Zielpunkt und haelt die Liste sortiert", () => {
    let l = setzeFxWert(undefined, { part: 3, slot: 0, param: 1 }, 90);
    l = setzeFxWert(l, { part: 1, slot: 1, param: 0 }, 10);
    l = setzeFxWert(l, { mfx: true, param: 2 }, 40);
    l = setzeFxWert(l, { part: 3, slot: 0, param: 1 }, 127);
    expect(l).toEqual([
      { part: 0, slot: 0, param: 2, wert: 40 },
      { part: 1, slot: 1, param: 0, wert: 10 },
      { part: 3, slot: 0, param: 1, wert: 127 },
    ]);
    expect(fxWert(l, { part: 3, slot: 0, param: 1 })).toBe(127);
    expect(fxWert(l, { mfx: true, param: 2 })).toBe(40);
    expect(fxWert(l, { part: 3, slot: 1, param: 1 })).toBeUndefined();
    expect(loescheFxWert(l, { part: 1, slot: 1, param: 0 })).toHaveLength(2);
  });

  it("klemmt Werte und Indizes auf 0..127, Parts auf 1..16", () => {
    const l = setzeFxWert([], { part: 99, slot: 0, param: 300 }, 999);
    expect(l).toEqual([{ part: 16, slot: 0, param: 127, wert: 127 }]);
    expect(setzeFxWert([], { part: 2, slot: 0, param: 0 }, -5)[0].wert).toBe(0);
    expect(trifftZiel({ part: 0, slot: 0, param: 3, wert: 1 }, { mfx: true, param: 3 })).toBe(true);
  });

  it("die Eingabe bleibt unangetastet", () => {
    const a = [{ part: 1, slot: 0 as const, param: 0, wert: 5 }];
    const b = setzeFxWert(a, { part: 1, slot: 0, param: 0 }, 6);
    expect(a[0].wert).toBe(5);
    expect(b[0].wert).toBe(6);
  });
});

describe("fxStand — senden", () => {
  it("je Eintrag vier NRPN-CCs: Kategorie 1, Slot des Parts bzw. MFX-Slot, Index, Wert", () => {
    const l = [
      { part: 2, slot: 1 as const, param: 3, wert: 77 },
      { part: 0, slot: 0 as const, param: 0, wert: 11 },
    ];
    const msgs = fxStandNachrichten(l, 4);
    expect(msgs).toHaveLength(8);
    expect([...msgs[0]]).toEqual([0xb4, NRPN_CC.msb, 1]);
    expect([...msgs[1]]).toEqual([0xb4, NRPN_CC.lsb, fxSlotForPart(2, 1)]);
    expect([...msgs[2]]).toEqual([0xb4, NRPN_CC.dataMsb, 3]);
    expect([...msgs[3]]).toEqual([0xb4, NRPN_CC.dataLsb, 77]);
    expect([...msgs[5]]).toEqual([0xb4, NRPN_CC.lsb, MFX_SLOT]);
    expect(fxStandNachrichten(undefined, 0)).toEqual([]);
  });

  it("Beschreibung nennt Part, Slot, Index und Wert", () => {
    expect(fxStandBeschreibung([{ part: 1, slot: 0, param: 0, wert: 90 }, { part: 0, slot: 0, param: 2, wert: 40 }])).toBe("P1 IFX1 #0=90 · MFX #2=40");
    expect(fxStandBeschreibung([])).toBe("");
    expect(partsMitFxStand([{ part: 5, slot: 0, param: 0, wert: 1 }, { part: 0, slot: 0, param: 0, wert: 1 }, { part: 5, slot: 1, param: 0, wert: 1 }])).toEqual([5]);
  });
});

describe("fxStand — Projekt", () => {
  it("normalisieren wirft Muell weg und behaelt Brauchbares", () => {
    const l = fxStandNormalisieren([
      { part: 1, slot: 0, param: 0, wert: 50 },
      { part: "x", param: 0, wert: 1 },
      { part: 2, param: 200, wert: 1 },
      null,
      { part: 0, param: 1, wert: 20 },
    ]);
    expect(l).toEqual([
      { part: 0, slot: 0, param: 1, wert: 20 },
      { part: 1, slot: 0, param: 0, wert: 50 },
    ]);
    expect(fxStandNormalisieren("nein")).toEqual([]);
  });

  it("ueberlebt Speichern, Laden und Klonen des Projekts", () => {
    const p = createPattern("FX");
    p.fxStand = setzeFxWert(undefined, { part: 4, slot: 0, param: 1 }, 66);
    const text = serializeProject({ version: 1, patterns: [p], samples: [] });
    const zurueck = deserializeProject(text);
    expect(zurueck.patterns[0].fxStand).toEqual([{ part: 4, slot: 0, param: 1, wert: 66 }]);
    expect(clonePattern(p).fxStand).toEqual(p.fxStand);
    const ohne = deserializeProject(serializeProject({ version: 1, patterns: [createPattern("LEER")], samples: [] }));
    expect(ohne.patterns[0].fxStand).toBeUndefined();
  });
});

describe("fxStand — ins Preset patchen", () => {
  it("schreibt IFX-1- und IFX-2-Werte des Parts in die Parameter, laesst fremde Parts und zu hohe Indizes aus", () => {
    const roh = decodeFxPreset(initFxPresetBytes(), false);
    roh.name = "Basis";
    roh.ifx1.device = 0x0a; // Filter: dry_wet, output_select, frequency, resonance
    roh.ifx1.params = [127, 0, 60, 30];
    roh.ifx2.device = 0x06; // EQ 2-Band
    roh.ifx2.params = [127, 0, 0, 12, 5, 36, 56, 5, 36];
    const bytes = encodeFxPreset(roh);
    const liste = [
      { part: 3, slot: 0 as const, param: 2, wert: 100 },
      { part: 3, slot: 0 as const, param: 3, wert: 90 },
      { part: 3, slot: 1 as const, param: 1, wert: 77 },
      { part: 3, slot: 0 as const, param: 9, wert: 1 },
      { part: 4, slot: 0 as const, param: 2, wert: 5 },
    ];
    const r = fxStandInPreset(bytes, liste, 3);
    expect(r.gesetzt).toBe(3);
    expect(r.ausgelassen).toEqual([{ part: 3, slot: 0, param: 9, wert: 1 }]);
    const p = decodeFxPreset(r.bytes, false);
    expect(p.name).toBe("Basis");
    expect(p.ifx1.params).toEqual([127, 0, 100, 90]);
    expect(p.ifx2.params[1]).toBe(77);
    // Unbeteiligte Bytes bleiben: nur die Parameterbytes unterscheiden sich.
    const diff = [...r.bytes].map((b, i) => (b !== bytes[i] ? i : -1)).filter((i) => i >= 0);
    expect(diff).toEqual([0x135 + 4, 0x135 + 6, 0x17f + 2]);
  });
});

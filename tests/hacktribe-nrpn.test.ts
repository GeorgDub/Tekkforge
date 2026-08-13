/**
 * tests/hacktribe-nrpn.test.ts
 *
 * Sichert die Byte-Kodierung der Hacktribe-NRPN-Schicht und die
 * Dump-Laengenpruefung ab.
 *
 * ⚠ Was diese Tests NICHT koennen: belegen, dass das Geraet auf die Bytes so
 * reagiert wie gemeint. Dafuer gibt es kein Offline-Orakel — anders als bei der
 * `.all`-Geometrie, die sich aus den Dateien selbst pruefen laesst. Getestet
 * wird hier ausschliesslich gegen die dokumentierte CC-Reihenfolge und gegen
 * die im Omnitribe-Pruefprotokoll geraetegemessenen Zahlenwerte.
 */

import { describe, it, expect } from "vitest";
import {
  NRPN_CC,
  NRPN_CATEGORY,
  FX_SOURCE_CONTROL,
  MFX_SLOT,
  buildSetFxParam,
  buildPanelControl,
  buildMapFxParam,
  fxSlotForPart,
  PANEL_MODE,
} from "../src/core/hacktribeNrpn";
import {
  expectedDumpLength,
  isWellSizedDump,
  decodeDump,
  buildCurrentPatternDump,
  buildPatternDump,
  E2_MSG,
  E2_PATTERN_BODY_SIZE,
} from "../src/core/e2sysex";
import { fxTypeDef, IFX_TYPES } from "../src/core/e2FxParams";

describe("NRPN — Rahmenformat", () => {
  it("sendet die vier CCs in der vorgeschriebenen Reihenfolge", () => {
    const msgs = buildSetFxParam(0, MFX_SLOT, 3, 100);
    expect(msgs).toHaveLength(4);
    expect(msgs.map((m) => m[1])).toEqual([
      NRPN_CC.msb,
      NRPN_CC.lsb,
      NRPN_CC.dataMsb,
      NRPN_CC.dataLsb,
    ]);
    // Kategorie, FX-Slot, Param-Index, Wert
    expect(msgs.map((m) => m[2])).toEqual([NRPN_CATEGORY.setFxParam, MFX_SLOT, 3, 100]);
  });

  it("legt den MIDI-Kanal in das Status-Nibble aller vier CCs", () => {
    for (const [status] of buildSetFxParam(5, MFX_SLOT, 0, 0)) {
      expect(status).toBe(0xb5); // Control-Change, Kanal 6 (0-basiert 5)
    }
  });

  it("klemmt Kanal und Werte in den 7-bit-/Kanal-Bereich", () => {
    for (const [status] of buildSetFxParam(99, MFX_SLOT, 0, 0)) expect(status).toBe(0xbf);
    const [, , , dataLsb] = buildSetFxParam(0, MFX_SLOT, 0, 9999);
    expect(dataLsb[2]).toBe(127);
    const neg = buildSetFxParam(0, MFX_SLOT, 0, -5);
    expect(neg[3][2]).toBe(0);
  });
});

describe("NRPN — FX-Slot-Arithmetik", () => {
  it("gibt jedem Part zwei aufeinanderfolgende IFX-Slots", () => {
    expect(fxSlotForPart(1, 0)).toBe(0);
    expect(fxSlotForPart(1, 1)).toBe(1);
    expect(fxSlotForPart(2, 0)).toBe(2);
    expect(fxSlotForPart(16, 1)).toBe(31);
  });

  it("haelt die Part-Slots vom Master-FX-Slot getrennt", () => {
    // 16 Parts x 2 Slots = 0..31; MFX liegt direkt dahinter.
    expect(fxSlotForPart(16, 1)).toBeLessThan(MFX_SLOT);
    expect(MFX_SLOT).toBe(0x20);
  });

  it("klemmt Part-Nummern ausserhalb 1..16", () => {
    expect(fxSlotForPart(0, 0)).toBe(0);
    expect(fxSlotForPart(99, 0)).toBe(30);
  });
});

describe("NRPN — FX_SOURCE_CONTROL nutzt die RAM-Kodierung", () => {
  it("kodiert 'FX Edit X' als 0x02, nicht als 0x42", () => {
    // Am Geraet gemessen (2026-07-28): der NRPN-Handler schreibt den Wert roh
    // in die Live-Control-Map. 0x42 ist dort ungueltig — das ist die
    // Preset-Datei-Kodierung, siehe Kommentar an FX_SOURCE_CONTROL.
    expect(FX_SOURCE_CONTROL.fxEditX).toBe(0x02);
    expect(FX_SOURCE_CONTROL.fxEditY).toBe(0x03);
    expect(FX_SOURCE_CONTROL.fxOn).toBe(0x01);
    expect(FX_SOURCE_CONTROL.pressPlay).toBe(0x0a);
  });

  it("haelt alle Quell-Bedienelemente im RAM-Bereich 0x00..0x0A", () => {
    for (const v of Object.values(FX_SOURCE_CONTROL)) {
      expect(v).toBeGreaterThanOrEqual(0x00);
      expect(v).toBeLessThanOrEqual(0x0a);
    }
  });

  it("sendet eine Zuweisung als fuenf vollstaendige NRPN-Nachrichten", () => {
    const msgs = buildMapFxParam(0, fxSlotForPart(1, 0), {
      mapSlot: 0,
      sourceControl: FX_SOURCE_CONTROL.fxEditX,
      targetParam: 2,
      minValue: 0,
      maxValue: 127,
    });
    expect(msgs).toHaveLength(5 * 4);
    // Sub-Index laeuft 0..4, Werte in Reihenfolge mapSlot..maxValue
    const subIdx = msgs.filter((_, i) => i % 4 === 2).map((m) => m[2]);
    expect(subIdx).toEqual([0, 1, 2, 3, 4]);
    const values = msgs.filter((_, i) => i % 4 === 3).map((m) => m[2]);
    expect(values).toEqual([0, 0x02, 2, 0, 127]);
  });
});

describe("NRPN — Panel-Fernsteuerung", () => {
  it("schaltet einen Part stumm", () => {
    const msgs = buildPanelControl(0, "mute", 3, 1);
    expect(msgs[0][2]).toBe(NRPN_CATEGORY.panelControl);
    expect(msgs[1][2]).toBe(PANEL_MODE.mute);
    expect(msgs[2][2]).toBe(3);
    expect(msgs[3][2]).toBe(1);
  });
});

describe("FX-Parameter-Namen (Bindeglied zum Part-IFX-Typ)", () => {
  it("benennt die Parameter eines IFX-Typs in NRPN-Index-Reihenfolge", () => {
    const def = fxTypeDef(0x01, false); // MKP2 Comp
    expect(def?.name).toBe("MKP2 Comp");
    // params[k] ist der Name des Parameters mit DATA-MSB-Index k.
    expect(def?.params[0]).toBe("dry_wet");
  });

  it("kennt Thru als parameterlosen Durchlauf", () => {
    expect(fxTypeDef(0x00, false)).toEqual({ name: "Thru", params: [] });
  });

  it("liefert undefined fuer unbekannte Geraete-IDs statt zu raten", () => {
    expect(fxTypeDef(0xfe, false)).toBeUndefined();
  });

  it("deckt den IFX-Typ-Bereich ab, den partParams zulaesst (0..63)", () => {
    const ids = Object.keys(IFX_TYPES).map(Number);
    expect(Math.min(...ids)).toBe(0);
    expect(Math.max(...ids)).toBeLessThanOrEqual(63);
  });
});

describe("Dump-Laengenpruefung", () => {
  // Feste Zahlen statt derselben Formel wie die Produktion — genau daran ist
  // der Fehler in Synthstudio vorbeigerutscht.
  it("erwartet 18733 B fuer den Current-Pattern-Dump", () => {
    expect(expectedDumpLength(E2_MSG.currentPatternDump)).toBe(18733);
  });

  it("erwartet 18735 B fuer den Slot-Dump (zwei Bytes Pattern-Nummer mehr)", () => {
    expect(expectedDumpLength(E2_MSG.patternDump)).toBe(18735);
  });

  it("laesst Nicht-Dumps unbeanstandet durch", () => {
    expect(expectedDumpLength(E2_MSG.writeComplete)).toBeNull();
    expect(isWellSizedDump(new Uint8Array([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x21, 0xf7]))).toBe(true);
  });

  it("akzeptiert einen echt gebauten Dump in beiden Spielarten", () => {
    const body = new Uint8Array(E2_PATTERN_BODY_SIZE).fill(0x5a);
    const cur = buildCurrentPatternDump(body);
    const slot = buildPatternDump(body, 7);
    expect(cur.length).toBe(18733);
    expect(slot.length).toBe(18735);
    expect(isWellSizedDump(cur)).toBe(true);
    expect(isWellSizedDump(slot)).toBe(true);
    expect(decodeDump(cur)?.body.length).toBe(E2_PATTERN_BODY_SIZE);
    expect(decodeDump(slot)?.index).toBe(7);
  });

  it("verwirft einen abgeschnittenen Dump, statt einen kurzen Body zu liefern", () => {
    const body = new Uint8Array(E2_PATTERN_BODY_SIZE).fill(0x5a);
    const truncated = buildCurrentPatternDump(body).subarray(0, 9000);
    expect(isWellSizedDump(truncated)).toBe(false);
    expect(decodeDump(truncated)).toBeNull();
  });
});

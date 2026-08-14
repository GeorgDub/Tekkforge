/**
 * tests/e2s-slot-numbering.test.ts
 *
 * Sichert die Nummerierungs-Regeln, die sich nur am Gerät belegen lassen — und
 * die TekkForge mehrfach falsch geraten hat, bevor die Minimalbank SLOTNUM.all
 * sie entschieden hat (am Gerät abgelesen, 2026-08-14, danach mit geladenem Set
 * bestätigt: der Part auf #501 spielt das Sample namens „PLATZ 499"):
 *
 *   1. **Anzeige am Gerät = Tabellenindex + 2.** Ein Sample, das als Nummer N
 *      erscheinen soll, gehört auf Tabellenplatz N − 2; `esli.OSC_0index` trägt
 *      die Anzeigenummer N selbst. Messreihe:
 *
 *          Platz 498  →  fiele auf Anzeige 500 — unterhalb der User-Slots, weg
 *          Platz 499  →  Anzeige 501
 *          Platz 500  →  Anzeige 502
 *
 *   2. Pattern-Referenz == Anzeigenummer − 1 (am Gerät gemessen, dreifach
 *      unabhängig belegt). Siehe `e2PatternRefToBankNumber`.
 *
 *   Konsistenz beider Regeln: Ref = N − 1 = Tabellenindex + 1.
 *
 * Diese Fehler sind unsichtbar, solange man nur eine Seite betrachtet: ein
 * kleiner Versatz liefert immer ein plausibles Sample, nur eben das falsche —
 * oder einen leeren ersten Platz.
 */

import { describe, it, expect } from "vitest";
import { buildE2sBank, type E2sSlotInput } from "../src/core/e2sBankBuilder";
import { parseE2sBank } from "../src/core/e2sBankReader";
import {
  bankNumberToE2PatternRef,
  e2PatternRefToBankNumber,
  displayNumberToSlotIndex,
  slotIndexToDisplayNumber,
} from "../src/core/e2sPatternSampleLink";
import {
  E2S_ALL_OFFSET_TABLE_START,
  E2S_ALL_SAMPLE_AREA_START,
  E2S_DISPLAY_SLOT_SHIFT,
  E2S_MAX_SLOTS,
} from "../src/core/constants";

/** Kurzer Sinus, damit jeder Slot echte PCM-Daten hat. */
function tone(frames = 256): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = Math.sin((i / frames) * Math.PI * 2) * 0.5;
  return out;
}

function slot(slotIndex: number, sampleNumber: number): E2sSlotInput {
  return {
    slotIndex,
    sampleNumber,
    name: `S${sampleNumber}`,
    category: 17,
    pcmData: tone(),
    sampleRate: 44100,
    channels: 1,
  };
}

/** Slot für Anzeigenummer N nach der gemessenen Regel: Index N − 2, esli N. */
function displaySlot(n: number): E2sSlotInput {
  return slot(displayNumberToSlotIndex(n), n);
}

describe("Anzeigenummer ↔ Tabellenindex (Anzeige = Index + 2, am Gerät gemessen)", () => {
  it("legt Anzeigenummer N auf Tabellenplatz N − 2", () => {
    expect(E2S_DISPLAY_SLOT_SHIFT).toBe(2);
    expect(displayNumberToSlotIndex(501)).toBe(499);
    expect(displayNumberToSlotIndex(502)).toBe(500);
  });

  it("ist umkehrbar", () => {
    for (let n = 501; n <= 1000; n += 37) {
      expect(slotIndexToDisplayNumber(displayNumberToSlotIndex(n))).toBe(n);
    }
  });

  it("passt zur Pattern-Referenz-Regel: Ref = Anzeige − 1 = Index + 1", () => {
    for (let n = 501; n <= 1000; n += 37) {
      expect(bankNumberToE2PatternRef(n)).toBe(displayNumberToSlotIndex(n) + 1);
    }
  });
});

describe(".all-Geometrie — Tabelle @ 0x0010, 1020 Einträge", () => {
  it("füllt das Fenster bis zur Sample-Area exakt aus", () => {
    expect(E2S_ALL_OFFSET_TABLE_START + E2S_MAX_SLOTS * 4).toBe(
      E2S_ALL_SAMPLE_AREA_START,
    );
  });

  it("legt den Zeiger für Anzeigenummer N auf 0x0010 + (N − 2) * 4", () => {
    const { buffer } = buildE2sBank([displaySlot(501), displaySlot(502)]);
    const dv = new DataView(buffer);
    const at = (i: number) => dv.getUint32(E2S_ALL_OFFSET_TABLE_START + i * 4, true);
    expect(at(499)).toBeGreaterThanOrEqual(E2S_ALL_SAMPLE_AREA_START);
    expect(at(500)).toBeGreaterThan(at(499));
    // Der alte Fehler legte #501 direkt auf Index 501 (bzw. davor auf 500) —
    // dort darf jetzt nichts mehr stehen, sonst erscheint die Bank am Gerät
    // wieder verschoben und Platz 501 bleibt leer.
    expect(at(501)).toBe(0);
    expect(at(0)).toBe(0);
  });
});

describe("Slot-Nummerierungs-Selbstprüfung", () => {
  it("meldet 'ok' für die gemessene Geometrie (esli = Index + 2)", () => {
    const { buffer } = buildE2sBank([
      displaySlot(501),
      displaySlot(502),
      displaySlot(503),
    ]);
    const bank = parseE2sBank(buffer, "ok.all");
    expect(bank.slotNumbering.kind).toBe("ok");
    expect(bank.slotNumbering.filled).toBe(3);
    expect(bank.slotNumbering.affected).toBe(0);
    expect(bank.warnings).toEqual([]);
  });

  it("meldet die alte TekkForge-Geometrie (Index == Nummer) als Versatz 0", () => {
    // Genau der Fehler vor der SLOTNUM-Messung: #501 direkt auf Index 501 —
    // am Gerät erschiene die Bank ab 503, und der Part auf #501 bliebe leer.
    const { buffer } = buildE2sBank([
      slot(501, 501),
      slot(502, 502),
      slot(503, 503),
    ]);
    const bank = parseE2sBank(buffer, "alt-tekkforge.all");
    expect(bank.slotNumbering.kind).toBe("constant-shift");
    expect(bank.slotNumbering.shift).toBe(0);
    expect(bank.slotNumbering.affected).toBe(3);
    expect(bank.warnings.join(" ")).toContain("fehlnummeriert");
  });

  it("meldet die Fremdbank-Geometrie (esli = Index + 1) als Versatz 1", () => {
    // Struktur von luknkicks.all und der Zwischenstände: eins statt zwei.
    const { buffer } = buildE2sBank([slot(500, 501), slot(501, 502)]);
    const bank = parseE2sBank(buffer, "fremd.all");
    expect(bank.slotNumbering.kind).toBe("constant-shift");
    expect(bank.slotNumbering.shift).toBe(1);
    expect(bank.slotNumbering.affected).toBe(2);
  });

  it("unterscheidet einzelne krumme Slots von einem Geometriefehler", () => {
    const { buffer } = buildE2sBank([
      displaySlot(501),
      slot(500, 777),
      displaySlot(503),
    ]);
    const bank = parseE2sBank(buffer, "scattered.all");
    expect(bank.slotNumbering.kind).toBe("scattered");
    expect(bank.slotNumbering.shift).toBeNull();
    expect(bank.slotNumbering.affected).toBe(1);
  });
});

describe("Pattern-Referenz ↔ Anzeigenummer", () => {
  it("bildet die am Gerät gemessene Regel ab (Anzeige == Ref + 1)", () => {
    expect(e2PatternRefToBankNumber(584)).toBe(585);
    expect(bankNumberToE2PatternRef(585)).toBe(584);
  });

  it("lässt 'kein Sample' (0) unangetastet — in beide Richtungen", () => {
    expect(e2PatternRefToBankNumber(0)).toBe(0);
    expect(bankNumberToE2PatternRef(0)).toBe(0);
    // Nummer 1 kann keine gültige Referenz erzeugen (0 wäre "kein
    // Sample", -1 ein Wraparound) — sie wird zu "kein Sample".
    expect(bankNumberToE2PatternRef(1)).toBe(0);
  });

  it("ist für echte User-Sample-Nummern verlustfrei umkehrbar", () => {
    for (let n = 501; n <= 1000; n += 37) {
      expect(e2PatternRefToBankNumber(bankNumberToE2PatternRef(n))).toBe(n);
    }
  });
});

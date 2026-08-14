/**
 * tests/e2s-slot-numbering.test.ts
 *
 * Sichert die Nummerierungs-Regeln, die sich nur am Gerät belegen lassen — und
 * die TekkForge mehrfach falsch geraten hat, bevor die ENTKOPPELTE Minimalbank
 * SLOTNUM2.all sie entschieden hat (am Gerät abgelesen, 2026-08-15):
 *
 *   1. **Anzeige am Gerät = OSC_0index + 1.** Der Tabellenindex ist für die
 *      Anzeige irrelevant — das Gerät zählt nach dem Nummernfeld. Messung
 *      (Index/OSC absichtlich auseinandergezogen):
 *
 *          Index 499, OSC 551  →  Anzeige 552
 *          Index 549, OSC 502  →  Anzeige 503
 *          Index 520, OSC 520  →  Anzeige 521
 *
 *      Die erste SLOTNUM-Messung (OSC = Index + 1 gekoppelt) konnte zwei
 *      Modelle nicht unterscheiden; die vom Gerät selbst geschriebene
 *      e2sSample.all (User-Samples auf Index == OSC == 500..) gab den Anstoß.
 *
 *   2. **Geräte-Konvention beim Schreiben: Tabellenindex == OSC_0index.**
 *      TekkForge baut so und prüft beim Einlesen dagegen (`slotNumbering`).
 *
 *   3. Pattern-Referenz == OSC_0index == Anzeige − 1 (SLOTNUM-Set: Ref 500
 *      spielte den Ton mit OSC 500). Siehe `e2PatternRefToBankNumber`.
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
  displayNumberToOsc,
  displayNumberToSlotIndex,
  oscToDisplayNumber,
  slotIndexToDisplayNumber,
} from "../src/core/e2sPatternSampleLink";
import {
  E2S_ALL_OFFSET_TABLE_START,
  E2S_ALL_SAMPLE_AREA_START,
  E2S_DISPLAY_OSC_SHIFT,
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

/** Slot für Anzeigenummer N nach Geräte-Konvention: Index == OSC == N − 1. */
function displaySlot(n: number): E2sSlotInput {
  return slot(displayNumberToSlotIndex(n), displayNumberToOsc(n));
}

describe("Anzeigenummer ↔ Nummernfeld (Anzeige = OSC + 1, am Gerät gemessen)", () => {
  it("übersetzt Anzeigenummer N in OSC/Index N − 1", () => {
    expect(E2S_DISPLAY_OSC_SHIFT).toBe(1);
    expect(displayNumberToOsc(501)).toBe(500);
    expect(displayNumberToSlotIndex(501)).toBe(500);
    expect(oscToDisplayNumber(500)).toBe(501);
  });

  it("ist umkehrbar", () => {
    for (let n = 501; n <= 1000; n += 37) {
      expect(oscToDisplayNumber(displayNumberToOsc(n))).toBe(n);
      expect(slotIndexToDisplayNumber(displayNumberToSlotIndex(n))).toBe(n);
    }
  });

  it("passt zur Pattern-Referenz-Regel: Ref = Anzeige − 1 = OSC", () => {
    for (let n = 501; n <= 1000; n += 37) {
      expect(bankNumberToE2PatternRef(n)).toBe(displayNumberToOsc(n));
    }
  });
});

describe(".all-Geometrie — Tabelle @ 0x0010, 1020 Einträge", () => {
  it("füllt das Fenster bis zur Sample-Area exakt aus", () => {
    expect(E2S_ALL_OFFSET_TABLE_START + E2S_MAX_SLOTS * 4).toBe(
      E2S_ALL_SAMPLE_AREA_START,
    );
  });

  it("legt den Zeiger für Anzeigenummer N auf 0x0010 + (N − 1) * 4", () => {
    const { buffer } = buildE2sBank([displaySlot(501), displaySlot(502)]);
    const dv = new DataView(buffer);
    const at = (i: number) => dv.getUint32(E2S_ALL_OFFSET_TABLE_START + i * 4, true);
    expect(at(500)).toBeGreaterThanOrEqual(E2S_ALL_SAMPLE_AREA_START);
    expect(at(501)).toBeGreaterThan(at(500));
    // Frühere Fehlbauten legten #501 direkt auf Index 501 bzw. auf 499 —
    // dort darf jetzt nichts (weiteres) Falsches stehen.
    expect(at(499)).toBe(0);
    expect(at(0)).toBe(0);
  });
});

describe("Slot-Nummerierungs-Selbstprüfung (Geräte-Konvention Index == OSC)", () => {
  it("meldet 'ok' für die Geometrie, die das Gerät selbst schreibt", () => {
    // Wie die vom Gerät erzeugte e2sSample.all: Index == OSC == 500..
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

  it("meldet die luknkicks-Struktur (OSC = Index + 1) als Versatz 1", () => {
    // luknkicks.all: Index 500.., OSC 501.. — erscheint am Gerät ab 502,
    // eine Nummer über der vermutlich gemeinten 501.
    const { buffer } = buildE2sBank([slot(500, 501), slot(501, 502)]);
    const bank = parseE2sBank(buffer, "luknkicks-artig.all");
    expect(bank.slotNumbering.kind).toBe("constant-shift");
    expect(bank.slotNumbering.shift).toBe(1);
    expect(bank.slotNumbering.affected).toBe(2);
    // Der Warntext nennt die tatsächliche Anzeige des ersten Samples.
    expect(bank.warnings.join(" ")).toContain("erscheint als 502");
  });

  it("meldet den Minus-zwei-Fehlbau (OSC = Index + 2) als Versatz 2", () => {
    // Der Zwischenstand vom 2026-08-14: Index N−2, OSC N — erschien als N+1.
    const { buffer } = buildE2sBank([slot(499, 501), slot(500, 502)]);
    const bank = parseE2sBank(buffer, "minus-zwei.all");
    expect(bank.slotNumbering.kind).toBe("constant-shift");
    expect(bank.slotNumbering.shift).toBe(2);
    expect(bank.slotNumbering.affected).toBe(2);
  });

  it("unterscheidet einzelne krumme Slots von einem Geometriefehler", () => {
    const { buffer } = buildE2sBank([
      displaySlot(501),
      slot(501, 777),
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

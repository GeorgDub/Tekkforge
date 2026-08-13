/**
 * tests/e2s-slot-numbering.test.ts
 *
 * Sichert die beiden Nummerierungs-Regeln, die sich nur am Gerät bzw. über die
 * Selbstkonsistenz echter Dateien belegen lassen — und die TekkForge bis
 * einschließlich der 0.2.x-Stände beide verletzt hat:
 *
 *   1. `.all`-Tabellen-Index == `esli.OSC_0index` (Geometrie 0x0010/1020).
 *      Belegt über 47 reale Bänke; `parseE2sBank` prüft es selbst und meldet
 *      Abweichungen als `slotNumbering`.
 *
 *   2. Pattern-Referenz == Bank-Nummer − 1 (am Gerät gemessen, dreifach
 *      unabhängig belegt). Siehe `e2PatternRefToBankNumber`.
 *
 * Beide Fehler sind unsichtbar, solange man nur eine Seite betrachtet: ein
 * Versatz von eins liefert immer ein plausibles Sample, nur eben das falsche.
 */

import { describe, it, expect } from "vitest";
import { buildE2sBank, type E2sSlotInput } from "../src/core/e2sBankBuilder";
import { parseE2sBank } from "../src/core/e2sBankReader";
import {
  bankNumberToE2PatternRef,
  e2PatternRefToBankNumber,
} from "../src/core/e2sPatternSampleLink";
import {
  E2S_ALL_OFFSET_TABLE_START,
  E2S_ALL_SAMPLE_AREA_START,
  E2S_MAX_SLOTS,
} from "../src/core/constants";

/** Kurzer Sinus, damit jeder Slot echte PCM-Daten hat. */
function tone(frames = 256): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = Math.sin((i / frames) * Math.PI * 2) * 0.5;
  return out;
}

function slot(slotIndex: number, sampleNumber = slotIndex): E2sSlotInput {
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

describe(".all-Geometrie — Tabelle @ 0x0010, 1020 Einträge", () => {
  it("füllt das Fenster bis zur Sample-Area exakt aus", () => {
    expect(E2S_ALL_OFFSET_TABLE_START + E2S_MAX_SLOTS * 4).toBe(
      E2S_ALL_SAMPLE_AREA_START,
    );
  });

  it("legt den Zeiger eines Samples auf 0x0010 + Geräte-Nummer * 4", () => {
    const { buffer } = buildE2sBank([slot(501), slot(502)]);
    const dv = new DataView(buffer);
    const at = (i: number) => dv.getUint32(E2S_ALL_OFFSET_TABLE_START + i * 4, true);
    expect(at(501)).toBeGreaterThanOrEqual(E2S_ALL_SAMPLE_AREA_START);
    expect(at(502)).toBeGreaterThan(at(501));
    // Der alte (falsche) Tabellenstart 0x07E0 entspricht Index 500 — dort darf
    // jetzt nichts mehr stehen, sonst ist die Bank wieder um eins verschoben.
    expect(at(500)).toBe(0);
    expect(at(0)).toBe(0);
  });
});

describe("Slot-Nummerierungs-Selbstprüfung", () => {
  it("meldet 'ok', wenn jeder Slot seine eigene Nummer trägt", () => {
    const { buffer } = buildE2sBank([slot(501), slot(502), slot(503)]);
    const bank = parseE2sBank(buffer, "ok.all");
    expect(bank.slotNumbering.kind).toBe("ok");
    expect(bank.slotNumbering.filled).toBe(3);
    expect(bank.slotNumbering.affected).toBe(0);
    expect(bank.warnings).toEqual([]);
  });

  it("erkennt eine durchgehend um eins verschobene Bank", () => {
    // Genau der Fehler, den TekkForge vorher gebaut hat: Zeiger auf Index n,
    // Sample nennt sich n+1.
    const { buffer } = buildE2sBank([
      slot(501, 502),
      slot(502, 503),
      slot(503, 504),
    ]);
    const bank = parseE2sBank(buffer, "shifted.all");
    expect(bank.slotNumbering.kind).toBe("constant-shift");
    expect(bank.slotNumbering.shift).toBe(1);
    expect(bank.slotNumbering.affected).toBe(3);
    expect(bank.warnings.join(" ")).toContain("fehlnummeriert");
  });

  it("unterscheidet einzelne krumme Slots von einem Geometriefehler", () => {
    const { buffer } = buildE2sBank([slot(501), slot(502, 777), slot(503)]);
    const bank = parseE2sBank(buffer, "scattered.all");
    expect(bank.slotNumbering.kind).toBe("scattered");
    expect(bank.slotNumbering.shift).toBeNull();
    expect(bank.slotNumbering.affected).toBe(1);
  });
});

describe("Pattern-Referenz ↔ Bank-Nummer", () => {
  it("bildet die am Gerät gemessene Regel ab (Bank == Ref + 1)", () => {
    expect(e2PatternRefToBankNumber(584)).toBe(585);
    expect(bankNumberToE2PatternRef(585)).toBe(584);
  });

  it("lässt 'kein Sample' (0) unangetastet — in beide Richtungen", () => {
    expect(e2PatternRefToBankNumber(0)).toBe(0);
    expect(bankNumberToE2PatternRef(0)).toBe(0);
    // Bank-Nummer 1 kann keine gültige Referenz erzeugen (0 wäre "kein
    // Sample", -1 ein Wraparound) — sie wird zu "kein Sample".
    expect(bankNumberToE2PatternRef(1)).toBe(0);
  });

  it("ist für echte User-Sample-Nummern verlustfrei umkehrbar", () => {
    for (let n = 501; n <= 1000; n += 37) {
      expect(e2PatternRefToBankNumber(bankNumberToE2PatternRef(n))).toBe(n);
    }
  });
});

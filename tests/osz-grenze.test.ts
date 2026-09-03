import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { dateiOffset } from "../src/core/firmwareBau";
import {
  armImmediateAb,
  cmpR0Immediate,
  oszGrenzeWert,
  setzeOszGrenze,
  oszGrenzeSchreibliste,
  OSZ_GRENZE_STELLEN,
  setzeOszTabelle,
  sortiereOszTabelle,
  fmSerieFehlend,
  oszLetzterDspIndex,
} from "../src/core/oszTabelle";

const u32 = (b: Uint8Array, off: number): number => (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;

describe("Oszillator-Grenze — drei cmp r0, #N im Code", () => {
  it("ARM-Immediates: kleinste kodierbare Zahl >= n", () => {
    expect(armImmediateAb(17)).toEqual({ wert: 17, kodiert: 0x011 });
    expect(armImmediateAb(272)).toEqual({ wert: 272, kodiert: 0xe11 }); // 0x11 ror 28
    expect(armImmediateAb(273)?.wert).toBe(276); // 0x45 << 2 = 276 ist die naechste
    expect(armImmediateAb(361)?.wert).toBe(364); // 0x5b << 2
    expect(armImmediateAb(420)?.wert).toBe(420); // 0x69 << 2
    expect(armImmediateAb(255)).toEqual({ wert: 255, kodiert: 0x0ff });
  });

  it("cmp r0, #imm entschluesseln — Hacktribes Wort ist 272", () => {
    expect(cmpR0Immediate(0xe3500e11)).toBe(272);
    expect(cmpR0Immediate(0xe3500011)).toBe(17);
    expect(cmpR0Immediate(0xe1a00000)).toBeNull();
    const w = oszGrenzeWert(361);
    expect(w).not.toBeNull();
    expect(cmpR0Immediate(w!.wort)).toBe(w!.wert);
    expect(w!.wert).toBe(364);
    expect(oszGrenzeWert(5)?.wert).toBe(17); // nie unter Stock
  });

  it("Schreibliste fuers Fluechtige: leer, wenn die Grenze reicht", () => {
    expect(oszGrenzeSchreibliste(272, 272)).toEqual([]);
    expect(oszGrenzeSchreibliste(276, 273)).toEqual([]);
    expect(oszGrenzeSchreibliste(272, 273).map((x) => cmpR0Immediate(x.wert))).toEqual([276, 276, 276]);
    const l = oszGrenzeSchreibliste(272, 361);
    expect(l.map((x) => x.addr)).toEqual([...OSZ_GRENZE_STELLEN]);
    expect(l.every((x) => cmpR0Immediate(x.wert)! >= 361)).toBe(true);
  });

  const VSB = "G:/IdeaProjects/hacktribe/fertige firmwares/SYSTEM.VSB";
  it.skipIf(!fs.existsSync(VSB))("echte Hacktribe-Datei: 272 an allen drei Stellen; letzter DSP-Index 273; 362 Plaetze ziehen sie nach", () => {
    const fw = new Uint8Array(fs.readFileSync(VSB));
    for (const a of OSZ_GRENZE_STELLEN) expect(u32(fw, dateiOffset(a))).toBe(0xe3500e11);
    expect(oszLetzterDspIndex(fw, 274)).toBe(273); // Hacktribes 272 laesst VPM-SINE 32 schon in den Sample-Pfad fallen
    expect(setzeOszGrenze(fw.slice(), 272)).toEqual({ ok: true, befund: null });
    const r = setzeOszGrenze(fw.slice(), 361);
    expect(r.ok && r.befund).toMatchObject({ vorher: 272, nachher: 364, stellen: [...OSZ_GRENZE_STELLEN] });
    // ueber setzeOszTabelle: 88 Varianten + Sortierung → Grenze automatisch nachgezogen
    const neu: { platz: number; bytes: Uint8Array }[] = [];
    let platz = 275;
    for (const v of [35, 62, 89, 116]) {
      const s = fmSerieFehlend(fw, v, 274, neu.map((n) => n.bytes));
      if (s.ok) for (const e of s.eintraege) neu.push({ platz: platz++, bytes: e.bytes });
    }
    const t = setzeOszTabelle(fw, neu);
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.grenze).toMatchObject({ vorher: 272, nachher: 364 });
    for (const a of OSZ_GRENZE_STELLEN) expect(cmpR0Immediate(u32(t.bytes, dateiOffset(a)))).toBe(t.grenze!.nachher);
    // Sortieren danach: Grenze reicht schon, nichts mehr zu tun
    const s = sortiereOszTabelle(t.bytes);
    expect(s.ok).toBe(true);
    // eine fremde Firmware (kein cmp an der Stelle) wird abgelehnt
    const fremd = fw.slice();
    fremd.set([0, 0, 0, 0], dateiOffset(OSZ_GRENZE_STELLEN[1]));
    expect(setzeOszGrenze(fremd, 361)).toMatchObject({ ok: false, reason: expect.stringMatching(/fremde Firmware/) });
  });
});

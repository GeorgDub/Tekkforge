import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { dateiOffset } from "../src/core/firmwareBau";
import {
  armImmediateKodieren,
  armImmediateWert,
  modGrenzeWert,
  liesModGrenze,
  setzeModGrenze,
  modGrenzeSchreibliste,
  modFeldInhalt,
  liesModTabelle,
  modKombinationen,
  setzeModTabelle,
  MOD_GRENZE_VERGLEICHE,
  MOD_GRENZE_SCHRITTE,
  MOD_GRENZE_BLOECKE,
  MOD_FELD_ZEIGER,
  MOD_FELD_BASIS_STOCK,
  MOD_FELD_BASIS_NEU,
  MOD_FELD_PARTS,
} from "../src/core/modTabelle";

const u32 = (b: Uint8Array, off: number): number => (b[off] | (b[off + 1] << 8) | (b[off + 2] << 16) | (b[off + 3] << 24)) >>> 0;

describe("Mod-Grenze — ARM-Immediates", () => {
  it("kodieren und lesen sind Umkehrungen; 257 gibt es nicht", () => {
    for (const v of [0, 71, 72, 131, 132, 144, 255, 264, 272, 0x108, 0xff000000]) {
      const k = armImmediateKodieren(v);
      expect(k, `Wert ${v}`).not.toBeNull();
      expect(armImmediateWert(0xe3500000 | k!)).toBe(v);
    }
    expect(armImmediateKodieren(257)).toBeNull();
    expect(armImmediateKodieren(0x102)).toBeNull();
    expect(armImmediateWert(0xe1a00000)).toBeNull(); // mov r0, r0 — kein Immediate
    expect(armImmediateWert(0xe5d30010)).toBeNull(); // ldrb
  });

  it("die Woerter der Stellen sind das, was Hacktribe dort hat: 71, 72, 144", () => {
    for (const s of MOD_GRENZE_VERGLEICHE) expect(armImmediateWert(s.wort)).toBe(71);
    for (const s of MOD_GRENZE_SCHRITTE) expect(armImmediateWert(s.wort)).toBe(72);
    for (const s of MOD_GRENZE_BLOECKE) expect(armImmediateWert(s.wort)).toBe(144);
    expect(MOD_GRENZE_VERGLEICHE.length + MOD_GRENZE_SCHRITTE.length + MOD_GRENZE_BLOECKE.length + MOD_FELD_ZEIGER.length).toBe(25);
  });

  it("modGrenzeWert: kleinstes N, bei dem N-1, N und 2N kodierbar sind", () => {
    expect(modGrenzeWert(71)?.n).toBe(72);
    expect(modGrenzeWert(0)?.n).toBe(72);
    expect(modGrenzeWert(95)?.n).toBe(96);
    expect(modGrenzeWert(131)?.n).toBe(132); // 131, 132, 264 = 0x42 << 2
    expect(modGrenzeWert(128)?.n).toBe(130); // 258 = 0x102 ist nicht kodierbar (ungerade Rotation), 260 = 0x41 << 2 schon
    expect(modGrenzeWert(255)?.n).toBe(256);
    expect(modGrenzeWert(256)).toBeNull();
  });

  it("modFeldInhalt: 16 Parts, je Typ Speed/Depth aus +0x16/+0x17", () => {
    const t = [new Uint8Array(0x58), new Uint8Array(0x58)];
    t[0][0x16] = 11;
    t[0][0x17] = 22;
    t[1][0x16] = 33;
    t[1][0x17] = 44;
    const f = modFeldInhalt(t, 3);
    expect(f.length).toBe(MOD_FELD_PARTS * 6);
    expect([...f.slice(0, 6)]).toEqual([11, 22, 33, 44, 0, 0]);
    expect([...f.slice(15 * 6, 16 * 6)]).toEqual([11, 22, 33, 44, 0, 0]);
  });

  it("Schreibliste: leer, wenn die Grenze reicht; sonst 25 Woerter und das Feld", () => {
    const leer = modGrenzeSchreibliste({ maxIndex: 131, feldBasis: MOD_FELD_BASIS_NEU }, 100, []);
    expect(leer).toEqual({ woerter: [], feld: null, nachher: 131 });
    const l = modGrenzeSchreibliste({ maxIndex: 71, feldBasis: MOD_FELD_BASIS_STOCK }, 131, []);
    if ("ok" in l) throw new Error(l.reason);
    expect(l.woerter.length).toBe(25);
    expect(l.nachher).toBe(131);
    expect(l.feld).toMatchObject({ addr: MOD_FELD_BASIS_NEU });
    expect(l.feld!.bytes.length).toBe(16 * 2 * 132);
    for (const w of l.woerter.slice(0, 9)) expect(armImmediateWert(w.wert)).toBe(131);
    for (const w of l.woerter.slice(9, 14)) expect(armImmediateWert(w.wert)).toBe(132);
    for (const w of l.woerter.slice(14, 18)) expect(armImmediateWert(w.wert)).toBe(264);
    for (const w of l.woerter.slice(18)) expect(w.wert).toBe(MOD_FELD_BASIS_NEU);
    // Bedingung und Register bleiben (cmple r1 bleibt cmple r1)
    expect((l.woerter[5].wert & 0xfffff000) >>> 0).toBe(0xd3510000);
  });

  const VSB = "G:/IdeaProjects/hacktribe/fertige firmwares/SYSTEM.VSB";
  it.skipIf(!fs.existsSync(VSB))("echte Hacktribe-Datei: 71 an allen Stellen, Feld im BSS; 132 Typen ziehen alles nach", () => {
    const fw = new Uint8Array(fs.readFileSync(VSB));
    const st = liesModGrenze(fw);
    expect(st).toEqual({ ok: true, stand: { maxIndex: 71, feldBasis: MOD_FELD_BASIS_STOCK } });
    expect(setzeModGrenze(fw.slice(), 71)).toEqual({ ok: true, befund: null });
    const out = fw.slice();
    const r = setzeModGrenze(out, 131);
    expect(r).toEqual({ ok: true, befund: { vorher: 71, nachher: 131, feldBasis: MOD_FELD_BASIS_NEU, feldBytes: 16 * 2 * 132 } });
    expect(liesModGrenze(out)).toEqual({ ok: true, stand: { maxIndex: 131, feldBasis: MOD_FELD_BASIS_NEU } });
    for (const s of MOD_GRENZE_VERGLEICHE) expect(u32(out, dateiOffset(s.addr))).toBe(((s.wort & 0xfffff000) | 0x083) >>> 0);
    for (const s of MOD_GRENZE_SCHRITTE) expect(u32(out, dateiOffset(s.addr))).toBe(((s.wort & 0xfffff000) | 0x084) >>> 0);
    for (const s of MOD_GRENZE_BLOECKE) expect(u32(out, dateiOffset(s.addr))).toBe(((s.wort & 0xfffff000) | 0xf42) >>> 0); // 0x42 ror 30 = 0x108
    for (const a of MOD_FELD_ZEIGER) expect(u32(out, dateiOffset(a))).toBe(MOD_FELD_BASIS_NEU);
    // Feld: Part 0 traegt die Vorgaben der 96 Hacktribe-Typen, dahinter Nullen; Part 15 identisch
    const t = liesModTabelle(fw);
    const feld = out.slice(dateiOffset(MOD_FELD_BASIS_NEU), dateiOffset(MOD_FELD_BASIS_NEU) + 16 * 264);
    expect(feld[0]).toBe(t[0][0x16]);
    expect(feld[1]).toBe(t[0][0x17]);
    expect(feld[95 * 2]).toBe(t[95][0x16]);
    expect(feld[96 * 2]).toBe(0);
    expect([...feld.slice(15 * 264, 16 * 264)]).toEqual([...feld.slice(0, 264)]);
    // ausserhalb der 25 Stellen und des Feldes ist nichts angefasst
    let anders = 0;
    for (let i = 0; i < fw.length; i++) if (fw[i] !== out[i]) anders++;
    expect(anders).toBeLessThanOrEqual(25 * 4 + 16 * 264);
    // noch einmal reicht: nichts zu tun; eine hoehere Grenze verlegt das Feld nicht erneut
    expect(setzeModGrenze(out.slice(), 131)).toEqual({ ok: true, befund: null });
    const r2 = setzeModGrenze(out.slice(), 200);
    // 402 = 0x192 ist nicht kodierbar → naechstes N mit N-1, N, 2N kodierbar ist 202, also Index 201
    expect(r2).toMatchObject({ ok: true, befund: { vorher: 131, nachher: 201, feldBasis: MOD_FELD_BASIS_NEU } });
    // fremde Firmware (ein Wort verbogen) wird abgelehnt
    const fremd = fw.slice();
    fremd.set([0, 0, 0, 0], dateiOffset(MOD_GRENZE_SCHRITTE[2].addr));
    expect(setzeModGrenze(fremd, 131)).toMatchObject({ ok: false, reason: expect.stringMatching(/fremde Firmware/) });
    // ueber setzeModTabelle: 36 Kombinationen → Grenze automatisch 131
    const k = modKombinationen(t);
    expect(k.eintraege.length).toBe(36);
    const m = setzeModTabelle(fw, k.eintraege.map((e, i) => ({ platz: t.length + i, bytes: e.bytes })));
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.anzahlNachher).toBe(132);
    expect(m.grenze).toMatchObject({ vorher: 71, nachher: 131 });
    expect(liesModGrenze(m.bytes)).toEqual({ ok: true, stand: { maxIndex: 131, feldBasis: MOD_FELD_BASIS_NEU } });
    // das Feld traegt jetzt auch die Vorgaben der 36 neuen Typen
    const f2 = m.bytes.slice(dateiOffset(MOD_FELD_BASIS_NEU), dateiOffset(MOD_FELD_BASIS_NEU) + 264);
    expect(f2[96 * 2]).toBe(k.eintraege[0].bytes[0x16]);
    expect(f2[131 * 2 + 1]).toBe(k.eintraege[35].bytes[0x17]);
    // Auch ohne neue Eintraege: Hacktribes 96 Typen liegen schon ueber der Grenze 72 —
    // die 24 Sinus-Typen unterliegen derselben Klemme. Die Tabelle wird abgedeckt (95).
    const m0 = setzeModTabelle(fw, []);
    expect(m0.ok && m0.grenze).toMatchObject({ vorher: 71, nachher: 95, feldBytes: 16 * 2 * 96 });
  });
});

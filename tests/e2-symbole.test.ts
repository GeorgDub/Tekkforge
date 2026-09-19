/**
 * tests/e2-symbole.test.ts — benannte RAM-Adressen der Sampler-Firmware (aus dem
 * Ghidra-Export vanasoft23/electribe2-re, HACKTRIBE.bin) und ihre Dekoder.
 *
 * Die Adressen gelten für das Sampler-Layout (Stock 2.02, Hacktribe, TekkForge-Builds —
 * Hacktribe patcht in-place). Die Dekoder arbeiten auf Byte-Fenstern, die das RAM-Panel
 * per 0x52 liest; hier werden sie mit synthetischen Fenstern geprüft.
 */
import { describe, it, expect } from "vitest";
import {
  E2_SYMBOLE,
  symbolFuer,
  STIMMEN,
  BATTERIE,
  SAMPLE_LAUFZEIT,
  dekodiereStimmen,
  dekodiereBatterie,
  dekodiereSampleStand,
} from "../src/core/e2Symbole";
import { validateRamRange } from "../src/core/hacktribeRam";

describe("Symboltabelle", () => {
  it("alle Symbole liegen im DDR2 und haben Quelle + Größe", () => {
    expect(E2_SYMBOLE.length).toBeGreaterThan(8);
    for (const s of E2_SYMBOLE) {
      expect(validateRamRange(s.addr, s.size).ok, s.key).toBe(true);
      expect(s.quelle).toMatch(/electribe2-re/);
      expect(s.label.length).toBeGreaterThan(3);
    }
    expect(new Set(E2_SYMBOLE.map((s) => s.key)).size).toBe(E2_SYMBOLE.length);
  });
  it("die Kernadressen stehen fest", () => {
    expect(STIMMEN.maske).toBe(0xc06914ec);
    expect(STIMMEN.slots).toBe(0xc06916a0);
    expect(STIMMEN.slotGroesse).toBe(0x48);
    expect(STIMMEN.anzahl).toBe(24);
    expect(STIMMEN.noten).toBe(0xc0691486);
    expect(STIMMEN.release).toBe(0xc069143b);
    expect(SAMPLE_LAUFZEIT.base).toBe(0xc036ad88);
    expect(SAMPLE_LAUFZEIT.stride).toBe(0x45c);
    expect(symbolFuer("oszLaufzeit")?.addr).toBe(0xc047b08c);
    expect(symbolFuer("gibtEsNicht")).toBeUndefined();
  });
  it("Batterie: Zeigervariable aus der Zeigerzelle 0xC003A858 des Sampler-Abbilds", () => {
    expect(BATTERIE.zeigerVariable).toBe(0xc03405c8);
    expect(BATTERIE.fensterOffset).toBe(0x318);
    expect(BATTERIE.fensterGroesse).toBe(0x18);
    expect(BATTERIE.schwellenNiMh).toBe(0xc00e4594);
    expect(BATTERIE.schwellenAlkali).toBe(0xc00e4590);
  });
});

const setzeZeiger = (b: Uint8Array, off: number, v: number): void => {
  b[off] = v & 0xff;
  b[off + 1] = (v >>> 8) & 0xff;
  b[off + 2] = (v >>> 16) & 0xff;
  b[off + 3] = (v >>> 24) & 0xff;
};

describe("dekodiereStimmen", () => {
  it("liest Maske, Besitzer-Part, DSP-Slot, Oszillator-ID, Note und Release-Zustand", () => {
    const slots = new Uint8Array(24 * 0x48);
    const noten = new Uint8Array(24);
    const release = new Uint8Array(24);
    // Slot 3: Part 5 (owner_voice = Zeiger auf voice_t Nr. 5), DSP-Slot 3, Osz 0x1f5 (= 501), Note 60 gedrückt.
    setzeZeiger(slots, 3 * 0x48 + 0x04, STIMMEN.voiceTabelle + 5 * STIMMEN.voiceGroesse);
    slots[3 * 0x48 + 0x14] = 3;
    slots[3 * 0x48 + 0x3a] = 0xf5;
    slots[3 * 0x48 + 0x3b] = 0x01;
    noten[3] = 0x80 | 60;
    // Slot 7: losgelassen, One-Shot-Release.
    setzeZeiger(slots, 7 * 0x48 + 0x04, STIMMEN.voiceTabelle + 2 * STIMMEN.voiceGroesse);
    slots[7 * 0x48 + 0x3a] = 7;
    noten[7] = 48;
    release[7] = 0x02;
    const maske = (1 << 3) | (1 << 7);
    const r = dekodiereStimmen(maske, slots, noten, release);
    expect(r.length).toBe(24);
    expect(r[3]).toMatchObject({ slot: 3, aktiv: true, part: 5, dspSlot: 3, oszId: 501, note: 60, gedrueckt: true, release: "keine", inBenutzung: true });
    expect(r[7]).toMatchObject({ slot: 7, aktiv: true, part: 2, oszId: 7, note: 48, gedrueckt: false, release: "oneshot", inBenutzung: true });
    expect(r[0]).toMatchObject({ aktiv: false, inBenutzung: false, release: "keine", part: null });
    expect(r.filter((x) => x.aktiv).length).toBe(2);
  });
  it("Release-Bit 0 = normal, Bit 1 = One-Shot; Sign-Bit der Note = gedrückt", () => {
    const slots = new Uint8Array(24 * 0x48);
    const noten = new Uint8Array(24);
    const release = new Uint8Array(24);
    release[1] = 0x01;
    noten[2] = 0x80 | 127;
    const r = dekodiereStimmen(0, slots, noten, release);
    expect(r[1].release).toBe("normal");
    expect(r[1].inBenutzung).toBe(true);
    expect(r[2]).toMatchObject({ note: 127, gedrueckt: true, inBenutzung: true });
  });
  it("lehnt falsch große Fenster ab", () => {
    expect(() => dekodiereStimmen(0, new Uint8Array(10), new Uint8Array(24), new Uint8Array(24))).toThrow();
  });
});

describe("dekodiereBatterie", () => {
  it("Fenster ab +0x318: Schwellen-Zeiger, Rohwert i32 @+8, Chemie @+0xC, Stufe u32 @+0x10; Update ab Stufe 2", () => {
    const f = new Uint8Array(0x18);
    setzeZeiger(f, 0, BATTERIE.schwellenNiMh);
    f[4] = 1;
    f.set([0x8a, 0, 0, 0], 8);
    f[0xc] = 0;
    f.set([3, 0, 0, 0], 0x10);
    const b = dekodiereBatterie(f);
    expect(b).toEqual({ schwellen: [134, 129, 124, 97], roh: 0x8a, stufe: 3, chemie: "Ni-MH", updateErlaubt: true, plausibel: true, latch: false });
    f.set([1, 0, 0, 0], 0x10);
    setzeZeiger(f, 0, BATTERIE.schwellenAlkali);
    f[0xc] = 1;
    f[0x14] = 1;
    const c = dekodiereBatterie(f);
    expect(c.updateErlaubt).toBe(false);
    expect(c.chemie).toBe("Alkali");
    expect(c.schwellen).toEqual([127, 110, 104, 97]);
    expect(c.latch).toBe(true);
  });
  it("unplausible Werte (Stufe > 4, fremder Schwellen-Zeiger) werden markiert — z. B. Client noch nicht angelegt", () => {
    const b = dekodiereBatterie(new Uint8Array(0x18));
    expect(b.plausibel).toBe(false);
    expect(b.chemie).toBe("?");
    expect(b.schwellen).toEqual([]);
  });
});

describe("dekodiereSampleStand", () => {
  it("zählt geladene Laufzeit-Samples und liest Länge/Rate", () => {
    const n = 3;
    const rec = new Uint8Array(n * 0x45c);
    // Record 1 geladen: Länge 0x1000 Bytes, Rate 44100.
    rec[1 * 0x45c + 0x0b] = 1;
    rec.set([0x00, 0x10, 0, 0], 1 * 0x45c + 0x04);
    rec.set([0x44, 0xac, 0, 0], 1 * 0x45c + 0x10);
    const r = dekodiereSampleStand(rec, n, 500);
    expect(r.length).toBe(3);
    expect(r[1]).toEqual({ index: 501, anzeige: 502, geladen: true, laengeBytes: 0x1000, rate: 44100, stereoRolle: 0 });
    expect(r.filter((x) => x.geladen).length).toBe(1);
  });
});

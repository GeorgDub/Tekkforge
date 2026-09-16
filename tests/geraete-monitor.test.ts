/**
 * tests/geraete-monitor.test.ts — der Geräte-Monitor gegen einen nachgebauten RAM-Lesepfad.
 * Es gibt kein Gerät im Test; geprüft wird, dass die richtigen Fenster gelesen, die Zeiger
 * verfolgt und Fehler pro Baustein gemeldet werden (nicht als Ganzes abgebrochen).
 */
import { describe, it, expect } from "vitest";
import { liesMonitor, liesSampleStand, monitorText, sampleStandText, type Lesen } from "../src/core/geraeteMonitor";
import { STIMMEN, BATTERIE, SAMPLE_LAUFZEIT } from "../src/core/e2Symbole";

/** Ein flacher DDR2-Nachbau aus Adressfenstern. */
function ram(fenster: Record<number, Uint8Array>): Lesen {
  return async (addr, len) => {
    for (const [a, b] of Object.entries(fenster)) {
      const base = Number(a);
      if (addr >= base && addr + len <= base + b.length) return { ok: true, bytes: b.slice(addr - base, addr - base + len) };
    }
    return { ok: false, reason: `kein Fenster für 0x${addr.toString(16)}/${len}` };
  };
}
const le32 = (v: number): Uint8Array => Uint8Array.from([v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff]);

describe("liesMonitor", () => {
  it("liest Maske, Generation, Slots, verfolgt den Batterie-Zeiger zweistufig", async () => {
    const slots = new Uint8Array(24 * 0x48);
    slots.set(le32(STIMMEN.voiceTabelle + 3 * 0x148), 0 * 0x48 + 4);
    slots[0 * 0x48 + 0x3a] = 0x0a; // Osz-ID 10 → Nummer 11
    const noten = new Uint8Array(24);
    noten[0] = 0x80 | 36;
    const client = 0xc0700000;
    const fenster = new Uint8Array(0x18);
    fenster.set(le32(BATTERIE.schwellenNiMh), 0);
    fenster[4] = 1;
    fenster.set(le32(120), 8);
    fenster.set(le32(1), 0x10);
    const lesen = ram({
      [STIMMEN.maske]: le32(1),
      [STIMMEN.generation]: Uint8Array.from([0x34, 0x12]),
      [STIMMEN.slots]: slots,
      [STIMMEN.noten]: noten,
      [STIMMEN.release]: new Uint8Array(24),
      [BATTERIE.zeigerVariable]: le32(client),
      [client + BATTERIE.fensterOffset]: fenster,
    });
    const b = await liesMonitor(lesen);
    expect(b.fehler).toEqual([]);
    expect(b.maske).toBe(1);
    expect(b.generation).toBe(0x1234);
    expect(b.stimmen[0]).toMatchObject({ aktiv: true, part: 3, oszId: 10, note: 36, gedrueckt: true });
    expect(b.batterie).toMatchObject({ stufe: 1, roh: 120, chemie: "Ni-MH", updateErlaubt: false });
    const text = monitorText(b, (n) => `OSZ${n}`);
    expect(text).toMatch(/1\/24 am DSP aktiv/);
    expect(text).toMatch(/OSZ11/);
    expect(text).toMatch(/Part\s+DSP/);
    expect(text).toMatch(/SD-Update würde das Gerät verweigern/);
  });
  it("Null-Zeiger → Hinweis statt Fehler; fehlendes Fenster → Fehler nur für diesen Baustein", async () => {
    const lesen = ram({
      [STIMMEN.maske]: le32(0),
      [STIMMEN.generation]: new Uint8Array(2),
      [STIMMEN.slots]: new Uint8Array(24 * 0x48),
      [STIMMEN.noten]: new Uint8Array(24),
      [STIMMEN.release]: new Uint8Array(24),
      [BATTERIE.zeigerVariable]: le32(0),
    });
    const b = await liesMonitor(lesen);
    expect(b.batterie).toBeNull();
    expect(b.batterieHinweis).toMatch(/nicht angelegt/);
    expect(b.fehler).toEqual([]);
    expect(monitorText(b, String)).toMatch(/kein Slot belegt/);

    const b2 = await liesMonitor(ram({ [STIMMEN.maske]: le32(0) }));
    expect(b2.fehler.length).toBeGreaterThan(0);
    expect(b2.stimmen).toEqual([]);
  });
  it("Zeiger außerhalb des DDR2 (Synth-Layout) wird als Layout-Problem gemeldet", async () => {
    const lesen = ram({
      [STIMMEN.maske]: le32(0),
      [STIMMEN.generation]: new Uint8Array(2),
      [STIMMEN.slots]: new Uint8Array(24 * 0x48),
      [STIMMEN.noten]: new Uint8Array(24),
      [STIMMEN.release]: new Uint8Array(24),
      [BATTERIE.zeigerVariable]: le32(0x80001000),
    });
    const b = await liesMonitor(lesen);
    expect(b.batterieHinweis).toMatch(/nicht in den DDR2/);
  });
});

describe("liesSampleStand", () => {
  it("liest ab Index 500 die Records und zählt geladene", async () => {
    const rec = new Uint8Array(4 * SAMPLE_LAUFZEIT.stride);
    rec[2 * SAMPLE_LAUFZEIT.stride + 0x0b] = 1;
    rec.set(le32(88200), 2 * SAMPLE_LAUFZEIT.stride + 4);
    rec.set(le32(44100), 2 * SAMPLE_LAUFZEIT.stride + 0x10);
    const lesen = ram({ [SAMPLE_LAUFZEIT.base + 500 * SAMPLE_LAUFZEIT.stride]: rec });
    const r = await liesSampleStand(lesen, 500, 4);
    expect(r.fehler).toBeUndefined();
    expect(r.stand.map((s) => s.anzeige)).toEqual([501, 502, 503, 504]);
    expect(r.stand[2]).toMatchObject({ geladen: true, laengeBytes: 88200, rate: 44100 });
    expect(sampleStandText(r.stand)).toMatch(/501–504: 1 geladen/);
    expect(sampleStandText(r.stand)).toMatch(/503\s+88200 Bytes\s+44100 Hz/);
  });
  it("klemmt ans Katalogende und meldet Lesefehler", async () => {
    const r = await liesSampleStand(ram({}), 998, 10);
    expect(r.fehler).toBeDefined();
    const r2 = await liesSampleStand(ram({}), 999, 1);
    expect(r2.fehler).toMatch(/außerhalb/);
  });
});

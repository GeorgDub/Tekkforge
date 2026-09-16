/**
 * tests/global-flash.test.ts — Global-Blöcke (0x230000 gespeichert, 0x630000 Werk) und SQEZ-Kopf
 * aus dem Flash: synthetisch, und gegen den echten Gerätedump, wenn er lokal liegt.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { GLOBAL_FLASH, dekodiereGlobal, vergleicheGlobal, globalAusDump, globalBerichtZeilen, liesSqezKopf, globalKurz } from "../src/core/globalFlash";
import { E2_GLOBAL_CLOCK_SOURCE_OFF, E2_GLOBAL_MIDI_CHANNEL_OFF, E2_GLOBAL_CHAIN_MODE_OFF, E2_GLOBAL_LCD_CONTRAST_OFF } from "../src/core/e2sysex";
import { FLASH_GROESSE } from "../src/core/flashKarte";
import { berichtFlashDump } from "../src/core/bootBericht";
import { liesFlashDump } from "../src/core/flashKarte";

const asc = (b: Uint8Array, off: number, s: string): void => {
  for (let i = 0; i < s.length; i++) b[off + i] = s.charCodeAt(i);
};
function globalBlock(): Uint8Array {
  const g = new Uint8Array(0x100);
  asc(g, 0, "GLST");
  asc(g, 0xfc, "GLED");
  g[E2_GLOBAL_CLOCK_SOURCE_OFF] = 1;
  g[E2_GLOBAL_MIDI_CHANNEL_OFF] = 0;
  g[E2_GLOBAL_LCD_CONTRAST_OFF] = 34;
  return g;
}

describe("dekodiereGlobal / vergleicheGlobal", () => {
  it("benennt die gemessenen Felder und meldet fehlende Marken", () => {
    const g = dekodiereGlobal(globalBlock());
    expect(g.ok).toBe(true);
    const f = Object.fromEntries(g.felder.map((x) => [x.name, x.anzeige]));
    expect(f["Clock-Quelle"]).toBe("auto");
    expect(f["MIDI-Kanal"]).toBe("1");
    expect(f["LCD-Kontrast"]).toBe("17");
    expect(f["Chain Mode"]).toBe("off");
    expect(globalKurz(globalBlock())).toMatch(/MIDI-Kanal 1, Clock-Quelle auto, Chain Mode off/);
    const ohne = globalBlock();
    asc(ohne, 0xfc, "XXXX");
    expect(dekodiereGlobal(ohne).grund).toMatch(/GLED/);
    expect(dekodiereGlobal(new Uint8Array(0x100)).grund).toMatch(/GLST/);
  });
  it("vergleicht byteweise und benennt bekannte Felder", () => {
    const a = globalBlock();
    const b = globalBlock();
    b[E2_GLOBAL_CHAIN_MODE_OFF] = 1;
    b[0x7d] = 64;
    const u = vergleicheGlobal(a, b);
    expect(u.map((x) => [x.off, x.name, x.anzeigeA, x.anzeigeB])).toEqual([
      [E2_GLOBAL_CHAIN_MODE_OFF, "Chain Mode", "off", "on"],
      [0x7d, null, "0x00", "0x40"],
    ]);
  });
});

describe("globalAusDump + SQEZ", () => {
  it("liest beide Blöcke und den SQEZ-Kopf; der Dump-Bericht nennt sie", () => {
    const d = new Uint8Array(FLASH_GROESSE).fill(0xff);
    d.set(globalBlock(), GLOBAL_FLASH.gespeichert);
    const w = globalBlock();
    w[E2_GLOBAL_CLOCK_SOURCE_OFF] = 0;
    d.set(w, GLOBAL_FLASH.werk);
    asc(d, GLOBAL_FLASH.sqez, "SQEZ");
    d[GLOBAL_FLASH.sqez + 4] = 9;
    d[GLOBAL_FLASH.sqez + 5] = 0;
    d[GLOBAL_FLASH.sqez + 6] = 2;
    d[GLOBAL_FLASH.sqez + 7] = 0;
    d[GLOBAL_FLASH.sqez + 8] = 0x00;
    d[GLOBAL_FLASH.sqez + 9] = 0x80;
    d[GLOBAL_FLASH.sqez + 10] = 0x3e;
    d[GLOBAL_FLASH.sqez + 11] = 0x00;
    const g = globalAusDump(d);
    expect(g.gespeichert).not.toBeNull();
    expect(g.werk).not.toBeNull();
    expect(g.sqez).toEqual({ ok: true, version: 9, kennung: 2, entpackt: 0x3e8000 });
    const z = globalBerichtZeilen(g).join("\n");
    expect(z).toMatch(/Global gespeichert \(0x230000\): .*Clock-Quelle auto/);
    expect(z).toMatch(/Werks-Global \(0x630000\) weicht in 1 Byte\(s\) ab: Clock-Quelle internal → auto/);
    expect(z).toMatch(/250 × 0x4000/);
    const r = liesFlashDump(d);
    expect(r.ok).toBe(true);
    if (r.ok) expect(berichtFlashDump(r).join("\n")).toMatch(/Global gespeichert/);
    expect(liesSqezKopf(new Uint8Array(16)).ok).toBe(false);
    const leer = globalAusDump(new Uint8Array(FLASH_GROESSE).fill(0xff));
    expect(leer).toEqual({ gespeichert: null, werk: null, sqez: null });
  });
});

describe("Global im echten Gerätedump (nur wenn er lokal liegt)", () => {
  const pfad = "G:/Downloads/TekkForge/Firmware/Flash-vom-Geraet-2026-09-16.bin";
  it.skipIf(!existsSync(pfad))("beide Blöcke da, drei Bytes verschieden, SQEZ entpackt 250 × 0x4000", () => {
    const g = globalAusDump(new Uint8Array(readFileSync(pfad)));
    expect(g.gespeichert && g.werk).toBeTruthy();
    if (!g.gespeichert || !g.werk) return;
    expect(dekodiereGlobal(g.gespeichert).ok).toBe(true);
    const u = vergleicheGlobal(g.gespeichert, g.werk);
    expect(u.map((x) => x.off)).toEqual([0x14, 0x28, 0x7d]);
    expect(g.sqez?.entpackt).toBe(250 * 0x4000);
  });
});

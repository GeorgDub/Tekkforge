/**
 * tests/flash-patternbank.test.ts — die Pattern-Bank des Geräts aus dem Flash-Dump als .e2sallpat.
 * Synthetisch (GLST + PTST-Records) und, wenn der echte Dump lokal liegt, gegen den Parser der App.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { FLASH_GROESSE, PATTERN_BANK, patternBankAusDump, patternNamenAusDump, liesFlashDump } from "../src/core/flashKarte";
import { berichtFlashDump } from "../src/core/bootBericht";
import { isElectribeAllPatBank, parseElectribeAllPatBank, ELECTRIBE_ALLPAT_EXPECTED_SIZE } from "../src/core/electribeImport";

const asc = (b: Uint8Array, off: number, s: string): void => {
  for (let i = 0; i < s.length; i++) b[off + i] = s.charCodeAt(i);
};

function dumpMitBank(): Uint8Array {
  const d = new Uint8Array(FLASH_GROESSE).fill(0xff);
  asc(d, PATTERN_BANK.glst, "GLST");
  d[PATTERN_BANK.glst + 4] = 0;
  d[PATTERN_BANK.glst + 5] = 1;
  d.fill(0, PATTERN_BANK.glst + 8, PATTERN_BANK.glst + 0x200);
  asc(d, PATTERN_BANK.glst + 0x1fc, "GLED");
  for (let i = 0; i < 3; i++) {
    const p = PATTERN_BANK.patterns + i * PATTERN_BANK.stride;
    d.fill(0, p, p + PATTERN_BANK.stride);
    asc(d, p, "PTST");
    asc(d, p + 0x10, `PAT ${i + 1}`);
    d[p + 0x22] = 0x9c; // 140.0 BPM × 10 = 1400 = 0x0578? nein: Test prüft nur Namen
  }
  return d;
}

describe("patternBankAusDump", () => {
  it("baut eine .e2sallpat in Originalgröße mit Kopf, GLST-Block und den Records", () => {
    const d = dumpMitBank();
    const bank = patternBankAusDump(d);
    expect(bank.length).toBe(ELECTRIBE_ALLPAT_EXPECTED_SIZE);
    expect(isElectribeAllPatBank(bank)).toBe(true);
    expect(String.fromCharCode(...bank.subarray(0x100, 0x104))).toBe("GLST");
    expect(String.fromCharCode(...bank.subarray(0x10100, 0x10104))).toBe("PTST");
    expect(bank[0x20]).toBe(1);
    expect(bank[0x24]).toBe(0xff);
    expect(bank[0xff]).toBe(0xff);
    const namen = patternNamenAusDump(d);
    expect(namen.slice(0, 4)).toEqual(["PAT 1", "PAT 2", "PAT 3", ""]);
  });
  it("ohne GLST wird abgelehnt; der Bericht nennt die Pattern-Bank", () => {
    const d = new Uint8Array(FLASH_GROESSE).fill(0xff);
    expect(() => patternBankAusDump(d)).toThrow(/GLST/);
    const r = liesFlashDump(dumpMitBank());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(berichtFlashDump(r).join("\n")).toMatch(/Pattern-Bank: 3 von 250 Slots/);
    expect(r.regionen.find((x) => x.selektor === 0x24)?.befund).toMatch(/3 Patterns mit PTST/);
  });
});

describe("Pattern-Bank aus dem echten Gerätedump (nur wenn er lokal liegt)", () => {
  const pfad = "G:/Downloads/TekkForge/Firmware/Flash-vom-Geraet-2026-09-16.bin";
  it.skipIf(!existsSync(pfad))("250 Records, Namen wie am Gerät, der App-Parser liest die Bank", () => {
    const d = new Uint8Array(readFileSync(pfad));
    const namen = patternNamenAusDump(d);
    expect(namen.length).toBe(250);
    expect(namen[0]).toBe("Mfmt Pattern");
    expect(namen[1]).toBe("Advi$ory2");
    const bank = patternBankAusDump(d);
    const parsed = parseElectribeAllPatBank(bank);
    expect(parsed.patterns.length).toBeGreaterThan(200);
    expect(parsed.patterns[0].name.trim()).toBe("Mfmt Pattern");
  });
});

describe("liesPatternBankVomGeraet", () => {
  it("liest nur das 4-MiB-Stück ab 0x230000 und liefert die Bank samt Namen", async () => {
    const { liesPatternBankVomGeraet } = await import("../src/core/geraeteFlash");
    const d = dumpMitBank();
    const anfragen: number[] = [];
    const lesen = async (addr: number, len: number) => {
      anfragen.push(addr);
      return { ok: true as const, bytes: d.slice(addr, addr + len) };
    };
    const r = await liesPatternBankVomGeraet(lesen, { chunk: 0x400 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bank.length).toBe(ELECTRIBE_ALLPAT_EXPECTED_SIZE);
    expect(isElectribeAllPatBank(r.bank)).toBe(true);
    expect(r.namen.slice(0, 3)).toEqual(["PAT 1", "PAT 2", "PAT 3"]);
    expect(Math.min(...anfragen)).toBe(PATTERN_BANK.glst);
    expect(Math.max(...anfragen)).toBeLessThan(0x628000);
    const leer = async () => ({ ok: true as const, bytes: new Uint8Array(0x10000).fill(0xff) });
    const f = await liesPatternBankVomGeraet(leer);
    expect(f.ok).toBe(false);
  });
});

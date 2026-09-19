/**
 * tests/werksbank.test.ts — Werks-Pattern-Bank aus SQEZ + Werks-Global, aus dem Dump und über
 * den Geräte-Lesepfad (Nachbau aus dem Dump). Läuft nur, wenn der echte Dump lokal liegt.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { werksbankAusDump, liesWerksbankVomGeraet, baueWerksbank, werksbankZeile } from "../src/core/werksbank";
import { isElectribeAllPatBank, parseElectribeAllPatBank, ELECTRIBE_ALLPAT_EXPECTED_SIZE } from "../src/core/electribeImport";
import { berichtFlashDump } from "../src/core/bootBericht";
import { liesFlashDump } from "../src/core/flashKarte";

const pfad = "G:/Downloads/TekkForge/Firmware/Flash-vom-Geraet-2026-09-16.bin";

describe("baueWerksbank — Fehlerpfade", () => {
  it("ohne GLST oder ohne SQEZ kommt ein Grund", () => {
    expect(baueWerksbank(new Uint8Array(0x100), new Uint8Array(32)).ok).toBe(false);
    const g = new Uint8Array(0x100);
    g.set([0x47, 0x4c, 0x53, 0x54]);
    const r = baueWerksbank(g, new Uint8Array(32));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.grund).toMatch(/SQEZ/);
    expect(werksbankZeile(r)).toMatch(/SQEZ/);
    expect(werksbankAusDump(new Uint8Array(0x1000000).fill(0xff)).ok).toBe(false);
  });
});

describe("Werksbank aus dem echten Dump (nur wenn er lokal liegt)", () => {
  it.skipIf(!existsSync(pfad))("baut eine gültige .e2sallpat, nennt die 7 Abweichungen, der Bericht zeigt die Zeile", () => {
    const d = new Uint8Array(readFileSync(pfad));
    const w = werksbankAusDump(d);
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.crcOk).toBe(true);
    expect(w.bank.length).toBe(ELECTRIBE_ALLPAT_EXPECTED_SIZE);
    expect(isElectribeAllPatBank(w.bank)).toBe(true);
    const p = parseElectribeAllPatBank(w.bank);
    expect(p.patterns.length).toBeGreaterThan(200);
    expect(p.patterns[0].name.trim()).toBe("Advi$ory1");
    expect(w.namen[0]).toBe("Advi$ory1");
    expect(w.abweichungen?.map((x) => x.nummer)).toEqual([1, 240, 242, 245, 248, 249, 250]);
    expect(w.abweichungen?.[0]).toEqual({ nummer: 1, imFlash: "Mfmt Pattern", imWerk: "Advi$ory1" });
    // Der GLST-Block der Bank ist das Werks-Global
    expect(Buffer.from(w.bank.subarray(0x100, 0x200)).equals(Buffer.from(d.subarray(0x630000, 0x630100)))).toBe(true);
    const z = werksbankZeile(w);
    expect(z).toMatch(/CRC stimmt/);
    expect(z).toMatch(/7 Records ab: 1 „Mfmt Pattern“ \(Werk „Advi\$ory1“\)/);
    const bef = liesFlashDump(d);
    if (bef.ok) expect(berichtFlashDump(bef).join("\n")).toMatch(/Werks-Pattern-Bank \(SQEZ 0x640000\): 250 Patterns entpackt/);
  });
  it.skipIf(!existsSync(pfad))("über den Geräte-Lesepfad: liest nur Werks-Global, Kopf und Strom", async () => {
    const d = new Uint8Array(readFileSync(pfad));
    const anfragen: [number, number][] = [];
    const lesen = async (addr: number, len: number) => {
      anfragen.push([addr, len]);
      return { ok: true as const, bytes: d.slice(addr, addr + len) };
    };
    const w = await liesWerksbankVomGeraet(lesen, { chunk: 0x400 });
    expect(w.ok).toBe(true);
    if (!w.ok) return;
    expect(w.crcOk).toBe(true);
    expect(w.abweichungen).toBeNull();
    const gesamt = anfragen.reduce((s, [, l]) => s + l, 0);
    expect(gesamt).toBeLessThan(0x25000);
    expect(anfragen[0]).toEqual([0x630000, 0x100]);
    const ausDump = werksbankAusDump(d);
    expect(ausDump.ok && Buffer.from(ausDump.bank).equals(Buffer.from(w.bank))).toBe(true);
  });
});

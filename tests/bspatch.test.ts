import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { bunzip2, Bzip2Fehler } from "../src/core/bunzip2";
import { bspatch, liesBsdiffKopf, hacktribeAusStock, HACKTRIBE_PATCH_SHA256, BSDIFF_MAGIC } from "../src/core/bspatch";
import { HACKTRIBE_SHA256, SAMPLER_STOCK_SHA256 } from "../src/core/firmwareKarte";
import { firmwareDatei } from "./helpers/firmwareDateien";

/**
 * bzip2-Dekoder und bsdiff-Anwendung: gegen mit Python (bz2, eigener
 * Mini-bsdiff-Encoder) erzeugte Fixtures — und, wo die Dateien lokal liegen,
 * gegen den echten Hacktribe-Patch (Stock 1d0f0689… + hacktribe-2.patch →
 * 7cb4825c…).
 */
const fx = JSON.parse(readFileSync(new URL("./fixtures/bspatch-fixture.json", import.meta.url), "utf8")) as Record<string, string | number>;
const b64 = (s: string): Uint8Array => new Uint8Array(Buffer.from(s, "base64"));
const sha = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");
const hashVon = async (b: Uint8Array): Promise<string> => sha(b);

describe("bunzip2", () => {
  it("dekodiert einen bzip2-Strom mit Läufen und Text byte-genau", () => {
    const out = bunzip2(b64(fx.bz2Text as string));
    expect(out.length).toBe(fx.textLen);
    expect(sha(out)).toBe(fx.textSha);
  });

  it("wirft bei falschem Magic, kaputter CRC und abgeschnittenen Daten", () => {
    const gut = b64(fx.bz2Text as string);
    const falsch = gut.slice();
    falsch[0] = 0x41;
    expect(() => bunzip2(falsch)).toThrow(Bzip2Fehler);
    const kaputt = gut.slice();
    kaputt[gut.length - 20] ^= 0x55; // irgendwo in den Daten — Block- oder Strom-CRC schlägt an
    expect(() => bunzip2(kaputt)).toThrow(Bzip2Fehler);
    expect(() => bunzip2(gut.subarray(0, 40))).toThrow(Bzip2Fehler);
  });
});

describe("bspatch", () => {
  it("liest den Kopf und lehnt Müll ab", () => {
    const k = liesBsdiffKopf(b64(fx.patch as string));
    expect(k.neueGroesse).toBe(b64(fx.new as string).length);
    expect(k.ctrlLaenge).toBeGreaterThan(0);
    expect(() => liesBsdiffKopf(new Uint8Array(10))).toThrow(/32/);
    const m = b64(fx.patch as string).slice();
    m[0] = 0x58;
    expect(() => liesBsdiffKopf(m)).toThrow(new RegExp(BSDIFF_MAGIC));
  });

  it("wendet den Fixture-Patch an: Ergebnis byte-gleich, Eingaben unverändert", () => {
    const old = b64(fx.old as string);
    const patch = b64(fx.patch as string);
    const oldKopie = old.slice();
    const out = bspatch(old, patch);
    expect(sha(out)).toBe(fx.newSha);
    expect(Buffer.compare(Buffer.from(old), Buffer.from(oldKopie))).toBe(0);
  });

  it("ein Bit im Patch kippt → Fehler statt halber Datei", () => {
    const patch = b64(fx.patch as string).slice();
    patch[patch.length - 3] ^= 0x01;
    expect(() => bspatch(b64(fx.old as string), patch)).toThrow();
  });

  it("hacktribeAusStock prüft alle drei Hashes", async () => {
    const old = b64(fx.old as string);
    const patch = b64(fx.patch as string);
    const erwartet = { stock: sha(old), patch: sha(patch), ziel: fx.newSha as string };
    const r = await hacktribeAusStock(old, patch, hashVon, erwartet);
    expect(r.ok).toBe(true);
    expect(r.ok && sha(r.bytes)).toBe(fx.newSha);
    const falscherStock = await hacktribeAusStock(old, patch, hashVon, { ...erwartet, stock: "00" });
    expect(!falscherStock.ok && falscherStock.reason).toMatch(/nicht die unveränderte/);
    const falscherPatch = await hacktribeAusStock(old, patch, hashVon, { ...erwartet, patch: "00" });
    expect(!falscherPatch.ok && falscherPatch.reason).toMatch(/nicht der bekannte Patch/);
    const falschesZiel = await hacktribeAusStock(old, patch, hashVon, { ...erwartet, ziel: "00" });
    expect(!falschesZiel.ok && falschesZiel.reason).toMatch(/nichts abgelegt/);
    const ohneHash = await hacktribeAusStock(old, patch, async () => null, erwartet);
    expect(!ohneHash.ok && ohneHash.reason).toMatch(/Kein SHA-256/);
  });

  const stockPfad = firmwareDatei("stock_e2s_v202.vsb");
  const patchPfad = firmwareDatei("hacktribe-2.patch");
  it.skipIf(!stockPfad || !existsSync(stockPfad) || !patchPfad || !existsSync(patchPfad))("Golden: Stock-Sampler + hacktribe-2.patch → Hacktribe 7cb4825c…", async () => {
    const stock = new Uint8Array(readFileSync(stockPfad!));
    const patch = new Uint8Array(readFileSync(patchPfad!));
    expect(sha(patch)).toBe(HACKTRIBE_PATCH_SHA256);
    const r = await hacktribeAusStock(stock, patch, hashVon, { stock: SAMPLER_STOCK_SHA256, patch: HACKTRIBE_PATCH_SHA256, ziel: HACKTRIBE_SHA256 });
    expect(r.ok).toBe(true);
    expect(r.ok && sha(r.bytes)).toBe(HACKTRIBE_SHA256);
  });
});

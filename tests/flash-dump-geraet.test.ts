/**
 * tests/flash-dump-geraet.test.ts — Häppchen-Probe und blockweiser Komplett-Dump des Flash
 * gegen einen Nachbau des Lesepfads (mit Häppchen-Parameter).
 */
import { describe, it, expect } from "vitest";
import { probeHaeppchen, liesFlashKomplett, KENNUNG, type LesenFlash } from "../src/core/geraeteFlash";

/** Flash-Nachbau: `maxChunk` = größte Anfrage, die das „Gerät“ beantwortet; größere → Timeout. */
function flash(groesse: number, maxChunk: number, kaputtAb?: number): LesenFlash & { anfragen: number[] } {
  const bild = new Uint8Array(groesse);
  for (let i = 0; i < groesse; i++) bild[i] = (i * 31 + (i >> 8)) & 0xff;
  const anfragen: number[] = [];
  const fn = (async (addr: number, len: number, chunk = 0x100) => {
    const out = new Uint8Array(len);
    for (let off = 0; off < len; off += chunk) {
      const n = Math.min(chunk, len - off);
      anfragen.push(n);
      if (n > maxChunk) return { ok: false as const, reason: `Timeout bei Häppchen ${n}` };
      if (kaputtAb !== undefined && addr + off >= kaputtAb) return { ok: false as const, reason: "keine Antwort" };
      out.set(bild.subarray(addr + off, addr + off + n), off);
    }
    return { ok: true as const, bytes: out };
  }) as LesenFlash & { anfragen: number[] };
  fn.anfragen = anfragen;
  return fn;
}

describe("probeHaeppchen", () => {
  it("nimmt das größte Häppchen, das das Gerät beantwortet", async () => {
    expect((await probeHaeppchen(flash(0x1000000, 0x400))).chunk).toBe(0x400);
    expect((await probeHaeppchen(flash(0x1000000, 0x200))).chunk).toBe(0x200);
    expect((await probeHaeppchen(flash(0x1000000, 0x100))).chunk).toBe(0x100);
  });
  it("probt an der User-Region und vergleicht gegen 0x100-Lesungen", async () => {
    const f = flash(0x1000000, 0x400);
    await probeHaeppchen(f);
    expect(f.anfragen[0]).toBe(0x100); // Referenz in 0x100-Häppchen
    expect(f.anfragen).toContain(0x400);
    expect(KENNUNG.userStempel).toBe(0x220000);
  });
});

describe("liesFlashKomplett", () => {
  it("liest blockweise mit Fortschritt und liefert das ganze Bild", async () => {
    const f = flash(0x40000, 0x400);
    const schritte: number[] = [];
    const r = await liesFlashKomplett(f, { gesamt: 0x40000, block: 0x10000, chunk: 0x400, fortschritt: (p) => schritte.push(p.gelesen) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bytes.length).toBe(0x40000);
    expect(r.bytes[0x12345]).toBe((0x12345 * 31 + (0x12345 >> 8)) & 0xff);
    expect(schritte).toEqual([0, 0x10000, 0x20000, 0x30000, 0x40000]);
    expect(f.anfragen.every((n) => n === 0x400)).toBe(true);
  });
  it("Lesefehler → Teilstück bis zum letzten guten Block", async () => {
    const r = await liesFlashKomplett(flash(0x40000, 0x100, 0x25000), { gesamt: 0x40000, block: 0x10000 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.gelesen).toBe(0x20000);
    expect(r.teil.length).toBe(0x20000);
  });
  it("Abbruch nach dem laufenden Block", async () => {
    let n = 0;
    const r = await liesFlashKomplett(flash(0x40000, 0x100), { gesamt: 0x40000, block: 0x10000, abbruch: () => ++n > 2, fortschritt: () => {} });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe("abgebrochen");
    expect(r.gelesen).toBe(0x20000);
  });
});

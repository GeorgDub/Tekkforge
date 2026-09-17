/** tests/slice-flash.test.ts — Slice-Records (0x444, ESLI-Schwanz) aus der Flash-Region. */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { SLICE_FLASH, dekodiereSliceRecord, sliceKarte, sliceZeile } from "../src/core/sliceFlash";
import { berichtFlashDump } from "../src/core/bootBericht";
import { liesFlashDump } from "../src/core/flashKarte";

function record(slices: [number, number, number, number][], steps: number[], schritte: number, beat: number): Uint8Array {
  const r = new Uint8Array(SLICE_FLASH.record);
  const dv = new DataView(r.buffer);
  slices.forEach((s, k) => s.forEach((v, j) => dv.setUint32(k * 16 + j * 4, v, true)));
  r.fill(0xff, 0x400, 0x440);
  steps.forEach((s, i) => (r[0x400 + i] = s));
  r[0x440] = schritte;
  r[0x441] = beat;
  r[0x442] = slices.length;
  return r;
}

describe("dekodiereSliceRecord / sliceKarte", () => {
  it("zerlegt Slices, Steps und Zusammenfassung; erkennt leer, null und Rest", () => {
    const r = dekodiereSliceRecord(record([[0, 100, 10, 5], [110, 90, 9, 6]], [0, 255, 1, 255], 16, 1), 7);
    expect(r.zustand).toBe("belegt");
    expect(r.slices).toEqual([
      { start: 0, laenge: 100, attack: 10, amplitude: 5 },
      { start: 110, laenge: 90, attack: 9, amplitude: 6 },
    ]);
    expect(r.steps.slice(0, 4)).toEqual([0, 255, 1, 255]);
    expect([r.schritte, r.beat, r.aktiv, r.index]).toEqual([16, 1, 2, 7]);
    expect(dekodiereSliceRecord(new Uint8Array(SLICE_FLASH.record).fill(0xff)).zustand).toBe("leer");
    expect(dekodiereSliceRecord(new Uint8Array(SLICE_FLASH.record)).zustand).toBe("null");
    const rest = new Uint8Array(SLICE_FLASH.record).fill(0xff);
    rest[0] = 0;
    expect(dekodiereSliceRecord(rest).zustand).toBe("rest");
  });
  it("kartiert eine Region und formuliert die Zeile", () => {
    const region = new Uint8Array(SLICE_FLASH.groesse).fill(0xff);
    region.set(new Uint8Array(SLICE_FLASH.record), 0);
    region.set(record([[0, 50, 1, 1]], [0], 8, 0), 3 * SLICE_FLASH.record);
    const k = sliceKarte(region);
    expect(k.beschrieben).toBe(2);
    expect(k.hoechsterIndex).toBe(3);
    expect(k.mitSlices.map((r) => r.index)).toEqual([3]);
    expect(sliceZeile(k)).toBe("Slice-Region (0x750000): 2 von 540 Records beschrieben (bis Sample 4), 1 mit Slices — Sample 4: 1 Slices/8 Schritte");
    expect(sliceZeile(sliceKarte(new Uint8Array(SLICE_FLASH.groesse).fill(0xff)))).toMatch(/leer/);
  });
});

describe("Slice-Region im echten Gerätedump (nur wenn er lokal liegt)", () => {
  const pfad = "G:/Downloads/TekkForge/Firmware/Flash-vom-Geraet-2026-09-16.bin";
  it.skipIf(!existsSync(pfad))("404 beschriebene Records, 32 mit Slices, Sample 337: 8 Slices auf 32 Schritten", () => {
    const d = new Uint8Array(readFileSync(pfad));
    const k = sliceKarte(d);
    expect(k.records).toBe(540);
    expect(k.beschrieben).toBe(404);
    expect(k.mitSlices.length).toBe(32);
    const s337 = k.mitSlices.find((r) => r.index === 336)!;
    expect([s337.aktiv, s337.schritte, s337.beat]).toEqual([8, 32, 0]);
    expect(s337.slices[0]).toEqual({ start: 0, laenge: 14752, attack: 7346, amplitude: 10176 });
    const bef = liesFlashDump(d);
    if (bef.ok) expect(berichtFlashDump(bef).join("\n")).toMatch(/Slice-Region \(0x750000\): 404 von 540/);
  });
});

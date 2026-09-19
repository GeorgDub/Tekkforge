import { describe, it, expect } from "vitest";
import { berichtVsbPruefung, berichtBootSektor, berichtFlashDump } from "../src/core/bootBericht";
import { standardKopf } from "../src/core/vsbKopf";
import { baueBootSektor, liesBootSektor } from "../src/core/bootSektor";
import { liesFlashDump, FLASH_GROESSE } from "../src/core/flashKarte";

describe("bootBericht", () => {
  it("Kopfprüfung für beide Updater: Sampler-SYSTEM nur beim Sampler, BOOT bei beiden", () => {
    const sys = berichtVsbPruefung(standardKopf("sampler", "SYSTEM"), "SYSTEM.VSB");
    expect(sys.samplerOk).toBe(true);
    expect(sys.synthOk).toBe(false);
    expect(sys.zeilen.join("\n")).toMatch(/Sampler-Firmware: ✅/);
    expect(sys.zeilen.join("\n")).toMatch(/Synth-Firmware: ❌/);
    const boot = berichtVsbPruefung(standardKopf("sampler", "BOOT"), "BOOT.VSB");
    expect(boot.samplerOk && boot.synthOk).toBe(true);
  });
  it("Boot-Sektor- und Flash-Dump-Berichte nennen die Kernfakten", () => {
    const bs = liesBootSektor(baueBootSektor(new Uint8Array([9, 8, 7])));
    const t = berichtBootSektor(bs).join("\n");
    expect(t).toMatch(/✅ Boot-Sektor brauchbar/);
    expect(t).toMatch(/Section Load → 0x80000000/);
    expect(t).toMatch(/Prüfsumme: 0x[0-9A-F]+ ✓/);
    const d = new Uint8Array(FLASH_GROESSE).fill(0xff);
    d.set(baueBootSektor(new Uint8Array([1])), 0);
    const r = liesFlashDump(d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const f = berichtFlashDump(r).join("\n");
    expect(f).toMatch(/kein Produktstempel/);
    expect(f).toMatch(/0x80\s+0x800000/);
    expect(f).toMatch(/Custom-Bootloader/);
  });
});

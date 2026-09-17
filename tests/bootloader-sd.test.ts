/** tests/bootloader-sd.test.ts — Bootloader-SD-Ordner: Einordnung je Datei, Was-gehört-nicht-drauf, LIESMICH, Warnungen. */
import { describe, it, expect } from "vitest";
import { ordneBootloaderDatei, baueBootloaderSd, DISPLAY_NAME_MAX } from "../src/core/bootloaderSd";
import { standardKopf } from "../src/core/vsbKopf";

const vsb = (art: Parameters<typeof standardKopf>[1], variante: "synth" | "sampler", laenge: number) => {
  const kopf = standardKopf(variante, art, laenge);
  const b = new Uint8Array(kopf.length + laenge);
  b.set(kopf, 0);
  return b;
};
const sbl = () => { const b = new Uint8Array(131022); b.fill(0x11); return b; };
const tipa = () => { const b = new Uint8Array(0x20000); b.set([0x54, 0x49, 0x50, 0x41], 0); return b; };

describe("ordneBootloaderDatei", () => {
  it("SYSTEM.VSB → Boot oder Flash, auf die SD, mit Identität", () => {
    const e = ordneBootloaderDatei("SYSTEM.VSB", vsb("SYSTEM", "sampler", 0x200000));
    expect(e.rolle).toBe("system");
    expect(e.aufSd).toBe(true);
    expect(e.identitaet).toBe("Sampler");
    expect(e.menue).toMatch(/Boot.*Flash/);
  });
  it("PCM/BOOT/USER/SLICE → Flash; BOOT-vom-Geraet ist der Rückweg", () => {
    expect(ordneBootloaderDatei("PCM.VSB", vsb("PCM", "sampler", 0x800000)).rolle).toBe("pcm");
    const boot = ordneBootloaderDatei("BOOT-vom-Geraet-2026-09-16.VSB", vsb("BOOT", "sampler", 0x20000));
    expect(boot.rolle).toBe("boot");
    expect(boot.hinweis).toMatch(/RÜCKWEG/);
    expect(ordneBootloaderDatei("USER.VSB", vsb("USER", "sampler", 0x1000)).rolle).toBe("user");
    expect(ordneBootloaderDatei("SLICE.VSB", vsb("SLICE", "sampler", 0x1000)).rolle).toBe("slice");
  });
  it("bootloader.bin, Boot-Sektor und .syx gehören NICHT auf die SD", () => {
    expect(ordneBootloaderDatei("bootloader.bin", sbl())).toMatchObject({ rolle: "sbl", aufSd: false });
    expect(ordneBootloaderDatei("bootsect.bin", tipa())).toMatchObject({ rolle: "bootsektor", aufSd: false });
    expect(ordneBootloaderDatei("omnitribe_modules.syx", Uint8Array.from([0xf0, 0x7d, 0xf7]))).toMatchObject({ rolle: "syx", aufSd: false });
  });
  it("rohes 2-MiB-Image → Boot; Sonstiges → unbekannt", () => {
    expect(ordneBootloaderDatei("fw.bin", new Uint8Array(0x200000))).toMatchObject({ rolle: "roh", aufSd: true });
    expect(ordneBootloaderDatei("x.bin", new Uint8Array(500))).toMatchObject({ rolle: "unbekannt", aufSd: false });
  });
});

describe("baueBootloaderSd", () => {
  it("trennt SD-Dateien von den anderen, schreibt Menü-Legende und Regeln", () => {
    const p = baueBootloaderSd(
      [
        { name: "SYSTEM_omnitribe.VSB", bytes: vsb("SYSTEM", "sampler", 0x200000) },
        { name: "PCM.VSB", bytes: vsb("PCM", "sampler", 0x800000) },
        { name: "bootloader.bin", bytes: sbl() },
      ],
      { stempel: "2026-09-17", md5: () => "deadbeef", bootloaderName: "bootloader.bin" },
    );
    expect(p.ordner).toBe("Bootloader-SD-2026-09-17");
    expect(p.dateien.filter((d) => d.aufSd).map((d) => d.name)).toEqual(["SYSTEM_omnitribe.VSB", "PCM.VSB"]);
    expect(p.liesmich).toMatch(/Install bootloader/);
    expect(p.liesmich).toMatch(/Boot ist flüchtig/);
    expect(p.liesmich).toMatch(/`deadbeef`/);
    expect(p.liesmich).toMatch(/Nicht kopiert/);
    expect(p.liesmich).toMatch(/bootloader\.bin.*SysEx starten/);
    expect(p.warnungen.some((w) => /bootloader\.bin/.test(w))).toBe(true);
  });
  it("warnt bei Synth-Identität, langen Namen und Doppelnamen", () => {
    const lang = "SYSTEM-mit-sehr-langem-Namen-2026.VSB";
    expect(lang.length).toBeGreaterThan(DISPLAY_NAME_MAX);
    const p = baueBootloaderSd([
      { name: lang, bytes: vsb("SYSTEM", "synth", 0x200000) },
      { name: "PCM.VSB", bytes: vsb("PCM", "sampler", 0x800000) },
      { name: "pcm.vsb", bytes: vsb("PCM", "sampler", 0x800000) },
    ], { stempel: "2026-09-17" });
    expect(p.warnungen.join("\n")).toMatch(/SYNTH-Identität/);
    expect(p.warnungen.join("\n")).toMatch(/länger als 24 Zeichen/);
    expect(p.warnungen.join("\n")).toMatch(/Doppelter Dateiname/);
    expect(p.liesmich).toMatch(/## Warnungen/);
  });
});

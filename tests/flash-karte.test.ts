/**
 * tests/flash-karte.test.ts — einen 16-MiB-Flash-Dump der Electribe 2 kartieren und zerlegen.
 *
 * Lage der Regionen aus electribe2-re (storage-and-updates.md) und dem ImHex-Pattern
 * e2s-flash-bin.hexpat; Selektor << 16 = Offset (MapSerialFlashRegionIndex 0xC0029C14).
 */
import { describe, it, expect } from "vitest";
import { FLASH_GROESSE, liesFlashDump, schneideRegion } from "../src/core/flashKarte";
import { baueBootSektor } from "../src/core/bootSektor";
import { liesVsbKopf, standardKopf } from "../src/core/vsbKopf";

const asc = (b: Uint8Array, off: number, s: string): void => {
  for (let i = 0; i < s.length; i++) b[off + i] = s.charCodeAt(i);
};

function dump(): Uint8Array {
  const d = new Uint8Array(FLASH_GROESSE).fill(0xff);
  d.set(baueBootSektor(new Uint8Array([1, 2, 3, 4])), 0);
  // SYSTEM ab 0x20000: ARM-Vektortabelle (ldr pc,[pc,#0x18]) + „PTST“ am Sampler-Init-Pattern.
  for (let i = 0; i < 8; i++) d.set([0x18, 0xf0, 0x9f, 0xe5], 0x20000 + 4 * i);
  asc(d, 0x20000 + (0xd0058 - 0x100), "PTST");
  // Main-Versionsrecord 0x21FFF0: Bytes +4/+5/+6.
  d.fill(0, 0x21fff0, 0x220000);
  d[0x21fff4] = 2;
  d[0x21fff5] = 2;
  d[0x21fff6] = 0;
  // USER-Identität bei 0x220004.
  d.fill(0, 0x220000, 0x220010);
  asc(d, 0x220004, "ele2sUSR");
  // PCM-Kopf.
  asc(d, 0x800000, "KORGelec2PCM");
  return d;
}

describe("liesFlashDump", () => {
  it("verlangt genau 16 MiB", () => {
    const r = liesFlashDump(new Uint8Array(100));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.grund).toMatch(/16 MiB/);
  });
  it("kartiert Boot-Sektor, System, Version, USER-Identität und PCM", () => {
    const r = liesFlashDump(dump());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.boot.ok).toBe(true);
    expect(r.userIdentitaet).toBe("ele2sUSR");
    expect(r.variante).toBe("sampler");
    expect(r.mainVersion).toEqual([2, 2, 0]);
    expect(r.pcm.magicOk).toBe(true);
    expect(r.pcm.format).toBe("elec2PCM");
    expect(r.system.vektorOk).toBe(true);
    expect(r.system.familie).toBe("sampler");
    const namen = r.regionen.map((x) => x.vsb ?? x.name);
    expect(namen).toEqual(expect.arrayContaining(["BOOT", "SYSTEM", "USER", "SLICE", "PCM"]));
    expect(r.regionen.find((x) => x.vsb === "PCM")?.offset).toBe(0x800000);
    expect(r.regionen.find((x) => x.vsb === "PCM")?.groesse).toBe(0x800000);
  });
  it("leere Regionen (0xFF) werden als leer gemeldet, ein Synth-Stempel als synth", () => {
    const d = dump();
    d.fill(0xff, 0x800000, 0x800010);
    asc(d, 0x220004, "elec2USR");
    const r = liesFlashDump(d);
    expect(r.ok && r.pcm.magicOk).toBe(false);
    expect(r.ok && r.userIdentitaet).toBe("elec2USR");
    expect(r.ok && r.variante).toBe("synth");
    expect(r.ok && r.regionen.find((x) => x.vsb === "PCM")?.befund).toMatch(/leer/);
  });
});

describe("schneideRegion", () => {
  it("SYSTEM als VSB: Kopf der Vorlage mit Name/Länge/Identität + 2 MiB Nutzlast", () => {
    const d = dump();
    const v = schneideRegion(d, "SYSTEM", standardKopf("sampler", "SYSTEM"));
    expect(v.length).toBe(0x100 + 0x200000);
    expect(liesVsbKopf(v).name).toBe("SYSTEM");
    expect(liesVsbKopf(v).laenge).toBe(0x200000);
    expect(Array.from(v.subarray(0x100, 0x104))).toEqual([0x18, 0xf0, 0x9f, 0xe5]);
  });
  it("BOOT als VSB trägt die Identität der Vorlage, PCM ist 8 MiB, roh ohne Vorlage", () => {
    const d = dump();
    const b = schneideRegion(d, "BOOT", standardKopf("synth", "SYSTEM"));
    expect(liesVsbKopf(b).identitaet).toBe(0x000123);
    expect(liesVsbKopf(b).laenge).toBe(0x20000);
    expect(schneideRegion(d, "PCM", standardKopf("sampler", "SYSTEM")).length).toBe(0x100 + 0x800000);
    expect(schneideRegion(d, "USER").length).toBe(0x490000);
    expect(schneideRegion(d, "SLICE").length).toBe(0x90000);
  });
});

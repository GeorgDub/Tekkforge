/**
 * tests/vsb-kopf.test.ts — der VSB-Kopf, wie ihn die Sampler-Firmware prüft.
 *
 * Regeln aus den Dekompilaten (HACKTRIBE.bin, vanasoft23/electribe2-re):
 * ValidateVsbResourceHeaderMagic 0xC00367C4, ValidateVsbResourceHeaderType 0xC00367E8,
 * GetVsbPayloadLength 0xC0036898, GetVsbHeaderProductIdentity 0xC0036854,
 * IsCpuResourceRevisionAtLeast 0xC0036790, Load{Boot,System,Pcm,User,Slice}VsbToSerialFlash.
 */
import { describe, it, expect } from "vitest";
import {
  VSB_KOPF,
  liesVsbKopf,
  pruefeVsbKopf,
  baueVsbKopf,
  standardKopf,
  selektorOffset,
  FLASH_SELEKTOREN,
  REGION_SPANNE,
  MINDEST_REVISION,
} from "../src/core/vsbKopf";

const asc = (b: Uint8Array, off: number, s: string): void => {
  for (let i = 0; i < s.length; i++) b[off + i] = s.charCodeAt(i);
};

/** Ein Kopf wie der einer echten Sampler-SYSTEM.VSB (Bytes vom 2026-09-16 abgelesen). */
function samplerSystemKopf(): Uint8Array {
  const b = new Uint8Array(VSB_KOPF).fill(0xff);
  b.fill(0, 0, 0x42);
  asc(b, 0, "KORG SYSTEM FILE");
  asc(b, 0x10, "E2S");
  asc(b, 0x20, "SYSTEM");
  b[0x28] = 0x00;
  b[0x29] = 0x01;
  b[0x2a] = 0x02;
  b[0x2b] = 0x02;
  b[0x2c] = 0x00;
  b[0x2d] = 0x01;
  b[0x2e] = 0x24;
  b[0x2f] = 0xff;
  b[0x36] = 0x20; // 0x34: 00 00 20 00 LE = 0x200000
  b[0x3e] = 0x20; // 0x3C: 00 00 20 00 LE = 0x200000
  b[0x40] = 0x02;
  return b;
}

describe("liesVsbKopf", () => {
  it("liest Name, Kürzel, Revision, Identität und Länge (LE) aus dem Sampler-Kopf", () => {
    const k = liesVsbKopf(samplerSystemKopf());
    expect(k.magicOk).toBe(true);
    expect(k.kuerzel).toBe("E2S");
    expect(k.name).toBe("SYSTEM");
    expect(k.art).toBe("SYSTEM");
    expect(k.revision).toEqual([2, 2]);
    expect(k.identitaet).toBe(0x000124);
    expect(k.laenge).toBe(0x200000);
  });
  it("erkennt die vier anderen Arten am Namen — SLICE über die ersten vier Zeichen", () => {
    for (const [name, art] of [
      ["BOOT", "BOOT"],
      ["PCM", "PCM"],
      ["USER", "USER"],
      ["SLICE", "SLICE"],
      ["SLIC", "SLICE"],
      ["FOO", null],
    ] as const) {
      const b = samplerSystemKopf();
      b.fill(0, 0x20, 0x28);
      asc(b, 0x20, name);
      expect(liesVsbKopf(b).art).toBe(art);
    }
  });
  it("ohne Magic ist alles ungültig, aber nichts wirft", () => {
    const k = liesVsbKopf(new Uint8Array(0x50));
    expect(k.magicOk).toBe(false);
    expect(k.art).toBeNull();
  });
});

describe("pruefeVsbKopf — Ablehnungsgründe der Firmware", () => {
  it("die echte Sampler-SYSTEM.VSB besteht beim Sampler-Updater", () => {
    const r = pruefeVsbKopf(samplerSystemKopf(), "sampler");
    expect(r.ok).toBe(true);
    expect(r.art).toBe("SYSTEM");
    expect(r.pruefungen.every((p) => p.ok)).toBe(true);
  });
  it("SYSTEM/PCM/USER/SLICE (Modus 0) verlangen genau die Identität der laufenden Firmware", () => {
    const b = samplerSystemKopf();
    expect(pruefeVsbKopf(b, "synth").ok).toBe(false);
    expect(pruefeVsbKopf(b, "synth").pruefungen.find((p) => p.titel.startsWith("Identität"))?.ok).toBe(false);
    b[0x2e] = 0x23;
    expect(pruefeVsbKopf(b, "synth").ok).toBe(true);
    expect(pruefeVsbKopf(b, "sampler").ok).toBe(false);
  });
  it("BOOT (Modus 1) nimmt 0x23 UND 0x24 an, 0x25 nicht", () => {
    const b = samplerSystemKopf();
    b.fill(0, 0x20, 0x28);
    asc(b, 0x20, "BOOT");
    b[0x3c] = 0;
    b[0x3d] = 0;
    b[0x3e] = 0x02; // 0x20000
    for (const id of [0x23, 0x24]) {
      b[0x2e] = id;
      expect(pruefeVsbKopf(b, "sampler").ok).toBe(true);
      expect(pruefeVsbKopf(b, "synth").ok).toBe(true);
    }
    b[0x2e] = 0x25;
    expect(pruefeVsbKopf(b, "sampler").ok).toBe(false);
  });
  it("Identität muss 00 01 xx sein — 0x2C oder 0x2D anders ist rot", () => {
    const b = samplerSystemKopf();
    b[0x2d] = 0x02;
    expect(pruefeVsbKopf(b, "sampler").ok).toBe(false);
    const c = samplerSystemKopf();
    c[0x2c] = 0x01;
    expect(pruefeVsbKopf(c, "sampler").ok).toBe(false);
  });
  it("Längen: SYSTEM/BOOT/PCM exakt, USER/SLICE werden geklemmt (Hinweis, nicht rot)", () => {
    const sys = samplerSystemKopf();
    sys[0x3e] = 0x21;
    const r = pruefeVsbKopf(sys, "sampler");
    expect(r.ok).toBe(false);
    expect(r.pruefungen.find((p) => p.titel.startsWith("Länge"))?.detail).toMatch(/0x200000/);

    const usr = samplerSystemKopf();
    usr.fill(0, 0x20, 0x28);
    asc(usr, 0x20, "USER");
    usr[0x3c] = 0;
    usr[0x3d] = 0;
    usr[0x3e] = 0x50; // 0x500000 > 0x490000
    const u = pruefeVsbKopf(usr, "sampler");
    expect(u.ok).toBe(true);
    expect(u.pruefungen.find((p) => p.titel.startsWith("Länge"))?.detail).toMatch(/geklemmt/);
  });
  it("Revision: der produktbewusste SYSTEM-Installer verlangt ≥ 2.2 (Sampler) bzw. ≥ 1.17 (Synth)", () => {
    expect(MINDEST_REVISION.sampler).toEqual([2, 2]);
    expect(MINDEST_REVISION.synth).toEqual([1, 0x11]);
    const b = samplerSystemKopf();
    b[0x2a] = 1;
    b[0x2b] = 9;
    const r = pruefeVsbKopf(b, "sampler");
    expect(r.ok).toBe(false);
    expect(r.pruefungen.find((p) => p.titel.startsWith("Revision"))?.ok).toBe(false);
    // Bei BOOT gibt es keine Revisionsprüfung.
    b.fill(0, 0x20, 0x28);
    asc(b, 0x20, "BOOT");
    b[0x3c] = 0;
    b[0x3d] = 0;
    b[0x3e] = 0x02;
    expect(pruefeVsbKopf(b, "sampler").pruefungen.some((p) => p.titel.startsWith("Revision"))).toBe(false);
  });
  it("ein unbekannter Name ist rot mit der Liste der fünf Namen", () => {
    const b = samplerSystemKopf();
    b.fill(0, 0x20, 0x28);
    asc(b, 0x20, "FOO");
    const r = pruefeVsbKopf(b, "sampler");
    expect(r.ok).toBe(false);
    expect(r.pruefungen.find((p) => p.titel.startsWith("Name"))?.detail).toMatch(/SYSTEM.*BOOT.*PCM.*USER.*SLICE/);
  });
});

describe("baueVsbKopf / standardKopf", () => {
  it("setzt Name, Länge (0x34 und 0x3C) und Identität, lässt den Rest der Vorlage stehen", () => {
    const v = samplerSystemKopf();
    const k = baueVsbKopf(v, { art: "BOOT", laenge: 0x20000, idLow: 0x23 });
    expect(k.length).toBe(VSB_KOPF);
    const r = liesVsbKopf(k);
    expect(r.name).toBe("BOOT");
    expect(r.laenge).toBe(0x20000);
    expect(r.identitaet).toBe(0x000123);
    expect(k[0x34] | (k[0x35] << 8) | (k[0x36] << 16)).toBe(0x20000);
    expect(k[0x10]).toBe("E".charCodeAt(0)); // Vorlage bleibt
    expect(k[0xff]).toBe(0xff);
    expect(v[0x20]).toBe("S".charCodeAt(0)); // Vorlage unverändert
  });
  it("standardKopf liefert einen Kopf, den der jeweilige Updater annimmt", () => {
    expect(pruefeVsbKopf(standardKopf("sampler", "SYSTEM"), "sampler").ok).toBe(true);
    expect(pruefeVsbKopf(standardKopf("synth", "SYSTEM"), "synth").ok).toBe(true);
    expect(pruefeVsbKopf(standardKopf("sampler", "BOOT"), "synth").ok).toBe(true);
    expect(liesVsbKopf(standardKopf("synth", "PCM")).laenge).toBe(0x800000);
  });
});

describe("Flash-Selektoren", () => {
  it("Selektor << 16 und die fünf Regionen", () => {
    expect(selektorOffset(0x80)).toBe(0x800000);
    expect(selektorOffset(2)).toBe(0x20000);
    expect(FLASH_SELEKTOREN.find((s) => s.vsb === "BOOT")?.offset).toBe(0);
    expect(FLASH_SELEKTOREN.find((s) => s.vsb === "SYSTEM")?.offset).toBe(0x20000);
    expect(FLASH_SELEKTOREN.find((s) => s.vsb === "USER")?.offset).toBe(0x220000);
    expect(FLASH_SELEKTOREN.find((s) => s.vsb === "SLICE")?.offset).toBe(0x750000);
    expect(FLASH_SELEKTOREN.find((s) => s.vsb === "PCM")?.offset).toBe(0x800000);
    expect(REGION_SPANNE.BOOT).toEqual({ genau: 0x20000 });
    expect(REGION_SPANNE.USER).toEqual({ max: 0x490000 });
    expect(REGION_SPANNE.SLICE).toEqual({ max: 0x90000 });
  });
});

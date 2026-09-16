/**
 * tests/boot-sektor.test.ts — Boot-Sektor (AIS + SBL) bauen, lesen, als BOOT.VSB verpacken.
 *
 * Nachbau von freetribe (vanasoft23, bootloader-mess) `boot_section.c` und der
 * Python-Fassung `scripts/make_bootsect.py`. Wo die AGPL-`bootloader.bin` lokal
 * liegt, wird byte-genau gegen die Python-Ausgabe verglichen; sonst prüft ein
 * synthetischer SBL-Block die Struktur.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  BOOTSEKTOR_GROESSE,
  SBL_GROESSE,
  AIS_KOPF,
  AIS_SCHWANZ,
  wortsumme16,
  baueBootSektor,
  liesBootSektor,
  baueBootVsb,
} from "../src/core/bootSektor";
import { liesVsbKopf, pruefeVsbKopf, standardKopf } from "../src/core/vsbKopf";

const ORDNER = "G:/Downloads/TekkForge/Firmware/vanasoft-bootloader";
const lokal = (n: string): Uint8Array | null => (existsSync(`${ORDNER}/${n}`) ? new Uint8Array(readFileSync(`${ORDNER}/${n}`)) : null);

function syntheticSbl(n = 1000): Uint8Array {
  const s = new Uint8Array(n);
  for (let i = 0; i < n; i++) s[i] = (i * 7 + 3) & 0xff;
  return s;
}

describe("Konstanten", () => {
  it("40 + SBL + 8 + 2 = 128 KiB, SBL = 131022", () => {
    expect(AIS_KOPF.length).toBe(36); // + 4 Bytes Größe
    expect(AIS_SCHWANZ.length).toBe(8);
    expect(SBL_GROESSE).toBe(131022);
    expect(AIS_KOPF.length + 4 + SBL_GROESSE + AIS_SCHWANZ.length + 2).toBe(BOOTSEKTOR_GROESSE);
    expect(Array.from(AIS_KOPF.subarray(0, 4))).toEqual([0x54, 0x49, 0x50, 0x41]); // TIPA
  });
  it("wortsumme16 ist die LE-Wortsumme modulo 2^16", () => {
    expect(wortsumme16(new Uint8Array([0x01, 0x00, 0x02, 0x00]))).toBe(3);
    expect(wortsumme16(new Uint8Array([0xff, 0xff, 0x01, 0x00]))).toBe(0);
    expect(wortsumme16(new Uint8Array([0x34, 0x12]))).toBe(0x1234);
  });
});

describe("baueBootSektor / liesBootSektor", () => {
  it("Rundlauf: gebaut → gelesen liefert dieselbe (aufgefüllte) SBL und eine stimmige Prüfsumme", () => {
    const sbl = syntheticSbl();
    const bs = baueBootSektor(sbl);
    expect(bs.length).toBe(BOOTSEKTOR_GROESSE);
    const b = liesBootSektor(bs);
    expect(b.ok).toBe(true);
    expect(b.ladeAdresse).toBe(0x80000000);
    expect(b.einsprung).toBe(0x80000000);
    expect(b.sblGroesse).toBe(SBL_GROESSE);
    expect(b.sbl.length).toBe(SBL_GROESSE);
    expect(Array.from(b.sbl.subarray(0, sbl.length))).toEqual(Array.from(sbl));
    expect(b.sbl.subarray(sbl.length).every((x) => x === 0)).toBe(true);
    expect(b.pruefsumme.ok).toBe(true);
    expect(b.kommandos.length).toBe(4); // SeqRead, FnExec 6, SectionLoad, Jump
    expect(b.kommandos[1]).toMatch(/Function Execute 6/);
    expect(b.layout).toBe("vanasoft");
    expect(b.sektionen).toEqual([{ addr: 0x80000000, size: SBL_GROESSE }]);
  });
  it("Korg-Werkslayout: drei Sektionen (0x80000000 / +0x40 / +0x55F0), keine Wortsumme → ok, layout werk, Speicherbild zusammengesetzt", () => {
    const bs = new Uint8Array(BOOTSEKTOR_GROESSE).fill(0xff);
    let p = 0;
    bs.set(AIS_KOPF.subarray(0, 28), 0); // TIPA, SeqRead, FnExec 6
    p = 28;
    const sect = (addr: number, data: Uint8Array) => {
      bs.set([0x01, 0x59, 0x53, 0x58], p);
      bs.set([addr & 0xff, (addr >>> 8) & 0xff, (addr >>> 16) & 0xff, (addr >>> 24) & 0xff], p + 4);
      bs.set([data.length & 0xff, (data.length >>> 8) & 0xff, 0, 0], p + 8);
      bs.set(data, p + 12);
      p += 12 + data.length;
    };
    sect(0x80000000, new Uint8Array(60).fill(0xe5));
    sect(0x80000040, new Uint8Array(21924).fill(0xaa));
    sect(0x800055f0, new Uint8Array(2124).fill(0xbb));
    bs.set(AIS_SCHWANZ, p);
    const b = liesBootSektor(bs);
    expect(b.ok).toBe(true);
    expect(b.layout).toBe("werk");
    expect(b.sektionen.length).toBe(3);
    expect(b.sblGroesse).toBe(60 + 21924 + 2124);
    expect(b.sbl.length).toBe(0x55f0 + 2124);
    expect(b.sbl[0x40]).toBe(0xaa);
    expect(b.sbl[0x55f0]).toBe(0xbb);
    expect(b.sbl[60]).toBe(0); // Lücke zwischen Vektoren und Code
    expect(b.pruefsumme.ok).toBe(false);
    expect(b.hinweise.join(" ")).toMatch(/Werkslayout/);
  });
  it("zu große SBL wird abgelehnt", () => {
    expect(() => baueBootSektor(new Uint8Array(SBL_GROESSE + 1))).toThrow(/zu groß/);
  });
  it("kein TIPA → nicht ok; falsche Ladeadresse → nicht ok; Prüfsumme kaputt → nur Prüfsumme rot", () => {
    expect(liesBootSektor(new Uint8Array(BOOTSEKTOR_GROESSE)).ok).toBe(false);
    const bs = baueBootSektor(syntheticSbl());
    bs[0x1c + 4 + 3] = 0x81; // Ladeadresse 0x81000000
    expect(liesBootSektor(bs).ok).toBe(false);
    const bs2 = baueBootSektor(syntheticSbl());
    bs2[BOOTSEKTOR_GROESSE - 1] ^= 0xff;
    const b2 = liesBootSektor(bs2);
    expect(b2.pruefsumme.ok).toBe(false);
    expect(b2.ok).toBe(true); // eine falsche Summe ist ein Hinweis, kein Verbot
    expect(b2.layout).toBe("fremd");
    expect(b2.hinweise.join(" ")).toMatch(/Prüfsumme/);
  });
  it("nimmt auch einen ganzen Flash-Dump (mehr als 128 KiB) und liest nur den Anfang", () => {
    const dump = new Uint8Array(0x40000);
    dump.set(baueBootSektor(syntheticSbl()));
    expect(liesBootSektor(dump).ok).toBe(true);
  });
});

describe("baueBootVsb", () => {
  it("BOOT-Kopf + Boot-Sektor, den der Sampler- und der Synth-Updater annehmen", () => {
    const bs = baueBootSektor(syntheticSbl());
    const vsb = baueBootVsb(bs, standardKopf("sampler", "SYSTEM"), 0x24);
    expect(vsb.length).toBe(0x100 + BOOTSEKTOR_GROESSE);
    const k = liesVsbKopf(vsb);
    expect(k.name).toBe("BOOT");
    expect(k.laenge).toBe(BOOTSEKTOR_GROESSE);
    expect(k.identitaet).toBe(0x000124);
    expect(pruefeVsbKopf(vsb, "sampler").ok).toBe(true);
    expect(pruefeVsbKopf(vsb, "synth").ok).toBe(true);
    expect(liesBootSektor(vsb.subarray(0x100)).ok).toBe(true);
  });
  it("verlangt genau 128 KiB", () => {
    expect(() => baueBootVsb(new Uint8Array(100), standardKopf("sampler", "SYSTEM"), 0x24)).toThrow(/0x20000/);
  });
});

describe("Gleichheit mit der Python-Fassung (nur wenn die lokalen Dateien liegen)", () => {
  const bl = lokal("bootloader.bin");
  const bs = lokal("bootsect-vanasoft-2026-09-16.bin");
  const vsb = lokal("BOOT-vanasoft-2026-09-16.VSB");
  it.skipIf(!bl || !bs || !vsb)("baueBootSektor(bootloader.bin) == bootsect-….bin und die BOOT.VSB-Nutzlast", () => {
    const gebaut = baueBootSektor(bl!);
    expect(Buffer.from(gebaut).equals(Buffer.from(bs!))).toBe(true);
    expect(Buffer.from(gebaut).equals(Buffer.from(vsb!.subarray(0x100)))).toBe(true);
    const b = liesBootSektor(gebaut);
    expect(b.pruefsumme.gespeichert).toBe(0xfee0);
    expect(Buffer.from(b.sbl).equals(Buffer.from(bl!))).toBe(true);
    // Der Kopf der Python-BOOT.VSB (Vorlage MOD132-SYSTEM.VSB) besteht die Prüfung.
    expect(pruefeVsbKopf(vsb!, "sampler").ok).toBe(true);
  });
});

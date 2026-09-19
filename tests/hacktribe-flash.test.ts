import { describe, it, expect } from "vitest";
import { FLASH_CMD_READ, FLASH_GROESSE, validateFlashRange, buildFlashReadRequest, parseFlashResponse, splitFlashRead } from "../src/core/hacktribeFlash";
import { syxEnc } from "../src/core/e2sysex";
import { liesFlashKennungen, liesBootSektorVomGeraet, kennungenText, KENNUNG, type LesenFlash } from "../src/core/geraeteFlash";
import { baueBootSektor } from "../src/core/bootSektor";

describe("hacktribeFlash — nur lesen", () => {
  it("Bereich: 0 … 16 MiB, Länge positiv", () => {
    expect(validateFlashRange(0, 0x20000).ok).toBe(true);
    expect(validateFlashRange(FLASH_GROESSE - 16, 16).ok).toBe(true);
    expect(validateFlashRange(FLASH_GROESSE - 15, 16).ok).toBe(false);
    expect(validateFlashRange(-1, 4).ok).toBe(false);
    expect(validateFlashRange(0, 0).ok).toBe(false);
  });
  it("Anfrage: Korg-Kopf, 0x55, syxEnc(addr_le32 ‖ len_le32), F7", () => {
    const f = buildFlashReadRequest(0x220000, 16, { channel: 0 });
    expect(Array.from(f.subarray(0, 7))).toEqual([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, FLASH_CMD_READ]);
    expect(Array.from(f.subarray(7, f.length - 1))).toEqual(Array.from(syxEnc(Uint8Array.from([0x00, 0x00, 0x22, 0x00, 0x10, 0, 0, 0]))));
    expect(f[f.length - 1]).toBe(0xf7);
  });
  it("Antwort: Echo 0x55 an Index 7, Daten ab 9; fremde Antworten → null", () => {
    const data = Uint8Array.from([0x00, 0x00, 0x00, 0x00, 0x65, 0x6c, 0x65, 0x32]);
    const rx = Uint8Array.from([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x54, 0x55, 0x00, ...syxEnc(data), 0xf7]);
    expect(Array.from(parseFlashResponse(rx)!)).toEqual(Array.from(data));
    const ram = Uint8Array.from([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x54, 0x52, 0x00, ...syxEnc(data), 0xf7]);
    expect(parseFlashResponse(ram)).toBeNull();
    expect(parseFlashResponse(Uint8Array.from([0xf0, 0x7e, 0xf7]))).toBeNull();
  });
  it("Häppchen von 0x100", () => {
    const c = splitFlashRead(0, 0x210);
    expect(c.length).toBe(3);
    expect(c[2]).toEqual({ addr: 0x200, len: 0x10 });
  });
});

function flash(bild: Map<number, Uint8Array>): LesenFlash {
  return async (addr, len) => {
    for (const [base, b] of bild) if (addr >= base && addr + len <= base + b.length) return { ok: true, bytes: b.slice(addr - base, addr - base + len) };
    return { ok: false, reason: `kein Bild für 0x${addr.toString(16)}` };
  };
}
const asc = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

describe("geraeteFlash", () => {
  it("Kennungen: Stempel, Main-Version, PCM-Kopf", async () => {
    const user = new Uint8Array(16);
    user.set(asc("ele2sUSR"), 4);
    const ver = new Uint8Array(16);
    ver[4] = 2;
    ver[5] = 2;
    const pcm = asc("KORGelec2PCM\0\0\0\0");
    const k = await liesFlashKennungen(flash(new Map([[KENNUNG.userStempel, user], [KENNUNG.mainVersion, ver], [KENNUNG.pcmKopf, pcm]])));
    expect(k).toMatchObject({ stempel: "ele2sUSR", variante: "sampler", mainVersion: [2, 2, 0], pcm: { magicOk: true, format: "elec2PCM" }, fehler: [] });
    const t = kennungenText(k).join("\n");
    expect(t).toMatch(/electribe 2 sampler \(0x124\)/);
    expect(t).toMatch(/02\.02\.00/);
  });
  it("Fehler je Kennung, leere Version → null", async () => {
    const k = await liesFlashKennungen(flash(new Map([[KENNUNG.mainVersion, new Uint8Array(16).fill(0xff)]])));
    expect(k.mainVersion).toBeNull();
    expect(k.fehler.length).toBe(2);
    expect(k.stempel).toBeNull();
  });
  it("Boot-Sektor vom Gerät: 128 KiB, Befund", async () => {
    const bs = baueBootSektor(new Uint8Array([1, 2, 3]));
    const r = await liesBootSektorVomGeraet(flash(new Map([[0, bs]])));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.befund.ok).toBe(true);
    expect(r.bytes.length).toBe(0x20000);
    const kurz = await liesBootSektorVomGeraet(flash(new Map([[0, new Uint8Array(100)]])));
    expect(kurz.ok).toBe(false);
  });
});

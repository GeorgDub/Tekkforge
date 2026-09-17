/**
 * tests/bootloader-start.test.ts — SysEx-Loader (0x58 Pivot → Magic → 0x54 Häppchen → 0x57 Execute).
 * Ausgehende Frames werden über das Envelope geprüft und der Payload mit syxDec zurückdekodiert,
 * statt kodierte Bytes fest zu verdrahten. Der Runner-Test belegt vor allem den ABBRUCH: ohne
 * Pivot-Bestätigung darf KEIN Daten-Häppchen fließen.
 */
import { describe, it, expect } from "vitest";
import { syxDec, E2_PRODUCT_ID_SAMPLER } from "../src/core/e2sysex";
import {
  buildPivot, buildMagicTest, buildDataChunk, buildExecute,
  istMagicAntwort, istHaeppchenAck, inHaeppchen, starteBootloaderFluechtig,
  LOADER_CMD, LOADER_MAGIC, LOADER_MAGIC_REPLY, OC_RAM_START, OC_RAM_SIZE,
  type LoaderIO,
} from "../src/core/bootloaderStart";

/** Envelope prüfen und den kodierten Payload (zwischen msgId und F7) zurückgeben. */
function envelope(frame: Uint8Array, msgId: number, ch = 0, id = E2_PRODUCT_ID_SAMPLER) {
  expect(Array.from(frame.subarray(0, 6))).toEqual([0xf0, 0x42, 0x30 | ch, 0x00, 0x01, id]);
  expect(frame[6]).toBe(msgId & 0x7f);
  expect(frame[frame.length - 1]).toBe(0xf7);
  return frame.subarray(7, frame.length - 1);
}

describe("Loader-Frames", () => {
  it("Pivot 0x58 trägt acht 7-Bit-kodierte Null-Bytes", () => {
    const payload = envelope(buildPivot(), LOADER_CMD.pivot);
    expect(Array.from(syxDec(payload))).toEqual(new Array(8).fill(0));
  });

  it("Magic-Test schickt 64 01 23 45 67 ROH (nicht 7-Bit-kodiert)", () => {
    const f = buildMagicTest();
    expect(f[6]).toBe(LOADER_MAGIC[0]); // 0x64 als msgId
    expect(Array.from(f.subarray(7, f.length - 1))).toEqual([...LOADER_MAGIC.slice(1)]);
  });

  it("Execute 0x57 kodiert 0x80000000 little-endian + 4 reservierte Null-Bytes", () => {
    const payload = envelope(buildExecute(OC_RAM_START), LOADER_CMD.execute);
    expect(Array.from(syxDec(payload))).toEqual([0x00, 0x00, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00]);
  });

  it("Kanal und Produkt-ID landen im Kopf", () => {
    envelope(buildPivot({ channel: 5, productId: 0x23 }), LOADER_CMD.pivot, 5, 0x23);
  });

  it("Daten-Häppchen 0x54 dekodiert auf die 256 Roh-Bytes zurück", () => {
    const chunk = new Uint8Array(256);
    for (let i = 0; i < 256; i++) chunk[i] = (i * 7 + 3) & 0xff;
    const payload = envelope(buildDataChunk(chunk), LOADER_CMD.data);
    expect(Array.from(syxDec(payload))).toEqual(Array.from(chunk));
  });
});

describe("Antwort-Prüfung (tolerant)", () => {
  it("findet das Magic-Wort 76 54 32 10 irgendwo im Frame", () => {
    expect(istMagicAntwort(Uint8Array.from([0xf0, 0x42, 0x30, ...LOADER_MAGIC_REPLY, 0xf7]))).toBe(true);
    expect(istMagicAntwort(Uint8Array.from([0x76, 0x54, 0x32, 0x10]))).toBe(true);
  });
  it("lehnt ab, wenn das Magic-Wort fehlt", () => {
    expect(istMagicAntwort(Uint8Array.from([0xf0, 0x42, 0x00, 0x76, 0x54, 0x32, 0x11, 0xf7]))).toBe(false);
    expect(istMagicAntwort(new Uint8Array())).toBe(false);
    expect(istMagicAntwort(null)).toBe(false);
  });
  it("erkennt den Häppchen-ACK 0x21", () => {
    expect(istHaeppchenAck(Uint8Array.from([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x21, 0xf7]))).toBe(true);
    expect(istHaeppchenAck(Uint8Array.from([0xf0, 0x42, 0x22, 0xf7]))).toBe(false); // 0x22 = Fehler
  });
});

describe("inHaeppchen", () => {
  it("füllt das letzte Häppchen mit Nullen auf volle 256 (131022 B → 512 Häppchen)", () => {
    const image = new Uint8Array(131022);
    for (let i = 0; i < image.length; i++) image[i] = (i & 0xff) || 1; // keine Null, damit Padding sichtbar ist
    const chunks = inHaeppchen(image);
    expect(chunks.length).toBe(512);
    for (const c of chunks) expect(c.length).toBe(256);
    // 511*256 = 130816 → das letzte Häppchen trägt 206 echte Bytes, danach 50 Null-Bytes.
    const last = chunks[511];
    expect(image.length - 511 * 256).toBe(206);
    for (let i = 0; i < 206; i++) expect(last[i]).not.toBe(0);
    for (let i = 206; i < 256; i++) expect(last[i]).toBe(0);
    // Alle echten Bytes bleiben erhalten.
    const wieder = new Uint8Array(chunks.length * 256);
    chunks.forEach((c, i) => wieder.set(c, i * 256));
    expect(Array.from(wieder.subarray(0, image.length))).toEqual(Array.from(image));
  });
});

/** Test-IO: zeichnet gesendete Frames auf und liefert vorgegebene Antworten. */
function fakeIO(antworten: { magic?: Uint8Array; ack?: Uint8Array; magicWirft?: boolean }) {
  const gesendet: Uint8Array[] = []; // sende() (Pivot/Execute)
  const gefragt: Uint8Array[] = []; // sendeUndEmpfange() (Magic/Daten)
  const io: LoaderIO = {
    async sende(f) { gesendet.push(f); },
    async warte() { /* kein echtes Warten im Test */ },
    async sendeUndEmpfange(f) {
      gefragt.push(f);
      if (f[6] === LOADER_MAGIC[0]) {
        if (antworten.magicWirft) throw new Error("timeout");
        return antworten.magic ?? new Uint8Array();
      }
      return antworten.ack ?? new Uint8Array();
    },
  };
  return { io, gesendet, gefragt };
}

const magicOk = Uint8Array.from([0xf0, 0x42, 0x30, ...LOADER_MAGIC_REPLY, 0xf7]);
const ackOk = Uint8Array.from([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x21, 0xf7]);

describe("starteBootloaderFluechtig", () => {
  it("lädt alle Häppchen und führt am Ende aus, wenn Pivot + ACKs stimmen", async () => {
    const image = new Uint8Array(600); // 3 Häppchen
    const { io, gesendet, gefragt } = fakeIO({ magic: magicOk, ack: ackOk });
    const r = await starteBootloaderFluechtig(image, io);
    expect(r.ok).toBe(true);
    expect(r.schritt).toBe("fertig");
    expect(r.haeppchenGesendet).toBe(3);
    // sende(): Pivot + Execute. sendeUndEmpfange(): Magic + 3 Daten.
    expect(gesendet.length).toBe(2);
    expect(gesendet[0][6]).toBe(LOADER_CMD.pivot);
    expect(gesendet[1][6]).toBe(LOADER_CMD.execute);
    expect(gefragt.length).toBe(1 + 3);
    expect(gefragt[0][6]).toBe(LOADER_MAGIC[0]);
    expect(gefragt.slice(1).every((f) => f[6] === LOADER_CMD.data)).toBe(true);
  });

  it("bricht ab, wenn die Magic-Antwort fehlt — und schickt KEIN Häppchen", async () => {
    const { io, gesendet, gefragt } = fakeIO({ magic: new Uint8Array([0xf0, 0x42, 0xf7]) });
    const r = await starteBootloaderFluechtig(new Uint8Array(600), io);
    expect(r.ok).toBe(false);
    expect(r.schritt).toBe("magic");
    expect(gesendet.length).toBe(1); // nur der Pivot ging raus
    expect(gefragt.length).toBe(1); // nur der Magic-Test, danach STOPP
  });

  it("bricht ab, wenn der Magic-Test nicht antwortet (Timeout)", async () => {
    const { io, gefragt } = fakeIO({ magicWirft: true });
    const r = await starteBootloaderFluechtig(new Uint8Array(600), io);
    expect(r.ok).toBe(false);
    expect(r.schritt).toBe("magic");
    expect(gefragt.length).toBe(1);
  });

  it("bricht ab, wenn ein Häppchen nicht quittiert wird", async () => {
    const fehlerAck = Uint8Array.from([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x22, 0xf7]); // 0x22 statt 0x21
    const { io } = fakeIO({ magic: magicOk, ack: fehlerAck });
    const r = await starteBootloaderFluechtig(new Uint8Array(600), io);
    expect(r.ok).toBe(false);
    expect(r.schritt).toBe("daten");
    expect(r.haeppchenGesendet).toBe(0);
  });

  it("weist ein zu großes Image ab, ohne irgendetwas zu senden", async () => {
    const { io, gesendet, gefragt } = fakeIO({ magic: magicOk, ack: ackOk });
    const r = await starteBootloaderFluechtig(new Uint8Array(OC_RAM_SIZE + 1), io);
    expect(r.ok).toBe(false);
    expect(gesendet.length).toBe(0);
    expect(gefragt.length).toBe(0);
  });
});

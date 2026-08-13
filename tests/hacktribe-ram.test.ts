/**
 * tests/hacktribe-ram.test.ts
 *
 * Der Schwerpunkt liegt auf {@link validateRamRange}: dieser Bereichsschutz IST
 * die Sicherheitsgeschichte des Moduls. Stimmt er nicht, ist die Absicherung
 * Dekoration. Deshalb wird er gegnerisch geprueft (Grenzen, Ueberlaeufe,
 * Boot-Loader-Gebiet), nicht nur mit einem gluecklichen Fall.
 *
 * Was hier NICHT belegt wird: dass RAM-Zugriff am Geraet funktioniert.
 * Bereichspruefung, Frame-Bau und Antwort-Auswertung sind offline pruefbar und
 * geprueft; ein echter Geraete-Durchlauf ist nicht gefahren.
 */

import { describe, it, expect } from "vitest";
import {
  RAM_CMD,
  RAM_ACK_CMD,
  DDR2_BASE,
  DDR2_END,
  E2_RAM_MAP,
  findRamMapEntry,
  addressForSlot,
  validateRamRange,
  u32le,
  readU32le,
  encodeAddrLen,
  buildRamReadRequest,
  buildRamWriteFrames,
  parseRamResponse,
  splitRamWrite,
  splitRamRead,
  parseHexBytes,
  formatHexDump,
  parseAddress,
  verifyRamWrite,
  RAM_WRITE_CHUNK,
} from "../src/core/hacktribeRam";
import { syxEnc, buildFrame } from "../src/core/e2sysex";
import { FX_EDIT_BUFFER_BASE, FX_EDIT_BUFFER_STRIDE } from "../src/core/e2FxParams";

describe("Kommando-Umfang — Flash und Execute fehlen absichtlich", () => {
  it("kennt genau drei Kommandos: lesen, Adresse setzen, Daten schreiben", () => {
    // Sperrt die Auslassung: 0x55/0x56 (Flash) ueberleben den Power-Cycle,
    // 0x57 (Execute) springt in fremden Code. Wer hier ergaenzt, soll erst
    // diesen Test aendern muessen.
    expect(Object.keys(RAM_CMD).sort()).toEqual([
      "read",
      "setWriteAddress",
      "writeData",
    ]);
    expect(Object.values(RAM_CMD)).toEqual([0x52, 0x53, 0x54]);
    expect(Object.values(RAM_CMD)).not.toContain(0x55);
    expect(Object.values(RAM_CMD)).not.toContain(0x56);
    expect(Object.values(RAM_CMD)).not.toContain(0x57);
  });
});

describe("validateRamRange — der Bereichsschutz", () => {
  it("sperrt den On-Chip-RAM des Boot-Loaders", () => {
    const r = validateRamRange(0x80000000, 4);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("0x80000000");
  });

  it("laesst die untere Grenze zu und alles darunter nicht", () => {
    expect(validateRamRange(DDR2_BASE, 1).ok).toBe(true);
    expect(validateRamRange(DDR2_BASE - 1, 1).ok).toBe(false); // 0xBFFFFFFF
  });

  it("laesst das letzte Byte im Fenster zu, das erste dahinter nicht", () => {
    expect(validateRamRange(DDR2_END - 1, 1).ok).toBe(true); // 0xCFFFFFFF
    expect(validateRamRange(DDR2_END, 1).ok).toBe(false); // 0xD0000000
  });

  it("erkennt einen Bereich, der im Fenster beginnt und darueber hinausreicht", () => {
    const r = validateRamRange(0xcfffff00, 0x200);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Ende");
  });

  it("weist unsinnige Laengen zurueck", () => {
    expect(validateRamRange(DDR2_BASE, 0).ok).toBe(false);
    expect(validateRamRange(DDR2_BASE, -1).ok).toBe(false);
    expect(validateRamRange(DDR2_BASE, 1.5).ok).toBe(false);
  });

  it("weist unsinnige Adressen zurueck", () => {
    expect(validateRamRange(-1, 4).ok).toBe(false);
    expect(validateRamRange(1.5, 4).ok).toBe(false);
    expect(validateRamRange(Number.NaN, 4).ok).toBe(false);
    expect(validateRamRange(Number.POSITIVE_INFINITY, 4).ok).toBe(false);
  });

  it("deckt jeden Eintrag der RAM-Karte ab (Anfang und letzter Slot)", () => {
    for (const e of E2_RAM_MAP) {
      expect(validateRamRange(e.base, e.size).ok).toBe(true);
      expect(validateRamRange(addressForSlot(e, e.count - 1), e.size).ok).toBe(true);
    }
  });
});

describe("RAM-Karte", () => {
  it("klemmt Slot-Indizes in den gueltigen Bereich", () => {
    const fx = findRamMapEntry("fxEditBuffer")!;
    expect(addressForSlot(fx, 0)).toBe(FX_EDIT_BUFFER_BASE);
    expect(addressForSlot(fx, 1)).toBe(FX_EDIT_BUFFER_BASE + FX_EDIT_BUFFER_STRIDE);
    expect(addressForSlot(fx, -5)).toBe(FX_EDIT_BUFFER_BASE);
    expect(addressForSlot(fx, 9999)).toBe(addressForSlot(fx, fx.count - 1));
  });

  it("haelt die Strukturen ueberschneidungsfrei", () => {
    const spans = E2_RAM_MAP.map((e) => ({
      key: e.key,
      from: e.base,
      to: e.base + e.stride * e.count,
    })).sort((a, b) => a.from - b.from);
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i].from).toBeGreaterThanOrEqual(spans[i - 1].to);
    }
  });

  it("bezieht die FX-Edit-Buffer-Adressen aus e2FxParams (eine Quelle)", () => {
    expect(findRamMapEntry("fxEditBuffer")!.base).toBe(FX_EDIT_BUFFER_BASE);
  });
});

describe("Adress-/Laengen-Kodierung", () => {
  it("schreibt 32-Bit-Werte little-endian", () => {
    expect(u32le(0xc00a80f0)).toEqual([0xf0, 0x80, 0x0a, 0xc0]);
    expect(readU32le(u32le(0xc00a80f0))).toBe(0xc00a80f0);
  });

  it("baut den 8-Byte-Rumpf addr+len", () => {
    const b = encodeAddrLen(0xc0000004, 0x10);
    expect([...b]).toEqual([0x04, 0x00, 0x00, 0xc0, 0x10, 0x00, 0x00, 0x00]);
  });

  it("baut eine Leseanfrage mit Kommando 0x52", () => {
    const f = buildRamReadRequest(0xc00a80f0, 0x20c);
    expect(f[0]).toBe(0xf0);
    expect(f[1]).toBe(0x42);
    expect(f[6]).toBe(RAM_CMD.read);
    expect(f[f.length - 1]).toBe(0xf7);
  });
});

describe("Antwort-Auswertung", () => {
  it("liest die Daten aus der Geraeteantwort ab Index 9", () => {
    // Am Geraet aufgezeichnet (2026-08-11), nicht hergeleitet: auf ein 0x52
    // antwortet das Geraet mit cmd 0x54 und echot das 0x52 an Index 7.
    const payload = Uint8Array.from([0xde, 0xad, 0xbe, 0xef]);
    const frame = buildFrame(RAM_CMD.writeData, [
      RAM_CMD.read,
      0x00,
      ...syxEnc(payload),
    ]);
    const r = parseRamResponse(frame);
    expect(r?.kind).toBe("data");
    if (r?.kind === "data") expect([...r.data]).toEqual([...payload]);
  });

  it("erkennt das Write-ACK", () => {
    expect(parseRamResponse(buildFrame(RAM_ACK_CMD))?.kind).toBe("ack");
  });

  it("meldet fremde Kommandos als unbekannt statt sie zu deuten", () => {
    expect(parseRamResponse(buildFrame(0x7a))?.kind).toBe("unknown");
  });

  it("gibt null fuer Nicht-KORG-Rahmen", () => {
    expect(parseRamResponse(Uint8Array.from([0xf0, 0x7d, 0x01, 0xf7]))).toBeNull();
  });
});

describe("Chunking und Write-Frames", () => {
  it("teilt wie die Urquelle: einmal bei 0x100, Rest am Stueck", () => {
    // hacktribe set_ifx: ifx[:0x100] + ifx[0x100:] -> 256 + 268 fuer 524 B.
    const data = new Uint8Array(0x20c);
    const chunks = splitRamWrite(0xc00a80f0, data);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].addr).toBe(0xc00a80f0);
    expect(chunks[0].bytes.length).toBe(0x100);
    expect(chunks[1].addr).toBe(0xc00a80f0 + 0x100);
    expect(chunks[1].bytes.length).toBe(0x20c - 0x100); // 268, groesser als chunkSize
  });

  it("laesst kleine Schreibvorgaenge ungeteilt", () => {
    const chunks = splitRamWrite(0xc03478a8, new Uint8Array(0x72));
    expect(chunks).toHaveLength(1);
    expect(chunks[0].bytes.length).toBe(0x72);
  });

  it("gibt im festen Modus jedem Haeppchen seine eigene Adresse", () => {
    const data = new Uint8Array(0x250);
    const chunks = splitRamWrite(0xc0000000, data, RAM_WRITE_CHUNK, "fixed");
    expect(chunks).toHaveLength(3);
    expect(chunks[0].addr).toBe(0xc0000000);
    expect(chunks[1].addr).toBe(0xc0000000 + RAM_WRITE_CHUNK);
    expect(chunks[2].bytes.length).toBe(0x250 - 2 * RAM_WRITE_CHUNK);
  });

  it("teilt Lesevorgaenge analog auf", () => {
    const parts = splitRamRead(0xc0000000, 0x150);
    expect(parts).toHaveLength(2);
    expect(parts[1].len).toBe(0x50);
  });

  it("liefert Adresse und Daten immer paarweise — nie Daten ohne Adresse", () => {
    const r = buildRamWriteFrames(0xc00a80f0, new Uint8Array(0x150).fill(7));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.frames).toHaveLength(4); // 2 Haeppchen x (Adresse + Daten)
    expect(r.frames.map((f) => f[6])).toEqual([
      RAM_CMD.setWriteAddress,
      RAM_CMD.writeData,
      RAM_CMD.setWriteAddress,
      RAM_CMD.writeData,
    ]);
  });

  it("baut fuer einen unerlaubten Bereich gar keine Frames", () => {
    const r = buildRamWriteFrames(0x80000000, new Uint8Array(4));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("Boot-Loader");
  });
});

describe("Eingabe-Helfer", () => {
  it("parst Hex mit Trennern und 0x-Praefix", () => {
    const r = parseHexBytes("0xDE AD\nBE,EF");
    expect(r.ok).toBe(true);
    if (r.ok) expect([...r.bytes]).toEqual([0xde, 0xad, 0xbe, 0xef]);
  });

  it("meldet ein halbes Byte statt es zu raten", () => {
    expect(parseHexBytes("DEA").ok).toBe(false);
  });

  it("meldet Nicht-Hex-Zeichen und leere Eingabe", () => {
    expect(parseHexBytes("DEADZZ").ok).toBe(false);
    expect(parseHexBytes("").ok).toBe(false);
  });

  it("ueberlebt den Round-Trip, den die Oberflaeche fuehrt", () => {
    // Das RAM-Panel fuellt das Eingabefeld aus dem Hex-Dump, indem es die
    // Adress-Spalte abschneidet (8 Stellen + 2 Leerzeichen). Kaeme dabei etwas
    // anderes heraus als gelesen wurde, wuerde ein unveraenderter „Write"
    // fremde Bytes ins Geraet schreiben — also genau hier festnageln.
    const bytes = new Uint8Array(0x20c);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 7 + 3) & 0xff;
    const dump = formatHexDump(bytes, 0xc00a80f0);
    const editable = dump
      .split("\n")
      .map((l) => l.slice(10))
      .join("\n");
    const back = parseHexBytes(editable);
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.bytes.length).toBe(bytes.length);
      expect([...back.bytes]).toEqual([...bytes]);
    }
  });

  it("schreibt die Adress-Spalte achtstellig und in Grossbuchstaben", () => {
    const dump = formatHexDump(Uint8Array.from([0x0a, 0xff]), 0xc00a80f0);
    expect(dump.split("\n")[0]).toBe("C00A80F0  0A FF");
  });

  it("parst Adressen hexadezimal und dezimal", () => {
    const a = parseAddress("0xC00A80F0");
    expect(a.ok && a.addr).toBe(0xc00a80f0);
    const b = parseAddress("C00A80F0");
    expect(b.ok && b.addr).toBe(0xc00a80f0);
    const c = parseAddress("256");
    expect(c.ok && c.addr).toBe(256);
    expect(parseAddress("  ").ok).toBe(false);
  });
});

describe("verifyRamWrite — ein Write ohne Rueckleseprobe ist keiner", () => {
  it("meldet Gleichheit", () => {
    const a = Uint8Array.from([1, 2, 3]);
    expect(verifyRamWrite(a, Uint8Array.from([1, 2, 3]))).toEqual({
      ok: true,
      firstDiff: -1,
      diffCount: 0,
    });
  });

  it("nennt das erste abweichende Byte und die Anzahl", () => {
    const r = verifyRamWrite(
      Uint8Array.from([1, 2, 3, 4]),
      Uint8Array.from([1, 9, 3, 9]),
    );
    expect(r).toEqual({ ok: false, firstDiff: 1, diffCount: 2 });
  });

  it("behandelt Laengenunterschiede als Fehlschlag, nicht als Teilerfolg", () => {
    const r = verifyRamWrite(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2]));
    expect(r.ok).toBe(false);
    expect(r.diffCount).toBe(-1);
  });

  it("nennt zwei leere Puffer gleich", () => {
    expect(verifyRamWrite(new Uint8Array(0), new Uint8Array(0)).ok).toBe(true);
  });
});

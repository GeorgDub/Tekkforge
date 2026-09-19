/**
 * tests/sqez.test.ts — der SQEZ-Dekoder. Ein kleiner Encoder im Test baut gültige Ströme
 * (einheitliche Tabellen: alle 512 Symbole 9 Bit lang, Distanz immer 0 = Wiederholung des
 * Vorgängers), dazu der echte Gerätedump, wenn er lokal liegt.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { entpackeSqez, crc16Arc, liesSqezKopfDaten } from "../src/core/sqez";

class BitSchreiber {
  private bytes: number[] = [];
  private acc = 0;
  private n = 0;
  schreibe(wert: number, bits: number): void {
    for (let i = bits - 1; i >= 0; i--) {
      this.acc = (this.acc << 1) | ((wert >>> i) & 1);
      if (++this.n === 8) {
        this.bytes.push(this.acc);
        this.acc = 0;
        this.n = 0;
      }
    }
  }
  fertig(): Uint8Array {
    if (this.n) this.schreibe(0, 8 - this.n);
    return Uint8Array.from(this.bytes);
  }
}

/** Symbole: Zahl < 0x100 = Literal, { lauf } = Wiederholung des Vorgängers (Länge 3..258). */
type Symbol = number | { lauf: number };

/** Literale (8-Bit-Alphabet: alle 256 Literale Länge 8 → vollständiger Code, Code = Bytewert). */
function baueSqezLiterale(daten: Uint8Array): Uint8Array {
  const w = new BitSchreiber();
  const blocks = Math.ceil(daten.length / 60000) || 1;
  for (let b = 0; b < blocks; b++) {
    const teil = daten.subarray(b * 60000, (b + 1) * 60000);
    w.schreibe(teil.length, 16);
    w.schreibe(0, 5);
    w.schreibe(10, 5); // Längen-Alphabet einheitlich: Symbol 10 = Länge 8
    w.schreibe(256, 9); // 256 Längen à 8 (verbrauchen 0 Bits)
    w.schreibe(0, 4);
    w.schreibe(0, 4); // Distanz-Tabelle einheitlich Symbol 0
    for (const x of teil) w.schreibe(x, 8);
  }
  return rahmen(w.fertig(), daten);
}

function rahmen(strom: Uint8Array, entpackt: Uint8Array): Uint8Array {
  const out = new Uint8Array(0x0e + strom.length);
  out.set([0x53, 0x51, 0x45, 0x5a]);
  const u32 = (o: number, v: number) => {
    out[o] = v & 0xff;
    out[o + 1] = (v >>> 8) & 0xff;
    out[o + 2] = (v >>> 16) & 0xff;
    out[o + 3] = (v >>> 24) & 0xff;
  };
  u32(4, strom.length + 0x0e);
  u32(8, entpackt.length);
  const crc = crc16Arc(entpackt);
  out[0xc] = crc & 0xff;
  out[0xd] = crc >>> 8;
  out.set(strom, 0x0e);
  return out;
}

describe("crc16Arc / Kopf", () => {
  it("CRC-16/ARC: „123456789“ → 0xBB3D; Kopf wird gelesen", () => {
    expect(crc16Arc(new TextEncoder().encode("123456789"))).toBe(0xbb3d);
    const k = liesSqezKopfDaten(rahmen(new Uint8Array(0), new Uint8Array(0)));
    expect(k.ok).toBe(true);
    expect(k.entpackt).toBe(0);
    expect(liesSqezKopfDaten(new Uint8Array(16)).ok).toBe(false);
    expect(entpackeSqez(new Uint8Array(16)).ok).toBe(false);
  });
});

describe("entpackeSqez (synthetische Ströme)", () => {
  it("nur Literale, mehrere Blöcke, CRC stimmt", () => {
    const daten = new Uint8Array(150000);
    for (let i = 0; i < daten.length; i++) daten[i] = (i * 7 + (i >> 5)) & 0xff;
    const r = entpackeSqez(baueSqezLiterale(daten));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.crcOk).toBe(true);
    expect(Buffer.from(r.bytes).equals(Buffer.from(daten))).toBe(true);
  });
  it("Längen-Symbole mit Distanz 0 wiederholen den Vorgänger (9-Bit-Alphabet)", () => {
    // 512 Symbole à 9 Bit: Längen-Alphabet einheitlich Symbol 11 (= Länge 9), Zähler 512 geht nicht (9 Bit max 511)
    // → 511 Längen gelesen, das 512. Symbol bleibt 0 → Code unvollständig. Deshalb: Symbole 0..255 Länge 8 (Symbol 10)
    // und Symbole 256..383 Länge 9 … die Summe 256·2^8 + 128·2^7 überschreitet 2^16. Wir brauchen eine exakte
    // Kraft-Summe: 128 Literale à 8 Bit (0..127) + 256 Symbole à 9 Bit? Nicht mit einheitlicher Tabelle darstellbar.
    // Also: Längen-Alphabet mit ZWEI Codes (Symbol 10 und 11 je 1 Bit): 0 → Länge 8, 1 → Länge 9.
    const w = new BitSchreiber();
    const symbole: Symbol[] = [];
    const erwartet: number[] = [];
    for (let i = 0; i < 40; i++) {
      symbole.push(i & 0x7f);
      erwartet.push(i & 0x7f);
    }
    symbole.push({ lauf: 10 });
    for (let i = 0; i < 10; i++) erwartet.push(39 & 0x7f);
    symbole.push(5, 6, { lauf: 3 }, 7);
    erwartet.push(5, 6, 6, 6, 6, 7);
    w.schreibe(symbole.length, 16);
    // 19er-Tabelle: Zähler 12 Einträge, Längen: Symbole 0..9 = 0, Symbol 10 = 1, Symbol 11 = 1.
    // Ablauf: 3 Längen (0,0,0) in je 3 Bit, dann 2-Bit-Nullenlauf (3 → Symbole 3,4,5 = 0), dann 6..9 = 0 (je 3 Bit), 10 = 1, 11 = 1.
    w.schreibe(12, 5);
    w.schreibe(0, 3);
    w.schreibe(0, 3);
    w.schreibe(0, 3);
    w.schreibe(3, 2);
    w.schreibe(0, 3);
    w.schreibe(0, 3);
    w.schreibe(0, 3);
    w.schreibe(0, 3);
    w.schreibe(1, 3);
    w.schreibe(1, 3);
    // Literal/Längen-Längen: 128 × Länge 8 (Code 0), dann 256 × Länge 9 (Code 1) → 128·2^8 + 256·2^7 = 2^16 ✓
    w.schreibe(384, 9);
    for (let i = 0; i < 128; i++) w.schreibe(0, 1);
    for (let i = 0; i < 256; i++) w.schreibe(1, 1);
    // Distanz-Tabelle einheitlich Symbol 0
    w.schreibe(0, 4);
    w.schreibe(0, 4);
    // Kanonische Codes: Symbole 0..127 (Länge 8): Code = i; Symbole 128..383 (Länge 9): Code = 0x100 + (i-128)
    for (const s of symbole) {
      if (typeof s === "number") w.schreibe(s, 8);
      else w.schreibe(0x100 + (s.lauf + 0xfd - 128), 9);
    }
    const daten = Uint8Array.from(erwartet);
    const r = entpackeSqez(rahmen(w.fertig(), daten));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Array.from(r.bytes)).toEqual(erwartet);
    expect(r.crcOk).toBe(true);
  });
});

describe("SQEZ im echten Gerätedump (nur wenn er lokal liegt)", () => {
  const pfad = "G:/Downloads/TekkForge/Firmware/Flash-vom-Geraet-2026-09-16.bin";
  it.skipIf(!existsSync(pfad))("entpackt 250 × 0x4000, CRC stimmt, 243 Records wie in der Pattern-Region", () => {
    const d = new Uint8Array(readFileSync(pfad));
    const r = entpackeSqez(d, 0x640000);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.crcOk).toBe(true);
    expect(r.bytes.length).toBe(250 * 0x4000);
    let gleich = 0;
    for (let i = 0; i < 250; i++) {
      const a = r.bytes.subarray(i * 0x4000, (i + 1) * 0x4000);
      const b = d.subarray(0x240000 + i * 0x4000, 0x240000 + (i + 1) * 0x4000);
      if (Buffer.from(a).equals(Buffer.from(b))) gleich++;
    }
    expect(gleich).toBe(243);
    expect(String.fromCharCode(...r.bytes.subarray(0x10, 0x19))).toBe("Advi$ory1");
  });
});

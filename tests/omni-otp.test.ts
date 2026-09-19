import { describe, it, expect } from "vitest";
import { buildPeek, istPeekAntwort, parsePeek, peekU32 } from "../src/core/otp";

describe("OTP Peek (0x52)", () => {
  it("baut den Sonderrahmen F0 7D 01 02 52 ... F7", () => {
    const f = buildPeek(0xc2200084, 4);
    expect(f[0]).toBe(0xf0);
    expect([f[1], f[2], f[3]]).toEqual([0x7d, 0x01, 0x02]);
    expect(f[4]).toBe(0x52);
    expect(f[f.length - 1]).toBe(0xf7);
  });
  it("Round-Trip: Anfrage-Nutzlast dekodiert zu addr+len zurueck", () => {
    const f = buildPeek(0x11223344, 16);
    const roh = parsePeek(f.slice(4), 8); // ab 0x52
    expect(roh).not.toBeNull();
    expect(Array.from(roh!.slice(0, 4))).toEqual([0x44, 0x33, 0x22, 0x11]);
    expect(Array.from(roh!.slice(4, 8))).toEqual([16, 0, 0, 0]);
  });
  it("istPeekAntwort erkennt 0x52 und weist Fremdrahmen ab", () => {
    expect(istPeekAntwort(Uint8Array.of(0xf0, 0x7d, 0x01, 0x02, 0x52, 0x00, 0xf7))).toBe(true);
    expect(istPeekAntwort(Uint8Array.of(0xf0, 0x42, 0x00, 0xf7))).toBe(false);
  });
  it("peekU32 liest LE-u32 aus einer Antwort", () => {
    const antwort = Uint8Array.of(0xf0, 0x7d, 0x01, 0x02, 0x52, 0b0000, 0x78, 0x56, 0x34, 0x12, 0xf7);
    expect(peekU32(antwort)).toBe(0x12345678);
  });
});

/** tests/md5.test.ts — MD5 gegen die RFC-1321-Testvektoren. */
import { describe, it, expect } from "vitest";
import { md5Hex } from "../src/core/md5";

const enc = (s: string) => new TextEncoder().encode(s);

describe("md5Hex", () => {
  it("RFC-1321-Vektoren", () => {
    expect(md5Hex(enc(""))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex(enc("a"))).toBe("0cc175b9c0f1b6a831c399e269772661");
    expect(md5Hex(enc("abc"))).toBe("900150983cd24fb0d6963f7d28e17f72");
    expect(md5Hex(enc("message digest"))).toBe("f96b697d7cb7938d525a2f31aaf161d0");
    expect(md5Hex(enc("abcdefghijklmnopqrstuvwxyz"))).toBe("c3fcd3d76192e4007dfb496cca67e13b");
    expect(md5Hex(enc("12345678901234567890123456789012345678901234567890123456789012345678901234567890"))).toBe("57edf4a22be3c955ac49da2e2107b67a");
  });
  it("Blockgrenzen (55, 56, 64, 120 Bytes)", () => {
    for (const n of [55, 56, 64, 120]) {
      expect(md5Hex(new Uint8Array(n).fill(0x61))).toMatch(/^[0-9a-f]{32}$/);
    }
    // 56 Bytes „a" — bekannter Vektor
    expect(md5Hex(new Uint8Array(56).fill(0x61))).toBe("3b0c8ac703f828b04c6c197006d17218");
  });
});

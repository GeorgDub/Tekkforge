import { describe, it, expect } from "vitest";
import {
  syxEnc,
  syxDec,
  buildCurrentPatternDump,
  buildPatternDump,
  buildCurrentPatternRequest,
  buildPatternRequest,
  buildSearchDevice,
  parseSearchReply,
  decodeDump,
  isKorgSysex,
  E2_MSG,
  E2_PRODUCT_ID_SYNTH,
  E2_PRODUCT_ID_SAMPLER,
} from "../src/core/e2sysex";
import { buildE2PatternBody } from "../src/core/e2sExport";
import { createPattern, patternToE2Input } from "../src/core/editorModel";

describe("e2sysex — KORG 8↔7-Bit-Codec", () => {
  it("matches the known vector for a leading MSB byte", () => {
    // syx_enc([0x80,0x01,0x02]) == [0x01,0x00,0x01,0x02] (high-bits byte first)
    expect([...syxEnc(Uint8Array.from([0x80, 0x01, 0x02]))]).toEqual([0x01, 0x00, 0x01, 0x02]);
  });

  it("round-trips arbitrary lengths (incl. non-multiples of 7)", () => {
    for (let len = 0; len <= 64; len++) {
      const src = new Uint8Array(len);
      for (let i = 0; i < len; i++) src[i] = (i * 37 + 11) & 0xff; // deterministisch, volle 8-bit
      const back = syxDec(syxEnc(src));
      expect([...back]).toEqual([...src]);
    }
  });

  it("round-trips a full 0x4000 pattern body", () => {
    const body = buildE2PatternBody(patternToE2Input(createPattern("SYX")));
    expect(body.length).toBe(0x4000);
    const enc = syxEnc(body);
    // Encoding vergrößert um ~1/7 (High-Bits-Bytes)
    expect(enc.length).toBeGreaterThan(body.length);
    expect([...syxDec(enc)]).toEqual([...body]);
  });

  it("payload bytes are all 7-bit (< 0x80)", () => {
    const body = buildE2PatternBody(patternToE2Input(createPattern("X")));
    expect(syxEnc(body).every((b) => b < 0x80)).toBe(true);
  });
});

describe("e2sysex — Message-Builder", () => {
  const body = buildE2PatternBody(patternToE2Input(createPattern("HELLO E2")));

  it("current pattern dump has the exact KORG header + is round-trippable", () => {
    const msg = buildCurrentPatternDump(body, { channel: 0, productId: E2_PRODUCT_ID_SAMPLER });
    expect([...msg.slice(0, 7)]).toEqual([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, 0x40]);
    expect(msg[msg.length - 1]).toBe(0xf7);
    expect(isKorgSysex(msg)).toBe(true);
    const dec = decodeDump(msg);
    expect(dec).not.toBeNull();
    expect(dec!.msgId).toBe(E2_MSG.currentPatternDump);
    expect(dec!.index).toBeNull();
    expect([...dec!.body]).toEqual([...body]);
  });

  it("synth product id and non-zero channel are encoded", () => {
    const msg = buildCurrentPatternDump(body, { channel: 5, productId: E2_PRODUCT_ID_SYNTH });
    expect([...msg.slice(0, 7)]).toEqual([0xf0, 0x42, 0x35, 0x00, 0x01, 0x23, 0x40]);
  });

  it("pattern dump to a slot preserves index and body (LSB,MSB wire order)", () => {
    const msg = buildPatternDump(body, 200, { channel: 0 });
    expect(msg[6]).toBe(E2_MSG.patternDump); // 0x4c
    // index 200 → lsb=72, msb=1 — LSB ZUERST (hardware-erprobtes e2pat2syx.py)
    expect(msg[7]).toBe(72);
    expect(msg[8]).toBe(1);
    const dec = decodeDump(msg)!;
    expect(dec.index).toBe(200);
    expect([...dec.body]).toEqual([...body]);
  });

  it("requests are short header-only frames", () => {
    const cur = buildCurrentPatternRequest();
    expect([...cur]).toEqual([0xf0, 0x42, 0x30, 0x00, 0x01, 0x24, E2_MSG.currentPatternRequest, 0xf7]);
    const req = buildPatternRequest(5);
    expect(req[6]).toBe(E2_MSG.patternRequest);
    expect(req[7]).toBe(5); // lsb zuerst
    expect(req[8]).toBe(0); // msb
    const req2 = buildPatternRequest(130);
    expect(req2[7]).toBe(2); // 130 % 128
    expect(req2[8]).toBe(1); // 130 / 128
  });

  it("search device frame is F0 42 50 00 00 F7", () => {
    expect([...buildSearchDevice()]).toEqual([0xf0, 0x42, 0x50, 0x00, 0x00, 0xf7]);
  });

  it("parses a search reply into channel/id/version", () => {
    const reply = Uint8Array.from([
      0xf0, 0x42, 0x50, 0x01, 0x00, 0x00, 0x24, 0x00, 0x00, 0x00, 0x02, 0x05, 0xf7,
    ]);
    const r = parseSearchReply(reply)!;
    expect(r.channel).toBe(0);
    expect(r.productId).toBe(0x24);
    expect(r.version).toBe("2.5");
  });

  it("rejects non-search / non-korg frames", () => {
    expect(parseSearchReply(Uint8Array.from([0xf0, 0x7e, 0x00]))).toBeNull();
    expect(decodeDump(Uint8Array.from([0xf0, 0x7e, 0x00, 0x01, 0x02, 0x03, 0x40, 0xf7]))).toBeNull();
    expect(isKorgSysex(Uint8Array.from([0xf0, 0x7e, 0xf7]))).toBe(false);
  });
});

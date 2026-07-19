import { describe, it, expect } from "vitest";
import { parseWav, encodeWav16, bytesToBase64, base64ToBytes } from "../src/core/wavCodec";

function sine(frames: number, freq: number, rate: number): Float32Array {
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) out[i] = Math.sin((2 * Math.PI * freq * i) / rate) * 0.8;
  return out;
}

describe("wavCodec", () => {
  it("round-trips mono 16-bit within quantization error", () => {
    const src = sine(1000, 440, 44100);
    const wav = encodeWav16(src, 44100, 1);
    const dec = parseWav(wav);
    expect(dec.sampleRate).toBe(44100);
    expect(dec.channels).toBe(1);
    expect(dec.frames).toBe(1000);
    let maxErr = 0;
    for (let i = 0; i < src.length; i++) maxErr = Math.max(maxErr, Math.abs(src[i] - dec.pcm[i]));
    // Asymmetrische 16-bit-Skalierung (×32767 pos / ÷32768) + Rundung → bis ~4e-5
    expect(maxErr).toBeLessThan(1 / 16384);
  });

  it("round-trips stereo interleaved", () => {
    const src = new Float32Array(200);
    for (let i = 0; i < 100; i++) {
      src[i * 2] = 0.5; // L
      src[i * 2 + 1] = -0.25; // R
    }
    const dec = parseWav(encodeWav16(src, 48000, 2));
    expect(dec.channels).toBe(2);
    expect(dec.frames).toBe(100);
    expect(dec.pcm[0]).toBeCloseTo(0.5, 3);
    expect(dec.pcm[1]).toBeCloseTo(-0.25, 3);
  });

  it("parses 32-bit float WAV", () => {
    // Manuell bauen: 44-Byte-Header + 4 Floats
    const vals = [0.1, -0.2, 0.3, -1.5]; // -1.5 bleibt beim Parsen erhalten (kein Clamp)
    const data = new Uint8Array(44 + vals.length * 4);
    const v = new DataView(data.buffer);
    const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) data[o + i] = s.charCodeAt(i); };
    w(0, "RIFF"); v.setUint32(4, 36 + vals.length * 4, true); w(8, "WAVE");
    w(12, "fmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 3, true); // IEEE float
    v.setUint16(22, 1, true);
    v.setUint32(24, 44100, true);
    v.setUint32(28, 44100 * 4, true);
    v.setUint16(32, 4, true);
    v.setUint16(34, 32, true);
    w(36, "data"); v.setUint32(40, vals.length * 4, true);
    vals.forEach((x, i) => v.setFloat32(44 + i * 4, x, true));
    const dec = parseWav(data);
    expect(dec.frames).toBe(4);
    expect(dec.pcm[0]).toBeCloseTo(0.1, 5);
    expect(dec.pcm[3]).toBeCloseTo(-1.5, 5);
  });

  it("clamps truncated data chunk instead of throwing", () => {
    const wav = encodeWav16(sine(100, 440, 44100), 44100, 1);
    const cut = wav.slice(0, wav.length - 50); // 25 Samples fehlen
    const dec = parseWav(cut);
    expect(dec.frames).toBe(75);
  });

  it("rejects non-WAV input", () => {
    expect(() => parseWav(new Uint8Array(100))).toThrow(/RIFF/);
  });

  it("encoder clamps out-of-range and NaN samples", () => {
    const src = new Float32Array([2, -2, NaN, 0]);
    const dec = parseWav(encodeWav16(src, 44100, 1));
    expect(dec.pcm[0]).toBeCloseTo(1, 3);
    expect(dec.pcm[1]).toBeCloseTo(-1, 3);
    expect(dec.pcm[2]).toBe(0);
  });

  it("base64 helpers round-trip", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128]);
    expect([...base64ToBytes(bytesToBase64(bytes))]).toEqual([...bytes]);
  });
});

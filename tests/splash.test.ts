import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import {
  SPLASH_BREITE,
  SPLASH_HOEHE,
  SPLASH_BYTES,
  leererSplash,
  splashZuPixel,
  pixelZuSplash,
  bildZuPixel,
  pixelZuPbm,
  pbmZuPixel,
  bildZuHelligkeit,
  helligkeitZuPixel,
} from "../src/core/splash";

/**
 * Der Startbildschirm: 1024 Bytes ↔ 128 × 64 Pixel. Die Wahrheit ist der
 * echte Hacktribe-Splash aus der Firmware, dekodiert mit hacktribes eigenem
 * `get_image` (Fixture, 2026-09-02) — das Logo war dabei lesbar, also stimmt
 * der Decoder, und unser Encoder muss dessen Umkehrung sein.
 */
const fixture = JSON.parse(fs.readFileSync("tests/fixtures/splash-hacktribe.json", "utf8")) as {
  bytes: number[];
  pixel: number[][];
};
const echteBytes = Uint8Array.from(fixture.bytes);
const echtePixel = Uint8Array.from(fixture.pixel.flat());

describe("splash — Codec", () => {
  it("Groessen", () => {
    expect(SPLASH_BREITE).toBe(128);
    expect(SPLASH_HOEHE).toBe(64);
    expect(SPLASH_BYTES).toBe(1024);
    expect(leererSplash().every((b) => b === 0xff)).toBe(true);
  });

  it("dekodiert den echten Hacktribe-Splash genau wie hacktribes get_image", () => {
    expect(Array.from(splashZuPixel(echteBytes))).toEqual(Array.from(echtePixel));
    expect(echtePixel.reduce((a, b) => a + b, 0)).toBe(1376); // dunkle Pixel im Logo
  });

  it("kodiert die Pixel byte-genau zurueck — Round-Trip in beide Richtungen", () => {
    expect(Array.from(pixelZuSplash(echtePixel))).toEqual(Array.from(echteBytes));
    const px = new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE);
    px[0] = 1; // (0,0)
    px[7 * SPLASH_BREITE] = 1; // (0,7)
    px[8 * SPLASH_BREITE] = 1; // (0,8)
    px[12 * SPLASH_BREITE + 5] = 1; // (5,12)
    px[63 * SPLASH_BREITE + 127] = 1; // (127,63)
    const b = pixelZuSplash(px);
    // Sonden aus dem Python-Decoder: byte 0 bit 7 = (0,0), byte 0 bit 0 = (0,7),
    // byte 128 bit 7 = (0,8), byte 133 bit 3 = (5,12), byte 1023 bit 0 = (127,63)
    expect(b[0]).toBe(0xff & ~0x80 & ~0x01);
    expect(b[128]).toBe(0xff & ~0x80);
    expect(b[133]).toBe(0xff & ~0x08);
    expect(b[1023]).toBe(0xff & ~0x01);
    expect(Array.from(splashZuPixel(b))).toEqual(Array.from(px));
  });

  it("lehnt falsche Groessen ab", () => {
    expect(() => splashZuPixel(new Uint8Array(10))).toThrow(/Bytes/);
    expect(() => pixelZuSplash(new Uint8Array(10))).toThrow(/Pixel/);
  });

  it("bildZuPixel: passt ein Bild seitenverhaeltnis-treu ein und schwellt nach Helligkeit", () => {
    // 256 × 64 (doppelt so breit): links schwarz, rechts weiss → links dunkel, mittig eingepasst auf 128 × 32
    const b = 256;
    const h = 64;
    const rgba = new Uint8Array(b * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < b; x++) {
        const i = (y * b + x) * 4;
        const v = x < 128 ? 0 : 255;
        rgba[i] = v;
        rgba[i + 1] = v;
        rgba[i + 2] = v;
        rgba[i + 3] = 255;
      }
    }
    const px = bildZuPixel(rgba, b, h);
    // Ziel: 128 × 32, vertikal mittig (Zeilen 16..47); linke Haelfte dunkel
    expect(px[16 * SPLASH_BREITE + 10]).toBe(1);
    expect(px[16 * SPLASH_BREITE + 100]).toBe(0);
    expect(px[5 * SPLASH_BREITE + 10]).toBe(0); // ueber dem eingepassten Bild: leer
    expect(px[47 * SPLASH_BREITE + 63]).toBe(1);
    expect(px[48 * SPLASH_BREITE + 63]).toBe(0);
    // invertiert
    expect(bildZuPixel(rgba, b, h, 128, true)[16 * SPLASH_BREITE + 100]).toBe(1);
  });

  it("bildZuPixel: transparente Pixel bleiben hell", () => {
    const rgba = new Uint8Array(128 * 64 * 4); // alles schwarz, aber Alpha 0
    expect(bildZuPixel(rgba, 128, 64).every((v) => v === 0)).toBe(true);
  });

  it("PBM mit Kommentarzeile (wie GIMP sie schreibt) wird gelesen", () => {
    const pbm = pixelZuPbm(echtePixel);
    const daten = pbm.subarray(new TextEncoder().encode("P4\n128 64\n").length);
    const kopf = new TextEncoder().encode("P4\n# CREATOR: GIMP PNM Filter Version 1.1\n128 64\n");
    const mit = new Uint8Array(kopf.length + daten.length);
    mit.set(kopf, 0);
    mit.set(daten, kopf.length);
    expect(Array.from(pbmZuPixel(mit))).toEqual(Array.from(echtePixel));
  });

  it("Helligkeitsstufe: einmal reduzieren, dann nur noch schwellen — gleiches Ergebnis wie bildZuPixel", () => {
    const b = 64;
    const h = 16; // 4:1 → eingepasst auf 128 × 32, oben und unten Rand
    const rgba = new Uint8Array(b * h * 4);
    for (let i = 0; i < b * h; i++) {
      const v = (i * 7) % 256;
      rgba.set([v, v, v, 255], i * 4);
    }
    const hell = bildZuHelligkeit(rgba, b, h);
    for (const schwelle of [40, 128, 200]) {
      expect(Array.from(helligkeitZuPixel(hell, schwelle))).toEqual(Array.from(bildZuPixel(rgba, b, h, schwelle)));
    }
    expect(hell[0]).toBe(-1); // oben: ausserhalb des eingepassten Bereichs
    expect(hell[16 * SPLASH_BREITE]).toBeGreaterThanOrEqual(0); // erste eingepasste Zeile
  });

  it("PBM hin und zurueck", () => {
    const pbm = pixelZuPbm(echtePixel);
    expect(new TextDecoder().decode(pbm.subarray(0, 2))).toBe("P4");
    expect(Array.from(pbmZuPixel(pbm))).toEqual(Array.from(echtePixel));
    expect(() => pbmZuPixel(new TextEncoder().encode("P1\n1 1\n0"))).toThrow(/P4/);
  });
});

import { describe, expect, it } from "vitest";
import { filterePool, poolRamMb, POOL_RAM_LIMIT_MB } from "../src/core/poolFilter";

const s = (number: number, name: string, kategorie?: string) => ({ number, name, kategorie });

const POOL = [s(12, "FactoryKick", "Kick"), s(501, "MeinKick"), s(502, "Snare X", "Snare"), s(610, "Hat Closed")];

describe("filterePool", () => {
  it("teilt Factory (bis 500) und User (ab 501)", () => {
    expect(filterePool(POOL, "factory", "").map((x) => x.number)).toEqual([12]);
    expect(filterePool(POOL, "user", "").map((x) => x.number)).toEqual([501, 502, 610]);
    expect(filterePool(POOL, "alle", "").length).toBe(4);
  });

  it("sucht ohne Gross/Klein in Name und Kategorie", () => {
    expect(filterePool(POOL, "alle", "kick").map((x) => x.number)).toEqual([12, 501]);
    expect(filterePool(POOL, "alle", "SNARE").map((x) => x.number)).toEqual([502]);
    expect(filterePool(POOL, "user", "kick").map((x) => x.number)).toEqual([501]);
  });

  it("leere Suche filtert nicht", () => {
    expect(filterePool(POOL, "alle", "  ").length).toBe(4);
  });
});

describe("poolRamMb", () => {
  it("rechnet 16-Bit-Mono bei 44,1 kHz", () => {
    // 10 Sekunden -> 10 * 44100 * 2 Bytes = 882000 B = 0.841 MB
    const mb = poolRamMb([{ pcm: { length: 441000 }, sampleRate: 44100 }]);
    expect(mb).toBeCloseTo(882000 / (1024 * 1024), 3);
  });

  it("zaehlt Bilder, nicht Spieldauer", () => {
    // Der Speicher haengt an der Bildzahl: zwei Bytes je Bild, mit der Rate,
    // mit der das Sample abgelegt ist. 480 000 Bilder brauchen also mehr Platz
    // als 441 000 — auch wenn beide zehn Sekunden lang sind.
    const a = poolRamMb([{ pcm: { length: 480000 }, sampleRate: 48000 }]);
    const b = poolRamMb([{ pcm: { length: 441000 }, sampleRate: 44100 }]);
    expect(a).toBeGreaterThan(b);
    expect(a / b).toBeCloseTo(480000 / 441000, 5);
  });

  it("halbe Rate, halber Speicher — die Grundlage der sparsamen Vocals", () => {
    const voll = poolRamMb([{ pcm: { length: 441000 }, sampleRate: 44100 }]);
    const sparsam = poolRamMb([{ pcm: { length: 220500 }, sampleRate: 22050 }]);
    expect(sparsam).toBeCloseTo(voll / 2, 5);
  });

  it("kennt das Geraete-Limit", () => {
    expect(POOL_RAM_LIMIT_MB).toBeCloseTo(24, 0);
  });
});

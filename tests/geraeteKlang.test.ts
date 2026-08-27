import { describe, it, expect } from "vitest";
import { wieAmGeraet, GERAET_RATE, SCHRITT_16BIT } from "../src/core/geraeteKlang";

function ton(sekunden: number, sr: number, hz = 220): Float32Array {
  const pcm = new Float32Array(Math.round(sr * sekunden));
  for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin((2 * Math.PI * hz * i) / sr) * 0.5;
  return pcm;
}

const dauer = (pcm: Float32Array): number => pcm.length / GERAET_RATE;

describe("wieAmGeraet", () => {
  it("liefert immer die Abspielrate des Geräts", () => {
    const r = wieAmGeraet(ton(1, 22050), 22050, {});
    expect(r.sampleRate).toBe(GERAET_RATE);
  });

  it("beachtet das Gerät die gespeicherte Rate, bleibt die Länge gleich", () => {
    const r = wieAmGeraet(ton(1, 22050), 22050, { rateBeachtet: true });
    expect(dauer(r.pcm)).toBeCloseTo(1, 2);
  });

  it("ignoriert es sie, läuft ein 22050er Sample doppelt so schnell", () => {
    // Genau die offene Frage bei den sparsamen Vocals: liest das Gerät die
    // Bilder stur mit 44,1 kHz, ist das Sample halb so lang und klingt hoch.
    const r = wieAmGeraet(ton(1, 22050), 22050, { rateBeachtet: false });
    expect(dauer(r.pcm)).toBeCloseTo(0.5, 2);
    expect(r.hinweise.join(" ")).toMatch(/doppelt|schneller/i);
  });

  it("bei 44,1 kHz macht die Frage keinen Unterschied", () => {
    const a = wieAmGeraet(ton(1, GERAET_RATE), GERAET_RATE, { rateBeachtet: true });
    const b = wieAmGeraet(ton(1, GERAET_RATE), GERAET_RATE, { rateBeachtet: false });
    expect(a.pcm.length).toBe(b.pcm.length);
    expect(b.hinweise).toEqual([]);
  });

  it("Varispeed verkürzt entsprechend", () => {
    const r = wieAmGeraet(ton(2, GERAET_RATE), GERAET_RATE, { rate: 2 });
    expect(dauer(r.pcm)).toBeCloseTo(1, 2);
  });

  it("quantisiert auf 16 Bit — so speichert das Gerät", () => {
    const pcm = new Float32Array([0.1234567, -0.7654321, 0.0000123]);
    const r = wieAmGeraet(pcm, GERAET_RATE, {});
    for (const v of r.pcm) {
      const stufen = v / SCHRITT_16BIT;
      // Toleranz nicht enger als die Float32-Genauigkeit des Puffers selbst —
      // sonst prüft der Test die Speicherbreite und nicht die Quantisierung.
      expect(Math.abs(stufen - Math.round(stufen))).toBeLessThan(1e-3);
    }
  });

  it("übersteuerte Werte werden geklemmt, nicht umgeklappt", () => {
    // Ohne Klemmen liefe 1,4 im 16-Bit-Wort über und käme als NEGATIVER Wert
    // heraus — aus einem lauten Sample würde ein Knacken.
    const r = wieAmGeraet(new Float32Array([1.4, -1.9]), GERAET_RATE, {});
    expect(r.pcm[0]).toBeGreaterThan(0.99);
    expect(r.pcm[1]).toBeLessThan(-0.99);
    expect(r.hinweise.join(" ")).toMatch(/übersteuert|geklemmt/i);
  });

  it("ein leeres Sample ergibt ein leeres Ergebnis statt eines Fehlers", () => {
    const r = wieAmGeraet(new Float32Array(0), GERAET_RATE, {});
    expect(r.pcm.length).toBe(0);
  });

  it("Stereo wird auf einen Kanal gelegt — die Electribe spielt einkanalig", () => {
    // Links laut, rechts still: der Mittelwert liegt bei der Hälfte.
    const stereo = new Float32Array([0.8, 0, 0.8, 0, 0.8, 0]);
    const r = wieAmGeraet(stereo, GERAET_RATE, { kanaele: 2 });
    expect(r.pcm.length).toBe(3);
    expect(r.pcm[0]).toBeCloseTo(0.4, 2);
    expect(r.hinweise.join(" ")).toMatch(/Kanal/i);
  });
});

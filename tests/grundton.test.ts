import { describe, it, expect } from "vitest";
import { grundtonYin, bassNoten, midiVon, noteFuerBassSample } from "../src/core/grundton";

const SR = 44100;
/** Bass-Ton mit Obertoenen und Huellkurve — wie ein gezupfter Synth-Bass. */
function ton(hz: number, sek: number): Float32Array {
  const n = Math.round(sek * SR);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const env = Math.exp(-t * 2);
    out[i] = env * (0.6 * Math.sin(2 * Math.PI * hz * t) + 0.25 * Math.sin(2 * Math.PI * 2 * hz * t) + 0.1 * Math.sin(2 * Math.PI * 3 * hz * t));
  }
  return out;
}
function folge(hzListe: (number | null)[], sekJe: number): Float32Array {
  const out = new Float32Array(Math.round(hzListe.length * sekJe * SR));
  hzListe.forEach((hz, k) => {
    if (hz === null) return;
    out.set(ton(hz, sekJe), Math.round(k * sekJe * SR));
  });
  return out;
}

describe("grundton", () => {
  it("midiVon: 440 Hz = 69, 55 Hz = 33, 82,4 Hz = 40", () => {
    expect(midiVon(440)).toBe(69);
    expect(midiVon(55)).toBe(33);
    expect(midiVon(82.41)).toBe(40);
  });

  it("grundtonYin findet 55 Hz und 110 Hz, nicht die Obertoene; Stille ergibt null", () => {
    const a = grundtonYin(ton(55, 0.5), SR)!;
    expect(a).not.toBeNull();
    expect(Math.abs(a.hz - 55)).toBeLessThan(1.5);
    expect(a.sicherheit).toBeGreaterThan(0.8);
    const b = grundtonYin(ton(110, 0.5), SR)!;
    expect(Math.abs(b.hz - 110)).toBeLessThan(2);
    expect(grundtonYin(new Float32Array(SR), SR)).toBeNull();
    expect(grundtonYin(new Float32Array(500), SR)).toBeNull();
  });

  it("bassNoten: eine Note je Viertel, Pausen als null", () => {
    // 120 BPM: ein Viertel = 0,5 s, ein Takt = 4 Viertel
    const pcm = folge([55, 55, 82.41, null, 65.41, 65.41, 73.42, 73.42], 0.5);
    const noten = bassNoten(pcm, SR, 120, 2);
    expect(noten).toHaveLength(8);
    expect(noten.slice(0, 3)).toEqual([33, 33, 40]);
    expect(noten[3]).toBeNull();
    expect(noten.slice(4)).toEqual([36, 36, 38, 38]);
  });

  it("noteFuerBassSample legt die Tonklasse in 48…59", () => {
    expect(noteFuerBassSample(33)).toBe(57); // A
    expect(noteFuerBassSample(36)).toBe(48); // C
    expect(noteFuerBassSample(40)).toBe(52); // E
    expect(noteFuerBassSample(71)).toBe(59); // B
  });
});

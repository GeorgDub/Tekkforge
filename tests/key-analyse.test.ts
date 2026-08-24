import { describe, expect, it } from "vitest";
import { camelotVon, tonartErkennen, tonartName } from "../src/core/keyAnalyse";

const SR = 22050;

/** Sinus-Akkordfolge: je Akkord 0,5 s, Noten als MIDI-Nummern. */
function folge(akkorde: number[][]): Float32Array {
  const je = Math.round(SR * 0.5);
  const out = new Float32Array(je * akkorde.length);
  akkorde.forEach((noten, a) => {
    for (let i = 0; i < je; i++) {
      let v = 0;
      for (const n of noten) v += Math.sin(2 * Math.PI * 440 * Math.pow(2, (n - 69) / 12) * (i / SR));
      out[a * je + i] = (v / noten.length) * 0.8;
    }
  });
  return out;
}

describe("camelotVon", () => {
  it("kennt die Ankerpunkte des Rads", () => {
    expect(camelotVon(0, true)).toBe("8B"); // C-Dur
    expect(camelotVon(9, false)).toBe("8A"); // a-Moll
    expect(camelotVon(7, true)).toBe("9B"); // G-Dur
    expect(camelotVon(4, false)).toBe("9A"); // e-Moll
    expect(camelotVon(5, true)).toBe("7B"); // F-Dur
    expect(camelotVon(2, false)).toBe("7A"); // d-Moll
  });
});

describe("tonartName", () => {
  it("benennt Dur und Moll deutsch", () => {
    expect(tonartName(0, true)).toBe("C-Dur");
    expect(tonartName(9, false)).toBe("A-Moll");
    expect(tonartName(10, true)).toBe("B-Dur"); // deutsches B = engl. Bb
  });
});

describe("tonartErkennen", () => {
  it("erkennt eine C-Dur-Kadenz", () => {
    // C-Dur, F-Dur, G-Dur, C-Dur (Grundstellung um C4)
    const pcm = folge([
      [60, 64, 67], [53, 57, 60], [55, 59, 62], [48, 60, 64, 67],
    ]);
    const t = tonartErkennen(pcm, SR);
    expect(t.dur).toBe(true);
    expect(t.grundton).toBe(0);
    expect(t.camelot).toBe("8B");
  });

  it("erkennt eine a-Moll-Kadenz", () => {
    // Am, Dm, E, Am — die Dominante mit gis trennt Moll von C-Dur
    const pcm = folge([
      [57, 60, 64], [50, 53, 57], [52, 56, 59], [45, 57, 60, 64],
    ]);
    const t = tonartErkennen(pcm, SR);
    expect(t.dur).toBe(false);
    expect(t.grundton).toBe(9);
    expect(t.camelot).toBe("8A");
  });

  it("liefert bei Stille keine sichere Aussage", () => {
    const t = tonartErkennen(new Float32Array(SR), SR);
    expect(t.konfidenz).toBeLessThan(0.2);
  });
});

import { describe, it, expect } from "vitest";
import { rmsNormalize, rmsVon, weichBegrenzen } from "../src/core/audioProcessor";

const db = (x: number) => 20 * Math.log10(x);

function sinus(laenge: number, amplitude: number): Float32Array {
  const pcm = new Float32Array(laenge);
  for (let i = 0; i < laenge; i++) pcm[i] = Math.sin((2 * Math.PI * 100 * i) / 44100) * amplitude;
  return pcm;
}

/** Kurze Spitze, viel Stille — genau das Profil einer Gesangsphrase. */
function phrase(laenge: number, amplitude: number, anteil = 0.15): Float32Array {
  const pcm = new Float32Array(laenge);
  const n = Math.round(laenge * anteil);
  for (let i = 0; i < n; i++) pcm[i] = Math.sin((2 * Math.PI * 200 * i) / 44100) * amplitude;
  return pcm;
}

describe("rmsNormalize", () => {
  it("hebt ein leises Sample auf den Zielpegel", () => {
    const r = rmsNormalize(sinus(44100, 0.05), -12);
    expect(db(rmsVon(r))).toBeCloseTo(-12, 1);
  });

  it("senkt ein zu lautes Sample auf den Zielpegel", () => {
    const r = rmsNormalize(sinus(44100, 0.9), -20);
    expect(db(rmsVon(r))).toBeCloseTo(-20, 1);
  });

  it("die Spitze wird nie überschritten — lieber leiser als übersteuert", () => {
    // Eine Phrase mit viel Stille braucht viel Verstärkung, um im RMS-Ziel zu
    // landen. Die Spitze setzt dem eine Grenze; genau die muss halten.
    const r = rmsNormalize(phrase(44100, 0.5), 0, 0.95);
    let peak = 0;
    for (const v of r) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(0.95 + 1e-6);
    expect(db(rmsVon(r))).toBeLessThan(0);
  });

  it("gleicht die Lautheit zweier verschieden dichter Signale an", () => {
    // Der eigentliche Zweck: ein dichtes und ein lückenhaftes Sample sollen
    // hinterher gleich laut wirken, nicht gleiche Spitzen haben.
    const dicht = rmsNormalize(sinus(44100, 0.2), -14);
    const luecken = rmsNormalize(phrase(44100, 0.2, 0.6), -14);
    expect(Math.abs(db(rmsVon(dicht)) - db(rmsVon(luecken)))).toBeLessThan(0.5);
  });

  it("Stille bleibt Stille statt unendlich verstärkt zu werden", () => {
    const r = rmsNormalize(new Float32Array(1000), -12);
    expect(r.every((v) => v === 0)).toBe(true);
  });

  it("das Original bleibt unberührt", () => {
    const quelle = sinus(1000, 0.1);
    const kopie = quelle.slice();
    rmsNormalize(quelle, -6);
    expect(Array.from(quelle)).toEqual(Array.from(kopie));
  });

  it("ein leeres Sample ergibt ein leeres Ergebnis", () => {
    expect(rmsNormalize(new Float32Array(0), -12).length).toBe(0);
  });
});

describe("weichBegrenzen", () => {
  it("haelt die Decke ein", () => {
    const laut = sinus(1000, 2.5);
    const r = weichBegrenzen(laut, 0.95);
    for (const v of r) expect(Math.abs(v)).toBeLessThanOrEqual(0.95 + 1e-6);
  });

  it("laesst leise Stellen praktisch unangetastet", () => {
    // Weich heisst: das Signal wird nicht generell verbogen, nur die Spitzen
    // werden eingefangen. Sonst klaenge alles gleich matt.
    const leise = sinus(1000, 0.1);
    const r = weichBegrenzen(leise, 0.95);
    for (let i = 0; i < leise.length; i++) expect(Math.abs(r[i] - leise[i])).toBeLessThan(0.005);
  });

  it("bleibt monoton — lauter rein heisst nicht leiser raus", () => {
    const a = weichBegrenzen(new Float32Array([0.5]), 0.95)[0];
    const b = weichBegrenzen(new Float32Array([0.9]), 0.95)[0];
    expect(b).toBeGreaterThan(a);
  });
});

describe("rmsNormalize mit weicher Begrenzung", () => {
  it("holt aus einer spitzen Phrase deutlich mehr Lautheit heraus", () => {
    // Ein Signal mit viel Pause laesst sich nicht beliebig laut machen: die
    // Spitze bremst. Mit harter Grenze bleibt es, wie es ist; mit weicher
    // Begrenzung werden die Spitzen eingefangen und der Rest kommt hoch.
    // Genau das ist der Unterschied zwischen „unhoerbar" und „sitzt".
    // Gemessen an diesem Kunstsignal: rund 1,2 dB. Viel ist das nicht — bei
    // einer Phrase, die zu 92 % aus Stille besteht, ist mehr auch nicht drin,
    // ohne sie zu verbiegen. Der grosse Gewinn liegt bei den Segmenten, die
    // schlicht leise sind statt spitz; die kommen um ein Vielfaches hoch.
    const p = phrase(44100, 0.95, 0.08);
    const hart = rmsNormalize(p, -8);
    const weich = rmsNormalize(p, -8, 0.95, { weich: true });
    expect(db(rmsVon(weich))).toBeGreaterThan(db(rmsVon(hart)) + 1);
    let peak = 0;
    for (const v of weich) peak = Math.max(peak, Math.abs(v));
    expect(peak).toBeLessThanOrEqual(0.95 + 1e-6);
  });

  it("ein Signal, das das Ziel ohne Begrenzung erreicht, wird nicht verbogen", () => {
    const leise = sinus(44100, 0.05);
    const weich = rmsNormalize(leise, -12, 0.95, { weich: true });
    expect(db(rmsVon(weich))).toBeCloseTo(-12, 0);
  });
});

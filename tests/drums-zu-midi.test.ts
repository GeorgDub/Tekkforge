import { describe, it, expect } from "vitest";
import { findeOnsets, drumSchlaege, transkribiereDrums, klassifiziere, DRUM_NOTEN } from "../src/core/drumsZuMidi";
import { AUDIO_TPQ } from "../src/core/audioZuMidi";

const SR = 44100;

/** Deterministisches Rauschen (LCG). */
function rauschen(n: number, seed = 7): Float32Array {
  const out = new Float32Array(n);
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    out[i] = (x / 0xffffffff) * 2 - 1;
  }
  return out;
}
/** Einfacher Hochpass (Differenz), ein paar Mal — laesst nur Hoehen durch. */
function hochpass(x: Float32Array, mal = 3): Float32Array {
  let y = x;
  for (let r = 0; r < mal; r++) {
    const z = new Float32Array(y.length);
    for (let i = 1; i < y.length; i++) z[i] = y[i] - y[i - 1];
    y = z;
  }
  return y;
}
const huelle = (n: number, ausklingS: number) => Array.from({ length: n }, (_, i) => Math.exp(-i / (SR * ausklingS)));

function kick(): Float32Array {
  const n = Math.round(SR * 0.35);
  const h = huelle(n, 0.09);
  const out = new Float32Array(n);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const hz = 120 * Math.exp(-i / (SR * 0.03)) + 50;
    ph += (2 * Math.PI * hz) / SR;
    out[i] = Math.sin(ph) * h[i] * 0.9;
  }
  return out;
}
function snare(): Float32Array {
  const n = Math.round(SR * 0.25);
  const h = huelle(n, 0.06);
  const r = rauschen(n, 3);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = (r[i] * 0.5 + Math.sin((2 * Math.PI * 190 * i) / SR) * 0.4) * h[i];
  return out;
}
function hat(lang: boolean): Float32Array {
  const n = Math.round(SR * (lang ? 0.35 : 0.06));
  const h = huelle(n, lang ? 0.12 : 0.015);
  const r = hochpass(rauschen(n, 11));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r[i] * h[i] * 0.4;
  return out;
}
function clap(): Float32Array {
  const n = Math.round(SR * 0.05);
  const h = huelle(n, 0.012);
  const r = hochpass(rauschen(n, 5), 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = r[i] * h[i] * 0.6;
  return out;
}

/** Vorlauf vor dem Takt — ein Anschlag bei Sekunde 0 haette kein „davor“ fuer die Differenzkurve. */
const VORLAUF_STEPS = 2; // 0,25 s bei 120 BPM
/** Ein Takt bei 120 BPM (2 s) nach 0,25 s Stille: Kick auf 1 und 3, Snare auf 2 und 4, Hats auf jeder 8tel, offene Hat auf 4+. Steps ohne Vorlauf. */
function takt(): { pcm: Float32Array; erwartet: { step: number; klasse: string }[] } {
  const pcm = new Float32Array(SR * 2 + SR);
  const mische = (sig: Float32Array, step: number) => {
    const ab = Math.round(((step + VORLAUF_STEPS) * SR * 2) / 16);
    for (let i = 0; i < sig.length && ab + i < pcm.length; i++) pcm[ab + i] += sig[i];
  };
  const erwartet: { step: number; klasse: string }[] = [];
  for (const s of [0, 8]) {
    mische(kick(), s);
    erwartet.push({ step: s, klasse: "Kick" });
  }
  for (const s of [4, 12]) {
    mische(snare(), s);
    erwartet.push({ step: s, klasse: "Snare" });
  }
  for (const s of [2, 6, 10]) {
    mische(hat(false), s);
    erwartet.push({ step: s, klasse: "HiHat cl" });
  }
  mische(hat(true), 14);
  erwartet.push({ step: 14, klasse: "HiHat op" });
  return { pcm, erwartet };
}

describe("drumsZuMidi", () => {
  it("Klassifizierung nach Merkmalen", () => {
    expect(klassifiziere({ tief: 0.8, mittel: 0.15, hoch: 0.01, schwerpunktHz: 120, ausklingMs: 200 })).toBe("Kick");
    expect(klassifiziere({ tief: 0.05, mittel: 0.2, hoch: 0.7, schwerpunktHz: 7000, ausklingMs: 40 })).toBe("HiHat cl");
    expect(klassifiziere({ tief: 0.05, mittel: 0.2, hoch: 0.7, schwerpunktHz: 7000, ausklingMs: 300 })).toBe("HiHat op");
    expect(klassifiziere({ tief: 0.15, mittel: 0.5, hoch: 0.3, schwerpunktHz: 2500, ausklingMs: 160 })).toBe("Snare");
    expect(klassifiziere({ tief: 0.1, mittel: 0.4, hoch: 0.4, schwerpunktHz: 3500, ausklingMs: 40 })).toBe("Clap");
    expect(klassifiziere({ tief: 0.2, mittel: 0.3, hoch: 0.1, schwerpunktHz: 1500, ausklingMs: 400 })).toBe("Perc 1");
  });

  it("Onsets eines Takts: acht Anschlaege auf den richtigen 16teln", () => {
    const { pcm, erwartet } = takt();
    const o = findeOnsets(pcm, SR);
    const steps = o.map((x) => Math.round((x.zeit * 16) / 2) - VORLAUF_STEPS);
    expect(steps).toEqual(erwartet.map((e) => e.step).sort((a, b) => a - b));
    expect(findeOnsets(new Float32Array(SR), SR)).toEqual([]);
  });

  it("Anschlaege werden nach Klangfarbe eingeteilt", () => {
    const { pcm, erwartet } = takt();
    const s = drumSchlaege(pcm, SR, { bpm: 120 });
    const gefunden = s.map((x) => ({ step: Math.round((x.zeit * 16) / 2) - VORLAUF_STEPS, klasse: x.klasse }));
    for (const e of erwartet) {
      const g = gefunden.find((x) => x.step === e.step);
      expect(g, `Step ${e.step}`).toBeDefined();
      expect(g!.klasse, `Step ${e.step} (${JSON.stringify(s.find((x) => Math.round((x.zeit * 16) / 2) - VORLAUF_STEPS === e.step)?.merkmale)})`).toBe(e.klasse);
    }
    expect(s.every((x) => x.velocity >= 40 && x.velocity <= 127)).toBe(true);
  });

  it("als Drum-Lied: je Klasse eine Spur auf Kanal 10, 16tel-Raster, Part-Namen des Editors", () => {
    const { pcm } = takt();
    const { lied } = transkribiereDrums(pcm, SR, { bpm: 120 });
    expect(lied.bpm).toBe(120);
    expect(lied.spuren.map((s) => s.name)).toEqual(["Kick", "Snare", "HiHat cl", "HiHat op"]);
    expect(lied.spuren.every((s) => s.kanal === 9)).toBe(true);
    const t16 = AUDIO_TPQ / 4;
    const kickTicks = lied.spuren[0].noten.map((n) => n.tick / t16 - VORLAUF_STEPS);
    expect(kickTicks).toEqual([0, 8]);
    expect(lied.spuren[0].noten[0].note).toBe(DRUM_NOTEN.Kick);
    expect(lied.spuren[2].noten.map((n) => n.tick / t16 - VORLAUF_STEPS)).toEqual([2, 6, 10]);
    // Stille: eine leere Spur, kein Absturz
    expect(transkribiereDrums(new Float32Array(SR), SR, { bpm: 120 }).lied.spuren[0].noten).toEqual([]);
  });
});

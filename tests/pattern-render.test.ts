import { describe, it, expect } from "vitest";
import { createPattern, type EditorPattern, type PoolSample } from "../src/core/editorModel";
import { rendere } from "../src/core/patternRender";

const SR = 44100;

/** Sample aus lauter Einsen — so ist jeder Pegel im Ergebnis direkt ablesbar. */
function eins(nr: number, sekunden = 1): PoolSample {
  return { number: nr, name: `S${nr}`, sampleRate: SR, pcm: new Float32Array(Math.round(SR * sekunden)).fill(1) };
}

function basis(bpm = 120, len: 16 | 32 | 64 = 16): EditorPattern {
  const p = createPattern("R");
  p.bpm = bpm;
  p.stepLength = len;
  for (const part of p.parts) part.sampleNumber = null;
  return p;
}

function setze(p: EditorPattern, part: number, step: number, nr: number, opts: Partial<{ velocity: number; gate: number; note: number; notes: number[] }> = {}): void {
  p.parts[part].sampleNumber = nr;
  const s = p.parts[part].steps[step];
  s.on = true;
  s.velocity = opts.velocity ?? 127;
  s.gate = opts.gate ?? 96;
  if (opts.note !== undefined) s.note = opts.note;
  if (opts.notes !== undefined) s.notes = opts.notes;
}

/** Linker und rechter Kanal an einer Frame-Position. */
function bei(pcm: Float32Array, frame: number): [number, number] {
  return [pcm[frame * 2], pcm[frame * 2 + 1]];
}

describe("rendere", () => {
  it("liefert zwei ineinander verschränkte Kanäle", () => {
    const p = basis();
    setze(p, 0, 0, 501);
    const r = rendere(p, [eins(501)]);
    expect(r.kanaele).toBe(2);
    expect(r.sampleRate).toBe(SR);
    // Interleaved heisst: gerade Länge, und Frames sind die Hälfte davon.
    expect(r.pcm.length % 2).toBe(0);
    expect(r.pcm.length / 2).toBeGreaterThan(SR * 0.4); // 16 Steps bei 120 BPM = 2 s
  });

  it("hart links gelegt bleibt der rechte Kanal still", () => {
    // Genau die Falle: wer L und R vertauscht oder mono schreibt, merkt es
    // nirgends — es klingt weiter plausibel, und jede Messung ist falsch.
    const p = basis();
    setze(p, 0, 0, 501);
    p.parts[0].pan = 0; // ganz links
    const r = rendere(p, [eins(501)]);
    const [l, rr] = bei(r.pcm, 100);
    expect(Math.abs(l)).toBeGreaterThan(0.9);
    expect(Math.abs(rr)).toBeLessThan(0.01);
  });

  it("hart rechts spiegelt das", () => {
    const p = basis();
    setze(p, 0, 0, 501);
    p.parts[0].pan = 127;
    const r = rendere(p, [eins(501)]);
    const [l, rr] = bei(r.pcm, 100);
    expect(Math.abs(l)).toBeLessThan(0.01);
    expect(Math.abs(rr)).toBeGreaterThan(0.9);
  });

  it("in der Mitte liegt auf beiden Kanälen gleich viel", () => {
    const p = basis();
    setze(p, 0, 0, 501);
    p.parts[0].pan = 64;
    const r = rendere(p, [eins(501)]);
    const [l, rr] = bei(r.pcm, 100);
    expect(l).toBeCloseTo(rr, 5);
    expect(l).toBeGreaterThan(0.6);
  });

  it("setzt die Schläge an die richtige Stelle", () => {
    const p = basis(120, 16); // 1 Step = 0,125 s = 5512,5 Frames
    setze(p, 0, 4, 501, { gate: 4 });
    const r = rendere(p, [eins(501)]);
    const stepFrames = (60 / 120 / 4) * SR;
    // Vor dem Step ist Ruhe, danach klingt es.
    expect(Math.abs(bei(r.pcm, Math.round(stepFrames * 4) - 50)[0])).toBeLessThan(0.01);
    expect(Math.abs(bei(r.pcm, Math.round(stepFrames * 4) + 50)[0])).toBeGreaterThan(0.5);
  });

  it("der Anschlag bestimmt den Pegel", () => {
    const p = basis();
    setze(p, 0, 0, 501, { velocity: 64 });
    p.parts[0].volume = 127;
    const r = rendere(p, [eins(501)]);
    expect(bei(r.pcm, 100)[0]).toBeCloseTo((64 / 127) * Math.cos(Math.PI / 4), 2);
  });

  it("ein kurzes Gate hält den Ton kürzer als ein langes", () => {
    const kurz = basis();
    setze(kurz, 0, 0, 501, { gate: 6 });
    const lang = basis();
    setze(lang, 0, 0, 501, { gate: 48 });
    const laenge = (r: { pcm: Float32Array }) => {
      let letzter = 0;
      for (let f = 0; f * 2 < r.pcm.length; f++) if (Math.abs(r.pcm[f * 2]) > 0.01) letzter = f;
      return letzter;
    };
    expect(laenge(rendere(kurz, [eins(501)]))).toBeLessThan(laenge(rendere(lang, [eins(501)])));
  });

  it("eine Oktave höher spielt das Sample doppelt so schnell durch", () => {
    const tief = basis();
    setze(tief, 0, 0, 501, { note: 60 });
    const hoch = basis();
    setze(hoch, 0, 0, 501, { note: 72 });
    const laenge = (r: { pcm: Float32Array }) => {
      let letzter = 0;
      for (let f = 0; f * 2 < r.pcm.length; f++) if (Math.abs(r.pcm[f * 2]) > 0.01) letzter = f;
      return letzter;
    };
    const a = laenge(rendere(tief, [eins(501, 0.2)]));
    const b = laenge(rendere(hoch, [eins(501, 0.2)]));
    expect(b / a).toBeGreaterThan(0.4);
    expect(b / a).toBeLessThan(0.6);
  });

  it("mehrere Durchgänge hängen aneinander", () => {
    const p = basis(120, 16);
    setze(p, 0, 0, 501, { gate: 4 });
    // Ohne Ausklang, sonst vergleicht man die feste Zusatzzeit mit.
    const eins1 = rendere(p, [eins(501)], { durchgaenge: 1, ausklang: 0 });
    const zwei = rendere(p, [eins(501)], { durchgaenge: 2, ausklang: 0 });
    expect(zwei.sekunden).toBeCloseTo(eins1.sekunden * 2, 2);
    // Der zweite Durchgang fängt wieder mit einem Schlag an.
    const proDurchgang = Math.round((60 / 120 / 4) * SR * 16);
    expect(Math.abs(bei(zwei.pcm, proDurchgang + 50)[0])).toBeGreaterThan(0.5);
  });

  it("ein Akkord ist lauter als ein Einzelton — alle Töne klingen", () => {
    // Leiser Anschlag, damit die Summe nicht an die Begrenzung stößt und der
    // Vergleich etwas über den Akkord aussagt statt über das Limit.
    const einzeln = basis();
    setze(einzeln, 0, 0, 501, { note: 60, velocity: 32 });
    const akkord = basis();
    setze(akkord, 0, 0, 501, { note: 60, notes: [60, 64, 67], velocity: 32 });
    const spitze = (r: { pcm: Float32Array }) => Math.max(...Array.from(r.pcm.slice(0, 2000)).map(Math.abs));
    expect(spitze(rendere(akkord, [eins(501)]))).toBeGreaterThan(spitze(rendere(einzeln, [eins(501)])) * 1.5);
  });

  it("übersteuert nicht, egal wie viel gleichzeitig läuft", () => {
    const p = basis();
    for (let i = 0; i < 16; i++) setze(p, i, 0, 501 + i);
    const pool = Array.from({ length: 16 }, (_, i) => eins(501 + i));
    const r = rendere(p, pool);
    // Einmal das Maximum, nicht eine Zusicherung je Abtastwert: eine Viertel-
    // Million expect()-Aufrufe brauchen mehr Zeit als der ganze Rendervorgang.
    let spitze = 0;
    for (const v of r.pcm) spitze = Math.max(spitze, Math.abs(v));
    expect(spitze).toBeLessThanOrEqual(1);
    expect(spitze).toBeGreaterThan(0.9); // und es kommt wirklich an die Grenze
  });

  it("fehlende Samples werden übersprungen statt zu werfen", () => {
    const p = basis();
    setze(p, 0, 0, 999); // nicht im Pool
    setze(p, 1, 0, 501);
    const r = rendere(p, [eins(501)]);
    expect(Math.abs(bei(r.pcm, 100)[0])).toBeGreaterThan(0.3);
  });

  it("ein leeres Pattern ergibt Stille, kein Krachen", () => {
    const r = rendere(basis(), []);
    expect(r.pcm.length).toBeGreaterThan(0);
    let spitze = 0;
    for (const v of r.pcm) spitze = Math.max(spitze, Math.abs(v));
    expect(spitze).toBe(0);
  });
});

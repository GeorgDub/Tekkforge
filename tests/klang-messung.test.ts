/**
 * Nachmessen am gerenderten Ergebnis.
 *
 * Die übrigen Generator-Tests zählen Steps — sie prüfen, was im Pattern STEHT.
 * Hier wird das Pattern zu Audio ausgerechnet und gemessen, was daraus WIRD.
 * Das ist der Unterschied zwischen "die Zahlen stimmen" und "man hört es".
 *
 * ⚠ Gerechnet wird die vereinfachte Vorschau (siehe patternRender): keine
 * Filter, keine Hüllkurven, keine Effekte. Alles hier ist eine Aussage über
 * das ARRANGEMENT, nicht über den Klang des Geräts. Was am Ende besser klingt,
 * entscheidet das Ohr am E2S.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec";
import { scanne } from "../src/core/sampleScan";
import { planeBank } from "../src/core/bankPlan";
import { regelRezept } from "../src/core/rezept";
import { baueAufbau, alsAllPat } from "../src/core/patternGen";
import { editorProjectFromE2Files, type EditorPattern, type PoolSample } from "../src/core/editorModel";
import { rendere } from "../src/core/patternRender";

const KORG3 = path.resolve("examples/e2s/korg3");
const eingaben = fs
  .readdirSync(KORG3)
  .filter((f) => f.endsWith(".wav"))
  .map((f) => {
    const w = parseWav(new Uint8Array(fs.readFileSync(path.join(KORG3, f))));
    return { datei: f, name: f.replace(/\.wav$/i, ""), pcm: w.pcm, sampleRate: w.sampleRate };
  });

function aufbauFuer(dichte: "schlank" | "voll") {
  const { projekt, bank } = planeBank(scanne(eingaben).eintraege, { name: "msg", bpm: 180, bankZeit: "x" });
  const r = regelRezept(projekt, { modus: "jam" });
  const rezept = { ...r, figuren: { ...r.figuren, dichte } };
  const { patterns } = baueAufbau(rezept, projekt);
  const ep = editorProjectFromE2Files(new Uint8Array(alsAllPat(patterns)), new Uint8Array(bank));
  return { patterns, ep, dropIdx: patterns.findIndex((p) => p.name.endsWith("DROP")) };
}

/** Effektivpegel je Fenster (Mono-Summe beider Kanäle). */
function huellkurve(pcm: Float32Array, sr: number, fensterMs = 10): Float32Array {
  const w = Math.max(1, Math.round((fensterMs / 1000) * sr));
  const n = Math.floor(pcm.length / 2 / w);
  const raus = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let summe = 0;
    for (let f = i * w; f < (i + 1) * w; f++) {
      const m = (pcm[f * 2] + pcm[f * 2 + 1]) / 2;
      summe += m * m;
    }
    raus[i] = Math.sqrt(summe / w);
  }
  return raus;
}

/** Nur einen Part hörbar lassen — so misst man ihn ohne den Rest. */
function nurPart(p: EditorPattern, idx: number): EditorPattern {
  return { ...p, parts: p.parts.map((part, i) => ({ ...part, muted: i !== idx })) };
}

/**
 * Wie verschieden sind zwei Hüllkurven? 0 = deckungsgleich, 1 = grundverschieden.
 *
 * Bewusst KEIN Anschlags-Zähler: der erste Versuch suchte Pegelanstiege und
 * meldete für vier identische Takte unterschiedlich viele Treffer — ein
 * nachklingender Kick verwischt die Kante, und die Erkennung hing an einer
 * Schwelle statt am Signal. Ein Vergleich der Verläufe braucht keine Schwelle.
 */
function unterschied(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let diff = 0;
  let summe = 0;
  for (let i = 0; i < n; i++) {
    diff += Math.abs(a[i] - b[i]);
    summe += Math.max(a[i], b[i]);
  }
  return summe > 0 ? diff / summe : 0;
}

/** Anteil der Zeit über einem Bruchteil der Spitze — "wie voll klingt es". */
function anteilLaut(h: Float32Array, bruchteil = 0.15): number {
  const spitze = Math.max(...h);
  if (spitze <= 0) return 0;
  return Array.from(h).filter((v) => v > spitze * bruchteil).length / h.length;
}

describe("Nachmessen: der Snare-Wirbel vor dem Drop", () => {
  it("steigt im letzten Takt hörbar an", () => {
    const { patterns, ep, dropIdx } = aufbauFuer("schlank");
    const letzteAuf = nurPart(ep.patterns[dropIdx - 1], 2);
    const r = rendere(letzteAuf, ep.samples as PoolSample[], { ausklang: 0.2 });
    const h = huellkurve(r.pcm, r.sampleRate, 10);
    // Der Wirbel liegt im letzten Viertel der 64 Steps.
    const proStep = h.length / (patterns[0].stepLength + 0.2 / ((60 / patterns[0].bpm) / 4));
    const ab = Math.floor(48 * proStep);
    const wirbel = Array.from(h.slice(ab));
    const erstesDrittel = wirbel.slice(0, Math.floor(wirbel.length / 3));
    const letztesDrittel = wirbel.slice(-Math.floor(wirbel.length / 3));
    const spitze = (a: number[]) => Math.max(...a);
    // Ansteigender Anschlag muss sich als höherer Pegel zeigen — sonst
    // schluckt die Samplelänge die Rampe und die Steigerung ist nur eine Zahl.
    expect(spitze(letztesDrittel)).toBeGreaterThan(spitze(erstesDrittel) * 1.1);
  });

  it("füllt den letzten Takt hörbar dichter als der Drop an derselben Stelle", () => {
    const { ep, dropIdx } = aufbauFuer("schlank");
    const dichte = (p: EditorPattern) => {
      const r = rendere(nurPart(p, 2), ep.samples as PoolSample[], { ausklang: 0 });
      const h = huellkurve(r.pcm, r.sampleRate, 5);
      return anteilLaut(h.slice(Math.floor(h.length * 0.75)));
    };
    expect(dichte(ep.patterns[dropIdx - 1])).toBeGreaterThan(dichte(ep.patterns[dropIdx]));
  });
});

describe("Nachmessen: schlank gegen voll", () => {
  it("der schlanke Satz lässt hörbar mehr Ruhe", () => {
    const messe = (dichte: "schlank" | "voll") => {
      const { ep, dropIdx } = aufbauFuer(dichte);
      const drop = ep.patterns[dropIdx];
      // Nur Schlagzeug und Bass — Melo und Vocals laufen als Dauerschleife und
      // würden jede Ruhe zudecken.
      const nurDrums: EditorPattern = { ...drop, parts: drop.parts.map((p, i) => ({ ...p, muted: p.muted || i > 8 })) };
      const r = rendere(nurDrums, ep.samples as PoolSample[], { ausklang: 0 });
      const h = huellkurve(r.pcm, r.sampleRate, 10);
      const spitze = Math.max(...h);
      const leise = Array.from(h).filter((v) => v < spitze * 0.08).length / h.length;
      return leise;
    };
    const schlank = messe("schlank");
    const voll = messe("voll");
    expect(schlank).toBeGreaterThan(voll);
  });
});

describe("Nachmessen: die Kick wiederholt sich nicht", () => {
  /** Unterschied zwischen Takt 1 und Takt 4 im gerenderten Kick-Verlauf. */
  const taktUnterschied = (dichte: "schlank" | "voll") => {
    const { ep, dropIdx } = aufbauFuer(dichte);
    const r = rendere(nurPart(ep.patterns[dropIdx], 0), ep.samples as PoolSample[], { ausklang: 0 });
    const h = huellkurve(r.pcm, r.sampleRate, 5);
    const proTakt = Math.floor(h.length / 4);
    return unterschied(h.slice(0, proTakt), h.slice(3 * proTakt, 4 * proTakt));
  };

  it("die alte Fassung war wirklich viermal dieselbe Zeile", () => {
    // Die Kontrolle: ohne sie könnte der Test unten aus jedem Grund grün sein.
    expect(taktUnterschied("voll")).toBeLessThan(0.15);
  });

  it("der vierte Takt klingt jetzt hörbar anders als der erste", () => {
    expect(taktUnterschied("schlank")).toBeGreaterThan(0.3);
  });

  it("und zwar deutlich anders als vorher", () => {
    expect(taktUnterschied("schlank")).toBeGreaterThan(taktUnterschied("voll") * 2.5);
  });
});

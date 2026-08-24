/**
 * meloRaster — Onset-Staerke und Bassanteil je 16tel-Step aus einem
 * taktgenauen Melo-Loop (mono). Grundlage fuer melo-passende Steps in
 * patternGen: Stab-Hits auf die staerksten Melo-Onsets, Bass-Offbeats
 * weichen Melo-Bass aus. 64 Steps = 4 Takte; laengere Loops werden per
 * Maximum auf 64 gefaltet, kuerzere wiederholen sich im Raster.
 */
import { onsetKurve } from "./tempoAnalyse";
import { bassAnteil } from "./dsp";
import type { E2StepInput } from "./electribePatternBuilder";

export interface MeloRaster {
  /** Onset-Staerke je Step, 64 Werte, auf max = 1 normiert */
  onset: number[];
  /** Bassanteil (< 150 Hz) je Step, 64 Werte, 0..1 */
  bass: number[];
}

const N = 64;

export function meloRaster(pcm: Float32Array, sampleRate: number, takte: number): MeloRaster {
  const stepsGesamt = Math.max(16, Math.round(takte) * 16);
  const hop = 256;
  const on = onsetKurve(pcm, sampleRate, hop);
  // Loop-Anfang: ein Anschlag auf Step 0 hat keine steigende Flanke — die
  // Energie des ersten Hops zaehlt als Onset (gleiche log1p-Skala wie die Kurve)
  let e0 = 0;
  for (let i = 0; i < Math.min(hop, pcm.length); i++) e0 += pcm[i] * pcm[i];
  if (on.length) on[0] = Math.max(on[0], Math.log1p((e0 / hop) * 1000));
  const stepFrames = pcm.length / stepsGesamt;
  const onset = new Array<number>(N).fill(0);
  const bassSumme = new Array<number>(N).fill(0);
  const bassZahl = new Array<number>(N).fill(0);
  for (let s = 0; s < stepsGesamt; s++) {
    const start = Math.round(s * stepFrames);
    // Onset: staerkster Wert in der ersten Step-Haelfte (Anschlag am Step-Anfang)
    const a = Math.floor(start / hop);
    const b = Math.min(on.length, Math.ceil((start + stepFrames / 2) / hop));
    let o = 0;
    for (let i = a; i < b; i++) if (on[i] > o) o = on[i];
    const ziel = s % N;
    if (o > onset[ziel]) onset[ziel] = o;
    if (start + 2048 <= pcm.length) {
      bassSumme[ziel] += bassAnteil(pcm.subarray(start, start + 2048), sampleRate);
      bassZahl[ziel]++;
    }
  }
  const max = Math.max(...onset, 1e-9);
  return {
    onset: onset.map((o) => Math.round((o / max) * 100) / 100),
    bass: bassSumme.map((s, i) => (bassZahl[i] ? Math.round((s / bassZahl[i]) * 100) / 100 : 0)),
  };
}

/**
 * Stab-Steps aus dem Raster: die bis zu 6 staerksten Onsets (>= 0,35),
 * Velocity nach Onset-Staerke. Deterministisch; leeres Raster → keine Steps.
 */
export function stabAusRaster(raster: MeloRaster): E2StepInput[] {
  const kand = raster.onset
    .map((o, s) => ({ o, s }))
    .filter((x) => x.o >= 0.35)
    .sort((a, b) => b.o - a.o || a.s - b.s)
    .slice(0, 6);
  const aktiv = new Map(kand.map((x) => [x.s, x.o]));
  return Array.from({ length: N }, (_, s) => {
    const o = aktiv.get(s);
    return o !== undefined ? { active: true, notes: [60], velocity: 80 + Math.round(24 * o), gate: 12 } : { active: false };
  });
}

/**
 * Bass-Steps am Melo-Bass ausduennen: Hits auf Steps mit hohem Melo-Bassanteil
 * entfallen. Wuerde alles wegfallen, bleibt die Figur unveraendert.
 */
export function bassAnMelo(steps: E2StepInput[], raster: MeloRaster, schwelle = 0.6): E2StepInput[] {
  const out = steps.map((st, s) => (st.active && (raster.bass[s % N] ?? 0) > schwelle ? { active: false } : st));
  return out.some((st) => st.active) ? out : steps;
}

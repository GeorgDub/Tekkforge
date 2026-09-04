/**
 * sliceMarker — 64 Slice-Marker fuer eine Schleife, wie sie
 * `make-folder-bank.mjs` seit langem schreibt und der Generator-Weg nie
 * hatte. Mit Markern kann das Geraet selbst choppen (Slice-Sequenz), ohne
 * dass die Melodie in Dateien zerschnitten wird.
 *
 * Gleichmaessig ueber die Laenge: bei 4 Takten Sechzehntel, bei 8 Takten
 * Achtel — mehr als 64 Marker kennt das Format nicht.
 */
import type { SliceInput } from "./e2sBankBuilder";

export const SLICE_MAX = 64;

export interface SliceSatz {
  slices: SliceInput[];
  sliceSteps: Uint8Array;
  slicingNumSteps: number;
  slicingBeat: number;
  slicingNumActive: number;
}

/** Marker fuer `takte` Takte: 16 je Takt, gedeckelt auf 64; 0 Takte → keine. */
export function sliceAnzahl(takte: number): number {
  return Math.max(0, Math.min(SLICE_MAX, Math.round(takte * 16)));
}

export function slicesFuer(pcm: Float32Array, anzahl: number): SliceSatz | null {
  const n = Math.max(0, Math.min(SLICE_MAX, Math.round(anzahl)));
  if (!n || !pcm.length) return null;
  const frames = pcm.length;
  const slices: SliceInput[] = [];
  for (let i = 0; i < n; i++) {
    const start = Math.round((i * frames) / n);
    const ende = Math.round(((i + 1) * frames) / n);
    let peak = 0;
    for (let f = start; f < ende; f++) peak = Math.max(peak, Math.abs(pcm[f]));
    slices.push({ start, length: ende - start, attackLength: Math.round((ende - start) / 2), amplitude: Math.round(Math.min(1, peak) * 32767) });
  }
  const steps = new Uint8Array(SLICE_MAX).fill(255);
  for (let i = 0; i < n; i++) steps[Math.round((i * SLICE_MAX) / n)] = i;
  return { slices, sliceSteps: steps, slicingNumSteps: SLICE_MAX, slicingBeat: 0, slicingNumActive: n };
}

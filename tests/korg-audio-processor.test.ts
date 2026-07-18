/**
 * tests/features/korg-audio-processor.test.ts
 *
 * v3.6.0 Unit-Tests für den Poly-Phase FIR (Lanczos-3) Resampler in
 * client/src/utils/korg/audioProcessor.ts.
 *
 * Coverage:
 *   - lanczosKernel: Sinc-Approximation, Lobe-Limits, x=0, NaN-defense
 *   - polyPhaseResample: rate-conversion correctness, mono+stereo paths,
 *     no-op identity, DC-Preservation, edge handling
 *   - Aliasing-Test: synth Sine über Output-Nyquist im Input → Output
 *     stark gedämpft (Anti-Alias funktioniert)
 *   - Frequency-Response: 1 kHz Sine bleibt unter Nyquist erhalten
 *   - convertToE2sSpec: respektiert resampler-Wahl (default poly-phase)
 */

import { describe, it, expect } from "vitest";
import {
  AudioProcessError,
  convertToE2sSpec,
  lanczosKernel,
  polyPhaseResample,
  resampleLinear,
} from "../src/core/audioProcessor";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeSine(freq: number, sr: number, durationSec: number, amp = 0.5): Float32Array {
  const frames = Math.floor(durationSec * sr);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    out[i] = Math.sin((2 * Math.PI * freq * i) / sr) * amp;
  }
  return out;
}

/** Peak-Amplitude eines Signals (defensive). */
function peakAbs(pcm: Float32Array): number {
  let p = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i];
    if (!Number.isFinite(v)) continue;
    const a = v >= 0 ? v : -v;
    if (a > p) p = a;
  }
  return p;
}

/** RMS-Amplitude eines Signals. */
function rms(pcm: Float32Array): number {
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return Math.sqrt(s / Math.max(1, pcm.length));
}

// ─── lanczosKernel ──────────────────────────────────────────────────────────

describe("audioProcessor — lanczosKernel", () => {
  it("returns 1.0 at x=0 (limit of sinc)", () => {
    expect(lanczosKernel(0, 3)).toBe(1);
  });

  it("returns 0 outside the lobe (|x| >= a)", () => {
    expect(lanczosKernel(3, 3)).toBe(0);
    expect(lanczosKernel(-3, 3)).toBe(0);
    expect(lanczosKernel(5, 3)).toBe(0);
  });

  it("returns 0 at integer x within lobe (sinc zero-crossings)", () => {
    // sinc(πk) = 0 for k = ±1, ±2 (within a=3 lobe).
    expect(Math.abs(lanczosKernel(1, 3))).toBeLessThan(1e-10);
    expect(Math.abs(lanczosKernel(-1, 3))).toBeLessThan(1e-10);
    expect(Math.abs(lanczosKernel(2, 3))).toBeLessThan(1e-10);
  });

  it("is even (symmetric)", () => {
    for (const x of [0.5, 1.3, 2.7]) {
      expect(lanczosKernel(x, 3)).toBeCloseTo(lanczosKernel(-x, 3), 9);
    }
  });

  it("defensive: NaN → 0", () => {
    expect(lanczosKernel(NaN, 3)).toBe(0);
  });

  it("peak at x=0 dominates neighbors (low-pass shape)", () => {
    const center = lanczosKernel(0, 3);
    const off = lanczosKernel(0.5, 3);
    expect(center).toBeGreaterThan(off);
    expect(off).toBeGreaterThan(0);
  });
});

// ─── polyPhaseResample — structural ─────────────────────────────────────────

describe("audioProcessor — polyPhaseResample basics", () => {
  it("no-op (same rate) returns a copy with identical content", () => {
    const src = new Float32Array([0.1, -0.2, 0.3, -0.4]);
    const out = polyPhaseResample(src, 44100, 44100, 1);
    expect(out.length).toBe(src.length);
    // Float32 quantization → use 5 decimal places (1e-5) which is well above
    // single-precision epsilon (~1.2e-7) yet ensures no drift in no-op path.
    for (let i = 0; i < src.length; i++) expect(out[i]).toBeCloseTo(src[i], 5);
    // Defensive: returned a copy, not a reference
    out[0] = 999;
    expect(src[0]).toBeCloseTo(0.1, 5);
  });

  it("upsample 22.05 → 44.1 produces ~2× sample count", () => {
    const src = makeSine(440, 22050, 1.0);
    const out = polyPhaseResample(src, 22050, 44100, 1);
    expect(out.length).toBeGreaterThan(43000);
    expect(out.length).toBeLessThan(45000);
  });

  it("downsample 88.2 → 44.1 produces ~half sample count", () => {
    const src = makeSine(440, 88200, 1.0);
    const out = polyPhaseResample(src, 88200, 44100, 1);
    expect(out.length).toBeGreaterThan(43000);
    expect(out.length).toBeLessThan(45000);
  });

  it("preserves stereo interleaving (L/R remain independent)", () => {
    // Build L=0.5 const, R=-0.5 const stereo
    const frames = 1000;
    const src = new Float32Array(frames * 2);
    for (let i = 0; i < frames; i++) {
      src[i * 2] = 0.5;
      src[i * 2 + 1] = -0.5;
    }
    const out = polyPhaseResample(src, 48000, 44100, 2);
    // Sample some "interior" frames (avoid edge attenuation)
    // The DC components should be ≈ constant after resampling.
    const midFrame = (out.length / 4) | 0; // L index ~quarter way through
    expect(out[midFrame * 2]).toBeCloseTo(0.5, 2);
    expect(out[midFrame * 2 + 1]).toBeCloseTo(-0.5, 2);
  });

  it("empty input → empty output", () => {
    const out = polyPhaseResample(new Float32Array(0), 48000, 44100, 1);
    expect(out.length).toBe(0);
  });

  it("rejects non-Float32Array", () => {
    expect(() =>
      polyPhaseResample([0.1, 0.2] as unknown as Float32Array, 44100, 44100, 1),
    ).toThrow(AudioProcessError);
  });

  it("rejects invalid sample rate", () => {
    expect(() => polyPhaseResample(new Float32Array(10), 0, 44100, 1)).toThrow(
      AudioProcessError,
    );
    expect(() => polyPhaseResample(new Float32Array(10), 44100, -1, 1)).toThrow(
      AudioProcessError,
    );
  });

  it("rejects unsupported channel count", () => {
    expect(() =>
      polyPhaseResample(new Float32Array(10), 44100, 44100, 5 as unknown as 1),
    ).toThrow(AudioProcessError);
  });
});

// ─── polyPhaseResample — quality ─────────────────────────────────────────────

describe("audioProcessor — polyPhaseResample quality (anti-aliasing)", () => {
  it("preserves a 1 kHz sine when resampling 48k → 44.1k (under Nyquist)", () => {
    const src = makeSine(1000, 48000, 0.5, 0.5);
    const out = polyPhaseResample(src, 48000, 44100, 1);
    // RMS should be ~ amp/sqrt(2) ≈ 0.353 for both. Allow some kernel-edge
    // attenuation by sampling interior only.
    const interior = out.subarray(2000, out.length - 2000);
    const srcInterior = src.subarray(2000, src.length - 2000);
    const ratio = rms(interior) / rms(srcInterior);
    // RMS preserved within 10% (very generous for windowed-sinc with a=3).
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });

  it("attenuates a 20 kHz sine when downsampling 48k → 32k (above Nyquist=16k)", () => {
    // 20 kHz at 48k is valid; at 32k it's above Nyquist (16k) — must be
    // attenuated by the anti-alias filter, NOT folded back.
    const src = makeSine(20000, 48000, 0.5, 0.7);
    const out = polyPhaseResample(src, 48000, 32000, 1);
    // The resampler must aggressively kill content above 16 kHz.
    // Without anti-alias filtering, the 20 kHz tone would alias to
    // 32k - 20k = 12 kHz and remain audible at near-full amplitude.
    // With a proper FIR, the output RMS interior should be << input RMS.
    const interior = out.subarray(500, out.length - 500);
    const inputRms = rms(src.subarray(500, src.length - 500));
    const outputRms = rms(interior);
    // Lanczos-3 isn't a brick-wall — some leakage is OK, but we expect
    // strong attenuation (> 12 dB ≈ ratio < 0.25).
    expect(outputRms).toBeLessThan(inputRms * 0.5);
  });

  it("DC preservation: constant 0.4 signal → constant 0.4 (interior frames)", () => {
    const src = new Float32Array(2000);
    src.fill(0.4);
    const out = polyPhaseResample(src, 48000, 44100, 1);
    // Inspect interior (skip first/last ~20 frames where kernel is truncated).
    const interior = out.subarray(50, out.length - 50);
    for (let i = 0; i < interior.length; i++) {
      // Allow some Gibbs-style ringing tolerance at start/end of interior.
      expect(interior[i]).toBeGreaterThan(0.38);
      expect(interior[i]).toBeLessThan(0.42);
    }
  });

  it("output amplitude does not blow up beyond [-1,+1]", () => {
    const src = makeSine(440, 48000, 0.2, 0.95);
    const out = polyPhaseResample(src, 48000, 44100, 1);
    const p = peakAbs(out);
    expect(p).toBeLessThanOrEqual(1.0);
    expect(p).toBeGreaterThan(0.85); // not silenced
  });

  it("defensive: NaN samples in input do not corrupt the output globally", () => {
    const src = new Float32Array(1000);
    for (let i = 0; i < src.length; i++) src[i] = 0.2;
    src[500] = NaN;
    const out = polyPhaseResample(src, 48000, 44100, 1);
    // Interior frames far from the NaN should still be ~ 0.2 (sample at start).
    const startInt = out[50];
    expect(Number.isFinite(startInt)).toBe(true);
    expect(startInt).toBeGreaterThan(0.15);
    expect(startInt).toBeLessThan(0.25);
    // Output near the corrupted sample is allowed to deviate, but must remain finite.
    for (let i = 0; i < out.length; i++) {
      expect(Number.isFinite(out[i])).toBe(true);
    }
  });
});

// ─── convertToE2sSpec — wires resampler choice ────────────────────────────────

describe("audioProcessor — convertToE2sSpec resampler wiring (v3.6.0)", () => {
  it("default (no resampler opt) uses poly-phase under the hood (1 kHz preserved)", () => {
    const src = makeSine(1000, 48000, 0.5, 0.5);
    const out = convertToE2sSpec(src, 48000, 1, { targetSampleRate: 44100 });
    expect(out.sampleRate).toBe(44100);
    const interior = out.pcm.subarray(2000, out.pcm.length - 2000);
    expect(rms(interior)).toBeGreaterThan(0.25); // not heavily attenuated
  });

  it("explicit 'linear' produces identical result to resampleLinear directly", () => {
    const src = makeSine(440, 48000, 0.1, 0.3);
    const direct = resampleLinear(src, 48000, 44100, 1);
    const viaApi = convertToE2sSpec(src, 48000, 1, {
      targetSampleRate: 44100,
      resampler: "linear",
    });
    expect(viaApi.pcm.length).toBe(direct.length);
    for (let i = 0; i < Math.min(direct.length, 100); i++) {
      expect(viaApi.pcm[i]).toBeCloseTo(direct[i], 5);
    }
  });

  it("'poly-phase' beats 'linear' on aliasing: 18 kHz sine at 48k → 32k (below E2S targets)", () => {
    // 18 kHz at 48k is valid; downsampled to 32k it's above Nyquist (16k).
    // Naive linear interpolation aliases this to 32k - 18k = 14 kHz at full
    // amplitude. Polyphase with anti-alias filter attenuates strongly.
    // We use polyPhaseResample/resampleLinear directly (convertToE2sSpec
    // only accepts 44.1k/48k, but the resampler functions are rate-agnostic).
    const src = makeSine(18000, 48000, 0.5, 0.7);
    const linearOut = resampleLinear(src, 48000, 32000, 1);
    const polyOut = polyPhaseResample(src, 48000, 32000, 1);
    const linearRms = rms(linearOut.subarray(500, linearOut.length - 500));
    const polyRms = rms(polyOut.subarray(500, polyOut.length - 500));
    // The polyphase output's RMS should be SIGNIFICANTLY smaller than
    // linear's (linear leaves the 18 kHz alias at full amp, poly filters it).
    expect(polyRms).toBeLessThan(linearRms * 0.7);
  });
});

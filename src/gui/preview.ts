/**
 * preview.ts — einfacher Pattern-Vorhör-Player (Web Audio, Lookahead-Scheduler).
 *
 * Kein Anspruch auf E2-Klangidentität (kein Filter/IFX/MFX) — Steps triggern
 * die Pool-Samples mit Velocity→Gain, Pan→StereoPanner, Note→playbackRate
 * (60 = C4 = Originaltonhöhe) und Gate→Stop nach Gate/96 × Steplänge (Tie=aus).
 */

import type { EditorPattern, PoolSample } from "../core/editorModel";
import { EDITOR_DEFAULT_NOTE, EDITOR_GATE_MAX } from "../core/editorModel";

const LOOKAHEAD_S = 0.12;
const TICK_MS = 30;

export class PreviewPlayer {
  private ctx: AudioContext | null = null;
  private buffers = new Map<number, AudioBuffer>();
  private timer: number | null = null;
  private nextStepTime = 0;
  private stepIdx = 0;
  private pattern: EditorPattern | null = null;
  private samples: PoolSample[] = [];
  /** UI-Callback: aktueller Step (für Playhead-Highlight), -1 = gestoppt. */
  onStep: ((step: number) => void) | null = null;

  get playing(): boolean {
    return this.timer !== null;
  }

  start(pattern: EditorPattern, samples: PoolSample[]): void {
    this.stop();
    this.pattern = pattern;
    this.samples = samples;
    this.ctx = this.ctx ?? new AudioContext();
    void this.ctx.resume();
    this.buffers.clear();
    for (const s of samples) {
      const buf = this.ctx.createBuffer(1, Math.max(1, s.pcm.length), s.sampleRate);
      buf.getChannelData(0).set(s.pcm);
      this.buffers.set(s.number, buf);
    }
    this.stepIdx = 0;
    this.nextStepTime = this.ctx.currentTime + 0.06;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.onStep?.(-1);
  }

  private tick(): void {
    const ctx = this.ctx;
    const p = this.pattern;
    if (!ctx || !p) return;
    const stepDur = 60 / p.bpm / 4; // 16tel
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      this.scheduleStep(this.stepIdx, this.nextStepTime, stepDur);
      const uiStep = this.stepIdx;
      const delay = Math.max(0, (this.nextStepTime - ctx.currentTime) * 1000);
      window.setTimeout(() => {
        if (this.playing) this.onStep?.(uiStep);
      }, delay);
      this.stepIdx = (this.stepIdx + 1) % p.stepLength;
      this.nextStepTime += stepDur;
    }
  }

  private scheduleStep(step: number, when: number, stepDur: number): void {
    const ctx = this.ctx;
    const p = this.pattern;
    if (!ctx || !p) return;
    for (const part of p.parts) {
      if (part.muted) continue; // Preview-Mute: Part isolieren
      const st = part.steps[step];
      if (!st?.on || part.sampleNumber === null) continue;
      const buf = this.buffers.get(part.sampleNumber);
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = Math.pow(2, (st.note - EDITOR_DEFAULT_NOTE) / 12);
      const gain = ctx.createGain();
      gain.gain.value = (st.velocity / 127) * (part.volume / 127);
      const pan = ctx.createStereoPanner();
      pan.pan.value = (part.pan - 64) / 63;
      src.connect(gain).connect(pan).connect(ctx.destination);
      src.start(when);
      // Gate: Anteil der Steplänge; 96 = Tie → ausklingen lassen
      if (st.gate < EDITOR_GATE_MAX) {
        const stopAt = when + Math.max(0.02, (st.gate / EDITOR_GATE_MAX) * stepDur * 4);
        src.stop(stopAt);
      }
    }
  }

  /** Einzelnes Sample anspielen (Pool-Vorhören). */
  audition(sample: PoolSample): void {
    this.ctx = this.ctx ?? new AudioContext();
    void this.ctx.resume();
    const buf = this.ctx.createBuffer(1, Math.max(1, sample.pcm.length), sample.sampleRate);
    buf.getChannelData(0).set(sample.pcm);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.start();
  }
}

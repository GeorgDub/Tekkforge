/**
 * preview.ts — einfacher Pattern-Vorhör-Player (Web Audio, Lookahead-Scheduler).
 *
 * Kein Anspruch auf E2-Klangidentität (kein Filter/IFX/MFX) — Steps triggern
 * die Pool-Samples mit Velocity→Gain, Pan→StereoPanner, Note→playbackRate
 * (60 = C4 = Originaltonhöhe) und Gate→Stop nach Gate/96 × Steplänge (Tie=aus).
 */

import type { EditorPattern, PoolSample } from "../core/editorModel";
import { stepDauer, stimmen, type Stimme } from "../core/patternStimmen";
import { oszSample } from "../core/oszSynth";
import { istOszillatorNummer } from "../core/oszNamen";

const LOOKAHEAD_S = 0.12;
const TICK_MS = 30;

export class PreviewPlayer {
  private ctx: AudioContext | null = null;
  private buffers = new Map<number, AudioBuffer>();
  private timer: number | null = null;
  private nextStepTime = 0;
  private stepIdx = 0;
  private pattern: EditorPattern | null = null;
  /**
   * Die klingenden Stimmen je Step, einmal vorab aus `patternStimmen` geholt.
   * Dieselbe Rechnung benutzt auch der Datei-Renderer — was hier klingt,
   * kommt dort genauso heraus.
   */
  private stimmenAb = new Map<number, Stimme[]>();
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
    // Synth-Oszillatoren der Firmware (1…362) haben kein PCM — der Ersatzklang aus oszSynth springt ein.
    for (const part of pattern.parts) {
      const n = part.sampleNumber;
      if (!istOszillatorNummer(n) || this.buffers.has(n)) continue;
      const o = oszSample(n);
      if (!o) continue;
      const buf = this.ctx.createBuffer(1, Math.max(1, o.pcm.length), o.sampleRate);
      buf.getChannelData(0).set(o.pcm);
      this.buffers.set(n, buf);
    }
    this.stimmenAb.clear();
    for (const v of stimmen(pattern)) {
      const liste = this.stimmenAb.get(v.step);
      if (liste) liste.push(v);
      else this.stimmenAb.set(v.step, [v]);
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
    const stepDur = stepDauer(p.bpm);
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
    if (!ctx) return;
    for (const v of this.stimmenAb.get(step) ?? []) {
      const buf = this.buffers.get(v.sampleNumber);
      if (!buf) continue;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = v.rate;
      const gain = ctx.createGain();
      gain.gain.value = v.gain;
      const pan = ctx.createStereoPanner();
      pan.pan.value = v.pan;
      src.connect(gain).connect(pan).connect(ctx.destination);
      src.start(when);
      // Gate: null = Tie, also ausklingen lassen.
      if (v.dauerSteps !== null) src.stop(when + Math.max(0.02, v.dauerSteps * stepDur));
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

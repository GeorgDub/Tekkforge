/**
 * preview.ts — einfacher Pattern-Vorhör-Player (Web Audio, Lookahead-Scheduler).
 *
 * Kein Anspruch auf E2-Klangidentität (kein Filter/IFX/MFX) — Steps triggern
 * die Pool-Samples mit Velocity→Gain, Pan→StereoPanner, Note→playbackRate
 * (60 = C4 = Originaltonhöhe) und Gate→Stop nach Gate/96 × Steplänge (Tie=aus).
 *
 * Der Player liest LIVE aus dem Editor: Pattern und Sample-Liste kommen als
 * Getter, die Stimmen je Step werden bei jedem Scheduler-Tick neu aus dem
 * aktuellen Pattern berechnet. Nutzerbefund (2026-09-04): eine Änderung im
 * Raster kam erst nach Stop und Play an, und beim Pattern-Wechsel lief das
 * alte Pattern weiter — der Player hatte beim Start einen Schnappschuss
 * gezogen (Stimmen, Puffer, Pattern-Objekt) und nie wieder hingesehen.
 * Wechselt das Pattern, laeuft der Step-Zaehler im Takt weiter (modulo der
 * neuen Steplaenge), so wie das Geraet beim Umschalten nicht neu ansetzt.
 */

import type { EditorPattern, PoolSample } from "../core/editorModel";
import { stepDauer, stimmen, type Stimme } from "../core/patternStimmen";
import { oszSample } from "../core/oszSynth";
import { istOszillatorNummer } from "../core/oszNamen";

const LOOKAHEAD_S = 0.12;
const TICK_MS = 30;

/** Das Stueck Web Audio, das der Player braucht — so laesst er sich ohne Browser pruefen. */
export interface PreviewAudio {
  currentTime: number;
  destination: AudioNode;
  resume(): Promise<void>;
  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer;
  createBufferSource(): AudioBufferSourceNode;
  createGain(): GainNode;
  createStereoPanner(): StereoPannerNode;
}

type Quelle<T> = T | (() => T);
const hole = <T>(q: Quelle<T>): T => (typeof q === "function" ? (q as () => T)() : q);

export class PreviewPlayer {
  private ctx: PreviewAudio | null = null;
  /** Puffer je PCM-Feld — aendert sich das Sample (Sample-Editor), entsteht ein neuer. */
  private buffers = new WeakMap<Float32Array, AudioBuffer>();
  private oszBuffers = new Map<number, AudioBuffer>();
  private timer: number | null = null;
  private nextStepTime = 0;
  private stepIdx = 0;
  private pattern: Quelle<EditorPattern> | null = null;
  private samples: Quelle<PoolSample[]> = [];
  /** UI-Callback: aktueller Step (für Playhead-Highlight), -1 = gestoppt. */
  onStep: ((step: number) => void) | null = null;

  constructor(private readonly audioFabrik: () => PreviewAudio = () => new AudioContext()) {}

  get playing(): boolean {
    return this.timer !== null;
  }

  /** Pattern und Samples als Objekt ODER als Getter — Getter folgen dem Editor live. */
  start(pattern: Quelle<EditorPattern>, samples: Quelle<PoolSample[]>): void {
    this.stop();
    this.pattern = pattern;
    this.samples = samples;
    this.ctx = this.ctx ?? this.audioFabrik();
    void this.ctx.resume();
    this.stepIdx = 0;
    this.nextStepTime = this.ctx.currentTime + 0.06;
    this.timer = setInterval(() => this.tick(), TICK_MS) as unknown as number;
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.onStep?.(-1);
  }

  private bufferFuer(nummer: number): AudioBuffer | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const s = hole(this.samples).find((x) => x.number === nummer);
    if (s) {
      let buf = this.buffers.get(s.pcm);
      if (!buf) {
        buf = ctx.createBuffer(1, Math.max(1, s.pcm.length), s.sampleRate);
        buf.getChannelData(0).set(s.pcm);
        this.buffers.set(s.pcm, buf);
      }
      return buf;
    }
    // Synth-Oszillatoren der Firmware (1…362) haben kein PCM — der Ersatzklang aus oszSynth springt ein.
    if (!istOszillatorNummer(nummer)) return null;
    let buf = this.oszBuffers.get(nummer) ?? null;
    if (!buf) {
      const o = oszSample(nummer);
      if (!o) return null;
      buf = ctx.createBuffer(1, Math.max(1, o.pcm.length), o.sampleRate);
      buf.getChannelData(0).set(o.pcm);
      this.oszBuffers.set(nummer, buf);
    }
    return buf;
  }

  private tick(): void {
    const ctx = this.ctx;
    const p = this.pattern ? hole(this.pattern) : null;
    if (!ctx || !p) return;
    const stepDur = stepDauer(p.bpm);
    // Stimmen aus dem AKTUELLEN Pattern — einmal je Tick, das reicht fuer
    // die zwei, drei Steps, die ein Tick vorausplant.
    let stimmenAb: Map<number, Stimme[]> | null = null;
    while (this.nextStepTime < ctx.currentTime + LOOKAHEAD_S) {
      if (!stimmenAb) {
        stimmenAb = new Map();
        for (const v of stimmen(p)) {
          const liste = stimmenAb.get(v.step);
          if (liste) liste.push(v);
          else stimmenAb.set(v.step, [v]);
        }
      }
      this.stepIdx %= p.stepLength;
      this.scheduleStep(stimmenAb.get(this.stepIdx) ?? [], this.nextStepTime, stepDur);
      const uiStep = this.stepIdx;
      const delay = Math.max(0, (this.nextStepTime - ctx.currentTime) * 1000);
      setTimeout(() => {
        if (this.playing) this.onStep?.(uiStep);
      }, delay);
      this.stepIdx = (this.stepIdx + 1) % p.stepLength;
      this.nextStepTime += stepDur;
    }
  }

  private scheduleStep(voices: readonly Stimme[], when: number, stepDur: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    for (const v of voices) {
      const buf = this.bufferFuer(v.sampleNumber);
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
    this.ctx = this.ctx ?? this.audioFabrik();
    void this.ctx.resume();
    const buf = this.ctx.createBuffer(1, Math.max(1, sample.pcm.length), sample.sampleRate);
    buf.getChannelData(0).set(sample.pcm);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.ctx.destination);
    src.start();
  }
}

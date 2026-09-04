import { describe, it, expect, vi, afterEach } from "vitest";
import { PreviewPlayer, type PreviewAudio } from "../src/gui/preview";
import { createPattern, type EditorPattern, type PoolSample } from "../src/core/editorModel";

/** Web-Audio-Attrappe: merkt sich jeden geplanten Start (welches Sample, wann). */
function attrappe() {
  const starts: { pcm: Float32Array; when: number }[] = [];
  const ctx = {
    currentTime: 0,
    destination: {} as AudioNode,
    resume: () => Promise.resolve(),
    createBuffer: (_c: number, n: number) => {
      const buf: { quelle: Float32Array | null; getChannelData: () => { set: (p: Float32Array) => void } } = {
        quelle: null,
        getChannelData: () => ({ set: (p: Float32Array) => void (buf.quelle = p) }),
      };
      void n;
      return buf as unknown as AudioBuffer;
    },
    createBufferSource: () => {
      const src = {
        buffer: null as unknown as { quelle: Float32Array } | null,
        playbackRate: { value: 1 },
        connect: (x: unknown) => x,
        start: (when = 0) => starts.push({ pcm: src.buffer!.quelle, when }),
        stop: () => {},
      };
      return src as unknown as AudioBufferSourceNode;
    },
    createGain: () => ({ gain: { value: 1 }, connect: (x: unknown) => x }) as unknown as GainNode,
    createStereoPanner: () => ({ pan: { value: 0 }, connect: (x: unknown) => x }) as unknown as StereoPannerNode,
  };
  return { ctx: ctx as unknown as PreviewAudio & { currentTime: number }, starts };
}

const pcm501 = new Float32Array(100);
const pcm502 = new Float32Array(100);
const samples: PoolSample[] = [
  { number: 501, name: "A", sampleRate: 44100, pcm: pcm501 },
  { number: 502, name: "B", sampleRate: 44100, pcm: pcm502 },
];
function pattern(name: string): EditorPattern {
  const p = createPattern(name);
  p.stepLength = 16;
  p.bpm = 120; // ein 16tel = 0,125 s
  for (const part of p.parts) part.sampleNumber = null;
  return p;
}
/** Zeit laufen lassen: alle 30 ms ein Tick, die Audio-Uhr laeuft mit. */
function lauf(ctx: { currentTime: number }, ms: number): void {
  for (let t = 0; t < ms; t += 30) {
    ctx.currentTime += 0.03;
    vi.advanceTimersByTime(30);
  }
}

describe("PreviewPlayer liest live aus dem Editor", () => {
  afterEach(() => vi.useRealTimers());

  it("ein Step, der waehrend der Wiedergabe gesetzt wird, klingt beim naechsten Durchlauf", () => {
    vi.useFakeTimers();
    const { ctx, starts } = attrappe();
    const player = new PreviewPlayer(() => ctx);
    const p = pattern("T");
    p.parts[0].sampleNumber = 501;
    p.parts[0].steps[0].on = true;
    player.start(() => p, () => samples);
    lauf(ctx, 120);
    expect(starts.filter((s) => s.pcm === pcm501)).toHaveLength(1);
    // jetzt Step 4 dazu — ohne Stop und Play
    p.parts[0].steps[4].on = true;
    lauf(ctx, 900);
    const spaeter = starts.filter((s) => s.pcm === pcm501);
    expect(spaeter.length).toBeGreaterThanOrEqual(2);
    // Step 4 liegt vier 16tel nach Step 0 → 0,5 s spaeter
    expect(Math.abs(spaeter[1].when - spaeter[0].when - 0.5)).toBeLessThan(0.01);
    player.stop();
    expect(player.playing).toBe(false);
  });

  it("wechselt der Editor das Pattern, spielt der Player das neue", () => {
    vi.useFakeTimers();
    const { ctx, starts } = attrappe();
    const player = new PreviewPlayer(() => ctx);
    const a = pattern("A");
    a.parts[0].sampleNumber = 501;
    for (const s of [0, 4, 8, 12]) a.parts[0].steps[s].on = true;
    const b = pattern("B");
    b.parts[1].sampleNumber = 502;
    for (const s of [0, 4, 8, 12]) b.parts[1].steps[s].on = true;
    let cur = 0;
    const patterns = [a, b];
    player.start(() => patterns[cur], () => samples);
    lauf(ctx, 300);
    expect(starts.some((s) => s.pcm === pcm501)).toBe(true);
    expect(starts.some((s) => s.pcm === pcm502)).toBe(false);
    cur = 1; // Klick auf Pattern 2
    const vorher = starts.length;
    lauf(ctx, 1200);
    const neu = starts.slice(vorher);
    expect(neu.some((s) => s.pcm === pcm502)).toBe(true);
    // was nach dem Wechsel geplant wurde, ist nur noch Pattern B (bis auf den Lookahead-Rest)
    expect(neu.filter((s) => s.pcm === pcm501).length).toBeLessThanOrEqual(1);
    player.stop();
  });

  it("nimmt weiterhin ein Pattern-Objekt statt eines Getters (Generator-Tab)", () => {
    vi.useFakeTimers();
    const { ctx, starts } = attrappe();
    const player = new PreviewPlayer(() => ctx);
    const p = pattern("T");
    p.parts[1].sampleNumber = 502;
    p.parts[1].steps[0].on = true;
    player.start(p, samples);
    lauf(ctx, 150);
    expect(starts.filter((s) => s.pcm === pcm502)).toHaveLength(1);
    player.stop();
  });
});

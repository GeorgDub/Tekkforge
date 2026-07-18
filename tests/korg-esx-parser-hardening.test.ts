/**
 * tests/features/korg-esx-parser-hardening.test.ts
 *
 * Unit-Tests fuer v3.90.0 ESX-Parser-Hardening — schliesst die 4 dokumentierten
 * Caveats aus v3.89:
 *
 *   (1) PCM-Cap toleriert kleine Overshoots (KASSEL.esx 244B overflow)
 *       → soft-limit auf 25 MiB, warning statt throw bis dahin.
 *
 *   (2) Variant-Header ('OoQC' statt 'KORG') → return empty bank + warning,
 *       statt EsxParseError zu throwen (defense bei Batch-Import).
 *
 *   (3) Song-Events ohne end-marker → hard-stop nach 1000 Iterationen, prevents
 *       infinite-loop bei korrupten Files.
 *
 *   (4) length=0xF7 in Song-Events → als "uninitialized" skipped, statt einen
 *       Event mit weirdem Repeat-Count downstream weiterzureichen.
 */

import { describe, it, expect } from "vitest";
import {
  parseEsxBank,
  parseEsxSongEvents,
  ESX1_SONG_EVENT_END_MARKER,
  type EsxSongEvent,
} from "../src/core/esxParser";
import {
  ESX1_ADDR_NUM_MONO_SAMPLES,
  ESX1_ADDR_SAMPLE_DATA,
  ESX1_ADDR_SAMPLE_HEADER_MONO,
  ESX1_ADDR_SONG_EVENT_DATA,
  ESX1_ADDR_VALID_CHECK_2,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO,
  ESX1_CHUNKSIZE_SONG_EVENT,
  ESX1_MAX_SAMPLE_MEM_IN_BYTES,
  ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES,
  ESX1_SIGNATURE,
  ESX1_SIZE_FILE_MIN,
  ESX1_SUBMAGIC,
  ESX1_SUBMAGIC_OFFSET,
} from "../src/core/constants";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Builds a sequence of 8B song-event frames into a Uint8Array. */
function buildEventFrames(frames: EsxSongEvent[]): Uint8Array {
  const buf = new Uint8Array(frames.length * ESX1_CHUNKSIZE_SONG_EVENT);
  const dv = new DataView(buf.buffer);
  for (let i = 0; i < frames.length; i++) {
    const off = i * ESX1_CHUNKSIZE_SONG_EVENT;
    const f = frames[i];
    dv.setUint16(off, f.time, false);
    dv.setUint8(off + 2, f.pattern);
    dv.setUint8(off + 3, f.length);
    dv.setUint16(off + 4, f.flags, false);
    dv.setUint16(off + 6, f.data, false);
  }
  return buf;
}

/**
 * Builds a minimal valid .esx buffer with N mono samples of given size.
 *
 * @param mono Array of {bytes} (each describes the PCM-byte-length per slot).
 *             We use `bytes` directly (not frames) so we can synthesize files
 *             that overshoot the hardware cap by exact amounts (e.g. 244B).
 */
function buildEsxWithMonoPcm(
  monoPcmBytes: number[],
  opts: {
    /** Overwrite the magic at offset 0 with custom bytes (variant-header tests). */
    magic?: Uint8Array;
    /** Overwrite the sub-magic at 0x0008 (variant-format tests). */
    subMagic?: Uint8Array;
  } = {},
): Uint8Array {
  const totalPcm = monoPcmBytes.reduce((a, b) => a + b, 0);
  const baseSize = ESX1_SIZE_FILE_MIN + totalPcm + 1024;
  const buf = new Uint8Array(baseSize);

  // Magic
  buf.set(opts.magic ?? ESX1_SIGNATURE, 0);
  buf.set(opts.subMagic ?? ESX1_SUBMAGIC, ESX1_SUBMAGIC_OFFSET);
  buf.set(ESX1_SIGNATURE, ESX1_ADDR_VALID_CHECK_2);

  const dv = new DataView(buf.buffer);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 0, monoPcmBytes.length, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 4, 0, false);
  dv.setUint32(ESX1_ADDR_NUM_MONO_SAMPLES + 8, totalPcm, false);

  let pcmCursor = 0;
  for (let i = 0; i < monoPcmBytes.length; i++) {
    const off = ESX1_ADDR_SAMPLE_HEADER_MONO + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
    const lenBytes = monoPcmBytes[i];
    const nameBytes = new TextEncoder().encode(`S${i}`.padEnd(8, "\0"));
    buf.set(nameBytes.subarray(0, 8), off);
    dv.setUint32(off + 8, pcmCursor, false); // off1Start
    dv.setUint32(off + 12, pcmCursor + lenBytes, false); // off1End
    dv.setUint32(off + 16, 0, false); // start
    dv.setUint32(off + 20, lenBytes / 2, false); // end (frames)
    dv.setUint32(off + 24, 0, false); // loopStart
    dv.setUint32(off + 28, 44100, false); // sampleRate
    pcmCursor += lenBytes;
  }
  // PCM-Bereich ist all-zero — Konsumenten lesen real existierende Bytes.

  return buf;
}

// ─── Test 1: PCM-Cap toleriert 1KB overshoot ────────────────────────────────

describe("v3.90.0 — PCM-Cap soft-limit tolerance", () => {
  it("PCM-Cap toleriert 1KB overshoot (KASSEL.esx-Szenario, warning statt throw)", () => {
    // Synthesize a file with cumulative PCM 244 bytes over the hardware cap.
    // The 244 corresponds exactly to the real-world KASSEL.esx overshoot.
    // Per-slot cap = 10 MiB, so we need enough slots <= 10 MiB each that
    // their sum is JUST over the 24-MiB hardware cap.
    const slotSize = 8 * 1024 * 1024; // 8 MiB each — under the 10 MiB per-slot cap
    const numFullSlots = Math.floor(ESX1_MAX_SAMPLE_MEM_IN_BYTES / slotSize);
    const fullSize = numFullSlots * slotSize;
    const overshootBytes = 244;
    const lastSize = ESX1_MAX_SAMPLE_MEM_IN_BYTES - fullSize + overshootBytes;
    const slots = Array.from({ length: numFullSlots }, () => slotSize);
    slots.push(lastSize);
    const buf = buildEsxWithMonoPcm(slots);

    // Must NOT throw — file should parse with a warning.
    const bank = parseEsxBank(buf, "KASSEL-like.esx");
    expect(bank).toBeDefined();
    expect(bank.monoSamples.length).toBe(slots.length);
    // Should emit exactly one warning about exceeding the hardware cap.
    const capWarnings = bank.warnings.filter((w) =>
      /exceeds ESX-1 hardware cap/.test(w),
    );
    expect(capWarnings.length).toBe(1);
    expect(capWarnings[0]).toMatch(/soft-limit/);
  });

  it("PCM-Cap soft-limit threshold = 25 MiB", () => {
    // Verify the constant exists and is greater than the hardware cap by ~1 MiB.
    expect(ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES).toBe(25 * 1024 * 1024);
    expect(ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES).toBeGreaterThan(ESX1_MAX_SAMPLE_MEM_IN_BYTES);
    // Headroom should be at least 244 bytes (the observed KASSEL overshoot).
    expect(
      ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES - ESX1_MAX_SAMPLE_MEM_IN_BYTES,
    ).toBeGreaterThanOrEqual(244);
  });
});

// ─── Test 2: Variant-Header 'OoQC' → empty bank + warning ───────────────────

describe("v3.90.0 — Variant-Header tolerance", () => {
  it("Variant-Header 'OoQC' → empty bank + warning, KEIN throw", () => {
    const variantMagic = new Uint8Array([0x4f, 0x6f, 0x51, 0x43]); // "OoQC"
    const buf = buildEsxWithMonoPcm([1024], { magic: variantMagic });

    // Must NOT throw.
    let bank: ReturnType<typeof parseEsxBank> | undefined;
    expect(() => {
      bank = parseEsxBank(buf, "variant.esx");
    }).not.toThrow();
    expect(bank).toBeDefined();
    expect(bank!.monoSamples).toEqual([]);
    expect(bank!.stereoSamples).toEqual([]);
    expect(bank!.patterns).toEqual([]);
    expect(bank!.songs).toEqual([]);
    // Warning enthaelt den variant-string fuer Debug-Zwecke.
    expect(bank!.warnings.length).toBeGreaterThan(0);
    expect(bank!.warnings[0]).toMatch(/OoQC|unsupported variant header/);
  });

  it("Variant sub-format (invalid 'ESX\\0' at 0x08) → empty bank + warning", () => {
    const badSubMagic = new Uint8Array([0x45, 0x32, 0x53, 0x00]); // "E2S\0"
    const buf = buildEsxWithMonoPcm([1024], { subMagic: badSubMagic });

    let bank: ReturnType<typeof parseEsxBank> | undefined;
    expect(() => {
      bank = parseEsxBank(buf, "wrong-subformat.esx");
    }).not.toThrow();
    expect(bank!.warnings[0]).toMatch(/unsupported sub-format/);
    expect(bank!.monoSamples).toEqual([]);
  });
});

// ─── Test 3: Events max 1000 iterations (no infinite loop) ──────────────────

describe("v3.90.0 — Song-Event hard-stop", () => {
  it("Events max 1000 iterations (no infinite loop) — silent hard-stop bei nur garbage", () => {
    // Build a buffer with 1500 non-terminator events (no 0xFFFF anywhere).
    // Without a single end-marker, the file looks like "no songs used" + random
    // bytes — we break silently to avoid polluting warnings.
    const NUM_EVENTS = 1500;
    const events: EsxSongEvent[] = [];
    for (let i = 0; i < NUM_EVENTS; i++) {
      events.push({
        time: (i + 1) & 0xffff,
        pattern: (i % 256) & 0xff,
        length: 4,
        flags: 0,
        data: 0x0001, // explicitly NOT 0xFFFF
      });
    }
    const frames = buildEventFrames(events);

    const file = new Uint8Array(ESX1_ADDR_SONG_EVENT_DATA + frames.length + 64);
    file.set(frames, ESX1_ADDR_SONG_EVENT_DATA);

    // The loop must stop after ~1000 iterations WITHOUT emitting a hard-stop
    // warning (currentSong=0, so we're skeptical of pseudo-events).
    const { eventsPerSong, warnings } = parseEsxSongEvents(file, 4);
    expect(warnings.filter((w) => /1000 events without end-marker/.test(w))).toEqual([]);
    // Song 0 should have <= 1000 events (we cap, we don't get all 1500).
    expect(eventsPerSong[0].length).toBeLessThanOrEqual(1000);
    // And the hard-stop must have triggered — Song 0 must NOT have all 1500.
    expect(eventsPerSong[0].length).toBeLessThan(NUM_EVENTS);
  });

  it("Hard-stop warning fires when corruption happens AFTER a real song (currentSong > 0)", () => {
    // First song completes cleanly with end-marker. Then 1500 garbage frames
    // without terminator → warning should fire (we have known real song-data).
    const NUM_GARBAGE = 1500;
    const events: EsxSongEvent[] = [
      { time: 0, pattern: 1, length: 4, flags: 0, data: 0 },
      { time: 16, pattern: 0, length: 0, flags: 0, data: ESX1_SONG_EVENT_END_MARKER },
    ];
    for (let i = 0; i < NUM_GARBAGE; i++) {
      events.push({
        time: (i + 1) & 0xffff,
        pattern: (i % 256) & 0xff,
        length: 4,
        flags: 0,
        data: 0x0001,
      });
    }
    const frames = buildEventFrames(events);
    const file = new Uint8Array(ESX1_ADDR_SONG_EVENT_DATA + frames.length + 64);
    file.set(frames, ESX1_ADDR_SONG_EVENT_DATA);

    const { warnings } = parseEsxSongEvents(file, 4);
    expect(warnings.some((w) => /1000 events without end-marker/.test(w))).toBe(true);
  });

  it("Hard-stop counter resets on each end-marker — multiple healthy songs work", () => {
    // Build 3 healthy songs of 500 events each, separated by 0xFFFF markers.
    // Total = 1503 events — would trip the global hard-stop without reset logic.
    const events: EsxSongEvent[] = [];
    for (let s = 0; s < 3; s++) {
      for (let i = 0; i < 500; i++) {
        events.push({
          time: i & 0xffff,
          pattern: i & 0xff,
          length: 4,
          flags: 0,
          data: 0x0001,
        });
      }
      events.push({
        time: 0,
        pattern: 0,
        length: 0,
        flags: 0,
        data: ESX1_SONG_EVENT_END_MARKER,
      });
    }
    const frames = buildEventFrames(events);
    const file = new Uint8Array(ESX1_ADDR_SONG_EVENT_DATA + frames.length + 64);
    file.set(frames, ESX1_ADDR_SONG_EVENT_DATA);

    const { eventsPerSong, warnings } = parseEsxSongEvents(file, 4);
    // No hard-stop warning because each song has < 1000 events.
    expect(warnings.filter((w) => /without end-marker/.test(w))).toEqual([]);
    // Songs 0..2 each get their 500 events + the terminator.
    expect(eventsPerSong[0].length).toBe(501);
    expect(eventsPerSong[1].length).toBe(501);
    expect(eventsPerSong[2].length).toBe(501);
    expect(eventsPerSong[3]).toEqual([]);
  });
});

// ─── Test 4: length=0xF7 skipped als init-marker ────────────────────────────

describe("v3.90.0 — length=0xF7 init-marker skip", () => {
  it("length=0xF7 skipped als init-marker — Events landen NICHT in eventsPerSong", () => {
    // Mix of init-marker events (0xF7) and real events.
    const frames = buildEventFrames([
      { time: 0, pattern: 1, length: 4, flags: 0, data: 0 }, // real
      { time: 16, pattern: 2, length: 0xf7, flags: 0, data: 0 }, // INIT → skip
      { time: 32, pattern: 3, length: 8, flags: 0, data: 0 }, // real
      { time: 48, pattern: 4, length: 0xf7, flags: 0, data: 0 }, // INIT → skip
      // End-of-song
      { time: 64, pattern: 0, length: 0, flags: 0, data: ESX1_SONG_EVENT_END_MARKER },
    ]);
    const file = new Uint8Array(ESX1_ADDR_SONG_EVENT_DATA + frames.length + 64);
    file.set(frames, ESX1_ADDR_SONG_EVENT_DATA);

    const { eventsPerSong } = parseEsxSongEvents(file, 4);
    // Should have only 2 real events + 1 terminator = 3 entries, not 5.
    expect(eventsPerSong[0].length).toBe(3);
    expect(eventsPerSong[0][0].pattern).toBe(1);
    expect(eventsPerSong[0][1].pattern).toBe(3);
    expect(eventsPerSong[0][2].data).toBe(ESX1_SONG_EVENT_END_MARKER);
    // Pattern-2/4 (with length=0xF7) must not appear.
    expect(eventsPerSong[0].every((e) => e.length !== 0xf7)).toBe(true);
  });

  it("length=0xF7 wird auch in der end-marker-Path nicht skipped (data=0xFFFF wins)", () => {
    // Edge case: an event with BOTH length=0xF7 AND data=0xFFFF. The end-marker
    // takes precedence — we must still close the current song.
    const frames = buildEventFrames([
      { time: 0, pattern: 1, length: 4, flags: 0, data: 0 },
      { time: 16, pattern: 0, length: 0xf7, flags: 0, data: ESX1_SONG_EVENT_END_MARKER },
      { time: 0, pattern: 5, length: 8, flags: 0, data: 0 },
      { time: 32, pattern: 0, length: 0, flags: 0, data: ESX1_SONG_EVENT_END_MARKER },
    ]);
    const file = new Uint8Array(ESX1_ADDR_SONG_EVENT_DATA + frames.length + 64);
    file.set(frames, ESX1_ADDR_SONG_EVENT_DATA);

    const { eventsPerSong } = parseEsxSongEvents(file, 4);
    expect(eventsPerSong[0].length).toBe(2); // 1 real + 1 terminator (even with 0xF7-length)
    expect(eventsPerSong[1].length).toBe(2);
    expect(eventsPerSong[1][0].pattern).toBe(5);
  });
});

// ─── Suppress unused-import warning when ESX1_ADDR_SAMPLE_DATA is opportunistic
void ESX1_ADDR_SAMPLE_DATA;

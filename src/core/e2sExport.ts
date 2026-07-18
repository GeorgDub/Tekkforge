/**
 * client/src/utils/e2sExport.ts
 *
 * v3.271.0 — KORG Electribe 2 Sampler export via TEMPLATE-OVERLAY.
 *
 * WHY THIS EXISTS (and why it replaces the from-scratch builder):
 *   The previous `electribePatternBuilder.ts` synthesised `.e2spat` files from
 *   zero. Byte-diffing real KORG files (in "Korg e2s files/") against that
 *   output proved it got several things wrong that the hardware rejects:
 *     - Part headers (sample-ID, filter, amp-EG, motion config) were left all
 *       zero. Real parts carry a structured 48-byte config block.
 *     - Step records used the wrong field layout (note/velocity swapped, the
 *       gate-flag byte 3 and gate-length byte 4 were never written) → even a
 *       "valid-size" file produced silent / malformed steps.
 *   Its round-trip tests passed because the builder and the parser shared the
 *   same wrong spec. Real files are the only ground truth.
 *
 * APPROACH:
 *   Start from a real, hardware-valid pattern body (factory "Init Pattern",
 *   embedded in `e2sExportAssets.ts`, with its step records normalized to the
 *   canonical inactive form). Overlay ONLY the fields whose offsets are verified
 *   against the real files; leave every opaque region (part config, motion
 *   tables, global bank settings) exactly as the hardware wrote it. The output
 *   is therefore byte-identical to a real file except where we intentionally
 *   wrote pattern content.
 *
 * VERIFIED FORMAT (all offsets little-endian; "body" = one 16384-byte PTST record):
 *
 *   .e2spat (single pattern, 16640 bytes):
 *     0x000  256B  file header: "KORG"\0… + "e2sampler"\0… + u32 ver=1 + 0xFF pad
 *     0x100  16384B PTST body
 *
 *   .e2sallpat (250-pattern bank, 4 161 792 bytes):
 *     0x00000  256B    file header (same as above; "GLST" replaces "PTST"@0x100)
 *     0x00100  256B    GLST/GLED global block (embedded verbatim)
 *     0x00200  65280B  0xFF padding → prefix ends at 0x10100
 *     0x10100  250×16384B  pattern bodies
 *
 *   PTST body (offsets relative to body start):
 *     +0x000  4B   "PTST"
 *     +0x010  16B  pattern name, ASCII, NUL-padded
 *     +0x022  2B   BPM × 10 (u16 LE)
 *     +0x025  1B   step-length code (16→0, 32→1, 64→3)
 *     +0x800  16×816B  parts
 *       part +0x15  volume (0..127)
 *       part +0x22  pan    (0..127, 64 = center)
 *       part +0x30  64×12B step records:
 *         byte 0  trigger     (1 = active, 0 = off)
 *         byte 1  note        (0x48 = C5 default)
 *         byte 2  velocity    (0x60 = 96 default, 0x7F max)
 *         byte 3  gate flag   (1 on active steps — MUST be set or the step is silent)
 *         byte 4  gate length (0x3D ≈ typical; never 0 on active steps)
 *         bytes 5..11  reserved 0
 *
 * Pure TypeScript, isomorphic (no Electron/DOM deps) — safe in Node test ctx.
 *
 * LIMITATION: samples are NOT transferred by this path (that is the separate
 * `.all` sample-bank builder). Exported patterns trigger whatever samples the
 * destination Electribe has loaded in the matching part slots.
 */

import { E2S_INIT_BODY_B64, E2S_GLST_BLOCK_B64 } from "./e2sExportAssets";
import type { E2PatternInput } from "./electribePatternBuilder";

// ─── Layout constants (verified against real KORG files) ─────────────────────

/** One PTST pattern body. */
export const E2S_BODY_SIZE = 0x4000; // 16384
/** Standalone .e2spat file header. */
export const E2S_FILE_HEADER_SIZE = 0x100; // 256
/** Standalone .e2spat total size. */
export const E2S_SINGLE_FILE_SIZE = E2S_FILE_HEADER_SIZE + E2S_BODY_SIZE; // 16640
/** .e2sallpat prefix (header + GLST block + 0xFF pad). */
export const E2S_ALLPAT_PREFIX_SIZE = 0x10100; // 65792
/** Pattern slots in a bank (hardware-fixed). */
export const E2S_ALLPAT_SLOT_COUNT = 250;
/** .e2sallpat total size. */
export const E2S_ALLPAT_FILE_SIZE =
  E2S_ALLPAT_PREFIX_SIZE + E2S_ALLPAT_SLOT_COUNT * E2S_BODY_SIZE; // 4_161_792

const GLST_OFFSET = 0x100;

// body-relative field offsets
const NAME_OFF = 0x10;
const BPM_OFF = 0x22;
const STEPLEN_OFF = 0x25;
const PARTS_OFF = 0x800;
const PART_STRIDE = 816; // 0x330
/** Per-part sample reference (u16 LE). Verified against 4000 real-bank parts:
 *  values span 1..~500 (factory sample numbers), 0 = no/empty sample.
 *  (The read-side parser historically guessed +0x04, which is almost always 0.) */
const PART_SAMPLE_OFF = 0x08;
const PART_VOLUME_OFF = 0x15;
const PART_PAN_OFF = 0x22;
const PART_STEPS_OFF = 0x30;
const STEP_RECORD_SIZE = 12;
const STEPS_PER_PART = 64;
const PARTS_PER_PATTERN = 16;

// step-record byte positions
const STEP_TRIGGER = 0;
const STEP_NOTE = 1;
const STEP_VELOCITY = 2;
const STEP_GATE = 3;
const STEP_GATELEN = 4;

// step-record defaults (match the normalized template / observed real files)
const DEFAULT_NOTE = 0x48; // C5
const DEFAULT_VELOCITY = 0x60; // 96
const DEFAULT_GATELEN = 0x3d; // most common gate length across real files

const STEP_LENGTH_CODE: Record<number, number> = { 16: 0, 32: 1, 64: 3 };

const BPM_MIN_X10 = 200; // 20.0 BPM
const BPM_MAX_X10 = 3000; // 300.0 BPM

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Isomorphic base64 → bytes (browser/Electron `atob`, Node `Buffer`). */
function b64ToBytes(b64: string): Uint8Array {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // Node / SSR
  return new Uint8Array((globalThis as { Buffer?: { from(s: string, e: string): Uint8Array } }).Buffer!.from(b64, "base64"));
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const v = Math.floor(value);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/** Write `value` as printable ASCII into `bytes[offset..offset+length)`,
 *  NUL-padded after the content. Non-printable chars become '?'. */
function writeAsciiNul(bytes: Uint8Array, offset: number, value: string, length: number): void {
  const safe = typeof value === "string" ? value : "";
  for (let i = 0; i < length; i++) {
    if (i < safe.length) {
      const ch = safe.charCodeAt(i);
      bytes[offset + i] = ch >= 32 && ch <= 126 ? ch : 0x3f;
    } else {
      bytes[offset + i] = 0x00;
    }
  }
}

/** Writes the 256-byte KORG file header (shared by .e2spat and .e2sallpat). */
function writeFileHeader(bytes: Uint8Array): void {
  // "KORG" @ 0x00
  bytes[0] = 0x4b;
  bytes[1] = 0x4f;
  bytes[2] = 0x52;
  bytes[3] = 0x47;
  // "e2sampler" @ 0x10
  const id = "e2sampler";
  for (let i = 0; i < id.length; i++) bytes[0x10 + i] = id.charCodeAt(i);
  // version u32 LE = 1 @ 0x20
  bytes[0x20] = 0x01;
  // 0xFF padding 0x24..0x100
  for (let i = 0x24; i < 0x100; i++) bytes[i] = 0xff;
}

// ─── Body overlay ─────────────────────────────────────────────────────────────

/**
 * Builds one 16384-byte PTST pattern body by overlaying `input` onto a fresh
 * copy of the real init-pattern template. Returns a new `Uint8Array`.
 */
export function buildE2PatternBody(input: E2PatternInput): Uint8Array {
  const body = b64ToBytes(E2S_INIT_BODY_B64).slice(); // fresh 16384-byte copy
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);

  // Name @ +0x10
  writeAsciiNul(body, NAME_OFF, input.name ?? "", 16);

  // BPM × 10 @ +0x22 (u16 LE)
  const bpmX10 = clampInt(
    Math.round((typeof input.bpm === "number" && Number.isFinite(input.bpm) ? input.bpm : 120) * 10),
    BPM_MIN_X10,
    BPM_MAX_X10,
    1200,
  );
  view.setUint16(BPM_OFF, bpmX10, true);

  // Step-length code @ +0x25
  body[STEPLEN_OFF] = STEP_LENGTH_CODE[input.stepLength] ?? 0;

  // Parts
  const parts = Array.isArray(input.parts) ? input.parts : [];
  for (let p = 0; p < PARTS_PER_PATTERN; p++) {
    const part = parts[p];
    if (!part) continue; // leave template part untouched (inactive + valid config)

    const partStart = PARTS_OFF + p * PART_STRIDE;
    if (typeof part.volume === "number") {
      body[partStart + PART_VOLUME_OFF] = clampInt(part.volume, 0, 127, 127);
    }
    if (typeof part.pan === "number") {
      body[partStart + PART_PAN_OFF] = clampInt(part.pan, 0, 127, 64);
    }
    // Per-part sample reference @ +0x08 (u16 LE). Only written when the caller
    // provides one (e.g. repointing parts to imported user samples at 501+);
    // otherwise the template's factory sample assignment is preserved.
    if (typeof part.sampleId === "number" && Number.isFinite(part.sampleId)) {
      view.setUint16(partStart + PART_SAMPLE_OFF, clampInt(part.sampleId, 0, 0xffff, 0), true);
    }

    const steps = Array.isArray(part.steps) ? part.steps : [];
    for (let s = 0; s < STEPS_PER_PART; s++) {
      const so = partStart + PART_STEPS_OFF + s * STEP_RECORD_SIZE;
      const step = steps[s];
      if (step && step.active) {
        body[so + STEP_TRIGGER] = 0x01;
        body[so + STEP_NOTE] = clampInt(step.note, 0, 127, DEFAULT_NOTE);
        body[so + STEP_VELOCITY] = clampInt(step.velocity, 0, 127, DEFAULT_VELOCITY);
        body[so + STEP_GATE] = 0x01; // gate ON — required or the step is silent
        body[so + STEP_GATELEN] = DEFAULT_GATELEN;
      } else {
        // canonical inactive record (template already matches; enforce for safety)
        body[so + STEP_TRIGGER] = 0x00;
        body[so + STEP_NOTE] = DEFAULT_NOTE;
        body[so + STEP_VELOCITY] = DEFAULT_VELOCITY;
        body[so + STEP_GATE] = 0x00;
        body[so + STEP_GATELEN] = 0x00;
      }
      // bytes 5..11 remain as the template (zero) — never touched.
    }
  }

  return body;
}

// ─── Single pattern (.e2spat) ──────────────────────────────────────────────────

/**
 * Builds a complete 16640-byte `.e2spat` file from an `E2PatternInput`.
 * Always exactly `E2S_SINGLE_FILE_SIZE` bytes.
 */
export function buildE2PatternFileV2(input: E2PatternInput): ArrayBuffer {
  const out = new Uint8Array(E2S_SINGLE_FILE_SIZE);
  writeFileHeader(out);
  out.set(buildE2PatternBody(input), E2S_FILE_HEADER_SIZE);
  return out.buffer;
}

// ─── All patterns (.e2sallpat) ─────────────────────────────────────────────────

/**
 * Builds a complete `.e2sallpat` bank (250 slots) from a list of patterns.
 * Patterns fill slots 0..N-1 (max 250 — extras are dropped); the remaining
 * slots are filled with the real factory init-pattern body (NOT zeros — empty
 * bank slots are valid init patterns on real hardware).
 *
 * Always exactly `E2S_ALLPAT_FILE_SIZE` bytes.
 */
export function buildE2AllPatFile(patterns: E2PatternInput[]): ArrayBuffer {
  const out = new Uint8Array(E2S_ALLPAT_FILE_SIZE);

  // Header (0x00..0x100). "GLST" then overwrites 0x100.
  writeFileHeader(out);
  // GLST/GLED global block @ 0x100 (verbatim from a real bank).
  out.set(b64ToBytes(E2S_GLST_BLOCK_B64), GLST_OFFSET);
  // 0xFF padding 0x200..0x10100.
  out.fill(0xff, 0x200, E2S_ALLPAT_PREFIX_SIZE);

  const initBody = b64ToBytes(E2S_INIT_BODY_B64);
  const list = Array.isArray(patterns) ? patterns : [];
  for (let i = 0; i < E2S_ALLPAT_SLOT_COUNT; i++) {
    const slotOff = E2S_ALLPAT_PREFIX_SIZE + i * E2S_BODY_SIZE;
    const pat = list[i];
    out.set(pat ? buildE2PatternBody(pat) : initBody, slotOff);
  }

  return out.buffer;
}

// ─── Structural validators (mirror the IPC-side checks) ─────────────────────────

/** Quick structural sanity-check for a built `.e2sallpat` buffer. */
export function looksLikeE2AllPatFile(buffer: ArrayBuffer | Uint8Array): boolean {
  try {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (u8.byteLength !== E2S_ALLPAT_FILE_SIZE) return false;
    // "KORG" @ 0x00
    if (u8[0] !== 0x4b || u8[1] !== 0x4f || u8[2] !== 0x52 || u8[3] !== 0x47) return false;
    // "e2sa" @ 0x10
    if (u8[0x10] !== 0x65 || u8[0x11] !== 0x32 || u8[0x12] !== 0x73 || u8[0x13] !== 0x61) {
      return false;
    }
    // "GLST" @ 0x100
    if (u8[0x100] !== 0x47 || u8[0x101] !== 0x4c || u8[0x102] !== 0x53 || u8[0x103] !== 0x54) {
      return false;
    }
    // "PTST" @ first pattern slot (0x10100)
    if (
      u8[0x10100] !== 0x50 ||
      u8[0x10101] !== 0x54 ||
      u8[0x10102] !== 0x53 ||
      u8[0x10103] !== 0x54
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

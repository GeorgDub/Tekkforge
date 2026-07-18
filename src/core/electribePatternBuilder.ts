/**
 * client/src/utils/electribePatternBuilder.ts
 *
 * v3.26.0 — E2 Pattern WRITE (.e2spat)
 * v3.34.0 — BIT-EXACT POLISH: Adopt 3 KORG-native encoding conventions
 *           (name NUL-pad, 0xFF velocity sentinel, inactive-step note 0x00)
 *           to close the encoding-style drift the v3.33 real-file round-trip
 *           tests surfaced. Parser semantics unchanged; output is closer to
 *           real KORG E2 byte layout.
 *
 * Encodes a Synthstudio-Pattern into a binary 16640-byte KORG Electribe 2
 * Sampler `.e2spat` file. Pure-TypeScript, isomorphic, no Electron/DOM deps.
 *
 * SoT for the binary layout is the verified READ-side parser in
 * `client/src/utils/electribeImport.ts` (v3.5/v3.12/v3.13/v3.15). Field offsets,
 * stride values and step-record encoding are kept in lock-step with the
 * constants imported from there — round-trip tests assert that buildE2Pattern
 * → parseRealPattern produces the same `E2PatternInput` back.
 *
 * Layout summary (absolute offsets, all little-endian):
 *
 *   0x000  16B   "KORG" + 12 × 0x00
 *   0x010  16B   "e2sampler" + 7 × 0x00
 *   0x020  4B    Version (u32 LE = 1)
 *   0x024  220B  Padding 0xFF (matches real KORG bank dumps)
 *   0x100  16B   "PTST" + 12 × 0x00
 *   0x110  16B   Pattern name, ASCII, space-padded (0x20)
 *   0x120  2B    Reserved (0x00 0x00)
 *   0x122  2B    BPM × 10 (u16 LE, e.g. 1200 = 120.0 BPM)
 *   0x125  1B    Step-length code (0 = 16, 1 = 32, 3 = 64)
 *   0x200  256B  PTST motion ParamID-table (PTST+0x100 = 0x200), TargetPart-table @ 0x218, ...
 *                Slot-data @ 0x230 (8 slots × 64B = 512B → ends 0x430)
 *   0x900  13056B 16 parts × 816B
 *     per part (offsets relative to part_start):
 *       +0x00..0x2F  48B Part-Header
 *         +0x15  Volume (0..127, default 0x7F=127)
 *         +0x22  Pan    (0..127, 64 = center)
 *         (+0x08 Pitch, +0x0B FxSend — see spec, not currently used by reader
 *          but written with conservative defaults so round-trip stays clean)
 *       +0x30..0x32F 64 × 12B Step-Records
 *         byte 0: Trigger (0x00 = off, 0x01 = on)
 *         byte 1: Velocity (0..127, default 0x60 = 96)
 *         byte 2: Constant 0x60 (note-attribute prefix)
 *         byte 3: Accent flag (0x00 / 0x01)
 *         byte 4: Note number (MIDI 0..127, default 0x48 = C5)
 *         bytes 5..11: Reserved 0x00
 *
 *   Total file size: 0x900 + 16 × 816 = 0x900 + 13056 = 16640 bytes EXACT.
 *
 * The pattern-level Motion-Sequencer table at PTST+0x100..0x330 (= absolute
 * 0x200..0x430) is optional. If `motionSlots` is omitted, the region is
 * zero-filled which the reader interprets as "all disabled".
 */

import {
  ELECTRIBE_MAGIC,
  ELECTRIBE_REAL_IDENTIFIER,
  ELECTRIBE_REAL_PATTERN_MARKER,
  ELECTRIBE_REAL_FILE_SIZE,
  ELECTRIBE_REAL_NAME_OFFSET,
  ELECTRIBE_REAL_BPM_OFFSET,
  ELECTRIBE_REAL_PARTS_OFFSET,
  ELECTRIBE_REAL_PART_STRIDE,
  ELECTRIBE_REAL_PART_HEADER_BYTES,
  ELECTRIBE_REAL_PART_VOLUME_OFFSET,
  ELECTRIBE_REAL_PART_PAN_OFFSET,
  ELECTRIBE_REAL_STEP_LENGTH_OFFSET,
  ELECTRIBE_REAL_STEP_RECORD_BYTES,
  ELECTRIBE_REAL_STEPS_PER_PART,
  ELECTRIBE_REAL_STEP_TRIGGER_OFFSET,
  ELECTRIBE_REAL_STEP_VELOCITY_OFFSET,
  ELECTRIBE_REAL_STEP_NOTE_OFFSET,
  ELECTRIBE_REAL_VELOCITY_DEFAULT_SENTINEL,
  ELECTRIBE_REAL_VELOCITY_DEFAULT_VALUE,
  ELECTRIBE_MOTION_PARAM_TABLE_OFFSET,
  ELECTRIBE_MOTION_TARGET_TABLE_OFFSET,
  ELECTRIBE_MOTION_DATA_TABLE_OFFSET,
  ELECTRIBE_MOTION_SLOTS_PER_PATTERN,
  ELECTRIBE_MOTION_VALUES_PER_SLOT,
  ELECTRIBE_MOTION_SLOT_STRIDE,
  ELECTRIBE_MIN_BPM,
  ELECTRIBE_MAX_BPM,
  PARTS_PER_PATTERN,
} from "./electribeImport";

// ─── Public API types ────────────────────────────────────────────────────────

export interface E2StepInput {
  /** True if the step should trigger. */
  active: boolean;
  /** 0..127 velocity. Default 96 (0x60) when unset. */
  velocity?: number;
  /** Accent / tied flag. Default false. */
  accent?: boolean;
  /** MIDI note 0..127. Default 0x48 (C5). */
  note?: number;
}

export interface E2PartInput {
  /** Optional sample reference. Not currently encoded in the part-header (the
   *  read-side does not decode this field deterministically). Kept for future use. */
  sampleId?: number;
  /** 0..127 — Part Volume @ part+0x15. Default 127 (Hardware-Standard). */
  volume?: number;
  /** 0..127 — Part Pan @ part+0x22 (64 = center). Default 64. */
  pan?: number;
  /** Pitch in semitones. Currently not bit-exact-decoded by reader → written
   *  as a signed byte in part+0x08, but reader returns 0 either way. */
  pitch?: number;
  /** 0..127 — Effect-Send. Default 0. */
  fxSend?: number;
  /** Trigger steps. Will be padded to 64 entries with `{active: false}`. */
  steps: E2StepInput[];
}

export interface E2MotionSlot {
  /** Param-ID (0..127, 0 = disabled). */
  paramId: number;
  /** Target part-index 0..15 (mapped to raw byte = index+1). -1 / undefined =
   *  "global / disabled" (raw byte = 0). */
  targetPart?: number;
  /** Up to 64 sample values 0..127. Missing entries are zero-filled. */
  values: number[];
}

export interface E2PatternInput {
  /** Pattern name. Truncated to 16 ASCII chars, space-padded. */
  name: string;
  /** BPM 20..300 (1 decimal precision — gets encoded as BPM × 10 u16 LE). */
  bpm: number;
  /** Step length. Only 16 / 32 / 64 are valid (mapped to code 0 / 1 / 3). */
  stepLength: 16 | 32 | 64;
  /** Swing 0..100 (currently NOT bit-exact-decoded; reader returns 0). */
  swing?: number;
  /** Exactly 16 parts. Missing parts are padded with all-default empty parts. */
  parts: E2PartInput[];
  /** Up to 8 motion slots. Missing slots are zero-filled (disabled). */
  motionSlots?: E2MotionSlot[];
}

// ─── Step-length code mapping (inverse of ELECTRIBE_REAL_STEP_LENGTH_CODES) ──

const STEP_LENGTH_CODE_MAP: Record<16 | 32 | 64, number> = {
  16: 0,
  32: 1,
  64: 3,
};

// ─── Defaults (match observed read-side defaults / bank-histogram defaults) ──

/** v3.34: Default velocity written when caller doesn't set one is now encoded
 *  as the 0xFF sentinel byte the KORG hardware uses ("use default 127"). The
 *  parser decodes 0xFF → 127, so the semantic round-trip is `undefined →
 *  byte 0xFF → parsed velocity 127`. This matches the byte layout observed in
 *  the real BodyTalk1 reference file across ~1000 active step records. */
export const E2_DEFAULT_VELOCITY = ELECTRIBE_REAL_VELOCITY_DEFAULT_VALUE; // 127
/** v3.34: Raw byte written for unset (or 127) velocity — KORG default sentinel. */
export const E2_DEFAULT_VELOCITY_RAW_BYTE = ELECTRIBE_REAL_VELOCITY_DEFAULT_SENTINEL; // 0xFF
/** Default MIDI note (C5) — matches the `0x48` constant observed across the
 *  Init181 reference file (1024 identical step-records). Used ONLY for ACTIVE
 *  steps; inactive steps now write 0x00 (smaller bit-drift vs real files). */
export const E2_DEFAULT_NOTE = 0x48;
/** v3.34: Inactive-step note byte. Real Init181 uses 0x00 (smaller drift vs
 *  the BodyTalk1 0x48 alternative). Parser ignores per-step note. */
export const E2_INACTIVE_STEP_NOTE = 0x00;
/** Byte 2 of every step record is a constant 0x60 (note-attribute prefix). */
export const E2_STEP_BYTE2_CONSTANT = 0x60;

/** Default part volume (Hardware-Standard, observed in 63.4% of bank samples). */
export const E2_DEFAULT_PART_VOLUME = 127;
/** Default part pan (Center, observed in 59.7% of bank samples). */
export const E2_DEFAULT_PART_PAN = 64;

// Conservative offsets for the parts of the part-header the reader does NOT
// currently decode but we want round-trip-stable defaults for. These are
// "best-effort" — the read-side ignores them, so they don't affect the
// declared round-trip property.
const PART_PITCH_OFFSET = 0x08;
const PART_FXSEND_OFFSET = 0x0b;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  const v = Math.floor(value);
  if (v < min) return min;
  if (v > max) return max;
  return v;
}

/**
 * v3.34: Writes an ASCII string into `view` starting at `offset`, truncated to
 * `length` bytes and NUL-padded (0x00) after the string-content. Non-ASCII
 * chars in the content are coerced to '?'.
 *
 * Real KORG E2 hardware files use NUL-padding after the name (e.g.
 * `"BodyTalk1\x00\x00\x00\x00\x00\x00\x00"` for a 9-char name in a 16-byte
 * field). Some files have trailing spaces then NUL (`"BodyTalk1\x20\x20\x20\x00..."`).
 * Either form decodes identically through `readAsciiAt` (which strips NUL
 * and trims trailing whitespace), but adopting the NUL-padding convention
 * brings the builder output byte-closer to real-file layout (typical drift
 * reduction: 5-7 bytes per file).
 *
 * Functions identically to the pre-v3.34 space-padded variant w.r.t. the
 * parser; the change is encoding-style only.
 */
function writeAsciiNulPadded(view: DataView, offset: number, value: string, length: number): void {
  const safe = typeof value === "string" ? value : "";
  for (let i = 0; i < length; i++) {
    if (i < safe.length) {
      const ch = safe.charCodeAt(i);
      // Only printable ASCII (32..126). Replace others with '?'.
      const byte = ch >= 32 && ch <= 126 ? ch : 0x3f;
      view.setUint8(offset + i, byte);
    } else {
      view.setUint8(offset + i, 0x00);
    }
  }
}

function writeAscii(view: DataView, offset: number, value: string, length: number): void {
  // Zero-padded variant (used for the "KORG"/"e2sampler"/"PTST" markers).
  const safe = typeof value === "string" ? value : "";
  for (let i = 0; i < length; i++) {
    if (i < safe.length) {
      const ch = safe.charCodeAt(i);
      view.setUint8(offset + i, ch >= 32 && ch <= 126 ? ch : 0x00);
    } else {
      view.setUint8(offset + i, 0x00);
    }
  }
}

// ─── Builder Sub-Functions ───────────────────────────────────────────────────

/**
 * Writes a single 12-byte step record at the given file-absolute offset.
 *
 * v3.34 encoding (matches v3.12 read-side semantics + real-KORG byte layout):
 *   byte 0: trigger (0/1)
 *   byte 1: velocity raw byte:
 *             - 0xFF "default" sentinel when caller did NOT pass velocity
 *               OR explicitly passed velocity===127
 *             - 0..127 literal when caller passed a non-127 value
 *           (Parser maps 0xFF → 127, so both forms decode identically.)
 *   byte 2: constant 0x60
 *   byte 3: accent flag (0/1)
 *   byte 4: note number:
 *             - ACTIVE steps:   clamp(note, 0..127), default 0x48 (C5)
 *             - INACTIVE steps: 0x00 (Real Init181 convention — parser
 *               doesn't expose per-step note so this is encoding-only)
 *   bytes 5..11: zero
 */
export function writeStepRecord(view: DataView, offset: number, step: E2StepInput): void {
  const trigger = step.active ? 0x01 : 0x00;
  const accent = step.accent ? 0x01 : 0x00;

  // v3.34 — velocity byte
  let velocityByte: number;
  const hasExplicitVelocity =
    typeof step.velocity === "number" && Number.isFinite(step.velocity);
  if (!hasExplicitVelocity) {
    // Unset → KORG "use-default-127" sentinel.
    velocityByte = E2_DEFAULT_VELOCITY_RAW_BYTE; // 0xFF
  } else {
    const v = clampInt(step.velocity, 0, 127, ELECTRIBE_REAL_VELOCITY_DEFAULT_VALUE);
    // Explicit 127 → also 0xFF sentinel (matches KORG hardware encoding,
    // round-trips to 127 through the parser).
    velocityByte = v === ELECTRIBE_REAL_VELOCITY_DEFAULT_VALUE
      ? E2_DEFAULT_VELOCITY_RAW_BYTE
      : v;
  }

  // v3.34 — note byte: inactive steps get 0x00 (smaller drift vs real files
  // for sparse patterns; parser doesn't expose per-step note).
  let noteByte: number;
  if (!step.active) {
    noteByte = E2_INACTIVE_STEP_NOTE; // 0x00
  } else {
    noteByte = clampInt(step.note, 0, 127, E2_DEFAULT_NOTE); // default 0x48
  }

  view.setUint8(offset + ELECTRIBE_REAL_STEP_TRIGGER_OFFSET, trigger);
  view.setUint8(offset + ELECTRIBE_REAL_STEP_VELOCITY_OFFSET, velocityByte);
  view.setUint8(offset + 2, E2_STEP_BYTE2_CONSTANT);
  view.setUint8(offset + 3, accent);
  view.setUint8(offset + ELECTRIBE_REAL_STEP_NOTE_OFFSET, noteByte);
  // bytes 5..11 are already 0 (full file is zero-initialised before fill).
}

/**
 * Writes one 816-byte part block (header + 64 step records) at part_start.
 */
export function writePartBlock(view: DataView, partStart: number, part: E2PartInput): void {
  // Part-Header: only the bytes the v3.13 reader actually decodes are
  // strictly required for round-trip. We additionally write Pitch/FxSend
  // at "best-effort" offsets — the reader returns 0 for them, but having
  // *something* deterministic in those bytes makes hex-diffs cleaner.
  const volume = clampInt(part.volume, 0, 127, E2_DEFAULT_PART_VOLUME);
  const pan = clampInt(part.pan, 0, 127, E2_DEFAULT_PART_PAN);
  view.setUint8(partStart + ELECTRIBE_REAL_PART_VOLUME_OFFSET, volume);
  view.setUint8(partStart + ELECTRIBE_REAL_PART_PAN_OFFSET, pan);

  // Pitch: signed -64..+63 → byte (two's complement).
  const pitch = clampInt(part.pitch, -64, 63, 0);
  view.setInt8(partStart + PART_PITCH_OFFSET, pitch);

  // FxSend 0..127.
  const fxSend = clampInt(part.fxSend, 0, 127, 0);
  view.setUint8(partStart + PART_FXSEND_OFFSET, fxSend);

  // Step records: 64 × 12 bytes starting at part+0x30.
  const steps = Array.isArray(part.steps) ? part.steps : [];
  for (let s = 0; s < ELECTRIBE_REAL_STEPS_PER_PART; s++) {
    const stepOffset =
      partStart + ELECTRIBE_REAL_PART_HEADER_BYTES + s * ELECTRIBE_REAL_STEP_RECORD_BYTES;
    const stepIn: E2StepInput = steps[s] ?? { active: false };
    writeStepRecord(view, stepOffset, stepIn);
  }
}

/**
 * Writes the pattern-level Motion-Sequencer table (8 slots) at the given
 * PTST offset. Slots are placed at:
 *   PTST+0x100  8B  ParamID[8]
 *   PTST+0x118  8B  TargetPart[8]
 *   PTST+0x130  512B 8 × 64-byte value arrays
 */
export function writeMotionTable(
  view: DataView,
  ptstOffset: number,
  motionSlots: E2MotionSlot[] | undefined,
): void {
  if (!motionSlots || motionSlots.length === 0) return; // already zero-filled

  for (let i = 0; i < ELECTRIBE_MOTION_SLOTS_PER_PATTERN; i++) {
    const slot = motionSlots[i];
    if (!slot) continue;

    const paramId = clampInt(slot.paramId, 0, 127, 0);
    view.setUint8(ptstOffset + ELECTRIBE_MOTION_PARAM_TABLE_OFFSET + i, paramId);

    // targetPart 0..15 → rawTarget 1..16. -1 or undefined → rawTarget 0.
    let rawTarget = 0;
    if (typeof slot.targetPart === "number" && slot.targetPart >= 0 && slot.targetPart < 16) {
      rawTarget = Math.floor(slot.targetPart) + 1;
    }
    view.setUint8(ptstOffset + ELECTRIBE_MOTION_TARGET_TABLE_OFFSET + i, rawTarget);

    // Values 0..127.
    const dataStart =
      ptstOffset + ELECTRIBE_MOTION_DATA_TABLE_OFFSET + i * ELECTRIBE_MOTION_SLOT_STRIDE;
    const values = Array.isArray(slot.values) ? slot.values : [];
    for (let v = 0; v < ELECTRIBE_MOTION_VALUES_PER_SLOT; v++) {
      const raw = clampInt(values[v], 0, 127, 0);
      view.setUint8(dataStart + v, raw);
    }
  }
}

// ─── Top-Level Builder ───────────────────────────────────────────────────────

/**
 * Builds a complete 16640-byte `.e2spat` file from a Synthstudio
 * E2PatternInput. The output buffer is always exactly `ELECTRIBE_REAL_FILE_SIZE`
 * bytes — never larger, never smaller.
 *
 * Defensive: caller-input is range-clamped throughout (BPM, volume, pan,
 * velocity, note, paramId, …). Invalid step counts are truncated to 64.
 * Missing parts are filled with empty defaults so the file is always
 * structurally valid.
 *
 * Round-trip invariant (verified in tests):
 *   parseRealPattern(buildE2PatternFile(input)) ≈ input
 * (excluding fields the reader does not currently decode: swing, pitch,
 *  fxSend, sampleId — these survive bit-identical but read back as defaults.)
 */
export function buildE2PatternFile(input: E2PatternInput): ArrayBuffer {
  const buffer = new ArrayBuffer(ELECTRIBE_REAL_FILE_SIZE);
  const view = new DataView(buffer);
  const u8 = new Uint8Array(buffer);

  // Pre-fill: zero everywhere, then 0xFF in the file-header padding region.
  // (Zero-init is implicit for ArrayBuffer; we only need to overwrite the FF region.)
  for (let i = 0x024; i < 0x100; i++) {
    u8[i] = 0xff;
  }

  // ── File-Header ────────────────────────────────────────────────────────────
  writeAscii(view, 0x000, ELECTRIBE_MAGIC, 16); // "KORG" + 12 × 0x00
  writeAscii(view, 0x010, ELECTRIBE_REAL_IDENTIFIER, 16); // "e2sampler" + zeros
  view.setUint32(0x020, 1, true); // version u32 LE = 1

  // ── PTST + Pattern Header ──────────────────────────────────────────────────
  const ptstOffset = 0x100;
  writeAscii(view, ptstOffset, ELECTRIBE_REAL_PATTERN_MARKER, 16); // "PTST" + zeros

  // v3.34: Pattern name @ PTST+0x10 = 0x110, 16B ASCII NUL-padded after
  // string-content (KORG-native encoding). Parser strips NULs and trims, so
  // semantically identical to the previous all-space variant.
  writeAsciiNulPadded(view, ELECTRIBE_REAL_NAME_OFFSET, input.name ?? "", 16);

  // BPM × 10 u16 LE @ 0x122. Clamp to hardware range and round.
  const bpmRaw =
    typeof input.bpm === "number" && Number.isFinite(input.bpm)
      ? Math.round(
          Math.max(ELECTRIBE_MIN_BPM, Math.min(ELECTRIBE_MAX_BPM, input.bpm)) * 10,
        )
      : 1200;
  view.setUint16(ELECTRIBE_REAL_BPM_OFFSET, bpmRaw, true);

  // Step-length code @ PTST+0x25 = 0x125.
  const stepLen: 16 | 32 | 64 =
    input.stepLength === 32 || input.stepLength === 64 ? input.stepLength : 16;
  view.setUint8(ptstOffset + ELECTRIBE_REAL_STEP_LENGTH_OFFSET, STEP_LENGTH_CODE_MAP[stepLen]);

  // ── Pattern Motion Table (8 slots) ─────────────────────────────────────────
  writeMotionTable(view, ptstOffset, input.motionSlots);

  // ── 16 Parts × 816B ────────────────────────────────────────────────────────
  const parts = Array.isArray(input.parts) ? input.parts : [];
  for (let p = 0; p < PARTS_PER_PATTERN; p++) {
    const partStart = ELECTRIBE_REAL_PARTS_OFFSET + p * ELECTRIBE_REAL_PART_STRIDE;
    const partIn: E2PartInput = parts[p] ?? { steps: [] };
    writePartBlock(view, partStart, partIn);
  }

  return buffer;
}

// ─── Validation Helpers (for IPC layer) ──────────────────────────────────────

/**
 * Quick structural sanity-check for a built `.e2spat` buffer. Used by the
 * IPC `electribe:save-pattern` handler before writing to disk. Mirrors the
 * read-side `isRealElectribeFile` markers.
 */
export function looksLikeE2PatternFile(buffer: ArrayBuffer | Uint8Array): boolean {
  try {
    const u8 = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    if (u8.byteLength !== ELECTRIBE_REAL_FILE_SIZE) return false;
    // "KORG" @ 0x00
    if (u8[0] !== 0x4b || u8[1] !== 0x4f || u8[2] !== 0x52 || u8[3] !== 0x47) return false;
    // "e2sa" @ 0x10
    if (u8[0x10] !== 0x65 || u8[0x11] !== 0x32 || u8[0x12] !== 0x73 || u8[0x13] !== 0x61) {
      return false;
    }
    // "PTST" @ 0x100
    if (u8[0x100] !== 0x50 || u8[0x101] !== 0x54 || u8[0x102] !== 0x53 || u8[0x103] !== 0x54) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Synthstudio – KORG E2S Sample-Bank Builder (v3.6.0)
 *
 * TypeScript-Port aus
 * `G:/IdeaProjects/Korg Editor/esx_e2s_editor/services/e2s_builder.py`.
 *
 * Produziert ein vollständig valides `e2sSample.all` File aus einer Liste
 * von `E2sSlotInput`-Records. Round-Trip via `parseE2sBank` ist die
 * Goldstandard-Verifizierung (siehe Tests).
 *
 * Layout (verified gegen e2sSample.all-Reference 2026-05-17, identisch
 * zur v3.3 Reader-Konvention):
 *
 *   0x0000..0x0010  16B signature  "e2s sample all\x1a\x00"
 *   0x0010..0x07E0  2032B zero-padding (reserved)
 *   0x07E0..0x0BC8  250 × LE32 offset table (0 = empty slot)
 *   0x0BC8..0x1000  0x438 zero-padding to 4 KiB boundary
 *   0x1000..EOF     concatenated RIFF/WAVE chunks (one per non-empty slot)
 *
 * Pro Slot:
 *
 *   RIFF<size LE32> WAVE
 *     'fmt '<16> PCM=1, ch, sr, byteRate, blockAlign, 16bps
 *     'data'<size> <16-bit signed LE interleaved PCM>
 *     'korg'<1180> 'esli' + LE32 0x0494 + LE16 0x01F4 + 1170B body
 *
 * Bit-exact Round-Trip (v3.6.0 KILLER-FEATURE):
 *   Wenn ein Slot via `parseE2sBank(buf, src, { preserveRawRiff: true })`
 *   geladen wurde, kann sein `rawRiff` Buffer beim Builder durchgereicht
 *   werden — `buildE2sBank(slots, { preserveRawRiff: true })` schreibt
 *   unedited Slots verbatim. Edit-Detection via `isDirty: boolean` Flag.
 *   Geänderte oder neu hinzugefügte Slots werden re-encoded wie in v3.4.
 *
 * Bounds-Checks:
 *   - max 250 Slots
 *   - max 10 MB PCM pro Slot (per-slot cap MAX_BYTES_PER_SLOT)
 *   - max 224 MB total PCM (E2S_MAX_TOTAL_PCM_BYTES)
 *   - max 512 MB total Datei (E2S_FILE_MAX_BYTES)
 *   - Names werden auf ASCII-only + 16 Chars getrimmt
 *   - Category-Enum auf [0..17] geclampt
 */

import {
  E2S_ALL_OFFSET_TABLE_START,
  E2S_ALL_OFFSET_TABLE_BYTES,
  E2S_ALL_SAMPLE_AREA_START,
  E2S_ALL_SIGNATURE,
  E2S_ALL_SIGNATURE_LEN,
  E2S_FILE_MAX_BYTES,
  E2S_MAX_SLOTS,
  E2S_MAX_TOTAL_PCM_BYTES,
  ESLI_CATEGORY_OFFSET,
  ESLI_END_OFFSET,
  ESLI_LOOP_START_OFFSET,
  ESLI_NAME_LEN,
  ESLI_NAME_OFFSET,
  ESLI_ONESHOT_OFFSET,
  ESLI_PLAY_VOLUME_OFFSET,
  ESLI_PLUS12DB_OFFSET,
  ESLI_SAMPLE_INDEX_OFFSET,
  ESLI_SAMPLE_TUNE_OFFSET,
  ESLI_SAMPLING_FREQ_OFFSET,
  ESLI_SLICE_STEPS_LEN,
  ESLI_SLICE_STEPS_OFFSET,
  ESLI_SLICE_STRUCT_SIZE,
  ESLI_SLICES_COUNT,
  ESLI_SLICES_NUM_ACTIVE_OFFSET,
  ESLI_SLICES_OFFSET,
  ESLI_SLICING_BEAT_OFFSET,
  ESLI_SLICING_NUM_STEPS_OFFSET,
  ESLI_USE_CHAN0_OFFSET,
  ESLI_USE_CHAN1_OFFSET,
  KORG_BODY_DECLARED_SIZE,
  KORG_BODY_SUBMAGIC,
  ESLI_OSC_INDEX_OFFSET,
  ESLI_IMPORT_NUM_OFFSET,
  ESLI_PLAY_LOG_PERIOD_OFFSET,
  ESLI_START_POINT_OFFSET,
  ESLI_WAV_DATA_SIZE_OFFSET,
  KORG_SUBCHUNK_BODY_SIZE,
  KORG_SUBCHUNK_ID,
  LOOP_TYPE_FORWARD,
  MAX_BYTES_PER_SLOT,
  type LoopType,
} from "./constants";
import { floatToInt16LeBytes, sanitizeE2sSlotName } from "./audioProcessor";

// ─── Public Types ─────────────────────────────────────────────────────────────

/** Eingabe-Spec für einen einzelnen Slot in `buildE2sBank`. */
export interface E2sSlotInput {
  /** Slot-Index in der 250-Entry-Offset-Table (0..249). */
  slotIndex: number;
  /**
   * Sample-Nummer, wie sie das Gerät anzeigt (esli-Body @ +0x56, u16 LE).
   * v3.271: Ohne dieses Feld blieb +0x56 = 0 → das Gerät zeigte ALLE Samples
   * unter derselben Nummer (z.B. 501) statt aufsteigend. Verifiziert gegen
   * Factory-Bank `sampler_full.all` (+0x56 läuft 18,19,20,… pro Slot).
   * Default = `slotIndex` (numeriert Samples nach Position). Für User-Sample-
   * Banken ab Geräte-Nr. 501 hier 501,502,… setzen.
   */
  sampleNumber?: number;
  /** Sample-Name. Wird ASCII-gefiltert und auf 16 chars getrimmt. */
  name: string;
  /** Kategorie 0..17 (siehe E2S_CATEGORY_NAMES). Default 0 (Analog). */
  category?: number;
  /** Float32-PCM-Daten. Mono = flach, Stereo = interleaved L,R,L,R,…  */
  pcmData: Float32Array;
  /** Sample-Rate (Hz). MUSS 44100 oder 48000 sein. */
  sampleRate: number;
  /** 1 = mono, 2 = stereo. */
  channels: 1 | 2;
  /** Loop-Mode (default 1 = oneshot). */
  loopType?: LoopType;
  /** Loop-Start in BYTES (relativ zum data-payload). Default 0. */
  loopStartBytes?: number;
  /** Loop-End / Sample-End in BYTES. Default = pcmBytes.length. */
  loopEndBytes?: number;
  /** Level 0..127 (Default 100). */
  level?: number;
  /** +12 dB Gain-Flag (Default false). */
  gain12db?: boolean;
  /** Sample-Tune in Cents [-99..+99] (Default 0). */
  sampleTune?: number;
  /** Optional: bis zu 64 Slice-Records. */
  slices?: SliceInput[];
  /** Optional: 64-byte Step-Pattern für Slicing. */
  sliceSteps?: Uint8Array;
  /** Slicing-Metadaten (alle u8, default 0). */
  slicingNumSteps?: number;
  slicingBeat?: number;
  slicingNumActive?: number;
  /**
   * v3.6.0 — Original RIFF-Chunk-Bytes vom Reader. Wenn vorhanden UND der
   * Slot ist **nicht** dirty UND der Caller ruft `buildE2sBank(slots, {
   * preserveRawRiff: true })` auf, dann wird `rawRiff` verbatim
   * durchgereicht — Bit-Exact-Round-Trip.
   */
  rawRiff?: Uint8Array;
  /**
   * v3.6.0 — Edit-Detection-Flag. Default `false` (Slot kommt unverändert
   * aus einem Read). Wenn der User via UI Name/Category/etc. ändert, muss
   * der Caller das auf `true` setzen — dann re-encoded der Builder neu.
   *
   * Wirkt nur in Verbindung mit `rawRiff` UND `BuildE2sBankOptions.preserveRawRiff`.
   */
  isDirty?: boolean;
}

/** v3.6.0 — Optionen für `buildE2sBank`. */
export interface BuildE2sBankOptions {
  /**
   * v3.6.0 — Aktiviert den Raw-RIFF-Passthrough-Pfad:
   *   Wenn ein Slot ein `rawRiff` UND `isDirty !== true` hat, wird das
   *   originale RIFF-Chunk-Bytes-Buffer **bit-exakt** ins .all geschrieben
   *   — ohne re-encoding. Faktory-Banks bleiben so bit-exakt erhalten,
   *   auch wenn ein anderer Slot editiert wurde.
   *
   * Default `false` (alle Slots werden re-encoded wie in v3.4).
   */
  preserveRawRiff?: boolean;
}

export interface SliceInput {
  start: number;
  length: number;
  attackLength: number;
  amplitude: number;
}

export interface BuildResult {
  /** Komplette .all-Datei als ArrayBuffer. */
  buffer: ArrayBuffer;
  /** Anzahl tatsächlich geschriebener (non-empty) Slots. */
  slotCount: number;
  /** Soft-Warnings (z.B. duplicate slot index, ASCII-strip). */
  warnings: string[];
}

export class E2sBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "E2sBuildError";
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Baut ein komplettes E2S `.all`-File aus einer Liste von Slot-Inputs.
 *
 * @throws E2sBuildError bei Validation-Fehlern (zu viele Slots, Caps,
 *         ungültige Werte). Im Fehler-Fall wird nichts allokiert.
 */
export function buildE2sBank(
  slots: E2sSlotInput[],
  opts: BuildE2sBankOptions = {},
): BuildResult {
  if (!Array.isArray(slots)) {
    throw new E2sBuildError("slots must be an array");
  }
  if (slots.length > E2S_MAX_SLOTS) {
    throw new E2sBuildError(
      `too many slots: ${slots.length} > ${E2S_MAX_SLOTS}`,
    );
  }

  const preserveRawRiff = opts.preserveRawRiff === true;
  const warnings: string[] = [];

  // ── Stage 1 — pro-Slot RIFF in-memory bauen + Offsets vormerken ─────────────
  type Pending = { slotIndex: number; bytes: Uint8Array };
  const pending: Pending[] = [];
  const offsetTable = new Uint32Array(E2S_MAX_SLOTS);
  let cursor = E2S_ALL_SAMPLE_AREA_START;
  let totalPcm = 0;

  for (let i = 0; i < slots.length; i++) {
    const input = slots[i];

    // v3.6.0 — Raw-RIFF Fast-Path für unedited Slots mit Original-Bytes.
    let riff: Uint8Array;
    let pcmByteLen: number;
    const canPassthrough =
      preserveRawRiff &&
      input.rawRiff instanceof Uint8Array &&
      input.rawRiff.length >= 8 &&
      input.isDirty !== true;
    if (canPassthrough) {
      const passthroughResult = passthroughRiff(input, warnings);
      riff = passthroughResult.riff;
      pcmByteLen = passthroughResult.pcmByteLen;
    } else {
      const built = buildRiffForSlot(input, warnings);
      riff = built.riff;
      pcmByteLen = built.pcmByteLen;
    }
    totalPcm += pcmByteLen;
    if (totalPcm > E2S_MAX_TOTAL_PCM_BYTES) {
      throw new E2sBuildError(
        `cumulative PCM payload ${totalPcm} > ${E2S_MAX_TOTAL_PCM_BYTES} (E2S total cap)`,
      );
    }

    if (
      !Number.isInteger(input.slotIndex) ||
      input.slotIndex < 0 ||
      input.slotIndex >= E2S_MAX_SLOTS
    ) {
      warnings.push(
        `slot ${i} index ${input.slotIndex} out of range [0,${E2S_MAX_SLOTS}); skipping`,
      );
      continue;
    }
    if (offsetTable[input.slotIndex] !== 0) {
      warnings.push(
        `slot_index ${input.slotIndex} appears more than once — keeping the first`,
      );
      continue;
    }
    offsetTable[input.slotIndex] = cursor;
    pending.push({ slotIndex: input.slotIndex, bytes: riff });
    cursor += riff.length;
  }

  const totalSize = cursor;
  if (totalSize > E2S_FILE_MAX_BYTES) {
    throw new E2sBuildError(
      `output file size ${totalSize} exceeds max ${E2S_FILE_MAX_BYTES}`,
    );
  }

  // ── Stage 2 — Prelude (Signature + Offset-Table + Padding) ──────────────────
  const out = new Uint8Array(totalSize);
  // Signature
  out.set(E2S_ALL_SIGNATURE, 0);
  // Offset-Table
  const dv = new DataView(out.buffer);
  for (let i = 0; i < E2S_MAX_SLOTS; i++) {
    dv.setUint32(E2S_ALL_OFFSET_TABLE_START + i * 4, offsetTable[i], true);
  }
  // (Bytes zwischen Signature 0x10..0x07E0, und zwischen Table-End 0x0BC8..0x1000
  //  sind bereits 0 dank Uint8Array-Default — kein expliziter memset nötig.)

  // ── Stage 3 — RIFF-Chunks ───────────────────────────────────────────────────
  for (const p of pending) {
    out.set(p.bytes, offsetTable[p.slotIndex]);
  }

  // Defensive Post-Check: keine Offset-Entry darf in die Prelude zeigen.
  for (let i = 0; i < E2S_MAX_SLOTS; i++) {
    const off = offsetTable[i];
    if (off !== 0 && off < E2S_ALL_SAMPLE_AREA_START) {
      throw new E2sBuildError(
        `internal: slot ${i} offset 0x${off.toString(16)} lies inside prelude`,
      );
    }
  }
  // Sanity-Check: Offset-Table-Block ist exakt E2S_ALL_OFFSET_TABLE_BYTES groß.
  if (E2S_MAX_SLOTS * 4 !== E2S_ALL_OFFSET_TABLE_BYTES) {
    throw new E2sBuildError(
      `internal: offset-table-size mismatch (${E2S_MAX_SLOTS * 4} != ${E2S_ALL_OFFSET_TABLE_BYTES})`,
    );
  }

  return {
    buffer: out.buffer,
    slotCount: pending.length,
    warnings,
  };
}

// ─── Raw-RIFF-Passthrough (v3.6.0) ────────────────────────────────────────────

/**
 * v3.6.0 — Validiert + reicht einen unedited Slot's `rawRiff`-Buffer durch.
 *
 * Defensive Checks (vor Memory-Alloc):
 *   - Magic 'RIFF' bei rawRiff[0..4]
 *   - LE32 size matcht rawRiff.length (8 + size = total)
 *   - WAVE marker bei rawRiff[8..12]
 *   - Findet 'data'-Sub-Chunk → liefert pcmByteLen für Cap-Tracking
 *
 * Bei Validation-Fehler: Fallback auf normal re-encoding (`buildRiffForSlot`)
 * + Warning. Das ist absichtlich defensiv — wir wollen niemals einen
 * korrupten Slot durchreichen.
 */
function passthroughRiff(
  slot: E2sSlotInput,
  warnings: string[],
): { riff: Uint8Array; pcmByteLen: number } {
  const raw = slot.rawRiff!;
  // RIFF magic
  const isRiff =
    raw.length >= 12 &&
    raw[0] === 0x52 && raw[1] === 0x49 && raw[2] === 0x46 && raw[3] === 0x46;
  if (!isRiff) {
    warnings.push(
      `slot ${slot.slotIndex} rawRiff has invalid magic — falling back to re-encode`,
    );
    return buildRiffForSlot(slot, warnings);
  }
  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const declaredSize = dv.getUint32(4, true);
  if (declaredSize + 8 !== raw.length) {
    warnings.push(
      `slot ${slot.slotIndex} rawRiff size mismatch (${declaredSize}+8 != ${raw.length}) — re-encoding`,
    );
    return buildRiffForSlot(slot, warnings);
  }
  // WAVE marker (rawRiff[8..12])
  if (!(raw[8] === 0x57 && raw[9] === 0x41 && raw[10] === 0x56 && raw[11] === 0x45)) {
    warnings.push(
      `slot ${slot.slotIndex} rawRiff missing WAVE marker — re-encoding`,
    );
    return buildRiffForSlot(slot, warnings);
  }
  // Per-slot RIFF size cap (Defense gegen riesige durchgereichte Slots).
  if (raw.length > MAX_BYTES_PER_SLOT + 4096) {
    warnings.push(
      `slot ${slot.slotIndex} rawRiff ${raw.length} bytes too large — re-encoding`,
    );
    return buildRiffForSlot(slot, warnings);
  }
  // Find 'data' sub-chunk to extract PCM length for cap tracking.
  const DATA_ID = [0x64, 0x61, 0x74, 0x61];
  let pcmByteLen = 0;
  // Walk sub-chunks within RIFF body (start at pos 12, after RIFF+size+WAVE).
  let pos = 12;
  while (pos + 8 <= raw.length) {
    const ssize = dv.getUint32(pos + 4, true);
    if (
      raw[pos] === DATA_ID[0] &&
      raw[pos + 1] === DATA_ID[1] &&
      raw[pos + 2] === DATA_ID[2] &&
      raw[pos + 3] === DATA_ID[3]
    ) {
      pcmByteLen = ssize;
      break;
    }
    pos += 8 + ssize + (ssize & 1);
  }
  if (pcmByteLen > MAX_BYTES_PER_SLOT) {
    warnings.push(
      `slot ${slot.slotIndex} rawRiff data-chunk ${pcmByteLen} > per-slot cap — re-encoding`,
    );
    return buildRiffForSlot(slot, warnings);
  }
  // Passthrough valid — copy into a fresh Uint8Array so the caller cannot
  // accidentally mutate the buffer after we recorded its offset.
  const copy = new Uint8Array(raw.length);
  copy.set(raw);
  return { riff: copy, pcmByteLen };
}

// ─── RIFF + korg Sub-Chunk Builder ────────────────────────────────────────────

function buildRiffForSlot(
  slot: E2sSlotInput,
  warnings: string[],
): { riff: Uint8Array; pcmByteLen: number } {
  if (!(slot.pcmData instanceof Float32Array)) {
    throw new E2sBuildError(`slot ${slot.slotIndex} pcmData must be Float32Array`);
  }
  if (slot.channels !== 1 && slot.channels !== 2) {
    throw new E2sBuildError(
      `slot ${slot.slotIndex} unsupported channels ${slot.channels}`,
    );
  }
  if (!Number.isFinite(slot.sampleRate) || slot.sampleRate <= 0) {
    throw new E2sBuildError(
      `slot ${slot.slotIndex} invalid sampleRate ${slot.sampleRate}`,
    );
  }

  const pcmBytes = floatToInt16LeBytes(slot.pcmData);
  if (pcmBytes.length > MAX_BYTES_PER_SLOT) {
    throw new E2sBuildError(
      `slot ${slot.slotIndex} pcm ${pcmBytes.length} bytes exceeds per-slot cap ${MAX_BYTES_PER_SLOT}`,
    );
  }

  const fmt = buildFmtSubchunk(slot.sampleRate, slot.channels);
  const data = buildDataSubchunk(pcmBytes);
  const korg = buildKorgSubchunk(slot, pcmBytes.length, warnings);

  // RIFF body = 'WAVE' + fmt + data + korg
  const bodyLen = 4 + fmt.length + data.length + korg.length;
  const riff = new Uint8Array(8 + bodyLen);
  // 'RIFF'
  riff[0] = 0x52;
  riff[1] = 0x49;
  riff[2] = 0x46;
  riff[3] = 0x46;
  new DataView(riff.buffer).setUint32(4, bodyLen, true);
  let pos = 8;
  // 'WAVE'
  riff[pos] = 0x57;
  riff[pos + 1] = 0x41;
  riff[pos + 2] = 0x56;
  riff[pos + 3] = 0x45;
  pos += 4;
  riff.set(fmt, pos);
  pos += fmt.length;
  riff.set(data, pos);
  pos += data.length;
  riff.set(korg, pos);
  pos += korg.length;

  return { riff, pcmByteLen: pcmBytes.length };
}

function buildFmtSubchunk(sampleRate: number, channels: 1 | 2): Uint8Array {
  const bytesPerSample = 2; // 16-bit
  const blockAlign = channels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const bodyLen = 16;
  const chunk = new Uint8Array(8 + bodyLen);
  // 'fmt '
  chunk[0] = 0x66;
  chunk[1] = 0x6d;
  chunk[2] = 0x74;
  chunk[3] = 0x20;
  const dv = new DataView(chunk.buffer);
  dv.setUint32(4, bodyLen, true);
  // body
  dv.setUint16(8, 1, true);                // PCM
  dv.setUint16(10, channels, true);
  dv.setUint32(12, sampleRate, true);
  dv.setUint32(16, byteRate, true);
  dv.setUint16(20, blockAlign, true);
  dv.setUint16(22, 16, true);              // bps
  return chunk;
}

function buildDataSubchunk(pcmBytes: Uint8Array): Uint8Array {
  const len = pcmBytes.length;
  const pad = len & 1; // RIFF Sub-Chunks pad to word boundary
  const chunk = new Uint8Array(8 + len + pad);
  // 'data'
  chunk[0] = 0x64;
  chunk[1] = 0x61;
  chunk[2] = 0x74;
  chunk[3] = 0x61;
  new DataView(chunk.buffer).setUint32(4, len, true);
  chunk.set(pcmBytes, 8);
  return chunk;
}

function buildKorgSubchunk(
  slot: E2sSlotInput,
  pcmByteLen: number,
  warnings: string[],
): Uint8Array {
  const bodyLen = KORG_SUBCHUNK_BODY_SIZE;
  const chunk = new Uint8Array(8 + bodyLen);
  // 'korg'
  chunk.set(KORG_SUBCHUNK_ID, 0);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(4, bodyLen, true);

  // body starts at chunk[8]
  const bodyOffset = 8;

  // 'esli' magic + declared-size LE32
  chunk.set(KORG_BODY_SUBMAGIC, bodyOffset + 0);
  dv.setUint32(bodyOffset + 4, KORG_BODY_DECLARED_SIZE, true);

  // OSC_0index @ +0x08 (u16 LE) — die vom Gerät angezeigte Sample-Nummer.
  // v3.271-Fix: früher stand hier die Konstante 0x01F4 (500) → das Gerät zeigte
  // ALLE Samples als 501. Echte .all (Oe2sSLE-verifiziert) schreibt die Nummer
  // hier UND bei +0x56 (OSC_0index1), identisch + aufsteigend. Default = slotIndex.
  const sampleNumber =
    typeof slot.sampleNumber === "number" && Number.isFinite(slot.sampleNumber)
      ? Math.max(0, Math.min(0xffff, Math.floor(slot.sampleNumber)))
      : Math.max(0, Math.min(0xffff, Math.floor(slot.slotIndex)));
  dv.setUint16(bodyOffset + ESLI_OSC_INDEX_OFFSET, sampleNumber, true);

  // Name @ 0x0A (16B ASCII, NUL-padded)
  const sanitized = sanitizeE2sSlotName(slot.name ?? "", ESLI_NAME_LEN);
  if (sanitized.length < (slot.name ?? "").length) {
    warnings.push(
      `slot ${slot.slotIndex} name truncated/stripped: "${slot.name}" → "${sanitized}"`,
    );
  }
  for (let i = 0; i < sanitized.length && i < ESLI_NAME_LEN; i++) {
    chunk[bodyOffset + ESLI_NAME_OFFSET + i] = sanitized.charCodeAt(i);
  }

  // Category @ 0x1A (u16 LE, clamped 0..17)
  const rawCat = typeof slot.category === "number" ? slot.category : 0;
  const cat = Math.max(0, Math.min(17, Math.floor(rawCat)));
  dv.setUint16(bodyOffset + ESLI_CATEGORY_OFFSET, cat, true);

  // OSC_importNum @ 0x1C (u16 LE) — in echten Bänken stets sampleNumber + 50.
  dv.setUint16(bodyOffset + ESLI_IMPORT_NUM_OFFSET, Math.min(0xffff, sampleNumber + 50), true);

  // playLogPeriod @ 0x2A (u16 LE) — frequenzabhängige Abspielrate. Ohne dies
  // hat das Sample keine definierte Rate → Gerät spielt/lädt es nicht.
  dv.setUint16(bodyOffset + ESLI_PLAY_LOG_PERIOD_OFFSET, playLogPeriodForRate(slot.sampleRate), true);

  // PlayVolume @ 0x2C (u16 LE) — scale level [0..127] → [0..0xFFFF]
  const rawLevel = typeof slot.level === "number" ? slot.level : 127;
  const level = Math.max(0, Math.min(127, Math.floor(rawLevel)));
  const playVolume = Math.floor((level * 0xffff) / 127);
  dv.setUint16(bodyOffset + ESLI_PLAY_VOLUME_OFFSET, playVolume, true);

  // Sample address points + data size (bytes). v3.271-Fix (Oe2sSLE-verifiziert
  // gegen echte spul.all): one-shots haben StartPoint=0,
  // LoopStartPoint=EndPoint=Adresse des LETZTEN Frames (= dataSize - frameBytes),
  // und WAV_dataSize @0x44 = volle Daten-Bytegröße. OHNE WAV_dataSize lädt das
  // Gerät das Sample nicht (importiert, aber "keine Änderung").
  const frameBytes = (slot.channels === 2 ? 2 : 1) * 2; // 16-bit output
  const endAddr = Math.max(0, pcmByteLen - frameBytes);
  const loopStartBytes =
    slot.loopStartBytes != null ? clampU32(slot.loopStartBytes) : endAddr;
  const endBytes =
    slot.loopEndBytes != null ? Math.max(0, clampU32(slot.loopEndBytes) - frameBytes) : endAddr;
  dv.setUint32(bodyOffset + ESLI_START_POINT_OFFSET, 0, true);
  dv.setUint32(bodyOffset + ESLI_LOOP_START_OFFSET, loopStartBytes, true);
  dv.setUint32(bodyOffset + ESLI_END_OFFSET, endBytes, true);
  dv.setUint32(bodyOffset + ESLI_WAV_DATA_SIZE_OFFSET, clampU32(pcmByteLen), true);

  // Fixed-value fields the device expects (Oe2sSLE "_UFix"; verified constant
  // across real factory/user banks). Oe2sSLE warns if these differ → set them.
  chunk[bodyOffset + 0x1d] = 0x02;
  chunk[bodyOffset + 0x21] = 0x7f;
  chunk[bodyOffset + 0x23] = 0x01;
  chunk[bodyOffset + 0x4b] = 0x01;
  dv.setUint16(bodyOffset + 0x4c, 0x04b0, true);

  // Oneshot @ 0x3C — 0 für Forward-Loop, 1 für oneshot (default oneshot)
  const loopType = slot.loopType ?? 1; // 1 = oneshot default
  chunk[bodyOffset + ESLI_ONESHOT_OFFSET] = loopType === LOOP_TYPE_FORWARD ? 0 : 1;

  // useChan0 / useChan1 (mono = chan0 only, stereo = both)
  chunk[bodyOffset + ESLI_USE_CHAN0_OFFSET] = 1;
  chunk[bodyOffset + ESLI_USE_CHAN1_OFFSET] = slot.channels === 2 ? 1 : 0;

  // Plus12dB @ 0x4A
  chunk[bodyOffset + ESLI_PLUS12DB_OFFSET] = slot.gain12db ? 1 : 0;

  // Sampling-Freq @ 0x50 (u32 LE)
  dv.setUint32(bodyOffset + ESLI_SAMPLING_FREQ_OFFSET, slot.sampleRate >>> 0, true);

  // SampleTune @ 0x55 (i8) — clamp [-99..+99]
  let tune = typeof slot.sampleTune === "number" ? Math.round(slot.sampleTune) : 0;
  if (tune > 99) tune = 99;
  if (tune < -99) tune = -99;
  // i8 sign-conversion
  chunk[bodyOffset + ESLI_SAMPLE_TUNE_OFFSET] = tune < 0 ? tune + 256 : tune;

  // OSC_0index1 @ +0x56 (u16 LE) — zweite Kopie der Sample-Nummer, identisch
  // zu OSC_0index @ +0x08 (siehe oben). Echte .all halten beide gleich.
  dv.setUint16(bodyOffset + ESLI_SAMPLE_INDEX_OFFSET, sampleNumber, true);

  // Slices @ 0x58 (64 × 16B)
  const slices = slot.slices ?? [];
  if (slices.length > ESLI_SLICES_COUNT) {
    warnings.push(
      `slot ${slot.slotIndex} ${slices.length} slices > ${ESLI_SLICES_COUNT}; truncating`,
    );
  }
  const sliceCount = Math.min(slices.length, ESLI_SLICES_COUNT);
  for (let i = 0; i < sliceCount; i++) {
    const s = slices[i];
    const base = bodyOffset + ESLI_SLICES_OFFSET + i * ESLI_SLICE_STRUCT_SIZE;
    dv.setInt32(base, Math.trunc(s.start) | 0, true);
    dv.setUint32(base + 4, clampU32(s.length), true);
    dv.setUint32(base + 8, clampU32(s.attackLength), true);
    dv.setUint32(base + 12, clampU32(s.amplitude), true);
  }
  // verbleibende 64-sliceCount records sind 0 (default Uint8Array(0)).

  // SliceSteps @ 0x458 (64B raw)
  if (slot.sliceSteps && slot.sliceSteps.length > 0) {
    const stepBytes = slot.sliceSteps.subarray(
      0,
      Math.min(slot.sliceSteps.length, ESLI_SLICE_STEPS_LEN),
    );
    chunk.set(stepBytes, bodyOffset + ESLI_SLICE_STEPS_OFFSET);
  }

  // Slicing-Metadaten @ 0x498..0x49A (u8)
  chunk[bodyOffset + ESLI_SLICING_NUM_STEPS_OFFSET] = clampU8(slot.slicingNumSteps ?? 0);
  chunk[bodyOffset + ESLI_SLICING_BEAT_OFFSET] = clampU8(slot.slicingBeat ?? 0);
  chunk[bodyOffset + ESLI_SLICES_NUM_ACTIVE_OFFSET] = clampU8(slot.slicingNumActive ?? 0);

  return chunk;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clampU8(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const v = Math.floor(n);
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v;
}

/**
 * playLogPeriod (esli +0x2A) aus der Sample-Rate. Verifiziert gegen echte .all:
 *   22050→18808, 44100→15736, 48000→15360 (halbe Frequenz = +3072 = log2-Period).
 * Der Builder gibt nur 44100/48000 aus → exakte Lookup-Werte; sonst log-Formel.
 */
function playLogPeriodForRate(sampleRate: number): number {
  if (sampleRate === 44100) return 15736;
  if (sampleRate === 48000) return 15360;
  const sr = sampleRate > 0 ? sampleRate : 44100;
  return Math.max(0, Math.min(0xffff, Math.round(63132.68 - 3072 * Math.log2(sr))));
}

function clampU32(n: number): number {
  if (!Number.isFinite(n)) return 0;
  const v = Math.floor(n);
  if (v < 0) return 0;
  if (v > 0xffffffff) return 0xffffffff;
  return v;
}

/**
 * Sanity-Helper für UI-Code: berechnet, ob ein Slot-Input am Cap kratzt.
 * Nicht im Build-Pfad genutzt — pure-info für Form-Validation.
 */
export function estimatePcmBytesForSlot(input: E2sSlotInput): number {
  return input.pcmData.length * 2; // Float32 → Int16
}

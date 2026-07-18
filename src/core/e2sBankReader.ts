/**
 * Synthstudio – E2S Sample-Bank Reader (v3.3.0)
 *
 * Port aus dem Python-Tool `G:/IdeaProjects/Korg Editor`.
 * SoT: G:/IdeaProjects/Korg Editor/esx_e2s_editor/services/e2s_parser.py
 *
 * READ-ONLY-SCOPE für v3.3:
 *   - Magic-Check "e2s sample all\x1a\x00"
 *   - 250-Entry Offset-Table
 *   - Pro Slot: RIFF/WAVE-Header + fmt + data + korg/esli Sub-Chunk
 *   - PCM-Decode (16-bit LE → Float32 [-1,+1])
 *   - Korg-Metadata (name, category, loop, slices skeleton)
 *
 * Write-side (Builder) ist out-of-scope für v3.3 (siehe v3.4 Followup).
 *
 * Endianness: alle Multi-Byte-Felder LITTLE-ENDIAN (RIFF/WAVE-Standard).
 *
 * Defensive Parsing:
 *   - Datei-Size-Caps (Min/Max)
 *   - Signature-Check
 *   - Per-Offset Bounds-Check VOR jedem Seek/Read
 *   - Per-Slot RIFF-Size-Cap
 *   - Per-Slot PCM-Size-Cap + Cumulative-PCM-Cap
 *   - Bei zu kleiner korg-body: nur Warning, Slot wird mit Defaults gefüllt
 */

import {
  E2S_ALL_OFFSET_TABLE_START,
  E2S_ALL_SAMPLE_AREA_START,
  E2S_ALL_SIGNATURE,
  E2S_ALL_SIGNATURE_LEN,
  E2S_BIT_DEPTH,
  E2S_FILE_MAX_BYTES,
  E2S_MAX_RIFF_BYTES,
  E2S_MAX_SLOTS,
  E2S_MAX_TOTAL_PCM_BYTES,
  ESLI_CATEGORY_OFFSET,
  ESLI_OSC_INDEX_OFFSET,
  ESLI_END_OFFSET,
  ESLI_LOOP_START_OFFSET,
  ESLI_NAME_LEN,
  ESLI_NAME_OFFSET,
  ESLI_ONESHOT_OFFSET,
  ESLI_PLAY_VOLUME_OFFSET,
  ESLI_PLUS12DB_OFFSET,
  ESLI_SAMPLE_TUNE_OFFSET,
  ESLI_SLICE_STEPS_LEN,
  ESLI_SLICE_STEPS_OFFSET,
  ESLI_SLICE_STRUCT_SIZE,
  ESLI_SLICES_COUNT,
  ESLI_SLICES_NUM_ACTIVE_OFFSET,
  ESLI_SLICES_OFFSET,
  ESLI_SLICING_BEAT_OFFSET,
  ESLI_SLICING_NUM_STEPS_OFFSET,
  ESLI_USE_CHAN1_OFFSET,
  KORG_SUBCHUNK_BODY_SIZE,
  KORG_SUBCHUNK_ID,
  LOOP_TYPE_FORWARD,
  LOOP_TYPE_ONESHOT,
  type LoopType,
  MAX_BYTES_PER_SLOT,
  e2sCategoryName,
} from "./constants";

// ─── Public Types ─────────────────────────────────────────────────────────────

/** Single slice record im korg/esli sub-chunk. */
export interface E2sSlice {
  start: number;
  length: number;
  attackLength: number;
  amplitude: number;
}

/**
 * Ein E2S Sample-Slot, parsed aus einer RIFF/WAVE-Chunk-Einheit innerhalb
 * einer .all-Bank.
 *
 * PCM ist bereits zu Float32 [-1, +1] dekodiert. Bei Stereo ist `pcmData`
 * interleaved L,R,L,R,... (gleiche Konvention wie EsxSample).
 */
export interface E2sSlot {
  /** Index in der 250-Entry-Offset-Table. */
  index: number;
  /** OSC_0index (esli +0x08) — vom Gerät angezeigte Sample-Nummer (z.B. 501+).
   *  Link-Key für E2-Pattern-Part-Refs (die ebenfalls diese Nummer tragen). */
  sampleNumber: number;
  /** Decoded Name (max 16 Chars from on-disk korg-body). */
  name: string;
  /** Category ID (0..17), map via e2sCategoryName(). */
  category: number;
  /** Display-Name der Category. */
  categoryName: string;
  /** PCM Sample-Rate (Hz). */
  sampleRate: number;
  /** 1 = mono, 2 = stereo (validated). */
  channels: 1 | 2;
  /** Frames pro Channel. */
  frames: number;
  /** Float32 PCM-Daten, interleaved bei Stereo. */
  pcmData: Float32Array;
  /** Loop-Mode (0=off, 1=oneshot, 2=forward). */
  loopType: LoopType;
  /** Loop-Start in Frames. */
  loopStart: number;
  /** Loop-End / Sample-End in Frames. */
  loopEnd: number;
  /** 0..127 (Volume aus playVolume-u16 normalisiert). */
  level: number;
  /** +12 dB Gain-Flag aus korg-body. */
  gain12db: boolean;
  /** Bis zu 64 Slice-Records (leere am Ende getrimmt). */
  slices: E2sSlice[];
  /** 64-Byte Step-Pattern für Slice-Trigger (rohe Bytes). */
  sliceSteps: Uint8Array;
  /** Aktive Step-Anzahl im Slicing-Modus. */
  slicingNumSteps: number;
  /** Beat-Quantize-Wert für Slicing. */
  slicingBeat: number;
  /** Anzahl tatsächlich aktiver Slices. */
  slicingNumActive: number;
  /**
   * v3.6.0 — RAW RIFF chunk bytes (RIFF<size>WAVE...) für Bit-Exact-Round-Trip.
   *
   * Default ist UNDEFINED — wird nur befüllt wenn `parseE2sBank(buf, src, {
   * preserveRawRiff: true })` gesetzt ist. Erlaubt Builder, unedited Slots
   * verbatim durchzureichen und so eine bit-exakte Re-Save zu garantieren.
   */
  rawRiff?: Uint8Array;
}

export interface E2sBank {
  /** Quelle (Filename oder "<bytes>"). */
  source: string;
  /** Array Länge 250; null = leerer Slot. */
  slots: Array<E2sSlot | null>;
  /** Rohe Offset-Table (für Diagnose / spätere Round-Trip-Writes). */
  offsetTable: Uint32Array;
  /** Bytes nach dem letzten RIFF bis EOF (in v3.3 nur Größe-Info, nicht keept). */
  trailingBytes: number;
  /** Soft-Warnings. */
  warnings: string[];
}

export class E2sParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "E2sParseError";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function safeSlice(buf: Uint8Array, off: number, len: number): Uint8Array {
  if (off < 0 || off + len > buf.length) {
    throw new E2sParseError(
      `Out-of-bounds read at 0x${off.toString(16)} (length ${len}, file ${buf.length})`,
    );
  }
  return buf.subarray(off, off + len);
}

/** 16-byte ASCII name (NUL-padded), strip trailing zeros + whitespace. */
function decodeAsciiName(raw: Uint8Array): string {
  let end = raw.length;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0) {
      end = i;
      break;
    }
  }
  let s = "";
  for (let i = 0; i < end; i++) {
    const b = raw[i];
    if (b >= 0x20 && b <= 0x7e) s += String.fromCharCode(b);
    else s += "?";
  }
  return s.replace(/\s+$/, "");
}

/**
 * Convert little-endian 16-bit PCM Bytes to Float32 [-1, +1].
 * (Inverse of be16PcmToFloat32 from esxParser; E2S uses LE.)
 */
export function le16PcmToFloat32(raw: Uint8Array): Float32Array {
  const frames = (raw.length / 2) | 0;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const lo = raw[i * 2];
    const hi = raw[i * 2 + 1];
    let v = (hi << 8) | lo;
    if (v >= 0x8000) v -= 0x10000;
    out[i] = Math.max(-1, Math.min(1, v / 32768));
  }
  return out;
}

/**
 * RIFF-Sub-Chunk-Finder.
 * @param body RIFF-Body (alles nach "RIFF"<size>); starts with "WAVE" (4 bytes).
 * @param chunkId 4-byte ASCII chunk ID
 * @returns Payload (ohne Header) oder null wenn nicht gefunden.
 */
function findSubchunk(
  body: Uint8Array,
  chunkId: Uint8Array,
  slotIndex: number,
): Uint8Array | null {
  let pos = 4; // skip 'WAVE'
  while (pos + 8 <= body.length) {
    const sid = body.subarray(pos, pos + 4);
    const dv = new DataView(body.buffer, body.byteOffset + pos + 4, 4);
    const ssize = dv.getUint32(0, true);
    const payloadStart = pos + 8;
    const payloadEnd = payloadStart + ssize;
    if (payloadEnd > body.length) {
      throw new E2sParseError(
        `slot ${slotIndex} sub-chunk size ${ssize} escapes RIFF body (len ${body.length})`,
      );
    }
    if (bytesEqual(sid, chunkId)) {
      return body.subarray(payloadStart, payloadEnd);
    }
    pos = payloadEnd + (ssize & 1); // word-align
  }
  return null;
}

interface FmtFields {
  sampleRate: number;
  channels: 1 | 2;
  bitsPerSample: number;
}

function parseFmt(fmtBody: Uint8Array | null, slotIndex: number): FmtFields {
  if (!fmtBody || fmtBody.length < 16) {
    throw new E2sParseError(
      `slot ${slotIndex} fmt sub-chunk too small (${fmtBody?.length ?? 0} < 16)`,
    );
  }
  const dv = new DataView(fmtBody.buffer, fmtBody.byteOffset, fmtBody.byteLength);
  const audioFmt = dv.getUint16(0, true);
  const channels = dv.getUint16(2, true);
  const sampleRate = dv.getUint32(4, true);
  // bytes 8..12 byteRate, 12..14 blockAlign
  const bps = dv.getUint16(14, true);
  if (audioFmt !== 1) {
    throw new E2sParseError(
      `slot ${slotIndex} non-PCM audio_fmt=${audioFmt} (only 1 supported)`,
    );
  }
  if (channels !== 1 && channels !== 2) {
    throw new E2sParseError(
      `slot ${slotIndex} unsupported channel count ${channels}`,
    );
  }
  if (sampleRate <= 0) {
    throw new E2sParseError(
      `slot ${slotIndex} non-positive sample_rate ${sampleRate}`,
    );
  }
  if (bps !== E2S_BIT_DEPTH) {
    throw new E2sParseError(
      `slot ${slotIndex} bit_depth ${bps} != ${E2S_BIT_DEPTH}`,
    );
  }
  return { sampleRate, channels: channels as 1 | 2, bitsPerSample: bps };
}

interface KorgMeta {
  /** OSC_0index (esli +0x08) — die vom Gerät angezeigte Sample-Nummer (z.B. 501+). */
  sampleNumber: number;
  name: string;
  category: number;
  level: number;
  gain12db: boolean;
  loopType: LoopType;
  loopStart: number;
  loopEnd: number;
  slices: E2sSlice[];
  sliceSteps: Uint8Array;
  slicingNumSteps: number;
  slicingBeat: number;
  slicingNumActive: number;
}

function defaultKorgMeta(): KorgMeta {
  return {
    sampleNumber: 0,
    name: "",
    category: 0,
    level: 100,
    gain12db: false,
    loopType: LOOP_TYPE_ONESHOT,
    loopStart: 0,
    loopEnd: 0,
    slices: [],
    sliceSteps: new Uint8Array(0),
    slicingNumSteps: 0,
    slicingBeat: 0,
    slicingNumActive: 0,
  };
}

function parseKorgBody(
  body: Uint8Array,
  slotIndex: number,
  channels: 1 | 2,
  warnings: string[],
): KorgMeta {
  const meta = defaultKorgMeta();
  if (body.length < KORG_SUBCHUNK_BODY_SIZE) {
    warnings.push(
      `slot ${slotIndex} korg body ${body.length} < ${KORG_SUBCHUNK_BODY_SIZE} (some metadata defaulted)`,
    );
  }

  if (body.length >= ESLI_NAME_OFFSET + ESLI_NAME_LEN) {
    meta.name = decodeAsciiName(
      body.subarray(ESLI_NAME_OFFSET, ESLI_NAME_OFFSET + ESLI_NAME_LEN),
    );
  }

  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);

  // OSC_0index @ +0x08 — vom Gerät angezeigte Sample-Nummer. Verknüpft E2-Pattern-
  // Part-Refs (+0x08, 501+) mit dem Sample, das diese Nummer trägt.
  if (body.length >= ESLI_OSC_INDEX_OFFSET + 2) {
    meta.sampleNumber = dv.getUint16(ESLI_OSC_INDEX_OFFSET, true);
  }

  if (body.length >= ESLI_CATEGORY_OFFSET + 2) {
    let cat = dv.getUint16(ESLI_CATEGORY_OFFSET, true);
    if (cat > 17) {
      warnings.push(`slot ${slotIndex} category ${cat} > 17 (clamped to 0)`);
      cat = 0;
    }
    meta.category = cat;
  }

  if (body.length >= ESLI_PLAY_VOLUME_OFFSET + 2) {
    const playVolume = dv.getUint16(ESLI_PLAY_VOLUME_OFFSET, true);
    let level = playVolume ? Math.min(127, Math.floor((playVolume * 127) / 0xffff)) : 0;
    if (level === 0 && playVolume === 0) level = 100; // device default
    meta.level = level;
  }

  if (body.length > ESLI_ONESHOT_OFFSET) {
    const oneshot = body[ESLI_ONESHOT_OFFSET] !== 0;
    meta.loopType = oneshot ? LOOP_TYPE_ONESHOT : LOOP_TYPE_FORWARD;
  }
  if (body.length >= ESLI_LOOP_START_OFFSET + 4) {
    meta.loopStart = dv.getUint32(ESLI_LOOP_START_OFFSET, true);
  }
  if (body.length >= ESLI_END_OFFSET + 4) {
    meta.loopEnd = dv.getUint32(ESLI_END_OFFSET, true);
  }
  if (body.length > ESLI_PLUS12DB_OFFSET) {
    meta.gain12db = body[ESLI_PLUS12DB_OFFSET] !== 0;
  }

  if (body.length > ESLI_USE_CHAN1_OFFSET) {
    const useChan1 = body[ESLI_USE_CHAN1_OFFSET] !== 0;
    if (channels === 2 && !useChan1) {
      warnings.push(`slot ${slotIndex} stereo but useChan1=0 (device plays mono)`);
    } else if (channels === 1 && useChan1) {
      warnings.push(`slot ${slotIndex} mono but useChan1=1 (ignored)`);
    }
  }

  if (body.length > ESLI_SAMPLE_TUNE_OFFSET) {
    // i8 tune: nicht weiter genutzt aktuell, könnte später ins SlotModel
  }

  // Slice-Array (64 × 16B = 1024B)
  const slicesBlockSize = ESLI_SLICES_COUNT * ESLI_SLICE_STRUCT_SIZE;
  const slicesEnd = ESLI_SLICES_OFFSET + slicesBlockSize;
  if (slicesEnd <= body.length) {
    const decoded: E2sSlice[] = [];
    for (let i = 0; i < ESLI_SLICES_COUNT; i++) {
      const off = ESLI_SLICES_OFFSET + i * ESLI_SLICE_STRUCT_SIZE;
      const start = dv.getInt32(off, true);
      const length = dv.getUint32(off + 4, true);
      const attack = dv.getUint32(off + 8, true);
      const amplitude = dv.getUint32(off + 12, true);
      decoded.push({ start, length, attackLength: attack, amplitude });
    }
    // Trim trailing all-zero slices
    while (decoded.length > 0) {
      const last = decoded[decoded.length - 1];
      if (last.start === 0 && last.length === 0 && last.attackLength === 0 && last.amplitude === 0) {
        decoded.pop();
      } else break;
    }
    meta.slices = decoded;
  }

  const stepsEnd = ESLI_SLICE_STEPS_OFFSET + ESLI_SLICE_STEPS_LEN;
  if (stepsEnd <= body.length) {
    meta.sliceSteps = new Uint8Array(body.subarray(ESLI_SLICE_STEPS_OFFSET, stepsEnd));
  }

  if (body.length > ESLI_SLICING_NUM_STEPS_OFFSET) {
    meta.slicingNumSteps = body[ESLI_SLICING_NUM_STEPS_OFFSET];
  }
  if (body.length > ESLI_SLICING_BEAT_OFFSET) {
    meta.slicingBeat = body[ESLI_SLICING_BEAT_OFFSET];
  }
  if (body.length > ESLI_SLICES_NUM_ACTIVE_OFFSET) {
    meta.slicingNumActive = body[ESLI_SLICES_NUM_ACTIVE_OFFSET];
  }

  return meta;
}

interface ParsedSlot {
  slot: E2sSlot;
  endPos: number;
}

interface ParseSlotOptions {
  preserveRawRiff?: boolean;
}

function parseSlot(
  buf: Uint8Array,
  slotIndex: number,
  fileOffset: number,
  opts: ParseSlotOptions = {},
): { parsed: ParsedSlot; warnings: string[] } {
  const warnings: string[] = [];

  // RIFF Header (8 bytes)
  const headerBytes = safeSlice(buf, fileOffset, 8);
  if (headerBytes[0] !== 0x52 || headerBytes[1] !== 0x49 || headerBytes[2] !== 0x46 || headerBytes[3] !== 0x46) {
    throw new E2sParseError(
      `slot ${slotIndex} RIFF magic mismatch at 0x${fileOffset.toString(16)}`,
    );
  }
  const riffSize = new DataView(headerBytes.buffer, headerBytes.byteOffset + 4, 4).getUint32(0, true);
  if (riffSize < 4 || riffSize > E2S_MAX_RIFF_BYTES) {
    throw new E2sParseError(
      `slot ${slotIndex} RIFF size ${riffSize} out of bounds [4, ${E2S_MAX_RIFF_BYTES}]`,
    );
  }
  const endPos = fileOffset + 8 + riffSize;
  if (endPos > buf.length) {
    throw new E2sParseError(
      `slot ${slotIndex} RIFF chunk escapes file: ends at 0x${endPos.toString(16)}`,
    );
  }

  const body = safeSlice(buf, fileOffset + 8, riffSize);
  // body starts with 'WAVE'
  if (body[0] !== 0x57 || body[1] !== 0x41 || body[2] !== 0x56 || body[3] !== 0x45) {
    throw new E2sParseError(
      `slot ${slotIndex} missing WAVE marker`,
    );
  }

  const FMT_ID = new Uint8Array([0x66, 0x6d, 0x74, 0x20]); // "fmt "
  const DATA_ID = new Uint8Array([0x64, 0x61, 0x74, 0x61]); // "data"

  const fmtBody = findSubchunk(body, FMT_ID, slotIndex);
  const dataBody = findSubchunk(body, DATA_ID, slotIndex);
  const korgBody = findSubchunk(body, KORG_SUBCHUNK_ID, slotIndex);

  if (!fmtBody) throw new E2sParseError(`slot ${slotIndex} missing fmt sub-chunk`);
  if (!dataBody) throw new E2sParseError(`slot ${slotIndex} missing data sub-chunk`);

  const fmt = parseFmt(fmtBody, slotIndex);
  if (dataBody.length > MAX_BYTES_PER_SLOT) {
    throw new E2sParseError(
      `slot ${slotIndex} pcm_data size ${dataBody.length} exceeds per-slot cap ${MAX_BYTES_PER_SLOT}`,
    );
  }

  const meta = korgBody
    ? parseKorgBody(korgBody, slotIndex, fmt.channels, warnings)
    : defaultKorgMeta();

  const pcm = le16PcmToFloat32(dataBody);
  const frames = (pcm.length / fmt.channels) | 0;
  const bytesPerFrame = fmt.channels * (fmt.bitsPerSample / 8);
  const loopStartFrames = bytesPerFrame > 0 ? Math.floor(meta.loopStart / bytesPerFrame) : 0;
  const loopEndFrames = bytesPerFrame > 0 ? Math.floor(meta.loopEnd / bytesPerFrame) : 0;

  // v3.6.0 — Optional raw RIFF preservation für Bit-Exact-Round-Trip.
  // Wir kopieren die kompletten 8+riffSize Bytes (inkl. RIFF-Header) in einen
  // EIGENEN Buffer (nicht subarray-View), damit GC den Mutter-Buffer freigeben
  // darf, sobald der Reader fertig ist.
  let rawRiff: Uint8Array | undefined;
  if (opts.preserveRawRiff) {
    const totalLen = 8 + riffSize;
    rawRiff = new Uint8Array(totalLen);
    rawRiff.set(buf.subarray(fileOffset, fileOffset + totalLen));
  }

  return {
    parsed: {
      slot: {
        index: slotIndex,
        sampleNumber: meta.sampleNumber,
        name: meta.name,
        category: meta.category,
        categoryName: e2sCategoryName(meta.category),
        sampleRate: fmt.sampleRate,
        channels: fmt.channels,
        frames,
        pcmData: pcm,
        loopType: meta.loopType,
        loopStart: Math.max(0, Math.min(loopStartFrames, frames)),
        loopEnd: Math.max(0, Math.min(loopEndFrames, frames)),
        level: meta.level,
        gain12db: meta.gain12db,
        slices: meta.slices,
        sliceSteps: meta.sliceSteps,
        slicingNumSteps: meta.slicingNumSteps,
        slicingBeat: meta.slicingBeat,
        slicingNumActive: meta.slicingNumActive,
        rawRiff,
      },
      endPos,
    },
    warnings,
  };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** v3.6.0 — Parser-Optionen. */
export interface ParseE2sBankOptions {
  /**
   * v3.6.0 — Wenn `true`, wird pro Slot der **rohe RIFF-Chunk-Buffer**
   * (`RIFF<size>WAVE...`) als `slot.rawRiff` aufbewahrt. Erlaubt Builder
   * `preserveRawRiff: true` für **Bit-Exact-Round-Trip**: unedited Slots
   * werden verbatim ins .all geschrieben.
   *
   * Defaultt `false` (kein zusätzlicher Memory-Overhead).
   */
  preserveRawRiff?: boolean;
}

/**
 * Parses an E2S `.all` Sample-Bank from a buffer.
 *
 * @throws {E2sParseError} bei kaputter Signature/Offset-Table-Plausibilität.
 *   Einzelne kaputte Slots können (je nach Fehlertyp) skip + warn statt throw.
 */
export function parseE2sBank(
  input: ArrayBuffer | Uint8Array,
  source = "<bytes>",
  opts: ParseE2sBankOptions = {},
): E2sBank {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);

  if (buf.length < E2S_ALL_SAMPLE_AREA_START) {
    throw new E2sParseError(
      `file too small to be a valid .all: ${buf.length} bytes (need >= ${E2S_ALL_SAMPLE_AREA_START})`,
    );
  }
  if (buf.length > E2S_FILE_MAX_BYTES) {
    throw new E2sParseError(
      `file size ${buf.length} exceeds max ${E2S_FILE_MAX_BYTES}`,
    );
  }

  // Signature
  const sig = safeSlice(buf, 0, E2S_ALL_SIGNATURE_LEN);
  if (!bytesEqual(sig, E2S_ALL_SIGNATURE)) {
    throw new E2sParseError(`signature mismatch at offset 0x0000`);
  }

  // Offset-Table (250 × u32 LE = 1000 bytes)
  const offsetTable = new Uint32Array(E2S_MAX_SLOTS);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  for (let i = 0; i < E2S_MAX_SLOTS; i++) {
    offsetTable[i] = dv.getUint32(E2S_ALL_OFFSET_TABLE_START + i * 4, true);
  }

  // Bounds-Check each offset before any read.
  const warnings: string[] = [];
  for (let i = 0; i < E2S_MAX_SLOTS; i++) {
    const off = offsetTable[i];
    if (off === 0) continue;
    if (off < E2S_ALL_SAMPLE_AREA_START) {
      throw new E2sParseError(
        `slot ${i} offset 0x${off.toString(16)} lies inside prelude (< 0x${E2S_ALL_SAMPLE_AREA_START.toString(16)})`,
      );
    }
    if (off + 8 > buf.length) {
      throw new E2sParseError(
        `slot ${i} offset 0x${off.toString(16)} + 8-byte RIFF header escapes file`,
      );
    }
  }

  const slots: Array<E2sSlot | null> = new Array(E2S_MAX_SLOTS).fill(null);
  let totalPcm = 0;
  let lastEnd = E2S_ALL_SAMPLE_AREA_START;

  for (let i = 0; i < E2S_MAX_SLOTS; i++) {
    const off = offsetTable[i];
    if (off === 0) continue;
    try {
      const { parsed, warnings: slotWarnings } = parseSlot(buf, i, off, {
        preserveRawRiff: opts.preserveRawRiff,
      });
      slots[i] = parsed.slot;
      lastEnd = Math.max(lastEnd, parsed.endPos);
      warnings.push(...slotWarnings);
      totalPcm += parsed.slot.pcmData.byteLength;
      if (totalPcm > E2S_MAX_TOTAL_PCM_BYTES) {
        throw new E2sParseError(
          `cumulative PCM size ${totalPcm} bytes exceeds E2S total cap ${E2S_MAX_TOTAL_PCM_BYTES}`,
        );
      }
    } catch (err) {
      // Defensive: einzelner kaputter Slot bricht nicht die ganze Bank ab,
      // nur wenn der Fehler die Datei verlässt oder Caps verletzt.
      if (err instanceof E2sParseError) {
        if (err.message.includes("exceeds") || err.message.includes("escapes file")) {
          throw err;
        }
        warnings.push(`slot ${i}: ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  const trailingBytes = Math.max(0, buf.length - lastEnd);
  return {
    source,
    slots,
    offsetTable,
    trailingBytes,
    warnings,
  };
}

/** Quick magic-only-check. */
export function isE2sBuffer(input: ArrayBuffer | Uint8Array): boolean {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length < E2S_ALL_SIGNATURE_LEN) return false;
  return bytesEqual(buf.subarray(0, E2S_ALL_SIGNATURE_LEN), E2S_ALL_SIGNATURE);
}

/** Count of non-null slots in an E2S bank. */
export function countE2sSlots(bank: E2sBank): number {
  let n = 0;
  for (const s of bank.slots) if (s !== null) n++;
  return n;
}

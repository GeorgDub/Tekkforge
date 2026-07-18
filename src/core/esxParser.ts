/**
 * Synthstudio – ESX-1 Sample-Bank Parser (v3.23.0)
 *
 * Port aus dem Python-Tool `G:/IdeaProjects/Korg Editor`.
 * SoT: G:/IdeaProjects/Korg Editor/esx_e2s_editor/services/esx_parser.py
 * SoT: G:/IdeaProjects/Korg Editor/esx_e2s_editor/services/audio_processor.py
 *
 * v3.3.0 SCOPE (Samples):
 *   - Magic-Validierung "KORG" + "ESX\0"
 *   - Sample-Counters
 *   - 256 Mono-Headers + 128 Stereo-Headers
 *   - PCM-Extraction mit BE→LE-Swap + Int16→Float32-Konvertierung
 *
 * v3.5.0 SCOPE (Patterns — TASK-237-FOLLOWUP-5):
 *   - 256 Patterns × 4280 Bytes ab Offset 0x0200
 *   - Best-Effort Pattern-Parser:
 *       • Name (8 ASCII Bytes ab Pattern-Offset 0)
 *       • BPM (BE u16 / 128 ab Pattern-Offset 8)
 *       • Step-Length-Indikator (Pattern-Offset 13, init=0x0F=16 Steps)
 *       • Swing (Pattern-Offset 15, Best-Effort)
 *       • Empty-Pattern-Erkennung (Bytes 8..19 matchen "Init"-Signatur)
 *
 * v3.14.0 SCOPE (Step-Encoding RE — TASK-v3.5-FU):
 *   Hex-Diff Analyse 2026-05-18 (init vs real Patterns aus BOTTROP/KASSEL/
 *   ENDLICH/DUSSELBUNKAAA) hat folgende Layout-Felder verifiziert:
 *     • Per-Part-Stride: 34 Bytes (18B Header + 16B Step-Trigger)
 *     • 10 Drum-Parts (Drum 1..10) ab Offset 0x18 (= 24)
 *     • sample-id BE u16 @ part+0  (0x8000 = unassigned)
 *     • level @ part+9 (0..127)
 *     • pan @ part+10 (0..127, 64=center)
 *     • Step-Trigger: 16B @ part+18, bit 0 = active
 *     • Beweis: BOTTROP[0] Part 5 = '01 00 00 00 01 00 00 00 ...'
 *       dekodiert zu Kick-Pattern Steps 0,4,8,12 + Extra (4-on-the-floor)
 *
 * v3.20.0 SCOPE (Pitch/FxSend + Parts 10..15 RE — TASK-v3.14-FU-1/2):
 *   Erweiterte Hex-Diff-Analyse (BOTTROP/KASSEL × alle Patterns) hat
 *   zusaetzliche Felder im Drum-Part-Header verifiziert:
 *     • +8  = pitch (signed i8, 0x40 = neutral = 0 semitones, Range 0x00..0x7F)
 *             KASSEL zeigt Werte 0x00..0xFD ⇒ signed two's-complement
 *             Default 0x40 in 2475/2830 BOTTROP-Parts → high confidence
 *     • +11 = fxSend (u8, 0..127, 0=off, 0x7F=max)
 *             12 unique Werte in BOTTROP → high confidence
 *   Parts 10..15 Layout (verifiziert via 'ff 00' marker-Scan + step-pattern-shape):
 *     • Part 10 (Stretch 1): 34B-Header @ 0x25C (gleicher Stride wie Drum-Parts)
 *     • Parts 11..14 (Sample/Slice/Synth): 32B-Stride @ 0x36E, 0x38E, 0x3AE, 0x3CE
 *       Layout pro 32B-Block: 16B Header (sample-id BE u16 @+0, pitch @+6,
 *       level @+7, pan @+8, fxSend @+10) + 16B Step-Trigger bytes
 *       Beweis: BOTTROP[1] Part-11 (0x36E) = sample-id 0x0086, steps 1/5/9/13
 *       Beweis: BOTTROP[0] Part-13 (0x3AE) = sample-id 0x0023, alle 16 Steps
 *     • Part 15 (Audio-In/Accent): default-Header @ 0x3CE — fast immer
 *       konstant '00 7f 00 40 64 40 7f 00...' = unused. Keine User-Trigger
 *       in den Real-Files gefunden → bleibt Defaults.
 *   Motion-Sequencer-Daten (0x16C..0x25B = 240B Drum-Motion und
 *   0x27E..0x35D = ~224B Stretch+Sample-Motion) bleiben Best-Effort defaults;
 *   ein vollstaendiges Motion-Decoding wurde fuer v3.20 nicht implementiert.
 *
 * v3.23.0 SCOPE (Step-Byte Bit-Layout RE — TASK-v3.20-FU-SYNTH-NOTE):
 *   Reverse-Engineering der step-byte Bits 1..7 (Werte wie 0x11, 0x15, 0x55
 *   in BOTTROP[0] Part 13). Analyse von 17222 active steps in 5 Files
 *   (BOTTROP/ENDLICH/KASSEL/TOBI/YOYOY):
 *     • bit 0 = trigger active (CONFIRMED v3.20, 100% Korrelation)
 *     • bit 4 = ACCENT (Best-Effort): erscheint in 70.9% der Drum-Part
 *       active-steps und 38.2% der Short-Part active-steps. Konsistent mit
 *       TR-Style Accent-Track-Layer.
 *     • bits 1..3, 5..7 = roll/slide/velocity? Nicht zuverlaessig RE-d.
 *   NOTE-ENCODING-HYPOTHESE WIDERLEGT:
 *     97 distinct upper-7-bit-values gefunden, aber die distinct-value-Range
 *     pro "melodic"-Row (≥10 distinct in 16 Steps) hat median 95 / max 123
 *     Semitones — physisch unmoeglich fuer eine Bass/Lead-Line (max 36 typisch).
 *     Step-bytes encoden KEINE Notenhoehe; die Pitch-Information lebt im
 *     Per-Part-Header (pitch @+6 fuer 32B-stride, @+8 fuer 34B-stride).
 *   API: EsxStepEvent.accent?: boolean wird gesetzt (gilt fuer alle Parts
 *     0..14 — Audio-In Part 15 bleibt Defaults).
 *   Per-Step Pitch-Motion Region 0x488+ ist in allen untersuchten Files
 *   vollstaendig 0x80 (neutral) → KEINE per-step note-modulation gefunden.
 *
 * Defensive Parsing:
 *   - File-Size-Check (Min/Max)
 *   - Magic-Checks
 *   - Per-Slot + Cumulative PCM-Caps
 *   - Bounds-Checks bei jedem Read
 *   - Try/catch um die gesamten Parse-Schritte
 *   - Bei Range-Fehlern: Slot ⇒ skipped, gesamter Parse läuft weiter
 *
 * Endianness:
 *   - Alle Multi-Byte-Felder BIG-ENDIAN (Korg-Device-Konvention).
 */

import {
  ESX1_ADDR_NUM_MONO_SAMPLES,
  ESX1_ADDR_PATTERN_DATA,
  ESX1_ADDR_SAMPLE_DATA,
  ESX1_ADDR_SAMPLE_HEADER_MONO,
  ESX1_ADDR_SAMPLE_HEADER_STEREO,
  ESX1_ADDR_SONG_DATA,
  ESX1_ADDR_SONG_EVENT_DATA,
  ESX1_ADDR_VALID_CHECK_2,
  ESX1_CHUNKSIZE_PATTERN,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO,
  ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO,
  ESX1_CHUNKSIZE_SONG,
  ESX1_CHUNKSIZE_SONG_EVENT,
  ESX1_EMPTY_OFFSET,
  ESX1_MAX_MONO_SLOTS,
  ESX1_MAX_SAMPLE_MEM_IN_BYTES,
  ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES,
  ESX1_MAX_STEREO_SLOTS,
  ESX1_NUM_PATTERNS,
  ESX1_NUM_SONGS,
  ESX1_SIGNATURE,
  ESX1_SIZE_FILE_MIN,
  ESX1_SUBMAGIC,
  ESX1_SUBMAGIC_OFFSET,
  ESX_FILE_MAX_BYTES,
  MAX_BYTES_PER_SLOT,
} from "./constants";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Eine einzelne (parseable) Sample-Slot-Repräsentation aus einer .esx Bank.
 *
 * PCM ist bereits BE→LE-konvertiert und auf Float32 [-1, +1] normalisiert,
 * damit Web-Audio Code (AudioBuffer / playSliceBuffer) den Buffer ohne weitere
 * Transformation laden kann.
 *
 * Für Stereo-Slots ist `pcmData` interleaved L,R,L,R,... mit `frames` PCM-Frames
 * insgesamt (also `pcmData.length === frames * channels`).
 */
export interface EsxSample {
  /** Slot-Index im on-disk Layout (0..255 mono, 256..383 stereo). */
  index: number;
  /** Decoded ASCII name (trimmed, max 8 chars). Kann leer-string sein. */
  name: string;
  /** 1 = mono, 2 = stereo. */
  channels: 1 | 2;
  /** Sample-Rate in Hz (typisch 44100, gerätespezifisch). */
  sampleRate: number;
  /** Anzahl PCM-Frames pro Channel (=== pcmData.length / channels). */
  frames: number;
  /** Float32 PCM-Daten, normalisiert auf [-1, +1], interleaved bei Stereo. */
  pcmData: Float32Array;
  /** Loop-Start-Frame (mono only; stereo immer 0). */
  loopStart: number;
  /** Loop-End-Frame oder Sample-End-Frame. */
  loopEnd: number;
  /** Geräte-Lautstärke 0..127 (LEVEL_DEFAULT bei zero/missing). */
  level: number;
}

/**
 * Anzahl Drum/Synth-Parts pro ESX-1-Pattern.
 *
 * ESX-1 hat insgesamt 16 Parts: 9× Drum, 2× Stretch, 2× Slice, 1× Audio-In,
 * 2× Synth (+ optional Accent-Layer). Die genaue Part-Reihenfolge im
 * Pattern-Block ist nicht final RE-d; wir nehmen 16 Parts als Konstante an
 * und mappen sie 1:1 auf Synthstudio's 16 Drum-Parts (Index 0..15).
 */
export const ESX1_PARTS_PER_PATTERN = 16;

/** Default-Step-Count pro ESX-1-Pattern (Hardware: 16-Step-Sequencer). */
export const ESX1_DEFAULT_STEPS = 16;

/**
 * Ein einzelner Step in einer EsxPart.
 *
 * v3.5 Best-Effort: `active` + `velocity` werden konservativ aus dem
 * Pattern-Block extrahiert. Die exakte Step-Byte-Codierung ist noch nicht
 * vollstaendig reverse-engineered; wir scannen heuristisch nach `1x`-
 * Bytes-Sequences die im realen .esx-File als 16-Byte-Bloecke direkt nach
 * jedem Part-Header auftreten.
 */
export interface EsxStepEvent {
  active: boolean;
  /** 0..127 — Default 100 wenn nicht extrahierbar. */
  velocity: number;
  /**
   * v3.23.0: ACCENT-Flag (Best-Effort).
   *
   * Bit-4 des step-bytes erscheint in real-files mit hoher Frequenz (Drum-Parts
   * 70.9% / Short-Parts 38.2% der active-Steps in 5 untersuchten Files mit
   * 17222 active steps). Die Hypothese lautet "bit-4 = accent" (TR-Style
   * Accent-Track-Layer) — KEINE Note-Encoding, da die distinct-value-Range
   * (97 unique values) und der gemessene "musical-pitch-range" (median 95,
   * max 123 semis) physisch unmoeglich fuer Synth-Bass/Lead-Lines waeren.
   *
   * Mapping:
   *   active step + accent → velocity 127 (TR-typische +27 Boost)
   *   active step ohne accent → velocity 100 (Default)
   *
   * Bei Render kann der Caller `accent` interpretieren als
   * "Velocity-Boost, Filter-Mod-Trigger, oder Reverb-Send-Boost" je nach
   * Synthstudio-Kontext.
   */
  accent?: boolean;
}

/**
 * Ein Pattern-Part (Drum/Synth-Spur).
 *
 * v3.5 Best-Effort:
 *   - `partIndex` ist 0..15 (= Position im 16-Part-Layout)
 *   - `steps` enthaelt immer ESX1_DEFAULT_STEPS Eintraege
 *   - `volume`/`pan`/`pitch`/`fxAmount` sind Hardware-Defaults wenn nicht
 *     verifiziert; siehe Begleit-Doku zu unbekannten Offsets.
 *   - `motionSequencer` wird in v3.5 NICHT gesetzt (Motion-Daten-Layout
 *     ist nicht RE-d).
 */
export interface EsxPart {
  partIndex: number;
  /** 0..255 — ESX-1 Sample-Slot-Index. Best-Effort; 0 wenn unbekannt. */
  sampleId: number;
  /** 0..127. */
  volume: number;
  /** 0..127 (64 = center). */
  pan: number;
  /** Signed -64..+63 semitones. */
  pitch: number;
  /** 0..127. */
  fxAmount: number;
  /** Trigger-Steps, Laenge === ESX1_DEFAULT_STEPS. */
  steps: EsxStepEvent[];
  /** Reserviert fuer Motion-Sequencer (v3.5: stets undefined). */
  motionSequencer?: undefined;
}

/**
 * Ein Pattern aus dem ESX-1-Backup.
 *
 * Verified-Felder (v3.5, gegen 5 reale .esx-Files):
 *   - `name`        (Pattern-Offset 0..7 ASCII, trimmed)
 *   - `bpm`         (Pattern-Offset 8 BE u16 / 128.0)
 *   - `lengthSteps` (Pattern-Offset 13 +1; init=0x0F → 16 Steps)
 *
 * Best-Effort:
 *   - `swing`       (Pattern-Offset 15, range 0..100)
 *   - `parts[]`     (16 Slots — Step-Trigger heuristisch geparst)
 */
export interface EsxPattern {
  index: number;
  /** ASCII-Name (8 chars max), trimmed. Empty-Pattern → ''. */
  name: string;
  /** BPM (Hardware-Range 20..300). */
  bpm: number;
  /** Step-Count (16 fuer alle bisherigen Real-Files). */
  lengthSteps: number;
  /** Swing 0..100 (Best-Effort). */
  swing: number;
  /** 16 Parts (immer voll besetzt; leere Parts haben alle Steps inactive). */
  parts: EsxPart[];
  /** Rohbytes des 4280-Byte Pattern-Blocks. Hilft beim Debugging + Diff. */
  raw?: Uint8Array;
}

/**
 * v3.89.0 — Ein einzelnes Song-Event (8 Bytes).
 *
 * Reverse-Engineering-Stand 2026-05-19 gegen 38 reale .esx-Files:
 *   - Das offizielle Korg-Manual + Open Electribe Editor enthalten KEINE
 *     dokumentierte Song-Event-Struktur — die Felder unten sind aus den
 *     Bytemustern bei 0x138400+ in KASSEL.esx + Jump New.esx abgeleitet.
 *   - 8-Byte-Frames mit folgender Best-Effort-Interpretation:
 *       +0..+1 = `time` (BE u16, Step-Index in der Songzeitachse)
 *       +2     = `pattern` (u8, 0..255 = Pattern-Slot-Index)
 *       +3     = `length`  (u8, Step-Repeats des Patterns; oft 0xF7)
 *       +4..+5 = `flags`   (BE u16, fast immer 0x0000)
 *       +6..+7 = `data`    (BE u16, terminator-Marker oder MIDI-Mute-Mask)
 *   - Terminator: ein Event-Frame mit data == 0xFFFF (= "07 FF" Marker
 *     im Pattern-Field) signalisiert Songende. Real-Beobachtung an Position
 *     0x138400: `00 70 01 f7 00 00 07 ff` → Pattern 1, length F7, end-marker.
 *
 * Die Werte sind defensiv geklemmt und werden NIE zum Wegwerfen eines Events
 * benutzt; Caller können `data === 0xFFFF` selbst als End-Marker erkennen.
 */
export interface EsxSongEvent {
  /** Step-position im Song (BE u16). */
  time: number;
  /** Pattern-Slot 0..255. */
  pattern: number;
  /** Length / Repeats (1..255). 0xF7 = Default. */
  length: number;
  /** Best-Effort Flags-Feld (BE u16). */
  flags: number;
  /** Trailing BE u16 — 0xFFFF = end-of-song marker. */
  data: number;
}

/**
 * v3.89.0 — Ein einzelnes Song-Slot (Index 0..63, 528 Bytes on disk).
 *
 * Reverse-Engineering-Stand 2026-05-19:
 *   - Header-Layout: +0..+7  = 8-byte ASCII name (space/NUL-padded)
 *                    +8      = u8 BPM-Hint (init=0x3c=60, real-werte oft 0x00)
 *                    +9..+15 = constant 0x00 in allen 4096 untersuchten Slots
 *                    +16..   = opaque event/sequence-data (nicht vollstaendig RE-d)
 *   - Empty-Slot-Erkennung: alle 528 Bytes match die init-Signatur
 *     (8x 0x20 + 0x3c + 519x 0x00). 32 von 64 Songs in KASSEL.esx zeigen
 *     diesen Init-Header.
 *
 * Die `events`-Liste wird aus der globalen Song-Event-Region (0x138400+)
 * extrahiert — pro Song werden Events bis zum nächsten End-Marker
 * (data == 0xFFFF) gesammelt.
 */
export interface EsxSong {
  /** Slot-Index 0..63. */
  index: number;
  /** ASCII-Name (8 chars max, trimmed). Empty-Slot → ''. */
  name: string;
  /** BPM-Hint aus Slot-Offset +8 (Best-Effort, oft 60 = init). */
  bpm: number;
  /** Anzahl der Events, die diesem Song zugeordnet sind. */
  eventCount: number;
  /**
   * Liste der dekodierten 8B-Events. Leer, wenn der Song initialisiert ist
   * oder die Event-Region fehlt. Defensive: max 4096 Events pro Song.
   */
  events: EsxSongEvent[];
  /** Rohbytes des 528B Song-Blocks (Debug/Diff). */
  raw?: Uint8Array;
}

export interface EsxBank {
  /** Quelle (Filename oder "<bytes>"). */
  source: string;
  /** Mono-Samples (immer 1-Channel). */
  monoSamples: EsxSample[];
  /** Stereo-Samples (immer 2-Channel, interleaved). */
  stereoSamples: EsxSample[];
  /** Patterns — in v3.3 leeres Array (Skeleton-Doku). */
  patterns: EsxPattern[];
  /**
   * v3.89.0 — Geparste non-empty Songs (max 64). Leere Init-Slots werden
   * weggelassen. Wenn die Song-Region truncated ist, wird ein warning
   * generiert und das Array bleibt leer.
   */
  songs: EsxSong[];
  /** Vom Header gemeldete Mono-Sample-Anzahl (Plausibilitätsfeld). */
  declaredMonoCount: number;
  /** Vom Header gemeldete Stereo-Sample-Anzahl. */
  declaredStereoCount: number;
  /** Soft-Warnings die das Parsen nicht abgebrochen haben. */
  warnings: string[];
}

export class EsxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EsxParseError";
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Liest ein Slice aus dem Master-Uint8Array mit Bounds-Check. */
function safeSlice(buf: Uint8Array, off: number, len: number): Uint8Array {
  if (off < 0 || off + len > buf.length) {
    throw new EsxParseError(
      `Out-of-bounds read at 0x${off.toString(16)} (length ${len}, file ${buf.length})`,
    );
  }
  return buf.subarray(off, off + len);
}

/** 8-byte ASCII name, NUL- oder space-padded. Non-ASCII → '?'. */
function decodeEsxName(raw: Uint8Array): string {
  let end = raw.length;
  // Trailing NUL strippen
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
 * Konvertiert Big-Endian 16-bit-PCM-Bytes zu Float32 [-1, +1].
 * @param raw Rohbytes aus dem PCM-Bereich (BE i16).
 * @returns Float32Array gleicher Frame-Anzahl (length / 2).
 */
export function be16PcmToFloat32(raw: Uint8Array): Float32Array {
  const frames = (raw.length / 2) | 0;
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    const hi = raw[i * 2];
    const lo = raw[i * 2 + 1];
    // BE: hi-byte erst. Sign-extend.
    let v = (hi << 8) | lo;
    if (v >= 0x8000) v -= 0x10000;
    out[i] = Math.max(-1, Math.min(1, v / 32768));
  }
  return out;
}

/** Liest 6 BE u32 (offsets etc.) aus 24-Byte-Bereich des Mono-Headers. */
function readMonoHeaderFields(body: Uint8Array): {
  off1Start: number;
  off1End: number;
  start: number;
  end: number;
  loopStart: number;
  sampleRate: number;
  sampleTune: number;
  playLevel: number;
} {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  // bytes 8..32 = 6 × u32 BE (off1Start, off1End, start, end, loopStart, sampleRate)
  return {
    off1Start: dv.getUint32(8, false),
    off1End: dv.getUint32(12, false),
    start: dv.getUint32(16, false),
    end: dv.getUint32(20, false),
    loopStart: dv.getUint32(24, false),
    sampleRate: dv.getUint32(28, false),
    sampleTune: dv.getInt16(32, false),
    playLevel: body[34],
  };
}

/** Stereo-Header (44B): 7 × u32 BE (channel-offsets, start, end, sampleRate). */
function readStereoHeaderFields(body: Uint8Array): {
  off1Start: number;
  off1End: number;
  off2Start: number;
  off2End: number;
  start: number;
  end: number;
  sampleRate: number;
  sampleTune: number;
  playLevel: number;
} {
  const dv = new DataView(body.buffer, body.byteOffset, body.byteLength);
  return {
    off1Start: dv.getUint32(8, false),
    off1End: dv.getUint32(12, false),
    off2Start: dv.getUint32(16, false),
    off2End: dv.getUint32(20, false),
    start: dv.getUint32(24, false),
    end: dv.getUint32(28, false),
    sampleRate: dv.getUint32(32, false),
    sampleTune: dv.getInt16(36, false),
    playLevel: body[38],
  };
}

// ─── Pattern-Block-Helpers (v3.5) ────────────────────────────────────────────

/**
 * "Init"-Pattern-Signatur. Nach Pattern-Offset 8 erscheinen genau diese 12
 * Bytes in einem unbenutzten/initialisierten Pattern-Slot. Verifiziert gegen
 * 6+ reale .esx-Files (DUSSELBUNKAAA, etc.).
 *
 *   3c 00 00 00 00 0f 00 3c 00 00 7f ff
 *
 * Sobald die ersten 12 Bytes ab Pattern-Offset 8 EXAKT diese Sequenz haben,
 * ist das Pattern leer (kein User-Inhalt). Real-Patterns weichen mindestens
 * in einem der Bytes ab.
 */
const ESX1_INIT_PATTERN_SIGNATURE = new Uint8Array([
  0x3c, 0x00, 0x00, 0x00, 0x00, 0x0f, 0x00, 0x3c, 0x00, 0x00, 0x7f, 0xff,
]);

/**
 * Prueft ob ein 4280-Byte Pattern-Block ein "init"/leeres Pattern ist.
 *
 * Heuristik (zwei Wege):
 *   A) Bytes 8..20 matchen die ESX-1 Default-Pattern-Signatur UND
 *      die ersten 8 Bytes (Name) sind alle Space oder NUL.  (real-files)
 *   B) Erste 32 Bytes sind alle 0x00. (synthetisch/unwritten slots)
 *
 * Beide Wege haben False-Negative-Sicherheit: ein echtes Pattern hat
 * niemals all-zero bytes in den ersten 32 Bytes (BPM != 0 sorgt dafuer)
 * und ein init-Pattern hat niemals einen non-empty Namen.
 */
export function isEmptyEsxPattern(raw: Uint8Array): boolean {
  if (raw.length < 20) return true;
  // Weg B: All-Zero (synthetisch/unwritten)
  let allZero = true;
  for (let i = 0; i < 32 && i < raw.length; i++) {
    if (raw[i] !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) return true;
  // Weg A: Real-File-Init-Signatur
  const name = decodeEsxName(raw.subarray(0, 8));
  if (name !== "") {
    return false; // expliziter Name → nicht leer
  }
  for (let i = 0; i < ESX1_INIT_PATTERN_SIGNATURE.length; i++) {
    if (raw[8 + i] !== ESX1_INIT_PATTERN_SIGNATURE[i]) return false;
  }
  return true;
}

// ─── v3.20.0: Part-Block-Layout im 4280B Pattern-Block ──────────────────────
//
// Hex-Diff Analyse 2026-05-18 (init vs real Patterns aus BOTTROP/KASSEL/
// ENDLICH/DUSSELBUNKAAA × alle 32 non-empty Patterns):
//
//   Pattern-Block:
//     0x000..0x007 = 8B Name (ASCII)
//     0x008..0x009 = BE u16 BPM×128
//     0x00A..0x017 = 24B Globals (step-length @0x0D, swing @0x0F, …)
//     0x018..0x163 = 10 Drum-Parts × 34B  (Drum 1..10)      ← v3.14 decoded
//     0x16C..0x25B = ~240B Drum-Motion-Sequencer-Daten (15 lanes × 16B,
//                    0xBC neutral fuer Pitch-lanes, 0x02 fuer Switch-lanes)
//     0x25C..0x27D = Part 11 (Stretch 1): 34B-Header gleicher Layout wie Drum
//     0x27E..0x35D = ~224B Motion fuer Stretch + Sample/Slice Parts
//     0x35E..0x3DD = 4 Parts (Sample 1/2, Slice 1/2 oder Synth 1/2):
//                    32B-Stride (16B Header + 16B Step-Trigger)
//                    Positionen: 0x36E, 0x38E, 0x3AE, 0x3CE — siehe
//                    decodeShortPart() unten
//     0x3DE..0x466 = Reserve / Synth-Motion-Lanes
//     0x466..0x488 = Footer (Audio-In + Accent + ff-padding)
//     0x488..      = Per-Step Pitch-Motion-Region (0x80 = neutral)
//
//   v3.20.0 Drum-Part-Layout (34B) — vollstaendig RE-d:
//     +0..+1  = sample-id (BE u16). 0x8000 = unassigned/empty.
//     +2..+3  = constant 'ff 00' (loop/reverse flag — invariant in real files)
//     +4..+7  = EG / mod-fields (best-effort, niedrige Variance)
//     +8      = PITCH (signed i8, 0x40 = neutral = 0 semitones)  ← v3.20 NEU
//     +9      = level (u8, 0..127, init=0x64=100)
//     +10     = pan (u8, 0..127, 64=center)
//     +11     = FX SEND (u8, 0..127, 0=off, 0x7F=max)            ← v3.20 NEU
//     +12..+17 = modulation, lfo (best-effort, not decoded)
//     +18..+33 = 16 step bytes (1 byte/step, bit 0 = active)
//
//   Step-Encoding (verifiziert gegen BOTTROP[0] Part 5/6):
//     bit 0 = trigger active (1 = step gespielt)
//     bits 1..7 = velocity/accent/roll (best-effort, nicht final RE-d)
//
//   v3.20.0 Short-Part-Layout (32B = 16B Header + 16B Steps):
//     +0..+1  = sample-id (BE u16)
//     +2..+5  = mode flags (z.B. 03 7f 00 40 = sample-mode default)
//     +6      = PITCH (signed i8, 0x40 = neutral)
//     +7      = level (u8, 0..127)
//     +8      = pan (u8, 0..127)
//     +9      = ? (often 0x7F)
//     +10     = FX SEND (u8, 0..127, 0=off)
//     +11..+15 = mod flags
//     +16..+31 = 16 step bytes
//
//   Beweis: BOTTROP[1] @0x36E "Sample-Part 1":
//     hdr=00 86 03 7f 00 40 36 7f 40 7f 00 06 82 55 40 00
//     → sampleId=0x86, pitch=0x36 (–10 semi), level=0x7f, pan=0x40, fx=0x00
//     steps=01 00 00 00 01 00 00 00 01 00 00 00 01 00 00 00 (4-on-the-floor)
//
// ESX1_DRUM_PARTS_DECODED = 10 (Drum 1..10).
// ESX1_STRETCH_PART_INDEX = 10 (1 Stretch part at offset 0x25C, 34B-stride).
// ESX1_SHORT_PART_INDICES = 11..14 (4 Sample/Slice parts, 32B-stride).
// ESX1_AUDIOIN_PART_INDEX = 15 (Audio-In, no triggers in real files → Defaults).
const ESX1_PART_STRIDE = 34;
const ESX1_PART_HEADER_BYTES = 18;
const ESX1_PART_STEPS_BYTES = 16;
const ESX1_DRUM_PART_OFFSET = 24;
const ESX1_DRUM_PARTS_DECODED = 10;
const ESX1_SAMPLEID_UNASSIGNED = 0x8000;

/** Offset of the Stretch part 11 (34B-stride like drum parts). */
const ESX1_STRETCH_PART_OFFSET = 0x25c;
/** Per-part offsets for parts 12..15 (16B header + 16B steps = 32B stride). */
const ESX1_SHORT_PART_OFFSETS: ReadonlyArray<number> = [
  0x36e, // Part 12 (Sample 1 / Slice 1 — best-effort)
  0x38e, // Part 13 (Sample 2 / Slice 2)
  0x3ae, // Part 14 (Synth 1)
  0x3ce, // Part 15 (Synth 2 / Audio-In — usually default-empty)
];
const ESX1_SHORT_PART_HEADER_BYTES = 16;
const ESX1_SHORT_PART_STEPS_BYTES = 16;
const ESX1_PITCH_NEUTRAL_RAW = 0x40;

/**
 * v3.23.0: Decoded ein einzelnes step-byte zu {active, velocity, accent}.
 *
 * Verifiziertes Bit-Layout (siehe Header-Doc v3.23.0):
 *   bit 0 = trigger active
 *   bit 4 = accent (Best-Effort, 70.9% Drum + 38.2% Short der active-steps)
 *
 * Mapping-Konvention:
 *   active + accent → velocity 127 (TR-style boost)
 *   active ohne accent → velocity 100 (Default)
 *   inactive → velocity 0, accent weggelassen (undefined)
 *
 * Wir mappen explizit die zwei verifizierten Bits — die Bits 1..3, 5..7
 * bleiben nicht-RE-d und werden NICHT als Pseudo-Velocity exportiert
 * (vermeidet false-positive Note-Encodings).
 */
function decodeStepByte(rawByte: number): EsxStepEvent {
  const b = rawByte & 0xff;
  const active = (b & 0x01) !== 0;
  if (!active) {
    return { active: false, velocity: 0 };
  }
  const accent = (b & 0x10) !== 0;
  return { active: true, velocity: accent ? 127 : 100, accent };
}

/**
 * Wandelt das +8-byte (Pitch) eines Drum/Short-Part-Headers in Semitones um.
 *
 * Signed-Two's-Complement, neutral bei 0x40 (= 0 semitones). Range: 0x00..0x7F
 * mapped auf -64..+63 semitones (Hardware-Range). Werte ueber 0x7F treten in
 * Real-Files in KASSEL.esx auf — wir interpretieren sie als signed i8 (range
 * 0x80..0xFF = -128..-1) und klampen dann auf das gleiche -64..+63-Fenster
 * (Hardware-Limit).
 */
function decodePitchByte(rawByte: number): number {
  const b = rawByte & 0xff;
  // Most files: 0x00..0x7F. Klammere die Two's-Komplement-Interpretation auf
  // das Hardware-Fenster -64..+63 fuer Konsistenz.
  const signed = b - ESX1_PITCH_NEUTRAL_RAW;
  if (signed < -64) return -64;
  if (signed > 63) return 63;
  return signed;
}

/** Decoded part = 0..9 (Drum 1..10). Out-of-range → undefined (Defaults). */
function decodeDrumPart(
  raw: Uint8Array,
  partIndex: number,
):
  | {
      sampleId: number;
      volume: number;
      pan: number;
      pitch: number;
      fxAmount: number;
      steps: EsxStepEvent[];
    }
  | undefined {
  if (partIndex < 0 || partIndex >= ESX1_DRUM_PARTS_DECODED) return undefined;
  const partOff = ESX1_DRUM_PART_OFFSET + partIndex * ESX1_PART_STRIDE;
  if (partOff + ESX1_PART_STRIDE > raw.length) return undefined;

  // sample-id BE u16
  const sidRaw = (raw[partOff] << 8) | raw[partOff + 1];
  // 0x8000 = unassigned. Lower 9 bits cover 0..511 valid slot range
  // (ESX-1: 256 mono + 128 stereo = 384 max).
  const sampleId = sidRaw === ESX1_SAMPLEID_UNASSIGNED ? 0 : (sidRaw & 0x01ff);

  // Pitch @ +8 (signed i8 around 0x40 = neutral)  — v3.20.0
  const pitch = decodePitchByte(raw[partOff + 8] ?? ESX1_PITCH_NEUTRAL_RAW);

  // Level + Pan
  const volume = Math.max(0, Math.min(127, raw[partOff + 9] || 100));
  const pan = Math.max(0, Math.min(127, raw[partOff + 10] || 64));

  // FxSend @ +11 (u8, 0..127)  — v3.20.0
  const fxAmount = Math.max(0, Math.min(127, raw[partOff + 11] ?? 0));

  // 16 step-bytes
  const stepsOff = partOff + ESX1_PART_HEADER_BYTES;
  const steps: EsxStepEvent[] = new Array(ESX1_DEFAULT_STEPS);
  for (let s = 0; s < ESX1_DEFAULT_STEPS; s++) {
    const b = raw[stepsOff + s] || 0;
    steps[s] = decodeStepByte(b);
  }
  return { sampleId, volume, pan, pitch, fxAmount, steps };
}

/**
 * Decoded Stretch-Part (Part-Index 10) — 34B-Layout @ 0x25C, gleicher Stride
 * wie Drum-Parts. v3.20.0 NEU.
 */
function decodeStretchPart(raw: Uint8Array):
  | {
      sampleId: number;
      volume: number;
      pan: number;
      pitch: number;
      fxAmount: number;
      steps: EsxStepEvent[];
    }
  | undefined {
  const partOff = ESX1_STRETCH_PART_OFFSET;
  if (partOff + ESX1_PART_STRIDE > raw.length) return undefined;
  // Same shape as drum-part. Just reuse the layout interpretation.
  const sidRaw = (raw[partOff] << 8) | raw[partOff + 1];
  const sampleId = sidRaw === ESX1_SAMPLEID_UNASSIGNED ? 0 : (sidRaw & 0x01ff);
  const pitch = decodePitchByte(raw[partOff + 8] ?? ESX1_PITCH_NEUTRAL_RAW);
  const volume = Math.max(0, Math.min(127, raw[partOff + 9] || 100));
  const pan = Math.max(0, Math.min(127, raw[partOff + 10] || 64));
  const fxAmount = Math.max(0, Math.min(127, raw[partOff + 11] ?? 0));
  const stepsOff = partOff + ESX1_PART_HEADER_BYTES;
  const steps: EsxStepEvent[] = new Array(ESX1_DEFAULT_STEPS);
  for (let s = 0; s < ESX1_DEFAULT_STEPS; s++) {
    const b = raw[stepsOff + s] || 0;
    steps[s] = decodeStepByte(b);
  }
  return { sampleId, volume, pan, pitch, fxAmount, steps };
}

/**
 * Decoded Short-Part (Sample/Slice/Synth) — 32B-Layout (16B Header + 16B Steps).
 * v3.20.0 NEU. Index 0..3 maps to part-indices 11..14.
 */
function decodeShortPart(
  raw: Uint8Array,
  shortIndex: number,
):
  | {
      sampleId: number;
      volume: number;
      pan: number;
      pitch: number;
      fxAmount: number;
      steps: EsxStepEvent[];
    }
  | undefined {
  if (shortIndex < 0 || shortIndex >= ESX1_SHORT_PART_OFFSETS.length) return undefined;
  const partOff = ESX1_SHORT_PART_OFFSETS[shortIndex];
  const blockSize = ESX1_SHORT_PART_HEADER_BYTES + ESX1_SHORT_PART_STEPS_BYTES;
  if (partOff + blockSize > raw.length) return undefined;
  // Header layout (verified BOTTROP[1] @0x36E):
  //   +0..+1 = sample-id BE u16
  //   +6     = pitch (i8, 0x40 neutral)
  //   +7     = level (u8 0..127)
  //   +8     = pan (u8 0..127, 0x40 center)
  //   +10    = fxSend (u8 0..127)
  const sidRaw = (raw[partOff] << 8) | raw[partOff + 1];
  const sampleId = sidRaw === ESX1_SAMPLEID_UNASSIGNED ? 0 : (sidRaw & 0x01ff);
  const pitch = decodePitchByte(raw[partOff + 6] ?? ESX1_PITCH_NEUTRAL_RAW);
  const volume = Math.max(0, Math.min(127, raw[partOff + 7] || 100));
  const pan = Math.max(0, Math.min(127, raw[partOff + 8] || 64));
  const fxAmount = Math.max(0, Math.min(127, raw[partOff + 10] ?? 0));
  const stepsOff = partOff + ESX1_SHORT_PART_HEADER_BYTES;
  const steps: EsxStepEvent[] = new Array(ESX1_DEFAULT_STEPS);
  for (let s = 0; s < ESX1_DEFAULT_STEPS; s++) {
    const b = raw[stepsOff + s] || 0;
    steps[s] = decodeStepByte(b);
  }
  return { sampleId, volume, pan, pitch, fxAmount, steps };
}

/**
 * Parst ein einzelnes Pattern aus dem 4280-Byte-Block.
 *
 * @param raw          Der 4280-Byte Pattern-Block (NICHT der ganze File-Buffer).
 * @param patternIndex 0..255 — der Pattern-Slot-Index.
 * @returns Geparstes Pattern oder null wenn der Block leer ist.
 *
 * Verifizierte Felder (gegen reale .esx-Files am 2026-05-18):
 *   Offset 0..7  : 8-byte ASCII name (space/NUL-padded)
 *   Offset 8..9  : BE u16 = BPM × 128
 *   Offset 13    : step-length-1 (init=0x0F → 16 Steps)
 *
 * v3.14.0: Drum-Parts 0..9 (Drum 1..10) decoded:
 *   - sampleId, volume, pan aus 34-byte Part-Header
 *   - 16 steps mit trigger-active (bit 0)
 *   Beweis: BOTTROP[0] Part 5 dekodiert zu 4-on-the-floor Kick (1,5,9,13).
 *
 * v3.20.0 NEU:
 *   - Pitch (Drum-Part +8 signed i8, neutral 0x40 = 0 semitones)
 *   - FxSend (Drum-Part +11, u8 0..127)
 *   - Part 10 (Stretch): 34B-Header @ 0x25C — gleicher Layout wie Drum
 *   - Parts 11..14 (Sample/Slice/Synth): 32B-Stride (16B+16B) @
 *     0x36E, 0x38E, 0x3AE, 0x3CE
 *   - Part 15 (Audio-In): bleibt Defaults (in Real-Files keine Trigger)
 *
 * Best-Effort:
 *   Offset 12    : roll-type (init=0x00)
 *   Offset 15    : swing (init=0x3c)
 */
export function parseEsxPattern(
  raw: Uint8Array,
  patternIndex: number,
): EsxPattern | null {
  if (raw.length !== ESX1_CHUNKSIZE_PATTERN) {
    throw new EsxParseError(
      `parseEsxPattern: erwarte ${ESX1_CHUNKSIZE_PATTERN} bytes, bekam ${raw.length}`,
    );
  }
  if (isEmptyEsxPattern(raw)) return null;

  const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const name = decodeEsxName(raw.subarray(0, 8));

  // BPM: BE u16 / 128, geklemmt auf 20..300
  const bpmRaw = dv.getUint16(8, false);
  let bpm = bpmRaw / 128;
  if (!Number.isFinite(bpm) || bpm < 20) bpm = 20;
  if (bpm > 300) bpm = 300;

  // Step-length-Indikator: byte 13. init=0x0F → 16 Steps (0-based count).
  // Wir klamern auf 1..64 als Hardware-plausibles Maximum.
  const stepIndicator = raw[13];
  let lengthSteps = (stepIndicator & 0x7f) + 1;
  if (!Number.isFinite(lengthSteps) || lengthSteps < 1) lengthSteps = ESX1_DEFAULT_STEPS;
  if (lengthSteps > 64) lengthSteps = ESX1_DEFAULT_STEPS;

  // Swing: byte 15, Best-Effort, geklemmt 0..100.
  let swing = raw[15] & 0x7f;
  if (swing > 100) swing = 100;

  // Build 16 Parts. v3.20.0:
  //   parts 0..9   → decodeDrumPart  (34B-Stride @ 0x18 + i*34)
  //   part 10      → decodeStretchPart (34B-Stride @ 0x25C)
  //   parts 11..14 → decodeShortPart  (32B-Stride @ 0x36E, 0x38E, 0x3AE, 0x3CE)
  //   part 15      → Defaults (Audio-In is unused in real-files)
  const parts: EsxPart[] = new Array(ESX1_PARTS_PER_PATTERN);
  for (let p = 0; p < ESX1_PARTS_PER_PATTERN; p++) {
    let decoded:
      | {
          sampleId: number;
          volume: number;
          pan: number;
          pitch: number;
          fxAmount: number;
          steps: EsxStepEvent[];
        }
      | undefined;
    if (p < ESX1_DRUM_PARTS_DECODED) {
      decoded = decodeDrumPart(raw, p);
    } else if (p === 10) {
      decoded = decodeStretchPart(raw);
    } else if (p >= 11 && p <= 14) {
      decoded = decodeShortPart(raw, p - 11);
    }
    if (decoded) {
      parts[p] = {
        partIndex: p,
        sampleId: decoded.sampleId,
        volume: decoded.volume,
        pan: decoded.pan,
        pitch: decoded.pitch,
        fxAmount: decoded.fxAmount,
        steps: decoded.steps,
      };
    } else {
      const steps: EsxStepEvent[] = new Array(ESX1_DEFAULT_STEPS);
      for (let s = 0; s < ESX1_DEFAULT_STEPS; s++) {
        steps[s] = { active: false, velocity: 0 };
      }
      parts[p] = {
        partIndex: p,
        sampleId: 0,
        volume: 100,
        pan: 64,
        pitch: 0,
        fxAmount: 0,
        steps,
      };
    }
  }

  return {
    index: patternIndex,
    name,
    bpm,
    lengthSteps,
    swing,
    parts,
    raw,
  };
}

/** Reads PCM-Bytes from the absolute payload region with defense in depth. */
function readPcmRange(
  buf: Uint8Array,
  relStart: number,
  relEnd: number,
  slotIndex: number,
  channelLabel: string,
): Uint8Array {
  const absStart = ESX1_ADDR_SAMPLE_DATA + relStart;
  const absEnd = ESX1_ADDR_SAMPLE_DATA + relEnd;
  if (absStart > buf.length || absEnd > buf.length) {
    throw new EsxParseError(
      `slot ${slotIndex} (${channelLabel}): PCM range 0x${absStart.toString(16)}..0x${absEnd.toString(16)} escapes file (size 0x${buf.length.toString(16)})`,
    );
  }
  const length = relEnd - relStart;
  if (length > MAX_BYTES_PER_SLOT) {
    throw new EsxParseError(
      `slot ${slotIndex} (${channelLabel}): pcm length ${length} bytes exceeds per-slot cap ${MAX_BYTES_PER_SLOT}`,
    );
  }
  return buf.subarray(absStart, absEnd);
}

// ─── Song-Block-Helpers (v3.89.0) ────────────────────────────────────────────

/**
 * Init-Signatur eines leeren ESX-1 Song-Slots (528 Bytes).
 *
 * Reverse-Engineering 2026-05-19: Konfiguration ueber 38 .esx-Files:
 *   - First 8 bytes:  0x20 0x20 0x20 0x20 0x20 0x20 0x20 0x20   (8 spaces)
 *   - Offset 8:       0x3c                                       (BPM-Hint = 60)
 *   - Offset 9..527:  all 0x00
 *
 * 32 von 64 Songs in KASSEL.esx zeigen exakt dieses Pattern. Sobald
 * Bytes davon abweichen, ist der Slot nicht-leer.
 */
const ESX1_SONG_INIT_NAME = 0x20;
const ESX1_SONG_INIT_BPM_BYTE = 0x3c; // 60

/** End-of-song-Marker im trailing data-field eines song-events. */
export const ESX1_SONG_EVENT_END_MARKER = 0xffff;

/** Hardening-Cap: max events pro Song (defense gegen aufgeblaehte Files). */
const ESX1_MAX_EVENTS_PER_SONG = 4096;

/** Hardening-Cap: max total events in der globalen Event-Region. */
const ESX1_MAX_TOTAL_EVENTS = 64 * ESX1_MAX_EVENTS_PER_SONG;

/**
 * v3.90.0: Hard-stop fuer Events ohne end-marker.
 *
 * Real-Files koennen mal aus Versehen ohne 0xFFFF-Terminator enden (corrupt
 * oder partial-write). Damit der Loop nicht alle 262144 Frames bis zum
 * absoluten Cap weiterlaeuft, brechen wir nach 1000 non-terminator-Events
 * vorzeitig ab und fuegen ein warning hinzu.
 */
const ESX1_MAX_ITERATIONS_NO_END = 1000;

/**
 * v3.90.0: Init-Length-Marker — 0xF7 in length-field bedeutet
 * "uninitialized" (kein gueltiger Repeat-Count). Solche Events werden
 * im Parser uebersprungen.
 */
const ESX1_SONG_EVENT_LENGTH_INIT = 0xf7;

/**
 * Pruefft ob ein 528B Song-Block ein "init"/leeres Song-Slot ist.
 *
 * Heuristik (zwei Wege):
 *   A) Bytes 0..7 sind alle 0x20 (Space) UND bytes 8..527 matchen
 *      die init-Signatur (0x3c, dann 519x 0x00).
 *   B) Erste 16 Bytes sind alle 0x00 (synthetisch/unwritten).
 *
 * Beide Wege haben False-Negative-Sicherheit: ein User-Song hat in
 * mindestens einem Byte abweichende Werte. Real-File-Verifikation gegen
 * KASSEL.esx (Song[0..30] alle empty, Song[31+] alle non-empty).
 */
export function isEmptyEsxSong(raw: Uint8Array): boolean {
  if (raw.length < 16) return true;
  // Weg B: All-Zero (synthetisch)
  let allZero = true;
  for (let i = 0; i < 16 && i < raw.length; i++) {
    if (raw[i] !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) return true;
  // Weg A: Init-Signature
  // Bytes 0..7 = 0x20
  for (let i = 0; i < 8; i++) {
    if (raw[i] !== ESX1_SONG_INIT_NAME) return false;
  }
  // Byte 8 = 0x3c
  if (raw[8] !== ESX1_SONG_INIT_BPM_BYTE) return false;
  // Bytes 9..527 = 0x00
  const limit = Math.min(raw.length, ESX1_CHUNKSIZE_SONG);
  for (let i = 9; i < limit; i++) {
    if (raw[i] !== 0x00) return false;
  }
  return true;
}

/**
 * Parst ein einzelnes 528B Song-Slot zu einem {@link EsxSong} oder null
 * wenn der Slot leer ist.
 *
 * @param raw        Die 528 Bytes des Song-Blocks (NICHT der ganze File-Buffer).
 * @param songIndex  0..63 — Song-Slot-Index.
 * @param events     Optional die bereits dem Song zugeordneten Events
 *                   (extrahiert aus der globalen Event-Region 0x138400+).
 *
 * Verifizierte Felder:
 *   - Offset 0..7  : 8-byte ASCII name (space/NUL-padded). Empty-Slot → ''.
 *   - Offset 8     : u8 BPM-Hint (init=0x3c=60).
 *
 * Best-Effort:
 *   - Restliche 519 Bytes sind nicht final reverse-engineered und werden
 *     im `raw`-Feld zur weiteren Analyse erhalten.
 *
 * @returns EsxSong oder null wenn empty.
 */
export function parseEsxSong(
  raw: Uint8Array,
  songIndex: number,
  events: EsxSongEvent[] = [],
): EsxSong | null {
  if (raw.length !== ESX1_CHUNKSIZE_SONG) {
    throw new EsxParseError(
      `parseEsxSong: erwarte ${ESX1_CHUNKSIZE_SONG} bytes, bekam ${raw.length}`,
    );
  }
  if (isEmptyEsxSong(raw)) return null;

  const name = decodeEsxName(raw.subarray(0, 8));
  const bpmByte = raw[8] ?? ESX1_SONG_INIT_BPM_BYTE;
  // Defensive: BPM-Hint in plausibles Hardware-Fenster (20..300).
  let bpm = bpmByte;
  if (!Number.isFinite(bpm) || bpm < 20) bpm = 20;
  if (bpm > 300) bpm = 300;

  // Cap events to defensive limit.
  const cappedEvents = events.slice(0, ESX1_MAX_EVENTS_PER_SONG);

  return {
    index: songIndex,
    name,
    bpm,
    eventCount: cappedEvents.length,
    events: cappedEvents,
    raw,
  };
}

/**
 * Parst die globale Song-Event-Region (0x138400+) zu Event-Frames pro Song.
 *
 * Format pro Event (8 Bytes, BE):
 *   +0..+1 = time (BE u16)
 *   +2     = pattern (u8)
 *   +3     = length (u8)
 *   +4..+5 = flags (BE u16)
 *   +6..+7 = data (BE u16; 0xFFFF = end-of-song marker)
 *
 * Pro Song werden Events bis zum ersten 0xFFFF-Marker gesammelt
 * (exklusive Marker selbst). Bei Region-Truncate werden warning-Hinweise
 * generiert und nur die intakten Events zurueckgegeben.
 *
 * @returns Tuple [eventsPerSong, warnings]: eventsPerSong[i] = Events fuer Song i.
 */
export function parseEsxSongEvents(
  buf: Uint8Array,
  numSongs: number = ESX1_NUM_SONGS,
): { eventsPerSong: EsxSongEvent[][]; warnings: string[] } {
  const eventsPerSong: EsxSongEvent[][] = new Array(numSongs);
  for (let i = 0; i < numSongs; i++) eventsPerSong[i] = [];
  const warnings: string[] = [];

  const start = ESX1_ADDR_SONG_EVENT_DATA;
  if (start >= buf.length) {
    warnings.push(
      `song-event region missing: file ${buf.length} < expected start 0x${start.toString(16)}`,
    );
    return { eventsPerSong, warnings };
  }

  // Defensive: Event-Region endet entweder bei ESX1_ADDR_VALID_CHECK_2 (0x1B0000)
  // oder am File-Ende, je nachdem was zuerst kommt.
  const end = Math.min(0x1b0000, buf.length);
  if (end <= start) {
    warnings.push(
      `song-event region empty: start 0x${start.toString(16)} >= end 0x${end.toString(16)}`,
    );
    return { eventsPerSong, warnings };
  }

  const maxBytes = end - start;
  const maxFrames = Math.min(
    Math.floor(maxBytes / ESX1_CHUNKSIZE_SONG_EVENT),
    ESX1_MAX_TOTAL_EVENTS,
  );

  let currentSong = 0;
  // v3.90.0: Hard-stop counter for runs without end-marker. Resets on
  // every 0xFFFF-terminator hit. If the counter exceeds the cap we break
  // out of the loop and warn — defends against corrupted files that have
  // 200,000+ non-terminator frames.
  let iterationsSinceLastEnd = 0;
  const dv = new DataView(buf.buffer, buf.byteOffset + start, maxFrames * ESX1_CHUNKSIZE_SONG_EVENT);
  for (let f = 0; f < maxFrames; f++) {
    const off = f * ESX1_CHUNKSIZE_SONG_EVENT;
    const time = dv.getUint16(off, false);
    const pattern = dv.getUint8(off + 2);
    const length = dv.getUint8(off + 3);
    const flags = dv.getUint16(off + 4, false);
    const data = dv.getUint16(off + 6, false);

    // Defensive: an all-zero frame indicates padding past the actual event-stream.
    // ESX-1 event-regions are typically 480KB+ and zero-padded after real events.
    // We stop reading at the first all-zero frame to avoid filling songs with
    // pseudo-events.
    if (time === 0 && pattern === 0 && length === 0 && flags === 0 && data === 0) {
      break;
    }

    const event: EsxSongEvent = { time, pattern, length, flags, data };

    if (data === ESX1_SONG_EVENT_END_MARKER) {
      // End-of-song-Marker: schliesse den aktuellen Song ab und gehe zum naechsten.
      if (currentSong < numSongs) {
        eventsPerSong[currentSong].push(event);
        currentSong++;
      }
      iterationsSinceLastEnd = 0; // reset hard-stop counter
      if (currentSong >= numSongs) break; // alle Songs gefuellt
      continue;
    }

    // v3.90.0: Hard-stop after N iterations without end-marker. Prevents
    // infinite-loop / runaway parsing on malformed data. We emit the warning
    // only when we've already seen at least one end-marker (i.e. we know the
    // file has real song-data and the runaway is suspect) — when the
    // event-region appears to be pure garbage (no end-marker yet), we just
    // break silently to avoid polluting warnings on files that don't use
    // the song-feature at all.
    iterationsSinceLastEnd++;
    if (iterationsSinceLastEnd > ESX1_MAX_ITERATIONS_NO_END) {
      if (currentSong > 0) {
        warnings.push(
          `song-event stream exceeded ${ESX1_MAX_ITERATIONS_NO_END} events without end-marker; aborting parse at frame ${f}`,
        );
      }
      break;
    }

    // v3.90.0: length=0xF7 means "uninitialized" — skip event so it doesn't
    // get assigned a bogus repeat-count downstream. Real ESX-1 files use
    // 0x01..0x10 (1..16 repeats) for actual song-arrangement entries.
    if (length === ESX1_SONG_EVENT_LENGTH_INIT) {
      continue;
    }

    if (currentSong < numSongs) {
      const arr = eventsPerSong[currentSong];
      if (arr.length < ESX1_MAX_EVENTS_PER_SONG) {
        arr.push(event);
      }
    }
  }

  return { eventsPerSong, warnings };
}

/**
 * Parst alle 64 Song-Slots ab 0x130000 zu einem {@link EsxSong}-Array.
 *
 * Leere Init-Slots werden NICHT in das Output-Array aufgenommen. Bei
 * truncierten Files werden warnings generiert und nur die intakten
 * Slots zurueckgegeben.
 *
 * @returns Tuple [songs, warnings].
 */
export function parseEsxSongs(
  buf: Uint8Array,
): { songs: EsxSong[]; warnings: string[] } {
  const warnings: string[] = [];
  const songs: EsxSong[] = [];

  const songsStart = ESX1_ADDR_SONG_DATA;
  const songsEnd = songsStart + ESX1_NUM_SONGS * ESX1_CHUNKSIZE_SONG;
  if (songsStart >= buf.length) {
    warnings.push(
      `song area missing: file ${buf.length} < expected start 0x${songsStart.toString(16)}`,
    );
    return { songs, warnings };
  }
  if (songsEnd > buf.length) {
    warnings.push(
      `song area truncated: file ${buf.length} < required end ${songsEnd}`,
    );
  }

  // Parse events first so we can attach them per-song.
  const { eventsPerSong, warnings: evtWarnings } = parseEsxSongEvents(buf);
  warnings.push(...evtWarnings);

  const usableEnd = Math.min(songsEnd, buf.length);
  for (let i = 0; i < ESX1_NUM_SONGS; i++) {
    const off = songsStart + i * ESX1_CHUNKSIZE_SONG;
    if (off + ESX1_CHUNKSIZE_SONG > usableEnd) break;
    try {
      const block = buf.subarray(off, off + ESX1_CHUNKSIZE_SONG);
      const song = parseEsxSong(block, i, eventsPerSong[i] ?? []);
      if (song !== null) songs.push(song);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`song ${i}: ${msg}`);
    }
  }

  return { songs, warnings };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Parst eine ESX-1 .esx Datei aus einem ArrayBuffer/Uint8Array.
 *
 * @throws {EsxParseError} bei kaputten Magic-Bytes, ungültiger Größe oder
 *   wenn ein Sample-Slot über die Datei hinaus zeigt.
 *
 * Soft-Errors (z.B. Slot mit invertiertem Offset) führen NICHT zum Abbruch,
 * sondern landen in {@link EsxBank.warnings}.
 */
export function parseEsxBank(
  input: ArrayBuffer | Uint8Array,
  source = "<bytes>",
): EsxBank {
  const buf =
    input instanceof Uint8Array
      ? input
      : new Uint8Array(input);

  // ── 1. Size-Checks ────────────────────────────────────────────────────────
  if (buf.length < ESX1_SIZE_FILE_MIN) {
    throw new EsxParseError(
      `file too small to be a valid .esx: ${buf.length} bytes (need >= ${ESX1_SIZE_FILE_MIN})`,
    );
  }
  if (buf.length > ESX_FILE_MAX_BYTES) {
    throw new EsxParseError(
      `file size ${buf.length} exceeds max ${ESX_FILE_MAX_BYTES}`,
    );
  }

  // ── 2. Magic-Check ─────────────────────────────────────────────────────────
  // v3.90.0: Variant-Header Tolerance. Some user files start with non-'KORG'
  // magic (e.g. 'OoQC' — observed in real user-uploads). These are NOT
  // ESX-1 backups but variant Korg containers we cannot parse. Instead
  // of throwing (which crashes batch-import workflows), return an empty
  // bank with a warning so the caller can keep processing siblings.
  const sig = safeSlice(buf, 0, 4);
  if (!bytesEqual(sig, ESX1_SIGNATURE)) {
    const sigHex = Array.from(sig)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    const sigAscii = Array.from(sig)
      .map((b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : "?"))
      .join("");
    return {
      source,
      monoSamples: [],
      stereoSamples: [],
      patterns: [],
      songs: [],
      declaredMonoCount: 0,
      declaredStereoCount: 0,
      warnings: [
        `unsupported variant header: expected 'KORG', got '${sigAscii}' (${sigHex}); returning empty bank`,
      ],
    };
  }
  const submagic = safeSlice(buf, ESX1_SUBMAGIC_OFFSET, 4);
  if (!bytesEqual(submagic, ESX1_SUBMAGIC)) {
    const subHex = Array.from(submagic)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    return {
      source,
      monoSamples: [],
      stereoSamples: [],
      patterns: [],
      songs: [],
      declaredMonoCount: 0,
      declaredStereoCount: 0,
      warnings: [
        `unsupported sub-format at offset 0x${ESX1_SUBMAGIC_OFFSET.toString(16)}: expected 'ESX\\0', got '${subHex}'; returning empty bank`,
      ],
    };
  }

  // ── 3. Second magic at 0x001B0000 ─────────────────────────────────────────
  if (buf.length < ESX1_ADDR_VALID_CHECK_2 + 4) {
    throw new EsxParseError(
      `file size ${buf.length} < expected sample-directory offset 0x${ESX1_ADDR_VALID_CHECK_2.toString(16)}`,
    );
  }
  const check2 = safeSlice(buf, ESX1_ADDR_VALID_CHECK_2, 4);
  if (!bytesEqual(check2, ESX1_SIGNATURE)) {
    throw new EsxParseError(
      `Invalid second magic at offset 0x${ESX1_ADDR_VALID_CHECK_2.toString(16)}: expected 'KORG'`,
    );
  }

  // ── 4. Sample-Counters ────────────────────────────────────────────────────
  const countDv = new DataView(
    buf.buffer,
    buf.byteOffset + ESX1_ADDR_NUM_MONO_SAMPLES,
    12,
  );
  const numMono = countDv.getUint32(0, false);
  const numStereo = countDv.getUint32(4, false);
  // const currentOffset = countDv.getUint32(8, false); // free-pointer, info-only

  if (numMono > ESX1_MAX_MONO_SLOTS || numStereo > ESX1_MAX_STEREO_SLOTS) {
    throw new EsxParseError(
      `declared sample counts out of range: mono=${numMono} (cap ${ESX1_MAX_MONO_SLOTS}), stereo=${numStereo} (cap ${ESX1_MAX_STEREO_SLOTS})`,
    );
  }

  const warnings: string[] = [];
  const monoSamples: EsxSample[] = [];
  const stereoSamples: EsxSample[] = [];
  let totalPcm = 0;
  // v3.90.0: Only emit one PCM-cap-tolerance warning per parse to avoid
  // spamming the warnings array with one entry per slot above the cap.
  let pcmCapWarned = false;

  // ── 5. Mono-Header Parse ──────────────────────────────────────────────────
  const monoTableStart = ESX1_ADDR_SAMPLE_HEADER_MONO;
  for (let i = 0; i < ESX1_MAX_MONO_SLOTS; i++) {
    try {
      const headerOff = monoTableStart + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO;
      const body = safeSlice(buf, headerOff, ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO);
      const name = decodeEsxName(body.subarray(0, 8));
      const f = readMonoHeaderFields(body);
      if (
        f.off1Start === ESX1_EMPTY_OFFSET ||
        f.off1End === ESX1_EMPTY_OFFSET
      ) {
        continue; // empty slot
      }
      if (f.off1End <= f.off1Start) {
        warnings.push(
          `mono slot ${i}: offsetEnd (${f.off1End}) <= offsetStart (${f.off1Start}); skipped`,
        );
        continue;
      }

      const pcmBytes = readPcmRange(buf, f.off1Start, f.off1End, i, "mono");
      const pcm = be16PcmToFloat32(pcmBytes);
      totalPcm += pcmBytes.length;
      // v3.90.0: Defensive tolerance — KASSEL.esx and friends overflow the
      // 24 MiB hardware cap by a few hundred bytes (real-file-padding /
      // rounding). Only throw above the soft-limit (~25 MiB); between
      // cap and soft-limit, emit a single warning per parse + continue.
      if (totalPcm > ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES) {
        throw new EsxParseError(
          `cumulative PCM size ${totalPcm} exceeds ESX-1 soft-limit ${ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES}`,
        );
      }
      if (totalPcm > ESX1_MAX_SAMPLE_MEM_IN_BYTES && !pcmCapWarned) {
        warnings.push(
          `cumulative PCM size ${totalPcm} exceeds ESX-1 hardware cap ${ESX1_MAX_SAMPLE_MEM_IN_BYTES} (within ${ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES} soft-limit, continuing)`,
        );
        pcmCapWarned = true;
      }

      const frames = pcm.length;
      monoSamples.push({
        index: i,
        name,
        channels: 1,
        sampleRate: f.sampleRate > 0 ? f.sampleRate : 44_100,
        frames,
        pcmData: pcm,
        loopStart: Math.max(0, Math.min(f.loopStart, frames)),
        loopEnd: Math.max(0, Math.min(f.end, frames)),
        level: Math.max(0, Math.min(127, f.playLevel || 100)),
      });
    } catch (err) {
      if (err instanceof EsxParseError && err.message.includes("escapes file")) {
        // Defensive: hostile slot, skip + warn (other slots may still be valid)
        warnings.push(`mono slot ${i}: ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  // ── 6. Stereo-Header Parse ────────────────────────────────────────────────
  const stereoTableStart = ESX1_ADDR_SAMPLE_HEADER_STEREO;
  for (let i = 0; i < ESX1_MAX_STEREO_SLOTS; i++) {
    try {
      const headerOff = stereoTableStart + i * ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO;
      const body = safeSlice(buf, headerOff, ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO);
      const name = decodeEsxName(body.subarray(0, 8));
      const f = readStereoHeaderFields(body);
      if (
        f.off1Start === ESX1_EMPTY_OFFSET ||
        f.off1End === ESX1_EMPTY_OFFSET ||
        f.off2Start === ESX1_EMPTY_OFFSET ||
        f.off2End === ESX1_EMPTY_OFFSET
      ) {
        continue;
      }
      if (f.off1End <= f.off1Start || f.off2End <= f.off2Start) {
        warnings.push(
          `stereo slot ${i}: zero-or-inverted offset range; skipped`,
        );
        continue;
      }
      if (f.off1End - f.off1Start !== f.off2End - f.off2Start) {
        warnings.push(
          `stereo slot ${i}: channel lengths differ; skipped`,
        );
        continue;
      }

      const slotIndex = ESX1_MAX_MONO_SLOTS + i;
      const leftBytes = readPcmRange(buf, f.off1Start, f.off1End, slotIndex, "stereo-L");
      const rightBytes = readPcmRange(buf, f.off2Start, f.off2End, slotIndex, "stereo-R");
      const left = be16PcmToFloat32(leftBytes);
      const right = be16PcmToFloat32(rightBytes);
      const frames = Math.min(left.length, right.length);
      const inter = new Float32Array(frames * 2);
      for (let k = 0; k < frames; k++) {
        inter[k * 2] = left[k];
        inter[k * 2 + 1] = right[k];
      }
      totalPcm += leftBytes.length + rightBytes.length;
      // v3.90.0: Same soft-limit/warning logic as mono path.
      if (totalPcm > ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES) {
        throw new EsxParseError(
          `cumulative PCM size ${totalPcm} exceeds ESX-1 soft-limit ${ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES}`,
        );
      }
      if (totalPcm > ESX1_MAX_SAMPLE_MEM_IN_BYTES && !pcmCapWarned) {
        warnings.push(
          `cumulative PCM size ${totalPcm} exceeds ESX-1 hardware cap ${ESX1_MAX_SAMPLE_MEM_IN_BYTES} (within ${ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES} soft-limit, continuing)`,
        );
        pcmCapWarned = true;
      }

      stereoSamples.push({
        index: slotIndex,
        name,
        channels: 2,
        sampleRate: f.sampleRate > 0 ? f.sampleRate : 44_100,
        frames,
        pcmData: inter,
        loopStart: 0,
        loopEnd: Math.max(0, Math.min(f.end, frames)),
        level: Math.max(0, Math.min(127, f.playLevel || 100)),
      });
    } catch (err) {
      if (err instanceof EsxParseError && err.message.includes("escapes file")) {
        warnings.push(`stereo slot ${i}: ${err.message}`);
        continue;
      }
      throw err;
    }
  }

  // ── 7. Patterns parsen (v3.5) ──────────────────────────────────────────────
  // 256 Patterns × 4280B ab Offset 0x0200. Leere Patterns werden geskippt
  // (return null aus parseEsxPattern); der Buffer muss aber gross genug sein
  // damit der Pattern-Bereich (max 256×4280 = 1,095,680 B = 0x10B100 endend
  // bei 0x10B300) drinsteckt.
  const patterns: EsxPattern[] = [];
  const patternsEnd =
    ESX1_ADDR_PATTERN_DATA + ESX1_NUM_PATTERNS * ESX1_CHUNKSIZE_PATTERN;
  const haveAllPatterns = patternsEnd <= buf.length;
  if (!haveAllPatterns) {
    warnings.push(
      `pattern area truncated: file ${buf.length} < required end ${patternsEnd}`,
    );
  }
  const usablePatternsEnd = Math.min(patternsEnd, buf.length);
  for (let i = 0; i < ESX1_NUM_PATTERNS; i++) {
    const off = ESX1_ADDR_PATTERN_DATA + i * ESX1_CHUNKSIZE_PATTERN;
    if (off + ESX1_CHUNKSIZE_PATTERN > usablePatternsEnd) break;
    try {
      const block = buf.subarray(off, off + ESX1_CHUNKSIZE_PATTERN);
      const pat = parseEsxPattern(block, i);
      if (pat !== null) patterns.push(pat);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`pattern ${i}: ${msg}`);
    }
  }

  // ── 8. Songs parsen (v3.89.0) ──────────────────────────────────────────────
  // 64 Songs × 528B ab 0x130000, plus Event-Region ab 0x138400.
  // Leere Init-Slots werden geskippt; truncated regions liefern warnings.
  const { songs, warnings: songWarnings } = parseEsxSongs(buf);
  warnings.push(...songWarnings);

  return {
    source,
    monoSamples,
    stereoSamples,
    patterns,
    songs,
    declaredMonoCount: numMono,
    declaredStereoCount: numStereo,
    warnings,
  };
}

/** Convenience: type-guard ohne Parse-Aufwand. Schnelle Magic-only-Prüfung. */
export function isEsxBuffer(input: ArrayBuffer | Uint8Array): boolean {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (buf.length < ESX1_SUBMAGIC_OFFSET + 4) return false;
  if (!bytesEqual(buf.subarray(0, 4), ESX1_SIGNATURE)) return false;
  if (!bytesEqual(buf.subarray(ESX1_SUBMAGIC_OFFSET, ESX1_SUBMAGIC_OFFSET + 4), ESX1_SUBMAGIC)) return false;
  return true;
}

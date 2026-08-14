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
import { writePartParamsToBody } from "./partParams";

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
// ✔ Am Geraet bestaetigt (2026-08-14): Tempo von 120 auf 135 geaendert — im
// gesamten 2-KB-Pattern-Kopf bewegten sich GENAU diese zwei Bytes
// (176,4 -> 70,5 = LE 1200 -> 1350). Der Global-Block blieb unveraendert,
// Tempo gehoert also zum Pattern.
const BPM_OFF = 0x22;

// ─── Weitere Pattern-Kopf-Felder, am Geraet bestaetigt ───────────────────────
//
// Aus derselben Messreihe. Alle drei speichern 0-basiert, waehrend das Geraet
// 1-basiert anzeigt — dieselbe Verschiebung wie bei modType und grooveType.
//
//   +0x27  Key        G# eingestellt -> 8   (Halbton ab C: C=0 … G#=8)
//   +0x28  Scale      70 angezeigt   -> 69
//   +0x3D  MFX-Typ    32 angezeigt   -> 31  (Tube Drive)
//
// TekkForge schreibt diese Felder derzeit NICHT — sie sind hier nur
// dokumentiert, damit die naechste Erweiterung nicht wieder suchen muss.
export const PATTERN_KEY_OFF = 0x27;

/**
 * Last Step eines Parts — **pro Part**, nicht pattern-weit.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14). Eingestellt wurden Parts 9-16 auf
 * 14/16/2/5/7/9/13/15, gelesen wurde bei Part-Offset 0x00:
 *
 *     0 0 0 0 0 0 0 0  14  0  2  5  7  9  13  15
 *
 * Sieben der acht Werte stimmen exakt. Der achte ist der interessante: Part 10
 * war auf **16** gestellt und steht als **0** im Speicher.
 *
 * ⇒ Gespeichert wird `Anzeige mod 16`. Die 16 ist die 0. Dazu passt die
 * Bedienung: am Geraet schlaegt der Wert von 1 nach unten auf 16 um.
 *
 * ### Das widerlegt einen Schluss in der Omnitribe-Doku
 *
 * `docs/hwtest/sitzung_2026-08-10.md` liest dort ueber alle 16 Parts eine 0 und
 * folgert: „LastStep 0 bei 64 Steps ist Unsinn ⇒ der RAM-Block hat am Part-Kopf
 * ein anderes Layout als der Sysex-Body."
 *
 * Das Layout ist NICHT anders. Die 0 war kein Widerspruch, sondern der
 * Normalfall: alle Parts standen auf 16 Steps. Der Fehler lag in der Annahme,
 * ein Feld muesse seinen Anzeigewert speichern — hier ist die Obergrenze auf
 * die Null abgebildet.
 */
export const PART_LAST_STEP_OFF = 0x00;

/**
 * Chain-Einstellungen — im Schwanz HINTER dem Part-Block.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14). Chain To 4 -> 6 und Chain Repeat
 * 11 -> 64 (Maximum) geaendert; im gesamten 16-KB-PTST bewegten sich genau
 * diese zwei Bytes:
 *
 *     +0x3B00  4 -> 6     Chain To
 *     +0x3B02  11 -> 64   Chain Repeat
 *
 * `0x3B00` ist das erste Byte hinter den Parts (`0x800 + 16 * 816`). Damit ist
 * der PTST-Aufbau komplett:
 *
 * ```
 * 0x0000 … 0x07FF   Pattern-Kopf (BPM, Key, Scale, MFX-Typ …)
 * 0x0800 … 0x3AFF   16 Part-Bloecke a 816 B
 * 0x3B00 … 0x3FFF   Schwanz — hier stehen die Chain-Werte
 * ```
 *
 * ### Dritte Kodierungsregel
 *
 * Beide Felder speichern den **Anzeigewert direkt**: die 64 steht als 64, nicht
 * als 0. Damit sind in diesem Format drei verschiedene Konventionen belegt:
 *
 * | Regel                  | Felder                                        |
 * |------------------------|-----------------------------------------------|
 * | 0-basiert (Anzeige −1) | modType, grooveType, Key, Scale, MFX-Typ      |
 * | Modulo (16 → 0)        | Last Step                                     |
 * | direkt                 | Chain To, Chain Repeat                        |
 * | invertiert (127 − x)   | Pattern-Level                                 |
 * | signed, direkt         | Swing, egInt, oscPitch                        |
 *
 * Eine 0 in diesem Format kann also „aus", „erster Eintrag" ODER „Maximum"
 * bedeuten. Wer ein neues Feld deutet, muss die Regel mitmessen — sie laesst
 * sich nicht aus dem Wert allein ablesen.
 */
/**
 * Pattern-Level — als **Daempfung** gespeichert, nicht als Pegel.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14) mit einer Einzeländerung: Level 101 -> 103.
 * Im gesamten Pattern-Kopf bewegte sich GENAU EIN Byte, und zwar gegenlaeufig:
 *
 *     Level 101  ->  +0x2A = 26      101 + 26 = 127
 *     Level 103  ->  +0x2A = 24      103 + 24 = 127
 *
 * ⇒ `Byte = 127 - Level`. Die 0 ist volle Lautstaerke, 127 ist still.
 *
 * Das erklaert, warum die fruehere Suche nach der Zahl 101 im Kopf ins Leere
 * lief: der eingestellte Wert steht dort gar nicht. Wer ein Feld ueber seinen
 * Anzeigewert sucht, findet nur die Felder, die ihn auch speichern — und das
 * ist in diesem Format eher die Ausnahme.
 *
 * (Zwei Messpunkte legen die Gerade fest; Steigung -1 und Achsenabschnitt 127
 * sind damit belegt, nicht geraten.)
 */
/**
 * Swing — **pro Pattern**, vorzeichenbehaftet, direkt in Prozent.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14) mit einer Einzeländerung auf -45 %. Im
 * gesamten Pattern-Kopf bewegte sich genau ein Byte:
 *
 *     +0x24  48 -> 211     als i8:  +48 -> -45
 *
 * Der Bereich ist -50 … +50 %, gespeichert als signed byte ohne Umrechnung —
 * dieselbe Konvention wie `egInt` und `oscPitch` im Part-Block.
 *
 * (Swing ist NICHT pro Part, auch wenn das Geraet ihn im Part-Kontext anbietet.)
 */
/**
 * Beat (Aufloesung des Patterns) — pro Pattern, als Listenindex.
 *
 * ✔ Am Geraet bestaetigt (2026-08-14) mit einer Einzeländerung auf „32": im
 * gesamten Pattern-Kopf bewegte sich genau ein Byte, `+0x26` von 3 auf 1.
 *
 * Belegt ist damit die STELLE, aber erst ein Punkt der Werteliste:
 *
 *     Beat 32  ->  1
 *
 * Welche Einstellung die vorherige 3 war, ist nicht bekannt. Die Liste enthaelt
 * laut Geraet auch Triolen-Varianten („8 Tri", „16 Tri"). Wer sie vollstaendig
 * braucht, schaltet sie am Geraet der Reihe nach durch und liest jedes Mal
 * dieses eine Byte — mehr ist nicht noetig, die Adresse steht ja fest.
 */
export const PATTERN_BEAT_OFF = 0x26;

export const PATTERN_SWING_OFF = 0x24;

export const PATTERN_LEVEL_OFF = 0x2a;

export const PATTERN_CHAIN_TO_OFF = 0x3b00;
export const PATTERN_CHAIN_REPEAT_OFF = 0x3b02;
export const PATTERN_SCALE_OFF = 0x28;
export const PATTERN_MFX_TYPE_OFF = 0x3d;
const STEPLEN_OFF = 0x25;
const PARTS_OFF = 0x800;
const PART_STRIDE = 816; // 0x330
/** Per-part sample reference (u16 LE). Verified against 4000 real-bank parts:
 *  values span 1..~500 (factory sample numbers), 0 = no/empty sample.
 *  (The read-side parser historically guessed +0x04, which is almost always 0.) */
const PART_SAMPLE_OFF = 0x08;
// TekkForge-Korrektur (2026-07-19, verifiziert per Histogramm über die
// e2s-2016-Factory-Bank + elecmidi-C-Struct + Briefing §4.1):
//   +0x01 = Mute (0/1) · +0x18 = ampLevel (0..127, Top-Werte 127/85/100)
//   +0x19 = ampPan SIGNED (0 = Mitte, ±63; als Two's-Complement-Byte)
// Die früheren Offsets 0x15/0x22 waren EGDecay bzw. IFXEdit (deren Defaults
// 127 bzw. 64 die Histogramme täuschend ähnlich aussehen ließen).
const PART_MUTE_OFF = 0x01;
// ✔ Am Geraet bestaetigt (2026-08-14): Testpattern mit aufsteigendem Level
// ueber die Parts 1-10 las hier exakt 0 10 20 30 40 50 60 70 80 90, Parts
// 11-16 unberuehrt. Der Offset stammte bis dahin nur aus der Format-Doku.
const PART_VOLUME_OFF = 0x18;
const PART_PAN_OFF = 0x19;
const PART_STEPS_OFF = 0x30;
const STEP_RECORD_SIZE = 12;
const STEPS_PER_PART = 64;
const PARTS_PER_PATTERN = 16;

// step-record byte positions — TekkForge-Korrektur (2026-07-18), verifiziert
// per Byte-Histogramm gegen Factory-Files (BodyTalk1, Advi$ory1, e2s-2016) und
// die hardware-getesteten Hardtekk-Patterns: b1=Gate, b2=Velocity, b4=Note.
// (Vorher waren Note/Gate vertauscht: Note landete im Gate-Byte und der
// vermeintliche "GateLen"-Default 0x3d im Note-Byte — Melodien gingen verloren.)
const STEP_TRIGGER = 0;
const STEP_GATE = 1;
const STEP_VELOCITY = 2;
const STEP_FLAG = 3;
const STEP_NOTE = 4;

// step-record defaults (match the Init-181 template / observed real files)
const DEFAULT_GATE = 0x48; // 72 — häufigster Gate-Wert realer Files
const DEFAULT_VELOCITY = 0x60; // 96
const DEFAULT_NOTE = 0x3c; // C4 = 60 = Originaltonhöhe (Briefing §4.1 + Hardtekk)
const GATE_TIE = 0xff; // Factory-Sentinel für Tie/unendlich
const GATE_MAX = 96;

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
  // Basis: importierter/Geräte-Body (bewahrt Filter/Amp/IFX/Motion) oder das
  // Init-Template bei Neu-Patterns. Beide sind 0x4000 Bytes.
  const base =
    input.baseBody && input.baseBody.length === E2S_BODY_SIZE
      ? input.baseBody
      : b64ToBytes(E2S_INIT_BODY_B64);
  const body = Uint8Array.from(base); // frische 16384-Byte-Kopie
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
      // Editor-Pan 0..127 (64 = Mitte) → Geräte-Pan signed (0 = Mitte, ±63).
      const signed = clampInt(part.pan, 0, 127, 64) - 64;
      body[partStart + PART_PAN_OFF] = signed & 0xff;
    }
    // Mute @ +0x01 (0/1) — Editor-Mutes werden mit aufs Gerät übertragen.
    if (typeof part.muted === "boolean") {
      body[partStart + PART_MUTE_OFF] = part.muted ? 1 : 0;
    }
    // Per-part sample reference @ +0x08 (u16 LE). Only written when the caller
    // provides one (e.g. repointing parts to imported user samples at 501+);
    // otherwise the template's factory sample assignment is preserved.
    if (typeof part.sampleId === "number" && Number.isFinite(part.sampleId)) {
      view.setUint16(partStart + PART_SAMPLE_OFF, clampInt(part.sampleId, 0, 0xffff, 0), true);
    }
    // EXPERIMENTELL: Klangparameter (Filter/Amp/IFX…) an ihre Part-Offsets.
    if (part.params) writePartParamsToBody(body, p, part.params);

    const steps = Array.isArray(part.steps) ? part.steps : [];
    for (let s = 0; s < STEPS_PER_PART; s++) {
      const so = partStart + PART_STEPS_OFF + s * STEP_RECORD_SIZE;
      const step = steps[s];
      if (step && step.active) {
        body[so + STEP_TRIGGER] = 0x01;
        body[so + STEP_GATE] =
          step.gate === GATE_TIE ? GATE_TIE : clampInt(step.gate, 0, GATE_MAX, DEFAULT_GATE);
        body[so + STEP_VELOCITY] = clampInt(step.velocity, 0, 127, DEFAULT_VELOCITY);
        body[so + STEP_FLAG] = 0x01; // Factory-Konvention für aktive Steps
        body[so + STEP_NOTE] = clampInt(step.note, 0, 127, DEFAULT_NOTE);
      } else {
        // canonical inactive record — exakt wie Init-181: 00 48 60 00 00
        body[so + STEP_TRIGGER] = 0x00;
        body[so + STEP_GATE] = DEFAULT_GATE;
        body[so + STEP_VELOCITY] = DEFAULT_VELOCITY;
        body[so + STEP_FLAG] = 0x00;
        body[so + STEP_NOTE] = 0x00;
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

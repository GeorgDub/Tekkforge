/**
 * client/src/utils/electribeImport.ts
 *
 * TASK-237 / v2.88.0 — KORG Electribe 2 Pattern-Importer.
 * TASK-237-CALIBRATION / v3.2.0 — Format-Kalibrierung gegen ECHTE KORG E2 Sampler-Files
 *                                  (verified 2026-05-18, 4 reale .e2spat-Files).
 * v3.12.0 STEP-ENCODING-RE — Reverse-engineered step-record encoding via
 *                            byte-stride analysis (BodyTalk vs Init181 hex-diff).
 * v3.13.0 PART-HEADER + GLOBALS-RE — Per-Part Volume (+0x15), Pan (+0x22) und
 *                                    Pattern-Global StepLength (PTST+0x25)
 *                                    via histogram analysis ueber 250-Pattern
 *                                    Stock-Bank (4000 part-samples).
 * v3.15.0 MOTION-SEQUENCER-RE — Pattern-level Motion-Sequencer-Slots decoded
 *                               via scan ueber e2s-2016.e2sallpat Stock-Bank
 *                               (250 Patterns, 127 mit Motion-Daten = 50.8%,
 *                                248 enabled slots gesamt).
 *
 *   ── Motion-Table (PTST-relativ, 560 Bytes) ──────────────────────────
 *      PTST+0x100  8B   ParamID[8]      — 1 Byte pro Slot (1..17, 0=disabled)
 *      PTST+0x108  8B   Reserved        — alle bytes 0x00 ueber 250 Patterns
 *      PTST+0x110  8B   Reserved        — alle bytes 0x00 ueber 250 Patterns
 *      PTST+0x118  8B   TargetPart[8]   — 1 Byte pro Slot (Part-Index 1..19)
 *      PTST+0x120  16B  Reserved        — alle bytes 0x00 ueber 250 Patterns
 *      PTST+0x130  512B Slot-Data       — 8 Slots × 64 Bytes Werte (0..128)
 *
 *   Slot ist "enabled" wenn ParamID != 0. Werte 0..127 sind Standard,
 *   einzelne 0x80 (=128) werden beobachtet (vermutlich Header-Sentinel
 *   oder Sentinel-Wert "force max").
 *
 *   Identifizierte Param-IDs (Histogramm-Sorted, 17 unique values 1..17):
 *      0x11 (17): am haeufigsten (81 Slots) — heuristisch Volume oder Filter
 *      0x01 (1):  34× | 0x02 (2): 26× | 0x0d (13): 18× | 0x05 (5): 14×
 *      restliche 12 IDs jeweils 2..10× — keine Hardware-Spec public
 *
 *   Target-Part-Bytes 1..19 (= 16 Part-Indizes + evtl. globale 17..19).
 *
 *   Hypothesen-Confidence:
 *      HIGH:    Slot-Stride=64, Region@PTST+0x130, Slot-Count=8
 *      HIGH:    ParamID-Layout @ PTST+0x100 (8 Bytes)
 *      HIGH:    TargetPart-Layout @ PTST+0x118 (8 Bytes)
 *      MEDIUM:  Slot-Enabled-Semantik (paramId>0 vs data-nonzero —
 *               futureMonger1 hat paramId>0 aber data leer; Trials1 hat
 *               paramId=0 in Slot 1 aber Slot-Daten — beide selten)
 *      LOW:     Param-ID → konkreter Parameter-Name (kein Hardware-Doc)
 *
 * Unterstuetzte Endungen:
 *   - `.e2spat`      = Single-Pattern (Sampler-Export, 16640 Bytes)
 *   - `.e2pattern`   = Single-Pattern (User-Alias)
 *   - `.e2sallpat`   = "All-Pattern"-Bank (mehrere Patterns)
 *
 * ── REAL FILE LAYOUT (verified) ─────────────────────────────────────────
 *
 *   Offset  Size  Field
 *   ------  ----  -----
 *   0x000   16    Magic:   "KORG" + 12× 0x00
 *   0x010   16    ID:      "e2sampler" + 7× 0x00
 *   0x020   4     Version: u32 LE (0x00000001 in allen 4 verifizierten Files)
 *   0x024   220   Padding: 0xFF
 *   0x100   16    Pattern-Marker: "PTST" + 12× 0x00
 *   0x110   16    Pattern-Name:   ASCII (zero-padded, space-padded; trim trailing)
 *   0x120   2     Reserved (0x00 0x00 — beobachtet)
 *   0x122   2     BPM × 10 (u16 LE)  ← VERIFIED gegen 4 Files: 120/170/165/128 BPM
 *   0x124+  220   Pattern-Header-Felder (step-length, swing, length, ...)
 *                 Best-Effort: einige Bytes scheinen abhaengig vom Init-Status.
 *                 Aktuell parsen wir nur konservativ; siehe parseRealPatternHeader.
 *   0x200   1792  Reserviert (mostly 0x00)
 *   0x900   13056 16 Part-Bloecke × 816 Bytes (v3.12-VERIFIED stride)
 *                 Pro Part-Block:
 *                   +0x00..0x2F  48 Bytes Part-Header (Sample-Ref + Volume + Pan + Pitch + FX-Settings)
 *                   +0x30..0x32F 64 Steps × 12 Bytes Step-Records (v3.12-VERIFIED encoding)
 *                 Per Step-Record (12 Bytes):
 *                   byte 0:    Trigger (0x00=off, 0x01=on)
 *                   byte 1:    Velocity (0x00..0x7F = explicit 0..127, 0xFF = use-default = 127)
 *                   byte 2:    Constant 0x60 (note-attribute prefix?)
 *                   byte 3:    Accent/Tied-Flag (0x00 or 0x01 — Tied-Step?)
 *                   byte 4:    Note-Number / Pitch (0x48 = MIDI 72 = C5, varies)
 *                   bytes 5-11: Reserved (mostly 0x00, observed non-zero in BodyTalk)
 *   0x3C00  1280  Pattern-Footer (16 × 80 Bytes? — globals incl. step-length, motion)
 *                 NICHT vollstaendig reverse-engineered (v3.12). Wir ueberlesen.
 *
 *   FILE-TOTAL: 16640 Bytes (= 256 File-Header + 16384 Pattern-Body).
 *
 * v3.12 RE Methodology:
 *   Hex-diff von Init181 (all-default) vs BodyTalk1 (programmed). Init181 enthaelt
 *   1024 identische 12-byte "00 48 60 00 00 00 00 00 00 00 00 00" records mit
 *   constant stride 12 (1008 of them) und 15 inter-part gaps of stride 60.
 *   ⇒ 16 parts × 64 steps × 12 bytes = 12288 bytes steps + 48 bytes header per part
 *   ⇒ part-stride = 816 (NICHT 896 wie initial vermutet).
 *
 * v3.12 Confidence Levels:
 *   ✅ HIGH:   Step-Trigger (byte 0), Velocity (byte 1), Note (byte 4)
 *   ⚠ MEDIUM: Step byte 3 (Accent/Tied)
 *   ❌ LOW:   Motion-Sequencer-Daten, Swing
 *
 * v3.13 Confidence Levels (NEU):
 *   ✅ HIGH:   Part-Volume   @ part_off + 0x15 (0..127, default 0x7F)
 *   ✅ HIGH:   Part-Pan      @ part_off + 0x22 (0..127, 64=center)
 *   ✅ HIGH:   StepLength    @ PTST    + 0x25 (0=16, 1=32, 3=64)
 *   ⚠ MEDIUM: Part-Volume #2 @ part_off + 0x18 (0..127, beobachtet aber semantisch unklar)
 *   ❌ LOW:   Pitch (signed) — kein Byte zeigt signed-distribution in 4000 samples
 *   ❌ LOW:   FxSend — kein klares default-Byte identifiziert
 *   ❌ LOW:   Swing — PTST+0x123..0x12a hat varying bytes, keine klare Korrelation
 *
 * v3.13 RE Methodology:
 *   Histogramm-Analyse ueber e2s-2016.e2sallpat Stock-Bank (250 Patterns × 16 Parts
 *   = 4000 Part-Header-Samples). Volume@0x15 zeigt peak bei 0x7F (default) und
 *   uniform distribution 0..127, Pan@0x22 peak bei 0x40 (center). StepLength
 *   verifiziert via maxStep-Korrelation: PTST+0x25=0 ⇒ keine Steps > index 16,
 *   PTST+0x25=1 ⇒ steps up to index 31, PTST+0x25=3 ⇒ steps up to index 63.
 *
 * ── LEGACY/SYNTHETIC LAYOUT (best-effort, v2.88) ───────────────────────────
 *
 *   Pre-v3.2 Synthetic-Tests bauen einen anderen Buffer:
 *     - Magic     "KORG"
 *     - Version   u16 LE
 *     - Count     u16 LE
 *     - Pattern[] PATTERN_BLOCK_SIZE Bytes je Block mit Name(8)+BPM(2)+...
 *
 *   Der Parser DETEKTIERT auto: Datei beginnt mit "KORG\0\0\0..." + 16-Byte-
 *   "e2sampler" bei 0x010 ⇒ REAL-Layout. Sonst Legacy. Das haelt alle
 *   bestehenden Tests gruen und liefert volle Validierung gegen echte Files.
 *
 * Endianness:
 *   - Multi-Byte-Integer LITTLE-ENDIAN (DataView.getUint*LE-Varianten).
 *   - BPM 16-bit fixed-point (Wert/10 → BPM, z.B. 1200 = 120.0 BPM).
 *
 * Was definitiv korrekt parst (Real-Files):
 *   ✅ Magic "KORG" + ID "e2sampler"
 *   ✅ Pattern-Name aus 0x110 (16 Byte ASCII, trim trailing)
 *   ✅ BPM aus 0x122 (u16 LE / 10)
 *   ✅ File-Size 16640 = Single-Pattern
 *
 * Was Best-Effort bleibt (Real-Files):
 *   ⚠ Step-Length / Swing — Layout in 0x124+ noch nicht final geklaert
 *   ⚠ Part-Header-Felder (Sample-ID, Volume, Pan, Pitch, FxSend)
 *   ⚠ Pro-Step-Trigger-Bytes (komplexe Encoding mit moeglicher
 *      Note-Per-Step + Length-Encoding — heuristisch geparst, KEIN
 *      Bit-7-Active-Flag wie im synthetischen Layout)
 *   ⚠ Motion-Sequencer-Slots
 *
 * Pattern-Struktur (Legacy/Synthetic-Spec, unveraendert):
 *   - Magic           4 Bytes "KORG" (ASCII)
 *   - Version         2 Bytes LE   (Format-Version, z.B. 0x0001)
 *   - Pattern-Count   2 Bytes LE   (.e2pattern: 1, .e2sallpat: bis 250)
 *   - Pattern-Block * Pattern-Count
 *
 * Pattern-Block (PATTERN_BLOCK_SIZE Bytes):
 *   - Name            8 Bytes ASCII (null-padded)
 *   - BPM             2 Bytes LE   (BPM*10, Range 200..3000 → 20..300 BPM)
 *   - StepLength      1 Byte       (Step-Anzahl 16/32/64)
 *   - Swing           1 Byte       (0..100, Prozent)
 *   - Reserved        4 Bytes
 *   - Part[16]        16 × PART_BLOCK_SIZE
 *
 * Part-Block (PART_BLOCK_SIZE Bytes):
 *   - SampleId        2 Bytes LE   (Patch/Sample-Nummer, 0..0xFFFF)
 *   - Volume          1 Byte       (0..127)
 *   - Pan             1 Byte       (0..127, 64 = center)
 *   - Pitch           1 Byte       (signed, -64..+63 semitones)
 *   - FxSend          1 Byte       (0..127)
 *   - Reserved        2 Bytes
 *   - Steps[64]       64 × 1 Byte  (Bit 7 = active, Bits 0..6 = velocity 0..127)
 *   - Motion[4]       4 × MOTION_SLOT_SIZE
 *
 * Motion-Slot (MOTION_SLOT_SIZE Bytes):
 *   - ParamId         1 Byte       (0..255, geraete-spezifisch — siehe MOTION_PARAM_NAMES)
 *   - Enabled         1 Byte       (0/1)
 *   - Reserved        2 Bytes
 *   - Values[16]      16 × 1 Byte  (Parameter-Werte 0..127)
 */

// ─── Konstanten ───────────────────────────────────────────────────────────────

export const ELECTRIBE_MAGIC = "KORG";

/** Real-File Identifier-String bei Offset 0x10 (16 Bytes, "e2sampler" + zeros). */
export const ELECTRIBE_REAL_IDENTIFIER = "e2sampler";

/** Real-File Pattern-Marker bei Offset 0x100 ("PTST" + zeros). */
export const ELECTRIBE_REAL_PATTERN_MARKER = "PTST";

/** Real-File-Groesse fuer single .e2spat (Sampler-Export). */
export const ELECTRIBE_REAL_FILE_SIZE = 16640;

/** Real-File: Pattern-Name-Offset. */
export const ELECTRIBE_REAL_NAME_OFFSET = 0x110;

/** Real-File: BPM-Offset (u16 LE × 10). */
export const ELECTRIBE_REAL_BPM_OFFSET = 0x122;

/** Real-File: Part-Daten-Start-Offset. */
export const ELECTRIBE_REAL_PARTS_OFFSET = 0x900;

/**
 * Real-File: Bytes pro Part-Block (16 Parts × 816 Bytes = 13056 Bytes ab 0x900).
 *
 * v3.12.0 CORRECTED: Stride ist 816 (NICHT 896 wie pre-v3.12 angenommen).
 * Verified gegen Init181 — der hat 1024 identische step-records mit stride-12.
 * 16 parts × 64 steps × 12 bytes = 12288 step-bytes + 48 bytes header per part
 * ⇒ part-stride = 768 + 48 = 816.
 *
 * Pre-v3.12: assumed 896 (off by 80 bytes/part = 1280 total → falsche
 * Step-Adressierung jenseits Part 0).
 */
export const ELECTRIBE_REAL_PART_STRIDE = 816;

/** Real-File: Bytes pro Part-Header (vor den Step-Records). */
export const ELECTRIBE_REAL_PART_HEADER_BYTES = 0x30; // 48 Bytes

/** Real-File: Bytes pro einzelnem Step-Record im Part-Block. */
export const ELECTRIBE_REAL_STEP_RECORD_BYTES = 12;

/** Real-File: Step-Records pro Part (Hardware-fixed 64, ungeachtet stepLength). */
export const ELECTRIBE_REAL_STEPS_PER_PART = 64;

/**
 * v3.12: Real-File Step-Record Byte-Layout (12 Bytes each):
 *   byte 0:  Trigger-Flag (0x00 = off, 0x01 = on)
 *   byte 1:  Velocity (0x00..0x7F = explicit, 0xFF = default-velocity-127)
 *   byte 2:  Konstante 0x60 (vermutlich note-attribute prefix)
 *   byte 3:  Accent/Tied-Flag (0x00 oder 0x01 — Encoding noch nicht 100% klar)
 *   byte 4:  Note-Nummer / Pitch (MIDI 0..127, 0x48 = C5 default)
 *   bytes 5..11: Reserved / nicht reverse-engineered (mostly 0x00)
 */
export const ELECTRIBE_REAL_STEP_TRIGGER_OFFSET = 0;
export const ELECTRIBE_REAL_STEP_VELOCITY_OFFSET = 1;
export const ELECTRIBE_REAL_STEP_NOTE_OFFSET = 4;
/** Sentinel-Wert: 0xFF in velocity-Byte = "use default-velocity 127". */
export const ELECTRIBE_REAL_VELOCITY_DEFAULT_SENTINEL = 0xff;
export const ELECTRIBE_REAL_VELOCITY_DEFAULT_VALUE = 127;

/**
 * v3.13.0: Real-File Part-Header byte offsets (relative zum part-block start).
 *
 * Verified via histogram analysis ueber 4000 part-samples (250 patterns × 16 parts):
 *   - 0x15 = Volume (peak bei 0x7F default, range 0..127)
 *   - 0x22 = Pan    (peak bei 0x40 center, range 0..127)
 *
 * NICHT decodiert (Pitch und FxSend bleiben Hardware-Defaults):
 *   - Pitch: kein Byte zeigt signed-distribution in der Bank.
 *   - FxSend: kein klares default-pattern identifiziert.
 */
export const ELECTRIBE_REAL_PART_VOLUME_OFFSET = 0x15;
export const ELECTRIBE_REAL_PART_PAN_OFFSET    = 0x22;

/** Hardware-Default fuer Part-Volume (beobachtet in 63.4% aller part-samples). */
export const ELECTRIBE_REAL_PART_VOLUME_DEFAULT = 127;
/** Hardware-Default fuer Part-Pan (Center, beobachtet in 59.7% aller part-samples). */
export const ELECTRIBE_REAL_PART_PAN_DEFAULT = 64;

/**
 * v3.13.0: Real-File Pattern-Globals offset (relativ zum PTST-Marker).
 *
 *   - PTST+0x25 = Step-Length-Code (verified via maxStep-Korrelation):
 *       0 → 16 Steps (alle Init-Patterns)
 *       1 → 32 Steps (z.B. futureMonger1, TopieIterate1)
 *       3 → 64 Steps (vast majority der Stock-Patterns)
 *
 * NICHT decodiert: Swing-Wert. PTST+0x123..0x12a haben varying bytes, aber
 * keine klare Korrelation zu User-bekannten Swing-Werten.
 */
export const ELECTRIBE_REAL_STEP_LENGTH_OFFSET = 0x25; // PTST-relativ

/** Mapping Step-Length-Code → tatsaechliche Step-Anzahl. */
export const ELECTRIBE_REAL_STEP_LENGTH_CODES: Record<number, 16 | 32 | 64> = {
  0: 16,
  1: 32,
  3: 64,
};

/**
 * v3.15.0: Pattern-level Motion-Sequencer-Layout (PTST-relativ).
 *
 * Verified gegen e2s-2016.e2sallpat Stock-Bank (250 Patterns × 8 Slots).
 *
 *   PTST+0x100  8B   ParamID[8]      (1 Byte pro Slot, 0=unused, 1..17 = param)
 *   PTST+0x108..0x118 unused (16B Reserved, alle bytes 0x00 verifiziert)
 *   PTST+0x118  8B   TargetPart[8]   (1 Byte pro Slot, 1..19 = ziel-Part)
 *   PTST+0x120..0x130 unused (16B Reserved, alle bytes 0x00 verifiziert)
 *   PTST+0x130  512B Slot-Data       (8 Slots × 64 Bytes Werte, 0..128)
 */
export const ELECTRIBE_MOTION_PARAM_TABLE_OFFSET  = 0x100; // PTST-relativ
export const ELECTRIBE_MOTION_TARGET_TABLE_OFFSET = 0x118; // PTST-relativ
export const ELECTRIBE_MOTION_DATA_TABLE_OFFSET   = 0x130; // PTST-relativ
export const ELECTRIBE_MOTION_SLOTS_PER_PATTERN   = 8;
export const ELECTRIBE_MOTION_VALUES_PER_SLOT     = 64;
export const ELECTRIBE_MOTION_SLOT_STRIDE         = 64; // = ELECTRIBE_MOTION_VALUES_PER_SLOT

/**
 * Mapping Motion-ParamID → Heuristisches Label. Hardware-Spec NICHT public,
 * Labels best-effort aus Param-ID-Distribution + e2s-Hardware-Doku abgeleitet.
 *
 * 17 unique IDs beobachtet (1..17). Beobachtete Frequenz (Top-5):
 *   0x11 (17): 81× — vermutlich Volume oder Filter Cutoff (am haeufigsten)
 *   0x01 (1):  34× | 0x02 (2): 26× | 0x0d (13): 18× | 0x05 (5): 14×
 *
 * Diese Labels sind STARK heuristisch und sollten in UI als
 * "Param 0x11 (Param-Slot)" angezeigt werden, nicht als verifiziert.
 */
export const ELECTRIBE_PATTERN_MOTION_PARAM_NAMES: Record<number, string> = {
  1:  "Param 01",
  2:  "Param 02",
  3:  "Param 03",
  4:  "Param 04",
  5:  "Param 05",
  6:  "Param 06",
  7:  "Param 07",
  8:  "Param 08",
  9:  "Param 09",
  10: "Param 10",
  11: "Param 11",
  12: "Param 12",
  13: "Param 13",
  14: "Param 14",
  15: "Param 15",
  16: "Param 16",
  17: "Param 17",
};

/** Maximale Pattern-Anzahl in einer Bank (.e2sallpat speichert bis 250). */
export const MAX_PATTERNS_PER_BANK = 250;

/** Anzahl Parts pro Pattern (Electribe 2 Sampler hat 16: 8 Drum + 6 Synth + 2 Stretch/Audio). */
export const PARTS_PER_PATTERN = 16;

/** Maximale Step-Anzahl pro Part. */
export const STEPS_PER_PART = 64;

/** Anzahl Motion-Sequencer-Slots pro Part. */
export const MOTION_SLOTS_PER_PART = 4;

/** Motion-Sequencer-Steps pro Slot (1 Bar @ 16 Steps). */
export const MOTION_STEPS_PER_SLOT = 16;

/** BPM-Bereich gemaess Hardware-Spec. */
export const ELECTRIBE_MIN_BPM = 20;
export const ELECTRIBE_MAX_BPM = 300;

/** Sample-Size der Sub-Strukturen (Best-Effort-Spec). */
export const PATTERN_HEADER_SIZE   = 16; // Name(8) + BPM(2) + StepLength(1) + Swing(1) + Reserved(4)
export const PART_HEADER_SIZE      = 8;  // SampleId(2) + Volume(1) + Pan(1) + Pitch(1) + FxSend(1) + Reserved(2)
export const MOTION_SLOT_SIZE      = 4 + MOTION_STEPS_PER_SLOT; // ParamId(1)+Enabled(1)+Reserved(2)+16 Values
export const PART_BLOCK_SIZE       = PART_HEADER_SIZE + STEPS_PER_PART + (MOTION_SLOTS_PER_PART * MOTION_SLOT_SIZE);
export const PATTERN_BLOCK_SIZE    = PATTERN_HEADER_SIZE + (PARTS_PER_PATTERN * PART_BLOCK_SIZE);

/** Bank-Header: Magic(4) + Version(2) + PatternCount(2) = 8 Bytes. */
export const BANK_HEADER_SIZE = 8;

/** Maximum acceptable file size (Hard-Cap, Schutz vor riesigen Inputs). */
export const MAX_ELECTRIBE_FILE_BYTES = 8 * 1024 * 1024; // 8 MB (v3.11: erhoeht von 5MB fuer .e2sallpat Stock-Banks, ~4 MB)

// ─── .e2sallpat Multi-Pattern-Bank Layout (v3.11.0, verified gegen 2016 Stock-Bank) ───
//
// File-Header (analog .e2spat):
//   0x00000   16B   "KORG" + 12× 0x00
//   0x00010   16B   "e2sampler" + zeros
//   0x00020   4B    Version (u32 LE = 1)
//   0x00024   220B  0xFF padding
//
// Bank-Header / GLST (Global Slot Table):
//   0x00100   4B    "GLST"
//   0x00104   4B    Chunk-Length u32 LE (256 in 2016 Stock-Bank)
//   0x00108..0x001FC reserved/metadata (mostly zeros)
//   0x001FC   4B    "GLED" (Global End)
//   0x00200..0x0FFFF Padding (0xFF) — bringt das File-Prefix auf 65792 Bytes
//
// Pattern-Records (250 × 16384 Bytes = 4 096 000 Bytes):
//   Beginnen bei 0x10100. Jede Pattern hat denselben PTST-relativen Aufbau
//   wie .e2spat-Bodies:
//     PTST+0x00  4B   "PTST" Marker
//     PTST+0x10  16B  Pattern-Name (ASCII, space/zero-padded)
//     PTST+0x22  2B   BPM × 10 (u16 LE)
//     PTST+0x800 13056B Parts (16 × 816B) — PTST-relativ statt 0x900 absolut (v3.12-corrected)
//
// File-Total: 65792 (Prefix) + 4 096 000 (250 Patterns) = 4 161 792 Bytes
//             ⇒ Hard-Cap fuer .e2sallpat: ~5 MB headroom.

/** .e2sallpat: Offset des ersten PTST-Pattern-Records. */
export const ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET = 0x10100;

/** .e2sallpat: Stride zwischen Pattern-Records (= Pattern-Body-Size). */
export const ELECTRIBE_ALLPAT_PATTERN_STRIDE = 0x4000; // 16384 Bytes

/** .e2sallpat: Erwartete Slot-Anzahl (KORG hardware-fixed). */
export const ELECTRIBE_ALLPAT_SLOT_COUNT = 250;

/** .e2sallpat: Erwartete File-Size = Prefix + 250 × Stride. */
export const ELECTRIBE_ALLPAT_EXPECTED_SIZE =
  ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET + ELECTRIBE_ALLPAT_SLOT_COUNT * ELECTRIBE_ALLPAT_PATTERN_STRIDE;

/** .e2sallpat: Bank-Header-Marker (Global Slot Table). */
export const ELECTRIBE_ALLPAT_GLST_MARKER = "GLST";
export const ELECTRIBE_ALLPAT_GLST_OFFSET = 0x100;

/** .e2sallpat: Bank-Header-End-Marker (Global End). */
export const ELECTRIBE_ALLPAT_GLED_MARKER = "GLED";

/**
 * Mapping ParamId → Anzeigename. Best-Effort — die echten ParamIds des Electribe 2
 * sind geraete-spezifisch und nicht oeffentlich dokumentiert. Diese Liste
 * abdeckt die wichtigsten User-bekannten Parameter; unbekannte IDs werden
 * "Param NN" benannt.
 */
export const MOTION_PARAM_NAMES: Record<number, string> = {
  0:  "Filter Cutoff",
  1:  "Filter Resonance",
  2:  "Filter Drive",
  3:  "Amp EG Attack",
  4:  "Amp EG Decay",
  5:  "Pitch",
  6:  "Pan",
  7:  "Volume",
  8:  "FX Send",
  9:  "Master FX Depth",
  10: "Modulation Depth",
  11: "Modulation Speed",
  12: "Sample Start",
  13: "Sample End",
  14: "Reverse",
  15: "Roll",
};

// ─── Typen ────────────────────────────────────────────────────────────────────

export interface ParsedMotionSlot {
  /** ParamId aus dem File (0..255). */
  paramId: number;
  /** Anzeigename (aus MOTION_PARAM_NAMES, sonst "Param NN"). */
  paramName: string;
  enabled: boolean;
  /** 16 Werte, 0..127. */
  values: number[];
}

export interface ParsedPartStep {
  active: boolean;
  /** 0..127. */
  velocity: number;
}

export interface ParsedPart {
  /** 0..15 — der Part-Index im Pattern. */
  index: number;
  /** Sample/Patch-ID aus dem Electribe-File (NICHT auf Synthstudio-Sample gemappt). */
  sampleId: number;
  /** 0..127. */
  volume: number;
  /** 0..127 (64 = center). */
  pan: number;
  /** Signed -64..+63 semitones. */
  pitch: number;
  /** 0..127. */
  fxSend: number;
  /** Trigger-Steps, immer `STEPS_PER_PART` lang. */
  steps: ParsedPartStep[];
  /** 4 Motion-Sequencer-Slots. */
  motion: ParsedMotionSlot[];
}

/**
 * v3.15.0: Pattern-level Motion-Sequencer-Slot.
 *
 * E2 Sampler hat 8 Motion-Slots PRO PATTERN (NICHT pro Part wie initial vermutet).
 * Pro Slot: 1 ParamID + 1 TargetPart + 64 Werte (matching Pattern-StepLength).
 *
 * Slot ist "aktiv" wenn paramId > 0 ODER mindestens ein non-zero value.
 * Inactive Slots werden defensiv mit Defaults gefuellt (paramId=0, target=0, values=[0×64]).
 */
export interface ParsedPatternMotionSlot {
  /** ParamID (0..255). 0 = disabled. 1..17 = bekannte Hardware-IDs. */
  paramId: number;
  /** Anzeigename (best-effort via ELECTRIBE_PATTERN_MOTION_PARAM_NAMES). */
  paramName: string;
  /** Ziel-Part-Index (0..15) abgeleitet aus rawTarget-1. -1 = global/unbekannt. */
  targetPart: number;
  /** Rohes Ziel-Byte 0..255 (1..19 in der Stock-Bank beobachtet). */
  rawTarget: number;
  /** Slot ist aktiv (paramId > 0 ODER non-zero values gefunden). */
  enabled: boolean;
  /** 64 Werte 0..127 (0x80=128 gelegentlich beobachtet → wird auf 127 geclampt). */
  values: number[];
}

export interface ParsedPattern {
  /** Sanitisierter ASCII-Name (Real-Files: max 16, Legacy: max 8 Zeichen). */
  name: string;
  /** BPM (z.B. 120.0). */
  bpm: number;
  /** 16, 32 oder 64. */
  stepLength: number;
  /** Swing 0..100. */
  swing: number;
  /** 16 Parts. */
  parts: ParsedPart[];
  /**
   * v3.15.0: 8 Pattern-Level Motion-Slots. Immer Laenge 8 (auch wenn alle disabled).
   * Bei legacy/synthetic Files ist das Feld undefined.
   */
  patternMotion?: ParsedPatternMotionSlot[];
}

export interface ParsedElectribeBank {
  version: number;
  patternCount: number;
  patterns: ParsedPattern[];
}

// ─── Reader-Helper ────────────────────────────────────────────────────────────

class SafeReader {
  pos = 0;
  readonly view: DataView;
  readonly length: number;

  constructor(view: DataView) {
    this.view  = view;
    this.length = view.byteLength;
  }

  remaining(): number {
    return this.length - this.pos;
  }

  ensure(n: number, context: string): void {
    if (this.pos < 0 || this.pos + n > this.length) {
      throw new Error(
        `Electribe-Parser: out-of-bounds read (${context}) — need ${n} byte(s) at ${this.pos}, have ${this.length - this.pos}`,
      );
    }
  }

  u8(context = "u8"): number {
    this.ensure(1, context);
    const v = this.view.getUint8(this.pos);
    this.pos += 1;
    return v;
  }

  i8(context = "i8"): number {
    this.ensure(1, context);
    const v = this.view.getInt8(this.pos);
    this.pos += 1;
    return v;
  }

  u16LE(context = "u16"): number {
    this.ensure(2, context);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  ascii(n: number, context = "ascii"): string {
    this.ensure(n, context);
    let s = "";
    for (let i = 0; i < n; i++) {
      const b = this.view.getUint8(this.pos + i);
      if (b === 0) continue;
      // Nur Druck-ASCII zulassen (32..126), Rest wird gestrippt.
      if (b >= 32 && b <= 126) s += String.fromCharCode(b);
    }
    this.pos += n;
    return s.trim();
  }

  skip(n: number, context = "skip"): void {
    this.ensure(n, context);
    this.pos += n;
  }
}

// ─── Eingabe-Normalisierung ──────────────────────────────────────────────────

function toDataView(input: ArrayBuffer | Uint8Array | DataView): DataView {
  if (input instanceof DataView) return input;
  if (input instanceof Uint8Array) {
    return new DataView(input.buffer, input.byteOffset, input.byteLength);
  }
  if (input instanceof ArrayBuffer) {
    return new DataView(input);
  }
  throw new Error("Electribe-Parser: Eingabe muss ArrayBuffer, Uint8Array oder DataView sein.");
}

// ─── Format-Detection: Real-File vs Legacy/Synthetic ─────────────────────────

/**
 * Liest n ASCII-Bytes (Druck-Range 32..126) ab Offset, stoppt bei 0x00.
 * Defensiv: gibt leeren String zurueck wenn Offset out-of-range.
 */
function readAsciiAt(view: DataView, offset: number, len: number): string {
  if (offset < 0 || offset + len > view.byteLength) return "";
  let s = "";
  for (let i = 0; i < len; i++) {
    const b = view.getUint8(offset + i);
    if (b === 0) continue;
    if (b >= 32 && b <= 126) s += String.fromCharCode(b);
  }
  return s.trim();
}

/**
 * Erkennt das echte KORG E2 Sampler Layout:
 *   - Offset 0x00: "KORG" + 12 × 0x00
 *   - Offset 0x10: "e2sampler" (10 Bytes ASCII)
 *   - Offset 0x100: "PTST" Pattern-Marker
 *
 * Diese 3 Marker zusammen sind hinreichend distinkt; kein synthetisches
 * Test-File wird das ausloesen (die Tests bauen direkt nach 4-Byte-Magic
 * den Bank-Header ohne 256-Byte-Header-Padding).
 */
export function isRealElectribeFile(input: ArrayBuffer | Uint8Array | DataView): boolean {
  try {
    const view = toDataView(input);
    if (view.byteLength < 0x200) return false;
    const magic = readAsciiAt(view, 0x00, 4);
    if (magic !== ELECTRIBE_MAGIC) return false;
    const id = readAsciiAt(view, 0x10, 16);
    if (!id.startsWith(ELECTRIBE_REAL_IDENTIFIER)) return false;
    const marker = readAsciiAt(view, 0x100, 4);
    if (marker !== ELECTRIBE_REAL_PATTERN_MARKER) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * v3.11.0: Erkennt das .e2sallpat-Bank-Layout (250 Pattern Records).
 *
 * Marker:
 *   - Offset 0x00: "KORG" (gleich wie .e2spat)
 *   - Offset 0x10: "e2sampler" (gleich wie .e2spat)
 *   - Offset 0x100: "GLST" (statt PTST — distinktes Bank-Magic)
 *   - File-Size >= 1 MB (Single-Pattern .e2spat ist nur 16640 Bytes)
 */
export function isElectribeAllPatBank(input: ArrayBuffer | Uint8Array | DataView): boolean {
  try {
    const view = toDataView(input);
    if (view.byteLength < 0x10100 + ELECTRIBE_ALLPAT_PATTERN_STRIDE) return false;
    const magic = readAsciiAt(view, 0x00, 4);
    if (magic !== ELECTRIBE_MAGIC) return false;
    const id = readAsciiAt(view, 0x10, 16);
    if (!id.startsWith(ELECTRIBE_REAL_IDENTIFIER)) return false;
    const glst = readAsciiAt(view, ELECTRIBE_ALLPAT_GLST_OFFSET, 4);
    if (glst !== ELECTRIBE_ALLPAT_GLST_MARKER) return false;
    // Mindestens ein PTST-Marker beim ersten Pattern-Record erwartet.
    const ptst = readAsciiAt(view, ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET, 4);
    if (ptst !== ELECTRIBE_REAL_PATTERN_MARKER) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * v3.11.0: 3-Wege-Format-Klassifikation (low-level).
 *
 * Heute liefert `detectElectribeFormat` aus historischen Gruenden nur
 * "pattern" | "bank" (auf Hardware-Single-Pattern abgebildet). Diese
 * granulare Variante unterscheidet die echten 3 Datei-Layouts.
 */
export function detectElectribeFormatKind(
  input: ArrayBuffer | Uint8Array | DataView,
): "e2spat" | "e2sallpat" | "legacy" | "unknown" {
  try {
    const view = toDataView(input);
    if (view.byteLength < BANK_HEADER_SIZE) return "unknown";
    if (isElectribeAllPatBank(view)) return "e2sallpat";
    if (isRealElectribeFile(view)) return "e2spat";
    // Synthetic/Legacy: KORG + nicht-real
    const magic = readAsciiAt(view, 0x00, 4);
    if (magic === ELECTRIBE_MAGIC) return "legacy";
    return "unknown";
  } catch {
    return "unknown";
  }
}

// ─── Real-File Parser (verified Layout) ──────────────────────────────────────

/**
 * v3.12.0 VERIFIED Step-Encoding:
 *
 * Untersucht einen 816-Byte Part-Block (Stride confirmed by RE 2026-05-18)
 * und parsed die 64 Step-Records (à 12 Bytes) ab Offset +0x30.
 *
 * Step-Record Layout (12 Bytes pro Step):
 *   byte 0:  Trigger-Flag (0x00 = inactive, 0x01 = active) — VERIFIED
 *   byte 1:  Velocity (0x00..0x7F = explicit 0..127,
 *            0xFF = sentinel "use default 127") — VERIFIED
 *   byte 2:  Konstante 0x60 (note-attribute prefix?) — observed
 *   byte 3:  Accent/Tied-Flag (0x00 oder 0x01) — observed but semantics TBD
 *   byte 4:  Note-Number (MIDI 0..127, default 0x48=C5) — VERIFIED
 *   bytes 5..11: Reserved/unknown (mostly 0x00) — NOT DECODED
 *
 * Verifikation:
 *   Init181 enthaelt 1024 identische records mit konstantem stride-12
 *   (1008 of them) + 15 gaps stride-60 zwischen den 16 parts. Boundary
 *   nach jedem 64-record-Block ⇒ 64 steps × 16 parts.
 *
 * Part-Header (erste 48 Bytes vor den Step-Records):
 *   Layout noch nicht final reverse-engineered. Defensive Defaults
 *   (Volume=100, Pan=64, Pitch=0, FxSend=0) bleiben.
 *
 * @param view       Voll-File DataView
 * @param partOffset File-absoluter Offset des Part-Block-Starts
 * @param partIndex  0..15
 */
function parseRealPartBlock(view: DataView, partOffset: number, partIndex: number): ParsedPart {
  // Defensiv: pruefe ob 816 Bytes ab partOffset noch in der Datei liegen.
  const haveBytes = Math.max(0, Math.min(ELECTRIBE_REAL_PART_STRIDE, view.byteLength - partOffset));

  const safeU8 = (off: number) => (off >= 0 && off < haveBytes ? view.getUint8(partOffset + off) : 0);
  const safeU16LE = (off: number) =>
    off >= 0 && off + 1 < haveBytes ? view.getUint16(partOffset + off, true) : 0;

  // Part-Header: v3.13.0 — Volume + Pan jetzt decodiert via histogram-RE.
  // SampleId @ +0x08 (u16 LE): v3.271 verifiziert gegen alle 16×250 Parts der
  // e2s-2016-Stock-Bank — Werte 1..~500 (Factory-Sample-Nummern), 0 = keins.
  // (Vor v3.271 wurde faelschlich +0x04 gelesen, was ~immer 0 ist; siehe
  // e2sExport.ts PART_SAMPLE_OFF + die Repoint-Logik.)
  // Pitch + FxSend bleiben Hardware-Defaults (keine signed-distribution oder
  // klares default-byte in der 4000-sample-bank gefunden).
  const sampleId = safeU16LE(8);

  // Volume @ +0x15: 0..127. Defensive clamp gegen out-of-range (sollte nie
  // > 127 sein laut bank-histogram, aber defensiv parsen).
  const rawVol = safeU8(ELECTRIBE_REAL_PART_VOLUME_OFFSET);
  let volume: number = rawVol;
  if (volume > 127) {
    // eslint-disable-next-line no-console
    console.warn(`Electribe-Parser: Part ${partIndex} volume ${rawVol} > 127 — clamp auf 127`);
    volume = 127;
  }

  // Pan @ +0x22: 0..127 (64 = center). Defensive clamp.
  const rawPan = safeU8(ELECTRIBE_REAL_PART_PAN_OFFSET);
  let pan: number = rawPan;
  if (pan > 127) {
    // eslint-disable-next-line no-console
    console.warn(`Electribe-Parser: Part ${partIndex} pan ${rawPan} > 127 — clamp auf 127`);
    pan = 127;
  }

  // Pitch + FxSend: nicht decodiert → Hardware-Defaults.
  const pitch    = 0;
  const fxSend   = 0;

  // Steps: v3.12.0 — verifiziertes 12-byte-Record-Encoding.
  // Stop-Bedingung: wenn der Step-Bereich nicht vollstaendig in den verfuegbaren
  // Bytes liegt, fuelle die fehlenden Steps mit inactive auf.
  const stepAreaStart = ELECTRIBE_REAL_PART_HEADER_BYTES;
  const steps: ParsedPartStep[] = new Array(STEPS_PER_PART);
  for (let s = 0; s < STEPS_PER_PART; s++) {
    if (s < ELECTRIBE_REAL_STEPS_PER_PART) {
      const recOffsetWithinPart = stepAreaStart + s * ELECTRIBE_REAL_STEP_RECORD_BYTES;
      // 12-byte record passt nur dann komplett, wenn recOffsetWithinPart+11 < haveBytes.
      if (recOffsetWithinPart + ELECTRIBE_REAL_STEP_RECORD_BYTES <= haveBytes) {
        const trigByte = safeU8(recOffsetWithinPart + ELECTRIBE_REAL_STEP_TRIGGER_OFFSET);
        const velByte  = safeU8(recOffsetWithinPart + ELECTRIBE_REAL_STEP_VELOCITY_OFFSET);
        const active = trigByte === 0x01;
        // Velocity-Sentinel: 0xFF = use-default 127. Sonst direkt 0..127.
        let velocity: number;
        if (velByte === ELECTRIBE_REAL_VELOCITY_DEFAULT_SENTINEL) {
          velocity = ELECTRIBE_REAL_VELOCITY_DEFAULT_VALUE;
        } else if (velByte >= 0 && velByte <= 127) {
          velocity = velByte;
        } else {
          // Out-of-range (z.B. 0x80..0xFE) — defensive clamp auf 127.
          velocity = 127;
        }
        steps[s] = { active, velocity };
      } else {
        steps[s] = { active: false, velocity: 0 };
      }
    } else {
      steps[s] = { active: false, velocity: 0 };
    }
  }

  // Motion-Slots: noch nicht reverse-engineered. Disabled-Defaults.
  const motion: ParsedMotionSlot[] = new Array(MOTION_SLOTS_PER_PART);
  for (let m = 0; m < MOTION_SLOTS_PER_PART; m++) {
    motion[m] = {
      paramId: 0,
      paramName: MOTION_PARAM_NAMES[0] ?? "Param 0",
      enabled: false,
      values: new Array(MOTION_STEPS_PER_SLOT).fill(0),
    };
  }

  return {
    index: partIndex,
    sampleId,
    volume,
    pan,
    pitch,
    fxSend,
    steps,
    motion,
  };
}

/**
 * v3.11.0: Generischer Real-Pattern-Parser, der relativ zu einem PTST-Marker
 * arbeitet. Wird sowohl von .e2spat (ptstOffset = 0x100) als auch von
 * .e2sallpat (ptstOffset = 0x10100, 0x14100, ...) genutzt.
 *
 * Verified Fields (PTST-relativ):
 *   - PTST+0x10 Name (16 Byte ASCII)
 *   - PTST+0x22 BPM × 10 (u16 LE)
 *
 * Best-Effort Fields:
 *   - StepLength (default 16)
 *   - Swing (default 0)
 *   - Part-Header (Volume/Pan/Pitch/FxSend = Hardware-Defaults)
 *   - Steps (alle inactive — Encoding noch nicht reverse-engineered)
 *   - Motion-Slots (alle disabled)
 *
 * @param view       Voll-File-DataView (kein Sub-View — wir indizieren mit absoluten Offsets).
 * @param ptstOffset File-absoluter Offset des PTST-Markers.
 * @param slotIndex  1-basierter Slot-Index (1..250) fuer Fallback-Naming.
 */
function parseRealPatternAt(
  view: DataView,
  ptstOffset: number,
  slotIndex: number,
): ParsedPattern {
  // PTST-relative Felder.
  const nameOffset  = ptstOffset + 0x10;
  const bpmOffset   = ptstOffset + 0x22;
  const partsOffset = ptstOffset + 0x800; // PTST-relativ (statt 0x900 file-absolut bei .e2spat).

  // Name
  const nameRaw = readAsciiAt(view, nameOffset, 16);
  const name = nameRaw || `PATTERN_${slotIndex}`;

  // BPM (u16 LE / 10)
  let bpm = 120;
  if (bpmOffset + 1 < view.byteLength) {
    const bpmRaw = view.getUint16(bpmOffset, true);
    bpm = bpmRaw / 10;
    if (!Number.isFinite(bpm) || bpm < ELECTRIBE_MIN_BPM) bpm = ELECTRIBE_MIN_BPM;
    if (bpm > ELECTRIBE_MAX_BPM) bpm = ELECTRIBE_MAX_BPM;
  }

  // v3.13.0: StepLength aus PTST+0x25 (code 0=16, 1=32, 3=64).
  // Defensive: unbekannte codes → default 16.
  let stepLength: 16 | 32 | 64 = 16;
  const stepLenOff = ptstOffset + ELECTRIBE_REAL_STEP_LENGTH_OFFSET;
  if (stepLenOff < view.byteLength) {
    const code = view.getUint8(stepLenOff);
    const mapped = ELECTRIBE_REAL_STEP_LENGTH_CODES[code];
    if (mapped !== undefined) {
      stepLength = mapped;
    } else {
      // eslint-disable-next-line no-console
      console.warn(
        `Electribe-Parser: unbekannter Step-Length-Code ${code} bei PTST+0x25 — Fallback auf 16`,
      );
    }
  }

  // Swing: noch nicht decodiert.
  const swing = 0;

  // 16 Parts ab partsOffset, je 816 Bytes (v3.12-verified stride)
  const parts: ParsedPart[] = new Array(PARTS_PER_PATTERN);
  for (let p = 0; p < PARTS_PER_PATTERN; p++) {
    const partOffset = partsOffset + p * ELECTRIBE_REAL_PART_STRIDE;
    parts[p] = parseRealPartBlock(view, partOffset, p);
  }

  // v3.15.0: Pattern-Level Motion-Slots aus PTST-relativ +0x100..+0x330.
  const patternMotion = parsePatternMotionTable(view, ptstOffset);

  return { name, bpm, stepLength, swing, parts, patternMotion };
}

/**
 * v3.15.0: Parst die 8 Pattern-Level Motion-Slots aus dem PTST-Header.
 *
 * Layout (PTST-relativ):
 *   +0x100..+0x108  8B  ParamID[8]
 *   +0x118..+0x120  8B  TargetPart[8]
 *   +0x130..+0x330  512B = 8 Slots × 64 Bytes
 *
 * Defensive: bei out-of-bounds → leeres Array mit 8 disabled-Slots.
 * Werte 0x80 (128) werden auf 127 geclampt (observed sentinel, in der Bank
 * nur einzelne Bytes — typisch 0..127 Range).
 *
 * Slot ist "enabled" wenn paramId > 0 ODER mindestens ein non-zero value.
 *
 * @param view       Voll-File-DataView
 * @param ptstOffset Absolute Offset des PTST-Markers (z.B. 0x100 fuer .e2spat,
 *                   oder 0x10100 + i×0x4000 fuer .e2sallpat-Slots)
 */
export function parsePatternMotionTable(
  view: DataView,
  ptstOffset: number,
): ParsedPatternMotionSlot[] {
  const slots: ParsedPatternMotionSlot[] = new Array(ELECTRIBE_MOTION_SLOTS_PER_PATTERN);

  // Defensive: pruefe ob das ganze Motion-Region in der Datei liegt.
  const motionEnd = ptstOffset
    + ELECTRIBE_MOTION_DATA_TABLE_OFFSET
    + ELECTRIBE_MOTION_SLOTS_PER_PATTERN * ELECTRIBE_MOTION_SLOT_STRIDE;
  if (motionEnd > view.byteLength) {
    // Zu wenig Daten → alle Slots disabled.
    for (let i = 0; i < ELECTRIBE_MOTION_SLOTS_PER_PATTERN; i++) {
      slots[i] = {
        paramId: 0,
        paramName: "disabled",
        targetPart: -1,
        rawTarget: 0,
        enabled: false,
        values: new Array(ELECTRIBE_MOTION_VALUES_PER_SLOT).fill(0),
      };
    }
    return slots;
  }

  for (let i = 0; i < ELECTRIBE_MOTION_SLOTS_PER_PATTERN; i++) {
    const paramId   = view.getUint8(ptstOffset + ELECTRIBE_MOTION_PARAM_TABLE_OFFSET + i);
    const rawTarget = view.getUint8(ptstOffset + ELECTRIBE_MOTION_TARGET_TABLE_OFFSET + i);
    // rawTarget=1..16 → partIndex 0..15; rawTarget=17..19 → global / future-use → -1.
    const targetPart = (rawTarget >= 1 && rawTarget <= 16) ? rawTarget - 1 : -1;

    const dataStart = ptstOffset
      + ELECTRIBE_MOTION_DATA_TABLE_OFFSET
      + i * ELECTRIBE_MOTION_SLOT_STRIDE;
    const values: number[] = new Array(ELECTRIBE_MOTION_VALUES_PER_SLOT);
    let hasNonZero = false;
    for (let v = 0; v < ELECTRIBE_MOTION_VALUES_PER_SLOT; v++) {
      let raw = view.getUint8(dataStart + v);
      if (raw > 127) raw = 127; // Sentinel 0x80 → clamp to 127.
      values[v] = raw;
      if (raw !== 0) hasNonZero = true;
    }

    const enabled = paramId > 0 || hasNonZero;
    const paramName = paramId === 0
      ? "disabled"
      : (ELECTRIBE_PATTERN_MOTION_PARAM_NAMES[paramId] ?? `Param 0x${paramId.toString(16).padStart(2, "0")}`);

    slots[i] = { paramId, paramName, targetPart, rawTarget, enabled, values };
  }

  return slots;
}

/**
 * Parst ein verifiziertes Real-File (KORG E2 Sampler .e2spat).
 *
 * Verified Fields:
 *   - Name aus 0x110 (16 Byte ASCII)
 *   - BPM aus 0x122 (u16 LE / 10)
 */
function parseRealPattern(view: DataView): ParsedPattern {
  // .e2spat: PTST liegt file-absolut bei 0x100. PTST+0x10=0x110=Name, PTST+0x22=0x122=BPM.
  // PTST+0x800 = 0x900 = Parts-Offset (= ELECTRIBE_REAL_PARTS_OFFSET).
  return parseRealPatternAt(view, 0x100, 1);
}

/**
 * v3.11.0: Parst eine .e2sallpat-Multi-Pattern-Bank (250 Slots).
 *
 * - Walked alle 250 Pattern-Records mit fixem Stride 16384B ab 0x10100.
 * - Pro Record: validiert PTST-Marker, parst Name/BPM/Parts via parseRealPatternAt.
 * - Defensiv: kaputter PTST-Marker → Slot bleibt "Init Pattern" Default, kein Throw.
 * - Init-Slots (Name = "Init Pattern") werden NICHT geskippt — User soll alle 250
 *   Slots sehen koennen, um z.B. ueberschriebene gegen Werks-Init zu vergleichen.
 *
 * @returns ParsedElectribeBank mit 250 Patterns (Index 0..249 == Slot 1..250).
 */
export function parseElectribeAllPatBank(
  input: ArrayBuffer | Uint8Array | DataView,
): ParsedElectribeBank {
  const view = toDataView(input);

  if (view.byteLength < ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET + ELECTRIBE_ALLPAT_PATTERN_STRIDE) {
    throw new Error(
      `Electribe-Parser: .e2sallpat Datei zu klein (${view.byteLength} Bytes, erwartet >= ${
        ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET + ELECTRIBE_ALLPAT_PATTERN_STRIDE
      })`,
    );
  }
  if (view.byteLength > MAX_ELECTRIBE_FILE_BYTES) {
    throw new Error(`Electribe-Parser: Datei zu gross (${view.byteLength} > ${MAX_ELECTRIBE_FILE_BYTES}).`);
  }

  const version =
    view.byteLength >= 0x24 ? view.getUint32(0x20, true) : 1;

  // Wie viele Slots passen tatsaechlich in das File? (Defensive gegen
  // truncated Banks; Stock-Bank hat exakt 250.)
  const maxSlotsByFileSize = Math.floor(
    (view.byteLength - ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET) / ELECTRIBE_ALLPAT_PATTERN_STRIDE,
  );
  const slotCount = Math.min(ELECTRIBE_ALLPAT_SLOT_COUNT, maxSlotsByFileSize);

  const patterns: ParsedPattern[] = new Array(slotCount);
  for (let i = 0; i < slotCount; i++) {
    const ptstOffset =
      ELECTRIBE_ALLPAT_FIRST_PATTERN_OFFSET + i * ELECTRIBE_ALLPAT_PATTERN_STRIDE;

    // PTST-Marker-Check (defensive — malformed records duerfen nicht crashen).
    const marker = readAsciiAt(view, ptstOffset, 4);
    if (marker !== ELECTRIBE_REAL_PATTERN_MARKER) {
      // Slot ohne PTST → minimaler Default-Eintrag.
      // v3.13.0: Volume-Default ist 127 (Hardware-Standard, 63.4% Bank-Distribution),
      // Pan-Default ist 64 (Center, 59.7%).
      patterns[i] = {
        name: `Slot ${i + 1}`,
        bpm: 120,
        stepLength: 16,
        swing: 0,
        parts: Array.from({ length: PARTS_PER_PATTERN }, (_, p) => ({
          index: p,
          sampleId: 0,
          volume: ELECTRIBE_REAL_PART_VOLUME_DEFAULT,
          pan: ELECTRIBE_REAL_PART_PAN_DEFAULT,
          pitch: 0,
          fxSend: 0,
          steps: Array.from({ length: STEPS_PER_PART }, () => ({ active: false, velocity: 0 })),
          motion: Array.from({ length: MOTION_SLOTS_PER_PART }, () => ({
            paramId: 0,
            paramName: MOTION_PARAM_NAMES[0] ?? "Param 0",
            enabled: false,
            values: new Array(MOTION_STEPS_PER_SLOT).fill(0),
          })),
        })),
        // v3.15.0: leerer Default-Pattern hat 8 disabled Motion-Slots.
        patternMotion: Array.from({ length: ELECTRIBE_MOTION_SLOTS_PER_PATTERN }, () => ({
          paramId: 0,
          paramName: "disabled",
          targetPart: -1,
          rawTarget: 0,
          enabled: false,
          values: new Array(ELECTRIBE_MOTION_VALUES_PER_SLOT).fill(0),
        })),
      };
      continue;
    }

    try {
      patterns[i] = parseRealPatternAt(view, ptstOffset, i + 1);
    } catch {
      // Per-Slot defensive Fallback — Bank-Parse darf nie crashen.
      patterns[i] = {
        name: `Slot ${i + 1} (Parse-Error)`,
        bpm: 120,
        stepLength: 16,
        swing: 0,
        parts: [],
      };
    }
  }

  return {
    version,
    patternCount: patterns.length,
    patterns,
  };
}

/**
 * v3.11.0: Filtert Slots, deren Name auf "Init Pattern" zeigt (Werks-Init).
 * Convenience-Helper fuer UI-Code, der nur User-Custom-Patterns anzeigen will.
 */
export function filterNonInitPatterns(patterns: ParsedPattern[]): ParsedPattern[] {
  return patterns.filter(p => {
    const name = (p.name ?? "").trim();
    if (!name) return false;
    if (name === "Init Pattern") return false;
    if (/^Slot \d+/i.test(name)) return false;
    return true;
  });
}

// ─── Pattern-Block-Parser (Legacy/Synthetic) ─────────────────────────────────

function parsePartBlock(reader: SafeReader, index: number): ParsedPart {
  // Part-Header
  const sampleId = reader.u16LE(`part[${index}].sampleId`);
  const volume   = reader.u8(`part[${index}].volume`);
  const pan      = reader.u8(`part[${index}].pan`);
  const pitch    = reader.i8(`part[${index}].pitch`);
  const fxSend   = reader.u8(`part[${index}].fxSend`);
  reader.skip(2, `part[${index}].reserved`);

  // Steps (1 Byte / Step)
  const steps: ParsedPartStep[] = new Array(STEPS_PER_PART);
  for (let s = 0; s < STEPS_PER_PART; s++) {
    const b = reader.u8(`part[${index}].step[${s}]`);
    const active   = (b & 0x80) !== 0;
    const velocity = b & 0x7f;
    steps[s] = { active, velocity };
  }

  // Motion-Slots
  const motion: ParsedMotionSlot[] = new Array(MOTION_SLOTS_PER_PART);
  for (let m = 0; m < MOTION_SLOTS_PER_PART; m++) {
    const paramId = reader.u8(`part[${index}].motion[${m}].paramId`);
    const enabled = reader.u8(`part[${index}].motion[${m}].enabled`) !== 0;
    reader.skip(2, `part[${index}].motion[${m}].reserved`);
    const values: number[] = new Array(MOTION_STEPS_PER_SLOT);
    for (let v = 0; v < MOTION_STEPS_PER_SLOT; v++) {
      values[v] = reader.u8(`part[${index}].motion[${m}].value[${v}]`);
    }
    motion[m] = {
      paramId,
      paramName: MOTION_PARAM_NAMES[paramId] ?? `Param ${paramId}`,
      enabled,
      values,
    };
  }

  return {
    index,
    sampleId,
    volume,
    pan,
    pitch,
    fxSend,
    steps,
    motion,
  };
}

function parsePatternBlock(reader: SafeReader, indexHint: number): ParsedPattern {
  const name       = reader.ascii(8, `pattern[${indexHint}].name`);
  const bpmRaw     = reader.u16LE(`pattern[${indexHint}].bpm`);
  const stepLength = reader.u8(`pattern[${indexHint}].stepLength`);
  const swing      = reader.u8(`pattern[${indexHint}].swing`);
  reader.skip(4, `pattern[${indexHint}].reserved`);

  // BPM-Decode: fixed-point /10. Auf den valid Range klemmen, falls Garbage drin steht.
  let bpm = bpmRaw / 10;
  if (!Number.isFinite(bpm) || bpm < ELECTRIBE_MIN_BPM) bpm = ELECTRIBE_MIN_BPM;
  if (bpm > ELECTRIBE_MAX_BPM) bpm = ELECTRIBE_MAX_BPM;

  // StepLength-Klamp: 16/32/64 sind die einzigen Hardware-validen Werte.
  let validStepLength: number = stepLength;
  if (validStepLength !== 16 && validStepLength !== 32 && validStepLength !== 64) {
    validStepLength = 16;
  }

  const parts: ParsedPart[] = new Array(PARTS_PER_PATTERN);
  for (let p = 0; p < PARTS_PER_PATTERN; p++) {
    parts[p] = parsePartBlock(reader, p);
  }

  return {
    name: name || `PATTERN_${indexHint + 1}`,
    bpm,
    stepLength: validStepLength,
    swing,
    parts,
  };
}

// ─── Public-API ──────────────────────────────────────────────────────────────

/**
 * Erkennt das Format anhand der ersten Bytes + Pattern-Count.
 *
 * @returns "pattern" fuer single .e2pattern/.e2spat, "bank" fuer .e2sallpat.
 *          Wirft Error wenn Magic fehlt.
 */
export function detectElectribeFormat(input: ArrayBuffer | Uint8Array | DataView): "pattern" | "bank" {
  const view = toDataView(input);
  if (view.byteLength < BANK_HEADER_SIZE) {
    throw new Error("Electribe-Parser: Datei zu klein (< 8 Bytes Header).");
  }

  // v3.11: .e2sallpat Multi-Pattern-Bank (KORG hardware-fixed 250 Slots, ~4 MB).
  if (isElectribeAllPatBank(view)) {
    return "bank";
  }

  // Real-Files (.e2spat) sind immer single-pattern (16640 Bytes).
  if (isRealElectribeFile(view)) {
    return "pattern";
  }

  // Legacy/Synthetic: Magic + count
  const reader = new SafeReader(view);
  const magic  = reader.ascii(4, "magic");
  if (magic !== ELECTRIBE_MAGIC) {
    throw new Error(`Electribe-Parser: ungueltiges Magic "${magic}", erwartet "${ELECTRIBE_MAGIC}".`);
  }
  reader.u16LE("version");
  const count = reader.u16LE("patternCount");
  if (count <= 1) return "pattern";
  return "bank";
}

/**
 * Parst eine `.e2sallpat`-Bank, `.e2pattern`/`.e2spat`-Single-Datei oder
 * einen synthetisch erzeugten Buffer mit dem Legacy-Layout.
 *
 * @throws Error bei invalid Magic, out-of-bounds, oder Pattern-Count > 250.
 */
export function parseElectribeBank(input: ArrayBuffer | Uint8Array | DataView): ParsedElectribeBank {
  const view = toDataView(input);
  if (view.byteLength > MAX_ELECTRIBE_FILE_BYTES) {
    throw new Error(`Electribe-Parser: Datei zu gross (${view.byteLength} > ${MAX_ELECTRIBE_FILE_BYTES}).`);
  }
  if (view.byteLength < BANK_HEADER_SIZE) {
    throw new Error("Electribe-Parser: Datei zu klein (< 8 Bytes Header).");
  }

  // ── v3.11.0: .e2sallpat Multi-Pattern-Bank (250 Slots) ─────────────────
  if (isElectribeAllPatBank(view)) {
    return parseElectribeAllPatBank(view);
  }

  // ── Real-File-Layout (verified, single .e2spat) ────────────────────────
  if (isRealElectribeFile(view)) {
    // Version aus Offset 0x20 (u32 LE).
    const version = view.byteLength >= 0x24 ? view.getUint32(0x20, true) : 1;
    const pattern = parseRealPattern(view);
    return {
      version,
      patternCount: 1,
      patterns: [pattern],
    };
  }

  // ── Legacy/Synthetic-Layout (Tests + altes Format) ─────────────────────
  const reader = new SafeReader(view);
  const magic  = reader.ascii(4, "magic");
  if (magic !== ELECTRIBE_MAGIC) {
    throw new Error(`Electribe-Parser: ungueltiges Magic "${magic}", erwartet "${ELECTRIBE_MAGIC}".`);
  }
  const version       = reader.u16LE("version");
  const patternCount  = reader.u16LE("patternCount");

  if (patternCount < 0 || patternCount > MAX_PATTERNS_PER_BANK) {
    throw new Error(`Electribe-Parser: ungueltige Pattern-Anzahl ${patternCount} (max ${MAX_PATTERNS_PER_BANK}).`);
  }

  // Pflicht-Plausibilitaet: bleibt mindestens patternCount * PATTERN_BLOCK_SIZE Bytes uebrig?
  const expectedBytes = patternCount * PATTERN_BLOCK_SIZE;
  if (reader.remaining() < expectedBytes) {
    throw new Error(
      `Electribe-Parser: Datei zu kurz fuer ${patternCount} Patterns — ` +
      `brauche ${expectedBytes} Bytes, habe ${reader.remaining()} Bytes uebrig.`,
    );
  }

  const patterns: ParsedPattern[] = new Array(patternCount);
  for (let i = 0; i < patternCount; i++) {
    patterns[i] = parsePatternBlock(reader, i);
  }

  return { version, patternCount, patterns };
}

/**
 * Parst eine `.e2pattern`/`.e2spat`-Datei (oder die erste Pattern aus einer Bank).
 *
 * @throws Error bei invalid Magic oder leerer Bank.
 */
export function parseElectribePattern(input: ArrayBuffer | Uint8Array | DataView): ParsedPattern {
  const bank = parseElectribeBank(input);
  if (bank.patternCount < 1 || bank.patterns.length === 0) {
    throw new Error("Electribe-Parser: Datei enthaelt keine Patterns.");
  }
  return bank.patterns[0];
}

// ─── Konvertierung zu Synthstudio-Format ─────────────────────────────────────

/**
 * Output der Konvertierung — keine direkte Store-Modifikation, der Aufrufer
 * verteilt die Daten:
 *
 *   - `drumParts` → useDrumMachineStore.setPartSteps()
 *   - `automationLanes` → useAutomationStore.addLane() + setPoint()
 *   - `bpm` → useDrumMachineStore.setPatternBpm() oder global setBpm
 *   - `name` → useDrumMachineStore.renamePattern()
 */
export interface SynthstudioPatternImport {
  /** Pattern-Anzeigename. */
  name: string;
  /** BPM (z.B. 120.0). */
  bpm: number;
  /** Pattern-Step-Count (16, 32 oder 64 — Hardware-64 wird ab v3.39 voll übernommen). */
  stepCount: 16 | 32 | 64;
  /** Swing 0..100 (aktuell Info-only — Synthstudio hat eigenes Groove-System). */
  swing: number;
  /**
   * Pro Electribe-Part ein Objekt:
   *   - partIndex: 0..15 → mappt 1:1 auf Drum-Parts-Index (8 Drums + 6 Synths + 2 Stretch)
   *   - sampleId: Original-Electribe-Sample-Patch (NICHT geladen — nur Meta)
   *   - steps[stepCount] boolean trigger
   *   - velocities[stepCount] 0..127
   *   - volume / pan (0..1 bzw. -1..+1 normalisiert)
   */
  drumParts: Array<{
    partIndex: number;
    sampleId: number;
    sampleHint: string;
    volume: number;
    pan: number;
    pitchSemitones: number;
    steps: boolean[];
    velocities: number[];
  }>;
  /**
   * Automation-Lanes aus den Motion-Sequencer-Slots. Pro aktiviertem Slot
   * eine Lane mit interpolierten Werten.
   */
  automationLanes: Array<{
    /** Vorgeschlagenes useAutomationStore-Target — bewusst informativ, der Aufrufer
     *  entscheidet ob er es so uebernimmt oder z.B. auf "fxParam"-Routing umwirft. */
    target: string;
    label: string;
    /** Sparse-Map step → value (0..1 normalisiert). */
    points: Record<number, number>;
    /** Min/Max (immer 0..1 fuer Motion-Slot-Werte). */
    min: number;
    max: number;
  }>;
}

/**
 * Konvertiert ein geparstes Electribe-Pattern in das Synthstudio-Import-Format.
 *
 * Annahmen:
 *   - Velocity-Skala 0..127 wird beibehalten (Synthstudio verwendet auch 0..127).
 *   - Volume 0..127 → 0..1.
 *   - Pan 0..127 (64=center) → -1..+1.
 *   - Pitch -64..+63 bleibt unveraendert.
 *   - StepCount 64 wird auf 32 geclampt (Synthstudio max ist 32).
 */
export function convertParsedPatternToSynthstudio(parsed: ParsedPattern): SynthstudioPatternImport {
  // v3.39: StepCount-Mapping: Hardware 16 → 16, 32 → 32, 64 → 64 (vorher capped 64→32).
  // Synthstudio unterstützt seit v3.39.0 native 64-Step-Patterns (KORG-Parität).
  const stepCount: 16 | 32 | 64 =
    parsed.stepLength >= 64 ? 64 : parsed.stepLength >= 32 ? 32 : 16;
  const cap = Math.min(stepCount, parsed.stepLength);

  const drumParts: SynthstudioPatternImport["drumParts"] = parsed.parts.map(p => {
    // Velocity-Bit aus Step-Byte trennen → eigene velocity-Arrays.
    const stepsArr     = new Array<boolean>(stepCount).fill(false);
    const velocitiesArr = new Array<number>(stepCount).fill(100);
    for (let s = 0; s < cap; s++) {
      stepsArr[s]      = p.steps[s].active;
      velocitiesArr[s] = p.steps[s].velocity > 0 ? p.steps[s].velocity : 100;
    }
    // Sample-Hint Label: "Part 1" / "Synth 9" etc. Index 0..7 = Drum, 8..13 = Synth, 14..15 = Stretch.
    let sampleHint: string;
    if (p.index < 8) sampleHint = `Drum ${p.index + 1}`;
    else if (p.index < 14) sampleHint = `Synth ${p.index - 7}`;
    else sampleHint = `Stretch ${p.index - 13}`;

    return {
      partIndex: p.index,
      sampleId: p.sampleId,
      sampleHint,
      volume: clamp01(p.volume / 127),
      pan: clampPan((p.pan - 64) / 63),
      pitchSemitones: p.pitch,
      steps: stepsArr,
      velocities: velocitiesArr,
    };
  });

  // Automation-Lanes aus aktivierten Motion-Slots.
  // v2.88 — Legacy: Per-Part-Motion (synthetisches Layout).
  // v3.15 — Real-File-Pattern-Motion (8 Slots pro Pattern).
  const automationLanes: SynthstudioPatternImport["automationLanes"] = [];

  // 1) Legacy per-Part-Motion (synthetic test layout).
  for (const part of parsed.parts) {
    for (let m = 0; m < part.motion.length; m++) {
      const slot = part.motion[m];
      if (!slot.enabled) continue;
      const points: Record<number, number> = {};
      for (let v = 0; v < slot.values.length; v++) {
        points[v] = clamp01(slot.values[v] / 127);
      }
      automationLanes.push({
        // Best-Effort-Target — der Aufrufer kann diesen String parsen.
        // Format: "<paramName>:<partIndex>" damit klar ist wer die Lane besitzt.
        target: `${slot.paramName}:${part.index}`,
        label: `${slot.paramName} (Part ${part.index + 1})`,
        points,
        min: 0,
        max: 1,
      });
    }
  }

  // 2) v3.15.0: Pattern-Level-Motion-Slots (Real-Files mit 8 Slots).
  //    Hier ist values.length=64, wir cappen auf stepCount damit die Lane
  //    in das Synthstudio-Pattern passt.
  if (parsed.patternMotion) {
    for (let i = 0; i < parsed.patternMotion.length; i++) {
      const slot = parsed.patternMotion[i];
      if (!slot.enabled) continue;
      const points: Record<number, number> = {};
      // 64 → stepCount: truncate. Steht keine Lane-Stretching-Logik im
      // Aufrufer, weil 16/32 → 64 ueblicherweise ein Stretching erfordert.
      // Synthstudio kennt nur 16/32 Lanes; Wir geben den FULL 64-Sample-
      // Vector zurueck via separates Feld? Nein — Aufrufer entscheidet.
      // Aktuell: cap auf stepCount.
      const cap = Math.min(stepCount, slot.values.length);
      for (let v = 0; v < cap; v++) {
        points[v] = clamp01(slot.values[v] / 127);
      }
      // Target-String: "<paramName>:slot<i>:part<targetPart>" damit der
      // Aufrufer paramId + Ziel-Part-Index auseinanderlesen kann.
      const targetSuffix = slot.targetPart >= 0
        ? `part${slot.targetPart}`
        : `global${slot.rawTarget}`;
      automationLanes.push({
        target: `${slot.paramName}:slot${i}:${targetSuffix}`,
        label: slot.targetPart >= 0
          ? `${slot.paramName} (Slot ${i + 1} → Part ${slot.targetPart + 1})`
          : `${slot.paramName} (Slot ${i + 1} → global)`,
        points,
        min: 0,
        max: 1,
      });
    }
  }

  return {
    name: parsed.name,
    bpm: parsed.bpm,
    stepCount,
    swing: parsed.swing,
    drumParts,
    automationLanes,
  };
}

// ─── Kleine Helper (intern + exportiert fuer Tests) ─────────────────────────

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

export function clampPan(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < -1) return -1;
  if (value > 1) return 1;
  return value;
}

/**
 * Validation-Helper fuer den IPC-Layer (Electron) / File-Drop (Browser).
 * Prueft nur die ersten 4 Bytes — keine vollstaendige Parser-Validierung.
 */
export function looksLikeElectribeFile(buffer: ArrayBuffer | Uint8Array): boolean {
  try {
    const view = toDataView(buffer);
    if (view.byteLength < BANK_HEADER_SIZE) return false;
    const reader = new SafeReader(view);
    const magic  = reader.ascii(4, "magic");
    return magic === ELECTRIBE_MAGIC;
  } catch {
    return false;
  }
}

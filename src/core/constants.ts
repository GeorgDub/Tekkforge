/**
 * Synthstudio – KORG ESX-1 + E2S Format-Konstanten (v3.3.0)
 *
 * Port aus dem Python-Tool `G:/IdeaProjects/Korg Editor`.
 * SoT: G:/IdeaProjects/Korg Editor/esx_e2s_editor/constants.py (alle Werte verifiziert
 * gegen Open Electribe Editor v1.2.0 + Oe2sSLE + Real-User-Files 2026-05-17/18).
 *
 * READ-ONLY-SCOPE: Diese Konstanten sind für den Parser-Pfad ausreichend.
 * Write-spezifische Werte (z.B. KORG_BODY_DECLARED_SIZE, KORG_BODY_VERSION_WORD)
 * sind hier dennoch vorhanden, damit ein späterer Builder (v3.4) sie reuses,
 * aber die Reader benutzen nur die Offsets.
 *
 * Endianness:
 *   - ESX-1 .esx: alle Multi-Byte-Felder BIG-ENDIAN (Korg-Device-Konvention)
 *   - E2S  .all: alle Multi-Byte-Felder LITTLE-ENDIAN (RIFF/WAVE-Konvention)
 *
 * Die Konstanten sind als `const` mit numerischen Literals deklariert, damit
 * TS die Werte für Tests inlineable hält und die Whole-Module-Type-Inference
 * keine readonly Tuple-Type-Pollution erzeugt.
 */

// ─── ESX-1 device limits ──────────────────────────────────────────────────────
// SoT: constants.py:11-21
export const ESX1_MAX_MONO_SLOTS = 256;
export const ESX1_MAX_STEREO_SLOTS = 128;
export const ESX1_MAX_TOTAL_SLOTS = ESX1_MAX_MONO_SLOTS + ESX1_MAX_STEREO_SLOTS; // 384
/** On-disk ASCII name-field width per sample header (mono + stereo). Device-UI zeigt 12,
 *  aber nur 8 landen on disk. */
export const ESX1_NAME_MAX_CHARS = 8;
export const ESX1_HEADER_SIZE = 0x100;

// ─── ESX-1 .esx file layout ───────────────────────────────────────────────────
// SoT: constants.py:23-63 (vs Open Electribe Editor EsxUtil.java)
/** 4-byte header magic at offset 0x0000. ASCII "KORG". */
export const ESX1_SIGNATURE = new Uint8Array([0x4b, 0x4f, 0x52, 0x47]); // "KORG"
export const ESX1_SUBMAGIC_OFFSET = 0x0008;
/** Sub-magic "ESX\0" bei 0x0008 confirms file is an ESX-1 backup. */
export const ESX1_SUBMAGIC = new Uint8Array([0x45, 0x53, 0x58, 0x00]); // "ESX\0"

export const ESX1_ADDR_GLOBAL_PARAMETERS = 0x00000020;
export const ESX1_ADDR_PATTERN_DATA = 0x00000200;
export const ESX1_ADDR_SONG_DATA = 0x00130000;
export const ESX1_ADDR_SONG_EVENT_DATA = 0x00138400;
/** Second KORG-sig check. Bytes "KORG\x00\x00\x00\x71BPS\x00" → sample-directory follows. */
export const ESX1_ADDR_VALID_CHECK_2 = 0x001b0000;
/** u32 BE counters folgen nach dem Sub-Magic. */
export const ESX1_ADDR_NUM_MONO_SAMPLES = 0x001b0020;
export const ESX1_ADDR_NUM_STEREO_SAMPLES = 0x001b0024;
export const ESX1_ADDR_SAMPLE_HEADER_MONO = 0x001b0100;
export const ESX1_ADDR_SAMPLE_HEADER_STEREO = 0x001b2900;
export const ESX1_ADDR_SLICE_DATA = 0x001b4200;
/** Start des PCM-Payload-Bereichs. Alle Header offsetChannel*-Felder sind relativ zu dieser Adresse. */
export const ESX1_ADDR_SAMPLE_DATA = 0x00250000;

export const ESX1_CHUNKSIZE_GLOBAL_PARAMETERS = 192;
export const ESX1_CHUNKSIZE_PATTERN = 4280;
export const ESX1_NUM_PATTERNS = 256;
export const ESX1_CHUNKSIZE_SONG = 528;
export const ESX1_CHUNKSIZE_SONG_EVENT = 8;
export const ESX1_NUM_SONGS = 64;
export const ESX1_CHUNKSIZE_SAMPLE_HEADER_MONO = 40;
export const ESX1_CHUNKSIZE_SAMPLE_HEADER_STEREO = 44;
export const ESX1_CHUNKSIZE_SLICE_DATA = 2048;
/** 12,582,912 = 24 MB / 2 (16-bit-Frames). Hardware-Datasheet-Wert. */
export const ESX1_MAX_SAMPLE_MEM_IN_FRAMES = 0xc00000;
/**
 * Hardware-Datasheet Sample-Memory-Cap = 24 MiB (25,165,824 Bytes).
 *
 * v3.90.0: Real-File-Variabilität — KASSEL.esx hat 25,166,068 Bytes PCM
 * (244 Bytes Overshoot vs. 24-MiB-Datasheet-Wert). Die Hardware-Spec
 * scheint einen kleinen Slack zu erlauben (Rounding/Padding). Wir
 * erlauben deshalb defensiv bis 25 MiB (= 26,214,400 Bytes; ~1 MiB
 * Headroom) BEVOR wir throwen.
 *
 * Real-Hardware: Korg ESX-1 hat 24 MiB SD-Card-quantized Sample-RAM, aber
 * der File-Container kann ein paar hundert Bytes Padding tolerieren.
 */
export const ESX1_MAX_SAMPLE_MEM_IN_BYTES = ESX1_MAX_SAMPLE_MEM_IN_FRAMES * 2;
/**
 * v3.90.0: Soft-Cap mit Tolerance fuer Real-Files (default = +1 MiB).
 *
 * Files <= ESX1_MAX_SAMPLE_MEM_IN_BYTES → no warning, no error.
 * Files in (cap..ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES] → warning + continue.
 * Files > soft-limit → EsxParseError (defense in depth).
 */
export const ESX1_SAMPLE_MEM_SOFT_LIMIT_BYTES = 25 * 1024 * 1024; // 26,214,400
/** Absolute Min-Dateigröße: Header + Tables + min. 1 PCM-Frame. */
export const ESX1_SIZE_FILE_MIN = 0x00250010;
/** Sentinel im offsetChannel*-Feld: Slot ist leer. */
export const ESX1_EMPTY_OFFSET = 0xffffffff;

// ─── E2S device limits ────────────────────────────────────────────────────────
/**
 * Adressierbare Sample-Slots in einer `.all`. Die Offset-Tabelle füllt das
 * Fenster `E2S_ALL_OFFSET_TABLE_START`..`E2S_ALL_SAMPLE_AREA_START` exakt aus:
 * `0x0010 + 1020 * 4 === 0x1000`.
 *
 * Der Tabellen-Index IST die Geräte-Sample-Nummer: `i === esli.OSC_0index`
 * (siehe `ESLI_OSC_INDEX_OFFSET`). Diese Redundanz ist die einzige Prüfung, die
 * eine falsche Tabellen-Startadresse überhaupt auffliegen lässt — der Reader
 * meldet Abweichungen, siehe `E2sSlotNumbering` in `e2sBankReader.ts`.
 */
export const E2S_MAX_SLOTS = 1020;
/**
 * Höchster Slot-Index, den das Geräte-UI als wählbaren Sample-Platz zeigt
 * (exklusiv). Die restlichen Tabellen-Einträge bleiben reserviert.
 */
export const E2S_SLOT_INDEX_MAX = 1000;
/**
 * Anzeige am Gerät = `esli.OSC_0index` + dieser Versatz. Der Tabellenindex ist
 * für die ANZEIGE irrelevant — das Gerät zählt nach dem Nummernfeld.
 *
 * ✔ Am Gerät abgelesen (SLOTNUM2.all, 2026-08-15) mit ENTKOPPELTEM Index/OSC:
 *
 *     Index 499, OSC 551  →  Anzeige 552
 *     Index 549, OSC 502  →  Anzeige 503
 *     Index 520, OSC 520  →  Anzeige 521
 *
 * Die erste SLOTNUM-Messung (2026-08-14) konnte das nicht sehen, weil dort
 * OSC = Index + 1 gekoppelt war — „Anzeige = Index + 2" und „Anzeige = OSC + 1"
 * sagten dieselben Zahlen voraus. Entschieden hat die vom Gerät selbst
 * geschriebene e2sSample.all (User-Samples auf Index == OSC == 500..) plus die
 * entkoppelte Probe.
 *
 * Geräte-Konvention fürs BAUEN: Tabellenindex == OSC_0index (== Anzeige − 1).
 * Helfer in e2sPatternSampleLink.ts — nie als nacktes `± 1` an der Fundstelle.
 */
export const E2S_DISPLAY_OSC_SHIFT = 1;
/** Maximum user-visible sample name length im Device-UI; on-disk speichert das
 *  korg-chunk nur 16 Bytes (ESLI_NAME_LEN). */
export const E2S_NAME_MAX_CHARS = 24;
/**
 * Obergrenze für die Summe aller PCM-Daten einer Bank — reiner Schutz gegen
 * Speicher-Explosion beim Bauen, NICHT das Gerätelimit. Bewusst weit: ein
 * Absenken würde Bänke zurückweisen, die sich bisher bauen ließen. Das echte
 * Gerätelimit wird stattdessen gewarnt, siehe `E2S_DEVICE_PCM_WARN_BYTES`.
 */
export const E2S_MAX_TOTAL_PCM_BYTES = 224 * 1024 * 1024; // ~224 MB
/**
 * Ab hier wird gewarnt, nicht abgelehnt: das reale Sample-Speicher-Limit des
 * Geräts.
 *
 * Warum Warnung und nicht harte Grenze — beides wäre für sich falsch: bei
 * 224 MB baut man stumm Bänke, die das Gerät nicht lädt; eine harte Absenkung
 * auf 24 MB wäre eine Regression für bestehende Nutzung.
 *
 * Empirisch gestützt (Synthstudio, 2026-07-27, Bestand aus 47 realen Bänken):
 * die größten liegen bei 24.037.610 B — knapp *unter* dieser Schwelle. Keine
 * gemessene Gerätedatei überschreitet sie.
 */
export const E2S_DEVICE_PCM_WARN_BYTES = 24 * 1024 * 1024; // 24 MiB
export const E2S_GLOBAL_SECTION_SIZE = 256;

// ─── E2S `.all` container layout ──────────────────────────────────────────────
// SoT: constants.py:76-85 (verified gegen e2sSample.all 2026-05-17)
/** 16-byte signature: "e2s sample all\x1a\x00". */
export const E2S_ALL_SIGNATURE = new Uint8Array([
  0x65, 0x32, 0x73, 0x20, // "e2s "
  0x73, 0x61, 0x6d, 0x70, // "samp"
  0x6c, 0x65, 0x20, 0x61, // "le a"
  0x6c, 0x6c, 0x1a, 0x00, // "ll\x1a\0"
]);
export const E2S_ALL_SIGNATURE_LEN = E2S_ALL_SIGNATURE.length; // 16
/**
 * Startadresse der Offset-Tabelle in der `.all`. 1020 LE32-Einträge, endet
 * exakt auf `E2S_ALL_SAMPLE_AREA_START`. Ein Eintrag 0 heißt: Slot leer.
 *
 * SoT: Oe2sSLE `e2s_sample_all.py` — `load()` liest 4080 Bytes ab `0x0010`,
 * der Zeiger eines Samples ist `read_u32(0x10 + i * 4)`, und der Index i ist
 * die 0-basierte Geräte-Sample-Nummer (`esli.OSC_0index`).
 *
 * ## Der verworfene Vorgängerwert `0x07E0` mit 250 Einträgen
 *
 * Er sah plausibel aus: die Werks-Referenzdatei hat ihr erstes Sample bei
 * OSC_0index 500, und `0x0010 + 500 * 4 === 0x07E0`. Der erste *nicht-null*
 * Eintrag stand also genau dort — die Tabelle schien da zu beginnen, und die
 * 500 Nullen davor gingen als „reserved padding" durch. Eine Zwischenstufe
 * `0x0058`/1002 war ebenfalls falsch; ein verschobener Tabellenstart liefert
 * **dieselben Offset-Werte**, nur unter falschen Indizes.
 *
 * ## Was die Frage entscheidet
 *
 * Nicht die Fenstergröße — `0x0010 + 1020 * 4` und `0x0058 + 1002 * 4` ergeben
 * beide exakt `0x1000`. Entscheidend ist allein `esli.OSC_0index`: die Datei
 * trägt die Sample-Nummer ein zweites Mal, im korg-Chunk jedes Slots. Nur bei
 * `0x0010` stimmen Tabellen-Index und OSC_0index überein.
 *
 * Belegt über 47 reale Bänke (Synthstudio/Omnitribe) und hier nachgemessen:
 * `cm.all` 324/324, `666.all` 154/154 Treffer bei `0x0010`, 0/324 bzw. 0/154
 * bei `0x07E0` und `0x0058`.
 *
 * Offen (bewusst nicht behauptet): ob die Slots 0..17 Factory-Plätze sind oder
 * nur ungenutzt. Keine der konsistenten Bänke belegt sie — die Deutung
 * „`0x0010` liest 18 Factory-Slots mit" ist empirisch unbelegt.
 */
export const E2S_ALL_OFFSET_TABLE_START = 0x0010;
/** 1020 × LE32 = 4080 B. Füllt 0x0010..0x1000 exakt aus. */
export const E2S_ALL_OFFSET_TABLE_BYTES = E2S_MAX_SLOTS * 4; // 4080
export const E2S_ALL_SAMPLE_AREA_START = 0x1000;

// ─── korg/esli sub-chunk inside each E2S RIFF/WAVE ───────────────────────────
// SoT: constants.py:87-126 (Oe2sSLE RIFF_korg_esli)
/** "korg" sub-chunk-ID. */
export const KORG_SUBCHUNK_ID = new Uint8Array([0x6b, 0x6f, 0x72, 0x67]);
/** Total body size of the korg sub-chunk (1180 bytes = 'esli'+size+version+payload). */
export const KORG_SUBCHUNK_BODY_SIZE = 1180;
/** "esli" sub-magic am Anfang des korg-bodies. */
export const KORG_BODY_SUBMAGIC = new Uint8Array([0x65, 0x73, 0x6c, 0x69]);
export const KORG_BODY_DECLARED_SIZE = 0x0494; // 1172
/**
 * @deprecated v3.271: war fälschlich als "version" bei esli +0x08 geschrieben.
 * Laut Oe2sSLE-Struktur (e2s_sample_all.RIFF_korg_esli) ist +0x08 das Feld
 * `OSC_0index` = die vom Gerät angezeigte Sample-Nummer (NICHT konstant). Der
 * Wert 0x01F4=500 war nur die Nummer des Referenz-Samples, aus dem die
 * Konstante abgeleitet wurde. Nicht mehr beim Bauen schreiben.
 */
export const KORG_BODY_VERSION_WORD = 0x01f4;

// Field offsets WITHIN the 1180-byte korg body (start = 'esli'). Lead-in:
// 'esli'(4) + declared_size LE32(4) = 8 bytes, dann OSC_0index.
// v3.271 (Oe2sSLE-verifiziert): die Sample-Nummer steht DOPPELT — bei +0x08
// (OSC_0index) UND +0x56 (OSC_0index1), identisch + aufsteigend. Das Gerät
// liest +0x08; ohne korrektes +0x08 zeigt es alle Samples unter derselben Nr.
export const ESLI_OSC_INDEX_OFFSET = 0x08; // u16 LE — OSC_0index (Sample-Nummer)
export const ESLI_NAME_OFFSET = 0x0a; // 16-byte ASCII
export const ESLI_NAME_LEN = 16;
export const ESLI_CATEGORY_OFFSET = 0x1a; // u16 LE
// v3.271 (Oe2sSLE: OSC_importNum): in echten Bänken stets = OSC_0index + 50.
export const ESLI_IMPORT_NUM_OFFSET = 0x1c; // u16 LE
// v3.271 (Oe2sSLE: playLogPeriod): frequenzabhängige Abspielrate/Tonhöhe.
// 22050→18808, 44100→15736, 48000→15360 (halbe Frequenz = +3072 → log-Period).
// OHNE dies hat das Sample keine definierte Rate → Gerät spielt/lädt es nicht.
export const ESLI_PLAY_LOG_PERIOD_OFFSET = 0x2a; // u16 LE
export const ESLI_PLAY_VOLUME_OFFSET = 0x2c; // u16 LE
export const ESLI_START_POINT_OFFSET = 0x30; // u32 LE (OSC_StartPoint_address, bytes; 0 = start)
export const ESLI_LOOP_START_OFFSET = 0x34; // u32 LE (OSC_LoopStartPoint_offset, bytes)
export const ESLI_END_OFFSET = 0x38; // u32 LE (OSC_EndPoint_offset = last-frame addr, bytes)
// v3.271 (Oe2sSLE: WAV_dataSize): die Sample-Daten-Bytegröße. OHNE dieses Feld
// behandelt das Gerät das Sample als leer → "importiert, aber nichts geladen".
export const ESLI_WAV_DATA_SIZE_OFFSET = 0x44; // u32 LE (= 'data'-Chunk-Größe)
export const ESLI_ONESHOT_OFFSET = 0x3c; // u8 bool
export const ESLI_USE_CHAN0_OFFSET = 0x48; // u8
export const ESLI_USE_CHAN1_OFFSET = 0x49; // u8 bool (stereo)
export const ESLI_PLUS12DB_OFFSET = 0x4a; // u8 bool
export const ESLI_SAMPLING_FREQ_OFFSET = 0x50; // u32 LE
export const ESLI_SAMPLE_TUNE_OFFSET = 0x55; // i8
// v3.271 (Oe2sSLE: OSC_0index1): zweite Kopie der Sample-Nummer (u16 LE).
// Muss identisch zu OSC_0index @ +0x08 sein — echte .all-Files haben beide
// gleich + aufsteigend (z.B. spul.all: 501,502,…). Verifiziert gegen Real-Files.
export const ESLI_SAMPLE_INDEX_OFFSET = 0x56; // u16 LE — OSC_0index1 (Duplikat)
export const ESLI_SLICES_OFFSET = 0x58; // 64×16B = 1024B
export const ESLI_SLICES_COUNT = 64;
export const ESLI_SLICE_STRUCT_SIZE = 16; // 4 × LE32 (start, length, attack, amplitude)
export const ESLI_SLICE_STEPS_OFFSET = 0x458; // 64-byte step pattern
export const ESLI_SLICE_STEPS_LEN = 64;
export const ESLI_SLICING_NUM_STEPS_OFFSET = 0x498; // u8
export const ESLI_SLICING_BEAT_OFFSET = 0x499; // u8
export const ESLI_SLICES_NUM_ACTIVE_OFFSET = 0x49a; // u8

// ─── Sample category names (E2S/ESX-1) ────────────────────────────────────────
// SoT: constants.py:127-146 — Reihenfolge MUSS exakt erhalten bleiben (Index = Wire-Value)
export const E2S_CATEGORY_NAMES = [
  "Analog",
  "Audio In",
  "Kick",
  "Snare",
  "Clap",
  "HiHat",
  "Cymbal",
  "Hits",
  "Shots",
  "Voice",
  "SE",
  "FX",
  "Tom",
  "Perc.",
  "Phrase",
  "Loop",
  "PCM",
  "User",
] as const;

export type E2sCategory = (typeof E2S_CATEGORY_NAMES)[number];

/** Mappt eine 0-17 Kategorie-ID auf den Display-Namen. Out-of-range → "User". */
export function e2sCategoryName(idx: number): E2sCategory {
  if (idx >= 0 && idx < E2S_CATEGORY_NAMES.length) {
    return E2S_CATEGORY_NAMES[idx];
  }
  return "User";
}

// ─── Audio spec ───────────────────────────────────────────────────────────────
// SoT: constants.py:148-156
export const E2S_SAMPLE_RATES = [44_100, 48_000] as const;
export const E2S_BIT_DEPTH = 16;
export const E2S_CHANNELS_ALLOWED = [1, 2] as const;
/** Hardening-Cap pro Slot. */
export const MAX_BYTES_PER_SLOT = 10 * 1024 * 1024; // 10 MB
/** RIFF-Chunk-Resource-Cap: MAX_BYTES_PER_SLOT + ample header-overhead. */
export const E2S_MAX_RIFF_BYTES = MAX_BYTES_PER_SLOT + 64 * 1024;

// ─── Loop modes (E2S) ─────────────────────────────────────────────────────────
// SoT: constants.py:170-173
export const LOOP_TYPE_OFF = 0;
export const LOOP_TYPE_ONESHOT = 1;
export const LOOP_TYPE_FORWARD = 2;
export type LoopType = 0 | 1 | 2;

// ─── Synthstudio file-size hardening (additional zu Python-Caps) ─────────────
/** Maximum acceptable .esx file size before we refuse to parse (defense in depth). */
export const ESX_FILE_MAX_BYTES = 64 * 1024 * 1024; // 64 MB
/** Maximum acceptable .all file size before we refuse to parse. */
export const E2S_FILE_MAX_BYTES = 512 * 1024 * 1024; // 512 MB
/** Maximum the IPC layer will ship from disk to renderer. */
export const KORG_BANK_IPC_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

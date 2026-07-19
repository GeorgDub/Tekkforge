/**
 * e2sysex.ts — KORG Electribe 2 SysEx-Protokoll (Pattern-Transfer zum/vom Gerät).
 *
 * Protokoll + KORG-8↔7-Bit-Codec portiert nach der Referenz-Implementierung
 * bangcorrupt/hacktribe(-editor) (GPL-3.0). Da diese Software rein privat
 * genutzt wird, ist die Übernahme unproblematisch; bei einer etwaigen
 * Weitergabe wäre die GPL-Herkunft zu kennzeichnen.
 *
 * Nachricht: F0 42 (0x30|ch) 00 01 <id> <msgId> <body…> F7
 *   - 0x42            KORG Manufacturer ID
 *   - 0x30|ch         Global-Channel (ch = 0..15)
 *   - 00 01 <id>      Product-ID; id = 0x23 (Synth E2) | 0x24 (Sampler E2S)
 *   - <msgId>         siehe E2_MSG
 * Device-Search (id-/channel-Erkennung): F0 42 50 00 00 F7
 *   → Antwort F0 42 50 01 <ch> ?? <id> ?? ?? ?? <verMaj> <verMin> … F7
 */

export const KORG_MANUFACTURER_ID = 0x42;
export const SYSEX_START = 0xf0;
export const SYSEX_END = 0xf7;
export const SEARCH_REQUEST = 0x50;

/** Electribe-2-Produkt-IDs (niederwertiges Byte hinter `00 01`). */
export const E2_PRODUCT_ID_SYNTH = 0x23;
export const E2_PRODUCT_ID_SAMPLER = 0x24;

/** SysEx-Funktions-Codes (msgId). */
export const E2_MSG = {
  currentPatternRequest: 0x10,
  patternRequest: 0x1c,
  globalRequest: 0x0e,
  patternWrite: 0x11,
  currentPatternDump: 0x40,
  patternDump: 0x4c,
  globalDump: 0x51,
  // Bestätigungen vom Gerät (hacktribe ht_sysex_format):
  writeComplete: 0x21,
  writeError: 0x22,
  dataLoadComplete: 0x23,
  dataLoadError: 0x24,
  dataFormatError: 0x26,
} as const;

/** ACK-Codes, die einen erfolgreichen Schritt melden. */
export const E2_ACK_OK: ReadonlySet<number> = new Set([
  E2_MSG.writeComplete,
  E2_MSG.dataLoadComplete,
]);
/** ACK-Codes, die einen Fehler melden. */
export const E2_ACK_ERROR: ReadonlySet<number> = new Set([
  E2_MSG.writeError,
  E2_MSG.dataLoadError,
  E2_MSG.dataFormatError,
]);

/**
 * Parst eine kurze Status-/ACK-Antwort (F0 42 3g 00 01 id <msgId> F7).
 * Gibt die msgId zurück oder null, wenn kein KORG-E2-Frame.
 */
export function parseAck(bytes: Uint8Array): number | null {
  if (bytes.length < 8) return null;
  if (bytes[0] !== SYSEX_START || bytes[1] !== KORG_MANUFACTURER_ID) return null;
  if ((bytes[2] & 0xf0) !== 0x30) return null;
  if (bytes[3] !== 0x00 || bytes[4] !== 0x01) return null;
  return bytes[6];
}

export interface E2SysexOptions {
  /** Global-MIDI-Channel 0..15 (Gerät-Default 0 = Ch 1). */
  channel?: number;
  /** Produkt-ID; Default Sampler (0x24). */
  productId?: number;
}

function head(opts: E2SysexOptions = {}): number[] {
  const ch = Math.min(15, Math.max(0, opts.channel ?? 0));
  const id = opts.productId ?? E2_PRODUCT_ID_SAMPLER;
  return [SYSEX_START, KORG_MANUFACTURER_ID, 0x30 | ch, 0x00, 0x01, id];
}

// ─── KORG 8↔7-Bit-Codec ──────────────────────────────────────────────────────
// Je 7 Datenbytes (8-bit) → 1 High-Bits-Byte + 7 Bytes (je 7-bit). Der Tail
// (Länge kein Vielfaches von 7) wird über `lim` sauber abgeschlossen.

/** 8-bit-Bytes → MIDI-7-bit-SysEx-Payload. */
export function syxEnc(byt: Uint8Array): Uint8Array {
  const lng = byt.length;
  const out: number[] = [];
  let tmp: number[] = [];
  let b = 0;
  let cnt = 7;
  let lim = 0;
  for (let i = 0; i < lng; i++) {
    const e = byt[i];
    if (lng < 7) lim = 7 - lng;
    const a = e & 0x7f;
    b |= (e & 0x80) >> cnt;
    tmp.push(a);
    cnt -= 1;
    if (cnt === lim) {
      out.push(b);
      for (const t of tmp) out.push(t);
      tmp = [];
      b = 0;
      cnt = 7;
      if (lng - i < 7) lim = 7 - (lng - i) + 1;
    }
  }
  // Final-Flush eines Rest-Blocks (Länge ≡ 6 mod 7): der `lim`-Guard des
  // Referenz-Codes verpasst genau diesen Fall. Für real vorkommende Nachrichten
  // (Body 16384 → Rest 4, Adressblöcke → Rest 1) ist tmp hier stets leer, das
  // Wire-Format bleibt also unverändert; nur allgemeine Längen werden korrekt.
  if (tmp.length > 0) {
    out.push(b);
    for (const t of tmp) out.push(t);
  }
  return Uint8Array.from(out);
}

/** MIDI-7-bit-SysEx-Payload → 8-bit-Bytes. */
export function syxDec(syx: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let off = 0; off < syx.length; off += 8) {
    const l = syx.subarray(off, off + 8);
    for (let i = 0; i < l.length - 1; i++) {
      let a = l[i + 1];
      a |= ((l[0] & (1 << i)) >> i) << 7;
      out.push(a);
    }
  }
  return Uint8Array.from(out);
}

// ─── Message-Builder ─────────────────────────────────────────────────────────

/**
 * Index 0..249 → (lsb, msb). Reihenfolge auf dem Draht: LSB zuerst — so
 * sendet das hardware-erprobte hacktribe e2pat2syx.py ("0x4c, lsb, msb");
 * die msb-first-Benennung im hacktribe-editor-Struct ist irreführend.
 */
function indexBytes(index: number): [number, number] {
  const i = Math.min(249, Math.max(0, Math.trunc(index)));
  return [i % 128, Math.floor(i / 128)];
}

/**
 * „Current Pattern Dump" (0x40): schreibt in den Edit-Buffer des Geräts —
 * das Pattern erklingt sofort, ohne einen Speicherplatz zu überschreiben.
 * `body` = 0x4000-Pattern-Body (Ausgabe von buildE2PatternBody).
 */
export function buildCurrentPatternDump(body: Uint8Array, opts?: E2SysexOptions): Uint8Array {
  return Uint8Array.from([
    ...head(opts),
    E2_MSG.currentPatternDump,
    ...syxEnc(body),
    SYSEX_END,
  ]);
}

/**
 * „Pattern Dump" (0x4C) an einen konkreten Speicherplatz `index` (0..249).
 * TekkForge-Fix: Index-Reihenfolge LSB,MSB — wie das hardware-erprobte
 * hacktribe e2pat2syx.py ([…, 0x4c, lsb, msb]). Vorher msb-first → das Gerät
 * ignorierte den Dump („Pattern → Slot" tat nichts).
 */
export function buildPatternDump(
  body: Uint8Array,
  index: number,
  opts?: E2SysexOptions,
): Uint8Array {
  const [lsb, msb] = indexBytes(index);
  return Uint8Array.from([
    ...head(opts),
    E2_MSG.patternDump,
    lsb,
    msb,
    ...syxEnc(body),
    SYSEX_END,
  ]);
}

/** „Current Pattern Request" (0x10): Gerät antwortet mit 0x40-Dump. */
export function buildCurrentPatternRequest(opts?: E2SysexOptions): Uint8Array {
  return Uint8Array.from([...head(opts), E2_MSG.currentPatternRequest, SYSEX_END]);
}

/** „Pattern Request" (0x1C) für Slot `index`: Gerät antwortet mit 0x4C-Dump. */
export function buildPatternRequest(index: number, opts?: E2SysexOptions): Uint8Array {
  const [lsb, msb] = indexBytes(index);
  return Uint8Array.from([...head(opts), E2_MSG.patternRequest, lsb, msb, SYSEX_END]);
}

/** „Pattern Write" (0x11): speichert den Edit-Buffer in Slot `index`. */
export function buildPatternWrite(index: number, opts?: E2SysexOptions): Uint8Array {
  const [lsb, msb] = indexBytes(index);
  return Uint8Array.from([...head(opts), E2_MSG.patternWrite, lsb, msb, SYSEX_END]);
}

/** „Global Request" (0x0E): Gerät antwortet mit Global-Dump (0x51). */
export function buildGlobalRequest(opts?: E2SysexOptions): Uint8Array {
  return Uint8Array.from([...head(opts), E2_MSG.globalRequest, SYSEX_END]);
}

/** KORG-Device-Search — zur Erkennung von Channel + Produkt-ID. */
export function buildSearchDevice(): Uint8Array {
  return Uint8Array.from([SYSEX_START, KORG_MANUFACTURER_ID, SEARCH_REQUEST, 0x00, 0x00, SYSEX_END]);
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

export interface SearchReply {
  /** Global-Channel 0..15. */
  channel: number;
  /** Produkt-ID (0x23 Synth | 0x24 Sampler). */
  productId: number;
  version: string;
}

/** Parst die Antwort auf buildSearchDevice(); null wenn kein Search-Reply. */
export function parseSearchReply(bytes: Uint8Array): SearchReply | null {
  // F0 42 50 01 <ch> ?? <id> ?? ?? ?? <verMaj> <verMin> …
  if (bytes.length < 12) return null;
  if (bytes[0] !== SYSEX_START || bytes[1] !== KORG_MANUFACTURER_ID) return null;
  if (bytes[2] !== SEARCH_REQUEST || bytes[3] !== 0x01) return null;
  return {
    channel: bytes[4] & 0x0f,
    productId: bytes[6],
    version: `${bytes[10]}.${bytes[11]}`,
  };
}

export interface ParsedDump {
  msgId: number;
  /** 0x4000-Pattern-Body (dekodiert). */
  body: Uint8Array;
  /** Slot-Index bei 0x4C-Dumps, sonst null. */
  index: number | null;
}

/**
 * Dekodiert einen empfangenen 0x40/0x4C-Dump zurück in den 0x4000-Body.
 * Header wird per msgId (Byte 6) entfernt: 0x40 → 7 Bytes, 0x4C → 9 Bytes.
 */
export function decodeDump(bytes: Uint8Array): ParsedDump | null {
  if (bytes.length < 8 || bytes[0] !== SYSEX_START || bytes[1] !== KORG_MANUFACTURER_ID)
    return null;
  const msgId = bytes[6];
  const end = bytes[bytes.length - 1] === SYSEX_END ? bytes.length - 1 : bytes.length;
  if (msgId === E2_MSG.currentPatternDump) {
    return { msgId, index: null, body: syxDec(bytes.subarray(7, end)) };
  }
  if (msgId === E2_MSG.patternDump) {
    // LSB, MSB (siehe indexBytes)
    const index = (bytes[7] ?? 0) + (bytes[8] ?? 0) * 128;
    return { msgId, index, body: syxDec(bytes.subarray(9, end)) };
  }
  return null;
}

/** True, wenn `bytes` ein vollständiger KORG-SysEx-Frame ist (F0…F7). */
export function isKorgSysex(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 3 &&
    bytes[0] === SYSEX_START &&
    bytes[1] === KORG_MANUFACTURER_ID &&
    bytes[bytes.length - 1] === SYSEX_END
  );
}

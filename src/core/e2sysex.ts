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

/**
 * Generischer Frame: Kopf + msgId + Body + F7.
 *
 * Für Kommandos, die keinen eigenen Builder haben (z.B. der RAM-Zugriff in
 * `hacktribeRam.ts`). Der Body ist bereits fertig kodiert — dieser Bauer
 * kodiert NICHT selbst, weil nicht jedes Kommando 7-in-8-kodierte Nutzdaten hat.
 */
export function buildFrame(
  msgId: number,
  body: Uint8Array | number[] = [],
  opts?: E2SysexOptions,
): Uint8Array {
  const b = body instanceof Uint8Array ? body : Uint8Array.from(body);
  return Uint8Array.from([...head(opts), msgId & 0x7f, ...b, SYSEX_END]);
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

/** Größe eines Pattern-Bodies (unkodiert). */
export const E2_PATTERN_BODY_SIZE = 0x4000; // 16384

/**
 * Nutzbytes, zu denen ein 16384-B-Body 7-in-8-kodiert wird.
 *
 * ☠ NICHT `ceil(len / 7) * 8`. Das unterstellt, dass alle Gruppen acht Byte
 * lang sind — die letzte ist kürzer: 16384 = 2340·7 + 4, also 2340 volle
 * Gruppen plus eine Restgruppe aus 1 Kopfbyte + 4 Datenbytes.
 *
 *     2340·8 + 5 = 18725     (nicht 18728)
 *
 * Die falsche Rechnung verwirft JEDEN gültigen Dump und lässt die verfälschten
 * durch. In Synthstudio ist das erst am Gerät aufgefallen, weil der Test
 * dieselbe Formel benutzte wie die Produktion — deshalb rechnet der Test hier
 * mit festen Zahlen gegen, nicht mit derselben Formel.
 */
const DUMP_PAYLOAD_LEN = (() => {
  const full = Math.floor(E2_PATTERN_BODY_SIZE / 7);
  const rest = E2_PATTERN_BODY_SIZE % 7;
  return full * 8 + (rest > 0 ? 1 + rest : 0); // 18725
})();

/**
 * Sollgröße eines vollständigen Dump-Frames (inkl. F0…F7), oder null wenn
 * `msgId` kein Pattern-Dump ist.
 *
 * Header: 7 Bytes bis einschließlich msgId; Slot-Dumps tragen zusätzlich
 * [lsb, msb] der Pattern-Nummer. Plus 1 Byte F7 am Ende.
 */
export function expectedDumpLength(msgId: number): number | null {
  if (msgId === E2_MSG.currentPatternDump) return 7 + DUMP_PAYLOAD_LEN + 1; // 18733
  if (msgId === E2_MSG.patternDump) return 9 + DUMP_PAYLOAD_LEN + 1; // 18735
  return null;
}

/**
 * `false`, wenn der Rahmen ein Pattern-Dump ist und die falsche Länge hat.
 *
 * Rahmen, die keine Dumps sind (ACK, Search-Reply, Global), gelten immer als
 * maßhaltig — sonst würde die Prüfung den halben Protokollverkehr verwerfen.
 *
 * Die Länge ist die einzige Prüfung, die VOR dem Dekodieren greift: ein
 * abgeschnittener Dump ergibt sonst klaglos einen zu kurzen Body, der dann als
 * gültiges Pattern in den Editor läuft.
 */
export function isWellSizedDump(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return true;
  const expected = expectedDumpLength(bytes[6]);
  return expected === null || bytes.length === expected;
}

/**
 * Dekodiert einen empfangenen 0x40/0x4C-Dump zurück in den 0x4000-Body.
 * Header wird per msgId (Byte 6) entfernt: 0x40 → 7 Bytes, 0x4C → 9 Bytes.
 */
export function decodeDump(bytes: Uint8Array): ParsedDump | null {
  if (bytes.length < 8 || bytes[0] !== SYSEX_START || bytes[1] !== KORG_MANUFACTURER_ID)
    return null;
  // Längenprüfung VOR dem Dekodieren — sonst liefert ein abgeschnittener Dump
  // einen zu kurzen Body, den nichts weiter beanstandet.
  if (!isWellSizedDump(bytes)) return null;
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

/** Größe des Global-Datenblocks (unkodiert). */
export const E2_GLOBAL_SIZE = 0x100; // 256

/**
 * Dekodiert einen Global-Dump (`0x51`) zurück in die 256 Nutzbytes.
 *
 * Rahmen: `F0 42 3g 00 01 id 51 <syxEnc(256 B)> F7` — am Gerät 301 B lang
 * (256 → 293 kodiert + 7 Kopf + 1 Ende). Die Nutzdaten beginnen mit dem Magic
 * `GLST`; ohne das ist es kein Global-Block und wir geben null zurück, statt
 * etwas zu liefern, das nur zufällig die richtige Länge hat.
 *
 * Struktur, am Gerät gelesen (E2 Sampler, 2026-08-14):
 *
 * ```
 * +0x00  47 4C 53 54  "GLST"   Anfangsmarke
 * +0x04 … +0x2F        die einzigen belegten Bytes (17 von 256)
 * +0xFC  47 4C 45 44  "GLED"   Endmarke
 * ```
 *
 * Der Block ist also beidseitig markiert und zum allergrößten Teil leer. Wer
 * hier einen Parameter sucht, braucht ihn nicht im ganzen Puffer zu suchen —
 * es kommen nur die ersten 48 Bytes in Frage.
 *
 * ### Bekannte Felder
 *
 * `+0x10` **Metronom** — 0-basierter Index der fünf Zustände:
 * `0` = aus, `1` = rec 0, `2` = rec 1, `3` = rec 2, `4` = on.
 * ✔ Am Gerät bestätigt (2026-08-14). Beide Endpunkte sind direkt gemessen, was
 * die Fünferliste festlegt:
 *
 *     Ausgangsstand    1     (= rec 0)
 *     auf „on"         4
 *     zurück auf „off" 0
 *
 * Im gesamten Global-Block bewegte sich dabei jedes Mal genau dieses eine Byte.
 *
 * Die Zwischenstufe war lehrreich: der Ausgangswert 1 wurde zunächst für „off"
 * gehalten. Erst das ausdrückliche Zurückstellen auf „off" zeigte die 0 — das
 * Gerät stand vorher schon auf „rec 0". Ein einzelner Messpunkt sagt eben nur,
 * WELCHER Wert gespeichert ist, nicht welcher Zustand gemeint war; dafür braucht
 * es einen bekannten Ausgangszustand.
 */
/** Global-Offset des Metronom-Zustands (0=aus … 4=on). */
export const E2_GLOBAL_METRONOME_OFF = 0x10;

/**
 * Global-Offset der Sync-Polarität — `hi` = 0, `lo` = 1.
 *
 * ✔ Am Gerät bestätigt (2026-08-14), in BEIDE Richtungen gemessen:
 * `0 -> 1` beim Umstellen auf „lo", `1 -> 0` beim Zurückstellen auf „hi".
 * Bei nur zwei Zuständen ist die Liste damit vollständig — keine Lücke, die aus
 * einer Reihenfolge geschlossen werden müsste.
 */
export const E2_GLOBAL_SYNC_POLARITY_OFF = 0x11;

/**
 * Global-Offset der Sync-Einheit — `1 step` = 0, `2 steps` = 1.
 *
 * ✔ Am Gerät bestätigt (2026-08-14): auf „1 step" gestellt, `+0x12` ging von 1
 * auf 0. Ebenfalls lückenlos, da nur zwei Zustände.
 *
 * Liegt direkt neben der Polarität — die Sync-Einstellungen des Global-Menüs
 * stehen zusammen bei `0x11`/`0x12`.
 */
export const E2_GLOBAL_SYNC_UNIT_OFF = 0x12;

/**
 * Global-Offset des MIDI-Kanals — 0-basiert (Anzeige 1..16 → Byte 0..15).
 *
 * ✔ Am Gerät bestätigt (2026-08-14): Kanal von 1 auf 5 gestellt, `+0x29` ging
 * von 0 auf 4. Einziges verändertes Byte im Block.
 *
 * ☠ Praktische Folge, die beim Messen auffiel: **danach antwortet das Gerät auf
 * gar nichts mehr.** Der Global-Kanal steckt im SysEx-Kopf (`F0 42 0x3g …`), und
 * das Gerät ignoriert Anfragen auf dem falschen Kanal — stumm, ohne Fehler. Wer
 * den Kanal am Gerät verstellt, muss ihn im Host nachziehen.
 *
 * Die Gerätesuche (`F0 42 50 00 00 F7`) ist davon ausgenommen: sie läuft
 * kanalunabhängig und liefert den aktuellen Kanal in der Antwort mit. Sie ist
 * damit das Mittel der Wahl, wenn die Verbindung plötzlich tot wirkt.
 */
/**
 * Global-Offset von „Tempo Lock" — `off` = 0, `on` = 1.
 *
 * ✔ Am Gerät bestätigt (2026-08-14), in beide Richtungen: `0 -> 1` beim
 * Einschalten, `1 -> 0` beim Zurückstellen.
 *
 * ⚠ Lehrreich für die Suche: `0x24` stand vorher auf 0 und tauchte deshalb in
 * der Liste der „belegten" Bytes nicht auf. Der Block enthält also mehr Felder
 * als die 17 Nicht-Null-Bytes vermuten lassen — **ein Schalter im Aus-Zustand
 * ist von unbenutztem Speicher nicht zu unterscheiden.** Wer die Belegung ueber
 * Nicht-Null-Bytes abschaetzt, unterschaetzt sie systematisch.
 */
export const E2_GLOBAL_TEMPO_LOCK_OFF = 0x24;

/**
 * Global-Offset des Touch-Scale-Umfangs — **direkt** in Oktaven (1..4).
 *
 * ✔ Am Gerät bestätigt (2026-08-14): auf „4 oct" gestellt, `+0x26` ging von 1
 * auf 4. Ausgangswert war „1 oct" = 1, also beide Enden gemessen.
 *
 * ⚠ **Die erste Ausnahme im Global-Block.** Alle bis dahin gemessenen
 * Global-Felder (Metronom, Sync-Polarität, Sync-Einheit, Velocity-Kurve,
 * Knob-Modus, Trigger-Modus, MIDI-Kanal) speichern 0-basiert. Dieses nicht —
 * hier steht die Oktavzahl unverändert.
 *
 * Wer der bis dahin ausnahmslosen Regel gefolgt wäre, hätte eine 3 erwartet und
 * den Wert um eins falsch gedeutet. Auch eine Regel, die siebenmal gehalten hat,
 * ersetzt die Messung nicht.
 */
export const E2_GLOBAL_TOUCH_SCALE_RANGE_OFF = 0x26;

export const E2_GLOBAL_MIDI_CHANNEL_OFF = 0x29;

/**
 * Global-Offset des Trigger-Modus — 0-basierter Listenindex.
 *
 * | Anzeige  | Byte |                     |
 * |----------|------|---------------------|
 * | normal   | 0    | gemessen (Ausgang)  |
 * | seq 1st  | 1    | aus der Reihenfolge |
 * | seq play | 2    | gemessen            |
 *
 * ✔ Am Gerät bestätigt (2026-08-14): auf „seq play" gestellt, `+0x1D` ging von
 * 0 auf 2. Der mittlere Wert liegt zwischen zwei gemessenen Punkten.
 *
 * Im selben Durchgang ging `+0x29` von 4 auf 0 zurück (MIDI-Kanal wieder 1) —
 * eine unbeabsichtigte, aber willkommene Gegenprobe für dessen 0-Basis.
 */
export const E2_GLOBAL_TRIGGER_MODE_OFF = 0x1d;

/**
 * Global-Offset des Knob-Modus — 0-basierter Listenindex.
 *
 * | Anzeige     | Byte |                     |
 * |-------------|------|---------------------|
 * | jump        | 0    | gemessen (Ausgang)  |
 * | catch       | 1    | aus der Reihenfolge |
 * | value scale | 2    | gemessen            |
 *
 * ✔ Am Gerät bestätigt (2026-08-14): auf „value scale" gestellt, `+0x1C` ging
 * von 0 auf 2.
 *
 * Liegt zwischen Velocity-Kurve (`0x1B`) und Trigger-Modus (`0x1D`) — die drei
 * Felder zum Bedienverhalten stehen lückenlos beieinander.
 */
export const E2_GLOBAL_KNOB_MODE_OFF = 0x1c;

/**
 * Global-Offset des LCD-Kontrasts — **Anzeige + 17**.
 *
 * ✔ Am Gerät bestätigt (2026-08-14) mit zwei bekannten Werten:
 *
 *     Anzeige 17  ->  +0x1E = 34      17 + 17 = 34
 *     Anzeige 25  ->  +0x1E = 42      25 + 17 = 42
 *
 * Der Anzeigebereich 1..25 liegt damit als 18..42 im Speicher — 25 Werte, die
 * Zahl stimmt.
 *
 * ⚠ Ein konstanter Versatz von 17 ist nichts, worauf man ohne zwei bekannte
 * Werte käme: mit nur einem Messpunkt (42 bei „25") haette man ebenso gut auf
 * einen Faktor oder eine ganz andere Skala schliessen koennen. Dass der Nutzer
 * den Normalwert mitgeliefert hat, hat die Deutung erst moeglich gemacht.
 *
 * Sechste Kodierungsform in diesem Geraet — neben 0-basiert, Modulo, direkt,
 * invertiert (127-x) und signed.
 */
export const E2_GLOBAL_LCD_CONTRAST_OFF = 0x1e;

/**
 * Global-Offset der Velocity-Kurve — 0-basierter Listenindex.
 *
 * | Anzeige  | Byte |                     |
 * |----------|------|---------------------|
 * | heavy    | 0    | gemessen (Ausgang)  |
 * | normal   | 1    | aus der Reihenfolge |
 * | light    | 2    | aus der Reihenfolge |
 * | const96  | 3    | gemessen            |
 *
 * ✔ Am Gerät bestätigt (2026-08-14): auf „const96" gestellt, `+0x1B` ging von 0
 * auf 3. Beide Enden der Liste sind damit gemessen; die beiden mittleren Werte
 * liegen dazwischen und folgen aus der Reihenfolge am Gerät.
 */
export const E2_GLOBAL_VELOCITY_CURVE_OFF = 0x1b;
export function decodeGlobalDump(bytes: Uint8Array): Uint8Array | null {
  if (bytes.length < 8 || bytes[0] !== SYSEX_START || bytes[1] !== KORG_MANUFACTURER_ID)
    return null;
  if (bytes[6] !== E2_MSG.globalDump) return null;
  const end = bytes[bytes.length - 1] === SYSEX_END ? bytes.length - 1 : bytes.length;
  const body = syxDec(bytes.subarray(7, end));
  if (body.length < 4) return null;
  const magic = String.fromCharCode(body[0], body[1], body[2], body[3]);
  if (magic !== "GLST") return null;
  return body.subarray(0, E2_GLOBAL_SIZE);
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

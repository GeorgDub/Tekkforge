/**
 * otp.ts — OmniTribe-SysEx-Protokoll (OTP), reiner Rahmenbauer und -parser.
 *
 * Kein DOM, kein MIDI: hier entstehen Bytes und werden Bytes gedeutet. Der
 * Transport (Port öffnen, senden, auf Antwort warten) liegt in der GUI.
 *
 * Quellen, byte-genau übernommen:
 *   - Omnitribe `docs/midi/otp_protocol.md` (Rahmen, Prüfsumme, 7-Bit-Kodierung)
 *   - Omnitribe `src/firmware/bsdiff_stubs/sysex_layer1_hook.c` — der Code, der
 *     am Gerät tatsächlich läuft (der Loader unter `src/firmware/loader/` ist über
 *     den Korg-Update-Weg nicht erreichbar). Er entscheidet, wie Antworten aussehen.
 *   - Omnitribe `tools/midi/otp_codec.py` (Telemetrie-Feldnamen, Feldreihenfolge)
 *   - SynthStudio `client/src/audio/OmniTribeBridge.ts` (Host-Kern, Testvektoren)
 *
 * Bewusst NICHT hier: STATE_DUMP, PATTERN, STREAM, FX, Modul-Lader (0x05) — der
 * Stub hat dafür keinen Handler (unbekannte CMD/SUB = Stille bzw. error_count).
 *
 * Rahmen:  F0 7D 01 02 [CMD] [SUB] [LEN_H] [LEN_L] [DATA…] [CHK] F7
 *   LEN = 14 Bit (2 × 7), CHK = XOR über DATA, auf 7 Bit maskiert.
 *   Gesamtlänge = 10 + LEN. Die Prüfung am Gerät (Sprint 167): erst Länge
 *   (Fehler → error_count), dann Prüfsumme (Fehler → chk_fail_count); unbekannte
 *   SUBs werden still verworfen — der Host bekommt nur ein Timeout.
 *
 * Stand 2026-09-17: aus TekkForge heraus am Gerät UNGETESTET. Was hier als
 * „belegt“ steht, ist mit Omnitribes eigenen Werkzeugen belegt, nicht mit dieser App.
 */

export const OTP_SYSEX_START = 0xf0;
export const OTP_SYSEX_END = 0xf7;
/** 0x7D = nicht-kommerzielle Hersteller-ID, 01 02 = OmniTribe-Unterkennung. */
export const OTP_MFR_ID: readonly [number, number, number] = [0x7d, 0x01, 0x02];
/** Rahmen-Overhead: F0 + 3 MFR + CMD + SUB + LEN_H + LEN_L (= 8) + CHK + F7. */
export const OTP_RAHMEN_BYTES = 10;
export const OTP_PAYLOAD_MAX = 0x3fff;

/** Kommandos, die der Stub am Gerät beantwortet (plus PARAM-Notify als Eingang). */
export const OtpCmd = {
  IDENTITY: 0x01,
  PARAM: 0x02,
  /** Sprint 186: Periodik-Hook (Timer-Callback-Tabelle). Nur im EXEC-Build beantwortet. */
  IRQ_HOOK: 0x04,
  /** Sprint 183: Modul-Lader. SUB 0x01 = Block senden, SUB 0x03 = ACK (Gerät → Host). */
  MODULE: 0x05,
  /** Sprint 141: 0x07 ist TELEMETRY (der C-Code ist die Autorität; SONG wich auf 0x11 aus). */
  TELEMETRY: 0x07,
  FIRMWARE_INFO: 0x09,
  /** Sprint 166: Play/Stop/Position als eingespeiste MIDI-Nachricht (0xFA/0xFC/0xF2). Keine Antwort. */
  TRANSPORT: 0x0e,
} as const;

export const OtpSub = {
  IDENTITY_REQUEST: 0x00,
  IDENTITY_RESPONSE: 0x01,
  PARAM_SET: 0x00,
  PARAM_GET: 0x01,
  PARAM_RESPONSE: 0x02,
  PARAM_NOTIFY: 0x03,
  TELEMETRY_REQUEST: 0x01,
  TELEMETRY_REPORT: 0x02,
  FW_INFO_REQUEST: 0x00,
  FW_INFO_RESPONSE: 0x01,
  TRANSPORT_PLAY: 0x00,
  TRANSPORT_STOP: 0x01,
  TRANSPORT_POSITION: 0x0a,
  /** Sprint 183: Modul-Block (Host → Gerät) und ACK (Gerät → Host). */
  MODULE_BLOCK: 0x01,
  MODULE_ACK: 0x03,
  /** Sprint 184 (Stufe 2, hinter Firmware-Flag): Chunk ins DDR und Commit. */
  MODULE_CHUNK: 0x02,
  MODULE_COMMIT: 0x04,
  /** Sprint 185/186 (nur EXEC-Build): Callback gezielt rufen, Mailbox leeren. */
  MODULE_CALLBACK: 0x05,
  MODULE_DRAIN: 0x06,
  MODULE_UNPLACE: 0x07,
  /** Sprint 186: CMD 0x04 Periodik-Hook. Antwort immer SUB 0x7F (Report). */
  IRQ_PEEK: 0x01,
  IRQ_INSTALL: 0x02,
  IRQ_RESTORE: 0x03,
  IRQ_STATUS: 0x04,
  IRQ_CONFIG: 0x05,
  IRQ_REPORT: 0x7f,
} as const;

export const OTP_PART_MIN = 1;
export const OTP_PART_MAX = 16;

// ─── Parameter-Registry (alle 16 Einträge von `g_otp_param_registry`) ────────

/**
 * Beleg-Status je Parameter — WÖRTLICH aus den Kommentaren im Stub-C-Code
 * (`sysex_layer1_hook.c`, Registry ab ~Zeile 1224), nicht aus späteren
 * Sitzungsprotokollen und nicht aus TekkForge:
 *   „gerätebewiesen“  der C-Kommentar weist eine Messung/Hörprobe am Gerät für
 *                     genau diesen Weg (Schreibzugriff bzw. eingespeiste CC) aus
 *   „statisch“        Adresse/CC aus Tabellen oder Opcodes hergeleitet; der
 *                     C-Kommentar sagt selbst „NICHT gemessen“
 *   „unbestimmt“      der Kommentar trifft keine Aussage
 */
export type OtpBeleg = "gerätebewiesen" | "statisch" | "unbestimmt";

export type OtpParamKey =
  | "oscPitch"
  | "cutoff"
  | "resonance"
  | "level"
  | "pan"
  | "voiceAssign"
  | "egAttack"
  | "egDecay"
  | "oscEdit"
  | "egInt"
  | "modSpeed"
  | "modDepth"
  | "glide"
  | "ifxEdit"
  | "mfxSend"
  | "ifxOnOff";

export interface OtpParamDef {
  readonly key: OtpParamKey;
  readonly name: string;
  /** Param-ID = (hi << 8) | lo, so wie `otp_param_entry()` im Stub sie nachschlägt. */
  readonly hi: number;
  readonly lo: number;
  readonly min: number;
  readonly max: number;
  /** Signed: das Gerät deutet das untere Byte als int8 (`otp_param_clamp`, `is_signed`). */
  readonly signed: boolean;
  readonly einheit: string;
  /**
   * `is_enum` im Stub: Wert ausserhalb min..max wird NICHT geklemmt, sondern
   * der ganze SET still verworfen (kein Zähler). Stetige Parameter klemmt das Gerät.
   */
  readonly enum: boolean;
  /** Anzeigenamen der Stufen bei enum (Index = Wert). */
  readonly stufen?: readonly string[];
  /**
   * Wie der Stub den SET ausführt: „schreib“ = nackter Schreibzugriff auf die
   * Tabellenadresse; „cc N“ = der Wert geht als Control-Change N auf Kanal =
   * Part in den Empfangsweg der Firmware (`cc_bias`/`cc_scale` rechnet der Stub;
   * auf dem OTP-Draht steht immer der Parameterwert selbst). GET liest in
   * beiden Fällen direkt die Tabellenadresse.
   */
  readonly weg: string;
  /** Live-Fenster (0xC069xxxx, beim Part-/Pattern-Wechsel weg) oder Pattern-Block (0xC06Bxxxx, PTST). */
  readonly fenster: "live" | "pattern";
  readonly beleg: OtpBeleg;
  /** Kurzbegründung mit Datum/Sprint, aus dem C-Kommentar. */
  readonly quelle: string;
}

export const OTP_PARAMS: readonly OtpParamDef[] = [
  {
    key: "oscPitch",
    name: "Osc-Pitch",
    hi: 0x00,
    lo: 0x01,
    min: -64,
    max: 63,
    signed: true,
    einheit: "Halbtöne",
    enum: false,
    weg: "schreib",
    fenster: "live",
    beleg: "statisch",
    quelle:
      "Am Coexist 2026-09-17 am Gerät NICHT live-hörbar: der Schreibzugriff landet an der echten Einstellungs-Adresse (Part 2 = 0xC0693E5E, per Differenz-Scan gemessen und per 0x52 verifiziert), aber die Engine spielt aus einer daraus berechneten Playback-Rate — nur die Firmware-Funktion (Panel) löst die Neuberechnung aus. Kein CC/NRPN → über den Stub-Speicherweg nicht modulierbar (Firmware-Grenze). Cutoff/Resonance wirken, weil sie CC sind.",
  },
  {
    key: "cutoff",
    name: "Cutoff",
    hi: 0x00,
    lo: 0x02,
    min: 0,
    max: 127,
    signed: false,
    einheit: "",
    enum: false,
    weg: "cc 74",
    fenster: "live",
    beleg: "gerätebewiesen",
    quelle: "Hörbar bestätigt 2026-08-06 (Wert 20 = dumpfer); CC-Weg 2026-08-08 gemessen, Gerät pflegt Live- und Pattern-Kopie (Sprint 159)",
  },
  {
    key: "resonance",
    name: "Resonance",
    hi: 0x00,
    lo: 0x03,
    min: 0,
    max: 127,
    signed: false,
    einheit: "",
    enum: false,
    weg: "cc 71",
    fenster: "live",
    beleg: "gerätebewiesen",
    quelle: "HW-ausgemessen 2026-08-06, 16 Adressen bei gestopptem Sequencer; CC-Weg 2026-08-08 gemessen (Sprint 159)",
  },
  {
    key: "level",
    name: "Level",
    hi: 0x00,
    lo: 0x04,
    min: 0,
    max: 127,
    signed: false,
    einheit: "",
    enum: false,
    weg: "cc 7",
    fenster: "pattern",
    beleg: "gerätebewiesen",
    quelle:
      "Nackter Schreibzugriff am Gerät NICHT hörbar (2026-08-07) → CC 7 eingespeist; 2026-08-08 end-to-end: GET 16/16, Einspeisung 3/3, Pegelverlauf gehört (Sprint 153)",
  },
  {
    key: "pan",
    name: "Pan",
    hi: 0x00,
    lo: 0x05,
    min: -63,
    max: 63,
    signed: true,
    einheit: "",
    enum: false,
    weg: "cc 10 (Stub: CC = Wert + 64)",
    fenster: "pattern",
    beleg: "gerätebewiesen",
    quelle:
      "Adressen 2026-08-07 per 14-Punkt-CC-Reihe bestätigt (pan = CC − 64); Versatz 64 nach Fehlmessung 2026-08-08 nachgezogen (Sprint 157) — die Kennlinie ist gemessen, der korrigierte SET selbst steht im Kommentar nicht als nachgemessen",
  },
  {
    key: "voiceAssign",
    name: "Voice Assign",
    hi: 0x00,
    lo: 0x06,
    min: 0,
    max: 3,
    signed: false,
    einheit: "",
    enum: true,
    stufen: ["Mono 1", "Mono 2", "Poly 1", "Poly 2"],
    weg: "schreib",
    fenster: "pattern",
    beleg: "statisch",
    quelle:
      "Adresse aus Part-Basis (Sprint 171 statisch, Sprint 151 live), Werte 0–3 am Gerät abgelesen, Lesen hörbar belegt (Part 11) — aber „dass unser SCHREIBZUGRIFF dort ankommt, ist NICHT gemessen“ (Sprint 172); Chord Set/Gate Arp abgewiesen",
  },
  {
    key: "egAttack",
    name: "EG Attack",
    hi: 0x00,
    lo: 0x07,
    min: 0,
    max: 127,
    signed: false,
    einheit: "",
    enum: false,
    weg: "cc 73",
    fenster: "pattern",
    beleg: "statisch",
    quelle: "Offset aus TABLE 6 (+0x14), CC aus der offiziellen Liste — „dass die EINGESPEISTE CC 73 am Gerät ankommt und hörbar wirkt, ist NICHT gemessen“ (Sprint 174)",
  },
  {
    key: "egDecay",
    name: "EG Decay/Release",
    hi: 0x00,
    lo: 0x08,
    min: 0,
    max: 127,
    signed: false,
    einheit: "",
    enum: false,
    weg: "cc 72",
    fenster: "pattern",
    beleg: "statisch",
    quelle: "Offset +0x15 zusätzlich über den Dateiweg belegt (Synthstudio-ESX-Import), CC 72 eingespeist „NICHT gemessen“ (Sprint 174)",
  },
  {
    key: "oscEdit",
    name: "Osc Edit",
    hi: 0x00,
    lo: 0x09,
    min: 0,
    max: 127,
    signed: false,
    einheit: "",
    enum: false,
    weg: "cc 82",
    fenster: "pattern",
    beleg: "statisch",
    quelle: "Offset +0x0B aus TABLE 6, CC 82 — „keiner der fünf ist am Gerät gemessen — weder das Byte noch die eingespeiste CC“ (Sprint 175)",
  },
  {
    key: "egInt",
    name: "EG Int",
    hi: 0x00,
    lo: 0x0a,
    min: -63,
    max: 63,
    signed: true,
    einheit: "",
    enum: false,
    weg: "cc 83 (Stub: CC = Wert + 64)",
    fenster: "pattern",
    beleg: "statisch",
    quelle: "Offset +0x0F aus TABLE 6, CC 83; Versatz 64 von Pan ÜBERNOMMEN, nicht gemessen (Sprint 175)",
  },
  {
    key: "modSpeed",
    name: "Mod Speed",
    hi: 0x00,
    lo: 0x0b,
    min: 0,
    max: 127,
    signed: false,
    einheit: "",
    enum: false,
    weg: "cc 86",
    fenster: "pattern",
    beleg: "statisch",
    quelle: "Offset +0x11 aus TABLE 6, CC 86 — nicht am Gerät gemessen (Sprint 175)",
  },
  {
    key: "modDepth",
    name: "Mod Depth",
    hi: 0x00,
    lo: 0x0c,
    min: 0,
    max: 127,
    signed: false,
    einheit: "",
    enum: false,
    weg: "cc 85",
    fenster: "pattern",
    beleg: "statisch",
    quelle: "Offset +0x12 aus TABLE 6, CC 85 — nicht am Gerät gemessen (Sprint 175)",
  },
  {
    key: "glide",
    name: "Glide",
    hi: 0x00,
    lo: 0x0d,
    min: 0,
    max: 127,
    signed: false,
    einheit: "",
    enum: false,
    weg: "cc 81",
    fenster: "pattern",
    beleg: "statisch",
    quelle: "Offset +0x25 aus TABLE 6, CC 81 — nicht am Gerät gemessen (Sprint 175)",
  },
  {
    key: "ifxEdit",
    name: "IFX Edit",
    hi: 0x00,
    lo: 0x0e,
    min: 0,
    max: 127,
    signed: false,
    einheit: "",
    enum: false,
    weg: "cc 87",
    fenster: "pattern",
    beleg: "statisch",
    quelle: "Offset +0x22 aus TABLE 6, CC 87 — „nichts davon am Gerät gemessen“ (Sprint 176)",
  },
  {
    key: "mfxSend",
    name: "MFX Send",
    hi: 0x00,
    lo: 0x0f,
    min: 0,
    max: 1,
    signed: false,
    einheit: "",
    enum: true,
    stufen: ["Off", "On"],
    weg: "cc 105 (Stub: CC = Wert × 127)",
    fenster: "pattern",
    beleg: "gerätebewiesen",
    quelle:
      "Schalter, „am 2026-08-22 nativ belegt“: Anzeige OFF/ON, Byte +0x1B 0x00/0x01, CC 105 liefert 0→0 und ≥10→1 (Sprint 181; Sprint 176 hatte den Typ falsch) — Byte-Beleg, keine Hörprobe",
  },
  {
    key: "ifxOnOff",
    name: "IFX On/Off",
    hi: 0x00,
    lo: 0x10,
    min: 0,
    max: 1,
    signed: false,
    einheit: "",
    enum: true,
    stufen: ["Off", "On"],
    weg: "cc 104 (Stub: CC = Wert × 127)",
    fenster: "pattern",
    beleg: "statisch",
    quelle: "Offset +0x20 aus TABLE 6, CC 104 als Schwellwert — „weder dass CC 104 das Byte setzt noch die Schwelle 64 ist am Gerät gemessen“ (Sprint 177)",
  },
];

/** Anzeige-Kürzel für den Beleg-Status (Panel, README). */
export function belegText(b: OtpBeleg): string {
  switch (b) {
    case "gerätebewiesen":
      return "✔ am Gerät bewiesen (Omnitribe)";
    case "statisch":
      return "◐ statisch hergeleitet, heute zu hören";
    default:
      return "? unbestimmt";
  }
}

/** Wert als Text: Stufenname bei enum, sonst Zahl mit Einheit. */
export function paramWertText(p: OtpParamDef, wert: number): string {
  if (p.enum && p.stufen && wert >= 0 && wert < p.stufen.length) return `${wert} = ${p.stufen[wert]}`;
  return `${wert}${p.einheit ? " " + p.einheit : ""}`;
}

export function otpParam(key: OtpParamKey): OtpParamDef {
  const p = OTP_PARAMS.find((e) => e.key === key);
  if (!p) throw new Error(`unbekannter OTP-Parameter ${key}`);
  return p;
}

/** Registry-Eintrag zu einer Draht-ID, sonst null (wie `otp_param_entry` im Stub). */
export function otpParamVonId(hi: number, lo: number): OtpParamDef | null {
  return OTP_PARAMS.find((p) => p.hi === (hi & 0x7f) && p.lo === (lo & 0x7f)) ?? null;
}

// ─── Kodierungen ─────────────────────────────────────────────────────────────

/**
 * 8-Bit → 7-Bit („7-of-8“): je 7 Rohbytes ein Kopfbyte voran, Bit j = MSB von
 * Byte j. Identisch mit `encode_7bit` (Python), `syx_enc_minimal` (Stub) und
 * `encode7Bit` (SynthStudio).
 */
export function encode7Bit(data: Uint8Array | readonly number[]): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < data.length; i += 7) {
    const ende = Math.min(i + 7, data.length);
    let kopf = 0;
    for (let j = i; j < ende; j++) if (data[j] & 0x80) kopf |= 1 << (j - i);
    out.push(kopf & 0x7f);
    for (let j = i; j < ende; j++) out.push(data[j] & 0x7f);
  }
  return Uint8Array.from(out);
}

export function decode7Bit(data: Uint8Array | readonly number[]): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const kopf = data[i++];
    for (let j = 0; j < 7 && i < data.length; j++) {
      let b = data[i++] & 0x7f;
      if (kopf & (1 << j)) b |= 0x80;
      out.push(b);
    }
  }
  return Uint8Array.from(out);
}

/** XOR über die Nutzlast, 7-Bit-sicher. NICHT über CMD/SUB/LEN — dieser Irrtum ist im Omnitribe-Repo aktenkundig. */
export function xorChecksum(payload: Uint8Array | readonly number[]): number {
  let chk = 0;
  for (let i = 0; i < payload.length; i++) chk ^= payload[i];
  return chk & 0x7f;
}

/**
 * `pack32_7bit`: 5 Bytes = Kopf (Bit k = MSB von Datenbyte k) + 4 × 7 Bit,
 * Datenbyte 0 = Bits 31..24. Gegenstück zu `unpack32_7bit` in SynthStudio.
 */
export function unpack32_7bit(b: Uint8Array | readonly number[], offset = 0): number {
  let result = 0;
  for (let k = 0; k < 4; k++) {
    let v = b[offset + 1 + k] & 0x7f;
    if (b[offset] & (1 << k)) v |= 0x80;
    result = (result | (v << (24 - k * 8))) >>> 0;
  }
  return result;
}

export function pack32_7bit(wert: number): Uint8Array {
  const v = wert >>> 0;
  const bytes = [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
  let kopf = 0;
  bytes.forEach((x, k) => {
    if (x & 0x80) kopf |= 1 << k;
  });
  return Uint8Array.from([kopf, ...bytes.map((x) => x & 0x7f)]);
}

/** 21 Bit als 3 × 7 Bit, MSB zuerst (Sprint 111, z. B. BPM × 100). */
export function encode21Bit(wert: number): [number, number, number] {
  const v = clampInt(wert, 0, 0x1fffff);
  return [(v >> 14) & 0x7f, (v >> 7) & 0x7f, v & 0x7f];
}

export function decode21Bit(b: Uint8Array | readonly number[], offset = 0): number {
  return ((b[offset] & 0x7f) << 14) | ((b[offset + 1] & 0x7f) << 7) | (b[offset + 2] & 0x7f);
}

/** 14 Bit als 2 × 7 Bit; negative Werte im Zweierkomplement (wie SynthStudio `value & 0x3FFF`). */
export function encode14Bit(wert: number): [number, number] {
  const v = wert & 0x3fff;
  return [(v >> 7) & 0x7f, v & 0x7f];
}

export function decode14Bit(hi: number, lo: number): number {
  return ((hi & 0x7f) << 7) | (lo & 0x7f);
}

/** 14-Bit-Zahl als vorzeichenbehaftet (≥ 0x2000 negativ) — die Python-Deutung für Notify-Frames. */
export function signed14(v: number): number {
  const x = v & 0x3fff;
  return x >= 0x2000 ? x - 0x4000 : x;
}

function clampInt(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  const f = Math.floor(v);
  return f < lo ? lo : f > hi ? hi : f;
}

// ─── Rahmen bauen und lesen ──────────────────────────────────────────────────

export function buildFrame(cmd: number, sub: number, payload: Uint8Array | readonly number[]): Uint8Array {
  const len = payload.length;
  if (len > OTP_PAYLOAD_MAX) throw new RangeError(`Payload zu gross: ${len} > ${OTP_PAYLOAD_MAX}`);
  return Uint8Array.from([
    OTP_SYSEX_START,
    ...OTP_MFR_ID,
    cmd & 0x7f,
    sub & 0x7f,
    (len >> 7) & 0x7f,
    len & 0x7f,
    ...payload,
    xorChecksum(payload),
    OTP_SYSEX_END,
  ]);
}

export type OtpParseFehler =
  | "zu-kurz" // unter 10 Bytes
  | "kein-sysex" // F0/F7 fehlen
  | "fremder-hersteller" // nicht 7D 01 02 — z. B. eine Korg-Antwort (0x42)
  | "laenge" // LEN passt nicht zur Rahmenlänge (am Gerät: error_count)
  | "pruefsumme"; // XOR stimmt nicht (am Gerät: chk_fail_count)

export interface OtpFrame {
  ok: true;
  cmd: number;
  sub: number;
  payload: Uint8Array;
}

export type OtpParseErgebnis = OtpFrame | { ok: false; fehler: OtpParseFehler };

/** Rahmen prüfen wie der Stub (Sprint 167): Länge vor Prüfsumme. */
export function parseFrame(raw: Uint8Array | readonly number[]): OtpParseErgebnis {
  if (raw.length < OTP_RAHMEN_BYTES) return { ok: false, fehler: "zu-kurz" };
  if (raw[0] !== OTP_SYSEX_START || raw[raw.length - 1] !== OTP_SYSEX_END) return { ok: false, fehler: "kein-sysex" };
  if (raw[1] !== OTP_MFR_ID[0] || raw[2] !== OTP_MFR_ID[1] || raw[3] !== OTP_MFR_ID[2]) {
    return { ok: false, fehler: "fremder-hersteller" };
  }
  const len = ((raw[6] & 0x7f) << 7) | (raw[7] & 0x7f);
  if (raw.length !== OTP_RAHMEN_BYTES + len) return { ok: false, fehler: "laenge" };
  const payload = Uint8Array.from(raw.slice(8, 8 + len));
  if (xorChecksum(payload) !== raw[8 + len]) return { ok: false, fehler: "pruefsumme" };
  return { ok: true, cmd: raw[4] & 0x7f, sub: raw[5] & 0x7f, payload };
}

/** Prädikat für `requestSysex`: ist das ein gültiger OTP-Rahmen mit diesem CMD/SUB? */
export function istOtpAntwort(raw: Uint8Array, cmd: number, sub: number): boolean {
  const f = parseFrame(raw);
  return f.ok && f.cmd === cmd && f.sub === sub;
}

// ─── Anfragen (Host → Gerät) ─────────────────────────────────────────────────

/** `F0 7D 01 02 01 00 00 00 00 F7` */
export function buildIdentityRequest(): Uint8Array {
  return buildFrame(OtpCmd.IDENTITY, OtpSub.IDENTITY_REQUEST, []);
}

/** `F0 7D 01 02 09 00 00 00 00 F7` — der Stub kennt nur SUB 0x00 (die 0x01/0x02/0x03-Aliase des Loaders sind dort Stille). */
export function buildFirmwareInfoRequest(): Uint8Array {
  return buildFrame(OtpCmd.FIRMWARE_INFO, OtpSub.FW_INFO_REQUEST, []);
}

/** `F0 7D 01 02 07 01 00 00 00 F7` */
export function buildTelemetryRequest(): Uint8Array {
  return buildFrame(OtpCmd.TELEMETRY, OtpSub.TELEMETRY_REQUEST, []);
}

/**
 * Roh-Form wie SynthStudio `setParam(part, paramHigh, paramLow, value)`:
 * Part 0-basiert und auf 4 Bit maskiert, Wert auf 14 Bit maskiert. Für die
 * Testvektoren und für alles, was die Registry nicht kennt.
 */
export function buildParamSetRoh(partDraht: number, hi: number, lo: number, wert: number): Uint8Array {
  return buildFrame(OtpCmd.PARAM, OtpSub.PARAM_SET, [partDraht & 0x0f, hi & 0x7f, lo & 0x7f, ...encode14Bit(wert)]);
}

export function buildParamGetRoh(partDraht: number, hi: number, lo: number): Uint8Array {
  return buildFrame(OtpCmd.PARAM, OtpSub.PARAM_GET, [partDraht & 0x0f, hi & 0x7f, lo & 0x7f]);
}

function pruefePart(part: number): number {
  if (!Number.isInteger(part) || part < OTP_PART_MIN || part > OTP_PART_MAX) {
    throw new RangeError(`Part ${part} liegt ausserhalb ${OTP_PART_MIN}..${OTP_PART_MAX}`);
  }
  // Auf dem Draht 0-basiert: der Stub prüft `part >= 16` und nimmt den Wert
  // bei Cutoff/Resonance direkt als MIDI-Kanal der eingespeisten CC.
  return part - 1;
}

/**
 * PARAM SET für Part 1–16. Der Wert muss im Bereich des Parameters liegen —
 * kein stilles Klemmen: das Gerät klemmt selbst, aber ein Wert ausserhalb ist
 * hier ein Programmierfehler, den man sehen soll (Lehre aus Omnitribes Pan-Fehler).
 */
export function buildParamSet(part: number, param: OtpParamDef, wert: number): Uint8Array {
  if (!Number.isInteger(wert) || wert < param.min || wert > param.max) {
    throw new RangeError(`${param.name}: ${wert} liegt ausserhalb ${param.min}..${param.max}`);
  }
  return buildParamSetRoh(pruefePart(part), param.hi, param.lo, wert);
}

export function buildParamGet(part: number, param: OtpParamDef): Uint8Array {
  return buildParamGetRoh(pruefePart(part), param.hi, param.lo);
}

// ─── TRANSPORT (CMD 0x0E, Sprint 166) ────────────────────────────────────────
//
// Der Stub speist die MIDI-Nachricht in den Empfangsweg der Firmware ein:
// SUB 0x00 → 0xFA (Start), SUB 0x01 → 0xFC (Stop), SUB 0x0A → F2 lsb msb
// (Song-Position-Pointer). Es gibt KEINE Antwort; Erfolg zählt in
// otp_response_sent_count, eine Absage in error_count. Alle anderen SUBs
// (Record, Tempo, Abfragen) zählt der Stub als error_count.

/** Beats > 0x3FFF sagt der Stub ab (error_count) — der SPP trägt nur 14 Bit. */
export const OTP_TRANSPORT_BEATS_MAX = 0x3fff;

/** `F0 7D 01 02 0E 00 00 00 00 F7` */
export function buildTransportPlay(): Uint8Array {
  return buildFrame(OtpCmd.TRANSPORT, OtpSub.TRANSPORT_PLAY, []);
}

/** `F0 7D 01 02 0E 01 00 00 00 F7` */
export function buildTransportStop(): Uint8Array {
  return buildFrame(OtpCmd.TRANSPORT, OtpSub.TRANSPORT_STOP, []);
}

/**
 * Rohform ohne Grenzprüfung: 21 Bit als 3 × 7 Bit, MSB zuerst — genau so liest
 * der Stub `frame[8..10]`. Nur für Tests, die die Absage des Geräts nachstellen
 * (Beat 0x4000 → `0E 0A 00 03 01 00 00 01`, Omnitribe-HW-Sitzung 2026-08-13).
 */
export function buildTransportPositionRoh(beats: number): Uint8Array {
  return buildFrame(OtpCmd.TRANSPORT, OtpSub.TRANSPORT_POSITION, encode21Bit(beats));
}

/**
 * Position in MIDI-Beats (1 Beat = 1 Sechzehntel = 6 Clocks) setzen. Werte über
 * 0x3FFF weist der Client ab — der Stub täte es auch, aber stumm (nur error_count).
 */
export function buildTransportPosition(beats: number): Uint8Array {
  if (!Number.isInteger(beats) || beats < 0 || beats > OTP_TRANSPORT_BEATS_MAX) {
    throw new RangeError(
      `Position ${beats} liegt ausserhalb 0..${OTP_TRANSPORT_BEATS_MAX} Beats — der Song-Position-Pointer trägt 14 Bit; der Stub sagt grössere Werte stumm ab (nur error_count)`,
    );
  }
  return buildTransportPositionRoh(beats);
}

/**
 * Takt (ab 1) und Step (1..stepsProTakt) → Beats für den SPP. Die Electribe
 * zählt 16 Steps je Takt (Sechzehntel), also Takt 2 · Step 10 = 25 Beats.
 */
export function positionAusTaktStep(takt: number, step: number, stepsProTakt = 16): number {
  if (!Number.isInteger(takt) || takt < 1) throw new RangeError(`Takt ${takt} — erlaubt ab 1`);
  if (!Number.isInteger(step) || step < 1 || step > stepsProTakt) throw new RangeError(`Step ${step} — erlaubt 1..${stepsProTakt}`);
  return (takt - 1) * stepsProTakt + (step - 1);
}

// ─── Antworten (Gerät → Host) ────────────────────────────────────────────────

export interface OtpIdentity {
  major: number;
  minor: number;
  patch: number;
  /** (hi << 7) | lo — beim Stub konstant 0 (kein Modul-Loader). */
  featureFlags: number;
}

/** CMD 0x01 SUB 0x01, 5 Bytes: ver_major, ver_minor, ver_patch, feat_hi, feat_lo. Der Stub sendet `00 01 00 00 00`. */
export function parseIdentityResponse(payload: Uint8Array): OtpIdentity | null {
  if (payload.length < 5) return null;
  return {
    major: payload[0] & 0x7f,
    minor: payload[1] & 0x7f,
    patch: payload[2] & 0x7f,
    featureFlags: decode14Bit(payload[3], payload[4]),
  };
}

export interface OtpFirmwareInfo {
  /** „stub“ = 5-Byte-Minimalform (das, was am Gerät läuft); „voll“ = Loader-Layout mit Hash/Modulen. */
  form: "stub" | "voll";
  major: number;
  minor: number;
  patch: number;
  featureFlags: number;
  /** Nur in der vollen Form: u64 LE aus 10 7-Bit-Bytes. */
  gitHash?: bigint;
  moduleIds?: number[];
}

/** Bits von `feature_flags` (Loader-Form). Der Stub setzt keines davon. */
export const OTP_FW_FLAGS: readonly [number, string][] = [
  [0, "Granular"],
  [1, "Wavetable"],
  [2, "Mod-Matrix"],
  [3, "Arpeggiator"],
  [4, "Euclid"],
  [5, "Chord"],
  [6, "Voice-Steal"],
  [7, "Clock-PLL"],
  [8, "MPE-Voice"],
  [9, "IRQ-TX-Ring"],
  [10, "Clock-Sync"],
  [11, "Clock-Out"],
  [12, "SPP"],
  [13, "Adaptive-Jitter"],
  [14, "NRPN-Full"],
  [15, "Pattern-Engine"],
];

/**
 * CMD 0x09 SUB 0x01. Zwei Formen:
 *   - Stub (15-Byte-Rahmen, 5 Bytes Nutzlast) — identisch mit der Identity-Nutzlast.
 *   - Loader (≥ 19 Bytes): ver(3) · git_hash 7-bit(10) · module_count(1) · ids(N) · flags pack32(5).
 */
export function parseFirmwareInfoResponse(payload: Uint8Array): OtpFirmwareInfo | null {
  if (payload.length < 5) return null;
  const major = payload[0] & 0x7f;
  const minor = payload[1] & 0x7f;
  const patch = payload[2] & 0x7f;
  if (payload.length < 19) {
    return { form: "stub", major, minor, patch, featureFlags: decode14Bit(payload[3], payload[4]) };
  }
  let pos = 3;
  const gitRoh = decode7Bit(payload.slice(pos, pos + 10));
  let gitHash = 0n;
  for (let i = 0; i < Math.min(gitRoh.length, 8); i++) gitHash |= BigInt(gitRoh[i]) << BigInt(8 * i);
  pos += 10;
  const anzahl = payload[pos++] & 0x7f;
  const moduleIds: number[] = [];
  for (let i = 0; i < anzahl && pos < payload.length; i++) moduleIds.push(payload[pos++] & 0x7f);
  const featureFlags = pos + 5 <= payload.length ? unpack32_7bit(payload, pos) : 0;
  return { form: "voll", major, minor, patch, gitHash, moduleIds, featureFlags };
}

export interface OtpParamAntwort {
  /** Part 1–16 (Draht + 1). */
  part: number;
  hi: number;
  lo: number;
  /** Der Parameter aus der Registry, falls bekannt. */
  param: OtpParamDef | null;
  /** Die 14-Bit-Zahl vom Draht, ungedeutet. */
  roh14: number;
  /**
   * Der Wert, wie der Stub ihn hält: das untere Byte, bei signed als int8.
   * Der Stub sendet `(uint8)*slot` — für Osc-Pitch −24 also 232, nicht 0x3FE8.
   * Die 14-Bit-Deutung (`signed14`) wäre hier falsch.
   */
  wert: number;
}

/** CMD 0x02 SUB 0x02 (GET-Antwort) und SUB 0x03 (Notify): part · hi · lo · v_hi · v_lo. */
export function parseParamAntwort(payload: Uint8Array): OtpParamAntwort | null {
  if (payload.length < 5) return null;
  const hi = payload[1] & 0x7f;
  const lo = payload[2] & 0x7f;
  const param = otpParamVonId(hi, lo);
  const roh14 = decode14Bit(payload[3], payload[4]);
  const byte = roh14 & 0xff;
  const wert = param?.signed ? (byte >= 0x80 ? byte - 0x100 : byte) : byte;
  return { part: (payload[0] & 0x0f) + 1, hi, lo, param, roh14, wert };
}

// ─── Telemetrie (CMD 0x07) ───────────────────────────────────────────────────

export const OTP_LAYER1_MAGIC = 0xb5d1f501;
export const OTP_USBDX_MAGIC = 0xb5d1f507;
export const OTP_CTX_MAGIC = 0x4b545830;

/** Feldreihenfolge = Drahtformat (otp_codec.py `OTP_TELEMETRY_FELDER`): 8 USB, 17 DIN, 4 Kontext. */
export const OTP_TELEMETRIE_FELDER: readonly string[] = [
  "usb_magic",
  "usb_in_progress",
  "usb_hook_calls",
  "usb_f0_starts",
  "usb_f7_complete",
  "usb_otp_frames",
  "usb_overflow",
  "usb_len_collecting",
  "magic",
  "call_count",
  "f0_count",
  "f7_count",
  "otp_frame_count",
  "korg_mfr_frame_count",
  "other_frame_count",
  "buffer_overflow_count",
  "aborted_frame_count",
  "error_count",
  "otp_dispatch_count",
  "otp_response_sent_count",
  "otp_last_cmd",
  "otp_last_sub",
  "otp_response_pending",
  "cmd_0x52_count",
  "chk_fail_count",
  "ctx_magic",
  "ctx_cpsr",
  "ctx_sp",
  "ctx_lr",
];
const TELEMETRIE_FELDER_PFLICHT = 25; // USB + DIN; der Kontextblock (Sprint 152) darf fehlen

export interface OtpTelemetrie {
  felder: Record<string, number>;
  usbGueltig: boolean;
  structGueltig: boolean;
  /** Kontextblock vorhanden und einmal erfasst? */
  ctxGemessen: boolean;
}

/** CMD 0x07 SUB 0x02: 7-of-8-kodierte u32 LE in Feldreihenfolge. */
export function parseTelemetryReport(payload: Uint8Array): OtpTelemetrie | null {
  const roh = decode7Bit(payload);
  const anzahl = Math.floor(roh.length / 4);
  if (anzahl < TELEMETRIE_FELDER_PFLICHT) return null;
  const felder: Record<string, number> = {};
  for (let i = 0; i < Math.min(anzahl, OTP_TELEMETRIE_FELDER.length); i++) {
    const o = i * 4;
    felder[OTP_TELEMETRIE_FELDER[i]] = (roh[o] | (roh[o + 1] << 8) | (roh[o + 2] << 16) | (roh[o + 3] << 24)) >>> 0;
  }
  return {
    felder,
    usbGueltig: felder.usb_magic === OTP_USBDX_MAGIC,
    structGueltig: felder.magic === OTP_LAYER1_MAGIC,
    ctxGemessen: felder.ctx_magic === OTP_CTX_MAGIC,
  };
}

/** Gegenstück für Tests und Simulation (wie `build_telemetry_report` in Python). */
export function buildTelemetryReport(werte: Partial<Record<string, number>>): Uint8Array {
  const roh: number[] = [];
  for (const name of OTP_TELEMETRIE_FELDER) {
    const v = (werte[name] ?? 0) >>> 0;
    roh.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
  }
  return buildFrame(OtpCmd.TELEMETRY, OtpSub.TELEMETRY_REPORT, encode7Bit(roh));
}

/** Die fünf Diagnose-Stufen aus Omnitribe `tools/hwtest/telemetry_read.py`, in dieser Reihenfolge. */
export const OTP_TELEMETRIE_STUFEN: readonly [feld: string, label: string, hinweis: string][] = [
  ["usb_hook_calls", "Hook-Aufrufe (USB)", "Der Hook läuft nicht. Flash prüfen, Trampolin-Adresse prüfen."],
  ["usb_f0_starts", "SysEx-Starts (F0)", "Keine SysEx-Bytes am Parser. Port, Kabel oder MIDI-Kanal prüfen."],
  ["usb_otp_frames", "erkannte OTP-Frames", "Bytes kommen an, aber kein Frame wird erkannt. Rahmen/Hersteller-ID."],
  [
    "otp_dispatch_count",
    "an Handler weitergereicht",
    "Frames erkannt, aber nicht dispatcht. Steht der Re-Entrancy-Guard (usb_in_progress) auf einem Müllwert, hilft nur Stromlosmachen.",
  ],
  ["otp_response_sent_count", "Antworten gesendet", "Handler lief, es ging nichts hinaus. TX-Pfad/Dispatcher prüfen."],
];

export interface OtpVerdikt {
  verdikt: string;
  begruendung: string;
}

/**
 * Verdikt wie `deuten()` in telemetry_read.py — inklusive der Selbstbeobachtung:
 * `otp_response_sent_count` wird erst NACH dem Bauen des Antwortrahmens erhöht,
 * die Antwort in der Hand ist also selbst der Beleg für mindestens 1.
 */
export function deuteTelemetrie(t: OtpTelemetrie): OtpVerdikt {
  const d = { ...t.felder };
  const hex = (v: number | undefined) => `0x${((v ?? 0) >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
  if (!t.usbGueltig) {
    return {
      verdikt: "USB-STRUCT UNGÜLTIG",
      begruendung: `usb_magic = ${hex(d.usb_magic)}, erwartet ${hex(OTP_USBDX_MAGIC)}. Der USB-Akkumulator ist nicht initialisiert; seine Zahlen sind bedeutungslos.`,
    };
  }
  if (d.usb_in_progress !== 0 && d.usb_in_progress !== 1) {
    return {
      verdikt: "GUARD HÄNGT",
      begruendung: `usb_in_progress = ${hex(d.usb_in_progress)} — weder 0 noch 1. Jeder Frame steigt an der Sperre aus; Gerät stromlos machen.`,
    };
  }
  if ((d.otp_response_sent_count ?? 0) === 0) d.otp_response_sent_count = 1;
  for (const [feld, , hinweis] of OTP_TELEMETRIE_STUFEN) {
    if ((d[feld] ?? 0) === 0) return { verdikt: `HÄNGT BEI: ${feld}`, begruendung: hinweis };
  }
  const chk = d.chk_fail_count ?? 0;
  const chkText = chk > 0 ? ` Dazu ${chk} Rahmen mit falscher Prüfsumme.` : "";
  if ((d.error_count ?? 0) > 0) {
    return {
      verdikt: "LÄUFT, MIT ABLEHNUNGEN",
      begruendung:
        `${d.error_count} Frames wurden erkannt und abgelehnt — Länge, unbekannte ID oder Part ausserhalb. ` +
        `Zuletzt gesehen: CMD 0x${(d.otp_last_cmd ?? 0).toString(16).padStart(2, "0")} SUB 0x${(d.otp_last_sub ?? 0).toString(16).padStart(2, "0")}.` +
        chkText,
    };
  }
  return { verdikt: "LÄUFT", begruendung: "Alle fünf Stufen sind durchlaufen, keine Ablehnungen." + chkText };
}

/** Lesbarer Bericht einer Telemetrie-Antwort (für Panel und Tests). */
export function telemetrieText(t: OtpTelemetrie): string {
  const z: string[] = [];
  const v = deuteTelemetrie(t);
  z.push(`Verdikt: ${v.verdikt} — ${v.begruendung}`);
  z.push(
    `usb_magic ${t.usbGueltig ? "gültig" : "UNGÜLTIG"} · din_magic ${t.structGueltig ? "gültig" : "uninitialisiert (Firmware ohne Sprint-146-Fix?)"}`,
  );
  for (const [feld, label] of OTP_TELEMETRIE_STUFEN) z.push(`  ${label.padEnd(26)} ${t.felder[feld] ?? "–"}`);
  const weitere: [string, string][] = [
    ["usb_in_progress", "Re-Entrancy-Guard (0 frei, 1 läuft)"],
    ["error_count", "abgelehnte Frames (Länge/ID/Part)"],
    ["chk_fail_count", "Prüfsummenfehler"],
    ["usb_f7_complete", "vollständige Frames (USB)"],
    ["usb_overflow", "Frames > Puffer (USB)"],
    ["otp_last_cmd", "zuletzt gesehenes CMD"],
    ["otp_last_sub", "zuletzt gesehenes SUB"],
    ["cmd_0x52_count", "Memory-Peeks (CMD 0x52)"],
    ["call_count", "Hook-Aufrufe (DIN — über USB erwartbar 0)"],
  ];
  for (const [feld, label] of weitere) {
    const w = t.felder[feld];
    if (w === undefined) continue;
    const anzeige = feld === "otp_last_cmd" || feld === "otp_last_sub" ? `0x${w.toString(16).padStart(2, "0")}` : String(w);
    z.push(`  ${label.padEnd(38)} ${anzeige}`);
  }
  if (t.ctxGemessen) {
    const cpsr = t.felder.ctx_cpsr ?? 0;
    const modi: Record<number, string> = { 0x10: "User", 0x11: "FIQ", 0x12: "IRQ", 0x13: "Supervisor", 0x1f: "System" };
    z.push(
      `  Hook-Kontext: Modus ${modi[cpsr & 0x1f] ?? `0x${(cpsr & 0x1f).toString(16)}`}, IRQ ${cpsr & 0x80 ? "gesperrt" : "frei"}, SP 0x${(t.felder.ctx_sp ?? 0).toString(16).toUpperCase()}, LR 0x${(t.felder.ctx_lr ?? 0).toString(16).toUpperCase()}`,
    );
  } else if (t.felder.ctx_magic !== undefined) {
    z.push("  Hook-Kontext: nie erfasst");
  }
  return z.join("\n");
}

export function identityText(id: OtpIdentity): string {
  return `Loader v${id.major}.${id.minor}.${id.patch}, Feature-Flags 0x${id.featureFlags.toString(16).padStart(4, "0")}`;
}

export function firmwareInfoText(fw: OtpFirmwareInfo): string {
  if (fw.form === "stub") {
    return `v${fw.major}.${fw.minor}.${fw.patch} (Minimalform des Coexist-Stubs, Flags 0x${fw.featureFlags.toString(16).padStart(4, "0")})`;
  }
  const flags = OTP_FW_FLAGS.filter(([bit]) => fw.featureFlags & (1 << bit)).map(([, n]) => n);
  return (
    `v${fw.major}.${fw.minor}.${fw.patch}, Git ${(fw.gitHash ?? 0n).toString(16).padStart(16, "0")}, ` +
    `Module [${(fw.moduleIds ?? []).join(", ")}], Flags 0x${fw.featureFlags.toString(16).padStart(8, "0")}${flags.length ? ` (${flags.join(", ")})` : ""}`
  );
}

// ─── 0x52 Memory-Peek (READ ONLY, <= 64 Byte) ────────────────────────────────
// Sonderrahmen des Hacktribe-Peek-Passthrough: KEIN CMD/SUB/LEN/CHK, sondern
// F0 7D 01 02 52 <7-of-8(le32(addr) ++ le32(len))> F7. Gegenstelle: scripts/peek.mjs.
const le32 = (v: number): number[] => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

export function buildPeek(addr: number, len: number): Uint8Array {
  const l = Math.max(0, Math.min(64, len));
  const nutz = encode7Bit([...le32(addr >>> 0), ...le32(l >>> 0)]);
  return Uint8Array.from([OTP_SYSEX_START, ...OTP_MFR_ID, 0x52, ...nutz, OTP_SYSEX_END]);
}
export function istPeekAntwort(raw: Uint8Array | readonly number[]): boolean {
  return raw.length >= 6 && raw[1] === OTP_MFR_ID[0] && raw[4] === 0x52;
}
export function parsePeek(raw: Uint8Array | readonly number[], len: number): Uint8Array | null {
  if (raw.length < 2) return null;
  const start = raw[0] === OTP_SYSEX_START ? 5 : 1;
  const ende = raw[raw.length - 1] === OTP_SYSEX_END ? raw.length - 1 : raw.length;
  return decode7Bit(Array.from(raw).slice(start, ende)).slice(0, len);
}
export function peekU32(raw: Uint8Array | readonly number[]): number | null {
  const d = parsePeek(raw, 4);
  return d && d.length >= 4 ? ((d[0] | (d[1] << 8) | (d[2] << 16) | (d[3] << 24)) >>> 0) : null;
}

// ─── Modul-Lader Stufe 1 (CMD 0x05) ──────────────────────────────────────────
//
// Gegenstelle: `handle_module_block_stage1` in Omnitribes
// `src/firmware/bsdiff_stubs/sysex_layer1_hook.c` (Sprint 183). STUFE 1 empfängt
// einen Modul-Block, dekodiert und VALIDIERT nur den 44-Byte-Header und schickt
// einen ACK zurück. Der Stub kopiert NICHTS nach 0xC6100000 und ruft WEDER
// init() NOCH deinit() auf — es wird kein empfangener Code ausgeführt. Ausführung
// wäre Stufe 2 (am Gerät zu vermessendes freies DDR), hier bewusst nicht dabei.

/** Länge des OTMR-Modul-Headers (Spiegel von `OmniTribeModule` auf 32-Bit-ARM). */
export const OTP_MODULE_HEADER_LEN = 44;
/** „OTMR“ als u32 little-endian (Bytes 0x52 0x4D 0x54 0x4F ab Offset 0). */
export const OTP_MODULE_MAGIC = 0x4f544d52;
export const OTP_MODULE_API_VERSION = 1;
/** Der Stub akzeptiert module_id 0..31 (Breite des u32-Bitfelds; die alte 16 war ein nicht mitgewachsener Planungswert). */
export const OTP_MODULE_MAX_ID = 32;

/** Felder für einen synthetischen 44-Byte-Header (Test/Sonde). */
export interface OtpModuleHeaderFelder {
  moduleId: number;
  name?: string;
  /** api-Zeiger als Wert. 0 ⇒ der Stub weist mit Status 0x07 ab. Default 1 (gültig, wird NIE dereferenziert). */
  apiPtr?: number;
  /** Überschreibbar für Negativ-Sonden (Default OTP_MODULE_MAGIC). */
  magic?: number;
  /** Überschreibbar für Negativ-Sonden (Default OTP_MODULE_API_VERSION). */
  apiVersion?: number;
  /** module_id im Header; weicht sie von `moduleId` ab, weist der Stub mit 0x06 ab (Default = moduleId). */
  headerId?: number;
  codeSize?: number;
  bssSize?: number;
  flags?: number;
  userData?: number;
}

function u32le(v: number): [number, number, number, number] {
  const x = v >>> 0;
  return [x & 0xff, (x >>> 8) & 0xff, (x >>> 16) & 0xff, (x >>> 24) & 0xff];
}
function u16le(v: number): [number, number] {
  const x = v & 0xffff;
  return [x & 0xff, (x >>> 8) & 0xff];
}

/**
 * Baut einen rohen 44-Byte-OTMR-Header (8-Bit, noch NICHT 7-of-8-kodiert).
 * Layout: magic@0 · api_version@4 · module_id@6 · name@8[16] · code_size@24 ·
 * bss_size@28 · flags@32 · user_data@36 · api@40.
 */
export function buildModuleHeader(f: OtpModuleHeaderFelder): Uint8Array {
  const h = new Uint8Array(OTP_MODULE_HEADER_LEN);
  h.set(u32le(f.magic ?? OTP_MODULE_MAGIC), 0);
  h.set(u16le(f.apiVersion ?? OTP_MODULE_API_VERSION), 4);
  h.set(u16le(f.headerId ?? f.moduleId), 6);
  const name = (f.name ?? "").slice(0, 15);
  for (let i = 0; i < name.length; i++) h[8 + i] = name.charCodeAt(i) & 0x7f;
  h.set(u32le(f.codeSize ?? 0), 24);
  h.set(u32le(f.bssSize ?? 0), 28);
  h.set(u32le(f.flags ?? 0), 32);
  h.set(u32le(f.userData ?? 0), 36);
  h.set(u32le(f.apiPtr ?? 1), 40);
  return h;
}

/**
 * Modul-Block-Rahmen (CMD 0x05 SUB 0x01). Nutzlast:
 * `[module_id][enc_len_hi][enc_len_lo][7-of-8-Daten…]`. `moduleBytes` sind die
 * rohen 8-Bit-Modulbytes (mindestens der 44-Byte-Header); sie werden mit
 * `encode7Bit` (= `syx_dec_minimal`-Gegenstelle) kodiert.
 */
export function buildModuleBlock(moduleId: number, moduleBytes: Uint8Array | readonly number[]): Uint8Array {
  const enc = encode7Bit(moduleBytes);
  return buildFrame(OtpCmd.MODULE, OtpSub.MODULE_BLOCK, [
    moduleId & 0x7f,
    (enc.length >> 7) & 0x7f,
    enc.length & 0x7f,
    ...enc,
  ]);
}

/** Bequem: einen synthetischen Modul-Header direkt als 0x05-Block. */
export function buildModuleHeaderBlock(f: OtpModuleHeaderFelder): Uint8Array {
  return buildModuleBlock(f.moduleId, buildModuleHeader(f));
}

/** Status-Codes des Stubs (Modul-ACK, Payload-Byte 0). Deckungsgleich mit `handle_module_block_stage1`. */
export const OTP_MODULE_STATUS: Readonly<Record<number, string>> = {
  0x00: "gültig — Header angenommen (nicht ausgeführt)",
  0x01: "Nutzlast zu kurz (< 3 Byte)",
  0x02: "module_id ≥ 32 abgewiesen",
  0x03: "Block abgeschnitten (enc_len > Nutzlast)",
  0x04: "falsche Magic (kein OTMR)",
  0x05: "falsche API-Version",
  0x06: "module_id ≠ Header-id",
  0x07: "api-Zeiger ist 0",
  0x08: "Header zu kurz (< 44 Byte dekodiert)",
  // Stufe 2 (Chunk/Commit):
  0x09: "unvollständig — Gesamtlänge ≠ code_size (Chunk verloren?)",
  0x0a: "passt nicht in den Slot (code+bss > Slot-Größe)",
  0x0b: "Chunk nicht lückenlos (Offset ≠ bisher empfangen)",
  // Sprint 185/186 (nur EXEC-Build):
  0x0c: "Pre-Call — init()/Callback wird JETZT gerufen (danach folgt der Endstatus)",
  0x0d: "Modul nicht absolut gelinkt (kein OMR_FLAG_ABS_LINKED) — nicht ausgeführt",
  0x0e: "Modul nicht platziert (kein Commit)",
  0x0f: "Callback-Index > 6",
  0x10: "Callback im api-Table ist 0 (nicht gesetzt)",
} as const;

export interface OtpModuleAck {
  status: number;
  /** True nur bei Status 0x00. */
  ok: boolean;
  moduleId: number;
  /** Laufender Zähler der bisher gesehenen 0x05-Blöcke (unteres Byte). */
  blockCount: number;
  text: string;
}

/** CMD 0x05 SUB 0x03: Payload `[status, module_id, block_count_lo]`. */
export function parseModuleAck(payload: Uint8Array): OtpModuleAck | null {
  if (payload.length < 3) return null;
  const status = payload[0] & 0x7f;
  return {
    status,
    ok: status === 0x00,
    moduleId: payload[1] & 0x7f,
    blockCount: payload[2] & 0x7f,
    text: OTP_MODULE_STATUS[status] ?? `unbekannter Status 0x${status.toString(16).padStart(2, "0")}`,
  };
}

export function moduleAckText(a: OtpModuleAck): string {
  return `Modul ${a.moduleId}: Status 0x${a.status.toString(16).padStart(2, "0")} — ${a.text} (Block #${a.blockCount})`;
}

/**
 * Vier Sonden für den Testabend: ein gültiges Test-Modul und drei
 * Negativ-Fälle, die je einen anderen Validierungszweig des Stubs treffen.
 * Alle tragen einen api-Zeiger als WERT; der Stub prüft ihn nie durch Sprung.
 */
export interface OtpModuleProbe {
  key: string;
  label: string;
  erwarteterStatus: number;
  bytes: () => Uint8Array;
}

export const OTP_MODULE_PROBES: readonly OtpModuleProbe[] = [
  { key: "gueltig", label: "Gültiges Test-Modul (id 0)", erwarteterStatus: 0x00, bytes: () => buildModuleHeaderBlock({ moduleId: 0, name: "stage1-probe", apiPtr: 1 }) },
  { key: "magic", label: "Falsche Magic", erwarteterStatus: 0x04, bytes: () => buildModuleHeaderBlock({ moduleId: 0, magic: 0xdeadbeef, apiPtr: 1 }) },
  { key: "noapi", label: "Kein api-Zeiger", erwarteterStatus: 0x07, bytes: () => buildModuleHeaderBlock({ moduleId: 0, apiPtr: 0 }) },
  { key: "idmix", label: "Falsche Header-id", erwarteterStatus: 0x06, bytes: () => buildModuleHeaderBlock({ moduleId: 0, headerId: 5, apiPtr: 1 }) },
  { key: "idgrenze", label: "id 32 (jenseits der Grenze)", erwarteterStatus: 0x02, bytes: () => buildModuleHeaderBlock({ moduleId: 32, apiPtr: 1 }) },
] as const;

/**
 * Echte 44-Byte-OTMR-Header aus den kompilierten Omnitribe-Modulen
 * (`build/modules/*.bin`, Stand Commit-Baum). Nur der Header wird gesendet —
 * ein ganzes Modul (140–2508 B) passt NICHT in den 264-B-Stub-Akkumulator;
 * das kann erst Stufe 2 mit Chunk-Empfang direkt ins DDR. Diese Sonden belegen
 * den stärkeren Anspruch: der Stub validiert einen ECHTEN kompilierten
 * Modul-Header, nicht nur ein Kunstprodukt. `audio_input_routing` (id 21) zeigt
 * die MAX_ID-Grenze (16) an echten Daten — der Stub weist sie mit 0x02 ab.
 */
export const OTP_MODULE_REAL_HEADERS: readonly { name: string; id: number; header: readonly number[] }[] = [
  { name: "modmatrix", id: 0, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x00,0x00,0x6d,0x6f,0x64,0x6d,0x61,0x74,0x72,0x69,0x78,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x54,0x03,0x00,0x00,0x24,0x03,0x00,0x00,0x0d,0x00,0x00,0x00,0x58,0x03,0x00,0x00,0x20,0x03,0x00,0x00] },
  { name: "arpeggiator", id: 1, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x01,0x00,0x61,0x72,0x70,0x65,0x67,0x67,0x69,0x61,0x74,0x6f,0x72,0x00,0x00,0x00,0x00,0x00,0xcc,0x09,0x00,0x00,0xc0,0x03,0x00,0x00,0x0e,0x00,0x00,0x00,0xcc,0x09,0x00,0x00,0x98,0x09,0x00,0x00] },
  { name: "granular", id: 2, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x02,0x00,0x67,0x72,0x61,0x6e,0x75,0x6c,0x61,0x72,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x04,0x04,0x00,0x00,0x00,0x03,0x00,0x00,0x05,0x00,0x00,0x00,0x08,0x04,0x00,0x00,0xd0,0x03,0x00,0x00] },
  { name: "wavetable", id: 3, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x03,0x00,0x77,0x61,0x76,0x65,0x74,0x61,0x62,0x6c,0x65,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xa0,0x02,0x00,0x00,0xa4,0x00,0x00,0x00,0x05,0x00,0x00,0x00,0xa4,0x02,0x00,0x00,0x6c,0x02,0x00,0x00] },
  { name: "midi_clock", id: 7, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x07,0x00,0x63,0x6c,0x6f,0x63,0x6b,0x5f,0x70,0x6c,0x6c,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xdc,0x00,0x00,0x00,0x18,0x00,0x00,0x00,0x01,0x00,0x00,0x00,0xe0,0x00,0x00,0x00,0xa8,0x00,0x00,0x00] },
  { name: "mpe_voice", id: 8, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x08,0x00,0x6d,0x70,0x65,0x5f,0x76,0x6f,0x69,0x63,0x65,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xd8,0x01,0x00,0x00,0x84,0x00,0x00,0x00,0x0c,0x00,0x00,0x00,0xd8,0x01,0x00,0x00,0xa4,0x01,0x00,0x00] },
  { name: "chord", id: 9, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x09,0x00,0x63,0x68,0x6f,0x72,0x64,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xb0,0x03,0x00,0x00,0x64,0x04,0x00,0x00,0x0d,0x00,0x00,0x00,0xb0,0x03,0x00,0x00,0x24,0x03,0x00,0x00] },
  { name: "performance", id: 10, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x0a,0x00,0x70,0x65,0x72,0x66,0x6f,0x72,0x6d,0x61,0x6e,0x63,0x65,0x00,0x00,0x00,0x00,0x00,0x40,0x02,0x00,0x00,0x60,0x00,0x00,0x00,0x04,0x00,0x00,0x00,0x40,0x02,0x00,0x00,0x0c,0x02,0x00,0x00] },
  { name: "voice_steal", id: 11, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x0b,0x00,0x76,0x6f,0x69,0x63,0x65,0x5f,0x73,0x74,0x65,0x61,0x6c,0x00,0x00,0x00,0x00,0x00,0xc0,0x03,0x00,0x00,0x34,0x06,0x00,0x00,0x08,0x00,0x00,0x00,0xc0,0x03,0x00,0x00,0x8c,0x03,0x00,0x00] },
  { name: "randomizer", id: 12, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x0c,0x00,0x72,0x61,0x6e,0x64,0x6f,0x6d,0x69,0x7a,0x65,0x72,0x00,0x00,0x00,0x00,0x00,0x00,0x58,0x01,0x00,0x00,0x90,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x58,0x01,0x00,0x00,0x24,0x01,0x00,0x00] },
  { name: "sidechain", id: 13, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x0d,0x00,0x73,0x69,0x64,0x65,0x63,0x68,0x61,0x69,0x6e,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x68,0x01,0x00,0x00,0x84,0x00,0x00,0x00,0x04,0x00,0x00,0x00,0x68,0x01,0x00,0x00,0x34,0x01,0x00,0x00] },
  { name: "midi_learn", id: 14, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x0e,0x00,0x6d,0x69,0x64,0x69,0x5f,0x6c,0x65,0x61,0x72,0x6e,0x00,0x00,0x00,0x00,0x00,0x00,0xd8,0x00,0x00,0x00,0x08,0x02,0x00,0x00,0x04,0x00,0x00,0x00,0xd8,0x00,0x00,0x00,0xa4,0x00,0x00,0x00] },
  { name: "preset_manager", id: 15, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x0f,0x00,0x70,0x72,0x65,0x73,0x65,0x74,0x5f,0x6d,0x61,0x6e,0x61,0x67,0x65,0x72,0x00,0x00,0x8c,0x00,0x00,0x00,0x80,0x36,0x00,0x00,0x04,0x00,0x00,0x00,0x8c,0x00,0x00,0x00,0x58,0x00,0x00,0x00] },
  { name: "undo_redo", id: 16, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x10,0x00,0x75,0x6e,0x64,0x6f,0x5f,0x72,0x65,0x64,0x6f,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0xbc,0x00,0x00,0x00,0x0c,0x02,0x00,0x00,0x01,0x00,0x00,0x00,0xc0,0x00,0x00,0x00,0x88,0x00,0x00,0x00] },
  { name: "polyphony_pool", id: 17, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x11,0x00,0x70,0x6f,0x6c,0x79,0x70,0x68,0x6f,0x6e,0x79,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x00,0x00,0x44,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x01,0x00,0x00,0xcc,0x00,0x00,0x00] },
  { name: "cpu_budget_module", id: 18, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x12,0x00,0x63,0x70,0x75,0x5f,0x62,0x75,0x64,0x67,0x65,0x74,0x00,0x00,0x00,0x00,0x00,0x00,0x50,0x01,0x00,0x00,0x14,0x00,0x00,0x00,0x05,0x00,0x00,0x00,0x50,0x01,0x00,0x00,0x1c,0x01,0x00,0x00] },
  { name: "spectral_morph", id: 19, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x13,0x00,0x73,0x70,0x65,0x63,0x5f,0x6d,0x6f,0x72,0x70,0x68,0x00,0x00,0x00,0x00,0x00,0x00,0x20,0x02,0x00,0x00,0x84,0x00,0x00,0x00,0x05,0x00,0x00,0x00,0x20,0x02,0x00,0x00,0xec,0x01,0x00,0x00] },
  { name: "sd_stream", id: 20, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x14,0x00,0x73,0x64,0x5f,0x73,0x74,0x72,0x65,0x61,0x6d,0x00,0x00,0x00,0x00,0x00,0x00,0x00,0x34,0x01,0x00,0x00,0x60,0x00,0x00,0x00,0x04,0x00,0x00,0x00,0x38,0x01,0x00,0x00,0x00,0x01,0x00,0x00] },
  { name: "audio_input_routing", id: 21, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x15,0x00,0x61,0x75,0x64,0x69,0x6f,0x5f,0x69,0x6e,0x70,0x75,0x74,0x00,0x00,0x00,0x00,0x00,0x44,0x01,0x00,0x00,0x08,0x00,0x00,0x00,0x04,0x00,0x00,0x00,0x44,0x01,0x00,0x00,0x10,0x01,0x00,0x00] },
  { name: "audio_test", id: 30, header: [0x52,0x4d,0x54,0x4f,0x01,0x00,0x1e,0x00,0x61,0x75,0x64,0x69,0x6f,0x5f,0x74,0x65,0x73,0x74,0x00,0x00,0x00,0x00,0x00,0x00,0x5c,0x01,0x00,0x00,0x10,0x00,0x00,0x00,0x09,0x00,0x00,0x00,0x60,0x01,0x00,0x00,0x28,0x01,0x00,0x00] },
] as const;

export const OTP_MODULE_REAL_PROBES: readonly OtpModuleProbe[] = OTP_MODULE_REAL_HEADERS.map((m) => ({
  key: `real-${m.name}`,
  label: `${m.name} (id ${m.id})`,
  erwarteterStatus: m.id < OTP_MODULE_MAX_ID ? 0x00 : 0x02,
  bytes: () => buildModuleBlock(m.id, m.header),
}));

// ─── Modul-Lader Stufe 2 (CMD 0x05 SUB 0x02/0x04) ────────────────────────────
//
// Gegenstelle: `handle_module_chunk` / `handle_module_commit` in Omnitribes
// `sysex_layer1_hook.c`, NUR unter -DOMNITRIBE_MODULE_STAGE2 kompiliert. Diese
// Builder sind die Host-Vorbereitung: ein ganzes Modul wird chunk-weise ins DDR
// geladen (der 264-B-Stub-Puffer fasst kein volles Modul) und dann committet.
// Der Stub führt nichts aus, solange nicht zusätzlich das EXEC-Flag frei ist.

/** Empfohlene rohe Chunk-Größe: 7-of-8 davon plus Rahmen bleibt unter dem 264-B-Puffer. */
export const OTP_MODULE_CHUNK_RAW = 180;

/** Ein Chunk: SUB 0x02, Payload `[module_id][off_hi7][off_mid7][off_lo7][7-of-8 data]` (21-Bit-Offset). */
export function buildModuleChunk(moduleId: number, offset: number, rawChunk: Uint8Array | readonly number[]): Uint8Array {
  if (offset < 0 || offset > 0x1fffff) throw new RangeError(`Chunk-Offset ${offset} ausserhalb 0..0x1FFFFF (21 Bit)`);
  const enc = encode7Bit(rawChunk);
  return buildFrame(OtpCmd.MODULE, OtpSub.MODULE_CHUNK, [
    moduleId & 0x7f,
    (offset >> 14) & 0x7f,
    (offset >> 7) & 0x7f,
    offset & 0x7f,
    ...enc,
  ]);
}

/** Commit: SUB 0x04, Payload `[module_id]` — platziert/reloziert das empfangene Modul. */
export function buildModuleCommit(moduleId: number): Uint8Array {
  return buildFrame(OtpCmd.MODULE, OtpSub.MODULE_COMMIT, [moduleId & 0x7f]);
}

// ── Sprint 185/186: Callback-Aufruf, Egress-Drain, Periodik-Hook (nur EXEC-Build) ──

/** api-Slot-Index eines Modul-Callbacks (== Reihenfolge in OmniTribeModuleApi). */
export const OTP_MODULE_CB = {
  INIT: 0, ON_NRPN: 1, ON_CLOCK_TICK: 2, ON_AUDIO_TICK: 3, ON_NOTE_ON: 4, ON_NOTE_OFF: 5, DEINIT: 6,
} as const;
export type OtpModuleCb = (typeof OTP_MODULE_CB)[keyof typeof OTP_MODULE_CB];

/**
 * SUB 0x05: `[module_id, cb_index, 7-of-8(arg-bytes)]`. Rohe Argument-Bytes wie
 * der Stub sie dekodiert: on_nrpn `[msb, lsb, val_lo, val_hi]`, on_clock/audio
 * `[u32 LE]`, on_note_on `[ch, note, vel]`, on_note_off `[ch, note]`. Antwort:
 * ACK 0x0C (Pre-Call) dann 0x00 — oder ein Fehlerstatus 0x0D..0x10.
 */
export function buildModuleCallback(moduleId: number, cb: OtpModuleCb, args: readonly number[] = []): Uint8Array {
  return buildFrame(OtpCmd.MODULE, OtpSub.MODULE_CALLBACK, [moduleId & 0x7f, cb & 0x7f, ...encode7Bit(args)]);
}

/** SUB 0x06: Modul-Mailbox im Task-Kontext leeren (Egress → Firmware). ACK: `[0x00, 0x7F, frames_lo7]`. */
export function buildModuleDrain(): Uint8Array {
  return buildFrame(OtpCmd.MODULE, OtpSub.MODULE_DRAIN, []);
}

/** 14-Bit-Wert als `[hi7, lo7]`. */
function be14(v: number): [number, number] {
  const n = Math.max(0, Math.min(0x3fff, Math.round(v)));
  return [(n >> 7) & 0x7f, n & 0x7f];
}

/** CMD 0x04 SUB 0x01: Tabellenwert `table[irq]` lesen (Firmware-Callback-Tabelle 0xC06A26A8). */
export function buildIrqPeek(irq: number): Uint8Array {
  return buildFrame(OtpCmd.IRQ_HOOK, OtpSub.IRQ_PEEK, [irq & 0x7f]);
}
/**
 * CMD 0x04 SUB 0x02: Wrapper in `table[irq]` einhängen. `divAudio`/`divClock` = Teiler
 * der Timer-Ticks (0 = aus), `clockSource` 0 = MIDI-0xF8, 1 = Timer-Teiler.
 * Nur zählen (Rate messen): alle Teiler 0.
 */
export function buildIrqInstall(irq: number, divAudio = 0, divClock = 0, clockSource: 0 | 1 = 0): Uint8Array {
  return buildFrame(OtpCmd.IRQ_HOOK, OtpSub.IRQ_INSTALL, [irq & 0x7f, ...be14(divAudio), ...be14(divClock), clockSource & 1]);
}
/** CMD 0x04 SUB 0x03: Original-Callback zurückschreiben. */
export function buildIrqRestore(): Uint8Array {
  return buildFrame(OtpCmd.IRQ_HOOK, OtpSub.IRQ_RESTORE, []);
}
/** CMD 0x04 SUB 0x04: zwölf Zähler abfragen (siehe `OTP_IRQ_STATUS_FIELDS`). */
export function buildIrqStatus(): Uint8Array {
  return buildFrame(OtpCmd.IRQ_HOOK, OtpSub.IRQ_STATUS, []);
}
/** CMD 0x04 SUB 0x05: nur Teiler/Quelle setzen (ohne Install). */
export function buildIrqConfig(divAudio: number, divClock: number, clockSource: 0 | 1): Uint8Array {
  return buildFrame(OtpCmd.IRQ_HOOK, OtpSub.IRQ_CONFIG, [...be14(divAudio), ...be14(divClock), clockSource & 1]);
}

export const OTP_IRQ_STATUS_FIELDS = [
  "installed", "irq", "orig", "ticks", "audioTicks", "clockTicks",
  "evNoteOn", "evNrpn", "egressFrames", "egressDropped", "egressRefused", "evClockMidi",
  /** Timer-Ticks, die der Wrapper ohne Modul-Aufruf verwarf, weil gerade ein Task-Kontext-Callback lief. */
  "ticksSkipped",
] as const;

/** SUB 0x07: Modul aus `placed_mask` nehmen (0x7F = alle) — bekommt dann keine Ereignisse mehr. ACK `[0x00, id, mask_lo7]`. */
export function buildModuleUnplace(moduleId: number | "alle" = "alle"): Uint8Array {
  return buildFrame(OtpCmd.MODULE, OtpSub.MODULE_UNPLACE, [moduleId === "alle" ? 0x7f : moduleId & 0x7f]);
}

export interface OtpIrqReport {
  /** Echo des angefragten SUB (0x01..0x05). */
  sub: number;
  /** Rohe u32-Werte in Sendereihenfolge. */
  values: number[];
  /** Nur bei SUB 0x04 gefüllt: benannte Zähler. */
  status?: Record<(typeof OTP_IRQ_STATUS_FIELDS)[number], number>;
  /** Einzelwert ⇒ Fehlerstatus des Stubs (0x10 unbekannter SUB, 0x11 Nutzlast, 0x12 irq ≥ 101, 0x13 schon installiert, 0x14 Slot leer, 0x15 nichts installiert). */
  error?: number;
}

/**
 * CMD 0x04 SUB 0x7F: Payload `[sub, n × (hi, b0, b1, b2, b3)]` — je u32 eine
 * 7-of-8-Gruppe zu genau vier Bytes (Bit j von `hi` = Bit 7 von `b_j`).
 */
export function parseIrqReport(payload: Uint8Array): OtpIrqReport | null {
  if (payload.length < 1 || (payload.length - 1) % 5 !== 0) return null;
  const sub = payload[0] & 0x7f;
  const values: number[] = [];
  for (let i = 1; i + 4 < payload.length + 1; i += 5) {
    const hi = payload[i];
    const b = (k: number) => (payload[i + 1 + k] & 0x7f) | (((hi >> k) & 1) << 7);
    values.push((b(0) | (b(1) << 8) | (b(2) << 16) | (b(3) << 24)) >>> 0);
  }
  const rep: OtpIrqReport = { sub, values };
  if (sub === OtpSub.IRQ_STATUS && values.length === OTP_IRQ_STATUS_FIELDS.length) {
    rep.status = Object.fromEntries(OTP_IRQ_STATUS_FIELDS.map((f, k) => [f, values[k]])) as OtpIrqReport["status"];
  } else if (values.length === 1 && values[0] >= 0x10 && values[0] <= 0x15) {
    rep.error = values[0];
  }
  return rep;
}

/**
 * Ein ganzes Modul als Frame-Folge: N Chunks (lückenlos, in Reihenfolge) plus
 * ein abschliessender Commit. `moduleBytes` sind die rohen Modul-Bytes aus
 * `build/modules/<name>.bin` (Header + code + data; die BSS füllt der Stub).
 */
export function buildModuleUpload(moduleId: number, moduleBytes: Uint8Array | readonly number[], rawPerChunk = OTP_MODULE_CHUNK_RAW): Uint8Array[] {
  const data = moduleBytes instanceof Uint8Array ? moduleBytes : Uint8Array.from(moduleBytes);
  const frames: Uint8Array[] = [];
  for (let off = 0; off < data.length; off += rawPerChunk) {
    frames.push(buildModuleChunk(moduleId, off, data.subarray(off, off + rawPerChunk)));
  }
  frames.push(buildModuleCommit(moduleId));
  return frames;
}

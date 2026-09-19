import { describe, it, expect } from "vitest";
import {
  OtpCmd,
  OtpSub,
  OTP_PARAMS,
  otpParam,
  otpParamVonId,
  encode7Bit,
  decode7Bit,
  xorChecksum,
  unpack32_7bit,
  pack32_7bit,
  encode21Bit,
  decode21Bit,
  encode14Bit,
  decode14Bit,
  signed14,
  buildFrame,
  parseFrame,
  istOtpAntwort,
  buildIdentityRequest,
  buildFirmwareInfoRequest,
  buildTelemetryRequest,
  buildParamSetRoh,
  buildParamGetRoh,
  buildParamSet,
  buildParamGet,
  buildTransportPlay,
  buildTransportStop,
  buildTransportPosition,
  buildTransportPositionRoh,
  positionAusTaktStep,
  OTP_TRANSPORT_BEATS_MAX,
  belegText,
  paramWertText,
  parseIdentityResponse,
  parseFirmwareInfoResponse,
  parseParamAntwort,
  parseTelemetryReport,
  buildTelemetryReport,
  deuteTelemetrie,
  telemetrieText,
  identityText,
  firmwareInfoText,
  OTP_LAYER1_MAGIC,
  OTP_USBDX_MAGIC,
  OTP_CTX_MAGIC,
  OTP_TELEMETRIE_FELDER,
  OTP_MODULE_HEADER_LEN,
  OTP_MODULE_MAGIC,
  OTP_MODULE_API_VERSION,
  buildModuleHeader,
  buildModuleBlock,
  buildModuleHeaderBlock,
  parseModuleAck,
  OTP_MODULE_STATUS,
  OTP_MODULE_PROBES,
  OTP_MODULE_REAL_PROBES,
  OTP_MODULE_REAL_HEADERS,
  OTP_MODULE_MAX_ID,
  buildModuleChunk,
  buildModuleCommit,
  buildModuleUpload,
  OTP_MODULE_CHUNK_RAW,
  OTP_MODULE_CB,
  OTP_IRQ_STATUS_FIELDS,
  buildModuleCallback,
  buildModuleDrain,
  buildIrqPeek,
  buildIrqInstall,
  buildIrqRestore,
  buildIrqStatus,
  buildIrqConfig,
  parseIrqReport,
  buildModuleUnplace,
} from "../src/core/otp";

/**
 * OTP-Kern: Rahmen, Prüfsumme, Kodierungen, die drei belegten Parameter und
 * die Antworten des Coexist-Stubs. Die Testvektoren stammen aus SynthStudio
 * (tests/features/omnitribeBridge.test.ts) und aus Omnitribes Spezifikationen
 * (OTP_CMD_FIRMWARE_INFO.md, otp_firmware_info.md, sysex_layer1_hook.c).
 */

const bytes = (...b: number[]): Uint8Array => Uint8Array.from(b);
const arr = (u: Uint8Array): number[] => Array.from(u);

/** Gültige Telemetrie eines laufenden Geräts, alle fünf Stufen > 0. */
function gesundeTelemetrie(extra: Partial<Record<string, number>> = {}): Partial<Record<string, number>> {
  return {
    usb_magic: OTP_USBDX_MAGIC,
    usb_in_progress: 1,
    usb_hook_calls: 1234,
    usb_f0_starts: 12,
    usb_f7_complete: 12,
    usb_otp_frames: 11,
    magic: OTP_LAYER1_MAGIC,
    otp_dispatch_count: 11,
    otp_response_sent_count: 10,
    otp_last_cmd: 0x09,
    otp_last_sub: 0x00,
    ctx_magic: OTP_CTX_MAGIC,
    ctx_cpsr: 0x6000001f,
    ctx_sp: 0xc030d000,
    ctx_lr: 0xc002c65c,
    ...extra,
  };
}

describe("OTP: Rahmen und Prüfsumme (SynthStudio-Vektoren)", () => {
  it("buildFrame XOR-Prüfsumme für bekannte Nutzlasten", () => {
    // payload [1,2,3]: 1 ^ 2 ^ 3 = 0
    const f1 = buildFrame(0x01, 0x00, [1, 2, 3]);
    expect(f1[f1.length - 2]).toBe(0);
    const f2 = buildFrame(0x01, 0x00, [0x10, 0x20, 0x30]);
    expect(f2[f2.length - 2]).toBe(0);
    // [0x7F, 0x01] → 0x7E
    const f3 = buildFrame(0x01, 0x00, [0x7f, 0x01]);
    expect(f3[f3.length - 2]).toBe(0x7e);
    expect(xorChecksum([])).toBe(0);
  });

  it("die Prüfsumme geht NUR über die Nutzlast, nicht über CMD/SUB/LEN (Sprint-167-Beispiel)", () => {
    // echt:    F0 7D 01 02 0E 0A 00 03 00 00 19 19 F7 — der Nachbau mit Rumpf-XOR gab 0x60
    const f = buildFrame(0x0e, 0x0a, [0x00, 0x00, 0x19]);
    expect(arr(f)).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x0e, 0x0a, 0x00, 0x03, 0x00, 0x00, 0x19, 0x19, 0xf7]);
  });

  it("Rahmen ohne Nutzlast: Identity-, FW-Info- und Telemetrie-Anfrage byte-genau", () => {
    expect(arr(buildIdentityRequest())).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x01, 0x00, 0x00, 0x00, 0x00, 0xf7]);
    expect(arr(buildFirmwareInfoRequest())).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x09, 0x00, 0x00, 0x00, 0x00, 0xf7]);
    expect(arr(buildTelemetryRequest())).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x07, 0x01, 0x00, 0x00, 0x00, 0xf7]);
  });

  it("Spec-Beispiel Feature-Query: F0 7D 01 02 09 02 00 01 0D 0D F7", () => {
    expect(arr(buildFrame(0x09, 0x02, [0x0d]))).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x09, 0x02, 0x00, 0x01, 0x0d, 0x0d, 0xf7]);
  });

  it("Roundtrip buildFrame → parseFrame", () => {
    const f = buildFrame(OtpCmd.IDENTITY, 0x01, [0, 1, 7]);
    const p = parseFrame(f);
    expect(p.ok).toBe(true);
    if (p.ok) {
      expect(p.cmd).toBe(0x01);
      expect(p.sub).toBe(0x01);
      expect(arr(p.payload)).toEqual([0, 1, 7]);
    }
  });

  it("fremder Hersteller wird verworfen (Korg 0x42)", () => {
    const p = parseFrame(bytes(0xf0, 0x42, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0xf7));
    expect(p).toEqual({ ok: false, fehler: "fremder-hersteller" });
  });

  it("verfälschte Prüfsumme → Rahmen fällt (chk_fail_count am Gerät)", () => {
    const f = arr(buildFrame(OtpCmd.IDENTITY, 0x01, [1, 2, 3]));
    f[f.length - 2] = (f[f.length - 2] ^ 0x55) & 0x7f;
    expect(parseFrame(bytes(...f))).toEqual({ ok: false, fehler: "pruefsumme" });
  });

  it("LEN passt nicht zur Rahmenlänge → 'laenge' (error_count am Gerät), geprüft VOR der Prüfsumme", () => {
    const f = arr(buildFrame(OtpCmd.PARAM, 0x00, [0, 0, 1, 0, 5]));
    f[7] = 4; // LEN_L verfälscht
    expect(parseFrame(bytes(...f))).toEqual({ ok: false, fehler: "laenge" });
  });

  it("zu kurz und kein SysEx", () => {
    expect(parseFrame(bytes(0xf0, 0x7d, 0x01, 0x02, 0x01, 0x00, 0x00, 0x00, 0xf7))).toEqual({ ok: false, fehler: "zu-kurz" });
    expect(parseFrame(bytes(0x90, 0x7d, 0x01, 0x02, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00))).toEqual({ ok: false, fehler: "kein-sysex" });
  });

  it("istOtpAntwort matcht CMD und SUB nur bei gültigem Rahmen", () => {
    const f = buildFrame(OtpCmd.IDENTITY, OtpSub.IDENTITY_RESPONSE, [0, 1, 0, 0, 0]);
    expect(istOtpAntwort(f, OtpCmd.IDENTITY, OtpSub.IDENTITY_RESPONSE)).toBe(true);
    expect(istOtpAntwort(f, OtpCmd.FIRMWARE_INFO, OtpSub.FW_INFO_RESPONSE)).toBe(false);
    const kaputt = arr(f);
    kaputt[kaputt.length - 2] ^= 1;
    expect(istOtpAntwort(bytes(...kaputt), OtpCmd.IDENTITY, OtpSub.IDENTITY_RESPONSE)).toBe(false);
  });

  it("Nutzlast über 16383 Bytes wird abgewiesen", () => {
    expect(() => buildFrame(0x01, 0x00, new Uint8Array(0x4000))).toThrow(RangeError);
  });
});

describe("OTP: Kodierungen", () => {
  it("encode7Bit / decode7Bit Roundtrip, alle Bytes 7-Bit-sicher (SynthStudio-Vektor)", () => {
    const data = bytes(0x80, 0xff, 0x00, 0x7f, 0x42, 0x99, 0xab, 0x01);
    const enc = encode7Bit(data);
    expect(enc.length).toBe(8 + 2); // 7 + Kopf, 1 + Kopf
    for (const b of enc) expect(b & 0x80).toBe(0);
    expect(arr(decode7Bit(enc))).toEqual(arr(data));
  });

  it("encode7Bit: Kopfbyte trägt die MSBs in Bitreihenfolge (Spec-Beispiel git_hash)", () => {
    // [01..08] → Block 0: 00 01 02 03 04 05 06 07, Block 1: 00 08
    expect(arr(encode7Bit([1, 2, 3, 4, 5, 6, 7, 8]))).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0, 8]);
    expect(arr(encode7Bit([0x80, 0x00, 0xff]))).toEqual([0b101, 0x00, 0x00, 0x7f]);
  });

  it("Roundtrips über Zufallsdaten verschiedener Längen", () => {
    for (let len = 0; len < 40; len++) {
      const d = new Uint8Array(len);
      for (let i = 0; i < len; i++) d[i] = (i * 73 + len * 31) & 0xff;
      expect(arr(decode7Bit(encode7Bit(d)))).toEqual(arr(d));
    }
  });

  it("pack32_7bit / unpack32_7bit (Spec-Beispiel flags=7 → 00 00 00 00 07)", () => {
    expect(arr(pack32_7bit(7))).toEqual([0, 0, 0, 0, 7]);
    expect(unpack32_7bit([0, 0, 0, 0, 7])).toBe(7);
    for (const v of [0, 1, 0x7f, 0x80, 0xffffffff, 0x80000001, 0x12345678, 0xdeadbeef]) {
      expect(unpack32_7bit(pack32_7bit(v))).toBe(v >>> 0);
    }
  });

  it("21-Bit-Kodierung (BPM × 100 aus den SynthStudio-Vektoren)", () => {
    expect(encode21Bit(12050)).toEqual([0, 94, 18]);
    expect(encode21Bit(5000)).toEqual([0, 39, 8]);
    expect(encode21Bit(20000)).toEqual([1, 28, 32]); // > 0x3FFF: das alte 14-Bit-Format kippte hier
    expect(encode21Bit(30000)).toEqual([1, 106, 48]);
    for (const v of [0, 1, 0x3fff, 0x4000, 0x1fffff]) expect(decode21Bit(encode21Bit(v))).toBe(v);
    expect(encode21Bit(0x200000)).toEqual([0x7f, 0x7f, 0x7f]); // geklemmt
  });

  it("14-Bit-Kodierung mit Zweierkomplement, signed14 deutet ≥ 0x2000 negativ", () => {
    expect(encode14Bit(1234)).toEqual([0x09, 0x52]);
    expect(encode14Bit(-24)).toEqual([0x7f, 0x68]); // 0x3FE8
    expect(decode14Bit(0x7f, 0x68)).toBe(0x3fe8);
    expect(signed14(0x3fe8)).toBe(-24);
    expect(signed14(555)).toBe(555);
  });
});

describe("OTP: PARAM set/get", () => {
  it("setParam-Vektor aus SynthStudio: 15 Bytes, Part 3, 0x19/0x42, 1234", () => {
    const f = buildParamSetRoh(0x03, 0x19, 0x42, 1234);
    expect(f.length).toBe(15);
    expect(f[0]).toBe(0xf0);
    expect(f[14]).toBe(0xf7);
    expect(arr(f.slice(1, 4))).toEqual([0x7d, 0x01, 0x02]);
    expect(f[4]).toBe(OtpCmd.PARAM);
    expect(f[5]).toBe(0x00);
    expect(arr(f.slice(6, 8))).toEqual([0x00, 0x05]);
    expect(f[8]).toBe(0x03);
    expect(f[9]).toBe(0x19);
    expect(f[10]).toBe(0x42);
    expect(f[11]).toBe((1234 >> 7) & 0x7f);
    expect(f[12]).toBe(1234 & 0x7f);
    expect(f[13]).toBe(xorChecksum([3, 0x19, 0x42, 9, 0x52]));
  });

  it("GET-Rahmen ist 13 Bytes (8 Kopf + 3 Nutzlast + CHK + F7)", () => {
    const f = buildParamGetRoh(0, 0x00, 0x01);
    expect(f.length).toBe(13);
    expect(arr(f.slice(8, 11))).toEqual([0, 0, 1]);
  });

  it("Part 1–16 wird auf dem Draht 0-basiert gesendet; 0 und 17 werden abgewiesen", () => {
    const cutoff = otpParam("cutoff");
    expect(buildParamSet(1, cutoff, 20)[8]).toBe(0);
    expect(buildParamSet(16, cutoff, 20)[8]).toBe(15);
    expect(buildParamGet(16, cutoff)[8]).toBe(15);
    expect(() => buildParamSet(0, cutoff, 20)).toThrow(RangeError);
    expect(() => buildParamSet(17, cutoff, 20)).toThrow(RangeError);
    expect(() => buildParamSet(1.5, cutoff, 20)).toThrow(RangeError);
    expect(() => buildParamGet(0, cutoff)).toThrow(RangeError);
  });

  it("Param-IDs der Registry: 16 Einträge 0x0001..0x0010 in Stub-Reihenfolge", () => {
    expect(OTP_PARAMS.length).toBe(16);
    expect(OTP_PARAMS.map((p) => (p.hi << 8) | p.lo)).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(OTP_PARAMS.map((p) => p.key)).toEqual([
      "oscPitch",
      "cutoff",
      "resonance",
      "level",
      "pan",
      "voiceAssign",
      "egAttack",
      "egDecay",
      "oscEdit",
      "egInt",
      "modSpeed",
      "modDepth",
      "glide",
      "ifxEdit",
      "mfxSend",
      "ifxOnOff",
    ]);
    expect(otpParamVonId(0, 3)?.key).toBe("resonance");
    expect(otpParamVonId(0, 0x10)?.key).toBe("ifxOnOff");
    expect(otpParamVonId(0, 0x11)).toBeNull(); // hinter dem Sweep-Ende: der Stub kennt keine ID 0x0011
    expect(() => otpParam("chordSet" as never)).toThrow();
  });

  it("Wertebereiche: Osc-Pitch −64..63 signed, Cutoff/Resonance 0..127", () => {
    const osc = otpParam("oscPitch");
    const f = buildParamSet(6, osc, -24);
    expect(arr(f.slice(8, 13))).toEqual([5, 0x00, 0x01, 0x7f, 0x68]); // unteres Byte 0xE8 = −24 als int8
    expect(arr(buildParamSet(1, osc, -64).slice(11, 13))).toEqual([0x7f, 0x40]); // 0x3FC0 → Byte 0xC0
    expect(arr(buildParamSet(1, osc, 63).slice(11, 13))).toEqual([0x00, 0x3f]);
    expect(() => buildParamSet(1, osc, -65)).toThrow(RangeError);
    expect(() => buildParamSet(1, osc, 64)).toThrow(RangeError);
    expect(() => buildParamSet(1, osc, 1.5)).toThrow(RangeError);
    const res = otpParam("resonance");
    expect(arr(buildParamSet(1, res, 127).slice(11, 13))).toEqual([0x00, 0x7f]);
    expect(() => buildParamSet(1, res, 128)).toThrow(RangeError);
    expect(() => buildParamSet(1, res, -1)).toThrow(RangeError);
  });

  it("GET-Antwort des Stubs: (uint8)*slot — Osc-Pitch −24 kommt als 232 und wird int8 gedeutet", () => {
    // otp_send_param_response(part, hi, lo, v): 8 Kopf + 5 + CHK + F7
    const f = buildFrame(OtpCmd.PARAM, OtpSub.PARAM_RESPONSE, [5, 0x00, 0x01, 232 >> 7, 232 & 0x7f]);
    const p = parseFrame(f);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const a = parseParamAntwort(p.payload)!;
    expect(a.part).toBe(6);
    expect(a.param?.key).toBe("oscPitch");
    expect(a.roh14).toBe(232);
    expect(a.wert).toBe(-24);
    // Cutoff 20 = dumpfer (2026-08-06)
    const c = parseParamAntwort(bytes(0, 0x00, 0x02, 0, 20))!;
    expect(c.param?.key).toBe("cutoff");
    expect(c.wert).toBe(20);
    // unbekannte ID: roh durchreichen, nicht deuten
    const u = parseParamAntwort(bytes(0, 0x19, 0x42, 0x09, 0x52))!;
    expect(u.param).toBeNull();
    expect(u.roh14).toBe(1234);
    expect(parseParamAntwort(bytes(0, 0, 1))).toBeNull();
  });

  it("Notify-Vektoren aus SynthStudio (555 und 777) kommen als Wert durch", () => {
    const n1 = parseFrame(buildFrame(OtpCmd.PARAM, 0x03, [0x02, 0x19, 0x00, (555 >> 7) & 0x7f, 555 & 0x7f]));
    expect(n1.ok && n1.sub === OtpSub.PARAM_NOTIFY).toBe(true);
    if (n1.ok) expect(parseParamAntwort(n1.payload)?.roh14).toBe(555);
    const n2 = parseFrame(buildFrame(OtpCmd.PARAM, 0x03, [0x04, 0x16, 0x01, (777 >> 7) & 0x7f, 777 & 0x7f]));
    if (n2.ok) {
      const a = parseParamAntwort(n2.payload)!;
      expect(a.part).toBe(5);
      expect(signed14(a.roh14)).toBe(777);
    }
  });
});

describe("OTP: IDENTITY und FIRMWARE_INFO", () => {
  it("Stub-Identity: F0 7D 01 02 01 01 00 05 00 01 00 00 00 01 F7", () => {
    const raw = bytes(0xf0, 0x7d, 0x01, 0x02, 0x01, 0x01, 0x00, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0xf7);
    const p = parseFrame(raw);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.cmd).toBe(OtpCmd.IDENTITY);
    expect(p.sub).toBe(OtpSub.IDENTITY_RESPONSE);
    const id = parseIdentityResponse(p.payload)!;
    expect(id).toEqual({ major: 0, minor: 1, patch: 0, featureFlags: 0 });
    expect(identityText(id)).toContain("v0.1.0");
    expect(parseIdentityResponse(bytes(0, 1, 7))).toBeNull();
  });

  it("Identity-Feature-Flags sind 14 Bit (hi << 7 | lo), wie in otp_codec.py", () => {
    expect(parseIdentityResponse(bytes(1, 2, 3, 0x01, 0x05))?.featureFlags).toBe(0x85);
  });

  it("Stub-FW-Info: dieselbe 5-Byte-Nutzlast, Form 'stub'", () => {
    const raw = bytes(0xf0, 0x7d, 0x01, 0x02, 0x09, 0x01, 0x00, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0xf7);
    const p = parseFrame(raw);
    if (!p.ok) throw new Error("Rahmen ungültig");
    const fw = parseFirmwareInfoResponse(p.payload)!;
    expect(fw.form).toBe("stub");
    expect([fw.major, fw.minor, fw.patch]).toEqual([0, 1, 0]);
    expect(fw.gitHash).toBeUndefined();
    expect(firmwareInfoText(fw)).toContain("Minimalform");
  });

  it("Loader-FW-Info (Spec-Beispiel): v0.1.0, Hash 0x0807060504030201, Module [2,3], Flags 7", () => {
    const payload = bytes(
      0x00, 0x01, 0x00, // Version
      0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x00, 0x08, // git_hash encode_7bit
      0x02, 0x02, 0x03, // module_count + ids
      0x00, 0x00, 0x00, 0x00, 0x07, // flags pack32_7bit
    );
    expect(payload.length).toBe(21);
    const f = buildFrame(OtpCmd.FIRMWARE_INFO, 0x01, payload);
    expect(arr(f.slice(6, 8))).toEqual([0x00, 0x15]);
    const fw = parseFirmwareInfoResponse(payload)!;
    expect(fw.form).toBe("voll");
    expect(fw.gitHash).toBe(0x0807060504030201n);
    expect(fw.moduleIds).toEqual([2, 3]);
    expect(fw.featureFlags).toBe(7);
    expect(firmwareInfoText(fw)).toContain("Granular, Wavetable, Mod-Matrix");
    expect(parseFirmwareInfoResponse(bytes(0, 1))).toBeNull();
  });

  it("Loader-FW-Info ohne Module (19 Bytes) und mit gesetzten MSBs im Hash", () => {
    const hash = bytes(0x80, 0xff, 0x00, 0x7f, 0x42, 0x99, 0xab, 0x01);
    const payload = Uint8Array.from([1, 2, 3, ...encode7Bit(hash), 0, ...pack32_7bit(0x8001)]);
    expect(payload.length).toBe(19);
    const fw = parseFirmwareInfoResponse(payload)!;
    expect(fw.form).toBe("voll");
    let erwartet = 0n;
    for (let i = 0; i < 8; i++) erwartet |= BigInt(hash[i]) << BigInt(8 * i);
    expect(fw.gitHash).toBe(erwartet);
    expect(fw.moduleIds).toEqual([]);
    expect(fw.featureFlags).toBe(0x8001);
  });
});

describe("OTP: TELEMETRY (CMD 0x07)", () => {
  it("Report-Rahmen: 29 × u32 = 116 roh → 133 Draht → 143 Bytes (wie im Stub-Kommentar)", () => {
    const f = buildTelemetryReport(gesundeTelemetrie());
    expect(f.length).toBe(143);
    expect(f[4]).toBe(OtpCmd.TELEMETRY);
    expect(f[5]).toBe(OtpSub.TELEMETRY_REPORT);
    expect(decode14Bit(f[6], f[7])).toBe(133);
    expect(OTP_TELEMETRIE_FELDER.length).toBe(29);
  });

  it("Roundtrip: Felder, Magics und Verdikt LÄUFT", () => {
    const p = parseFrame(buildTelemetryReport(gesundeTelemetrie()));
    if (!p.ok) throw new Error("Rahmen ungültig");
    const t = parseTelemetryReport(p.payload)!;
    expect(t.usbGueltig).toBe(true);
    expect(t.structGueltig).toBe(true);
    expect(t.ctxGemessen).toBe(true);
    expect(t.felder.usb_hook_calls).toBe(1234);
    expect(t.felder.otp_last_cmd).toBe(0x09);
    expect(t.felder.ctx_sp).toBe(0xc030d000);
    expect(deuteTelemetrie(t)).toEqual({ verdikt: "LÄUFT", begruendung: "Alle fünf Stufen sind durchlaufen, keine Ablehnungen." });
    const text = telemetrieText(t);
    expect(text).toContain("Verdikt: LÄUFT");
    expect(text).toContain("Modus System");
    expect(text).toContain("zuletzt gesehenes CMD");
  });

  it("u32-Werte mit gesetztem MSB überleben die 7-of-8-Kodierung (magic 0xB5D1F507)", () => {
    const p = parseFrame(buildTelemetryReport({ usb_magic: 0xffffffff, magic: 0xb5d1f501 }));
    if (!p.ok) throw new Error("Rahmen ungültig");
    const t = parseTelemetryReport(p.payload)!;
    expect(t.felder.usb_magic).toBe(0xffffffff);
    expect(t.felder.magic).toBe(0xb5d1f501);
  });

  it("USB-Struct ungültig: erste Messung 2026-08-05 meldete magic 0xFFFFFFFF", () => {
    const p = parseFrame(buildTelemetryReport(gesundeTelemetrie({ usb_magic: 0xffffffff })));
    if (!p.ok) throw new Error();
    const v = deuteTelemetrie(parseTelemetryReport(p.payload)!);
    expect(v.verdikt).toBe("USB-STRUCT UNGÜLTIG");
    expect(v.begruendung).toContain("0xFFFFFFFF");
  });

  it("Guard hängt: usb_in_progress weder 0 noch 1", () => {
    const p = parseFrame(buildTelemetryReport(gesundeTelemetrie({ usb_in_progress: 0x5c0a })));
    if (!p.ok) throw new Error();
    expect(deuteTelemetrie(parseTelemetryReport(p.payload)!).verdikt).toBe("GUARD HÄNGT");
  });

  it("Selbstbeobachtung: otp_response_sent_count 0 ist bei der ersten Antwort kein Fehler", () => {
    const p = parseFrame(buildTelemetryReport(gesundeTelemetrie({ otp_response_sent_count: 0 })));
    if (!p.ok) throw new Error();
    expect(deuteTelemetrie(parseTelemetryReport(p.payload)!).verdikt).toBe("LÄUFT");
  });

  it("HÄNGT BEI der ersten Stufe, die auf null steht", () => {
    const p = parseFrame(buildTelemetryReport(gesundeTelemetrie({ usb_f0_starts: 0, usb_otp_frames: 0 })));
    if (!p.ok) throw new Error();
    const v = deuteTelemetrie(parseTelemetryReport(p.payload)!);
    expect(v.verdikt).toBe("HÄNGT BEI: usb_f0_starts");
    expect(v.begruendung).toContain("Port, Kabel");
  });

  it("Ablehnungen und Prüfsummenfehler werden benannt", () => {
    const p = parseFrame(buildTelemetryReport(gesundeTelemetrie({ error_count: 3, chk_fail_count: 2, otp_last_cmd: 0x02, otp_last_sub: 0x00 })));
    if (!p.ok) throw new Error();
    const v = deuteTelemetrie(parseTelemetryReport(p.payload)!);
    expect(v.verdikt).toBe("LÄUFT, MIT ABLEHNUNGEN");
    expect(v.begruendung).toContain("3 Frames");
    expect(v.begruendung).toContain("CMD 0x02 SUB 0x00");
    expect(v.begruendung).toContain("2 Rahmen mit falscher Prüfsumme");
  });

  it("älterer Report ohne Kontextblock (25 Felder) wird gelesen, unter 25 Feldern nicht", () => {
    const roh: number[] = [];
    for (let i = 0; i < 25; i++) {
      const v = i === 0 ? OTP_USBDX_MAGIC : i === 8 ? OTP_LAYER1_MAGIC : i + 1;
      roh.push(v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff);
    }
    const t = parseTelemetryReport(encode7Bit(roh))!;
    expect(t.structGueltig).toBe(true);
    expect(t.ctxGemessen).toBe(false);
    expect(t.felder.ctx_magic).toBeUndefined();
    expect(t.felder.chk_fail_count).toBe(25);
    expect(telemetrieText(t)).not.toContain("Hook-Kontext");
    expect(parseTelemetryReport(encode7Bit(roh.slice(0, 24 * 4)))).toBeNull();
  });
});

/**
 * Die 13 Registry-Parameter jenseits der ersten drei: je ein fester SET-Vektor
 * (15 Bytes, wie `otp_send_param_response` sie spiegelt), GET-Rahmen und die
 * int8-Deutung der Antwort bei signed. Bereiche, signed/enum und der
 * Beleg-Status stammen aus `g_otp_param_registry` und den C-Kommentaren.
 */
describe("OTP: Registry-Parameter 0x0004..0x0010 (SET-Vektoren, GET-Deutung, Beleg)", () => {
  it("Bereiche, Vorzeichen, Aufzählung und Weg wie im Stub", () => {
    const erwartet: [string, number, number, boolean, boolean, string][] = [
      ["level", 0, 127, false, false, "cc 7"],
      ["pan", -63, 63, true, false, "cc 10 (Stub: CC = Wert + 64)"],
      ["voiceAssign", 0, 3, false, true, "schreib"],
      ["egAttack", 0, 127, false, false, "cc 73"],
      ["egDecay", 0, 127, false, false, "cc 72"],
      ["oscEdit", 0, 127, false, false, "cc 82"],
      ["egInt", -63, 63, true, false, "cc 83 (Stub: CC = Wert + 64)"],
      ["modSpeed", 0, 127, false, false, "cc 86"],
      ["modDepth", 0, 127, false, false, "cc 85"],
      ["glide", 0, 127, false, false, "cc 81"],
      ["ifxEdit", 0, 127, false, false, "cc 87"],
      ["mfxSend", 0, 1, false, true, "cc 105 (Stub: CC = Wert × 127)"],
      ["ifxOnOff", 0, 1, false, true, "cc 104 (Stub: CC = Wert × 127)"],
    ];
    for (const [key, min, max, signed, en, weg] of erwartet) {
      const p = otpParam(key as never);
      expect([p.key, p.min, p.max, p.signed, p.enum, p.weg]).toEqual([key, min, max, signed, en, weg]);
    }
    // Nur Osc-Pitch, Cutoff, Resonance liegen im Live-Fenster; der Rest im Pattern-Block
    expect(OTP_PARAMS.filter((p) => p.fenster === "live").map((p) => p.key)).toEqual(["oscPitch", "cutoff", "resonance"]);
  });

  it("Beleg-Status: 5 × gerätebewiesen, 11 × statisch (Osc-Pitch am Gerät 2026-09-17 als nicht live-wirksam belegt), nichts unbestimmt", () => {
    const bewiesen = OTP_PARAMS.filter((p) => p.beleg === "gerätebewiesen").map((p) => p.key);
    expect(bewiesen).toEqual(["cutoff", "resonance", "level", "pan", "mfxSend"]);
    const statisch = OTP_PARAMS.filter((p) => p.beleg === "statisch").map((p) => p.key);
    expect(statisch).toEqual(["oscPitch", "voiceAssign", "egAttack", "egDecay", "oscEdit", "egInt", "modSpeed", "modDepth", "glide", "ifxEdit", "ifxOnOff"]);
    expect(OTP_PARAMS.some((p) => p.beleg === "unbestimmt")).toBe(false);
    // Jede Quelle nennt Sprint oder Datum
    for (const p of OTP_PARAMS) expect(p.quelle).toMatch(/Sprint \d+|2026-0\d-\d\d/);
    expect(otpParam("voiceAssign").quelle).toContain("NICHT gemessen");
    expect(otpParam("egAttack").quelle).toContain("NICHT gemessen");
    expect(otpParam("mfxSend").quelle).toContain("2026-08-22");
    expect(belegText("gerätebewiesen")).toContain("✔");
    expect(belegText("statisch")).toContain("◐");
    expect(belegText("unbestimmt")).toContain("?");
  });

  it("SET-Vektoren, byte-genau (Part 0-basiert, Wert 14 Bit, XOR über die Nutzlast)", () => {
    const faelle: [string, number, number, number[]][] = [
      ["level", 1, 100, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x00, 0x00, 0x04, 0x00, 0x64, 0x60, 0xf7]],
      ["pan", 2, -60, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x01, 0x00, 0x05, 0x7f, 0x44, 0x3f, 0xf7]], // 0x3FC4, Byte 0xC4 = −60
      ["pan", 1, 63, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x00, 0x00, 0x05, 0x00, 0x3f, 0x3a, 0xf7]],
      ["voiceAssign", 11, 3, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x0a, 0x00, 0x06, 0x00, 0x03, 0x0f, 0xf7]], // Poly 2
      ["egAttack", 6, 100, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x05, 0x00, 0x07, 0x00, 0x64, 0x66, 0xf7]],
      ["egDecay", 6, 20, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x05, 0x00, 0x08, 0x00, 0x14, 0x19, 0xf7]],
      ["oscEdit", 6, 127, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x05, 0x00, 0x09, 0x00, 0x7f, 0x73, 0xf7]],
      ["egInt", 6, -63, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x05, 0x00, 0x0a, 0x7f, 0x41, 0x31, 0xf7]], // Byte 0xC1 = −63
      ["egInt", 6, 63, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x05, 0x00, 0x0a, 0x00, 0x3f, 0x30, 0xf7]],
      ["modSpeed", 1, 64, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x00, 0x00, 0x0b, 0x00, 0x40, 0x4b, 0xf7]],
      ["modDepth", 1, 1, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x00, 0x00, 0x0c, 0x00, 0x01, 0x0d, 0xf7]],
      ["glide", 1, 127, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x00, 0x00, 0x0d, 0x00, 0x7f, 0x72, 0xf7]],
      ["ifxEdit", 1, 50, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x00, 0x00, 0x0e, 0x00, 0x32, 0x3c, 0xf7]],
      ["mfxSend", 6, 1, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x05, 0x00, 0x0f, 0x00, 0x01, 0x0b, 0xf7]],
      ["ifxOnOff", 16, 1, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x0f, 0x00, 0x10, 0x00, 0x01, 0x1e, 0xf7]],
      ["ifxOnOff", 16, 0, [0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 0x0f, 0x00, 0x10, 0x00, 0x00, 0x1f, 0xf7]],
    ];
    for (const [key, part, wert, bytesErwartet] of faelle) {
      expect(arr(buildParamSet(part, otpParam(key as never), wert)), `${key} Part ${part} = ${wert}`).toEqual(bytesErwartet);
    }
  });

  it("Grenzen: stetige Werte ausserhalb werfen; Aufzählungen (Stub: is_enum → stille Absage) werfen hier laut", () => {
    expect(() => buildParamSet(1, otpParam("pan"), -64)).toThrow(RangeError); // Anschlag −63 gemessen, nicht −64
    expect(() => buildParamSet(1, otpParam("pan"), 64)).toThrow(RangeError);
    expect(() => buildParamSet(1, otpParam("egInt"), -64)).toThrow(RangeError);
    expect(() => buildParamSet(1, otpParam("level"), 128)).toThrow(RangeError);
    expect(() => buildParamSet(1, otpParam("voiceAssign"), 4)).toThrow(/Voice Assign: 4/); // Chord Set 1: der Stub weist ab
    expect(() => buildParamSet(1, otpParam("mfxSend"), 2)).toThrow(RangeError);
    expect(() => buildParamSet(1, otpParam("ifxOnOff"), 2)).toThrow(RangeError);
    expect(() => buildParamSet(1, otpParam("glide"), 0.5)).toThrow(RangeError);
  });

  it("GET-Rahmen 13 Bytes je Parameter; Antwort int8-gedeutet bei Pan/EG Int, uint8 sonst", () => {
    expect(arr(buildParamGet(3, otpParam("level")))).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x02, 0x01, 0x00, 0x03, 0x02, 0x00, 0x04, 0x06, 0xf7]);
    expect(arr(buildParamGet(3, otpParam("pan")))).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x02, 0x01, 0x00, 0x03, 0x02, 0x00, 0x05, 0x07, 0xf7]);
    expect(arr(buildParamGet(3, otpParam("egInt")))).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x02, 0x01, 0x00, 0x03, 0x02, 0x00, 0x0a, 0x08, 0xf7]);
    for (const p of OTP_PARAMS) expect(buildParamGet(16, p).length).toBe(13);

    // Der Stub sendet (uint8)*slot: Pan −60 → Byte 0xC4 = 196 → 0x01 0x44 auf dem Draht
    const pan = parseParamAntwort(bytes(2, 0x00, 0x05, 0x01, 0x44))!;
    expect(pan.param?.key).toBe("pan");
    expect(pan.roh14).toBe(196);
    expect(pan.wert).toBe(-60);
    // EG Int −63 → 0xC1 = 193; +63 → 63
    expect(parseParamAntwort(bytes(5, 0x00, 0x0a, 0x01, 0x41))!.wert).toBe(-63);
    expect(parseParamAntwort(bytes(5, 0x00, 0x0a, 0x00, 0x3f))!.wert).toBe(63);
    // unsigned: Level 100, Voice Assign 3 = Poly 2, MFX Send 1 = On
    expect(parseParamAntwort(bytes(0, 0x00, 0x04, 0x00, 0x64))!.wert).toBe(100);
    const va = parseParamAntwort(bytes(10, 0x00, 0x06, 0x00, 0x03))!;
    expect(va.part).toBe(11);
    expect(va.wert).toBe(3);
    expect(paramWertText(va.param!, va.wert)).toBe("3 = Poly 2");
    expect(paramWertText(otpParam("mfxSend"), 1)).toBe("1 = On");
    expect(paramWertText(otpParam("oscPitch"), -24)).toBe("-24 Halbtöne");
    expect(paramWertText(otpParam("glide"), 5)).toBe("5");
    // alle 16 IDs werden in der Antwort erkannt
    for (const p of OTP_PARAMS) expect(parseParamAntwort(bytes(0, p.hi, p.lo, 0, 0))!.param?.key).toBe(p.key);
  });
});

/**
 * TRANSPORT (CMD 0x0E, Sprint 166): Play/Stop ohne Nutzlast, Position als
 * 21 Bit MSB-zuerst; der Stub sagt Beats > 0x3FFF ab (error_count), der
 * Client davor. Vektoren aus dem Stub-Code und der Omnitribe-HW-Sitzung 2026-08-13.
 */
describe("OTP: TRANSPORT (CMD 0x0E)", () => {
  it("Play und Stop: 10-Byte-Rahmen ohne Nutzlast", () => {
    expect(arr(buildTransportPlay())).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x0e, 0x00, 0x00, 0x00, 0x00, 0xf7]);
    expect(arr(buildTransportStop())).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x0e, 0x01, 0x00, 0x00, 0x00, 0xf7]);
    expect(OtpCmd.TRANSPORT).toBe(0x0e);
    expect([OtpSub.TRANSPORT_PLAY, OtpSub.TRANSPORT_STOP, OtpSub.TRANSPORT_POSITION]).toEqual([0x00, 0x01, 0x0a]);
  });

  it("Position: Beat 25 → 0E 0A 00 03 00 00 19 19 (der echte Rahmen der Sitzung 2026-08-13)", () => {
    expect(arr(buildTransportPosition(25))).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x0e, 0x0a, 0x00, 0x03, 0x00, 0x00, 0x19, 0x19, 0xf7]);
    expect(arr(buildTransportPosition(0))).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x0e, 0x0a, 0x00, 0x03, 0x00, 0x00, 0x00, 0x00, 0xf7]);
  });

  it("Grenzwert 0x3FFF wird angenommen (00 7F 7F, CHK 0), 0x4000 abgewiesen — der Stub täte es nur stumm", () => {
    expect(OTP_TRANSPORT_BEATS_MAX).toBe(0x3fff);
    expect(arr(buildTransportPosition(0x3fff))).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x0e, 0x0a, 0x00, 0x03, 0x00, 0x7f, 0x7f, 0x00, 0xf7]);
    expect(() => buildTransportPosition(0x4000)).toThrow(/0\.\.16383/);
    expect(() => buildTransportPosition(0x4000)).toThrow(/error_count/);
    expect(() => buildTransportPosition(-1)).toThrow(RangeError);
    expect(() => buildTransportPosition(2.5)).toThrow(RangeError);
    // Die Rohform baut den Rahmen, den die Sitzung an der CLI vorbei geschickt hat: 01 00 00, CHK 01
    expect(arr(buildTransportPositionRoh(0x4000))).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x0e, 0x0a, 0x00, 0x03, 0x01, 0x00, 0x00, 0x01, 0xf7]);
    expect(arr(buildTransportPositionRoh(0x1fffff).slice(8, 11))).toEqual([0x7f, 0x7f, 0x7f]);
  });

  it("Takt·Step → Beats: 16 Steps je Takt, Takt 2 · Step 10 = 25", () => {
    expect(positionAusTaktStep(1, 1)).toBe(0);
    expect(positionAusTaktStep(2, 10)).toBe(25);
    expect(positionAusTaktStep(1024, 16)).toBe(16383);
    expect(positionAusTaktStep(1025, 1)).toBe(16384); // → buildTransportPosition wirft
    expect(() => positionAusTaktStep(0, 1)).toThrow(RangeError);
    expect(() => positionAusTaktStep(1, 17)).toThrow(RangeError);
    expect(() => positionAusTaktStep(1, 0)).toThrow(RangeError);
  });
});

describe("OTP: Modul-Lader Stufe 1 (CMD 0x05)", () => {
  it("baut einen 44-Byte-Header mit OTMR-Magic little-endian", () => {
    const h = buildModuleHeader({ moduleId: 3, name: "granular", apiPtr: 0x12345678 });
    expect(h.length).toBe(OTP_MODULE_HEADER_LEN);
    // Magic 0x4F544D52 als LE-Bytes 0x52 0x4D 0x54 0x4F ("RMTO" im Speicher).
    expect(Array.from(h.slice(0, 4))).toEqual([0x52, 0x4d, 0x54, 0x4f]);
    const magic = h[0] | (h[1] << 8) | (h[2] << 16) | (h[3] << 24);
    expect(magic >>> 0).toBe(OTP_MODULE_MAGIC);
    expect(h[4] | (h[5] << 8)).toBe(OTP_MODULE_API_VERSION);
    expect(h[6] | (h[7] << 8)).toBe(3); // module_id
    expect(String.fromCharCode(...h.slice(8, 16))).toBe("granular");
    // api-Zeiger @40 little-endian.
    expect(h[40] | (h[41] << 8) | (h[42] << 16) | (h[43] << 24)).toBe(0x12345678);
  });

  it("0x05-Block: Nutzlast [id][enc_len_hi][enc_len_lo][7-of-8], Stub-dekodierbar", () => {
    const header = buildModuleHeader({ moduleId: 0, name: "probe", apiPtr: 1 });
    const frame = buildModuleBlock(0, header);
    const p = parseFrame(frame);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.cmd).toBe(OtpCmd.MODULE);
    expect(p.sub).toBe(OtpSub.MODULE_BLOCK);
    expect(p.payload[0]).toBe(0); // module_id
    const encLen = (p.payload[1] << 7) | p.payload[2];
    const enc = p.payload.slice(3);
    expect(enc.length).toBe(encLen);
    // Die 7-of-8-Daten müssen exakt den 44-Byte-Header zurückgeben (Stub-Weg).
    expect(Array.from(decode7Bit(enc).slice(0, OTP_MODULE_HEADER_LEN))).toEqual(Array.from(header));
    // Jedes Nutzlast-Byte ist 7-Bit-sauber (SysEx-Datenbyte).
    for (const b of p.payload) expect(b).toBeLessThan(0x80);
  });

  it("parseModuleAck deutet Payload [status, id, block] und den Status-Text", () => {
    const okFrame = buildFrame(OtpCmd.MODULE, OtpSub.MODULE_ACK, [0x00, 0x03, 0x07]);
    const p = parseFrame(okFrame);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    const ack = parseModuleAck(p.payload);
    expect(ack).not.toBeNull();
    expect(ack!.ok).toBe(true);
    expect(ack!.status).toBe(0x00);
    expect(ack!.moduleId).toBe(3);
    expect(ack!.blockCount).toBe(7);
    expect(ack!.text).toBe(OTP_MODULE_STATUS[0x00]);

    const badFrame = buildFrame(OtpCmd.MODULE, OtpSub.MODULE_ACK, [0x04, 0x00, 0x01]);
    const q = parseFrame(badFrame);
    if (!q.ok) throw new Error("Rahmen");
    const bad = parseModuleAck(q.payload)!;
    expect(bad.ok).toBe(false);
    expect(bad.status).toBe(0x04);
    expect(bad.text).toContain("Magic");

    expect(parseModuleAck(Uint8Array.from([0x00, 0x00]))).toBeNull(); // < 3 Byte
  });

  it("Negativ-Header treffen genau den Validierungszweig des Stubs (Header-Bytes stimmen)", () => {
    // Falsche Magic → 0x04: Magic-Bytes weichen ab, Rest (api_version, id, api) gültig.
    const magicH = buildModuleHeader({ moduleId: 0, magic: 0xdeadbeef, apiPtr: 1 });
    expect((magicH[0] | (magicH[1] << 8) | (magicH[2] << 16) | (magicH[3] << 24)) >>> 0).toBe(0xdeadbeef);
    // Kein api-Zeiger → 0x07: api@40 == 0, Magic gültig.
    const noapiH = buildModuleHeader({ moduleId: 0, apiPtr: 0 });
    expect(noapiH[40] | noapiH[41] | noapiH[42] | noapiH[43]).toBe(0);
    expect((noapiH[0] | (noapiH[1] << 8) | (noapiH[2] << 16) | (noapiH[3] << 24)) >>> 0).toBe(OTP_MODULE_MAGIC);
    // Falsche Header-id → 0x06: headerId@6 ≠ block-id.
    const idH = buildModuleHeader({ moduleId: 0, headerId: 5, apiPtr: 1 });
    expect(idH[6] | (idH[7] << 8)).toBe(5);
  });

  it("OTP_MODULE_PROBES: fünf Sonden (inkl. Grenze id 32), jede mit erwartetem Status und sauberem Block", () => {
    expect(OTP_MODULE_PROBES.map((s) => s.erwarteterStatus)).toEqual([0x00, 0x04, 0x07, 0x06, 0x02]);
    for (const sonde of OTP_MODULE_PROBES) {
      const frame = sonde.bytes();
      const p = parseFrame(frame);
      expect(p.ok, sonde.key).toBe(true);
      if (!p.ok) continue;
      expect(p.cmd).toBe(OtpCmd.MODULE);
      expect(p.sub).toBe(OtpSub.MODULE_BLOCK);
      for (const b of frame) expect(b).toBeLessThan(0x100);
    }
  });

  it("Stufe 2: buildModuleChunk trägt 21-Bit-Offset und 7-of-8-Daten, dekodierbar", () => {
    const roh = Uint8Array.from({ length: 50 }, (_, i) => (i * 7) & 0xff);
    const f = buildModuleChunk(3, 0x12345, roh);
    const p = parseFrame(f);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    expect(p.cmd).toBe(OtpCmd.MODULE);
    expect(p.sub).toBe(OtpSub.MODULE_CHUNK);
    expect(p.payload[0]).toBe(3);
    const off = (p.payload[1] << 14) | (p.payload[2] << 7) | p.payload[3];
    expect(off).toBe(0x12345);
    expect(Array.from(decode7Bit(p.payload.slice(4)))).toEqual(Array.from(roh));
    for (const b of p.payload) expect(b).toBeLessThan(0x80); // Nutzlast 7-Bit-sauber
    expect(() => buildModuleChunk(0, 0x200000, roh)).toThrow(RangeError); // > 21 Bit
  });

  it("Stufe 2: buildModuleUpload = N lückenlose Chunks + Commit, reassembliert zum Original", () => {
    const modul = Uint8Array.from({ length: 500 }, (_, i) => (i * 13 + 7) & 0xff);
    const frames = buildModuleUpload(2, modul);
    expect(frames.length).toBe(Math.ceil(500 / OTP_MODULE_CHUNK_RAW) + 1); // Chunks + Commit
    // letzter Frame = Commit
    const commit = parseFrame(frames[frames.length - 1]);
    expect(commit.ok && commit.sub).toBe(OtpSub.MODULE_COMMIT);
    if (commit.ok) expect(commit.payload[0]).toBe(2);
    // Chunks lückenlos zusammensetzen und mit dem Original vergleichen
    const slot: number[] = [];
    let erwartet = 0;
    for (let i = 0; i < frames.length - 1; i++) {
      const p = parseFrame(frames[i]);
      if (!p.ok) throw new Error("Chunk");
      const off = (p.payload[1] << 14) | (p.payload[2] << 7) | p.payload[3];
      expect(off).toBe(erwartet); // lückenlos
      const dec = decode7Bit(p.payload.slice(4));
      for (let k = 0; k < dec.length; k++) slot[off + k] = dec[k];
      erwartet = off + dec.length;
    }
    expect(erwartet).toBe(500);
    expect(slot).toEqual(Array.from(modul));
  });

  it("buildModuleHeaderBlock == buildModuleBlock(id, buildModuleHeader(...))", () => {
    const felder = { moduleId: 2, name: "wavetable", apiPtr: 1 } as const;
    expect(Array.from(buildModuleHeaderBlock(felder))).toEqual(
      Array.from(buildModuleBlock(2, buildModuleHeader(felder))),
    );
  });
});

describe("OTP: Echte Modul-Header-Sonden (OTP_MODULE_REAL_PROBES)", () => {
  it("jeder echte Header ist 44 B, OTMR-Magic, id passt, api ≠ 0", () => {
    expect(OTP_MODULE_REAL_HEADERS.length).toBe(20);
    for (const m of OTP_MODULE_REAL_HEADERS) {
      const h = m.header;
      expect(h.length).toBe(44);
      expect(Array.from(h.slice(0, 4))).toEqual([0x52, 0x4d, 0x54, 0x4f]); // "OTMR" LE
      expect(h[4] | (h[5] << 8)).toBe(1); // api_version
      expect(h[6] | (h[7] << 8)).toBe(m.id); // header-id == Katalog-id
      expect(h[40] | (h[41] << 8) | (h[42] << 16) | (h[43] << 24)).not.toBe(0); // api ≠ 0
    }
  });

  it("alle 20 echten Module liegen unter der Grenze 32 → 0x00; die Grenze zeigt die synthetische Sonde id 32", () => {
    expect(OTP_MODULE_MAX_ID).toBe(32);
    for (const s of OTP_MODULE_REAL_PROBES) {
      const m = OTP_MODULE_REAL_HEADERS.find((x) => `real-${x.name}` === s.key)!;
      expect(m.id).toBeLessThan(OTP_MODULE_MAX_ID);
      expect(s.erwarteterStatus).toBe(0x00);
    }
    expect(OTP_MODULE_REAL_HEADERS.map((m) => m.id)).toContain(30); // audio_test, hoechste id
    const grenze = OTP_MODULE_PROBES.find((s) => s.key === "idgrenze")!;
    expect(grenze.erwarteterStatus).toBe(0x02);
    const p = parseFrame(grenze.bytes());
    expect(p.ok && p.payload[0]).toBe(32);
  });

  it("jede echte Sonde baut einen gültigen 0x05-Block, dekodiert zum Header zurück", () => {
    for (const s of OTP_MODULE_REAL_PROBES) {
      const m = OTP_MODULE_REAL_HEADERS.find((x) => `real-${x.name}` === s.key)!;
      const frame = s.bytes();
      const p = parseFrame(frame);
      expect(p.ok, s.key).toBe(true);
      if (!p.ok) continue;
      expect(p.cmd).toBe(OtpCmd.MODULE);
      expect(p.sub).toBe(OtpSub.MODULE_BLOCK);
      expect(p.payload[0]).toBe(m.id & 0x7f); // module_id auf dem Draht
      const encLen = (p.payload[1] << 7) | p.payload[2];
      const enc = p.payload.slice(3);
      expect(enc.length).toBe(encLen);
      expect(Array.from(decode7Bit(enc).slice(0, 44))).toEqual(Array.from(m.header));
      for (const b of frame) expect(b).toBeLessThan(0x100);
    }
  });
});

/**
 * Sprint 185/186 — Callback-Aufruf, Egress-Drain, Periodik-Hook (nur EXEC-Build).
 * Draht-Formate wörtlich aus dem Stub (`handle_module_callback`, `handle_irq_hook`,
 * `otp_ev_send_report`). Der Report kodiert jeden u32 als 7-of-8-Gruppe zu genau
 * vier Bytes — identisch mit encode7Bit über ein 4-Byte-LE-Wort.
 */
describe("OTP Sprint 186: Callback, Drain, Periodik-Hook", () => {
  const le32 = (v: number) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
  const payloadOf = (f: Uint8Array) => Array.from(f.slice(8, f.length - 2));

  it("buildModuleCallback: [id, cb, 7-of-8(args)] — on_clock_tick(6) beim Arpeggiator", () => {
    const f = buildModuleCallback(1, OTP_MODULE_CB.ON_CLOCK_TICK, le32(6));
    expect([f[4], f[5]]).toEqual([0x05, 0x05]);
    expect(payloadOf(f)).toEqual([1, 2, 0, 6, 0, 0, 0]);
    expect(f[f.length - 1]).toBe(0xf7);
  });

  it("buildModuleDrain: SUB 0x06 ohne Nutzlast", () => {
    const f = buildModuleDrain();
    expect([f[4], f[5]]).toEqual([0x05, 0x06]);
    expect(payloadOf(f)).toEqual([]);
  });

  it("Status-Texte 0x0C..0x10 sind benannt (Pre-Call, nicht-ABS, nicht platziert, cb-Index, Callback 0)", () => {
    expect(OTP_MODULE_STATUS[0x0c]).toContain("Pre-Call");
    expect(OTP_MODULE_STATUS[0x0d]).toContain("absolut");
    expect(OTP_MODULE_STATUS[0x0e]).toContain("platziert");
    expect(OTP_MODULE_STATUS[0x0f]).toContain("Index");
    expect(OTP_MODULE_STATUS[0x10]).toContain("0");
  });

  it("buildIrqInstall: [irq, divAudio hi/lo, divClock hi/lo, src] — Timer0 (21), 41, 147, Timer-Clock", () => {
    const f = buildIrqInstall(21, 41, 147, 1);
    expect([f[4], f[5]]).toEqual([0x04, 0x02]);
    expect(payloadOf(f)).toEqual([21, 0, 41, 1, 19, 1]); // 147 = 0x93 → hi 1, lo 0x13
  });

  it("buildIrqInstall ohne Teiler = nur zählen (Rate messen); Teiler werden auf 14 Bit geklemmt", () => {
    expect(payloadOf(buildIrqInstall(21))).toEqual([21, 0, 0, 0, 0, 0]);
    expect(payloadOf(buildIrqConfig(99999, 5, 0))).toEqual([0x7f, 0x7f, 0, 5, 0]);
  });

  it("buildIrqPeek/Restore/Status: SUBs 0x01/0x03/0x04", () => {
    expect([buildIrqPeek(68)[5], ...payloadOf(buildIrqPeek(68))]).toEqual([0x01, 68]);
    expect(buildIrqRestore()[5]).toBe(0x03);
    expect(buildIrqStatus()[5]).toBe(0x04);
    expect(buildIrqStatus()[4]).toBe(0x04);
  });

  it("parseIrqReport: Peek-Antwort [21, 0xC0025798] — Bit 7 der Bytes wandert ins hi-Byte", () => {
    // 0xC0025798 → b0 0x98 (bit7) b1 0x57 b2 0x02 b3 0xC0 (bit7) → hi = 0b1001
    const p = Uint8Array.from([0x01, ...encode7Bit(le32(21)), ...encode7Bit(le32(0xc0025798))]);
    expect(Array.from(p.slice(6))).toEqual([9, 0x18, 0x57, 0x02, 0x40]);
    const r = parseIrqReport(p);
    expect(r).not.toBeNull();
    expect(r!.sub).toBe(0x01);
    expect(r!.values).toEqual([21, 0xc0025798]);
    expect(r!.status).toBeUndefined();
    expect(r!.error).toBeUndefined();
  });

  it("parseIrqReport: Status-Antwort liefert dreizehn benannte Zähler (inkl. ticksSkipped)", () => {
    const vals = [1, 21, 0xc0025798, 70820, 412, 96, 3, 2, 17, 0, 0, 0, 5];
    const p = Uint8Array.from([0x04, ...vals.flatMap((v) => Array.from(encode7Bit(le32(v))))]);
    const r = parseIrqReport(p)!;
    expect(r.values).toEqual(vals);
    expect(Object.keys(r.status!)).toEqual([...OTP_IRQ_STATUS_FIELDS]);
    expect(r.status!.orig).toBe(0xc0025798);
    expect(r.status!.ticks).toBe(70820);
    expect(r.status!.egressFrames).toBe(17);
    expect(r.status!.ticksSkipped).toBe(5);
  });

  it("buildModuleUnplace: SUB 0x07 mit id oder 0x7F = alle", () => {
    expect([buildModuleUnplace(9)[5], ...payloadOf(buildModuleUnplace(9))]).toEqual([0x07, 9]);
    expect(payloadOf(buildModuleUnplace())).toEqual([0x7f]);
    expect(payloadOf(buildModuleUnplace("alle"))).toEqual([0x7f]);
  });

  it("parseIrqReport: Einzelwert 0x13 = Fehler „schon installiert“; krumme Länge → null", () => {
    const p = Uint8Array.from([0x02, ...encode7Bit(le32(0x13))]);
    expect(parseIrqReport(p)!.error).toBe(0x13);
    expect(parseIrqReport(Uint8Array.from([0x02, 1, 2]))).toBeNull();
  });
});

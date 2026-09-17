import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initOtpPanel, otpZustand, reglerId, OTP_KEIN_GERAET } from "../src/gui/otpPanel";
import {
  OtpCmd,
  OtpSub,
  OTP_PARAMS,
  otpParam,
  buildFrame,
  buildTelemetryReport,
  parseFrame,
  decode7Bit,
  OTP_LAYER1_MAGIC,
  OTP_USBDX_MAGIC,
  OTP_MODULE_MAX_ID,
  OTP_MODULE_PROBES,
  OTP_MODULE_REAL_PROBES,
} from "../src/core/otp";

/**
 * Das OTP-Panel über den DOM-Stub: ohne Antwort die klare „Kein OTP“-Meldung
 * und keine Regler; mit Antwort der benannte Bericht, dann PARAM SET vom Regler
 * (alle 16 Registry-Parameter) mit Part 1–16 auf dem Draht 0-basiert, PARAM GET
 * je Parameter und für alle, sichtbarer Beleg-Status, TRANSPORT Play/Stop/Position.
 * Nichts wird beim Init gesendet.
 */

type Listener = () => void;

class StubElement {
  value = "";
  min = "";
  max = "";
  step = "";
  textContent = "";
  innerHTML = "";
  readonly classList = {
    klassen: new Set<string>(),
    add: (k: string) => void this.classList.klassen.add(k),
    remove: (k: string) => void this.classList.klassen.delete(k),
    toggle: (k: string, an?: boolean) => {
      const soll = an ?? !this.classList.klassen.has(k);
      if (soll) this.classList.klassen.add(k);
      else this.classList.klassen.delete(k);
      return soll;
    },
    contains: (k: string) => this.classList.klassen.has(k),
  };
  private listeners = new Map<string, Listener[]>();
  addEventListener(typ: string, fn: Listener): void {
    const l = this.listeners.get(typ) ?? [];
    l.push(fn);
    this.listeners.set(typ, l);
  }
  feuere(typ: string): void {
    for (const fn of this.listeners.get(typ) ?? []) fn();
  }
}

const elemente = new Map<string, StubElement>();
const el = (id: string): StubElement => {
  let e = elemente.get(id);
  if (!e) {
    e = new StubElement();
    elemente.set(id, e);
  }
  return e;
};
const g = globalThis as unknown as { document?: unknown };

/** Klick feuern und die Promise-Kette dahinter abwarten (bis zu 16 Anfragen nacheinander). */
async function klickUndWarte(id: string, runden = 40): Promise<void> {
  el(id).feuere("click");
  for (let i = 0; i < runden; i++) await new Promise((r) => setTimeout(r, 0));
}

async function tick(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
}

let gesendet: Uint8Array[] = [];
let angefragt: Uint8Array[] = [];
/** Was das „Gerät“ auf eine Anfrage antwortet — null = Timeout. */
let antwortStub: (frame: Uint8Array) => Uint8Array | null = () => null;

const stubIdentity = Uint8Array.from([0xf0, 0x7d, 0x01, 0x02, 0x01, 0x01, 0x00, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0xf7]);
const stubFwInfo = Uint8Array.from([0xf0, 0x7d, 0x01, 0x02, 0x09, 0x01, 0x00, 0x05, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0xf7]);
const stubTelemetrie = buildTelemetryReport({
  usb_magic: OTP_USBDX_MAGIC,
  usb_in_progress: 1,
  usb_hook_calls: 50,
  usb_f0_starts: 3,
  usb_f7_complete: 3,
  usb_otp_frames: 3,
  magic: OTP_LAYER1_MAGIC,
  otp_dispatch_count: 3,
  otp_response_sent_count: 0,
  otp_last_cmd: 0x09,
});

/**
 * Was der Stub je ID als (uint8)*slot liefert: Osc-Pitch −24 = 232, Cutoff 20,
 * Resonance 100, Level 100, Pan −60 = 196, Voice Assign 3, EG Attack 10,
 * EG Decay 20, Osc Edit 30, EG Int −63 = 193, Mod Speed 40, Mod Depth 50,
 * Glide 60, IFX Edit 70, MFX Send 1, IFX On/Off 0.
 */
const geraeteWerte: Record<number, number> = {
  1: 232,
  2: 20,
  3: 100,
  4: 100,
  5: 196,
  6: 3,
  7: 10,
  8: 20,
  9: 30,
  10: 193,
  11: 40,
  12: 50,
  13: 60,
  14: 70,
  15: 1,
  16: 0,
};

/** Antwortet wie der Coexist-Stub auf alle drei Anfragen und auf GET jeder Registry-ID. */
function stubGeraet(frame: Uint8Array): Uint8Array | null {
  const f = parseFrame(frame);
  if (!f.ok) return null;
  if (f.cmd === OtpCmd.IDENTITY && f.sub === OtpSub.IDENTITY_REQUEST) return stubIdentity;
  if (f.cmd === OtpCmd.FIRMWARE_INFO && f.sub === OtpSub.FW_INFO_REQUEST) return stubFwInfo;
  if (f.cmd === OtpCmd.TELEMETRY && f.sub === OtpSub.TELEMETRY_REQUEST) return stubTelemetrie;
  if (f.cmd === OtpCmd.PARAM && f.sub === OtpSub.PARAM_GET) {
    const wert = geraeteWerte[(f.payload[1] << 8) | f.payload[2]];
    if (wert === undefined) return null;
    return buildFrame(OtpCmd.PARAM, OtpSub.PARAM_RESPONSE, [f.payload[0], f.payload[1], f.payload[2], (wert >> 7) & 0x7f, wert & 0x7f]);
  }
  // Modul-Block: spiegelt handle_module_block_stage1 — Header prüfen, ACK zurück.
  if (f.cmd === OtpCmd.MODULE && f.sub === OtpSub.MODULE_BLOCK) {
    const modId = f.payload[0];
    const enc = f.payload.slice(3);
    const hdr = decode7Bit(enc);
    let status = 0x00;
    if (modId >= OTP_MODULE_MAX_ID) status = 0x02;
    else if (hdr.length < 44) status = 0x08;
    else if ((hdr[0] | (hdr[1] << 8) | (hdr[2] << 16) | (hdr[3] << 24)) >>> 0 !== 0x4f544d52) status = 0x04;
    else if ((hdr[6] | (hdr[7] << 8)) !== modId) status = 0x06;
    else if ((hdr[40] | (hdr[41] << 8) | (hdr[42] << 16) | (hdr[43] << 24)) === 0) status = 0x07;
    return buildFrame(OtpCmd.MODULE, OtpSub.MODULE_ACK, [status, modId & 0x7f, 1]);
  }
  return null;
}

beforeEach(() => {
  elemente.clear();
  gesendet = [];
  angefragt = [];
  antwortStub = () => null;
  g.document = { getElementById: (id: string) => el(id) };
  el("otpPosTakt").value = "1";
  el("otpPosStep").value = "1";
  initOtpPanel({
    sysexSenden: async (frame) => {
      gesendet.push(frame);
    },
    sysexAnfrage: async (frame, akzeptiere) => {
      angefragt.push(frame);
      const a = antwortStub(frame);
      if (!a || !akzeptiere(a)) throw new Error("Keine Antwort vom Gerät (Timeout).");
      return a;
    },
  });
});

afterEach(() => {
  delete g.document;
});

describe("OTP-Panel", () => {
  it("beim Init wird nichts gesendet; Part-Liste 1–16 und 16 Parameterzeilen mit Beleg stehen", () => {
    expect(gesendet).toEqual([]);
    expect(angefragt).toEqual([]);
    expect(el("otpPart").innerHTML).toContain('value="16">Part 16');
    expect(el("otpPart").innerHTML).not.toContain('value="17"');
    expect(otpZustand().verbunden).toBe(false);
    const tabelle = el("otpReglerTabelle").innerHTML;
    for (const p of OTP_PARAMS) {
      expect(tabelle).toContain(`id="${reglerId(p.key)}"`);
      expect(tabelle).toContain(`id="${reglerId(p.key)}Lesen"`);
      expect(tabelle).toContain(`id="${reglerId(p.key)}Beleg"`);
    }
    expect(reglerId("oscPitch")).toBe("otpOscPitch");
    expect(reglerId("ifxOnOff")).toBe("otpIfxOnOff");
    // Beleg-Status sichtbar und ehrlich: Level bewiesen, EG Attack statisch
    expect(tabelle).toContain('id="otpLevelBeleg"');
    expect(tabelle).toMatch(/id="otpLevelBeleg"[^>]*>✔ bewiesen</);
    expect(tabelle).toMatch(/id="otpEgAttackBeleg"[^>]*>◐ statisch</);
    expect(tabelle).toMatch(/id="otpVoiceAssignBeleg"[^>]*>◐ statisch</);
    expect(tabelle).toContain("NICHT gemessen");
    // Enum-Regler zeigen ihre Stufen
    expect(el("otpVoiceAssignWert").textContent).toBe("0 = Mono 1");
    expect(el("otpMfxSendWert").textContent).toBe("0 = Off");
    expect(el("otpPosBeats").textContent).toBe("0 Beats (SPP)");
  });

  it("ohne Antwort: genau eine Anfrage (IDENTITY), klare Meldung, keine Regler", async () => {
    el("otpRegler").classList.add("hidden");
    await klickUndWarte("otpFragen");
    expect(angefragt.length).toBe(1);
    expect(Array.from(angefragt[0])).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x01, 0x00, 0x00, 0x00, 0x00, 0xf7]);
    expect(el("otpStatus").textContent).toContain(OTP_KEIN_GERAET);
    expect(el("otpRegler").classList.contains("hidden")).toBe(true);
    expect(otpZustand().verbunden).toBe(false);
    expect(gesendet).toEqual([]);
  });

  it("mit Stub-Antworten: drei Anfragen in Reihenfolge, benannter Bericht, Regler sichtbar", async () => {
    antwortStub = stubGeraet;
    el("otpRegler").classList.add("hidden");
    await klickUndWarte("otpFragen");
    expect(angefragt.map((f) => [f[4], f[5]])).toEqual([
      [0x01, 0x00],
      [0x09, 0x00],
      [0x07, 0x01],
    ]);
    const b = el("otpBericht").textContent;
    expect(b).toContain("IDENTITY (0x01/0x01): Loader v0.1.0");
    expect(b).toContain("FIRMWARE_INFO (0x09/0x01): v0.1.0 (Minimalform des Coexist-Stubs");
    expect(b).toContain("TELEMETRY (0x07/0x02), 143 Bytes");
    expect(b).toContain("Verdikt: LÄUFT");
    expect(el("otpRegler").classList.contains("hidden")).toBe(false);
    expect(otpZustand()).toEqual({ verbunden: true, identity: { major: 0, minor: 1, patch: 0, featureFlags: 0 } });
    expect(el("otpStatus").textContent).toContain("OTP antwortet");
  });

  it("antwortet nur IDENTITY, bleibt das ehrlich im Bericht stehen", async () => {
    antwortStub = (f) => (f[4] === OtpCmd.IDENTITY ? stubIdentity : null);
    await klickUndWarte("otpFragen");
    const b = el("otpBericht").textContent;
    expect(b).toContain("FIRMWARE_INFO (0x09): keine Antwort");
    expect(b).toContain("TELEMETRY (0x07): keine Antwort");
    expect(otpZustand().verbunden).toBe(true);
  });

  it("Regler loslassen sendet PARAM SET mit Part 0-basiert und 14-Bit-Wert; 'input' sendet nicht", async () => {
    antwortStub = stubGeraet;
    await klickUndWarte("otpFragen");
    el("otpPart").value = "6";
    el("otpOscPitch").value = "-24";
    el("otpOscPitch").feuere("input");
    expect(gesendet.length).toBe(0);
    expect(el("otpOscPitchWert").textContent).toBe("-24 Halbtöne");
    el("otpOscPitch").feuere("change");
    await tick();
    expect(gesendet.length).toBe(1);
    expect(Array.from(gesendet[0])).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 5, 0x00, 0x01, 0x7f, 0x68, 5 ^ 1 ^ 0x7f ^ 0x68, 0xf7]);
    expect(el("otpStatus").textContent).toContain("Osc-Pitch Part 6 = -24 Halbtöne gesendet");
    // Osc-Pitch am Gerät 2026-09-17 als nicht live-wirksam belegt → statisch
    expect(el("otpStatus").textContent).toContain("◐ statisch hergeleitet");

    el("otpPart").value = "16";
    el("otpCutoff").value = "20";
    el("otpCutoff").feuere("change");
    await tick();
    expect(Array.from(gesendet[1].slice(8, 13))).toEqual([15, 0x00, 0x02, 0x00, 20]);

    el("otpResonance").value = "999"; // ausserhalb → geklemmt auf 127, kein Wurf
    el("otpResonance").feuere("change");
    await tick();
    expect(Array.from(gesendet[2].slice(8, 13))).toEqual([15, 0x00, 0x03, 0x00, 127]);
    expect(el("otpResonanceWert").textContent).toBe("127");
  });

  it("jeder der 13 weiteren Parameter sendet seinen eigenen SET-Rahmen (ID, Part, Wert), Enums mit Stufenname", async () => {
    antwortStub = stubGeraet;
    await klickUndWarte("otpFragen");
    const faelle: [string, number, number, number[]][] = [
      ["level", 1, 100, [0x00, 0x00, 0x04, 0x00, 0x64]],
      ["pan", 2, -60, [0x01, 0x00, 0x05, 0x7f, 0x44]],
      ["voiceAssign", 11, 3, [0x0a, 0x00, 0x06, 0x00, 0x03]],
      ["egAttack", 6, 100, [0x05, 0x00, 0x07, 0x00, 0x64]],
      ["egDecay", 6, 20, [0x05, 0x00, 0x08, 0x00, 0x14]],
      ["oscEdit", 6, 127, [0x05, 0x00, 0x09, 0x00, 0x7f]],
      ["egInt", 6, -63, [0x05, 0x00, 0x0a, 0x7f, 0x41]],
      ["modSpeed", 1, 64, [0x00, 0x00, 0x0b, 0x00, 0x40]],
      ["modDepth", 1, 1, [0x00, 0x00, 0x0c, 0x00, 0x01]],
      ["glide", 1, 127, [0x00, 0x00, 0x0d, 0x00, 0x7f]],
      ["ifxEdit", 1, 50, [0x00, 0x00, 0x0e, 0x00, 0x32]],
      ["mfxSend", 6, 1, [0x05, 0x00, 0x0f, 0x00, 0x01]],
      ["ifxOnOff", 16, 1, [0x0f, 0x00, 0x10, 0x00, 0x01]],
    ];
    for (const [key, part, wert, nutzlast] of faelle) {
      const vorher = gesendet.length;
      el("otpPart").value = String(part);
      el(reglerId(key as never)).value = String(wert);
      el(reglerId(key as never)).feuere("change");
      await tick();
      expect(gesendet.length, key).toBe(vorher + 1);
      const f = gesendet[vorher];
      expect(f.length).toBe(15);
      expect(Array.from(f.slice(4, 8))).toEqual([0x02, 0x00, 0x00, 0x05]);
      expect(Array.from(f.slice(8, 13)), key).toEqual(nutzlast);
      expect(f[13]).toBe(nutzlast.reduce((a, b) => a ^ b, 0) & 0x7f);
    }
    expect(el("otpStatus").textContent).toContain("IFX On/Off Part 16 = 1 = On gesendet");
    expect(el("otpStatus").textContent).toContain("◐ statisch hergeleitet");
    expect(el("otpVoiceAssignWert").textContent).toBe("3 = Poly 2");
    expect(el("otpPanWert").textContent).toBe("-60");
  });

  it("Enum-Regler klemmen clientseitig auf die letzte Stufe (Voice Assign 7 → 3), nichts ausserhalb geht raus", async () => {
    antwortStub = stubGeraet;
    await klickUndWarte("otpFragen");
    el("otpPart").value = "1";
    el("otpVoiceAssign").value = "7";
    el("otpVoiceAssign").feuere("change");
    await tick();
    expect(gesendet.length).toBe(1);
    expect(Array.from(gesendet[0].slice(8, 13))).toEqual([0, 0x00, 0x06, 0x00, 0x03]);
    expect(el("otpStatus").textContent).toContain("ausserhalb der Stufen würde der Stub stumm abweisen");
  });

  it("„Alle lesen“: 16 GETs in Registry-Reihenfolge, Regler springen auf die Antworten (signed int8-gedeutet)", async () => {
    antwortStub = stubGeraet;
    await klickUndWarte("otpFragen");
    angefragt = [];
    el("otpPart").value = "3";
    await klickUndWarte("otpLesen", 60);
    expect(angefragt.length).toBe(16);
    expect(angefragt.map((f) => Array.from(f.slice(8, 11)))).toEqual(OTP_PARAMS.map((p) => [2, p.hi, p.lo]));
    expect(angefragt.every((f) => f.length === 13 && f[4] === 0x02 && f[5] === 0x01)).toBe(true);
    expect(el("otpOscPitch").value).toBe("-24");
    expect(el("otpCutoff").value).toBe("20");
    expect(el("otpResonance").value).toBe("100");
    expect(el("otpLevel").value).toBe("100");
    expect(el("otpPan").value).toBe("-60");
    expect(el("otpVoiceAssign").value).toBe("3");
    expect(el("otpVoiceAssignWert").textContent).toBe("3 = Poly 2");
    expect(el("otpEgInt").value).toBe("-63");
    expect(el("otpMfxSend").value).toBe("1");
    expect(el("otpMfxSendWert").textContent).toBe("1 = On");
    expect(el("otpIfxOnOff").value).toBe("0");
    const s = el("otpStatus").textContent;
    expect(s).toContain("Part 3 gelesen: Osc-Pitch -24, Cutoff 20, Resonance 100, Level 100, Pan -60, Voice Assign 3");
    expect(s).toContain("IFX On/Off 0");
    expect(gesendet).toEqual([]);
  });

  it("„Lesen“ je Parameter: genau ein GET, Wert mit Stufenname; ohne Antwort eine ehrliche Meldung", async () => {
    antwortStub = stubGeraet;
    await klickUndWarte("otpFragen");
    angefragt = [];
    el("otpPart").value = "11";
    await klickUndWarte("otpVoiceAssignLesen", 5);
    expect(angefragt.length).toBe(1);
    expect(Array.from(angefragt[0])).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x02, 0x01, 0x00, 0x03, 0x0a, 0x00, 0x06, 0x0c, 0xf7]);
    expect(el("otpStatus").textContent).toContain("Voice Assign Part 11 = 3 = Poly 2 gelesen");
    expect(el("otpStatus").textContent).toContain("Pattern-Block");

    await klickUndWarte("otpPanLesen", 5);
    expect(el("otpStatus").textContent).toContain("Pan Part 11 = -60 gelesen");
    expect(el("otpStatus").textContent).toContain("int8-gedeutet");

    // Stub kennt eine ID nicht (älteres Abbild): keine Antwort, Meldung nennt error_count
    delete geraeteWerte[13];
    try {
      await klickUndWarte("otpGlideLesen", 5);
      expect(el("otpStatus").textContent).toContain("Glide Part 11: keine Antwort");
      expect(el("otpStatus").textContent).toContain("error_count");
    } finally {
      geraeteWerte[13] = 60;
    }
    expect(gesendet).toEqual([]);
  });

  it("TRANSPORT: Play und Stop senden die 10-Byte-Rahmen, nur auf Klick", async () => {
    antwortStub = stubGeraet;
    await klickUndWarte("otpFragen");
    expect(gesendet).toEqual([]);
    await klickUndWarte("otpPlay", 3);
    expect(Array.from(gesendet[0])).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x0e, 0x00, 0x00, 0x00, 0x00, 0xf7]);
    expect(el("otpStatus").textContent).toContain("TRANSPORT Play (0xFA eingespeist) gesendet");
    await klickUndWarte("otpStop", 3);
    expect(Array.from(gesendet[1])).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x0e, 0x01, 0x00, 0x00, 0x00, 0xf7]);
    expect(el("otpStatus").textContent).toContain("keine Bestätigung");
  });

  it("TRANSPORT Position: Takt 2 · Step 10 = 25 Beats → 0E 0A 00 03 00 00 19 19; Takt 1025 wird abgewiesen", async () => {
    antwortStub = stubGeraet;
    await klickUndWarte("otpFragen");
    el("otpPosTakt").value = "2";
    el("otpPosStep").value = "10";
    el("otpPosStep").feuere("input");
    expect(el("otpPosBeats").textContent).toBe("25 Beats (SPP)");
    expect(gesendet).toEqual([]);
    await klickUndWarte("otpPosSenden", 3);
    expect(gesendet.length).toBe(1);
    expect(Array.from(gesendet[0])).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x0e, 0x0a, 0x00, 0x03, 0x00, 0x00, 0x19, 0x19, 0xf7]);
    expect(el("otpStatus").textContent).toContain("Position Takt 2 · Step 10 = 25 Beats gesendet");

    // Grenzwert: Takt 1024 · Step 16 = 16383 geht noch
    el("otpPosTakt").value = "1024";
    el("otpPosStep").value = "16";
    await klickUndWarte("otpPosSenden", 3);
    expect(gesendet.length).toBe(2);
    expect(Array.from(gesendet[1].slice(8, 12))).toEqual([0x00, 0x7f, 0x7f, 0x00]);

    // Takt 1025 = 16384 Beats: clientseitig abgewiesen, nichts gesendet
    el("otpPosTakt").value = "1025";
    el("otpPosStep").value = "1";
    el("otpPosTakt").feuere("input");
    expect(el("otpPosBeats").textContent).toContain("über 0x3FFF");
    await klickUndWarte("otpPosSenden", 3);
    expect(gesendet.length).toBe(2);
    expect(el("otpStatus").textContent).toContain("Position nicht gesendet");
    expect(el("otpStatus").textContent).toContain("error_count");

    // Step 0: Eingabefehler, nichts gesendet
    el("otpPosTakt").value = "1";
    el("otpPosStep").value = "0";
    await klickUndWarte("otpPosSenden", 3);
    expect(gesendet.length).toBe(2);
    expect(el("otpStatus").textContent).toContain("Step 0");
  });

  it("Registry und Panel stimmen überein: jeder Parameter hat Regler-Grenzen aus der Registry", () => {
    for (const p of OTP_PARAMS) {
      const r = el(reglerId(p.key));
      expect([r.min, r.max, r.step], p.key).toEqual([String(p.min), String(p.max), "1"]);
    }
    expect(el(reglerId(otpParam("pan").key)).min).toBe("-63");
  });
});

describe("OTP-Panel: Modul-Lader Stufe 1", () => {
  it("beide Knopfreihen werden erzeugt: 5 synthetische + 20 echte, mit Labels", () => {
    const html = el("otpModulKnoepfe").innerHTML;
    // Alle synthetischen und echten Knopf-ids sind da.
    OTP_MODULE_PROBES.forEach((_, i) => expect(html).toContain(`id="otpModulSyn${i}"`));
    OTP_MODULE_REAL_PROBES.forEach((_, i) => expect(html).toContain(`id="otpModulReal${i}"`));
    // Echte Modul-Namen als Label und die beiden Zwischenüberschriften.
    expect(html).toContain("modmatrix");
    expect(html).toContain("audio_input_routing");
    expect(html).toContain("Echte kompilierte Modul-Header");
    expect(html).toContain("Synthetische Sonden");
    // Nichts beim Init gesendet.
    expect(angefragt).toEqual([]);
  });

  it("echtes gültiges Modul (modmatrix, id 0) → 0x05-Block gesendet, ACK 0x00 angezeigt", async () => {
    antwortStub = stubGeraet;
    await klickUndWarte("otpModulReal0", 5);
    expect(angefragt.length).toBe(1);
    const f = parseFrame(angefragt[0]);
    expect(f.ok).toBe(true);
    if (f.ok) {
      expect(f.cmd).toBe(OtpCmd.MODULE);
      expect(f.sub).toBe(OtpSub.MODULE_BLOCK);
      expect(f.payload[0]).toBe(0); // module_id
    }
    const s = el("otpStatus").textContent;
    expect(s).toContain("✔");
    expect(s).toContain("modmatrix");
    expect(s).toContain("gültig");
    expect(s).toContain("NICHT ausgeführt");
  });

  it("synthetische Grenzsonde id 32 → ACK 0x02 abgewiesen; audio_input_routing (id 21) ist jetzt gültig", async () => {
    antwortStub = stubGeraet;
    const g = OTP_MODULE_PROBES.findIndex((p) => p.key === "idgrenze");
    await klickUndWarte(`otpModulSyn${g}`, 5);
    let s = el("otpStatus").textContent;
    expect(s).toContain("✔"); // erwartet 0x02 und bekommt 0x02 → passt
    expect(s).toContain("abgewiesen");
    const r = OTP_MODULE_REAL_PROBES.findIndex((p) => p.key === "real-audio_input_routing");
    await klickUndWarte(`otpModulReal${r}`, 5);
    s = el("otpStatus").textContent;
    expect(s).toContain("✔");
    expect(s).toContain("gültig");
  });

  it("synthetische Sonde „Falsche Magic“ → ACK 0x04", async () => {
    antwortStub = stubGeraet;
    const idx = OTP_MODULE_PROBES.findIndex((p) => p.key === "magic");
    await klickUndWarte(`otpModulSyn${idx}`, 5);
    const s = el("otpStatus").textContent;
    expect(s).toContain("✔");
    expect(s).toContain("Magic");
  });

  it("ohne ACK (älterer Stub ohne 0x05) → klare Meldung, kein Absturz", async () => {
    antwortStub = () => null;
    await klickUndWarte("otpModulReal0", 5);
    const s = el("otpStatus").textContent;
    expect(s).toContain("keine ACK-Antwort");
    expect(s).toContain("älteres Abbild");
  });
});

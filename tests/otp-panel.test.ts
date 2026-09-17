import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initOtpPanel, otpZustand, OTP_KEIN_GERAET } from "../src/gui/otpPanel";
import {
  OtpCmd,
  OtpSub,
  buildFrame,
  buildTelemetryReport,
  parseFrame,
  OTP_LAYER1_MAGIC,
  OTP_USBDX_MAGIC,
} from "../src/core/otp";

/**
 * Das OTP-Panel über den DOM-Stub: ohne Antwort die klare „Kein OTP“-Meldung
 * und keine Regler; mit Antwort der benannte Bericht, dann PARAM SET vom Regler
 * mit Part 1–16 auf dem Draht 0-basiert. Nichts wird beim Init gesendet.
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

/** Klick feuern und die Promise-Kette dahinter abwarten (drei Anfragen nacheinander). */
async function klickUndWarte(id: string): Promise<void> {
  el(id).feuere("click");
  for (let i = 0; i < 12; i++) await new Promise((r) => setTimeout(r, 0));
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

/** Antwortet wie der Coexist-Stub auf alle drei Anfragen und auf GET. */
function stubGeraet(frame: Uint8Array): Uint8Array | null {
  const f = parseFrame(frame);
  if (!f.ok) return null;
  if (f.cmd === OtpCmd.IDENTITY && f.sub === OtpSub.IDENTITY_REQUEST) return stubIdentity;
  if (f.cmd === OtpCmd.FIRMWARE_INFO && f.sub === OtpSub.FW_INFO_REQUEST) return stubFwInfo;
  if (f.cmd === OtpCmd.TELEMETRY && f.sub === OtpSub.TELEMETRY_REQUEST) return stubTelemetrie;
  if (f.cmd === OtpCmd.PARAM && f.sub === OtpSub.PARAM_GET) {
    // Osc-Pitch −24 als (uint8) 232, Cutoff 20, Resonance 100
    const wert = f.payload[2] === 1 ? 232 : f.payload[2] === 2 ? 20 : 100;
    return buildFrame(OtpCmd.PARAM, OtpSub.PARAM_RESPONSE, [f.payload[0], f.payload[1], f.payload[2], (wert >> 7) & 0x7f, wert & 0x7f]);
  }
  return null;
}

beforeEach(() => {
  elemente.clear();
  gesendet = [];
  angefragt = [];
  antwortStub = () => null;
  g.document = { getElementById: (id: string) => el(id) };
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
  it("beim Init wird nichts gesendet; Part-Liste 1–16 steht", () => {
    expect(gesendet).toEqual([]);
    expect(angefragt).toEqual([]);
    expect(el("otpPart").innerHTML).toContain('value="16">Part 16');
    expect(el("otpPart").innerHTML).not.toContain('value="17"');
    expect(otpZustand().verbunden).toBe(false);
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
    await new Promise((r) => setTimeout(r, 0));
    expect(gesendet.length).toBe(1);
    expect(Array.from(gesendet[0])).toEqual([0xf0, 0x7d, 0x01, 0x02, 0x02, 0x00, 0x00, 0x05, 5, 0x00, 0x01, 0x7f, 0x68, 5 ^ 1 ^ 0x7f ^ 0x68, 0xf7]);
    expect(el("otpStatus").textContent).toContain("Osc-Pitch Part 6 = -24 gesendet");

    el("otpPart").value = "16";
    el("otpCutoff").value = "20";
    el("otpCutoff").feuere("change");
    await new Promise((r) => setTimeout(r, 0));
    expect(Array.from(gesendet[1].slice(8, 13))).toEqual([15, 0x00, 0x02, 0x00, 20]);

    el("otpResonance").value = "999"; // ausserhalb → geklemmt auf 127, kein Wurf
    el("otpResonance").feuere("change");
    await new Promise((r) => setTimeout(r, 0));
    expect(Array.from(gesendet[2].slice(8, 13))).toEqual([15, 0x00, 0x03, 0x00, 127]);
    expect(el("otpResonanceWert").textContent).toBe("127");
  });

  it("Werte lesen: drei GETs, Regler springen auf die Antworten (Osc-Pitch int8-gedeutet)", async () => {
    antwortStub = stubGeraet;
    await klickUndWarte("otpFragen");
    angefragt = [];
    el("otpPart").value = "3";
    await klickUndWarte("otpLesen");
    expect(angefragt.map((f) => Array.from(f.slice(8, 11)))).toEqual([
      [2, 0, 1],
      [2, 0, 2],
      [2, 0, 3],
    ]);
    expect(el("otpOscPitch").value).toBe("-24");
    expect(el("otpCutoff").value).toBe("20");
    expect(el("otpResonance").value).toBe("100");
    expect(el("otpStatus").textContent).toContain("Part 3 gelesen: Osc-Pitch -24, Cutoff 20, Resonance 100");
    expect(gesendet).toEqual([]);
  });
});

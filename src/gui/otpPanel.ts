/**
 * otpPanel.ts (GUI) — Omnitribe (OTP): das Gerät nach seiner Coexist-Firmware
 * fragen und die drei am Gerät belegten Parameter je Part setzen.
 *
 * Der Transport kommt als Hooks herein (derselbe rohe SysEx-Weg wie beim
 * Bootloader-Start): senden, senden-und-warten. Rahmen bauen und deuten macht
 * `core/otp.ts`. Nichts hier sendet von allein — nur auf Klick oder Regler.
 *
 * Stand 2026-09-17: aus TekkForge heraus am Gerät ungetestet.
 */
import {
  OtpCmd,
  OtpSub,
  OTP_PARAMS,
  OTP_PART_MIN,
  OTP_PART_MAX,
  type OtpParamDef,
  buildIdentityRequest,
  buildFirmwareInfoRequest,
  buildTelemetryRequest,
  buildParamSet,
  buildParamGet,
  istOtpAntwort,
  parseFrame,
  parseIdentityResponse,
  parseFirmwareInfoResponse,
  parseTelemetryReport,
  parseParamAntwort,
  identityText,
  firmwareInfoText,
  telemetrieText,
  type OtpIdentity,
} from "../core/otp";

export interface OtpHooks {
  /** Rohen Rahmen senden (öffnet den Ausgang bei Bedarf). */
  sysexSenden(frame: Uint8Array): Promise<void>;
  /** Rahmen senden und auf die erste passende Antwort warten; wirft bei Timeout. */
  sysexAnfrage(frame: Uint8Array, akzeptiere: (b: Uint8Array) => boolean, timeoutMs: number): Promise<Uint8Array>;
}

export const OTP_KEIN_GERAET =
  "Kein OTP — auf dem Gerät läuft keine Omnitribe-Coexist-Firmware (Stock/Hacktribe ohne Hook antworten nicht)";

/** Der Stub antwortet in Millisekunden; 1,5 s lassen dem USB-Treiber Luft. */
const TIMEOUT_MS = 1500;

/** Regler-IDs je Parameter (Markup in index.html). */
const REGLER: Record<OtpParamDef["key"], string> = { oscPitch: "otpOscPitch", cutoff: "otpCutoff", resonance: "otpResonance" };

let hooks: OtpHooks | null = null;
let identity: OtpIdentity | null = null;

const el = (id: string): HTMLElement | null => document.getElementById(id);
const setStatus = (t: string): void => {
  const e = el("otpStatus");
  if (e) e.textContent = t;
};
const setBericht = (t: string): void => {
  const e = el("otpBericht");
  if (e) e.textContent = t;
};
const hex = (b: Uint8Array): string =>
  Array.from(b)
    .map((x) => x.toString(16).toUpperCase().padStart(2, "0"))
    .join(" ");

/** Für Tests: hat das Gerät auf IDENTITY geantwortet? */
export function otpZustand(): { verbunden: boolean; identity: OtpIdentity | null } {
  return { verbunden: identity !== null, identity };
}

function gewaehlterPart(): number {
  const s = el("otpPart") as HTMLSelectElement | null;
  const n = Number(s?.value ?? "1");
  return Number.isInteger(n) && n >= OTP_PART_MIN && n <= OTP_PART_MAX ? n : 1;
}

function reglerZeigen(an: boolean): void {
  el("otpRegler")?.classList.toggle("hidden", !an);
}

function reglerWert(p: OtpParamDef): number {
  const r = el(REGLER[p.key]) as HTMLInputElement | null;
  const n = Math.round(Number(r?.value ?? "0"));
  return Math.max(p.min, Math.min(p.max, Number.isFinite(n) ? n : 0));
}

function reglerSetzen(p: OtpParamDef, wert: number): void {
  const r = el(REGLER[p.key]) as HTMLInputElement | null;
  if (r) r.value = String(wert);
  const w = el(`${REGLER[p.key]}Wert`);
  if (w) w.textContent = `${wert}${p.einheit ? " " + p.einheit : ""}`;
}

/** Eine Anfrage, eine Antwort — null, wenn nichts (Passendes) kam. */
async function frage(frame: Uint8Array, cmd: number, sub: number): Promise<Uint8Array | null> {
  if (!hooks) return null;
  try {
    return await hooks.sysexAnfrage(frame, (b) => istOtpAntwort(b, cmd, sub), TIMEOUT_MS);
  } catch {
    return null;
  }
}

async function geraetFragen(): Promise<void> {
  if (!hooks) {
    setStatus("Kein MIDI-Weg — erst MIDI aktivieren.");
    return;
  }
  identity = null;
  reglerZeigen(false);
  setBericht("");
  setStatus("Frage IDENTITY (CMD 0x01)…");
  const zeilen: string[] = [];

  const idRaw = await frage(buildIdentityRequest(), OtpCmd.IDENTITY, OtpSub.IDENTITY_RESPONSE);
  const idFrame = idRaw ? parseFrame(idRaw) : null;
  const id = idFrame?.ok ? parseIdentityResponse(idFrame.payload) : null;
  if (!id) {
    setStatus(
      `${OTP_KEIN_GERAET}. Falls doch: KORG-Port von einem anderen Programm belegt (Single-Client) oder MIDI noch nicht aktiviert.`,
    );
    return;
  }
  identity = id;
  zeilen.push(`IDENTITY (0x01/0x01): ${identityText(id)} — Rahmen ${hex(idRaw!)}`);

  setStatus("Frage FIRMWARE_INFO (CMD 0x09)…");
  const fwRaw = await frage(buildFirmwareInfoRequest(), OtpCmd.FIRMWARE_INFO, OtpSub.FW_INFO_RESPONSE);
  const fwFrame = fwRaw ? parseFrame(fwRaw) : null;
  const fw = fwFrame?.ok ? parseFirmwareInfoResponse(fwFrame.payload) : null;
  zeilen.push(fw ? `FIRMWARE_INFO (0x09/0x01): ${firmwareInfoText(fw)}` : "FIRMWARE_INFO (0x09): keine Antwort");

  setStatus("Frage TELEMETRY (CMD 0x07)…");
  const tRaw = await frage(buildTelemetryRequest(), OtpCmd.TELEMETRY, OtpSub.TELEMETRY_REPORT);
  const tFrame = tRaw ? parseFrame(tRaw) : null;
  const t = tFrame?.ok ? parseTelemetryReport(tFrame.payload) : null;
  zeilen.push(
    t
      ? `TELEMETRY (0x07/0x02), ${tRaw!.length} Bytes:\n${telemetrieText(t)}`
      : tRaw
        ? `TELEMETRY (0x07): Antwort mit ${tRaw.length} Bytes, aber nicht deutbar (zu kurz für 25 Felder)`
        : "TELEMETRY (0x07): keine Antwort (Firmware vor Sprint 141 kennt das Kommando nicht)",
  );

  setBericht(zeilen.join("\n"));
  reglerZeigen(true);
  setStatus(
    `OTP antwortet — ${identityText(id)}. Regler senden PARAM SET an Part ${gewaehlterPart()} (Cutoff/Resonance wirken sofort; ` +
      `Osc-Pitch nur, solange der Part nicht neu geladen wird).`,
  );
}

async function paramSenden(p: OtpParamDef): Promise<void> {
  if (!hooks) return;
  const part = gewaehlterPart();
  const wert = reglerWert(p);
  reglerSetzen(p, wert);
  let frame: Uint8Array;
  try {
    frame = buildParamSet(part, p, wert);
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e));
    return;
  }
  try {
    await hooks.sysexSenden(frame);
    setStatus(`${p.name} Part ${part} = ${wert} gesendet (${hex(frame)}) — SET hat keine Bestätigung; die Telemetrie zählt es in response_sent_count.`);
  } catch (e) {
    setStatus(`${p.name} nicht gesendet: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function werteLesen(): Promise<void> {
  if (!hooks) return;
  const part = gewaehlterPart();
  setStatus(`Lese Part ${part}…`);
  const ergebnis: string[] = [];
  for (const p of OTP_PARAMS) {
    const raw = await frage(buildParamGet(part, p), OtpCmd.PARAM, OtpSub.PARAM_RESPONSE);
    const f = raw ? parseFrame(raw) : null;
    const a = f?.ok ? parseParamAntwort(f.payload) : null;
    if (a && a.hi === p.hi && a.lo === p.lo) {
      reglerSetzen(p, Math.max(p.min, Math.min(p.max, a.wert)));
      ergebnis.push(`${p.name} ${a.wert}`);
    } else {
      ergebnis.push(`${p.name} –`);
    }
  }
  setStatus(`Part ${part} gelesen: ${ergebnis.join(", ")} (GET liest das Live-Fenster; „–“ = keine Antwort).`);
}

export function initOtpPanel(h: OtpHooks): void {
  hooks = h;
  identity = null;

  const part = el("otpPart") as HTMLSelectElement | null;
  if (part && !part.innerHTML) {
    part.innerHTML = Array.from({ length: OTP_PART_MAX }, (_, i) => `<option value="${i + 1}">Part ${i + 1}</option>`).join("");
  }

  el("otpFragen")?.addEventListener("click", () => void geraetFragen());
  el("otpLesen")?.addEventListener("click", () => void werteLesen());

  for (const p of OTP_PARAMS) {
    const r = el(REGLER[p.key]) as HTMLInputElement | null;
    if (!r) continue;
    r.min = String(p.min);
    r.max = String(p.max);
    r.step = "1";
    reglerSetzen(p, reglerWert(p));
    // „input“ zeigt nur; gesendet wird beim Loslassen („change“) — kein Sweep mit
    // hundert Rahmen pro Sekunde in den Stub, der pro MIDI-Byte läuft.
    r.addEventListener("input", () => reglerSetzen(p, reglerWert(p)));
    r.addEventListener("change", () => void paramSenden(p));
  }
}

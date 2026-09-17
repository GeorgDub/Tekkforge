/**
 * otpPanel.ts (GUI) — Omnitribe (OTP): das Gerät nach seiner Coexist-Firmware
 * fragen, alle 16 Registry-Parameter je Part setzen/lesen und den Transport
 * (Play/Stop/Position) über den Stub auslösen.
 *
 * Der Transport kommt als Hooks herein (derselbe rohe SysEx-Weg wie beim
 * Bootloader-Start): senden, senden-und-warten. Rahmen bauen und deuten macht
 * `core/otp.ts`. Nichts hier sendet von allein — nur auf Klick oder Regler.
 *
 * Die Parameterzeilen werden aus `OTP_PARAMS` erzeugt (eine Quelle: der Stub),
 * je Zeile sichtbar der Beleg-Status aus dem C-Kommentar des Stubs.
 *
 * Stand 2026-09-17: aus TekkForge heraus am Gerät ungetestet.
 */
import {
  OtpCmd,
  OtpSub,
  OTP_PARAMS,
  OTP_PART_MIN,
  OTP_PART_MAX,
  OTP_TRANSPORT_BEATS_MAX,
  type OtpParamDef,
  type OtpParamKey,
  buildIdentityRequest,
  buildFirmwareInfoRequest,
  buildTelemetryRequest,
  buildParamSet,
  buildParamGet,
  buildTransportPlay,
  buildTransportStop,
  buildTransportPosition,
  positionAusTaktStep,
  istOtpAntwort,
  parseFrame,
  parseIdentityResponse,
  parseFirmwareInfoResponse,
  parseTelemetryReport,
  parseParamAntwort,
  identityText,
  firmwareInfoText,
  telemetrieText,
  belegText,
  paramWertText,
  type OtpIdentity,
  OTP_MODULE_PROBES,
  parseModuleAck,
  moduleAckText,
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

/** Regler-ID je Parameter: `otp` + Key mit grossem Anfangsbuchstaben (otpOscPitch, otpLevel, …). */
export function reglerId(key: OtpParamKey): string {
  return "otp" + key.charAt(0).toUpperCase() + key.slice(1);
}

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
const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

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
  const r = el(reglerId(p.key)) as HTMLInputElement | null;
  const n = Math.round(Number(r?.value ?? "0"));
  return Math.max(p.min, Math.min(p.max, Number.isFinite(n) ? n : 0));
}

function reglerSetzen(p: OtpParamDef, wert: number): void {
  const id = reglerId(p.key);
  const r = el(id) as HTMLInputElement | null;
  if (r) r.value = String(wert);
  const w = el(`${id}Wert`);
  if (w) w.textContent = paramWertText(p, wert);
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
    `OTP antwortet — ${identityText(id)}. Regler senden PARAM SET an Part ${gewaehlterPart()}; „Lesen“ holt den Wert per PARAM GET. ` +
      `SET und TRANSPORT haben keine Bestätigung — die Telemetrie zählt Erfolg in response_sent_count, Absagen in error_count.`,
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
    const wegText = p.weg === "schreib" ? "Schreibzugriff" : `als ${p.weg.toUpperCase()} eingespeist`;
    setStatus(
      `${p.name} Part ${part} = ${paramWertText(p, wert)} gesendet (${hex(frame)}) — ${wegText}; ${belegText(p.beleg)}. ` +
        `SET hat keine Bestätigung${p.enum ? "; ausserhalb der Stufen würde der Stub stumm abweisen" : ""}.`,
    );
  } catch (e) {
    setStatus(`${p.name} nicht gesendet: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Ein PARAM GET; liefert den gedeuteten Wert oder null (keine/unpassende Antwort). */
async function paramLesen(part: number, p: OtpParamDef): Promise<number | null> {
  const raw = await frage(buildParamGet(part, p), OtpCmd.PARAM, OtpSub.PARAM_RESPONSE);
  const f = raw ? parseFrame(raw) : null;
  const a = f?.ok ? parseParamAntwort(f.payload) : null;
  if (!a || a.hi !== p.hi || a.lo !== p.lo) return null;
  const wert = Math.max(p.min, Math.min(p.max, a.wert));
  reglerSetzen(p, wert);
  return a.wert;
}

async function einenLesen(p: OtpParamDef): Promise<void> {
  if (!hooks) return;
  const part = gewaehlterPart();
  setStatus(`Lese ${p.name} Part ${part}…`);
  const w = await paramLesen(part, p);
  setStatus(
    w === null
      ? `${p.name} Part ${part}: keine Antwort — ${identity ? "Registry-Eintrag im geflashten Stub unbekannt oder unvermessen (error_count zählt)" : OTP_KEIN_GERAET}.`
      : `${p.name} Part ${part} = ${paramWertText(p, w)} gelesen (GET liest die Tabellenadresse im ${p.fenster === "live" ? "Live-Fenster" : "Pattern-Block"}${p.signed ? ", int8-gedeutet" : ""}).`,
  );
}

async function alleLesen(): Promise<void> {
  if (!hooks) return;
  const part = gewaehlterPart();
  setStatus(`Lese Part ${part} (${OTP_PARAMS.length} × PARAM GET)…`);
  const ergebnis: string[] = [];
  for (const p of OTP_PARAMS) {
    const w = await paramLesen(part, p);
    ergebnis.push(w === null ? `${p.name} –` : `${p.name} ${w}`);
  }
  setStatus(`Part ${part} gelesen: ${ergebnis.join(", ")} (GET liest die Tabellenadressen; „–“ = keine Antwort).`);
}

// ─── TRANSPORT ──────────────────────────────────────────────────────────────

async function transportSenden(frame: Uint8Array, was: string): Promise<void> {
  if (!hooks) return;
  try {
    await hooks.sysexSenden(frame);
    setStatus(`TRANSPORT ${was} gesendet (${hex(frame)}) — keine Bestätigung; Erfolg zählt in response_sent_count, Absage in error_count.`);
  } catch (e) {
    setStatus(`TRANSPORT ${was} nicht gesendet: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function positionEingabe(): { takt: number; step: number } {
  const takt = Number((el("otpPosTakt") as HTMLInputElement | null)?.value ?? "1");
  const step = Number((el("otpPosStep") as HTMLInputElement | null)?.value ?? "1");
  return { takt, step };
}

function positionAnzeigen(): void {
  const z = el("otpPosBeats");
  if (!z) return;
  const { takt, step } = positionEingabe();
  try {
    const beats = positionAusTaktStep(takt, step);
    z.textContent = beats > OTP_TRANSPORT_BEATS_MAX ? `${beats} Beats — über 0x3FFF, wird abgewiesen` : `${beats} Beats (SPP)`;
  } catch (e) {
    z.textContent = e instanceof Error ? e.message : String(e);
  }
}

async function positionSenden(): Promise<void> {
  const { takt, step } = positionEingabe();
  let frame: Uint8Array;
  let beats: number;
  try {
    beats = positionAusTaktStep(takt, step);
    frame = buildTransportPosition(beats);
  } catch (e) {
    setStatus(`Position nicht gesendet: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  await transportSenden(frame, `Position Takt ${takt} · Step ${step} = ${beats} Beats`);
}

// ─── Aufbau ──────────────────────────────────────────────────────────────────

function belegSymbol(p: OtpParamDef): string {
  return p.beleg === "gerätebewiesen" ? "✔" : p.beleg === "statisch" ? "◐" : "?";
}

// ─── Modul-Lader Stufe 1 (CMD 0x05) ──────────────────────────────────────────
// Sendet eine Sonde (0x05-Block) und wartet auf den Modul-ACK (0x05 SUB 0x03).
// Der Stub validiert nur den Header und führt NICHTS aus — der ACK-Status zeigt,
// welcher Validierungszweig gegriffen hat. Nichts hier flasht oder platziert.

async function moduleProbeSenden(index: number): Promise<void> {
  const sonde = OTP_MODULE_PROBES[index];
  if (!sonde) return;
  if (!hooks) {
    setStatus("Kein MIDI-Weg — erst MIDI aktivieren.");
    return;
  }
  const frame = sonde.bytes();
  const antwort = await frage(frame, OtpCmd.MODULE, OtpSub.MODULE_ACK);
  if (!antwort) {
    setStatus(
      `Modul-Sonde „${sonde.label}“ gesendet (${hex(frame)}) — keine ACK-Antwort. ` +
        `Entweder kennt der geladene Stub CMD 0x05 nicht (älteres Abbild ohne Modul-Lader → stumm, nur error_count), ` +
        `oder der KORG-Port reicht die 0x7D-Antwort nicht durch. Erst „Gerät fragen“ prüfen.`,
    );
    return;
  }
  const p = parseFrame(antwort);
  const ack = p.ok ? parseModuleAck(p.payload) : null;
  if (!ack) {
    setStatus(`Modul-Sonde „${sonde.label}“: ACK unlesbar (${hex(antwort)}).`);
    return;
  }
  const passt = ack.status === sonde.erwarteterStatus;
  setStatus(
    `${passt ? "✔" : "✘"} Modul-Sonde „${sonde.label}“: ${moduleAckText(ack)}. ` +
      `Erwartet 0x${sonde.erwarteterStatus.toString(16).padStart(2, "0")}${passt ? "" : " — Abweichung"}. ` +
      `Header validiert, NICHT ausgeführt (Stufe 1).`,
  );
}

/** Knöpfe für die vier Modul-Sonden. */
function modulMarkup(): string {
  return OTP_MODULE_PROBES.map((s, i) => {
    const titel = escapeHtml(`${s.label} — erwarteter Stub-Status 0x${s.erwarteterStatus.toString(16).padStart(2, "0")}`);
    return `<button id="otpModul${i}" class="ghost" style="padding:2px 8px;font-size:11px" title="${titel}">${escapeHtml(s.label)}</button>`;
  }).join(" ");
}

/** Eine Zeile je Parameter: Name · Regler · Wert · Lesen · Beleg. */
function zeilenMarkup(): string {
  return OTP_PARAMS.map((p) => {
    const id = reglerId(p.key);
    const idHex = `0x${((p.hi << 8) | p.lo).toString(16).toUpperCase().padStart(4, "0")}`;
    const wegText = p.weg === "schreib" ? "nackter Schreibzugriff" : `eingespeiste ${p.weg.toUpperCase()}`;
    const titel = escapeHtml(
      `${p.name} — ID ${idHex}, ${p.min}..${p.max}${p.signed ? " signed (int8)" : ""}${p.enum ? ", Aufzählung (ausserhalb = Absage)" : ""}; ` +
        `Weg: ${wegText}; ${p.fenster === "live" ? "Live-Fenster" : "Pattern-Block"}`,
    );
    const belegTitel = escapeHtml(`${belegText(p.beleg)} — ${p.quelle}`);
    const stufen = p.enum && p.stufen ? ` (${p.stufen.map((s, i) => `${i}=${s}`).join(", ")})` : "";
    return (
      `<label class="sub" for="${id}" style="margin:0" title="${titel}">${escapeHtml(p.name)}</label>` +
      `<input id="${id}" type="range" min="${p.min}" max="${p.max}" step="1" value="${p.min < 0 ? 0 : p.min}" title="${titel}${escapeHtml(stufen)}" />` +
      `<span id="${id}Wert" class="sub" style="margin:0;min-width:7em;text-align:right"></span>` +
      `<button id="${id}Lesen" class="ghost" style="padding:1px 6px;font-size:11px" title="PARAM GET ${idHex} für den gewählten Part">Lesen</button>` +
      `<span id="${id}Beleg" class="sub" style="margin:0;cursor:help" title="${belegTitel}">${belegSymbol(p)} ${escapeHtml(
        p.beleg === "gerätebewiesen" ? "bewiesen" : p.beleg === "statisch" ? "statisch" : "unbestimmt",
      )}</span>`
    );
  }).join("");
}

export function initOtpPanel(h: OtpHooks): void {
  hooks = h;
  identity = null;

  const part = el("otpPart") as HTMLSelectElement | null;
  if (part && !part.innerHTML) {
    part.innerHTML = Array.from({ length: OTP_PART_MAX }, (_, i) => `<option value="${i + 1}">Part ${i + 1}</option>`).join("");
  }
  const tabelle = el("otpReglerTabelle");
  if (tabelle && !tabelle.innerHTML) tabelle.innerHTML = zeilenMarkup();

  el("otpFragen")?.addEventListener("click", () => void geraetFragen());
  el("otpLesen")?.addEventListener("click", () => void alleLesen());

  for (const p of OTP_PARAMS) {
    const id = reglerId(p.key);
    const r = el(id) as HTMLInputElement | null;
    if (!r) continue;
    r.min = String(p.min);
    r.max = String(p.max);
    r.step = "1";
    reglerSetzen(p, reglerWert(p));
    // „input“ zeigt nur; gesendet wird beim Loslassen („change“) — kein Sweep mit
    // hundert Rahmen pro Sekunde in den Stub, der pro MIDI-Byte läuft.
    r.addEventListener("input", () => reglerSetzen(p, reglerWert(p)));
    r.addEventListener("change", () => void paramSenden(p));
    el(`${id}Lesen`)?.addEventListener("click", () => void einenLesen(p));
    const b = el(`${id}Beleg`);
    if (b && !b.textContent) b.textContent = `${belegSymbol(p)} ${p.beleg}`;
  }

  el("otpPlay")?.addEventListener("click", () => void transportSenden(buildTransportPlay(), "Play (0xFA eingespeist)"));
  el("otpStop")?.addEventListener("click", () => void transportSenden(buildTransportStop(), "Stop (0xFC eingespeist)"));
  el("otpPosSenden")?.addEventListener("click", () => void positionSenden());
  el("otpPosTakt")?.addEventListener("input", positionAnzeigen);
  el("otpPosStep")?.addEventListener("input", positionAnzeigen);
  positionAnzeigen();

  const modul = el("otpModulKnoepfe");
  if (modul && !modul.innerHTML) modul.innerHTML = modulMarkup();
  OTP_MODULE_PROBES.forEach((_, i) => {
    el(`otpModul${i}`)?.addEventListener("click", () => void moduleProbeSenden(i));
  });
}

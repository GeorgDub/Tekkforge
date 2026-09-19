/**
 * omniPanel.ts (GUI) — Omnitribe-Modul-Panel: Modul-Karten aus OMNI_MODULES
 * (core/otp.ts) laden/entladen und je Modul parametrieren.
 * Dieses Skelett baut nur die Karten; Sende-Logik folgt in Task 5-8.
 */

import {
  OMNI_MODULES,
  type OmniModule,
  type OmniParam,
  buildModuleUpload,
  buildModuleUnplace,
  buildOmniNrpn,
  parseModuleAck,
  istOtpAntwort,
  OtpCmd,
  OtpSub,
} from "../core/otp";
import { omniModuleBytes } from "../core/omniModuleBins";

export interface OmniHooks {
  sysexSenden(f: Uint8Array): Promise<void>;
  sysexAnfrage(f: Uint8Array, ok: (r: Uint8Array) => boolean, timeoutMs?: number): Promise<Uint8Array>;
  warten(ok: (r: Uint8Array) => boolean, timeoutMs?: number): Promise<Uint8Array | null>;
}

let hooks: OmniHooks | null = null;
const platziert = new Set<number>();

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Element fehlt: ${id}`);
  return el;
}

function kartenMarkup(m: OmniModule): string {
  const badge = m.tested ? "" : ` <span class="omni-badge">ungetestet</span>`;
  return `<div class="omni-karte" data-omni-modul="${m.id}">
    <div class="omni-kopf">${m.name} <small>id ${m.id}</small>${badge}
      <span class="omni-led" id="omniLed${m.id}" data-omni-led="${m.id}"></span></div>
    <div class="omni-zeile">
      <label>Part <select data-omni-part="${m.id}">${
        Array.from({ length: 16 }, (_, i) => `<option value="${i}">${i + 1}</option>`).join("")
      }</select></label>
      <button data-omni-laden="${m.id}">Laden</button>
      <button data-omni-entladen="${m.id}">Entladen</button>
    </div>
    <div class="omni-params" data-omni-params="${m.id}"></div>
  </div>`;
}

export function initOmni(h: OmniHooks): void {
  hooks = h;
  platziert.clear();
  $("viewOmni").innerHTML = `<div class="omni-kopfleiste">
      <button id="omniPreset">Preset laden (Chord P1 + Arp P3-4)</button>
      <button id="omniAus">Alles aus</button>
      <span id="omniStatus">bereit</span>
    </div>
    <div class="omni-liste">${OMNI_MODULES.map(kartenMarkup).join("")}</div>`;
  // Event-Delegation fuers echte Panel. Der minimale Test-Stub (nur `innerHTML`,
  // kein addEventListener) hat keine Traversierung — dort rufen die Tests
  // modulLaden/modulEntladen direkt auf, darum ist dieser Zweig hier optional.
  const container = $("viewOmni");
  if (typeof container.addEventListener === "function") {
    container.addEventListener("click", (e) => {
      const t = e.target as HTMLElement | null;
      const laden = t?.getAttribute?.("data-omni-laden");
      const entladen = t?.getAttribute?.("data-omni-entladen");
      if (laden) void modulLaden(Number(laden));
      else if (entladen) void modulEntladen(Number(entladen));
    });
    // Delegation fuers echte Panel: Param-Widgets senden ihren NRPN-Callback
    // bei `change`. Der minimale Test-Stub hat keinen `addEventListener` —
    // Tests rufen `omniParamSenden`/`paramsRendern` direkt auf (s. omni-panel.test.ts).
    container.addEventListener("change", (e) => {
      const t = e.target as HTMLElement | null;
      if (t?.hasAttribute?.("data-omni-pid")) paramGeaendert(t as HTMLInputElement | HTMLSelectElement);
    });
  }
}

/** Part-Auswahl der Modul-Karte lesen (0-basiert); Fallback Part 1 (0). */
function aktuellerPart(id: number): number {
  const sel = document.querySelector<HTMLSelectElement>(`[data-omni-part="${id}"]`);
  return sel ? Number(sel.value) : 0;
}

function paramWidget(m: OmniModule, p: OmniParam): string {
  const key = `data-omni-modul-id="${m.id}" data-omni-pid="${p.pid}"`;
  if (p.kind === "toggle") return `<label>${p.label} <input type="checkbox" ${key}></label>`;
  if (p.kind === "enum")
    return `<label>${p.label} <select ${key}>${
      p.options!.map((o) => `<option value="${o.wert}">${o.text}</option>`).join("")
    }</select></label>`;
  if (p.kind === "part")
    return `<label>${p.label} <select ${key}>${
      Array.from({ length: 16 }, (_, i) => `<option value="${i}">${i + 1}</option>`).join("")
    }</select></label>`;
  return `<label>${p.label} <input type="range" min="${p.min ?? 0}" max="${p.max ?? 127}" ${key}></label>`;
}

/**
 * Params-Host eines Moduls per String-Splice in `viewOmni` ersetzen — nicht
 * per `querySelector` auf einem Kind-Element: der Test-Stub kennt nur
 * `innerHTML` als String (kein DOM-Baum), und dieselbe Implementierung muss
 * unveraendert auch im echten Browser-DOM funktionieren (dort ist `innerHTML`
 * ebenso ein String-Property). Die Param-Widgets selbst haben keine `<div>`,
 * darum ist das naechste `</div>` nach der Markierung zuverlaessig deren Ende.
 */
function setParamsHost(id: number, html: string): void {
  const container = $("viewOmni");
  const marker = `data-omni-params="${id}">`;
  const start = container.innerHTML.indexOf(marker);
  if (start === -1) return;
  const inhaltStart = start + marker.length;
  const ende = container.innerHTML.indexOf("</div>", inhaltStart);
  if (ende === -1) return;
  container.innerHTML = container.innerHTML.slice(0, inhaltStart) + html + container.innerHTML.slice(ende);
}

/** Param-Widgets eines platzierten Moduls rendern (Enable-Toggle ist ein normaler Param darunter). */
export function paramsRendern(id: number): void {
  const m = OMNI_MODULES.find((x) => x.id === id);
  if (!m) return;
  setParamsHost(id, m.params.map((p) => paramWidget(m, p)).join(""));
}

/** on_nrpn(msb, (part<<4)|pid, value) fuer ein Omni-Modul senden — direkt testbar ohne DOM-Event. */
export function omniParamSenden(modul: OmniModule, part: number, pid: number, value: number): void {
  if (!hooks) return;
  void hooks.sysexSenden(buildOmniNrpn(modul, part, pid, value));
}

function paramGeaendert(el: HTMLInputElement | HTMLSelectElement): void {
  const id = Number(el.getAttribute("data-omni-modul-id"));
  const pid = Number(el.getAttribute("data-omni-pid"));
  const m = OMNI_MODULES.find((x) => x.id === id);
  if (!m) return;
  const wert = el instanceof HTMLInputElement && el.type === "checkbox" ? (el.checked ? 1 : 0) : Number(el.value);
  omniParamSenden(m, aktuellerPart(id), pid, wert);
}

/**
 * Modul komplett laden: Chunks (Stufe 2, CMD 0x05 SUB 0x02) + abschliessender
 * Commit (SUB 0x04), je gesendetem Frame auf ein ACK (SUB 0x03) gewartet.
 * Nur ein fehlgeschlagener COMMIT bricht ab (Chunk-Fehler zeigen sich erst im
 * Commit-Status, s. `OTP_MODULE_STATUS` 0x09/0x0a/0x0b).
 */
export async function modulLaden(id: number): Promise<void> {
  if (!hooks) return;
  const bytes = omniModuleBytes(id);
  if (!bytes) {
    statusSetzen(`Modul ${id}: kein Build gebuendelt`);
    return;
  }
  const frames = buildModuleUpload(id, bytes); // N Chunks + Commit
  for (let i = 0; i < frames.length; i++) {
    await hooks.sysexSenden(frames[i]);
    const ack = await hooks.warten((r) => istOtpAntwort(r, OtpCmd.MODULE, OtpSub.MODULE_ACK), 1500);
    const a = ack ? parseModuleAck(parseFramePayload(ack)) : null;
    if (a && !a.ok && frames[i][5] === OtpSub.MODULE_COMMIT) {
      statusSetzen(`Commit-Fehler: ${a.text}`);
      return;
    }
  }
  platziert.add(id);
  paramsRendern(id);
  ledAktualisieren();
  statusSetzen(`Modul ${id} geladen`);
}

/** Modul aus `placed_mask` nehmen (SUB 0x07) — bekommt am Geraet keine Ereignisse mehr. */
export async function modulEntladen(id: number): Promise<void> {
  if (!hooks) return;
  await hooks.sysexSenden(buildModuleUnplace(id));
  platziert.delete(id);
  setParamsHost(id, "");
  ledAktualisieren();
  statusSetzen(`Modul ${id} entladen`);
}

/** ACK-Payload aus einem vollstaendigen OTP-Rahmen ziehen (ab Byte 8 bis vor CHK/F7). */
function parseFramePayload(raw: Uint8Array): Uint8Array {
  const len = ((raw[6] & 0x7f) << 7) | (raw[7] & 0x7f);
  return raw.slice(8, 8 + len);
}

function statusSetzen(t: string): void {
  const el = document.getElementById("omniStatus");
  if (el) el.textContent = t;
}

function ledAktualisieren(): void {
  for (const m of OMNI_MODULES) {
    const led = document.getElementById(`omniLed${m.id}`);
    led?.classList?.toggle("an", platziert.has(m.id));
  }
}

export function omniZustand(): { module: { id: number; platziert: boolean }[] } {
  return { module: OMNI_MODULES.map((m) => ({ id: m.id, platziert: platziert.has(m.id) })) };
}

/** Interne Helfer fuer Folge-Tasks (Set-Zugriff gekapselt). */
export const _omniIntern = { platziert, hooks: () => hooks };

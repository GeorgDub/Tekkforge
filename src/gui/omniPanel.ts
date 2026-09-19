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
  buildIrqInstall,
  buildIrqConfig,
  buildIrqStatus,
  parseIrqReport,
  buildPeek,
  istPeekAntwort,
  peekU32,
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
let pollTimer: ReturnType<typeof setInterval> | null = null;
/** `placed_mask` liegt laut Geraetemessung an dieser festen DDR-Adresse (Omnitribe-Referenzskript peek.mjs). */
const OMNI_PLACED_MASK_ADDR = 0xc2200084;

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
      <button id="omniStatusPoll">Status-Poll an</button>
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
      if (t?.id === "omniPreset") {
        void presetLaden();
        return;
      }
      if (t?.id === "omniAus") {
        void allesAus();
        return;
      }
      if (t?.id === "omniStatusPoll") {
        if (pollLaeuft()) omniWirdVerlassen();
        else omniStatusStart();
        t.textContent = pollLaeuft() ? "Status-Poll aus" : "Status-Poll an";
        return;
      }
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

function pollLaeuft(): boolean {
  return pollTimer !== null;
}

/**
 * Ein Poll-Zyklus: IRQ-Status (CMD 0x04 SUB 0x04, Antwort immer SUB 0x7F
 * Report mit 13 Zaehlern) + `placed_mask`-Peek (0xC2200084, 4 Byte) abfragen
 * und das Ergebnis in `#omniStatus` zeigen. Direkt aufrufbar (auch ohne
 * laufenden Poller) — der Toggle-Button und `omniStatusStart` nutzen dieselbe
 * Funktion.
 */
export async function omniStatusEinmal(): Promise<void> {
  if (!hooks) return;
  try {
    const rep = await hooks.sysexAnfrage(
      buildIrqStatus(),
      (r) => istOtpAntwort(r, OtpCmd.IRQ_HOOK, OtpSub.IRQ_REPORT),
      1200,
    );
    const info = parseIrqReport(parseFramePayload(rep));
    const placedRaw = await hooks.sysexAnfrage(buildPeek(OMNI_PLACED_MASK_ADDR, 4), istPeekAntwort, 1200);
    const placed = peekU32(placedRaw) ?? 0;
    const egress = info?.status?.egressFrames ?? 0;
    const ticks = info?.status?.ticks ?? 0;
    statusSetzen(`placed_mask=0x${placed.toString(16)}  egress=${egress}  ticks=${ticks}`);
  } catch {
    statusSetzen("Status: keine Antwort");
  }
}

/** Poller starten (alle ~1 s `omniStatusEinmal`) — kein Effekt, wenn er schon laeuft. */
export function omniStatusStart(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => void omniStatusEinmal(), 1000);
}

/** Poller stoppen — beim Tab-Verlassen aus main.ts aufgerufen, damit im Ruhezustand kein Dauer-Traffic entsteht. */
export function omniWirdVerlassen(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function ledAktualisieren(): void {
  for (const m of OMNI_MODULES) {
    const led = document.getElementById(`omniLed${m.id}`);
    led?.classList?.toggle("an", platziert.has(m.id));
  }
}

/**
 * Periodik-Hook installieren und konfigurieren — dieselben Bytes wie
 * `multi-module.mjs` (Omnitribe-Referenzskript): IRQ 21 (Audio-Callback),
 * kein Audio-Teiler, Clock-Teiler 21, Quelle Clock (1).
 */
export async function periodikInstallieren(): Promise<void> {
  if (!hooks) return;
  await hooks.sysexSenden(buildIrqInstall(21, 0, 21, 1)); // == multi-module.mjs cmd04(0x02,[21,0,0,0,21,1])
  await hooks.sysexSenden(buildIrqConfig(0, 21, 1)); // == cmd04(0x05,[0,0,0,21,1])
}

/**
 * Fest verdrahtetes Preset: Chord (id 9) auf Part 1 (0), Arp (id 1) nur auf
 * Kanal 3 (2) mit Ziel-Part 4 (3), anschliessend die Periodik installieren —
 * wie im Brief (Step 3) und `multi-module.mjs` vorgegeben.
 */
export async function presetLaden(): Promise<void> {
  const chord = OMNI_MODULES.find((m) => m.id === 9)!;
  const arp = OMNI_MODULES.find((m) => m.id === 1)!;
  await modulLaden(9);
  await modulLaden(1);
  if (!hooks) return;
  // modulLaden() setzt bei einem Commit-Fehler nur den Status (still, kein
  // Wurf) und laesst das Modul unplatziert — ohne diese Pruefung wuerden die
  // folgenden ~21 NRPN- + IRQ-Frames an ein nicht platziertes Modul gehen und
  // die Fehlermeldung wuerde am Ende vom Erfolgsstatus ueberschrieben.
  if (!(platziert.has(9) && platziert.has(1))) {
    statusSetzen("Preset abgebrochen — Modul-Commit fehlgeschlagen");
    return;
  }
  // Chord auf Part 1 (0): Dur, root=gespielt, stagger 0, aktiv
  await hooks.sysexSenden(buildOmniNrpn(chord, 0, 0x00, 0));
  await hooks.sysexSenden(buildOmniNrpn(chord, 0, 0x02, 200));
  await hooks.sysexSenden(buildOmniNrpn(chord, 0, 0x01, 0));
  await hooks.sysexSenden(buildOmniNrpn(chord, 0, 0x03, 1));
  // Arp nur auf ch2 (Part 3), Ziel Part 4 (3), Enable je Kanal
  for (let ch = 0; ch < 16; ch++) await hooks.sysexSenden(buildOmniNrpn(arp, ch, 0x06, ch === 2 ? 1 : 0));
  await hooks.sysexSenden(buildOmniNrpn(arp, 2, 0x05, 3));
  await periodikInstallieren();
  statusSetzen("Preset geladen (Chord P1 + Arp P3-4)");
}

/** Alle platzierten Module auf einmal entladen (Unplace-Byte 0x7f = "alle"). */
export async function allesAus(): Promise<void> {
  if (!hooks) return;
  await hooks.sysexSenden(buildModuleUnplace("alle"));
  platziert.clear();
  ledAktualisieren();
  statusSetzen("alle Module entladen");
}

export function omniZustand(): { module: { id: number; platziert: boolean }[] } {
  return { module: OMNI_MODULES.map((m) => ({ id: m.id, platziert: platziert.has(m.id) })) };
}

/** Interne Helfer fuer Folge-Tasks (Set-Zugriff gekapselt). */
export const _omniIntern = { platziert, hooks: () => hooks };

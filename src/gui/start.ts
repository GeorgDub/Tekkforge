/**
 * start.ts — Tab „Start": Willkommens-Hub mit Statuskacheln, Schnellzugriff,
 * „Letzte Dateien" und Geräte-Karte (MKM-Angleich Paket 1).
 */

import { $ } from "./shared";
import { dateiMerken, dateienLesen, dateienSchreiben, type DateiArt, type LetzteDatei } from "../core/letzteDateien";
import { baueChatAnfrage, type ChatEintrag } from "../core/hilfeChat";
import { tekkKi } from "./tekkKi";

const KEY = "tekkforge.letzteDateien";

export interface StartDaten {
  patterns: number;
  samples: number;
  ramMb: number;
  midiBereit: boolean;
  firmware: string;
}

interface StartHooks {
  oeffne: (tab: string) => void;
  daten: () => StartDaten;
}

let hooks: StartHooks | null = null;

// Hilfe-Chat (Assistent) — Verlauf lebt fuer die Session
const chat: { verlauf: ChatEintrag[]; laeuft: boolean; fehler: string } = { verlauf: [], laeuft: false, fehler: "" };

function lesen(): LetzteDatei[] {
  try {
    return dateienLesen(localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

/** Von Editor/Converter/Generator aufgerufen, wenn eine Datei geladen/gespeichert wurde. */
export function merkeLetzteDatei(name: string, art: DateiArt, pfad?: string): void {
  try {
    const liste = dateiMerken(lesen(), { name, art, wann: Date.now(), ...(pfad ? { pfad } : {}) });
    localStorage.setItem(KEY, dateienSchreiben(liste));
  } catch {
    // ohne Speicher keine Historie — kein Grund, den Ladevorgang zu stoeren
  }
  if (!$("viewStart").classList.contains("hidden")) render();
}

const ART_LABEL: Record<DateiArt, string> = {
  all: ".all", esx: "ESX", projekt: "Projekt", e2spat: "Pattern", lied: "Lied", midi: "MIDI",
};

function wannText(wann: number): string {
  const d = new Date(wann);
  return `${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function render(): void {
  if (!hooks) return;
  const d = hooks.daten();
  const letzte = lesen();
  const host = $("viewStart");
  host.innerHTML = `
    <div class="startHero card">
      <div class="startHeroText">
        <div class="startTag">WORKSPACE</div>
        <h2>Willkommen zurück</h2>
        <p class="sub" style="margin:4px 0 12px">Dein Hub für Patterns, Samples, Generator und das Gerät — alles lokal.</p>
        <div class="startPills">
          <span class="pill ${d.midiBereit ? "pillOk" : ""}">● ${d.midiBereit ? "MIDI verbunden" : "MIDI aus"}</span>
          <span class="pill">${escapeHtml(d.firmware)}</span>
          <span class="pill">${d.patterns} Pattern(s)</span>
        </div>
      </div>
      <div class="startHeroLogo">TF</div>
    </div>
    <div class="startKacheln">
      <div class="kachel"><b>${d.patterns}</b><span>Patterns im Projekt</span></div>
      <div class="kachel"><b>${d.samples}</b><span>Samples im Pool</span></div>
      <div class="kachel"><b>${d.ramMb.toFixed(1)} <small>MB</small></b><span>Sample-RAM (~24 MB)</span></div>
      <div class="kachel ${d.midiBereit ? "kachelOk" : ""}"><b>${d.midiBereit ? "BEREIT" : "AUS"}</b><span>MIDI / Gerät</span></div>
    </div>
    <div class="startCols">
      <div class="card">
        <h2>Schnellzugriff</h2>
        <div class="startSchnell">
          <button class="ghost" data-ziel="editor">✎ Pattern-Editor<small>Patterns bauen und aufs Gerät senden</small></button>
          <button class="ghost" data-ziel="generator">✦ Generator<small>Bank + Patterns aus Samples oder einem Lied</small></button>
          <button class="ghost" data-ziel="converter">⇄ ESX-Converter<small>ESX-1-Backups zu E2S wandeln</small></button>
          <button class="ghost" data-ziel="paddeck">▤ Pad-Deck<small>Slots live triggern und mischen</small></button>
        </div>
      </div>
      <div class="card">
        <h2>Letzte Dateien</h2>
        ${
          letzte.length
            ? `<div class="startListe">${letzte
                .map(
                  (e) =>
                    `<div><span class="rolle">${ART_LABEL[e.art] ?? e.art}</span><span style="flex:1" title="${escapeHtml(e.pfad ?? "")}">${escapeHtml(e.name)}</span><span class="startWann">${wannText(e.wann)}</span></div>`,
                )
                .join("")}</div>`
            : `<p class="sub">Noch keine Dateien — geladene Projekte, Banks und Lieder erscheinen hier.</p>`
        }
      </div>
      <div class="card">
        <h2>Assistent</h2>
        ${
          tekkKi()
            ? `
        <div id="stChatVerlauf" style="max-height:220px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;margin-bottom:8px">
          ${
            chat.verlauf.length
              ? chat.verlauf
                  .map(
                    (e) =>
                      `<div class="sub" style="margin:0;white-space:pre-wrap;${e.rolle === "nutzer" ? "opacity:.85" : "border-left:2px solid var(--accent);padding-left:8px"}"><b>${e.rolle === "nutzer" ? "Du" : "KI"}:</b> ${escapeHtml(e.text)}</div>`,
                  )
                  .join("")
              : `<p class="sub" style="margin:0">Fragen zu TekkForge oder zur Electribe — z. B. „Wie kommt eine Bank aufs Gerät?"</p>`
          }
        </div>
        <div class="zeileEinst">
          <input id="stChatFrage" type="text" placeholder="${chat.laeuft ? "Antwort kommt …" : "Frage stellen …"}" ${chat.laeuft ? "disabled" : ""} style="flex:1" />
          <button id="stChatLos" class="ghost" ${chat.laeuft ? "disabled" : ""}>Fragen</button>
        </div>
        ${chat.fehler ? `<p class="warn" style="margin:6px 0 0">${escapeHtml(chat.fehler)}</p>` : ""}`
            : `<p class="sub" style="margin:0">Nur in der Desktop-App — der Assistent nutzt den API-Key aus den Einstellungen.</p>`
        }
      </div>
      <div class="card">
        <h2>Gerät &amp; Kompatibilität</h2>
        <div class="startGeraet">
          <div class="geraetIcon">🎛</div>
          <div style="flex:1">
            <b>Electribe 2 Sampler</b>
            <div class="sub" style="margin:0">44,1 kHz · .e2spat / .e2sallpat / .all · ${escapeHtml(d.firmware)}</div>
          </div>
          <span class="pill ${d.midiBereit ? "pillOk" : ""}">${d.midiBereit ? "VERBUNDEN" : "GETRENNT"}</span>
        </div>
        <p class="sub" style="margin-bottom:0">MIDI aktivieren und Gerät suchen: im Pattern-Editor unter „MIDI".</p>
      </div>
    </div>`;
  for (const b of host.querySelectorAll<HTMLButtonElement>("[data-ziel]")) {
    b.addEventListener("click", () => hooks?.oeffne(b.dataset.ziel!));
  }
  const frage = document.getElementById("stChatFrage") as HTMLInputElement | null;
  const los = document.getElementById("stChatLos");
  if (frage && los) {
    const senden = (): void => {
      if (frage.value.trim()) void chatFragen(frage.value.trim());
    };
    los.addEventListener("click", senden);
    frage.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") senden();
    });
  }
  const verlaufEl = document.getElementById("stChatVerlauf");
  if (verlaufEl) verlaufEl.scrollTop = verlaufEl.scrollHeight;
}

async function chatFragen(text: string): Promise<void> {
  const ki = tekkKi();
  if (!ki || chat.laeuft) return;
  chat.verlauf.push({ rolle: "nutzer", text });
  chat.laeuft = true;
  chat.fehler = "";
  render();
  try {
    const anfrage = baueChatAnfrage(chat.verlauf);
    const res = await ki.chat({ system: anfrage.system, messages: anfrage.messages });
    chat.verlauf.push({ rolle: "ki", text: res.text.trim() });
  } catch (e) {
    const meldung = e instanceof Error ? e.message : String(e);
    chat.fehler = /API-Key/.test(meldung) ? `${meldung} — Key unter Einstellungen → KI eintragen.` : meldung;
  } finally {
    chat.laeuft = false;
  }
  render();
}

export function initStart(h: StartHooks): void {
  hooks = h;
  render();
}

export function startWirdSichtbar(): void {
  render();
}

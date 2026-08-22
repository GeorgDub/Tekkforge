/**
 * paddeck.ts — Tab „Pad-Deck": frei konfigurierbares Pad-Raster, jedes Pad
 * führt eine Aktionsliste aus (Modell: core/padDeck.ts). Ausführung über die
 * panelBridge des Editors (eine MidiIO — der KORG-Port ist Single-Client)
 * und die Panel-Funktionen (Patternwechsel, Transport, Mutes).
 *
 * Bedienung:
 *   - Klick = ausführen; Bearbeiten-Modus: Klick = Pad konfigurieren
 *   - Tastatur: Pad-Taste (Standard 1–0, q–p, a–l, y–m), nur wenn der Tab offen
 *     ist und kein Eingabefeld den Fokus hat
 *   - MIDI-Learn: „Lernen" drücken, dann Taste/Pad am Controller → Note/CC
 *   - Quantisierung „Takt": wartet bis zum nächsten Taktanfang (Basis: Start
 *     des Panel-Transports und Pattern-Tempo; ohne laufenden Transport sofort)
 *   - Deck liegt im Projekt (.tekkforge); JSON-Export/-Import für den Austausch
 */

import { panelBridge } from "./editor";
import { $, download, escapeHtml } from "./shared";
import { requestSysex } from "./midi";
import {
  aktuellesPanelPattern,
  registriereEmpfaenger,
  setzeMutes,
  transportInfo,
  transportStart,
  transportStop,
  wechslePattern,
} from "./panel";
import {
  PAD_FARBEN,
  beispielDeck,
  beschreibeAktion,
  deckGroesseAendern,
  deserialisiereDeck,
  morphDauerMs,
  morphWerte,
  msBisNaechsterTakt,
  neuesDeck,
  neuesPad,
  serialisiereDeck,
  standardTaste,
  wendeAenderungenAn,
  type Pad,
  type PadAktion,
  type PadDeck,
  type PartAenderung,
} from "../core/padDeck";
import { buildMfxCc, buildPanic, buildSchalterCc } from "../core/e2Remote";
import { buildKnobCc, KNOB_CCS } from "../core/e2KnobCc";
import { buildCurrentPatternDump, buildPatternRequest, decodeDump } from "../core/e2sysex";
import { buildPatternFile, editorPatternFromBody, type EditorPattern } from "../core/editorModel";

let deck: PadDeck;
let bearbeiten = false;
let gewaehlt: number | null = null;
let lernePad: number | null = null;
let tabOffen: () => boolean = () => false;
const laufendeMorphs = new Map<number, { abbrechen: () => void }>();

const CC_KEYS = [...[...KNOB_CCS.values()].map((k) => k.key), "ifxOn", "mfxSend", "mfxX", "mfxY", "mfxOn"];
const PARAM_KEYS = ["cutoff", "resonance", "egInt", "oscPitch", "oscGlide", "oscEdit", "modDepth", "modSpeed", "egAttack", "egDecay", "ifxEdit", "ifxOn", "ifxType", "mfxSend", "ampEgOn", "filterType", "volume", "pan", "muted"];

const CSS = `
#viewPadDeck { display: flex; flex-direction: column; gap: 10px; }
.pd-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.pd-toolbar .aktiv { outline: 2px solid var(--accent); }
.pd-seiten button.aktiv { background: var(--accent); color: #111; }
.pd-wrap { display: grid; grid-template-columns: 1fr 340px; gap: 12px; align-items: start; }
.pd-grid { display: grid; gap: 8px; }
.pd-pad { position: relative; min-height: 78px; border-radius: 10px; border: 2px solid #2a2a2e; background: #1b1b1f; color: #eee;
  font-weight: 600; font-size: 13px; cursor: pointer; display: flex; align-items: center; justify-content: center; text-align: center; padding: 6px; overflow: hidden; user-select: none; }
.pd-pad.leer { color: #555; font-weight: 400; border-style: dashed; }
.pd-pad.sel { outline: 3px solid #fff; }
.pd-pad.aktivPattern { box-shadow: 0 0 0 3px var(--accent) inset; }
.pd-pad small { position: absolute; left: 6px; top: 4px; font-size: 10px; color: #bbb; font-weight: 400; }
.pd-pad .midi { position: absolute; right: 6px; top: 4px; font-size: 10px; color: #9ad; }
.pd-pad .balken { position: absolute; left: 0; bottom: 0; height: 4px; background: #fff; width: 0; }
.pd-pad:active { transform: scale(.97); }
.pd-edit { background: var(--panel, #17171a); border: 1px solid var(--border, #2a2a2e); border-radius: 10px; padding: 10px; font-size: 12px; }
.pd-edit h4 { margin: 0 0 8px; color: var(--accent2); }
.pd-edit label { display: block; color: var(--muted); font-size: 10px; margin-top: 6px; }
.pd-edit input, .pd-edit select { width: 100%; box-sizing: border-box; }
.pd-aktion { border: 1px solid #2a2a2e; border-radius: 6px; padding: 6px; margin-top: 6px; background: #141416; }
.pd-aktion .kopf { display: flex; justify-content: space-between; align-items: center; gap: 6px; }
.pd-aktion .felder { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 8px; }
.pd-status { color: var(--muted); font-size: 11px; min-height: 16px; }
.pd-farben { display: flex; gap: 4px; margin-top: 4px; }
.pd-farben span { width: 18px; height: 18px; border-radius: 4px; cursor: pointer; border: 2px solid transparent; }
.pd-farben span.aktiv { border-color: #fff; }
`;

function setStatus(t: string): void {
  const el = document.getElementById("pdStatus");
  if (el) el.textContent = t;
}

function holeDeck(): PadDeck {
  const projekt = panelBridge.project;
  if (!projekt.padDeck) {
    projekt.padDeck = beispielDeck(projekt.patterns.length, projekt.patterns.length >= 240 ? 30 : Math.max(1, Math.ceil(projekt.patterns.length / 16)));
  }
  return projekt.padDeck;
}

function speichere(): void {
  panelBridge.project.padDeck = deck;
  panelBridge.markDirty();
}

function patternName(idx: number): string | undefined {
  return panelBridge.project.patterns[idx]?.name;
}

// ─── Ausführung ──────────────────────────────────────────────────────────────

async function holePatternVomGeraet(idx: number): Promise<EditorPattern> {
  let letzterFehler: unknown = null;
  for (let versuch = 0; versuch < 3; versuch++) {
    try {
      const reply = await requestSysex(
        panelBridge.midi,
        buildPatternRequest(idx, panelBridge.midiOpts()),
        (b) => decodeDump(b)?.index === idx,
        4000,
      );
      return editorPatternFromBody(decodeDump(reply)!.body);
    } catch (e) {
      letzterFehler = e;
    }
  }
  const lokal = panelBridge.project.patterns[idx];
  if (lokal) return lokal;
  throw letzterFehler instanceof Error ? letzterFehler : new Error(String(letzterFehler));
}

function sendeCc(part: number | "global", key: string, wert: number): boolean {
  const ch = part === "global" ? panelBridge.midiChannel : part;
  let msg: Uint8Array | null = null;
  if (key === "mfxX") msg = buildMfxCc(ch, "x", wert);
  else if (key === "mfxY") msg = buildMfxCc(ch, "y", wert);
  else if (key === "mfxOn") msg = buildMfxCc(ch, "on", wert);
  else if (key === "ifxOn" || key === "mfxSend") msg = buildSchalterCc(ch, key, wert >= 64);
  else msg = buildKnobCc(ch, key, wert);
  if (!msg) return false;
  panelBridge.midi.send(msg);
  return true;
}

function aktuellerWert(part: number, key: string): number {
  const p = aktuellesPanelPattern().parts[part];
  if (!p) return 0;
  if (key === "volume") return p.volume;
  if (key === "pan") return p.pan;
  return p.params?.[key] ?? 64;
}

function starteMorph(padIdx: number, a: Extract<PadAktion, { art: "morph" }>, fortschritt: (anteil: number) => void): Promise<void> {
  laufendeMorphs.get(padIdx)?.abbrechen();
  const bpm = transportInfo().bpm;
  const dauer = morphDauerMs(a.dauer, a.einheit, bpm);
  const schritte = Math.max(2, Math.round(dauer / 60));
  const reihen = a.ziele.map((z) => ({ z, werte: morphWerte(aktuellerWert(z.part, z.key), z.nach, schritte) }));
  return new Promise((resolve) => {
    let i = 0;
    const timer = window.setInterval(() => {
      for (const { z, werte } of reihen) {
        const w = werte[i];
        sendeCc(z.part, z.key, w);
        const part = aktuellesPanelPattern().parts[z.part];
        if (part) {
          if (z.key === "volume") part.volume = w;
          else if (z.key === "pan") part.pan = w;
          else part.params = { ...(part.params ?? {}), [z.key]: w };
        }
      }
      i++;
      fortschritt(i / schritte);
      if (i >= schritte) {
        window.clearInterval(timer);
        laufendeMorphs.delete(padIdx);
        resolve();
      }
    }, dauer / schritte);
    laufendeMorphs.set(padIdx, {
      abbrechen: () => {
        window.clearInterval(timer);
        laufendeMorphs.delete(padIdx);
        resolve();
      },
    });
  });
}

async function fuehreAktionAus(padIdx: number, a: PadAktion, fortschritt: (anteil: number) => void): Promise<string> {
  switch (a.art) {
    case "pattern":
      wechslePattern(a.idx);
      return `→ Pattern ${a.idx + 1}`;
    case "patternKopie": {
      const basis = await holePatternVomGeraet(a.idx);
      const kopie = wendeAenderungenAn(basis, a.aenderungen, a.bpm);
      const body = new Uint8Array(buildPatternFile(kopie).slice(0x100));
      await panelBridge.midi.sendAsync(buildCurrentPatternDump(body, panelBridge.midiOpts()));
      return `Kopie von Pattern ${a.idx + 1} „${basis.name}" mit ${a.aenderungen.length} Änderung(en) in den Edit-Buffer`;
    }
    case "cc":
      return sendeCc(a.part, a.key, a.wert) ? `CC ${a.key}=${a.wert}` : `kein CC für ${a.key}`;
    case "mutes":
      setzeMutes(a.parts, a.muted);
      return `Parts ${a.parts.map((p) => p + 1).join(",")} ${a.muted ? "stumm" : "an"}`;
    case "transport":
      if (a.was === "play") await transportStart(true);
      else if (a.was === "stop") await transportStop();
      else for (const m of buildPanic()) panelBridge.midi.send(m);
      return a.was;
    case "morph":
      await starteMorph(padIdx, a, fortschritt);
      return `Morph fertig (${a.ziele.length} Ziel(e))`;
  }
}

async function fuehrePadAus(padIdx: number): Promise<void> {
  const pad = deck.seiten[deck.aktiveSeite].pads[padIdx];
  if (!pad) return;
  const el = document.querySelector<HTMLElement>(`#pdGrid .pd-pad[data-pad="${padIdx}"]`);
  const balken = el?.querySelector<HTMLElement>(".balken");
  const fortschritt = (anteil: number) => {
    if (balken) balken.style.width = `${Math.round(anteil * 100)}%`;
  };
  try {
    const t = transportInfo();
    if (pad.quantisierung === "takt" && t.spielt && t.startMs !== null) {
      const warte = msBisNaechsterTakt(performance.now() - t.startMs, t.bpm);
      if (warte > 5) {
        setStatus(`„${pad.label || `Pad ${padIdx + 1}`}" wartet auf den nächsten Takt (${Math.round(warte)} ms) …`);
        await new Promise((r) => setTimeout(r, warte));
      }
    }
    el?.classList.add("sel");
    const meldungen: string[] = [];
    for (const a of pad.aktionen) meldungen.push(await fuehreAktionAus(padIdx, a, fortschritt));
    setStatus(`${pad.label || `Pad ${padIdx + 1}`}: ${meldungen.join(" · ") || "keine Aktionen"}`);
  } catch (err) {
    setStatus(`${pad.label || `Pad ${padIdx + 1}`} fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
  } finally {
    if (!bearbeiten) el?.classList.remove("sel");
    fortschritt(0);
    renderGrid();
  }
}

// ─── Rendern ─────────────────────────────────────────────────────────────────

function renderGrid(): void {
  const grid = $("pdGrid");
  grid.style.gridTemplateColumns = `repeat(${deck.cols}, 1fr)`;
  const seite = deck.seiten[deck.aktiveSeite];
  const aktivIdx = panelBridge.patternIndex;
  grid.innerHTML = seite.pads
    .map((pad, i) => {
      if (!pad) return `<div class="pd-pad leer" data-pad="${i}"><small>${standardTaste(i) ?? ""}</small>${bearbeiten ? "+" : ""}</div>`;
      const erste = pad.aktionen[0];
      const aktivPattern = erste?.art === "pattern" && erste.idx === aktivIdx;
      const titel = pad.aktionen.map((a) => beschreibeAktion(a, patternName)).join("\n") || "keine Aktionen";
      return `<div class="pd-pad${gewaehlt === i && bearbeiten ? " sel" : ""}${aktivPattern ? " aktivPattern" : ""}" data-pad="${i}" style="border-color:${pad.farbe};background:${pad.farbe}22" title="${escapeHtml(titel)}">
        <small>${escapeHtml(pad.taste ?? "")}${pad.quantisierung === "takt" ? " ⏱" : ""}</small>
        ${pad.midi ? `<span class="midi">${pad.midi.art === "note" ? "♪" : "CC"}${pad.midi.nummer}</span>` : ""}
        <span>${escapeHtml(pad.label || `Pad ${i + 1}`)}</span>
        <div class="balken"></div>
      </div>`;
    })
    .join("");
  document.querySelectorAll<HTMLElement>("#pdSeiten button").forEach((b, i) => b.classList.toggle("aktiv", i === deck.aktiveSeite));
  $("pdBearbeiten").classList.toggle("aktiv", bearbeiten);
  ($("pdCols") as HTMLSelectElement).value = String(deck.cols);
  ($("pdRows") as HTMLSelectElement).value = String(deck.rows);
  renderEditor();
}

function aktionsFelder(a: PadAktion, i: number): string {
  const n = (name: string, wert: number | string, extra = "") => `<label>${name}<input data-i="${i}" data-f="${name}" value="${escapeHtml(String(wert))}" ${extra}></label>`;
  const sel = (name: string, wert: string, opts: string[]) =>
    `<label>${name}<select data-i="${i}" data-f="${name}">${opts.map((o) => `<option value="${o}"${o === wert ? " selected" : ""}>${o}</option>`).join("")}</select></label>`;
  switch (a.art) {
    case "pattern":
      return n("idx", a.idx + 1, 'type="number" min="1" max="250"');
    case "patternKopie":
      return (
        n("idx", a.idx + 1, 'type="number" min="1" max="250"') +
        n("bpm", a.bpm ?? "", 'type="number" min="20" max="300" placeholder="wie Original"') +
        `<label style="grid-column:1/3">Änderungen (je Zeile: Part|alle key wert)<textarea data-i="${i}" data-f="aenderungen" rows="3" style="width:100%;font-family:monospace;font-size:11px">${escapeHtml(a.aenderungen.map((x) => `${x.part === "alle" ? "alle" : x.part + 1} ${x.key} ${x.wert}`).join("\n"))}</textarea></label>` +
        `<div style="grid-column:1/3;color:var(--muted);font-size:10px">Keys: ${PARAM_KEYS.join(", ")}</div>`
      );
    case "cc":
      return sel("part", a.part === "global" ? "global" : String(a.part + 1), ["global", ...Array.from({ length: 16 }, (_, k) => String(k + 1))]) + sel("key", a.key, CC_KEYS) + n("wert", a.wert, 'type="number" min="0" max="127"');
    case "mutes":
      return n("parts", a.parts.map((p) => p + 1).join(","), 'placeholder="1,2,3"') + sel("muted", a.muted ? "stumm" : "an", ["stumm", "an"]);
    case "transport":
      return sel("was", a.was, ["play", "stop", "panic"]);
    case "morph":
      return (
        `<label style="grid-column:1/3">Ziele (je Zeile: Part key zielwert)<textarea data-i="${i}" data-f="ziele" rows="3" style="width:100%;font-family:monospace;font-size:11px">${escapeHtml(a.ziele.map((z) => `${z.part + 1} ${z.key} ${z.nach}`).join("\n"))}</textarea></label>` +
        n("dauer", a.dauer, 'type="number" min="0.1" step="0.5"') +
        sel("einheit", a.einheit, ["takte", "sekunden"])
      );
  }
}

function renderEditor(): void {
  const host = $("pdEdit");
  if (!bearbeiten || gewaehlt === null) {
    host.innerHTML = `<h4>Pad-Deck</h4><div class="pd-status">Klick führt ein Pad aus. „Bearbeiten" einschalten und ein Pad anklicken, um es zu belegen.<br><br>
      Tastatur: Pad-Taste (oben links im Pad). MIDI-Learn: im Bearbeiten-Modus „Lernen" drücken, dann am Controller spielen.<br><br>
      ⏱ = Pad wartet auf den nächsten Taktanfang (nur bei laufendem Panel-Transport).</div>`;
    return;
  }
  const pad = deck.seiten[deck.aktiveSeite].pads[gewaehlt];
  if (!pad) {
    host.innerHTML = `<h4>Pad ${gewaehlt + 1} (leer)</h4><button id="pdPadAnlegen" class="primary">Pad anlegen</button>`;
    $("pdPadAnlegen").addEventListener("click", () => {
      deck.seiten[deck.aktiveSeite].pads[gewaehlt!] = { ...neuesPad(`Pad ${gewaehlt! + 1}`, PAD_FARBEN[gewaehlt! % PAD_FARBEN.length]), taste: standardTaste(gewaehlt!) };
      speichere();
      renderGrid();
    });
    return;
  }
  host.innerHTML = `
    <h4>Pad ${gewaehlt + 1} bearbeiten</h4>
    <label>Label<input id="pdLabel" value="${escapeHtml(pad.label)}" maxlength="24"></label>
    <label>Farbe</label><div class="pd-farben">${PAD_FARBEN.map((f) => `<span data-farbe="${f}" class="${f === pad.farbe ? "aktiv" : ""}" style="background:${f}"></span>`).join("")}</div>
    <label>Taste (1 Zeichen)<input id="pdTaste" value="${escapeHtml(pad.taste ?? "")}" maxlength="1"></label>
    <label>Quantisierung<select id="pdQuant"><option value="sofort"${pad.quantisierung === "sofort" ? " selected" : ""}>sofort</option><option value="takt"${pad.quantisierung === "takt" ? " selected" : ""}>nächster Takt</option></select></label>
    <label>MIDI-Trigger: ${pad.midi ? `${pad.midi.art === "note" ? "Note" : "CC"} ${pad.midi.nummer} Kanal ${pad.midi.kanal + 1}` : "—"}</label>
    <div style="display:flex;gap:4px"><button id="pdLernen" class="ghost">${lernePad === gewaehlt ? "… warte auf MIDI" : "Lernen"}</button><button id="pdLernenWeg" class="ghost">Entfernen</button></div>
    <label>Aktionen</label>
    <div id="pdAktionen">${pad.aktionen.map((a, i) => `<div class="pd-aktion"><div class="kopf"><b>${i + 1}. ${a.art}</b><span><button class="ghost" data-hoch="${i}" title="nach oben">▲</button><button class="ghost" data-weg="${i}" title="entfernen">✕</button></span></div><div class="felder">${aktionsFelder(a, i)}</div></div>`).join("")}</div>
    <div style="display:flex;gap:4px;margin-top:6px"><select id="pdNeuArt"><option value="pattern">Pattern wechseln</option><option value="patternKopie">Pattern-Kopie mit Änderungen</option><option value="cc">Regler-CC</option><option value="mutes">Mutes</option><option value="transport">Transport</option><option value="morph">Morph</option></select><button id="pdNeu" class="ghost">+ Aktion</button></div>
    <div style="display:flex;gap:4px;margin-top:10px"><button id="pdTest" class="primary">▶ Testen</button><button id="pdLoeschen" class="ghost">Pad löschen</button></div>`;

  const aktualisiere = () => {
    speichere();
    renderGrid();
  };
  $("pdLabel").addEventListener("input", (e) => { pad.label = (e.target as HTMLInputElement).value; speichere(); renderGridNurPads(); });
  host.querySelectorAll<HTMLElement>(".pd-farben span").forEach((s) => s.addEventListener("click", () => { pad.farbe = s.dataset.farbe!; aktualisiere(); }));
  $("pdTaste").addEventListener("input", (e) => { const v = (e.target as HTMLInputElement).value.toLowerCase(); pad.taste = v || undefined; speichere(); renderGridNurPads(); });
  $("pdQuant").addEventListener("change", (e) => { pad.quantisierung = (e.target as HTMLSelectElement).value === "takt" ? "takt" : "sofort"; aktualisiere(); });
  $("pdLernen").addEventListener("click", () => { lernePad = lernePad === gewaehlt ? null : gewaehlt; setStatus(lernePad !== null ? "MIDI-Learn: jetzt Taste/Pad am Controller drücken …" : "MIDI-Learn abgebrochen."); renderEditor(); });
  $("pdLernenWeg").addEventListener("click", () => { delete pad.midi; aktualisiere(); });
  $("pdNeu").addEventListener("click", () => {
    const art = ($("pdNeuArt") as HTMLSelectElement).value as PadAktion["art"];
    const neu: Record<PadAktion["art"], PadAktion> = {
      pattern: { art: "pattern", idx: panelBridge.patternIndex },
      patternKopie: { art: "patternKopie", idx: panelBridge.patternIndex, aenderungen: [{ part: "alle", key: "cutoff", wert: 64 }] },
      cc: { art: "cc", part: 0, key: "cutoff", wert: 64 },
      mutes: { art: "mutes", parts: [0], muted: true },
      transport: { art: "transport", was: "play" },
      morph: { art: "morph", ziele: [{ part: 0, key: "cutoff", nach: 127 }], dauer: 4, einheit: "takte" },
    };
    pad.aktionen.push(neu[art]);
    aktualisiere();
  });
  host.querySelectorAll<HTMLButtonElement>("[data-weg]").forEach((b) => b.addEventListener("click", () => { pad.aktionen.splice(Number(b.dataset.weg), 1); aktualisiere(); }));
  host.querySelectorAll<HTMLButtonElement>("[data-hoch]").forEach((b) => b.addEventListener("click", () => {
    const i = Number(b.dataset.hoch);
    if (i > 0) { [pad.aktionen[i - 1], pad.aktionen[i]] = [pad.aktionen[i], pad.aktionen[i - 1]]; aktualisiere(); }
  }));
  host.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("[data-i]").forEach((inp) =>
    inp.addEventListener("change", () => {
      const a = pad.aktionen[Number(inp.dataset.i)];
      const f = inp.dataset.f!;
      const v = inp.value;
      const zahl = Number(v);
      if (a.art === "pattern" && f === "idx") a.idx = Math.max(0, Math.min(249, Math.round(zahl) - 1));
      else if (a.art === "patternKopie") {
        if (f === "idx") a.idx = Math.max(0, Math.min(249, Math.round(zahl) - 1));
        else if (f === "bpm") { if (v.trim() === "" || !Number.isFinite(zahl)) delete a.bpm; else a.bpm = zahl; }
        else if (f === "aenderungen") a.aenderungen = parseAenderungen(v);
      } else if (a.art === "cc") {
        if (f === "part") a.part = v === "global" ? "global" : Math.max(0, Math.min(15, zahl - 1));
        else if (f === "key") a.key = v;
        else if (f === "wert") a.wert = Math.max(0, Math.min(127, Math.round(zahl) || 0));
      } else if (a.art === "mutes") {
        if (f === "parts") a.parts = v.split(/[,\s]+/).map((s) => Number(s) - 1).filter((n) => n >= 0 && n <= 15);
        else if (f === "muted") a.muted = v === "stumm";
      } else if (a.art === "transport" && f === "was") a.was = v as "play" | "stop" | "panic";
      else if (a.art === "morph") {
        if (f === "ziele") a.ziele = parseAenderungen(v).filter((x) => x.part !== "alle").map((x) => ({ part: x.part as number, key: x.key, nach: x.wert }));
        else if (f === "dauer") a.dauer = Math.max(0.1, zahl || 1);
        else if (f === "einheit") a.einheit = v === "sekunden" ? "sekunden" : "takte";
      }
      speichere();
      renderGridNurPads();
    }),
  );
  $("pdTest").addEventListener("click", () => void fuehrePadAus(gewaehlt!));
  $("pdLoeschen").addEventListener("click", () => { deck.seiten[deck.aktiveSeite].pads[gewaehlt!] = null; aktualisiere(); });
}

/** „Part key wert" je Zeile; Part 1–16 oder „alle". */
function parseAenderungen(text: string): PartAenderung[] {
  const out: PartAenderung[] = [];
  for (const zeile of text.split(/\r?\n/)) {
    const t = zeile.trim().split(/\s+/);
    if (t.length < 3) continue;
    const part = t[0].toLowerCase() === "alle" ? "alle" : Math.max(0, Math.min(15, Number(t[0]) - 1));
    const wert = Number(t[2]);
    if (!Number.isFinite(wert) || (part !== "alle" && !Number.isFinite(part))) continue;
    out.push({ part, key: t[1], wert });
  }
  return out;
}

/** Grid neu zeichnen, ohne den Editor (Fokus in Eingabefeldern behalten). */
function renderGridNurPads(): void {
  const e = $("pdEdit").innerHTML;
  renderGrid();
  void e;
}

// ─── Aufbau ──────────────────────────────────────────────────────────────────

function baueDom(): void {
  const style = document.createElement("style");
  style.textContent = CSS;
  document.head.appendChild(style);
  const achsen = Array.from({ length: 8 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("");
  $("viewPadDeck").innerHTML = `
    <div class="pd-toolbar">
      <span class="pd-seiten" id="pdSeiten"></span>
      <span style="flex:1"></span>
      <label>Raster <select id="pdCols">${achsen}</select> × <select id="pdRows">${achsen}</select></label>
      <label title="Zweiter MIDI-Eingang nur fürs Pad-Deck (z. B. MIDImix) — Nachrichten gehen nicht in die Gerätelogik">Controller <select id="pdController"><option value="">— keiner —</option></select></label>
      <button id="pdBearbeiten" class="ghost">✎ Bearbeiten</button>
      <button id="pdBeispiel" class="ghost" title="Start-Deck aus den Projekt-Patterns (ersetzt das aktuelle Deck)">Beispiel-Deck</button>
      <button id="pdExport" class="ghost">⇩ JSON</button>
      <button id="pdImport" class="ghost">⇧ JSON</button>
      <input id="pdImportDatei" type="file" accept=".json,application/json" class="hidden">
    </div>
    <div class="pd-status" id="pdStatus">Pad-Deck — Klick führt aus.</div>
    <div class="pd-wrap">
      <div class="pd-grid" id="pdGrid"></div>
      <div class="pd-edit" id="pdEdit"></div>
    </div>`;
}

function renderSeiten(): void {
  $("pdSeiten").innerHTML = deck.seiten
    .map((s, i) => `<button class="ghost${i === deck.aktiveSeite ? " aktiv" : ""}" data-seite="${i}">${escapeHtml(s.name)}</button>`)
    .join("");
  $("pdSeiten").querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
    b.addEventListener("click", () => {
      deck.aktiveSeite = Number(b.dataset.seite);
      gewaehlt = null;
      speichere();
      renderSeiten();
      renderGrid();
    }),
  );
  $("pdSeiten").querySelectorAll<HTMLButtonElement>("button").forEach((b) =>
    b.addEventListener("dblclick", () => {
      const neu = prompt("Seitenname", deck.seiten[Number(b.dataset.seite)].name);
      if (neu) { deck.seiten[Number(b.dataset.seite)].name = neu.slice(0, 24); speichere(); renderSeiten(); }
    }),
  );
}

const CONTROLLER_KEY = "tekkforge.paddeck.controller";

/** Controller-Auswahl füllen (Ports sind erst nach „MIDI aktivieren" bekannt). */
function renderController(): void {
  const sel = $("pdController") as HTMLSelectElement;
  const midi = panelBridge.midi;
  const ports = midi.available ? midi.inputs() : [];
  const aktuell = midi.controllerInputId ?? "";
  sel.innerHTML =
    `<option value="">— keiner —</option>` +
    ports.map((p) => `<option value="${escapeHtml(p.id)}"${p.id === aktuell ? " selected" : ""}>${escapeHtml(p.name ?? p.label ?? p.id)}</option>`).join("");
  sel.disabled = !midi.controllerAvailable || ports.length === 0;
  sel.title = midi.controllerAvailable
    ? ports.length
      ? "Zweiter MIDI-Eingang nur fürs Pad-Deck"
      : `Erst im Editor-Tab „MIDI aktivieren"`
    : "Controller-Eingang braucht die aktuelle Desktop-App";
}

async function waehleController(id: string): Promise<void> {
  try {
    await panelBridge.midi.selectControllerInput(id || null);
    try {
      localStorage.setItem(CONTROLLER_KEY, id);
    } catch {
      /* egal */
    }
    const name = panelBridge.midi.inputs().find((p) => p.id === id)?.name;
    setStatus(id ? `Controller-Eingang: ${name ?? id} — Pads per MIDI-Learn belegen.` : "Controller-Eingang geschlossen.");
  } catch (err) {
    setStatus(`Controller-Eingang fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
  }
}

/** Gemerkten Controller wieder öffnen, sobald Ports bekannt sind (einmalig). */
let controllerWiederhergestellt = false;
function stelleControllerWiederHer(): void {
  if (controllerWiederhergestellt || !panelBridge.midi.available || !panelBridge.midi.inputs().length) return;
  controllerWiederhergestellt = true;
  let gemerkt = "";
  try {
    gemerkt = localStorage.getItem(CONTROLLER_KEY) ?? "";
  } catch {
    /* egal */
  }
  // Port-IDs sind Indizes und können wandern — nur öffnen, wenn es den Port noch gibt.
  if (gemerkt && panelBridge.midi.inputs().some((p) => p.id === gemerkt)) void waehleController(gemerkt).then(renderController);
}

export function padDeckWirdSichtbar(): void {
  deck = holeDeck();
  renderSeiten();
  renderGrid();
  stelleControllerWiederHer();
  renderController();
}

export function initPadDeck(istOffen: () => boolean): void {
  tabOffen = istOffen;
  baueDom();
  deck = holeDeck();
  renderSeiten();
  renderGrid();

  $("pdGrid").addEventListener("click", (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>(".pd-pad");
    if (!el) return;
    const i = Number(el.dataset.pad);
    if (bearbeiten) {
      gewaehlt = i;
      renderGrid();
    } else void fuehrePadAus(i);
  });
  $("pdBearbeiten").addEventListener("click", () => {
    bearbeiten = !bearbeiten;
    if (!bearbeiten) { gewaehlt = null; lernePad = null; }
    renderGrid();
  });
  const rasterAendern = () => {
    deck = deckGroesseAendern(deck, Number(($("pdCols") as HTMLSelectElement).value), Number(($("pdRows") as HTMLSelectElement).value));
    gewaehlt = null;
    speichere();
    renderGrid();
  };
  $("pdCols").addEventListener("change", rasterAendern);
  $("pdRows").addEventListener("change", rasterAendern);
  $("pdBeispiel").addEventListener("click", () => {
    if (!confirm("Aktuelles Deck durch das Beispiel-Deck ersetzen?")) return;
    const n = panelBridge.project.patterns.length;
    deck = beispielDeck(n, n >= 240 ? 30 : Math.max(1, Math.ceil(n / 16)));
    speichere();
    renderSeiten();
    renderGrid();
  });
  $("pdExport").addEventListener("click", () => download(serialisiereDeck(deck), "paddeck.json", "application/json"));
  $("pdImport").addEventListener("click", () => $("pdImportDatei").click());
  $("pdImportDatei").addEventListener("change", async (ev) => {
    const f = (ev.target as HTMLInputElement).files?.[0];
    if (!f) return;
    try {
      deck = deserialisiereDeck(await f.text());
      speichere();
      renderSeiten();
      renderGrid();
      setStatus(`Deck „${f.name}" geladen.`);
    } catch (err) {
      setStatus(`Import fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
    }
    (ev.target as HTMLInputElement).value = "";
  });

  // Tastatur: nur wenn der Tab offen ist und kein Eingabefeld den Fokus hat.
  document.addEventListener("keydown", (ev) => {
    if (!tabOffen() || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const ziel = ev.target as HTMLElement | null;
    if (ziel && (ziel.tagName === "INPUT" || ziel.tagName === "TEXTAREA" || ziel.tagName === "SELECT")) return;
    const taste = ev.key.toLowerCase();
    const i = deck.seiten[deck.aktiveSeite].pads.findIndex((p) => p?.taste === taste);
    if (i >= 0) {
      ev.preventDefault();
      void fuehrePadAus(i);
    }
  });

  $("pdController").addEventListener("change", (e) => void waehleController((e.target as HTMLSelectElement).value).then(renderController));

  // MIDI: Learn oder Trigger (aktive Seite) — vom Controller-Eingang UND vom Gerät.
  const verarbeiteTrigger = (bytes: number[]) => {
    const st = bytes[0] & 0xf0;
    const kanal = bytes[0] & 0x0f;
    const istNote = st === 0x90 && bytes.length >= 3 && bytes[2] > 0;
    const istCc = st === 0xb0 && bytes.length >= 3 && bytes[2] >= 64 && bytes[1] !== 0x20 && bytes[1] !== 0x00;
    if (!istNote && !istCc) return;
    if (lernePad !== null) {
      const pad = deck.seiten[deck.aktiveSeite].pads[lernePad];
      if (pad) {
        pad.midi = { art: istNote ? "note" : "cc", kanal, nummer: bytes[1] };
        speichere();
        setStatus(`Pad ${lernePad + 1} gelernt: ${istNote ? "Note" : "CC"} ${bytes[1]} Kanal ${kanal + 1}.`);
      }
      lernePad = null;
      renderGrid();
      return;
    }
    const i = deck.seiten[deck.aktiveSeite].pads.findIndex(
      (p) => p?.midi && p.midi.kanal === kanal && p.midi.nummer === bytes[1] && p.midi.art === (istNote ? "note" : "cc"),
    );
    if (i >= 0) void fuehrePadAus(i);
  };
  registriereEmpfaenger(verarbeiteTrigger);
  panelBridge.midi.onController = verarbeiteTrigger;
}

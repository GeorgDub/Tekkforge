/**
 * panel.ts — „E2S Panel": Hardware-Lookalike der KORG electribe sampler.
 *
 * Optik nach dem Gerätefoto (omnitribe-hwtest-kit/korg.png, rote ESX2):
 * Display links, Reglerreihen Sample/Filter/Modulation/Amp EG/Insert Fx,
 * LED-Buttons (LPF/HPF/BPF, MFX Send, Amp EG, IFX On), Transport, Modusreihe
 * und die 16 Pads in zwei Achterreihen. Beschriftungen wie am Gerät.
 *
 * Zwei Betriebsarten (Spec: docs/superpowers/specs/2026-08-15-e2s-panel-design.md):
 *
 * - LIVE: „Sync" holt den Edit-Buffer des Geräts (0x10-Dump — nur bei
 *   GESTOPPTEM Sequencer zuverlässig, am Gerät gemessen). Danach führt die
 *   UI; Pad-Klick im Part-Mute-Modus schaltet Mute — mit Hacktribe sofort
 *   per NRPN (am Gerät bestätigt 2026-08-15, siehe hacktribeNrpn.ts), mit
 *   Stock-Firmware über die automatische Edit-Buffer-Übertragung (~1 s).
 *   Welche Firmware gilt, entscheidet `panelBridge.firmware` (firmwareMode.ts).
 * - PREPARE: arbeitet auf dem aktuellen Editor-Pattern. Steps setzen im
 *   Sequencer-Pad-Modus, dann „Anhören" (Edit-Buffer, klingt sofort) oder
 *   „→ Slot" (dauerhaft, mit ACK-Prüfung über den Editor-Schreibpfad).
 *
 * MIDI läuft über die panelBridge des Editors — der KORG-Treiber ist
 * Single-Client, eine zweite MidiIO wäre ein stummer Portkonflikt.
 *
 * Stufe 2 (umgesetzt): gemessene Regler sind drehbar (CC, Kanal = Part),
 * Reglerdrehungen am Gerät laufen per CC-Empfang live mit, Auto-Sync nach
 * erkanntem Stopp. Steps sind per NRPN NICHT erreichbar (am Gerät widerlegt)
 * und gehen im Live-Modus über die automatische Edit-Buffer-Übertragung.
 */

import { panelBridge } from "./editor";
import { $ } from "./shared";
import {
  buildCurrentPatternDump,
  buildCurrentPatternRequest,
  decodeDump,
} from "../core/e2sysex";
import { requestSysex } from "./midi";
import { buildPanelControl } from "../core/hacktribeNrpn";
import { featureAvailable } from "../core/firmwareMode";
import {
  MIDI_START,
  MIDI_STOP,
  TRIGGER_NOTE,
  buildMfxCc,
  buildPanic,
  buildNoteOff,
  buildNoteOn,
  buildProgramChange,
  buildSchalterCc,
  filterTypeNachBandKlick,
  patternIndexFromProgram,
  keyboardNote,
  kippeSchalter,
  patternSetIndex,
  schritt,
} from "../core/e2Remote";
import {
  buildPatternFile,
  clonePattern,
  editorPatternFromBody,
  type EditorPattern,
} from "../core/editorModel";
import { displayInfo, partLeds, stepStates, taktAnzahl } from "../core/panelState";
import { buildKnobCc, ccValueToParam, decodeKnobCc } from "../core/e2KnobCc";

let modus: "live" | "prepare" = "prepare";
type PadModus = "mute" | "sequencer" | "erase" | "trigger" | "keyboard" | "patternset";
let padModus: PadModus = "mute";
const PAD_MODUS_BUTTON: Record<PadModus, string> = {
  mute: "e2sPadMute",
  sequencer: "e2sPadSeq",
  erase: "e2sPartErase",
  trigger: "e2sTrigger",
  keyboard: "e2sKeyboard",
  patternset: "e2sPatternSet",
};
let aktiverPart = 0;
let takt = 0;
/** Letzter Sync-Stand vom Gerät (nur Live-Modus). */
let livePattern: EditorPattern | null = null;

function aktuellesPattern(): EditorPattern {
  if (modus === "live" && livePattern) return livePattern;
  return panelBridge.project.patterns[panelBridge.patternIndex];
}

function setStatus(text: string): void {
  $("e2sStatus").textContent = text;
}

// ─── Aufbau ──────────────────────────────────────────────────────────────────

/** Ein Regler: Kappe mit Zeiger + Label darunter; groß oder klein. */
function knob(id: string, label: string, gross = false): string {
  return `<div class="e2s-knobwrap"><div class="e2s-knob${gross ? " gross" : ""}" id="${id}"><div class="e2s-zeiger"></div></div><span>${label}</span></div>`;
}

function ledButton(id: string, label: string): string {
  return `<button class="e2s-ledbtn" id="${id}">${label}</button>`;
}

function modeButton(id: string, label: string): string {
  return `<button class="e2s-modebtn" id="${id}">${label}</button>`;
}

const PANEL_CSS = `
#viewPanel { display: flex; flex-direction: column; gap: 12px; }
.e2s-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
.e2s-goto { display: inline-flex; gap: 4px; align-items: center; margin-left: 8px; padding-left: 8px; border-left: 1px solid var(--line); }
.e2s-toolbar .aktiv { outline: 2px solid var(--accent); }
.e2s { background: linear-gradient(175deg, #b8505a 0%, #a94550 55%, #933a44 100%);
  border: 3px solid #7e2f38; border-radius: 22px; padding: 18px 22px 22px;
  color: #f6ece6; font-family: "Segoe UI", sans-serif; user-select: none;
  max-width: 1120px; box-shadow: 0 12px 40px rgba(0,0,0,.5); }
.e2s-top { display: flex; align-items: center; gap: 14px; margin-bottom: 8px; }
.e2s-power { width: 14px; height: 14px; border-radius: 50%; background: #1c1416; box-shadow: inset 0 0 4px #000; }
.e2s-logo { margin-left: auto; text-align: right; line-height: 1.05; }
.e2s-logo b { font-size: 20px; letter-spacing: .5px; }
.e2s-logo small { display: block; font-size: 8px; letter-spacing: 2px; opacity: .85; }
.e2s-logo .korg { font-weight: 900; font-size: 22px; margin-left: 10px; }
.e2s-haupt { display: grid; grid-template-columns: 250px 1fr; gap: 18px; }
.e2s-lcdwrap { background: #822f38; border-radius: 10px; padding: 10px; }
.e2s-lcd { background: #cdd7e6; color: #1b2735; border-radius: 4px; padding: 8px 10px;
  font-family: Consolas, monospace; min-height: 86px; box-shadow: inset 0 2px 8px rgba(0,0,0,.4); }
.e2s-lcd .bpm { text-align: right; font-size: 13px; }
.e2s-lcd .patnr { font-size: 12px; }
.e2s-lcd .patname { font-size: 19px; font-weight: 700; letter-spacing: 1px; }
.e2s-lcd .partzeile { border-top: 1px solid #8fa0b5; margin-top: 6px; padding-top: 3px; font-size: 12px; }
.e2s-transport { display: flex; gap: 8px; margin-top: 10px; }
.e2s-transport button { width: 44px; height: 34px; border-radius: 7px; border: 1px solid #2a2024;
  background: #221a1d; color: #eee; font-size: 14px; cursor: default; }
.e2s-transport .play { background: #2b3fd8; box-shadow: 0 0 10px #2b3fd8; }
.e2s-navrow { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.e2s-xy { margin-top: 12px; height: 130px; background: radial-gradient(circle at 35% 30%, #232326, #151517);
  border-radius: 10px; box-shadow: inset 0 3px 12px rgba(0,0,0,.6); }
.e2s-sektionen { display: grid; grid-template-columns: 64px repeat(5, 1fr); gap: 8px; align-items: start; }
.e2s-sektion { text-align: center; }
.e2s-sektion h4 { margin: 0 0 4px; font-size: 15px; font-weight: 600; }
.e2s-reihe { display: flex; gap: 10px; justify-content: center; align-items: flex-end; flex-wrap: wrap; }
.e2s-knobwrap { display: flex; flex-direction: column; align-items: center; gap: 2px; font-size: 9px; }
.e2s-knob { width: 34px; height: 34px; border-radius: 50%; position: relative;
  background: radial-gradient(circle at 38% 32%, #b7b7bd, #7e7e86 70%, #55555c);
  box-shadow: 0 3px 6px rgba(0,0,0,.45); }
.e2s-knob.gross { width: 48px; height: 48px; }
.e2s-knob.drehbar { cursor: ns-resize; }
.e2s-knob.drehbar:hover { outline: 2px solid rgba(255,255,255,.35); }
.e2s-knob.wert { background: radial-gradient(circle at 38% 32%, #c9505c, #93313c 75%); }
.e2s-zeiger { position: absolute; left: 50%; top: 4px; width: 2px; height: 40%;
  background: #16161a; transform-origin: 50% 145%; border-radius: 2px; }
.e2s-knob .wertlabel { position: absolute; inset: 0; display: flex; align-items: center;
  justify-content: center; font-size: 10px; color: #101014; font-weight: 700; }
.e2s-ledbtn, .e2s-modebtn, .e2s-taktbtn { border-radius: 5px; border: 1px solid #57232a;
  background: #23181b; color: #f0dede; font-size: 10px; padding: 3px 8px; cursor: pointer; }
.e2s-ledbtn.an { background: #d8262e; color: #fff; box-shadow: 0 0 10px #ff3b42; }
.e2s-modebtn.aktiv { background: #d8262e; color: #fff; box-shadow: 0 0 8px #ff3b42; }
.e2s-taktbtn { width: 26px; }
.e2s-taktbtn.aktiv { background: #2b3fd8; color: #fff; box-shadow: 0 0 8px #4b5cff; }
.e2s-padbereich { margin-top: 14px; display: grid; grid-template-columns: 250px 1fr; gap: 18px; }
.e2s-modusreihe { display: flex; gap: 5px; flex-wrap: wrap; margin: 10px 0 8px; align-items: center; }
.e2s-pads { display: grid; grid-template-columns: repeat(8, 1fr); gap: 10px; }
.e2s-pad { aspect-ratio: 1.25; background: linear-gradient(180deg, #2b2b30, #1c1c20);
  border: 1px solid #101014; border-radius: 8px; position: relative; cursor: pointer; }
.e2s-pad .led { position: absolute; left: 50%; top: 50%; transform: translate(-50%,-50%);
  width: 12px; height: 12px; border-radius: 50%; background: #3a2326; }
.e2s-pad.an .led { background: #ff2d36; box-shadow: 0 0 14px #ff2d36; }
.e2s-pad.sel .led { background: #7a5cff; box-shadow: 0 0 14px #7a5cff; }
.e2s-pad small { position: absolute; right: 5px; bottom: 3px; font-size: 9px; color: #9b8f92; }
.e2s-status { font-size: 12px; color: var(--muted, #aaa); }
.e2s-stepedit { position: fixed; z-index: 40; background: #1d1d22; border: 1px solid #57232a;
  border-radius: 8px; padding: 10px 12px; color: #eee; font-size: 12px; width: 210px;
  box-shadow: 0 8px 24px rgba(0,0,0,.6); display: flex; flex-direction: column; gap: 6px; }
.e2s-stepedit label { display: flex; flex-direction: column; gap: 2px; }
.e2s-stepedit small { color: #998; }
`;

function baueDom(): void {
  const style = document.createElement("style");
  style.textContent = PANEL_CSS;
  document.head.appendChild(style);

  $("viewPanel").innerHTML = `
  <div class="e2s-toolbar">
    <button id="e2sModusLive">Live</button>
    <button id="e2sModusPrepare">Prepare</button>
    <button id="e2sSync" title="Edit-Buffer vom Gerät holen — Sequencer vorher stoppen!">⟳ Sync vom Gerät</button>
    <button id="e2sAnhoeren" title="Pattern in den Edit-Buffer senden — klingt sofort, überschreibt keinen Slot">▶ Anhören (Edit-Buffer)</button>
    <label>Slot <input id="e2sSlot" type="number" min="1" max="250" value="1" style="width:60px"></label>
    <button id="e2sSchreiben" title="Pattern dauerhaft auf den Geräte-Slot schreiben">💾 → Slot</button>
    <label title="Zieht den Gerätezustand regelmäßig automatisch — bei laufendem Sequencer per Dreifach-Lesung mit Byte-Mehrheit"><input id="e2sAutoSync" type="checkbox" checked> Auto-Sync</label>
    <label title="▶ sendet MIDI-Clock (24 ppqn) im Pattern-Tempo plus Start — das Gerät folgt nur bei Global „Clock Mode" Auto/Ext"><input id="e2sClock" type="checkbox" checked> MIDI-Clock</label>
    <button id="e2sPanic" title="All Sound Off + All Notes Off auf allen 16 Kanälen (wirkt unabhängig vom Receive-Filter)">⛔ Panic</button>
    <span class="e2s-goto" title="Pattern am Gerät wählen (Program Change — greift bei laufendem Sequencer am Taktende)">
      <button id="e2sPatPrev" title="Pattern runter (−1)">▼</button>
      <label>Pattern <input id="e2sGoto" type="number" min="1" max="250" value="1" style="width:60px"></label>
      <button id="e2sGo">Gehe zu</button>
      <button id="e2sPatNext" title="Pattern hoch (+1)">▲</button>
    </span>
    <span class="e2s-status" id="e2sStatus">Prepare-Modus — Pattern aus dem Editor.</span>
  </div>
  <div class="e2s">
    <div class="e2s-top">
      <div class="e2s-power"></div>
      ${knob("e2sVolume", "Volume")} ${knob("e2sInput", "Input Level")}
      <div class="e2s-logo"><b>electribe sampler</b><small>MUSIC PRODUCTION STATION</small></div>
      <span class="korg">KORG</span>
    </div>
    <div class="e2s-haupt">
      <div>
        <div class="e2s-lcdwrap"><div class="e2s-lcd">
          <div class="bpm" id="e2sLcdBpm">120.0</div>
          <div class="patnr" id="e2sLcdNr">001</div>
          <div class="patname" id="e2sLcdName">—</div>
          <div class="partzeile" id="e2sLcdPart">Part:01</div>
        </div></div>
        <div class="e2s-transport">
          <button title="Aufnahme (deko)">●</button>
          <button title="Stop (deko)">■</button>
          <button class="play" title="Play (deko)">▶∥</button>
          <button title="Tap (deko)">Tap</button>
        </div>
        <div class="e2s-navrow">
          ${modeButton("e2sGateArp", "Gate Arp")} ${modeButton("e2sTouchScale", "Touch Scale")}
          ${modeButton("e2sMasterFx", "Master Fx")} ${modeButton("e2sMfxHold", "MFX Hold")}
        </div>
        <div class="e2s-xy"></div>
      </div>
      <div>
        <div class="e2s-sektionen">
          <div class="e2s-sektion">${knob("e2sValue", "", true)}</div>
          <div class="e2s-sektion"><h4>Sample</h4>
            <div class="e2s-reihe">${knob("e2sKnobSample", "", true)}</div>
            <div class="e2s-reihe">${knob("e2sKnobPitch", "Pitch")} ${knob("e2sKnobGlide", "Glide")} ${knob("e2sKnobOscEdit", "Edit")}</div>
          </div>
          <div class="e2s-sektion"><h4>Filter</h4>
            <div class="e2s-reihe">${knob("e2sKnobCutoff", "", true)}</div>
            <div class="e2s-reihe">${knob("e2sKnobReso", "Resonance")} ${knob("e2sKnobEgInt", "EG Int")}</div>
            <div class="e2s-reihe" style="margin-top:4px">${ledButton("e2sLedLpf", "LPF")} ${ledButton("e2sLedHpf", "HPF")} ${ledButton("e2sLedBpf", "BPF")}</div>
          </div>
          <div class="e2s-sektion"><h4>Modulation</h4>
            <div class="e2s-reihe">${knob("e2sKnobModType", "", true)}</div>
            <div class="e2s-reihe">${knob("e2sKnobDepth", "Depth")} ${knob("e2sKnobSpeed", "Speed")}</div>
          </div>
          <div class="e2s-sektion"><h4>Amp/EG</h4>
            <div class="e2s-reihe">${knob("e2sKnobLevel", "Level")} ${knob("e2sKnobPan", "Pan")}</div>
            <div class="e2s-reihe">${knob("e2sKnobAttack", "Attack")} ${knob("e2sKnobDecay", "Decay/Release")}</div>
            <div class="e2s-reihe" style="margin-top:4px">${ledButton("e2sLedMfxSend", "MFX Send")} ${ledButton("e2sLedAmpEg", "Amp EG")}</div>
          </div>
          <div class="e2s-sektion"><h4>Insert Fx</h4>
            <div class="e2s-reihe">${knob("e2sKnobIfxType", "", true)}</div>
            <div class="e2s-reihe">${knob("e2sKnobIfxEdit", "Edit")}</div>
            <div class="e2s-reihe" style="margin-top:4px">${ledButton("e2sLedIfxOn", "IFX On")}</div>
          </div>
        </div>
        <div class="e2s-modusreihe">
          ${modeButton("e2sPartZurueck", "&lt; Part")} ${modeButton("e2sPartVor", "Part &gt;")}
          ${modeButton("e2sPadMute", "Part Mute")} ${modeButton("e2sPartErase", "Part Erase")}
          ${modeButton("e2sTrigger", "Trigger")} ${modeButton("e2sPadSeq", "Sequencer")}
          ${modeButton("e2sKeyboard", "Keyboard")} ${modeButton("e2sChord", "Chord")}
          ${modeButton("e2sStepJump", "Step Jump")} ${modeButton("e2sPatternSet", "Pattern Set")}
          <span style="flex:1"></span>
          <button class="e2s-taktbtn" id="e2sTakt0">1</button><button class="e2s-taktbtn" id="e2sTakt1">2</button>
          <button class="e2s-taktbtn" id="e2sTakt2">3</button><button class="e2s-taktbtn" id="e2sTakt3">4</button>
        </div>
        <div class="e2s-pads" id="e2sPads">
          ${Array.from({ length: 16 }, (_, i) => `<div class="e2s-pad" data-pad="${i}"><div class="led"></div><small>${i + 1}</small></div>`).join("")}
        </div>
      </div>
    </div>
  </div>`;
}

// ─── Rendern ─────────────────────────────────────────────────────────────────

function dreheKnob(id: string, wert: number | undefined, min = 0, max = 127, anzeige?: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  const zeiger = el.querySelector<HTMLElement>(".e2s-zeiger");
  if (zeiger) {
    const v = wert === undefined ? min : Math.max(min, Math.min(max, wert));
    const anteil = (v - min) / (max - min || 1);
    zeiger.style.transform = `rotate(${-135 + anteil * 270}deg)`;
  }
  el.title = anzeige ?? (wert === undefined ? "—" : String(wert));
}

function led(id: string, an: boolean): void {
  document.getElementById(id)?.classList.toggle("an", an);
}

function renderPanel(): void {
  const p = aktuellesPattern();
  const part = p.parts[aktiverPart];
  const params = part?.params ?? {};
  const info = displayInfo(p, aktiverPart);
  const leds = partLeds(p, aktiverPart);

  $("e2sLcdBpm").textContent = info.bpm.toFixed(1);
  clockTempoNachziehen();
  $("e2sLcdNr").textContent = String(panelBridge.patternIndex + 1).padStart(3, "0");
  $("e2sLcdName").textContent = info.name || "—";
  $("e2sLcdPart").textContent =
    `Part:${String(info.partNo).padStart(2, "0")}` +
    (info.sampleNumber != null ? `  OSC: ${info.sampleNumber}` : "") +
    `  ${modus === "live" ? "LIVE" : "PREP"}`;

  dreheKnob("e2sKnobSample", info.sampleNumber ?? undefined, 0, 999, info.sampleNumber == null ? "kein Sample" : `Sample ${info.sampleNumber}`);
  dreheKnob("e2sKnobPitch", params.oscPitch, -63, 63);
  dreheKnob("e2sKnobGlide", params.oscGlide);
  dreheKnob("e2sKnobOscEdit", params.oscEdit);
  dreheKnob("e2sKnobCutoff", params.cutoff);
  dreheKnob("e2sKnobReso", params.resonance);
  dreheKnob("e2sKnobEgInt", params.egInt, -63, 63);
  dreheKnob("e2sKnobModType", params.modType, 0, 71, `Mod-Typ ${params.modType ?? "—"}`);
  dreheKnob("e2sKnobDepth", params.modDepth);
  dreheKnob("e2sKnobSpeed", params.modSpeed);
  dreheKnob("e2sKnobLevel", part?.volume);
  dreheKnob("e2sKnobPan", part?.pan);
  dreheKnob("e2sKnobAttack", params.egAttack);
  dreheKnob("e2sKnobDecay", params.egDecay);
  dreheKnob("e2sKnobIfxType", params.ifxType, 0, 48, `IFX-Typ ${params.ifxType ?? "—"}`);
  dreheKnob("e2sKnobIfxEdit", params.ifxEdit);

  led("e2sLedLpf", leds.band === "lpf");
  led("e2sLedHpf", leds.band === "hpf");
  led("e2sLedBpf", leds.band === "bpf");
  led("e2sLedMfxSend", leds.mfxSend);
  led("e2sLedAmpEg", leds.ampEg);
  led("e2sLedIfxOn", leds.ifxOn);

  for (const [m, id] of Object.entries(PAD_MODUS_BUTTON)) $(id).classList.toggle("aktiv", padModus === m);
  const takte = taktAnzahl(p);
  for (let t = 0; t < 4; t++) {
    const btn = $(`e2sTakt${t}`);
    btn.classList.toggle("aktiv", t === takt);
    // Im Pattern-Set-Modus sind die Takt-Buttons Seiten (Patterns 1–64), immer aktiv.
    (btn as HTMLButtonElement).disabled = padModus !== "patternset" && t >= takte;
  }
  $("e2sModusLive").classList.toggle("aktiv", modus === "live");
  $("e2sModusPrepare").classList.toggle("aktiv", modus === "prepare");

  const steps = stepStates(p, aktiverPart, takt);
  document.querySelectorAll<HTMLElement>("#e2sPads .e2s-pad").forEach((pad, i) => {
    pad.classList.remove("an", "sel");
    if (padModus === "mute" || padModus === "erase" || padModus === "trigger") {
      const gemutet = !!p.parts[i]?.muted;
      if (i === aktiverPart) pad.classList.add("sel");
      else if (!gemutet) pad.classList.add("an");
      const was = padModus === "erase" ? " — Klick löscht alle Steps" : padModus === "trigger" ? " — Klick spielt den Part" : "";
      pad.title = `${p.parts[i]?.label ?? `Part ${i + 1}`}${gemutet ? " (gemutet)" : ""}${was}`;
    } else if (padModus === "keyboard") {
      pad.title = `Note ${keyboardNote(i)} auf Part ${aktiverPart + 1}`;
    } else if (padModus === "patternset") {
      const idx = patternSetIndex(takt, i);
      const name = panelBridge.project.patterns[idx]?.name;
      if (idx === panelBridge.patternIndex) pad.classList.add("sel");
      else if (name) pad.classList.add("an");
      pad.title = `Pattern ${idx + 1}${name ? ` „${name}"` : ""} — Klick wechselt (Program Change)`;
    } else {
      if (steps[i]) pad.classList.add("an");
      pad.title = `Step ${takt * 16 + i + 1}`;
    }
  });
}

// ─── Aktionen ────────────────────────────────────────────────────────────────

async function syncVomGeraet(): Promise<void> {
  try {
    setStatus("hole Edit-Buffer … (bei laufendem Gerät: Dreifach-Lesung, kann kurz stören)");
    const body = await leseDumpVerlaesslich();
    if (!body) throw new Error("keine verlässliche Lesung");
    livePattern = editorPatternFromBody(body);
    modus = "live";
    setStatus(`Live-Sync: „${livePattern.name}" vom Gerät geholt.`);
    renderPanel();
  } catch (err) {
    setStatus(`Sync fehlgeschlagen: ${err instanceof Error ? err.message : err} — MIDI im Editor-Tab aktiviert?`);
  }
}

/** Zuletzt am Gerät angewähltes Pattern (0-basiert) — Basis für ▲/▼, unabhängig vom Projekt. */
let zielPatternIdx: number | null = null;

function zeigeZielPattern(idx: number): void {
  zielPatternIdx = idx;
  const eingabe = document.getElementById("e2sGoto") as HTMLInputElement | null;
  if (eingabe) eingabe.value = String(idx + 1);
}

/** Pattern am Gerät wechseln (Program Change + Bank Select) und im Editor folgen. */
export function wechslePattern(idx: number): void {
  idx = Math.max(0, Math.min(249, Math.round(idx)));
  if (!panelBridge.project.patterns[idx] && modus !== "live") {
    setStatus(`Pattern ${idx + 1} gibt es im Projekt nicht — im Live-Modus wird es trotzdem ans Gerät gesendet.`);
    return;
  }
  zeigeZielPattern(idx);
  if (modus === "live") {
    try {
      for (const m of buildProgramChange(panelBridge.midiChannel, idx)) panelBridge.midi.send(m);
      livePattern = null; // Stand ist unbekannt, bis der Sync ihn holt
      planeAutoSync(600);
      // Gemessen 2026-08-22: das Gerät nimmt den Program Change nur bei
      // LAUFENDEM Sequencer an (Wechsel am Taktende); gestoppt ignoriert es ihn.
      setStatus(
        spieltGerade
          ? `Pattern ${idx + 1} → Gerät (Program Change) — wechselt am Taktende; Sync folgt nach dem Stopp.`
          : `Pattern ${idx + 1} → Gerät gesendet — ⚠ das Gerät übernimmt Program Change nur bei laufendem Sequencer (erst Play drücken).`,
      );
    } catch (err) {
      setStatus(`Patternwechsel fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
    }
  } else {
    setStatus(`Pattern ${idx + 1} im Editor gewählt (Prepare).`);
  }
  if (panelBridge.project.patterns[idx]) panelBridge.patternIndex = idx;
  renderPanel();
}

// ─── Transport (MIDI-Clock + Start/Stop) ─────────────────────────────────────

let clockLaeuft = false;
let clockBpm = 0;
let transportStartMs: number | null = null;

/** Für das Pad-Deck: läuft der Transport, seit wann, in welchem Tempo? */
export function transportInfo(): { spielt: boolean; bpm: number; startMs: number | null; clock: boolean } {
  return { spielt: spieltGerade, bpm: aktuellesPattern().bpm, startMs: transportStartMs, clock: clockLaeuft };
}

/** Das Pattern, das das Panel gerade zeigt (Live-Stand oder Editor-Pattern). */
export function aktuellesPanelPattern(): EditorPattern {
  return aktuellesPattern();
}

/**
 * Mutes setzen wie ein Pad-Klick im Part-Mute-Modus: Live per NRPN (Hacktribe)
 * oder Edit-Buffer-Übertragung (Stock), Prepare nur lokal.
 */
export function setzeMutes(parts: number[], muted: boolean): void {
  const p = aktuellesPattern();
  for (const i of parts) {
    const part = p.parts[i];
    if (!part) continue;
    part.muted = muted;
    if (modus === "live" && featureAvailable(panelBridge.firmware, "nrpnPanel")) {
      try {
        for (const triple of buildPanelControl(panelBridge.midiChannel, "mute", i, muted ? 1 : 0))
          panelBridge.midi.send(new Uint8Array(triple));
      } catch {
        /* Übertragung unten fängt es auf */
      }
    }
  }
  if (modus === "live") planeAutoUebertragung();
  else panelBridge.markDirty();
  renderPanel();
}

export async function transportStart(mitClock: boolean): Promise<void> {
  const bpm = aktuellesPattern().bpm;
  try {
    if (mitClock) {
      if (!panelBridge.midi.clockAvailable) {
        setStatus("MIDI-Clock braucht die aktuelle Desktop-App (alte Bridge) — sende nur Start.");
      } else {
        await panelBridge.midi.clock("start", bpm);
        clockLaeuft = true;
        clockBpm = bpm;
      }
    }
    panelBridge.midi.send(Uint8Array.from([MIDI_START]));
    spieltGerade = true;
    transportStartMs = performance.now();
    setStatus(
      `Start gesendet${clockLaeuft ? ` + MIDI-Clock ${bpm} BPM` : ""} — das Gerät folgt nur bei Global „Clock Mode" Auto/Ext (Internal ignoriert beides).`,
    );
  } catch (err) {
    setStatus(`Start fehlgeschlagen: ${err instanceof Error ? err.message : err} — MIDI aktiviert?`);
  }
}

export async function transportStop(): Promise<void> {
  try {
    panelBridge.midi.send(Uint8Array.from([MIDI_STOP]));
    if (clockLaeuft) {
      await panelBridge.midi.clock("stop");
      clockLaeuft = false;
    }
    spieltGerade = false;
    transportStartMs = null;
    planeAutoSync(800);
    setStatus("Stop gesendet, MIDI-Clock aus — Sync folgt.");
  } catch (err) {
    setStatus(`Stop fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
  }
}

/** Pattern-Tempo geändert, während die Clock läuft → Clock nachziehen. */
function clockTempoNachziehen(): void {
  const bpm = aktuellesPattern().bpm;
  if (clockLaeuft && bpm !== clockBpm) {
    clockBpm = bpm;
    void panelBridge.midi.clock("bpm", bpm).catch(() => {});
  }
}

/** Kurzer Ton auf dem Kanal des Parts (Stock-MIDI: Part n hört auf Kanal n). */
function spieleNote(part0: number, note: number): void {
  try {
    panelBridge.midi.send(buildNoteOn(part0, note, 110));
    window.setTimeout(() => panelBridge.midi.send(buildNoteOff(part0, note)), 180);
  } catch (err) {
    setStatus(`Note senden fehlgeschlagen: ${err instanceof Error ? err.message : err} — MIDI aktiviert?`);
  }
}

function padKlick(i: number): void {
  const p = aktuellesPattern();
  if (padModus === "trigger") {
    aktiverPart = i;
    spieleNote(i, TRIGGER_NOTE);
    setStatus(`Part ${i + 1} angespielt (Note ${TRIGGER_NOTE}, Kanal ${i + 1}).`);
    renderPanel();
    return;
  }
  if (padModus === "keyboard") {
    const note = keyboardNote(i);
    spieleNote(aktiverPart, note);
    setStatus(`Note ${note} auf Part ${aktiverPart + 1}.`);
    return;
  }
  if (padModus === "patternset") {
    wechslePattern(patternSetIndex(takt, i));
    return;
  }
  if (padModus === "erase") {
    const part = p.parts[i];
    if (!part) return;
    const vorher = part.steps.filter((s) => s.on).length;
    for (const s of part.steps) s.on = false;
    if (modus === "live") {
      setStatus(`Part ${i + 1}: ${vorher} Steps gelöscht — wird gleich übertragen.`);
      planeAutoUebertragung();
    } else {
      panelBridge.markDirty();
      setStatus(`Part ${i + 1}: ${vorher} Steps gelöscht (Prepare — wirkt beim Übertragen).`);
    }
    renderPanel();
    return;
  }
  if (padModus === "mute") {
    const part = p.parts[i];
    if (!part) return;
    part.muted = !part.muted;
    if (modus === "live" && !featureAvailable(panelBridge.firmware, "nrpnPanel")) {
      // Stock-Firmware: kein NRPN. Der Mute geht denselben Weg wie die Steps —
      // gesammelt per Edit-Buffer-Übertragung, ~1 s später hörbar.
      setStatus(`Part ${i + 1} ${part.muted ? "gemutet" : "aktiv"} — wird gleich übertragen (Stock-Firmware: kein Sofort-Mute).`);
      planeAutoUebertragung();
    } else if (modus === "live") {
      // Hacktribe-NRPN-Bedienfeldbefehl — ✔ am Gerät bestätigt (2026-08-15):
      // Part 1 wurde hörbar stumm- und wieder freigeschaltet.
      try {
        for (const triple of buildPanelControl(panelBridge.midiChannel, "mute", i, part.muted ? 1 : 0))
          panelBridge.midi.send(new Uint8Array(triple));
        // NRPN wirkt sofort hörbar, hält aber nicht im Edit-Buffer — der
        // Auto-Transfer macht den Zustand dauerhaft (Nutzer-Befund).
        planeAutoUebertragung();
        setStatus(`Part ${i + 1} ${part.muted ? "gemutet" : "aktiv"} — live gesendet, Übertragung folgt.`);
      } catch (err) {
        // Sofort-Mute ging nicht raus — die Übertragung setzt den Zustand
        // trotzdem, nur eben mit der üblichen Verzögerung.
        planeAutoUebertragung();
        setStatus(`Sofort-Mute fehlgeschlagen (${err instanceof Error ? err.message : err}) — wird per Übertragung gesetzt.`);
      }
    } else {
      panelBridge.markDirty();
      setStatus(`Part ${i + 1} ${part.muted ? "gemutet" : "aktiv"} (Prepare — wirkt beim Übertragen).`);
    }
  } else {
    const idx = takt * 16 + i;
    if (idx >= p.stepLength) return;
    const step = p.parts[aktiverPart]?.steps[idx];
    if (!step) return;
    step.on = !step.on;
    if (modus === "live") {
      // Steps live: per NRPN NICHT erreichbar — am Gerät dreifach widerlegt
      // (panelControl "sequencer" mit absolutem und seitenrelativem Index,
      // dann sequence_param mit Trigger-Param 0; nichts davon wirkte, während
      // der Mute über denselben Rahmen funktioniert). Was nachweislich geht:
      // der Edit-Buffer-Dump. Also sammeln wir Klicks kurz und schicken das
      // Pattern automatisch — fuehlt sich live an, nutzt nur belegte Wege.
      setStatus(`Step ${idx + 1} ${step.on ? "an" : "aus"} — wird gleich automatisch übertragen …`);
      planeAutoUebertragung();
    } else {
      panelBridge.markDirty();
    }
  }
  renderPanel();
}

/** Sammelt schnelle Änderungen (Steps, Mutes, Step-Details) und überträgt das
 *  Pattern EINMAL danach in den Edit-Buffer. */
let autoSendeTimer: number | null = null;
function planeAutoUebertragung(): void {
  letzteLokaleAenderungUm = Date.now();
  if (modus !== "live") return;
  if (autoSendeTimer !== null) window.clearTimeout(autoSendeTimer);
  autoSendeTimer = window.setTimeout(() => {
    autoSendeTimer = null;
    void anhoeren();
  }, 350);
}

// ─── Automatischer Rück-Sync (Gerät → UI) ────────────────────────────────────
//
// Der Pattern-Dump ist NUR bei gestopptem Sequencer zuverlässig (am Gerät
// gemessen: laufend = still beschädigt). Deshalb zieht der Auto-Sync den
// Zustand nur, wenn das Gerät als gestoppt gilt (Stop-Ereignis oder ≥8 s ohne
// Note), nie während eine eigene Übertragung ansteht, und nie kurz nach einer
// lokalen Änderung (sonst überschreibt der Sync, was man gerade anfasst).

let autoSyncTimer: number | null = null;
function planeAutoSync(delayMs: number): void {
  if (autoSyncTimer !== null) window.clearTimeout(autoSyncTimer);
  autoSyncTimer = window.setTimeout(() => {
    autoSyncTimer = null;
    void autoSync();
  }, delayMs);
}

async function leseDumpEinmal(): Promise<Uint8Array | null> {
  try {
    const reply = await requestSysex(
      panelBridge.midi,
      buildCurrentPatternRequest(panelBridge.midiOpts()),
      (b) => decodeDump(b) !== null,
      2500,
    );
    return decodeDump(reply)!.body;
  } catch {
    return null;
  }
}

/**
 * Liest den Edit-Buffer auch bei LAUFENDEM Sequencer verlässlich: Dumps sind
 * dann still verschoben (am Gerät gemessen) — aber die Verschiebung liegt pro
 * Lesung woanders. Deshalb der dokumentierte Ausweg aus der Messreihe:
 * dreimal lesen, je Byte die Mehrheit. Zwei übereinstimmende Lesungen sind
 * belastbar; bei gestopptem Gerät genügt eine.
 */
async function leseDumpVerlaesslich(): Promise<Uint8Array | null> {
  const stillSeit = Date.now() - letzteNoteUm;
  const vermutlichGestoppt = !spieltGerade || stillSeit > 8000;
  const a = await leseDumpEinmal();
  if (!a) return null;
  if (vermutlichGestoppt) return a;
  const b = await leseDumpEinmal();
  if (b && a.length === b.length && a.every((v, i) => v === b[i])) return a;
  const c = await leseDumpEinmal();
  if (!b || !c || a.length !== b.length || a.length !== c.length) return null;
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] === b[i] || a[i] === c[i] ? a[i] : b[i];
  return out;
}

function autoSyncErlaubt(): boolean {
  const schalter = document.getElementById("e2sAutoSync") as HTMLInputElement | null;
  return !schalter || schalter.checked;
}

async function autoSync(): Promise<void> {
  if (modus !== "live" || syncLaeuft || autoSendeTimer !== null) return;
  if (!autoSyncErlaubt()) return;
  if (Date.now() - letzteLokaleAenderungUm < 3000) return;
  // Nur bei gestopptem Gerät automatisch ziehen: Dumps bei laufendem
  // Sequencer stören hörbar die Wiedergabe und die Pattern-Chains
  // (Nutzer-Befund im Live-Test). Während des Spielens hält der CC-Spiegel
  // die Regler aktuell; den Rest holt der Sync nach dem Stopp — oder der
  // manuelle Sync-Knopf, der die Dreifach-Lesung bewusst in Kauf nimmt.
  const stillSeit = Date.now() - letzteNoteUm;
  if (spieltGerade && stillSeit < 8000) return;
  syncLaeuft = true;
  try {
    const body = await leseDumpVerlaesslich();
    if (!body) return;
    livePattern = editorPatternFromBody(body);
    setStatus(`Auto-Sync: „${livePattern.name}" um ${new Date().toLocaleTimeString()}.`);
    renderPanel();
  } catch {
    // still bleiben — Auto-Sync ist Komfort, kein Fehlerfall wert.
  } finally {
    syncLaeuft = false;
  }
}

async function anhoeren(): Promise<void> {
  try {
    const p = aktuellesPattern();
    setStatus("sende in den Edit-Buffer …");
    const body = new Uint8Array(buildPatternFile(p).slice(0x100));
    await panelBridge.midi.sendAsync(buildCurrentPatternDump(body, panelBridge.midiOpts()));
    setStatus(`„${p.name}" → Edit-Buffer gesendet — Play am Gerät drücken.`);
  } catch (err) {
    setStatus(`Senden fehlgeschlagen: ${err instanceof Error ? err.message : err} — MIDI im Editor-Tab aktiviert?`);
  }
}

async function aufSlotSchreiben(): Promise<void> {
  const slot = Number(($("e2sSlot") as HTMLInputElement).value);
  if (!Number.isFinite(slot) || slot < 1 || slot > 250) {
    setStatus("Slot muss 1–250 sein.");
    return;
  }
  const p = aktuellesPattern();
  if (!confirm(`„${p.name}" dauerhaft auf Geräte-Slot ${slot} schreiben? Überschreibt den dortigen Inhalt.`)) return;
  try {
    setStatus(`schreibe auf Slot ${slot} …`);
    const ok = await panelBridge.writePatternToSlot(p, slot);
    setStatus(`„${p.name}" → Slot ${slot} ${ok ? "geschrieben — vom Gerät bestätigt ✓" : "gesendet (keine Bestätigung — am Gerät prüfen)"}`);
  } catch (err) {
    setStatus(`Schreiben fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Live-Mitlauf: Reglerdrehungen am Gerät kommen als CC herein (am Gerät
 * gemessen 2026-08-15, siehe e2KnobCc.ts). Der KANAL ist die Part-Nummer
 * (Nutzer-Auskunft) — der Wert landet also beim richtigen Part, und die UI
 * springt auf diesen Part, damit die Regler zeigen, was man gerade anfasst.
 */
/** Spielt das Gerät gerade? Konservativer Start: ja — kein Auto-Sync, bevor
 *  ein Stopp sicher erkannt ist (Dumps bei laufendem Sequencer kommen still
 *  beschädigt zurück, am Gerät gemessen). */
let spieltGerade = true;
let letzterBankLsb = 0;
let letzteNoteUm = 0;
let letzteLokaleAenderungUm = 0;
let syncLaeuft = false;

function empfangeVomGeraet(bytes: number[]): void {
  const st = bytes[0];
  // Transport-Erkennung: Start/Continue/Stop plus Noten als Spiel-Heuristik.
  if (st === 0xfa || st === 0xfb) spieltGerade = true;
  else if (st === 0xfc) {
    spieltGerade = false;
    planeAutoSync(800); // nach dem Stopp einmal frisch ziehen
  } else if ((st & 0xf0) === 0x90 && bytes.length >= 3 && bytes[2] > 0) {
    spieltGerade = true;
    letzteNoteUm = Date.now();
  } else if ((st & 0xf0) === 0xb0 && bytes.length >= 3 && bytes[1] === 0x20) {
    letzterBankLsb = bytes[2]; // Bank Select LSB geht dem Program Change voraus
  } else if ((st & 0xf0) === 0xc0 && bytes.length >= 2 && modus === "live") {
    // Patternwechsel: das Gerät sendet Bank Select + Program Change (am Gerät
    // gemessen, 2026-08-15). Nummern 0-basiert, Bank im LSB (gemessen 2026-08-22, e2Remote.ts).
    // Liegt im Editor dieselbe Bank, übernehmen wir das Pattern direkt als
    // Kopie — exakt ohne Dump; sonst bleibt der Sync für den nächsten Stopp vorgemerkt.
    const nr = patternIndexFromProgram(letzterBankLsb, bytes[1]);
    if (nr === null) return;
    zeigeZielPattern(nr);
    const kandidat = panelBridge.project.patterns[nr];
    if (kandidat) {
      livePattern = clonePattern(kandidat);
      setStatus(`Patternwechsel am Gerät: #${nr + 1} „${kandidat.name}" — aus dem Projekt übernommen.`);
    } else {
      setStatus(`Patternwechsel am Gerät: #${nr + 1} — nicht im Projekt, Sync beim nächsten Stopp.`);
    }
    renderPanel();
    return;
  }
  if (modus !== "live") return;
  const ev = decodeKnobCc(bytes);
  if (!ev || !ev.knob) return;
  const p = aktuellesPattern();
  const part = p.parts[ev.channel0];
  if (!part) return;
  const wert = ccValueToParam(ev.knob.key, ev.value);
  if (ev.knob.key === "volume") part.volume = ev.value;
  else if (ev.knob.key === "pan") part.pan = ev.value;
  else part.params = { ...(part.params ?? {}), [ev.knob.key]: wert };
  aktiverPart = ev.channel0;
  setStatus(`${ev.knob.label} = ${wert} — live vom Gerät (Part ${ev.channel0 + 1}).`);
  renderPanel();
}

// ─── Drehbare Regler (UI → Gerät) ────────────────────────────────────────────

/** Element-ID → Regler-Key + Anzeigebereich. Nur gemessene Regler sind drehbar. */
const KNOB_BELEGUNG: Record<string, { key: string; min: number; max: number }> = {
  e2sKnobCutoff: { key: "cutoff", min: 0, max: 127 },
  e2sKnobReso: { key: "resonance", min: 0, max: 127 },
  e2sKnobEgInt: { key: "egInt", min: -63, max: 63 },
  e2sKnobPitch: { key: "oscPitch", min: -63, max: 63 },
  e2sKnobGlide: { key: "oscGlide", min: 0, max: 127 },
  e2sKnobOscEdit: { key: "oscEdit", min: 0, max: 127 },
  e2sKnobDepth: { key: "modDepth", min: 0, max: 127 },
  e2sKnobSpeed: { key: "modSpeed", min: 0, max: 127 },
  e2sKnobAttack: { key: "egAttack", min: 0, max: 127 },
  e2sKnobDecay: { key: "egDecay", min: 0, max: 127 },
  e2sKnobLevel: { key: "volume", min: 0, max: 127 },
  e2sKnobPan: { key: "pan", min: 0, max: 127 },
  e2sKnobIfxEdit: { key: "ifxEdit", min: 0, max: 127 },
};

function reglerWert(def: { key: string; min: number }, partIdx: number): number {
  const part = aktuellesPattern().parts[partIdx];
  if (!part) return def.min;
  if (def.key === "volume") return part.volume;
  if (def.key === "pan") return part.pan;
  return part.params?.[def.key] ?? 0;
}

/**
 * Setzt einen Reglerwert: Pattern-Zustand immer, im Live-Modus zusätzlich als
 * CC auf dem Kanal des aktiven Parts ans Gerät (Kanal = Part). Ob das Gerät
 * die CCs auch EMPFÄNGT, ist der nächste Abnahmetest — gesendet wird exakt
 * das Format, das es selbst beim Drehen sendet.
 */
function setzeReglerWert(def: { key: string; min: number; max: number }, wert: number): void {
  const geclampt = Math.max(def.min, Math.min(def.max, Math.round(wert)));
  const part = aktuellesPattern().parts[aktiverPart];
  if (!part) return;
  letzteLokaleAenderungUm = Date.now(); // Auto-Sync nicht ins Ziehen grätschen lassen
  if (def.key === "volume") part.volume = geclampt;
  else if (def.key === "pan") part.pan = geclampt;
  else part.params = { ...(part.params ?? {}), [def.key]: geclampt };
  if (modus === "live") {
    const msg = buildKnobCc(aktiverPart, def.key, geclampt);
    if (msg) {
      panelBridge.midi.send(msg);
      setStatus(`${def.key} = ${geclampt} → Gerät (CC, Kanal ${aktiverPart + 1}).`);
    } else {
      setStatus(`${def.key} = ${geclampt} — kein CC bekannt, nur lokal (wirkt beim Übertragen).`);
    }
  } else {
    panelBridge.markDirty();
    setStatus(`${def.key} = ${geclampt} (Prepare — wirkt beim Übertragen).`);
  }
  renderPanel();
}

/**
 * Schalter-Parameter (kein CC bekannt): Pattern-Zustand setzen; im Live-Modus
 * per Auto-Übertragung (Edit-Buffer) ans Gerät — funktioniert auf Stock und
 * Hacktribe gleichermaßen, nur eben mit ~1 s Verzögerung.
 */
function setzeSchalterParam(key: string, wert: number, was: string): void {
  const part = aktuellesPattern().parts[aktiverPart];
  if (!part) return;
  letzteLokaleAenderungUm = Date.now();
  part.params = { ...(part.params ?? {}), [key]: wert };
  if (modus === "live") {
    // IFX On / MFX Send haben Stock-CCs (104/105) — sofort senden; die
    // Übertragung macht den Zustand zusätzlich im Edit-Buffer dauerhaft.
    const cc = buildSchalterCc(aktiverPart, key, wert === 1);
    if (cc) panelBridge.midi.send(cc);
    planeAutoUebertragung();
    setStatus(`${was} (Part ${aktiverPart + 1})${cc ? " — CC gesendet," : " —"} Übertragung folgt.`);
  } else {
    panelBridge.markDirty();
    setStatus(`${was} (Part ${aktiverPart + 1}, Prepare — wirkt beim Übertragen).`);
  }
  renderPanel();
}

/** Auswahlregler: Ziehen schaltet den Wert schrittweise weiter (kein CC — Übertragung). */
const AUSWAHL_BELEGUNG: Record<string, { key: string; min: number; max: number; label: string; anzeige?: (w: number) => string }> = {
  e2sKnobIfxType: { key: "ifxType", min: 0, max: 48, label: "IFX-Typ" },
  e2sKnobModType: { key: "modType", min: 0, max: 71, label: "Mod-Typ", anzeige: (w) => String(w + 1) },
};

function macheAuswahlDrehbar(): void {
  for (const [id, def] of Object.entries(AUSWAHL_BELEGUNG)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.add("drehbar");
    el.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      const startY = ev.clientY;
      const part = aktuellesPattern().parts[aktiverPart];
      const startWert = part?.params?.[def.key] ?? def.min;
      let letzter = startWert;
      const move = (m: PointerEvent) => {
        // 8 Pixel je Schritt — Auswahlwerte sollen einzeln treffbar sein.
        const ziel = Math.max(def.min, Math.min(def.max, startWert + Math.round((startY - m.clientY) / 8)));
        if (ziel === letzter) return;
        letzter = ziel;
        setzeSchalterParam(def.key, ziel, `${def.label} = ${def.anzeige ? def.anzeige(ziel) : ziel}`);
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    });
  }
  // Sample-Regler: durch den Sample-Pool des Projekts schalten.
  const sampleEl = document.getElementById("e2sKnobSample");
  if (sampleEl) {
    sampleEl.classList.add("drehbar");
    sampleEl.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      sampleEl.setPointerCapture(ev.pointerId);
      const startY = ev.clientY;
      const nummern = [...panelBridge.project.samples].map((s) => s.number).sort((a, b) => a - b);
      const part = aktuellesPattern().parts[aktiverPart];
      if (!part || !nummern.length) {
        setStatus("Kein Sample im Pool — erst Samples importieren.");
        return;
      }
      const startPos = Math.max(0, nummern.indexOf(part.sampleNumber ?? -1));
      let letzte = startPos;
      const move = (m: PointerEvent) => {
        const pos = schritt(startPos, Math.round((startY - m.clientY) / 8), 0, nummern.length - 1);
        if (pos === letzte) return;
        letzte = pos;
        letzteLokaleAenderungUm = Date.now();
        part.sampleNumber = nummern[pos];
        if (modus === "live") {
          planeAutoUebertragung();
          setStatus(`Sample ${nummern[pos]} (Part ${aktiverPart + 1}) — wird gleich übertragen.`);
        } else {
          panelBridge.markDirty();
          setStatus(`Sample ${nummern[pos]} (Part ${aktiverPart + 1}, Prepare).`);
        }
        renderPanel();
      };
      const up = () => {
        sampleEl.removeEventListener("pointermove", move);
        sampleEl.removeEventListener("pointerup", up);
      };
      sampleEl.addEventListener("pointermove", move);
      sampleEl.addEventListener("pointerup", up);
    });
  }
  // Value-Regler: Pattern-Nummer (Live: Program Change).
  const valueEl = document.getElementById("e2sValue");
  if (valueEl) {
    valueEl.classList.add("drehbar");
    valueEl.title = "Pattern wählen (ziehen) — Live: Program Change ans Gerät";
    valueEl.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      valueEl.setPointerCapture(ev.pointerId);
      const startY = ev.clientY;
      const start = panelBridge.patternIndex;
      const max = Math.max(0, panelBridge.project.patterns.length - 1);
      let ziel = start;
      const move = (m: PointerEvent) => {
        const n = Math.max(0, Math.min(max, start + Math.round((startY - m.clientY) / 8)));
        if (n === ziel) return;
        ziel = n;
        $("e2sLcdNr").textContent = String(n + 1).padStart(3, "0");
        $("e2sLcdName").textContent = panelBridge.project.patterns[n]?.name ?? "—";
      };
      const up = () => {
        valueEl.removeEventListener("pointermove", move);
        valueEl.removeEventListener("pointerup", up);
        if (ziel !== start) wechslePattern(ziel);
      };
      valueEl.addEventListener("pointermove", move);
      valueEl.addEventListener("pointerup", up);
    });
  }
}

function macheReglerDrehbar(): void {
  for (const [id, def] of Object.entries(KNOB_BELEGUNG)) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.classList.add("drehbar");
    el.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      el.setPointerCapture(ev.pointerId);
      const startY = ev.clientY;
      const startWert = reglerWert(def, aktiverPart);
      const move = (m: PointerEvent) => {
        // 2 Pixel pro Schritt: ein voller Bildschirm-Zug überstreicht den Bereich.
        setzeReglerWert(def, startWert + (startY - m.clientY) / 2);
      };
      const up = () => {
        el.removeEventListener("pointermove", move);
        el.removeEventListener("pointerup", up);
      };
      el.addEventListener("pointermove", move);
      el.addEventListener("pointerup", up);
    });
  }
}

// ─── Step-Details (Gate/Velocity) per Rechtsklick ────────────────────────────

let stepEditEl: HTMLElement | null = null;

function schliesseStepEditor(): void {
  stepEditEl?.remove();
  stepEditEl = null;
}

function oeffneStepEditor(padIdx: number, x: number, y: number): void {
  schliesseStepEditor();
  const p = aktuellesPattern();
  const idx = takt * 16 + padIdx;
  if (idx >= p.stepLength) return;
  const step = p.parts[aktiverPart]?.steps[idx];
  if (!step) return;

  const el = document.createElement("div");
  el.className = "e2s-stepedit";
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.innerHTML = `
    <b>Step ${idx + 1} · Part ${aktiverPart + 1}</b>
    <label>Velocity <span id="e2sSeVelWert">${step.velocity}</span>
      <input id="e2sSeVel" type="range" min="1" max="127" value="${step.velocity}"></label>
    <label>Gate <span id="e2sSeGateWert">${step.gate}</span>
      <input id="e2sSeGate" type="range" min="1" max="96" value="${step.gate}"></label>
    <small>96 = Tie (nur über SD, SysEx kürzt auf 96)</small>`;
  document.body.appendChild(el);
  stepEditEl = el;

  const vel = el.querySelector<HTMLInputElement>("#e2sSeVel")!;
  const gate = el.querySelector<HTMLInputElement>("#e2sSeGate")!;
  vel.addEventListener("input", () => {
    step.velocity = Number(vel.value);
    el.querySelector("#e2sSeVelWert")!.textContent = vel.value;
    if (!step.on) step.on = true;
    if (modus === "prepare") panelBridge.markDirty();
    planeAutoUebertragung();
    renderPanel();
  });
  gate.addEventListener("input", () => {
    step.gate = Number(gate.value);
    el.querySelector("#e2sSeGateWert")!.textContent = gate.value;
    if (!step.on) step.on = true;
    if (modus === "prepare") panelBridge.markDirty();
    planeAutoUebertragung();
    renderPanel();
  });
  // Klick außerhalb schließt.
  setTimeout(() => {
    const zu = (ev: MouseEvent) => {
      if (stepEditEl && !stepEditEl.contains(ev.target as Node)) {
        schliesseStepEditor();
        document.removeEventListener("mousedown", zu);
      }
    };
    document.addEventListener("mousedown", zu);
  }, 0);
}

// ─── Init ────────────────────────────────────────────────────────────────────

/** Beim Tab-Wechsel aufrufen: Editor-Daten können sich geändert haben. */
export function panelWirdSichtbar(): void {
  aktiverPart = Math.min(aktiverPart, 15);
  renderPanel();
}

/** Weitere Empfänger für eingehendes MIDI (Pad-Deck: MIDI-Learn/Trigger). */
const zusatzEmpfaenger: ((bytes: number[]) => void)[] = [];
export function registriereEmpfaenger(cb: (bytes: number[]) => void): () => void {
  zusatzEmpfaenger.push(cb);
  return () => {
    const i = zusatzEmpfaenger.indexOf(cb);
    if (i >= 0) zusatzEmpfaenger.splice(i, 1);
  };
}

export function initPanel(): void {
  baueDom();
  panelBridge.onIncoming = (bytes) => {
    empfangeVomGeraet(bytes);
    for (const cb of zusatzEmpfaenger) {
      try {
        cb(bytes);
      } catch (e) {
        console.error("Empfänger", e);
      }
    }
  };
  macheReglerDrehbar();

  $("e2sModusLive").addEventListener("click", () => {
    modus = "live";
    const fw = panelBridge.firmware === "hacktribe"
      ? "Hacktribe: Mutes sofort"
      : "Stock: Mutes und Steps per Übertragung";
    setStatus(livePattern ? `Live-Modus (${fw}) — letzter Sync-Stand.` : `Live-Modus (${fw}) — erst ⟳ Sync vom Gerät drücken.`);
    renderPanel();
  });
  $("e2sModusPrepare").addEventListener("click", () => {
    modus = "prepare";
    setStatus("Prepare-Modus — Pattern aus dem Editor.");
    renderPanel();
  });
  $("e2sSync").addEventListener("click", () => void syncVomGeraet());
  $("e2sAnhoeren").addEventListener("click", () => void anhoeren());
  $("e2sSchreiben").addEventListener("click", () => void aufSlotSchreiben());

  for (const [m, id] of Object.entries(PAD_MODUS_BUTTON)) {
    $(id).addEventListener("click", () => {
      padModus = m as PadModus;
      const hinweis: Record<PadModus, string> = {
        mute: "Part Mute — Pads schalten Parts stumm/aktiv.",
        sequencer: "Sequencer — Pads sind die 16 Steps des aktiven Parts im gewählten Takt.",
        erase: "Part Erase — Pad-Klick löscht alle Steps des Parts.",
        trigger: "Trigger — Pad-Klick spielt den Part an (Note auf seinem Kanal).",
        keyboard: `Keyboard — Pads spielen Part ${aktiverPart + 1} chromatisch ab C3.`,
        patternset: "Pattern Set — Pads = Patterns, Takt-Buttons 1–4 = Seiten (1–64). Live: Program Change.",
      };
      setStatus(hinweis[padModus]);
      renderPanel();
    });
  }
  // LED-Buttons: Schalter des aktiven Parts (kein CC bekannt → Übertragung).
  const bandKlick = (band: "lpf" | "hpf" | "bpf") => {
    const leds = partLeds(aktuellesPattern(), aktiverPart);
    const typ = filterTypeNachBandKlick(leds.band, band);
    setzeSchalterParam("filterType", typ, typ === 0 ? "Filter aus" : `Filter ${band.toUpperCase()}`);
  };
  $("e2sLedLpf").addEventListener("click", () => bandKlick("lpf"));
  $("e2sLedHpf").addEventListener("click", () => bandKlick("hpf"));
  $("e2sLedBpf").addEventListener("click", () => bandKlick("bpf"));
  const schalterKlick = (key: string, label: string) => {
    const part = aktuellesPattern().parts[aktiverPart];
    const neu = kippeSchalter(part?.params?.[key]);
    setzeSchalterParam(key, neu, `${label} ${neu ? "an" : "aus"}`);
  };
  $("e2sLedIfxOn").addEventListener("click", () => schalterKlick("ifxOn", "IFX"));
  $("e2sLedAmpEg").addEventListener("click", () => schalterKlick("ampEgOn", "Amp EG"));
  $("e2sLedMfxSend").addEventListener("click", () => schalterKlick("mfxSend", "MFX Send"));
  // Transport: MIDI Start/Stop — das Gerät folgt nur, wenn sein Clock auf Auto/Ext steht.
  // Transport: MIDI-Clock + Start/Stop. Das Gerät folgt nur bei Global
  // „Clock Mode" Auto/Ext (gemessen: bei Internal ignoriert es Start/Stop).
  const clockGewuenscht = () => (document.getElementById("e2sClock") as HTMLInputElement | null)?.checked ?? true;
  const transport = document.querySelectorAll<HTMLButtonElement>(".e2s-transport button");
  transport.forEach((btn) => {
    if (btn.classList.contains("play")) {
      btn.title = "Play — MIDI-Clock im Pattern-Tempo + Start ans Gerät (Clock Mode Auto/Ext nötig)";
      btn.addEventListener("click", () => void transportStart(clockGewuenscht()));
    } else if (btn.textContent?.trim() === "■") {
      btn.title = "Stop — MIDI Stop ans Gerät, Clock aus";
      btn.addEventListener("click", () => void transportStop());
    }
  });
  // Gehe zu Pattern: Eingabe + ▲/▼ — Basis ist das zuletzt angewählte Pattern,
  // sonst das Editor-Pattern.
  const gehZu = () => {
    const n = Number(($("e2sGoto") as HTMLInputElement).value);
    if (!Number.isFinite(n) || n < 1 || n > 250) {
      setStatus("Pattern-Nummer 1–250 eingeben.");
      return;
    }
    wechslePattern(n - 1);
  };
  $("e2sGo").addEventListener("click", gehZu);
  $("e2sGoto").addEventListener("keydown", (ev) => {
    if ((ev as KeyboardEvent).key === "Enter") gehZu();
  });
  const basisIdx = () => zielPatternIdx ?? panelBridge.patternIndex;
  $("e2sPatPrev").addEventListener("click", () => wechslePattern(schritt(basisIdx(), -1, 0, 249)));
  $("e2sPatNext").addEventListener("click", () => wechslePattern(schritt(basisIdx(), 1, 0, 249)));
  zeigeZielPattern(panelBridge.patternIndex);
  $("e2sPanic").addEventListener("click", () => {
    try {
      for (const m of buildPanic()) panelBridge.midi.send(m);
      setStatus("Panic gesendet: All Sound Off + All Notes Off auf allen 16 Kanälen.");
    } catch (err) {
      setStatus(`Panic fehlgeschlagen: ${err instanceof Error ? err.message : err} — MIDI aktiviert?`);
    }
  });
  // Master FX: Ein/Aus per CC 106, X/Y-Pad per CC 102/103 — auf dem Global-Kanal.
  let masterFxAn = false;
  $("e2sMasterFx").addEventListener("click", () => {
    masterFxAn = !masterFxAn;
    $("e2sMasterFx").classList.toggle("aktiv", masterFxAn);
    try {
      panelBridge.midi.send(buildMfxCc(panelBridge.midiChannel, "on", masterFxAn ? 127 : 0));
      setStatus(`Master FX ${masterFxAn ? "an" : "aus"} (CC 106, Kanal ${panelBridge.midiChannel + 1}).`);
    } catch (err) {
      setStatus(`Master FX fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
    }
  });
  const xy = document.querySelector<HTMLElement>(".e2s-xy");
  if (xy) {
    xy.title = "Master-FX X/Y — ziehen sendet CC 102/103 (Global-Kanal)";
    xy.style.cursor = "crosshair";
    const punkt = document.createElement("div");
    punkt.style.cssText = "position:absolute;width:10px;height:10px;border-radius:50%;background:#ff4d3d;box-shadow:0 0 8px #ff4d3d;pointer-events:none;display:none";
    xy.style.position = "relative";
    xy.appendChild(punkt);
    let letztes = "";
    const sende = (ev: PointerEvent) => {
      const r = xy.getBoundingClientRect();
      const x = Math.max(0, Math.min(127, Math.round(((ev.clientX - r.left) / r.width) * 127)));
      const y = Math.max(0, Math.min(127, Math.round((1 - (ev.clientY - r.top) / r.height) * 127)));
      punkt.style.display = "block";
      punkt.style.left = `${ev.clientX - r.left - 5}px`;
      punkt.style.top = `${ev.clientY - r.top - 5}px`;
      const key = `${x},${y}`;
      if (key === letztes) return;
      letztes = key;
      panelBridge.midi.send(buildMfxCc(panelBridge.midiChannel, "x", x));
      panelBridge.midi.send(buildMfxCc(panelBridge.midiChannel, "y", y));
      setStatus(`Master FX X=${x} Y=${y} (CC 102/103).`);
    };
    xy.addEventListener("pointerdown", (ev) => {
      ev.preventDefault();
      xy.setPointerCapture(ev.pointerId);
      sende(ev);
      const move = (m: PointerEvent) => sende(m);
      const up = () => {
        xy.removeEventListener("pointermove", move);
        xy.removeEventListener("pointerup", up);
      };
      xy.addEventListener("pointermove", move);
      xy.addEventListener("pointerup", up);
    });
  }
  macheAuswahlDrehbar();
  $("e2sPartZurueck").addEventListener("click", () => {
    aktiverPart = (aktiverPart + 15) % 16;
    renderPanel();
  });
  $("e2sPartVor").addEventListener("click", () => {
    aktiverPart = (aktiverPart + 1) % 16;
    renderPanel();
  });
  for (let t = 0; t < 4; t++)
    $(`e2sTakt${t}`).addEventListener("click", () => {
      takt = t;
      renderPanel();
    });
  $("e2sPads").addEventListener("click", (ev) => {
    const pad = (ev.target as HTMLElement).closest<HTMLElement>(".e2s-pad");
    if (pad) padKlick(Number(pad.dataset.pad));
  });
  // Rechtsklick auf ein Step-Pad: Gate/Velocity des Steps.
  $("e2sPads").addEventListener("contextmenu", (ev) => {
    const pad = (ev.target as HTMLElement).closest<HTMLElement>(".e2s-pad");
    if (!pad || padModus !== "sequencer") return;
    ev.preventDefault();
    oeffneStepEditor(Number(pad.dataset.pad), ev.clientX, ev.clientY);
  });

  // Regelmäßiger Rück-Sync vom Gerät (greift nur in sicheren Momenten).
  window.setInterval(() => void autoSync(), 10000);

  renderPanel();
}

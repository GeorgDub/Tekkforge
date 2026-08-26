/**
 * editor.ts — Pattern-Editor-UI: Patterns ohne ESX von Grund auf bauen.
 * Grid 16 Parts × 16/32/64 Steps, Step-Popover (Note/Velocity/Gate),
 * Sample-Pool (WAV-Import), Projekt speichern/öffnen, Export .e2spat/Bank.
 */

import {
  createProject,
  klonProjektFuerVerlauf,
  createPattern,
  clonePattern,
  importSampleFromWav,
  processWavToMono,
  sanitizeSampleName,
  buildPatternFile,
  buildBankFiles,
  buildSampleBank,
  renumberSample,
  serializeProject,
  deserializeProject,
  editorProjectFromE2Files,
  editorPatternFromBody,
  importSamplesFromAll,
  noteName,
  EDITOR_DEFAULT_NOTE,
  EDITOR_GATE_MAX,
  type EditorProject,
  type EditorPattern,
  type EditorStep,
  type PoolSample,
} from "../core/editorModel";
import { merkeLetzteDatei } from "./start";
import type { DateiArt } from "../core/letzteDateien";
import { filterePool, poolRamMb, POOL_RAM_LIMIT_MB, type PoolFilter } from "../core/poolFilter";
import {
  buildCurrentPatternDump,
  buildPatternDump,
  buildPatternRequest,
  buildPatternWrite,
  buildCurrentPatternRequest,
  buildSearchDevice,
  parseSearchReply,
  decodeDump,
  decodeGlobalDump,
  buildGlobalRequest,
  isKorgSysex,
  parseAck,
  E2_ACK_OK,
  E2_ACK_ERROR,
  E2_PRODUCT_ID_SAMPLER,
  type E2SysexOptions,
} from "../core/e2sysex";
import { resolveStepNotes } from "../core/e2StepNote";
import { MidiIO, requestSysex, waitSysex } from "./midi";
import { PART_PARAMS, clampParamValue, type PartParam } from "../core/partParams";
import { fxTypeDef, decodeFxEditBuffer } from "../core/e2FxParams";
import { buildSetFxParam, fxSlotForPart } from "../core/hacktribeNrpn";
import {
  FIRMWARE_LABEL,
  FIRMWARE_PROBE,
  FIRMWARE_STORAGE_KEY,
  featureAvailable,
  featureHint,
  firmwareFromProbe,
  parseFirmwareMode,
  probeStatusText,
  type FirmwareMode,
  type ProbeOutcome,
} from "../core/firmwareMode";
import { initFxPresetPanel } from "./fxPreset";
import { initSampleEditor, oeffneSampleEditor } from "./sampleEditor";
import { packeNummernNeu, sortiereBank, type SortierSchluessel } from "../core/bankManager";
import { planeSong, songText, type SongSchritt } from "../core/songModus";
import { Verlauf } from "../core/verlauf";
import {
  E2_RAM_MAP,
  RAM_CMD,
  addressForSlot,
  buildRamReadRequest,
  buildRamWriteAddress,
  buildRamWriteData,
  findRamMapEntry,
  formatHexDump,
  parseAddress,
  parseHexBytes,
  parseRamResponse,
  splitRamRead,
  splitRamWrite,
  validateRamRange,
  verifyRamWrite,
} from "../core/hacktribeRam";
import { baueVariante, kettenNachEinschub, VARIANTEN, type VariantenArt } from "../core/patternVarianten";
import { MAX_PATTERNS_PER_BANK } from "../core/electribeImport";
import { Autosicherung, wiederherstellungsFrage } from "../core/autosicherung";
import { autosaveAblage } from "./tekkAutosave";
import { PreviewPlayer } from "./preview";
import { $, download, escapeHtml } from "./shared";

let project: EditorProject = createProject();
let cur = 0; // aktueller Pattern-Index
let dirty = false;
/** Merkt sich die zuletzt gesetzte Note pro Part (für neue Steps). */
const lastNote = new Map<number, number>();
const player = new PreviewPlayer();

/**
 * Rueckgaengig/Wiederherstellen. Gemerkt werden STAENDE, nicht Aktionen —
 * `markDirty()` wird nach jeder Aenderung ohnehin gerufen, also legen wir dort
 * den Stand von davor ab. So kann keine Bearbeitung vergessen werden, auch
 * keine, die spaeter dazukommt.
 */
const verlauf = new Verlauf<EditorProject>(30);
let standVorher = klonProjektFuerVerlauf(project);

/**
 * Notfall-Sicherung. Faengt Abstuerze und Stromausfaelle ab — die Warnung beim
 * Schliessen tut das nicht. Ohne Electron-Bruecke (reiner Browser) gibt es sie
 * nicht; der Editor laeuft dann unveraendert weiter.
 *
 * Bewusst KEIN Schreiben im `beforeunload`: dort laesst sich der IPC-Aufruf
 * nicht mehr abwarten, und der Absturzfall ruft den Handler ohnehin nie. Das
 * Zeitfenster ist also "bis zu ein Abstand" — so steht es auch in der Doku.
 */
const sicherung = (() => {
  const ablage = autosaveAblage();
  if (!ablage) return undefined;
  return new Autosicherung(ablage, () => serializeProject(project), {
    melden: (t) => setMidiStatus?.(t),
  });
})();

function markDirty(): void {
  dirty = true;
  verlauf.merke(standVorher);
  standVorher = klonProjektFuerVerlauf(project);
  sicherung?.angestossen();
  zeigeVerlaufKnoepfe();
}

function zeigeVerlaufKnoepfe(): void {
  const z = document.getElementById("edUndo") as HTMLButtonElement | null;
  const v = document.getElementById("edRedo") as HTMLButtonElement | null;
  if (z) z.disabled = !verlauf.kannZurueck;
  if (v) v.disabled = !verlauf.kannVor;
}

/** Einen Stand einspielen, ohne ihn erneut in den Verlauf zu legen. */
function standSetzen(neu: EditorProject): void {
  project = neu;
  standVorher = klonProjektFuerVerlauf(project);
  if (cur >= project.patterns.length) cur = Math.max(0, project.patterns.length - 1);
  dirty = true;
  sicherung?.angestossen();
  renderAll();
  zeigeVerlaufKnoepfe();
}

/**
 * Das ganze Projekt wurde ersetzt (Import, Datei geoeffnet, neues Projekt,
 * geretteter Stand).
 *
 * Der Verlauf muss dabei weg UND der gemerkte Vorzustand neu gesetzt werden.
 * Sonst zeigt `standVorher` weiter auf das ALTE Projekt, und die naechste
 * Aenderung legt diesen veralteten Stand als "davor" ab — ein einziges
 * Rueckgaengig warf dann den kompletten Import weg statt nur die Aenderung.
 * Genau so gefunden: importieren, Namen tippen, einmal zurueck — und das
 * importierte Pattern war fort.
 */
function projektErsetzt(): void {
  verlauf.leeren();
  standVorher = klonProjektFuerVerlauf(project);
  zeigeVerlaufKnoepfe();
}

function schrittZurueck(): void {
  const stand = verlauf.zurueck(klonProjektFuerVerlauf(project));
  if (!stand) return;
  standSetzen(stand);
  setMidiStatus?.("Ein Schritt zurückgenommen.");
}

function schrittVor(): void {
  const stand = verlauf.vor(klonProjektFuerVerlauf(project));
  if (!stand) return;
  standSetzen(stand);
  setMidiStatus?.("Wiederhergestellt.");
}

export function isDirty(): boolean {
  return dirty;
}

/**
 * Ersetzt das aktuelle Projekt (z.B. Datei-Import oder ESX-Converter-Handoff).
 * Fragt bei ungespeicherten Änderungen nach. Gibt false zurück, wenn abgebrochen.
 */
export function loadProject(next: EditorProject, opts: { confirmDirty?: boolean } = {}): boolean {
  if (opts.confirmDirty !== false && dirty && !confirm("Ungespeicherte Änderungen verwerfen?"))
    return false;
  project = next;
  cur = 0;
  dirty = false;
  void sicherung?.erledigt();
  lastNote.clear();
  projektErsetzt();
  renderAll();
  return true;
}

/** Merged Pool-Samples ein (Nummern-Kollisionen werden übersprungen). */
function mergeSamples(incoming: PoolSample[]): number {
  const known = new Set(project.samples.map((s) => s.number));
  let added = 0;
  for (const s of incoming) {
    if (known.has(s.number)) continue;
    project.samples.push(s);
    known.add(s.number);
    added++;
  }
  return added;
}

// ─── Pattern-Liste ───────────────────────────────────────────────────────────

function renderPatList(): void {
  const ul = $("patList");
  ul.innerHTML = project.patterns
    .map(
      (p, i) =>
        `<li data-i="${i}" class="${i === cur ? "sel" : ""}">${i + 1}. ${escapeHtml(p.name || "(ohne Name)")}</li>`,
    )
    .join("");
  ul.querySelectorAll<HTMLLIElement>("li").forEach((li) =>
    li.addEventListener("click", () => {
      cur = Number(li.dataset.i);
      renderAll();
    }),
  );
}

// ─── Globals ─────────────────────────────────────────────────────────────────

function renderGlobals(): void {
  const p = project.patterns[cur];
  $<HTMLInputElement>("gName").value = p.name;
  $<HTMLInputElement>("gBpm").value = String(p.bpm);
  $<HTMLSelectElement>("gLen").value = String(p.stepLength);
  const badge = $("rawBadge");
  if (p.rawBody) {
    badge.textContent = "⚙ Original-Klang erhalten (Filter/Amp/IFX/Motion)";
    badge.classList.remove("hidden");
  } else {
    badge.classList.add("hidden");
  }
}

// ─── Grid ────────────────────────────────────────────────────────────────────

/** Alle Töne eines Steps, erster zuerst. */
function stepNotes(s: EditorStep): number[] {
  return resolveStepNotes(s.notes, s.note);
}

function stepTitle(s: EditorStep): string {
  const n = stepNotes(s);
  const noten = n.length > 1 ? `Noten ${n.map(noteName).join(" ")}` : `Note ${noteName(s.note)}`;
  return `${noten} · Vel ${s.velocity} · Gate ${s.gate === EDITOR_GATE_MAX ? "Tie" : s.gate}`;
}

/**
 * Beschriftung einer Rasterzelle. Bei einem Akkord ist kein Platz für alle
 * Töne — deshalb der erste plus die Zahl der weiteren. Die vollständige Liste
 * steht im Tooltip.
 */
function stepLabel(s: EditorStep): string {
  const n = stepNotes(s);
  if (n.length > 1) return `${noteName(n[0])}+${n.length - 1}`;
  return s.note === EDITOR_DEFAULT_NOTE ? "" : noteName(s.note);
}

function velColor(v: number): string {
  // Velocity → Orange-Intensität
  const t = 0.35 + 0.65 * (v / 127);
  return `rgba(255, 106, 0, ${t.toFixed(2)})`;
}

function renderGrid(): void {
  const p = project.patterns[cur];
  const grid = $("grid");
  grid.innerHTML = "";

  // Kopfzeile mit Step-Nummern
  const head = document.createElement("div");
  head.className = "gridRow";
  const headPad = document.createElement("div");
  headPad.className = "rowHead";
  headPad.innerHTML = `<span style="color:var(--dim);font-size:10px">Part · Sample · Vol · Pan</span>`;
  head.appendChild(headPad);
  const headSteps = document.createElement("div");
  headSteps.className = "steps";
  for (let s = 0; s < p.stepLength; s++) {
    const n = document.createElement("div");
    n.className = "stepIdx" + (s % 16 === 0 && s > 0 ? " bar" : s % 4 === 0 && s > 0 ? " q4" : "");
    n.textContent = String(s + 1);
    headSteps.appendChild(n);
  }
  head.appendChild(headSteps);
  grid.appendChild(head);

  p.parts.forEach((part, pi) => {
    const row = document.createElement("div");
    row.className = "gridRow";
    if (part.muted) row.style.opacity = "0.4";

    const headEl = document.createElement("div");
    headEl.className = "rowHead";

    const muteBtn = document.createElement("button");
    muteBtn.className = "ghost";
    muteBtn.textContent = part.muted ? "🔇" : "🔈";
    muteBtn.title = part.muted
      ? "Stumm (wird mit aufs Gerät übertragen) — klick zum Aufheben"
      : "Part stummschalten — wirkt im Vorhören UND im übertragenen Pattern";
    muteBtn.style.cssText =
      "padding:2px 5px;font-size:11px;flex:none" + (part.muted ? ";border-color:var(--accent)" : "");
    muteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      part.muted = !part.muted;
      markDirty();
      renderGrid();
    });

    const label = document.createElement("input");
    label.className = "plabel";
    label.value = part.label;
    label.title = "Part-Name (nur Anzeige)";
    label.addEventListener("change", () => {
      part.label = label.value.slice(0, 10);
      markDirty();
      renderPatList();
    });

    const sampleSel = document.createElement("select");
    const opts = ['<option value="">— kein Sample —</option>'].concat(
      project.samples.map(
        (s) =>
          `<option value="${s.number}" ${part.sampleNumber === s.number ? "selected" : ""}>${s.number} ${escapeHtml(s.name)}</option>`,
      ),
    );
    sampleSel.innerHTML = opts.join("");
    sampleSel.addEventListener("change", () => {
      part.sampleNumber = sampleSel.value ? Number(sampleSel.value) : null;
      markDirty();
    });

    const vol = document.createElement("input");
    vol.type = "number";
    vol.min = "0";
    vol.max = "127";
    vol.value = String(part.volume);
    vol.title = "Volume 0–127";
    vol.addEventListener("change", () => {
      part.volume = Math.min(127, Math.max(0, Number(vol.value) || 0));
      vol.value = String(part.volume);
      markDirty();
    });

    const pan = document.createElement("input");
    pan.type = "number";
    pan.min = "0";
    pan.max = "127";
    pan.value = String(part.pan);
    pan.title = "Pan 0–127 (64 = Mitte)";
    pan.addEventListener("change", () => {
      part.pan = Math.min(127, Math.max(0, Number(pan.value) || 0));
      pan.value = String(part.pan);
      markDirty();
    });

    const fxBtn = document.createElement("button");
    fxBtn.className = "ghost";
    fxBtn.textContent = "⚙";
    fxBtn.title = "Klangparameter: Filter/Amp/IFX/Mod/Osc (Offsets am Geraet bestaetigt)";
    fxBtn.style.cssText = "padding:2px 6px;font-size:11px";
    fxBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openPartParams(fxBtn, pi);
    });

    headEl.append(muteBtn, label, sampleSel, vol, pan, fxBtn);
    row.appendChild(headEl);

    const stepsEl = document.createElement("div");
    stepsEl.className = "steps";
    for (let s = 0; s < p.stepLength; s++) {
      const st = part.steps[s];
      const cell = document.createElement("div");
      cell.className =
        "stepCell" +
        (s % 16 === 0 && s > 0 ? " bar" : s % 4 === 0 && s > 0 ? " q4" : "") +
        (st.on ? " on" : "");
      cell.dataset.part = String(pi);
      cell.dataset.step = String(s);
      if (st.on) {
        cell.style.background = velColor(st.velocity);
        cell.textContent = stepLabel(st);
        if (stepNotes(st).length > 1) cell.classList.add("chord");
        cell.title = stepTitle(st);
      } else {
        cell.style.background = "";
        cell.title = "Klick: Step an · Rechtsklick: Noten, Velocity, Gate";
      }
      cell.addEventListener("click", () => {
        st.on = !st.on;
        if (st.on) st.note = lastNote.get(pi) ?? st.note;
        markDirty();
        renderGrid();
      });
      cell.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        openStepPopover(cell, pi, s);
      });
      stepsEl.appendChild(cell);
    }
    row.appendChild(stepsEl);
    grid.appendChild(row);
  });
}

// ─── Step-Popover ────────────────────────────────────────────────────────────

let popEl: HTMLElement | null = null;

function closePopover(): void {
  popEl?.remove();
  popEl = null;
}

function openStepPopover(anchor: HTMLElement, pi: number, si: number): void {
  closePopover();
  const p = project.patterns[cur];
  const st = p.parts[pi].steps[si];

  const pop = document.createElement("div");
  pop.className = "popover";
  const vorhanden = stepNotes(st);
  const noteOpts = (sel: number | null, leer: boolean) =>
    (leer ? `<option value="">—</option>` : "") +
    Array.from({ length: 128 }, (_, n) => {
      const label = n === EDITOR_DEFAULT_NOTE ? `${noteName(n)} (Original)` : noteName(n);
      return `<option value="${n}" ${sel === n ? "selected" : ""}>${label}</option>`;
    }).join("");
  // Das Geraet bietet vier Notenplaetze je Step. Platz 1 ist der Grundton und
  // immer belegt; die drei weiteren duerfen leer bleiben.
  const zusatz = [1, 2, 3]
    .map(
      (i) => `<select id="ppNote${i}" class="chordSlot">${noteOpts(vorhanden[i] ?? null, true)}</select>`,
    )
    .join("");
  pop.innerHTML = `
    <b>Part ${pi + 1} · Step ${si + 1}</b>
    <label>Note</label>
    <select id="ppNote" style="width:100%">${noteOpts(st.note, false)}</select>
    <label>Weitere Töne (Akkord, optional)</label>
    <div class="chordRow">${zusatz}</div>
    <label>Velocity (1–127)</label>
    <input id="ppVel" type="number" min="1" max="127" value="${st.velocity}" style="width:100%" />
    <label>Gate (1–96, 96 = Tie)</label>
    <input id="ppGate" type="number" min="1" max="${EDITOR_GATE_MAX}" value="${st.gate}" style="width:100%" />
    <div class="row">
      <button id="ppOk" class="primary" style="flex:1">OK</button>
      <button id="ppOff" class="ghost">Step aus</button>
    </div>`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.min(window.innerWidth - 230, r.left + window.scrollX)}px`;
  pop.style.top = `${r.bottom + window.scrollY + 4}px`;
  popEl = pop;

  pop.querySelector<HTMLButtonElement>("#ppOk")!.addEventListener("click", () => {
    st.on = true;
    const gewaehlt = [
      Number(pop.querySelector<HTMLSelectElement>("#ppNote")!.value),
      ...[1, 2, 3]
        .map((i) => pop.querySelector<HTMLSelectElement>(`#ppNote${i}`)!.value)
        .filter((v) => v !== "")
        .map(Number),
    ];
    // resolveStepNotes wirft Dubletten raus und begrenzt auf vier — dieselbe
    // Regel wie beim Schreiben, damit die Anzeige zum Export passt.
    const noten = resolveStepNotes(gewaehlt, EDITOR_DEFAULT_NOTE);
    st.note = noten[0];
    st.notes = noten.length > 1 ? noten : undefined;
    st.velocity = Math.min(127, Math.max(1, Number(pop.querySelector<HTMLInputElement>("#ppVel")!.value) || 96));
    st.gate = Math.min(EDITOR_GATE_MAX, Math.max(1, Number(pop.querySelector<HTMLInputElement>("#ppGate")!.value) || 72));
    lastNote.set(pi, st.note);
    markDirty();
    closePopover();
    renderGrid();
  });
  pop.querySelector<HTMLButtonElement>("#ppOff")!.addEventListener("click", () => {
    st.on = false;
    markDirty();
    closePopover();
    renderGrid();
  });
}

document.addEventListener("click", (e) => {
  if (popEl && !popEl.contains(e.target as Node)) closePopover();
});

// ─── Part-Klangparameter ─────────────────────────────────────────────────────

function openPartParams(anchor: HTMLElement, pi: number): void {
  closePopover();
  const part = project.patterns[cur].parts[pi];
  const params = part.params ?? (part.params = {});

  const pop = document.createElement("div");
  pop.className = "popover";
  pop.style.width = "300px";

  // Nach Gruppen sortiert rendern
  const groups = [...new Set(PART_PARAMS.map((p) => p.group))];
  const rows = groups
    .map((g) => {
      const items = PART_PARAMS.filter((p) => p.group === g)
        .map((p: PartParam) => {
          const val = params[p.key] ?? 0;
          const ctrl =
            p.kind === "bool"
              ? `<input type="checkbox" data-key="${p.key}" ${val ? "checked" : ""}>`
              : `<input type="number" data-key="${p.key}" min="${p.min}" max="${p.max}" value="${val}" style="width:56px">`;
          return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin:2px 0">
            <span style="color:var(--muted);font-size:11px">${p.label}</span>${ctrl}</div>`;
        })
        .join("");
      return `<div style="margin-top:6px"><b style="color:var(--accent2);font-size:11px">${g}</b>${items}</div>`;
    })
    .join("");

  pop.innerHTML = `
    <b>Part ${pi + 1} „${escapeHtml(part.label)}" — Klangparameter</b>
    <div class="warn" style="font-size:10px;margin:4px 0">
      Byte-Offsets am Gerät bestätigt (Testpattern-Messreihe 2026-08-14).
      Nicht editierte Werte bleiben unverändert erhalten.
    </div>
    <div style="max-height:340px;overflow-y:auto">${rows}</div>
    <div id="ppFx"></div>
    <div class="row"><button id="ppClose" class="ghost" style="flex:1">Schließen</button></div>`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.min(window.innerWidth - 320, r.left + window.scrollX)}px`;
  pop.style.top = `${r.bottom + window.scrollY + 4}px`;
  popEl = pop;

  const renderFxSection = () => renderPartFxSection(pop, pi, params);
  renderFxSection();

  pop.querySelectorAll<HTMLInputElement>("input[data-key]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const key = inp.dataset.key!;
      const raw = inp.type === "checkbox" ? (inp.checked ? 1 : 0) : Number(inp.value);
      const v = clampParamValue(key, raw);
      params[key] = v;
      if (inp.type !== "checkbox") inp.value = String(v);
      markDirty();
      // Der IFX-Typ bestimmt, welche Parameter der FX-Abschnitt anbietet.
      if (key === "ifxType") renderFxSection();
    });
  });
  pop.querySelector<HTMLButtonElement>("#ppClose")!.addEventListener("click", closePopover);
}

/**
 * IFX-Abschnitt des Part-Popovers: benennt den eingestellten Effekt und seine
 * Parameter und erlaubt, einen davon live ans Gerät zu schicken.
 *
 * Der Part trägt seinen IFX-Typ im Pattern-Body (`ifxType`); `e2FxParams` macht
 * daraus Effekt- und Parameternamen, statt nur nackte Indizes zu zeigen. Das
 * Senden läuft über NRPN und setzt **Hacktribe-Firmware** voraus — ein
 * Stock-Gerät ignoriert die Nachrichten stillschweigend.
 */
function renderPartFxSection(
  pop: HTMLElement,
  pi: number,
  params: Record<string, number>,
): void {
  const host = pop.querySelector<HTMLElement>("#ppFx");
  if (!host) return;
  const ifxType = params["ifxType"] ?? 0;
  const def = fxTypeDef(ifxType, false);

  if (!def) {
    host.innerHTML = `<div style="margin-top:8px;color:var(--muted);font-size:11px">
      IFX-Typ ${ifxType} — kein Effektname bekannt.</div>`;
    return;
  }
  if (def.params.length === 0) {
    host.innerHTML = `<div style="margin-top:8px;color:var(--muted);font-size:11px">
      IFX: <b>${escapeHtml(def.name)}</b> — keine Parameter.</div>`;
    return;
  }

  if (!featureAvailable(firmware, "nrpnFx")) {
    // Stock: kein NRPN, kein RAM — nur Name und Parameterliste zeigen, kein
    // Sende-/Leseknopf, der am Gerät ins Leere liefe.
    host.innerHTML = `
      <div style="margin-top:8px;border-top:1px solid var(--line);padding-top:6px">
        <b style="color:var(--accent2);font-size:11px">IFX-Algorithmus: ${escapeHtml(def.name)}</b>
        <div style="color:var(--muted);font-size:10px">Parameter: ${def.params.map((n, i) => `${i}: ${escapeHtml(n)}`).join(" · ")}</div>
        <div class="sub" style="font-size:10px;margin-top:4px">${escapeHtml(featureHint(firmware, "nrpnFx"))}</div>
      </div>`;
    return;
  }

  const opts = def.params
    .map((n, i) => `<option value="${i}">${i}: ${escapeHtml(n)}</option>`)
    .join("");
  host.innerHTML = `
    <div style="margin-top:8px;border-top:1px solid var(--line);padding-top:6px">
      <b style="color:var(--accent2);font-size:11px">IFX-Algorithmus: ${escapeHtml(def.name)}</b>
      <div style="color:var(--muted);font-size:10px">
        Algorithmus-Name — das Gerätemenü zeigt den <b>Preset</b>-Namen, der anders
        lautet (z.B. Preset „Bit Crusher" = Algorithmus „Decimator").
      </div>
      <div class="warn" style="font-size:10px;margin:4px 0">
        ⚠ Live-Senden braucht <b>Hacktribe</b>-Firmware und ist in TekkForge nicht
        am Gerät erprobt. Ändert nur den Klang am Gerät, nicht das Pattern hier.
      </div>
      <div style="display:flex;gap:4px;align-items:center">
        <select id="ppFxParam" style="flex:1;font-size:11px">${opts}</select>
        <input id="ppFxVal" type="number" min="0" max="127" value="64" style="width:56px">
        <button id="ppFxSend" class="ghost" style="font-size:11px">Senden</button>
        <button id="ppFxRead" class="ghost" style="font-size:11px" title="FX-Puffer aus dem Geraete-RAM lesen — zeigt den Pattern-Stand, NICHT den Live-Wert">Puffer lesen</button>
      </div>
      <div id="ppFxStatus" style="color:var(--muted);font-size:10px;margin-top:3px"></div>
    </div>`;

  const status = host.querySelector<HTMLElement>("#ppFxStatus")!;
  host.querySelector<HTMLButtonElement>("#ppFxSend")!.addEventListener("click", () => {
    const idx = Number(host.querySelector<HTMLSelectElement>("#ppFxParam")!.value);
    const val = Math.max(0, Math.min(127, Number(host.querySelector<HTMLInputElement>("#ppFxVal")!.value)));
    // Jeder Part hat zwei IFX-Slots; wir bedienen IFX-A. Part-Index ist
    // 0-basiert, fxSlotForPart zählt 1..16 (EDITOR_PARTS === 16, passt exakt).
    const slot = fxSlotForPart(pi + 1, 0);
    const msgs = buildSetFxParam(midiChannel, slot, idx, val);
    status.textContent = "Sende…";
    // Die vier CCs gehören zu EINER Nachricht und müssen in Reihenfolge und
    // ohne Zwischenverkehr ankommen — deshalb streng nacheinander.
    void (async () => {
      try {
        for (const m of msgs) await midi.sendAsync(Uint8Array.from(m));
        status.textContent = `Gesendet: ${def.params[idx]} = ${val} an IFX-A (FX-Slot ${slot}, 4 CCs). Wirkung nur hoerbar pruefbar.`;
      } catch (e) {
        status.textContent = `Senden fehlgeschlagen: ${String(e)}`;
      }
    })();
  });

  // ── FX-Puffer lesen (KEINE Rückleseprobe für NRPN!) ────────────────────────
  //
  // ⚠ Dieser Knopf hieß mal „Prüfen" und verglich den gesendeten Wert mit dem
  // Puffer. Das ist am Gerät widerlegt (2026-08-14): der Puffer bei
  // `FX_EDIT_BUFFER_BASE` spiegelt LIVE-Änderungen nicht — weder NRPN noch ein
  // Knopfdreh am Gerät selbst. Nachgemessen: nach beidem änderte sich im
  // gesamten 3746-B-Bereich kein einziges Byte, während der NRPN hörbar wirkte.
  //
  // Ein Vergleich hätte also IMMER „Abweichung" gemeldet und einen
  // funktionierenden Sendeweg als kaputt dargestellt. Genau darauf bin ich
  // selbst hereingefallen. Der Knopf zeigt jetzt nur noch, was im Puffer steht,
  // und sagt dazu, dass das der Pattern-Stand ist.
  //
  // Belegt wird ein NRPN-Send derzeit nur akustisch.
  host.querySelector<HTMLButtonElement>("#ppFxRead")!.addEventListener("click", () => {
    const idx = Number(host.querySelector<HTMLSelectElement>("#ppFxParam")!.value);
    const slot = fxSlotForPart(pi + 1, 0);
    const entry = findRamMapEntry("fxEditBuffer");
    if (!entry) return;
    const addr = addressForSlot(entry, slot);
    const range = validateRamRange(addr, entry.size);
    if (!range.ok) {
      status.textContent = `Nicht gelesen: ${range.reason}`;
      return;
    }
    status.textContent = "Lese FX-Edit-Buffer…";
    void (async () => {
      try {
        // Bewusst über denselben Lesepfad wie das RAM-Panel: der Echo-Filter
        // (nur cmd 0x54) und die Längenprüfung sollen an EINER Stelle leben.
        const read = await ramReadBytes(addr, entry.size);
        if (!read.ok) {
          status.textContent = `Nicht gelesen: ${read.reason}`;
          return;
        }
        const buf = decodeFxEditBuffer(read.bytes, false);
        const got = buf.params[idx];
        const fxNow = fxTypeDef(buf.device, false);
        const wer = `Algorithmus „${fxNow?.name ?? buf.device}"`;
        status.textContent =
          got === undefined
            ? `Pattern-Stand: ${wer} hat keinen Parameter ${idx}.`
            : `Pattern-Stand: ${def.params[idx]} = ${got} (${wer}). ` +
              `Das ist NICHT der Live-Wert — gesendete Änderungen erscheinen hier nicht.`;
      } catch (e) {
        status.textContent = `Lesen fehlgeschlagen: ${String(e)}`;
      }
    })();
  });
}

// ─── Sample-Pool ─────────────────────────────────────────────────────────────

/** Slot, dessen Audio gerade per ↻ ersetzt werden soll. */
let replaceTargetNumber: number | null = null;
/** Bibliotheks-Ansicht: aktiver Filter + Suchtext. */
let poolFilterWahl: PoolFilter = "alle";
let poolSucheText = "";

function renderPool(): void {
  const tbody = $("poolRows");
  const sorted = filterePool([...project.samples].sort((a, b) => a.number - b.number), poolFilterWahl, poolSucheText);
  tbody.innerHTML = sorted
    .map(
      (s) => `<tr>
        <td><input class="poolNum" data-num="${s.number}" type="number" min="501" max="999"
              value="${s.number}" style="width:44px;background:var(--elevated);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:2px 3px;font:inherit" /></td>
        <td><input class="poolName" data-num="${s.number}" type="text" maxlength="16" title="${escapeHtml(s.kategorie ?? "")}"
              value="${escapeHtml(s.name)}" style="width:96px;background:var(--elevated);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:2px 4px;font:inherit" /></td>
        <td>${(s.pcm.length / s.sampleRate).toFixed(1)}</td>
        <td><input class="poolGain" data-num="${s.number}" type="checkbox" ${s.gain12db ? "checked" : ""} title="+12 dB Gain" /></td>
        <td style="white-space:nowrap">
          <a data-play="${s.number}" style="cursor:pointer" title="Anhören">▶</a>
          <a data-edit="${s.number}" style="cursor:pointer;color:var(--accent)" title="Bearbeiten: schneiden, blenden, normalisieren, Loop">✎</a>
          <a data-replace="${s.number}" style="cursor:pointer;color:var(--accent2)" title="Audio ersetzen (WAV)">↻</a>
          <a data-del="${s.number}" style="cursor:pointer;color:var(--danger)" title="Entfernen">✕</a>
        </td>
      </tr>`,
    )
    .join("");
  // Speicherbalken gegen das Geraete-RAM
  const mb = poolRamMb(project.samples);
  const anteil = Math.min(1, mb / POOL_RAM_LIMIT_MB);
  const balken = $("poolRamBalken");
  balken.style.width = `${(anteil * 100).toFixed(1)}%`;
  balken.classList.toggle("voll", anteil >= 0.92);
  $("poolRamText").textContent = `${mb.toFixed(1)} / ${POOL_RAM_LIMIT_MB} MB Sample-RAM · ${project.samples.length} Sample(s)${
    sorted.length !== project.samples.length ? ` · ${sorted.length} gefiltert` : ""
  }`;

  const byNum = (n: number) => project.samples.find((s) => s.number === n);

  tbody.querySelectorAll<HTMLInputElement>("input.poolName").forEach((inp) =>
    inp.addEventListener("change", () => {
      const s = byNum(Number(inp.dataset.num));
      if (!s) return;
      s.name = sanitizeSampleName(inp.value);
      inp.value = s.name;
      markDirty();
    }),
  );
  tbody.querySelectorAll<HTMLInputElement>("input.poolNum").forEach((inp) =>
    inp.addEventListener("change", () => {
      const oldNum = Number(inp.dataset.num);
      const newNum = Number(inp.value);
      if (!renumberSample(project, oldNum, newNum)) {
        alert(`Nummer ${newNum} nicht möglich (belegt oder außerhalb 501–999).`);
        renderPool();
        return;
      }
      markDirty();
      renderAll();
    }),
  );
  tbody.querySelectorAll<HTMLInputElement>("input.poolGain").forEach((inp) =>
    inp.addEventListener("change", () => {
      const s = byNum(Number(inp.dataset.num));
      if (!s) return;
      if (inp.checked) s.gain12db = true;
      else delete s.gain12db;
      markDirty();
    }),
  );
  tbody.querySelectorAll<HTMLAnchorElement>("a[data-play]").forEach((a) =>
    a.addEventListener("click", () => {
      const s = byNum(Number(a.dataset.play));
      if (s) player.audition(s);
    }),
  );
  tbody.querySelectorAll<HTMLAnchorElement>("a[data-edit]").forEach((a) =>
    a.addEventListener("click", () => {
      const s = byNum(Number(a.dataset.edit));
      if (!s) return;
      oeffneSampleEditor({
        nummer: s.number,
        name: s.name,
        pcm: s.pcm,
        sampleRate: s.sampleRate,
        loopType: s.loopType,
        loopStartFrame: s.loopStartFrame,
      });
    }),
  );
  tbody.querySelectorAll<HTMLAnchorElement>("a[data-replace]").forEach((a) =>
    a.addEventListener("click", () => {
      replaceTargetNumber = Number(a.dataset.replace);
      $<HTMLInputElement>("replaceFile").click();
    }),
  );
  tbody.querySelectorAll<HTMLAnchorElement>("a[data-del]").forEach((a) =>
    a.addEventListener("click", () => {
      const num = Number(a.dataset.del);
      const used = project.patterns.some((p) => p.parts.some((pt) => pt.sampleNumber === num));
      if (used && !confirm(`Sample #${num} wird von Parts benutzt — trotzdem entfernen?`)) return;
      const idx = project.samples.findIndex((s) => s.number === num);
      if (idx >= 0) project.samples.splice(idx, 1);
      markDirty();
      renderAll();
    }),
  );
}

async function replaceSampleAudio(file: File): Promise<void> {
  const num = replaceTargetNumber;
  replaceTargetNumber = null;
  if (num === null) return;
  const s = project.samples.find((x) => x.number === num);
  if (!s) return;
  try {
    const rep = processWavToMono(new Uint8Array(await file.arrayBuffer()), file.name);
    s.pcm = rep.pcm;
    s.sampleRate = rep.sampleRate;
    // Name nur übernehmen, wenn er noch der Default/Auto-Name war? Nein — Nutzer
    // erwartet i.d.R. Beibehaltung; Name bleibt, nur Audio wird getauscht.
    markDirty();
    renderAll();
  } catch (err) {
    alert(`Ersetzen fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function exportSampleBank(): void {
  const all = buildSampleBank(project.samples);
  if (!all) {
    alert("Der Sample-Pool ist leer — nichts zu exportieren.");
    return;
  }
  download(all, "sample-bank.all", "application/octet-stream");
}

async function importWavFiles(files: FileList | File[]): Promise<void> {
  const errors: string[] = [];
  for (const f of Array.from(files)) {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      project.samples.push(importSampleFromWav(bytes, f.name, project.samples));
      markDirty();
    } catch (err) {
      errors.push(`${f.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  renderAll();
  if (errors.length) alert("Nicht importiert:\n" + errors.join("\n"));
}

// ─── Export / Projekt ────────────────────────────────────────────────────────

function safeStem(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 40) || "pattern";
}

function showWarnings(warnings: string[]): void {
  const el = $("edWarn");
  if (warnings.length === 0) {
    el.classList.add("hidden");
  } else {
    el.textContent = "⚠ " + warnings.join(" · ");
    el.classList.remove("hidden");
  }
}

function exportPattern(): void {
  const p = project.patterns[cur];
  download(buildPatternFile(p), `${safeStem(p.name)}.e2spat`, "application/octet-stream");
}

function exportBank(): void {
  const res = buildBankFiles(project);
  showWarnings(res.warnings);
  const stem = safeStem(project.patterns[0]?.name || "tekkforge") + "-bank";
  download(res.allpat, `${stem}.e2sallpat`, "application/octet-stream");
  if (res.all) {
    // kleiner Delay, damit Browser beide Downloads annimmt
    setTimeout(() => download(res.all!, `${stem}-samples.all`, "application/octet-stream"), 350);
  }
}

function saveProject(): void {
  download(serializeProject(project), "projekt.tekkforge", "application/json");
  dirty = false;
  void sicherung?.erledigt();
}

async function openProject(file: File): Promise<void> {
  try {
    project = deserializeProject(await file.text());
    cur = 0;
    dirty = false;
    void sicherung?.erledigt();
    projektErsetzt();
    renderAll();
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  }
}

// ─── MIDI (SysEx-Transfer zum/vom Gerät) ─────────────────────────────────────

const midi = new MidiIO();
let midiChannel = 0;

// ─── Firmware-Modus (Stock / Hacktribe) ──────────────────────────────────────
//
// Stock kann SysEx, Global, CC und Program Change; NRPN-Live-Steuerung und
// RAM-Zugriff gibt es nur mit Hacktribe. Die Auswahl wird gemerkt; Default
// ist Stock — im Zweifel lieber eine Funktion zu wenig anbieten als eine,
// die am Gerät stumm ins Leere läuft.

function loadFirmware(): FirmwareMode {
  try {
    return parseFirmwareMode(globalThis.localStorage?.getItem(FIRMWARE_STORAGE_KEY));
  } catch {
    return "stock";
  }
}

let firmware: FirmwareMode = loadFirmware();

/** Setzt den Modus, merkt ihn und blendet die Hacktribe-Bereiche ein/aus. */
function setFirmware(mode: FirmwareMode, quelle: "auswahl" | "erkennung" | "start" = "auswahl"): void {
  firmware = mode;
  try {
    globalThis.localStorage?.setItem(FIRMWARE_STORAGE_KEY, mode);
  } catch {
    /* kein Speicher — dann gilt die Auswahl nur für diese Sitzung */
  }
  const sel = document.getElementById("fwMode") as HTMLSelectElement | null;
  if (sel && sel.value !== mode) sel.value = mode;
  const ramOk = featureAvailable(mode, "ramAccess");
  document.getElementById("ramPanel")?.classList.toggle("hidden", !ramOk);
  document.getElementById("fwRamNote")?.classList.toggle("hidden", ramOk);
  const note = document.getElementById("fwNote");
  if (note) {
    note.textContent =
      mode === "hacktribe"
        ? "Hacktribe: NRPN-Live-Steuerung (IFX, Part-Mute) und RAM-Zugriff freigeschaltet."
        : "Stock: SysEx-Übertragung, Slot-Write, Global, Regler-CCs und Auto-Sync. " +
          "IFX-Live-Senden, NRPN-Mute und RAM-Zugriff sind ausgeblendet (nur Hacktribe).";
  }
  if (quelle !== "start") setMidiStatus(`Firmware: ${FIRMWARE_LABEL[mode]}${quelle === "auswahl" ? " (manuell gewählt)" : ""}`);
}

/**
 * Erkennung per harmloser RAM-Leseanfrage (4 Bytes im DDR2-Bereich): Stock
 * kennt CMD 0x52 nicht und antwortet nie → Timeout → Stock. Ein belegter
 * Port sieht genauso aus — der Statustext sagt das dazu.
 */
async function firmwareDetect(): Promise<void> {
  if (!midi.available || !midi.outputs().length) {
    setMidiStatus("Erkennung braucht ein verbundenes Gerät — erst MIDI aktivieren.");
    return;
  }
  setMidiStatus("Firmware wird erkannt (RAM-Probe) …");
  let outcome: ProbeOutcome;
  try {
    const reply = await requestSysex(
      midi,
      buildRamReadRequest(FIRMWARE_PROBE.addr, FIRMWARE_PROBE.len, midiOpts()),
      (b) => b[6] === RAM_CMD.writeData && parseRamResponse(b)?.kind === "data",
      FIRMWARE_PROBE.timeoutMs,
    );
    outcome = parseRamResponse(reply)?.kind === "data" ? "reply" : "error";
  } catch {
    outcome = "timeout";
  }
  const mode = firmwareFromProbe(outcome);
  setFirmware(mode, "erkennung");
  setMidiStatus(probeStatusText(outcome, mode));
}
let midiProductId = E2_PRODUCT_ID_SAMPLER;

function midiOpts(): E2SysexOptions {
  return { channel: midiChannel, productId: midiProductId };
}

/**
 * Brücke für den E2S-Panel-Tab. Der KORG-USB-Treiber ist Single-Client — es
 * darf nur EINE MidiIO existieren, deshalb teilt sich das Panel Instanz,
 * gefundenen Kanal und Projektzustand mit dem Editor, statt selbst Ports zu
 * öffnen. MIDI aktivieren/verbinden bleibt Sache des Editor-MIDI-Panels.
 */
export const panelBridge = {
  midi,
  midiOpts,
  /** Vom Panel gesetzt: bekommt jede eingehende MIDI-Nachricht (Live-Mitlauf). */
  onIncoming: null as ((bytes: number[]) => void) | null,
  get midiChannel(): number {
    return midiChannel;
  },
  /** Stock oder Hacktribe — entscheidet, ob das Panel NRPN senden darf. */
  get firmware(): FirmwareMode {
    return firmware;
  },
  get project(): EditorProject {
    return project;
  },
  get patternIndex(): number {
    return cur;
  },
  set patternIndex(i: number) {
    cur = Math.max(0, Math.min(project.patterns.length - 1, i));
    renderAll();
  },
  writePatternToSlot,
  writePatternToSlotDirect,
  markDirty,
};

/** 0x4000-Body des aktuellen Patterns (ohne 0x100-Dateiheader). */
function currentPatternBody(): Uint8Array {
  return buildPatternFile(project.patterns[cur]).slice(0x100);
}

function setMidiStatus(text: string): void {
  $("midiStatus").textContent = text;
}

function refreshMidiPorts(): void {
  const fill = (
    sel: HTMLSelectElement,
    ports: { id: string; label?: string }[],
    selId: string | null,
  ) => {
    sel.innerHTML = ports
      .map((p) => `<option value="${p.id}">${escapeHtml(p.label ?? p.id)}</option>`)
      .join("");
    if (selId) sel.value = selId;
  };
  fill($<HTMLSelectElement>("midiOut"), midi.outputs(), midi.selectedOutput);
  fill($<HTMLSelectElement>("midiIn"), midi.inputs(), midi.selectedInput);
}

let midiMonitorLines: string[] = [];
/** Anzahl unterdrückter Realtime-Bytes seit der letzten echten Zeile. */
let midiClockSuppressed = 0;

function pushMonitor(dir: "◀ IN" | "▶ OUT", bytes: number[]): void {
  // MIDI-Clock (0xF8) und Active Sensing (0xFE) kommen im Sekundentakt
  // dutzendfach. Ungefiltert schieben sie die 12 Zeilen sofort voll, und
  // genau die Antwort, für die der Monitor da ist — der SysEx-Rückweg vom
  // Gerät — ist verschwunden, bevor man sie lesen kann. Bei laufendem
  // Sequencer war der Monitor dadurch praktisch nutzlos: gesucht wurde eine
  // ausbleibende Geräteantwort, angezeigt wurden nur f8-Zeilen.
  //
  // Also nicht anzeigen, aber auch nicht verschweigen — der Zähler belegt,
  // dass Daten hereinkommen. Das ist bei der Fehlersuche der entscheidende
  // Unterschied: „Port stumm" oder „Port lebt, nur keine SysEx-Antwort".
  const st = bytes[0];
  if (bytes.length === 1 && (st === 0xf8 || st === 0xfe)) {
    midiClockSuppressed++;
    const head = `(${midiClockSuppressed}× Clock/Sensing ausgeblendet)`;
    const rest = midiMonitorLines.filter((l) => !l.startsWith("(") || !l.includes("ausgeblendet"));
    $("midiMonitor").textContent = [head, ...rest].join("\n");
    return;
  }
  midiClockSuppressed = 0;
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const kind = st === 0xf0 ? "SysEx" : "MIDI";
  midiMonitorLines.unshift(
    `${dir} ${kind}[${bytes.length}]: ${hex.length > 160 ? hex.slice(0, 160) + " …" : hex}`,
  );
  midiMonitorLines = midiMonitorLines.slice(0, 12);
  $("midiMonitor").textContent = midiMonitorLines.join("\n");
}

async function midiEnable(): Promise<void> {
  try {
    await midi.enable();
    midi.onPortsChanged = () => refreshMidiPorts();
    midi.onAnyMessage = (bytes) => {
      pushMonitor("◀ IN", bytes);
      panelBridge.onIncoming?.(bytes);
    };
    midi.onSent = (bytes) => pushMonitor("▶ OUT", bytes);
    refreshMidiPorts();
    $("midiEnable").classList.add("hidden");
    $("midiControls").classList.remove("hidden");
    const outName = midi.outputs().find((p) => p.id === midi.selectedOutput)?.label ?? "?";
    if (!midi.outputs().length) {
      setMidiStatus("kein MIDI-Port gefunden");
      return;
    }
    // Ausgang upfront öffnen (im Worker → kein Freeze), Eingang best-effort.
    setMidiStatus(`öffne Ports (Ausgang: ${outName}) …`);
    try {
      const { inputOk, inputError } = await midi.connect();
      setMidiStatus(
        `verbunden — Ausgang: ${outName}` +
          (inputOk ? " (Empfang aktiv)." : `. ⚠ Empfang nicht verfügbar: ${inputError}`) +
          ` — „→ Gerät (Live)" oder „Gerät suchen".`,
      );
    } catch (err) {
      setMidiStatus(
        `Ausgang konnte nicht geöffnet werden (${err instanceof Error ? err.message : err}). ` +
          `Anderen Port wählen oder Gerät/USB prüfen.`,
      );
    }
  } catch (err) {
    alert(`MIDI konnte nicht aktiviert werden: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function midiSearchDevice(): Promise<void> {
  try {
    setMidiStatus("suche Gerät …");
    const reply = await requestSysex(
      midi,
      buildSearchDevice(),
      (b) => parseSearchReply(b) !== null,
      2000,
    );
    const r = parseSearchReply(reply)!;
    midiChannel = r.channel;
    midiProductId = r.productId;
    const kind = r.productId === E2_PRODUCT_ID_SAMPLER ? "Sampler" : "Synth";
    setMidiStatus(`gefunden: E2 ${kind} · Ch ${r.channel + 1} · v${r.version}`);
  } catch {
    const outName = midi.outputs().find((p) => p.id === midi.selectedOutput)?.label ?? "?";
    setMidiStatus(
      `keine Antwort. Ausgang = „${outName}" — muss „electribe2 sampler" sein (nicht GS Wavetable). ` +
        `Kommt im Monitor gar nichts an, ist meist der Port belegt: der KORG-Treiber ` +
        `lässt nur ein Programm gleichzeitig zu. ` +
        `Suche ist optional: „→ Gerät (Live)" geht auch mit Standard (Ch 1, Sampler).`,
    );
  }
}

async function midiSendCurrent(): Promise<void> {
  setMidiStatus("sende …");
  try {
    const msg = buildCurrentPatternDump(currentPatternBody(), midiOpts());
    await midi.sendAsync(msg);
    // Ties ueberleben diesen Weg nicht: das Geraet begrenzt die Gate-Zeit beim
    // Laden ueber SysEx auf 96. Ueber SD-Karte kommt derselbe Wert als Tie an —
    // beides am Geraet gemessen. Ohne Hinweis sucht man den Fehler bei sich.
    const ties = project.patterns[cur].parts.reduce(
      (n, part) => n + part.steps.filter((st) => st.on && st.gate >= EDITOR_GATE_MAX).length,
      0,
    );
    setMidiStatus(
      `„${project.patterns[cur].name}" → Edit-Buffer gesendet (${msg.length} Bytes)` +
        (ties
          ? ` — Achtung: ${ties} Tie${ties === 1 ? "" : "s"} gehen auf diesem Weg verloren ` +
            `(das Gerät kürzt sie auf Gate 96). Über SD-Karte bleiben sie erhalten.`
          : ""),
    );
  } catch (err) {
    setMidiStatus(`Senden fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
  }
}

/** Wartet auf eine ACK-Antwort des Geräts. Ergebnis:
 *  "ok" (Erfolgs-ACK) · "error:<name>" (Fehler-ACK) · "timeout" (keine Antwort). */
async function waitDeviceAck(timeoutMs: number): Promise<string> {
  const reply = await waitSysex(
    midi,
    (b) => {
      const id = parseAck(b);
      return id !== null && (E2_ACK_OK.has(id) || E2_ACK_ERROR.has(id));
    },
    timeoutMs,
  );
  if (!reply) return "timeout";
  const id = parseAck(reply)!;
  if (E2_ACK_OK.has(id)) return "ok";
  const names: Record<number, string> = {
    0x22: "Write-Fehler",
    0x24: "Daten-Lade-Fehler",
    0x26: "Format-Fehler",
  };
  return `error:${names[id] ?? `0x${id.toString(16)}`}`;
}

/**
 * Schreibt EIN Pattern DIREKT auf einen Slot: 0x4C-Dump mit Slot-Nummer.
 * KORG MIDI-Implementation (6): „Receive this message & data, save them to
 * Internal Memory" — der Edit-Buffer und damit das laufende Pattern bleiben
 * unberührt. Das ist der Weg für „Pattern vorbereiten, während ein anderes
 * spielt". Wartet auf die Lade-Bestätigung (0x23) bzw. meldet Fehler (0x24).
 * @returns true bei Geräte-Bestätigung, false bei Timeout (gesendet, unbestätigt).
 */
async function writePatternToSlotDirect(p: EditorPattern, slot1based: number): Promise<boolean> {
  const body = new Uint8Array(buildPatternFile(p).slice(0x100));
  const ack = waitDeviceAck(8000);
  await midi.sendAsync(buildPatternDump(body, slot1based - 1, midiOpts()));
  const result = await ack;
  if (result.startsWith("error")) throw new Error(`Gerät meldet ${result.slice(6)} beim Slot-Dump`);
  if (result === "timeout") {
    await new Promise((r) => setTimeout(r, 900));
    return false;
  }
  return true;
}

/**
 * Schreibt EIN Pattern dauerhaft auf einen Slot: 0x40 (Edit-Buffer) + 0x11
 * (Write-Buffer→Slot). ⚠ Geht durch den Edit-Buffer — das gerade spielende
 * Pattern wird dabei ersetzt. Für Slots, die nicht das aktive Pattern sind,
 * `writePatternToSlotDirect` nehmen. Da der Rückkanal funktioniert, wird nach jedem Schritt
 * auf die Geräte-Bestätigung gewartet (0x23 nach Dump, 0x21 nach Write) —
 * das verhindert das Überrennen des Geräts bei Bulk-Transfers. Fällt bei
 * ACK-Timeout auf konservative Delays zurück.
 * @returns true wenn beide Schritte bestätigt wurden.
 */
async function writePatternToSlot(p: EditorPattern, slot1based: number): Promise<boolean> {
  const body = new Uint8Array(buildPatternFile(p).slice(0x100));
  // Schritt 1: Dump in den Edit-Buffer, auf Lade-Bestätigung warten.
  const ackDump = waitDeviceAck(4000);
  await midi.sendAsync(buildCurrentPatternDump(body, midiOpts()));
  const dumpResult = await ackDump;
  if (dumpResult.startsWith("error")) throw new Error(`Gerät meldet ${dumpResult.slice(6)} beim Dump`);
  if (dumpResult === "timeout") await new Promise((r) => setTimeout(r, 400));
  // Schritt 2: Buffer → Slot schreiben, auf Write-Bestätigung warten (Flash!).
  const ackWrite = waitDeviceAck(8000);
  await midi.sendAsync(buildPatternWrite(slot1based - 1, midiOpts()));
  const writeResult = await ackWrite;
  if (writeResult.startsWith("error")) throw new Error(`Gerät meldet ${writeResult.slice(6)} beim Write`);
  if (writeResult === "timeout") {
    await new Promise((r) => setTimeout(r, 900));
    return false;
  }
  return true;
}

async function midiSendSlot(): Promise<void> {
  const slot = Number($<HTMLInputElement>("midiSlot").value);
  if (!Number.isFinite(slot) || slot < 1 || slot > 250) {
    alert("Slot muss 1–250 sein.");
    return;
  }
  if (!confirm(`Pattern dauerhaft auf Geräte-Slot ${slot} schreiben? Überschreibt den dortigen Inhalt.`))
    return;
  setMidiStatus("sende …");
  try {
    // Direktweg (0x4C mit Slot-Nummer): laesst den Edit-Buffer und damit das
    // spielende Pattern in Ruhe. Will man das Ergebnis sofort hoeren, danach
    // „Pattern → Gerät (Live)" oder im Panel das Pattern anwaehlen.
    const confirmed = await writePatternToSlotDirect(project.patterns[cur], slot);
    setMidiStatus(
      `„${project.patterns[cur].name}" → Slot ${slot} direkt ` +
        (confirmed ? "geschrieben — vom Gerät bestätigt ✓ (Edit-Buffer unberührt)" : "gesendet (keine Geräte-Bestätigung — am Gerät prüfen)"),
    );
  } catch (err) {
    setMidiStatus(`Senden fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
  }
}

/** Alle Projekt-Patterns nacheinander auf die Geräte-Slots ab Start schreiben. */
async function midiSendAll(): Promise<void> {
  const start = Number($<HTMLInputElement>("midiSlot").value) || 1;
  const count = project.patterns.length;
  if (start + count - 1 > 250) {
    alert(`Passt nicht: ${count} Patterns ab Slot ${start} überschreitet 250.`);
    return;
  }
  if (
    !confirm(
      `${count} Pattern(s) auf die Geräte-Slots ${start}–${start + count - 1} schreiben? Überschreibt deren Inhalt.`,
    )
  )
    return;
  try {
    let confirmed = 0;
    for (let i = 0; i < count; i++) {
      setMidiStatus(`schreibe ${i + 1}/${count} → Slot ${start + i} …`);
      const ok = await writePatternToSlot(project.patterns[i], start + i);
      if (ok) confirmed++;
      // Atempause zwischen Patterns — auch nach ACK braucht das Gerät kurz.
      await new Promise((r) => setTimeout(r, 250));
    }
    setMidiStatus(
      `${count} Pattern(s) auf Slots ${start}–${start + count - 1} geschrieben` +
        (confirmed === count ? " — alle vom Gerät bestätigt ✓" : ` (${confirmed}/${count} bestätigt)`),
    );
  } catch (err) {
    setMidiStatus(`Abbruch: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Holt ein Pattern vom Gerät ins Projekt.
 *   quelle "slot":    0x1C-Request für die Slot-Nummer aus dem Feld → 0x4C-Dump
 *                     aus dem internen Speicher. Laesst das spielende Pattern
 *                     in Ruhe — der Weg für „Vorschau/Bearbeiten, während ein
 *                     anderes Pattern laeuft". ✔ Am Gerät bei laufendem
 *                     Sequencer geprüft (2026-08-22).
 *   quelle "current": 0x10-Request → 0x40-Dump des Edit-Buffers (das, was
 *                     gerade spielt; bei laufendem Sequencer unzuverlässig).
 */
async function midiGetPattern(quelle: "slot" | "current" = "slot"): Promise<void> {
  const slot = Number($<HTMLInputElement>("midiSlot").value);
  if (quelle === "slot" && (!Number.isFinite(slot) || slot < 1 || slot > 250)) {
    setMidiStatus("Slot muss 1–250 sein.");
    return;
  }
  try {
    // Bei laufendem Sequencer geht etwa jede vierte 16-KB-Antwort verloren
    // (gemessen 2026-08-22) — bis zu drei Anläufe, bevor es ein Fehler ist.
    let reply: Uint8Array | null = null;
    for (let versuch = 1; versuch <= 3 && !reply; versuch++) {
      setMidiStatus(
        (quelle === "slot" ? `fordere Slot ${slot} an` : "fordere Edit-Buffer an") + (versuch > 1 ? ` (Versuch ${versuch}/3)` : "") + " …",
      );
      try {
        reply = await requestSysex(
          midi,
          quelle === "slot" ? buildPatternRequest(slot - 1, midiOpts()) : buildCurrentPatternRequest(midiOpts()),
          (b) => {
            const d = decodeDump(b);
            return d !== null && (quelle === "current" ? d.index === null : d.index === slot - 1);
          },
          4000,
        );
      } catch (e) {
        if (versuch === 3) throw e;
      }
    }
    const dump = decodeDump(reply!)!;
    const pattern = editorPatternFromBody(dump.body);
    project.patterns.splice(cur + 1, 0, pattern);
    cur += 1;
    markDirty();
    renderAll();
    setMidiStatus(
      quelle === "slot"
        ? `Slot ${slot} „${pattern.name}" vom Gerät geholt (Edit-Buffer unberührt)`
        : `Edit-Buffer „${pattern.name}" vom Gerät geholt`,
    );
  } catch (err) {
    setMidiStatus(`Holen fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
  }
}

// ─── Geräte-RAM (Hacktribe) ──────────────────────────────────────────────────
//
// Lesen ist harmlos, Schreiben trifft laufenden Code. Der Ablauf ist deshalb
// fest verdrahtet und nicht abkürzbar:
//
//   Vorher-Lesen → Bestätigen → paarweise schreiben → Zurücklesen → Vergleich
//
// Ohne erfolgreiche Vorher-Lesung gibt es kein Undo, und ohne Undo wird nicht
// geschrieben — das ist ein harter Abbruch, keine wegklickbare Warnung.

/**
 * Vorher-Stand des zuletzt geschriebenen Bereichs. Bewusst im Modul-Scope und
 * nicht in einer Closure: der Schnappschuss muss einen fehlgeschlagenen Write
 * und ein Neuzeichnen des Panels überleben, sonst ist er wertlos.
 */
let ramSnapshot: { addr: number; bytes: Uint8Array } | null = null;
/** Was beim nächsten „Wirklich schreiben" rausgeht — erst nach Vorher-Lesung gesetzt. */
let ramPending: { addr: number; bytes: Uint8Array } | null = null;

function setRamStatus(text: string): void {
  $("ramStatus").textContent = text;
}

/**
 * Liest `len` Bytes ab `addr` vom Gerät.
 *
 * Prüft Bereich, filtert auf die echte Geräte-Antwort (cmd 0x54 — die eigene
 * 0x52-Anfrage kommt bei aktivem MIDI-Thru am Eingang zurück) und besteht auf
 * voller Länge: eine kurze Antwort ist ein Fehlschlag, keine Teilmenge.
 */
async function ramReadBytes(
  addr: number,
  len: number,
): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }> {
  const range = validateRamRange(addr, len);
  if (!range.ok) return { ok: false, reason: range.reason };
  const chunks = splitRamRead(addr, len);
  const out = new Uint8Array(len);
  let off = 0;
  for (const [i, c] of chunks.entries()) {
    // Jedes Häppchen ist eine eigene Anfrage mit eigenem Timeout — ohne
    // Rückmeldung sieht ein Mehrfach-Lesevorgang wie ein Hänger aus.
    if (chunks.length > 1) setRamStatus(`Lese Häppchen ${i + 1}/${chunks.length}…`);
    let reply: Uint8Array;
    try {
      reply = await requestSysex(
        midi,
        buildRamReadRequest(c.addr, c.len, midiOpts()),
        (b) => b[6] === RAM_CMD.writeData && parseRamResponse(b)?.kind === "data",
        2500,
      );
    } catch (e) {
      return {
        ok: false,
        // Reihenfolge der Verdächtigen ist Absicht: der belegte Port kommt
        // zuerst, weil er stumm ist und wie ein totes Gerät aussieht. Die
        // Hacktribe-Frage stand hier mal vorn und hat die Fehlersuche prompt
        // in die Firmware-Ecke geschickt, obwohl nur ein zweites Programm am
        // selben Port hing.
        reason: `keine Antwort bei 0x${c.addr.toString(16).toUpperCase()}. ${String(e)}`,
      };
    }
    const parsed = parseRamResponse(reply);
    if (!parsed || parsed.kind !== "data" || parsed.data.length < c.len) {
      return {
        ok: false,
        reason: `unvollständige Antwort bei 0x${c.addr.toString(16).toUpperCase()} (${parsed?.kind === "data" ? parsed.data.length : 0} von ${c.len} Bytes)`,
      };
    }
    out.set(parsed.data.subarray(0, c.len), off);
    off += c.len;
  }
  return { ok: true, bytes: out };
}

/** Adresse + Länge aus den Eingabefeldern (Adressfeld ist die einzige Quelle). */
function ramInputs(): { ok: true; addr: number; len: number } | { ok: false; reason: string } {
  const a = parseAddress($<HTMLInputElement>("ramAddr").value);
  if (!a.ok) return { ok: false, reason: a.reason };
  const len = Number($<HTMLInputElement>("ramLen").value);
  if (!Number.isInteger(len) || len <= 0) return { ok: false, reason: "Länge muss positiv sein" };
  return { ok: true, addr: a.addr, len };
}

/** Verbirgt Commit/Undo und verwirft den vorbereiteten Write. */
function ramResetPending(): void {
  ramPending = null;
  $("ramCommit").classList.add("hidden");
}

/** Pause zwischen den Frames eines Schreibvorgangs (Synthstudio-Referenzwert). */
const RAM_CHUNK_DELAY_MS = 30;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Schreibt `bytes` nach `addr` und liest zur Kontrolle zurück.
 *
 * ☠ Der Ablauf ist getaktet, nicht geflutet. Jedes Häppchen ist
 * `0x53` (Adresse) → Pause → `0x54` (Daten) → **auf ACK `0x21` warten** →
 * Pause. Frühere Fassung hat alle Frames am Stück rausgeschickt und auf nichts
 * gewartet — am Gerät zeigte der Bildschirm daraufhin bei JEDEM Versuch
 * „Midi error", der erst mit Exit quittiert werden musste. Solange dieser
 * Dialog steht, verarbeitet das Gerät kein SysEx mehr; die anschließende
 * Rückleseprobe lief deshalb in den Timeout und meldete „Zustand UNBEKANNT",
 * und ein halb angekommener Write hinterließ ein zerschossenes Preset.
 *
 * Das ACK ist damit kein Luxus: es ist das einzige Signal, dass das Gerät das
 * Häppchen überhaupt angenommen hat.
 */
async function ramWriteVerified(addr: number, bytes: Uint8Array, what: string): Promise<void> {
  const range = validateRamRange(addr, bytes.length);
  if (!range.ok) {
    setRamStatus(`${what} abgebrochen: ${range.reason}`);
    return;
  }
  const chunks = splitRamWrite(addr, bytes);
  let written = 0;

  for (const [i, chunk] of chunks.entries()) {
    const nr = `${i + 1}/${chunks.length}`;
    setRamStatus(`${what}: sende Häppchen ${nr} (${written}/${bytes.length} B)…`);
    try {
      // ☠ Die Antwort auf die ADRESS-Setzung muss konsumiert werden, bevor der
      // Datenframe rausgeht. Die Urquelle (hacktribe e2sysex.py
      // `write_cpu_ram`) liest sie ausdrücklich — „Ignore response for now"
      // heißt: Inhalt egal, aber sie wird abgeholt.
      //
      // Ohne das fängt das Warten nach `0x54` das VERSPÄTETE ACK der
      // Adress-Setzung ein und meldet Erfolg, während der Datenframe
      // unquittiert bleibt. Im MIDI-Mitschnitt sieht beides identisch aus —
      // ein ACK nach dem Datenframe —, weshalb der Fehler lange unsichtbar war.
      await requestSysex(
        midi,
        buildRamWriteAddress(chunk.addr, chunk.bytes.length, midiOpts()),
        (b) => isKorgSysex(b),
        4000,
      ).catch(() => undefined); // manche Firmwarestände antworten hier nicht
      await sleep(RAM_CHUNK_DELAY_MS);
      // Jetzt erst die Daten — und auf DEREN Bestätigung warten.
      const reply = await requestSysex(
        midi,
        buildRamWriteData(chunk.bytes, midiOpts()),
        (b) => parseRamResponse(b)?.kind === "ack",
        4000,
      );
      if (parseRamResponse(reply)?.kind !== "ack") {
        setRamStatus(
          `${what} abgebrochen: Gerät hat Häppchen ${nr} nicht bestätigt (${written} B bereits geschrieben).`,
        );
        return;
      }
    } catch (e) {
      setRamStatus(
        `${what} abgebrochen bei Häppchen ${nr}: ${String(e)} — ${written} von ${bytes.length} B geschrieben, ` +
          `Zustand im Gerät UNVOLLSTÄNDIG. Zeigt das Gerät „Midi error"? Dann mit Exit quittieren.`,
      );
      return;
    }
    written += chunk.bytes.length;
    await sleep(RAM_CHUNK_DELAY_MS);
  }

  let back = await ramReadBytes(addr, bytes.length);
  if (!back.ok) {
    // Einmal nachfassen, bevor wir „unbekannt" melden — das Gerät ist nach
    // einem Write kurz beschäftigt.
    setRamStatus(`${what}: Rückleseprobe wird wiederholt…`);
    await sleep(1200);
    back = await ramReadBytes(addr, bytes.length);
  }
  if (!back.ok) {
    setRamStatus(
      `${what}: gesendet, aber die Rückleseprobe schlug fehl (${back.reason}). Zustand im Gerät UNBEKANNT.`,
    );
    return;
  }
  const v = verifyRamWrite(bytes, back.bytes);
  $("ramDump").textContent = formatHexDump(back.bytes, addr);
  setRamStatus(
    v.ok
      ? `✓ ${what}: ${bytes.length} Bytes geschrieben und zurückgelesen — identisch.`
      : `✗ ${what}: ${v.diffCount < 0 ? "Länge weicht ab" : `${v.diffCount} Byte(s) abweichend, erstes bei +${v.firstDiff}`}.`,
  );
}

function setupRamPanel(): void {
  const structSel = $<HTMLSelectElement>("ramStruct");
  structSel.innerHTML =
    `<option value="">(freie Adresse)</option>` +
    E2_RAM_MAP.map((e) => `<option value="${e.key}">${escapeHtml(e.label)}</option>`).join("");

  const addrIn = $<HTMLInputElement>("ramAddr");
  const lenIn = $<HTMLInputElement>("ramLen");
  const slotIn = $<HTMLInputElement>("ramSlot");

  // Struktur/Slot berechnen die Adresse. Eine Handeingabe im Adressfeld setzt
  // die Struktur auf „frei" zurück — sonst zeigte das Dropdown eine Struktur an,
  // während die Adresse längst woanders hinzeigt. Beide Werte wären für sich
  // gültig, und genau das fangen die Bereichsprüfungen nicht ab.
  const applyStruct = () => {
    const entry = findRamMapEntry(structSel.value);
    if (!entry) {
      $("ramNote").textContent = "";
      return;
    }
    slotIn.max = String(entry.count - 1);
    const slot = Math.max(0, Math.min(entry.count - 1, Number(slotIn.value) || 0));
    slotIn.value = String(slot);
    addrIn.value = `0x${addressForSlot(entry, slot).toString(16).toUpperCase()}`;
    lenIn.value = String(entry.size);
    $("ramNote").textContent = `${entry.label} — Slot 0–${entry.count - 1}${entry.note ? ` · ${entry.note}` : ""}`;
    ramResetPending();
  };
  structSel.addEventListener("change", applyStruct);
  slotIn.addEventListener("change", applyStruct);
  addrIn.addEventListener("input", () => {
    structSel.value = "";
    $("ramNote").textContent = "freie Adresse — Struktur-Auswahl aufgehoben";
    ramResetPending();
  });
  lenIn.addEventListener("input", ramResetPending);
  $<HTMLTextAreaElement>("ramHex").addEventListener("input", ramResetPending);

  $("ramRead").addEventListener("click", () => {
    const inp = ramInputs();
    if (!inp.ok) return setRamStatus(`Nicht gelesen: ${inp.reason}`);
    setRamStatus("Lese…");
    void (async () => {
      const r = await ramReadBytes(inp.addr, inp.len);
      if (!r.ok) return setRamStatus(`Lesen fehlgeschlagen: ${r.reason}`);
      $("ramDump").textContent = formatHexDump(r.bytes, inp.addr);
      $<HTMLTextAreaElement>("ramHex").value = formatHexDump(r.bytes, inp.addr)
        .split("\n")
        .map((l) => l.slice(10))
        .join("\n");
      ramResetPending();
      setRamStatus(`${r.bytes.length} Bytes gelesen. Bearbeiten, dann „Schreiben vorbereiten".`);
    })();
  });

  // Schritt 1: prüfen und Vorher-Stand sichern. Schreibt noch nichts.
  $("ramPrepare").addEventListener("click", () => {
    const inp = ramInputs();
    if (!inp.ok) return setRamStatus(`Abbruch: ${inp.reason}`);
    const hex = parseHexBytes($<HTMLTextAreaElement>("ramHex").value);
    if (!hex.ok) return setRamStatus(`Abbruch: ${hex.reason}`);
    if (hex.bytes.length !== inp.len) {
      // Sonst landet ein zu kurzer Block an einer gültigen Adresse: Bereichs-
      // prüfung besteht, und die Längenabweichung fiele erst NACH dem Schreiben
      // beim Vergleich auf.
      return setRamStatus(
        `Abbruch: ${hex.bytes.length} Bytes eingegeben, ${inp.len} erwartet. Länge muss exakt passen.`,
      );
    }
    const range = validateRamRange(inp.addr, inp.len);
    if (!range.ok) return setRamStatus(`Abbruch: ${range.reason}`);

    setRamStatus("Sichere Vorher-Stand…");
    void (async () => {
      const before = await ramReadBytes(inp.addr, inp.len);
      if (!before.ok) {
        // Harter Abbruch: kein Schnappschuss → kein Undo → nicht schreiben.
        ramResetPending();
        return setRamStatus(
          `Nicht geschrieben: Vorher-Stand nicht lesbar (${before.reason}). Ohne Rückweg wird nichts geschrieben.`,
        );
      }
      ramSnapshot = { addr: inp.addr, bytes: before.bytes };
      ramPending = { addr: inp.addr, bytes: hex.bytes };
      $("ramCommit").classList.remove("hidden");
      // Der Undo-Knopf bleibt bewusst stehen, auch wenn danach Adresse oder
      // Struktur geändert werden — er ist der Rückweg und soll nicht durch ein
      // Antippen eines Feldes verschwinden. Damit er dann nicht heimlich woanders
      // hinschreibt als das Panel anzeigt, trägt er sein Ziel im Text.
      const undoBtn = $("ramUndo");
      undoBtn.textContent = `↶ Zurückschreiben nach 0x${inp.addr.toString(16).toUpperCase()} (${before.bytes.length} B)`;
      undoBtn.classList.remove("hidden");
      const v = verifyRamWrite(before.bytes, hex.bytes);
      setRamStatus(
        v.ok
          ? `Vorher-Stand gesichert — die Eingabe ist mit dem Gerätestand identisch, ein Write ändert nichts.`
          : `Vorher-Stand gesichert (${inp.len} B). ${v.diffCount} Byte(s) würden sich ändern, erstes bei +${v.firstDiff}. Gerät darf nicht spielen.`,
      );
    })();
  });

  // Schritt 2: die eigentliche Bestätigung — ein zweiter, bewusster Klick.
  $("ramCommit").addEventListener("click", () => {
    if (!ramPending) return setRamStatus("Nichts vorbereitet.");
    const { addr, bytes } = ramPending;
    ramResetPending();
    void ramWriteVerified(addr, bytes, "Schreiben");
  });

  $("ramUndo").addEventListener("click", () => {
    if (!ramSnapshot) return setRamStatus("Kein Vorher-Stand vorhanden.");
    const { addr, bytes } = ramSnapshot;
    // Bewusst über denselben Pfad inkl. Rückleseprobe: eine ungeprüfte
    // Wiederherstellung hätte dasselbe Problem wie ein ungeprüfter Write.
    void ramWriteVerified(addr, bytes, "Zurückschreiben");
  });

  // Der Preset-Editor benutzt denselben Lese- und Schreibpfad — ein Schreibweg,
  // eine Stelle mit Schnappschuss und Rückleseprobe.
  initFxPresetPanel({
    lesen: ramReadBytes,
    schreiben: async (addr, bytes, was) => {
      ramSnapshot = ramSnapshot ?? null;
      await ramWriteVerified(addr, bytes, was);
    },
    midi: (bytes) => void panelBridge.midi.send(Uint8Array.from(bytes)),
  });
}

/**
 * Holt den Global-Datenblock (256 B) vom Geraet und legt ihn als Hex in das
 * RAM-Panel — dort steht schon ein Hex-Dump-Feld, und Globals sind genau wie
 * RAM-Inhalte etwas, das man liest und vergleicht.
 */
async function midiGetGlobal(): Promise<void> {
  setMidiStatus("hole Global-Block…");
  try {
    const reply = await requestSysex(
      midi,
      buildGlobalRequest(midiOpts()),
      (b) => decodeGlobalDump(b) !== null,
      4000,
    );
    const g = decodeGlobalDump(reply);
    if (!g) {
      setMidiStatus("Antwort war kein Global-Block (Magic GLST fehlt).");
      return;
    }
    $("ramDump").textContent = formatHexDump(g, 0);
    $<HTMLTextAreaElement>("ramHex").value = formatHexDump(g, 0)
      .split(/\r?\n/)
      .map((l) => l.slice(10))
      .join("\n");
    $("ramPanel").setAttribute("open", "");
    setMidiStatus(`Global-Block geholt: ${g.length} Bytes — steht im RAM-Panel.`);
  } catch (err) {
    setMidiStatus(`Global holen fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
  }
}

function setupMidi(): void {
  if (!midi.available) {
    $("midiEnable").classList.add("hidden");
    $("midiUnavailable").classList.remove("hidden");
    return;
  }
  setupRamPanel();
  $("midiEnable").addEventListener("click", () => void midiEnable());
  $<HTMLSelectElement>("midiOut").addEventListener("change", (e) =>
    midi.selectOutput((e.target as HTMLSelectElement).value),
  );
  $<HTMLSelectElement>("midiIn").addEventListener("change", (e) =>
    midi.selectInput((e.target as HTMLSelectElement).value),
  );
  $("midiSearch").addEventListener("click", () => void midiSearchDevice());
  $<HTMLSelectElement>("fwMode").addEventListener("change", (e) =>
    setFirmware(parseFirmwareMode((e.target as HTMLSelectElement).value)),
  );
  $("fwDetect").addEventListener("click", () => void firmwareDetect());
  setFirmware(firmware, "start"); // gemerkte Auswahl anwenden (RAM-Panel ein/aus)
  $("midiSendCurrent").addEventListener("click", midiSendCurrent);
  $("midiSendSlot").addEventListener("click", midiSendSlot);
  $("midiSendAll").addEventListener("click", () => void midiSendAll());
  $("midiGet").addEventListener("click", () => void midiGetPattern("slot"));
  $("midiGetCurrent").addEventListener("click", () => void midiGetPattern("current"));
  $("midiGlobal").addEventListener("click", () => void midiGetGlobal());
}

/**
 * Import von Geräte-Dateien: eine Pattern-Datei (.e2spat/.e2sallpat, optional
 * mit begleitender .all-Sample-Bank) ersetzt das Projekt; eine alleinige
 * .all-Datei wird nur in den Sample-Pool gemerged.
 */
async function importE2Files(files: FileList | File[]): Promise<void> {
  const arr = Array.from(files);
  const patFile = arr.find((f) => /\.(e2spat|e2sallpat|e2pat|e2allpat)$/i.test(f.name));
  const allFile = arr.find((f) => /\.all$/i.test(f.name));
  try {
    if (patFile) {
      const patBytes = new Uint8Array(await patFile.arrayBuffer());
      const allBytes = allFile ? new Uint8Array(await allFile.arrayBuffer()) : null;
      const proj = editorProjectFromE2Files(patBytes, allBytes);
      if (loadProject(proj)) {
        alert(
          `Importiert: ${proj.patterns.length} Pattern(s)` +
            (allBytes ? ` + ${proj.samples.length} Sample(s)` : "") +
            (allBytes
              ? ""
              : "\n\nHinweis: ohne .all-Sample-Bank kennen die Parts nur die Sample-Nummern (kein Audio). Eine passende .all mit-importieren oder Samples im Pool ergänzen."),
        );
      }
    } else if (allFile) {
      const pool = importSamplesFromAll(new Uint8Array(await allFile.arrayBuffer()));
      const added = mergeSamples(pool);
      markDirty();
      renderAll();
      alert(`${added} Sample(s) in den Pool importiert${added < pool.length ? ` (${pool.length - added} übersprungen — Nummer schon belegt)` : ""}.`);
    } else {
      alert("Bitte eine .e2spat-, .e2sallpat- oder .all-Datei wählen.");
    }
  } catch (err) {
    alert(`Import fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ─── Preview ─────────────────────────────────────────────────────────────────

function togglePreview(): void {
  const btn = $("previewPlay");
  if (player.playing) {
    player.stop();
    btn.textContent = "▶ Vorhören";
  } else {
    player.start(project.patterns[cur], project.samples);
    btn.textContent = "■ Stop";
  }
}

player.onStep = (step) => {
  document.querySelectorAll(".stepCell.play").forEach((c) => c.classList.remove("play"));
  if (step < 0) return;
  document
    .querySelectorAll(`.stepCell[data-step="${step}"]`)
    .forEach((c) => c.classList.add("play"));
};

// ─── Render + Wiring ─────────────────────────────────────────────────────────

function renderAll(): void {
  renderPatList();
  renderGlobals();
  renderGrid();
  renderPool();
  // Die Song-Auswahl listet die Patterns — sie muss mitwachsen
  renderSong();
}

// ─── Song-Modus ──────────────────────────────────────────────────────────────

/** Die Abfolge lebt fuer die Sitzung; geschrieben wird sie in die Ketten. */
let song: SongSchritt[] = [];

function songInfo(t: string): void {
  const el = document.getElementById("songInfo");
  if (el) el.textContent = t;
}

function renderSong(): void {
  const sel = document.getElementById("songPattern") as HTMLSelectElement | null;
  const liste = document.getElementById("songListe");
  if (!sel || !liste) return;
  const gewaehlt = sel.value;
  sel.innerHTML = project.patterns
    .map((p, i) => `<option value="${i}">${i + 1}. ${escapeHtml(p.name)}</option>`)
    .join("");
  if (gewaehlt && Number(gewaehlt) < project.patterns.length) sel.value = gewaehlt;
  liste.innerHTML = song.length
    ? `<div class="startListe" style="font-size:11px">${song
        .map(
          (s, i) =>
            `<div><span class="rolle">${i + 1}</span><span style="flex:1">${escapeHtml(project.patterns[s.pattern]?.name ?? "?")}</span>` +
            `<span class="startWann">×${s.wiederholungen}</span>` +
            `<button class="ghost songHoch" data-i="${i}" style="padding:0 5px;font-size:11px" ${i === 0 ? "disabled" : ""}>▲</button>` +
            `<button class="ghost songWeg" data-i="${i}" style="padding:0 5px;font-size:11px">✕</button></div>`,
        )
        .join("")}</div>`
    : `<p class="sub" style="font-size:10px;margin:0">Noch kein Schritt — Pattern wählen und anhängen.</p>`;
  for (const b of liste.querySelectorAll<HTMLButtonElement>(".songWeg")) {
    b.addEventListener("click", () => {
      song.splice(Number(b.dataset.i), 1);
      renderSong();
    });
  }
  for (const b of liste.querySelectorAll<HTMLButtonElement>(".songHoch")) {
    b.addEventListener("click", () => {
      const i = Number(b.dataset.i);
      [song[i - 1], song[i]] = [song[i], song[i - 1]];
      renderSong();
    });
  }
  const takte = song.reduce((s, x) => s + x.wiederholungen, 0);
  songInfo(song.length ? `${song.length} Abschnitt(e), zusammen ${takte} Durchgänge.` : "");
}

function richteSongEin(): void {
  if (!document.getElementById("songPanel")) return;
  document.getElementById("songAdd")?.addEventListener("click", () => {
    const p = Number(($("songPattern") as HTMLSelectElement).value);
    const mal = Math.max(1, Math.min(64, Number(($("songMal") as HTMLInputElement).value) || 1));
    if (!project.patterns[p]) return;
    song.push({ pattern: p, wiederholungen: mal });
    renderSong();
  });
  document.getElementById("songLeeren")?.addEventListener("click", () => {
    song = [];
    renderSong();
  });
  document.getElementById("songSchreiben")?.addEventListener("click", () => {
    if (!song.length) {
      songInfo("Erst Abschnitte anhängen.");
      return;
    }
    const r = planeSong(project.patterns, song);
    project.patterns = r.patterns;
    if (cur >= project.patterns.length) cur = 0;
    markDirty();
    renderAll();
    renderSong();
    const kette = songText(project.patterns);
    songInfo(`${kette}${r.hinweise.length ? " · " + r.hinweise.join(" ") : ""}`);
  });
  renderSong();
}

export function initEditor(): void {
  // Sample-Editor: geänderte Daten zurück in den Pool, Vorhören über denselben
  // Player wie die Pool-Liste
  document.getElementById("edUndo")?.addEventListener("click", schrittZurueck);
  document.getElementById("edRedo")?.addEventListener("click", schrittVor);
  // Tastenkürzel — aber nicht, während in einem Feld getippt wird: dort
  // erwartet man das Rückgängig des Textfelds, nicht das des Projekts.
  window.addEventListener("keydown", (e) => {
    if (!e.ctrlKey && !e.metaKey) return;
    const ziel = e.target as HTMLElement | null;
    if (ziel && /^(INPUT|TEXTAREA|SELECT)$/.test(ziel.tagName)) return;
    if ($("viewEditor").classList.contains("hidden")) return;
    const taste = e.key.toLowerCase();
    if (taste === "z" && !e.shiftKey) {
      e.preventDefault();
      schrittZurueck();
    } else if (taste === "y" || (taste === "z" && e.shiftKey)) {
      e.preventDefault();
      schrittVor();
    }
  });

  richteSongEin();

  // Bank ordnen: Nummern verschieben und die Part-Verweise mitziehen
  const ordnenInfo = (t: string) => {
    const el = document.getElementById("poolOrdnenInfo");
    if (el) el.textContent = t;
  };
  const nachOrdnen = (b: { verschoben: number; aenderungen: { von: number; nach: number }[] }) => {
    if (b.verschoben === 0) {
      ordnenInfo("Nichts zu tun — die Bank ist bereits lückenlos in dieser Reihenfolge.");
      return;
    }
    markDirty();
    renderAll();
    const bsp = b.aenderungen.slice(0, 3).map((a) => `${a.von}→${a.nach}`).join(", ");
    ordnenInfo(`${b.verschoben} Sample(s) umnummeriert (${bsp}${b.aenderungen.length > 3 ? " …" : ""}). Parts wurden mitgezogen.`);
  };
  document.getElementById("poolPacken")?.addEventListener("click", () => nachOrdnen(packeNummernNeu(project)));
  document.getElementById("poolSortieren")?.addEventListener("click", () => {
    const nach = ($("poolSortNach") as HTMLSelectElement).value as SortierSchluessel;
    nachOrdnen(sortiereBank(project, nach));
  });

  initSampleEditor({
    uebernehmen: (nummer, pcm, loop) => {
      const s = project.samples.find((x) => x.number === nummer);
      if (!s) return;
      s.pcm = pcm;
      s.loopType = loop.loopType;
      s.loopStartFrame = loop.loopStartFrame;
      markDirty();
      renderPool();
    },
    anhoeren: (pcm, sampleRate) => player.audition({ number: 0, name: "Auswahl", pcm, sampleRate }),
  });
  $("patAdd").addEventListener("click", () => {
    project.patterns.push(createPattern(`PATTERN ${project.patterns.length + 1}`));
    cur = project.patterns.length - 1;
    markDirty();
    renderAll();
  });
  $("patDup").addEventListener("click", () => {
    const copy = clonePattern(project.patterns[cur]);
    copy.name = (copy.name + " KOPIE").slice(0, 16);
    // Erst die Ketten mitziehen, dann einfügen: `chainTo` ist der Listenplatz,
    // ein Einschub in der Mitte verschöbe sonst stumm jeden Verweis dahinter.
    kettenNachEinschub(project.patterns, cur + 1);
    project.patterns.splice(cur + 1, 0, copy);
    cur++;
    markDirty();
    renderAll();
  });
  setupVarianten();
  $("patDel").addEventListener("click", () => {
    if (project.patterns.length <= 1) return alert("Das letzte Pattern kann nicht gelöscht werden.");
    if (!confirm(`Pattern „${project.patterns[cur].name}" löschen?`)) return;
    project.patterns.splice(cur, 1);
    cur = Math.max(0, cur - 1);
    markDirty();
    renderAll();
  });

  $<HTMLInputElement>("gName").addEventListener("change", (e) => {
    project.patterns[cur].name = (e.target as HTMLInputElement).value
      .replace(/[^\x20-\x7e]+/g, "")
      .slice(0, 16);
    markDirty();
    renderPatList();
  });
  $<HTMLInputElement>("gBpm").addEventListener("change", (e) => {
    const v = Number((e.target as HTMLInputElement).value);
    project.patterns[cur].bpm = Math.min(300, Math.max(20, Number.isFinite(v) ? v : 165));
    markDirty();
    renderGlobals();
  });
  $<HTMLSelectElement>("gLen").addEventListener("change", (e) => {
    project.patterns[cur].stepLength = Number((e.target as HTMLSelectElement).value) as 16 | 32 | 64;
    markDirty();
    renderGrid();
  });

  const poolDrop = $("poolDrop");
  const poolFile = $<HTMLInputElement>("poolFile");
  poolDrop.addEventListener("click", () => poolFile.click());
  poolFile.addEventListener("change", () => {
    if (poolFile.files?.length) void importWavFiles(poolFile.files);
    poolFile.value = "";
  });
  poolDrop.addEventListener("dragover", (e) => {
    e.preventDefault();
    poolDrop.classList.add("drag");
  });
  poolDrop.addEventListener("dragleave", () => poolDrop.classList.remove("drag"));
  poolDrop.addEventListener("drop", (e) => {
    e.preventDefault();
    poolDrop.classList.remove("drag");
    if (e.dataTransfer?.files?.length) void importWavFiles(e.dataTransfer.files);
  });
  // Geladene Dateien im Start-Dashboard unter „Letzte Dateien" ablegen.
  const merkeDateien = (files: FileList | File[]): void => {
    for (const f of Array.from(files)) {
      const n = f.name.toLowerCase();
      const art: DateiArt = n.endsWith(".all")
        ? "all"
        : n.endsWith(".esx") || n.endsWith(".ess")
          ? "esx"
          : n.endsWith(".tekkforge") || n.endsWith(".json")
            ? "projekt"
            : "e2spat";
      merkeLetzteDatei(f.name, art);
    }
  };
  const replaceFile = $<HTMLInputElement>("replaceFile");
  replaceFile.addEventListener("change", () => {
    const f = replaceFile.files?.[0];
    replaceFile.value = "";
    if (f) void replaceSampleAudio(f);
  });
  // .all direkt in den Pool laden (Sample-Bank bearbeiten, ohne Patterns)
  const importAllFile = $<HTMLInputElement>("importAllFile");
  $("importAll").addEventListener("click", () => importAllFile.click());
  importAllFile.addEventListener("change", () => {
    if (importAllFile.files?.length) {
      merkeDateien(importAllFile.files);
      void importE2Files(importAllFile.files);
    }
    importAllFile.value = "";
  });
  $("exportAll").addEventListener("click", exportSampleBank);
  // Bibliotheks-Filter (Alle/Factory/User) + Suche
  for (const b of document.querySelectorAll<HTMLButtonElement>(".poolFilterRow .poolF")) {
    b.addEventListener("click", () => {
      poolFilterWahl = (b.dataset.filter ?? "alle") as PoolFilter;
      for (const x of document.querySelectorAll(".poolFilterRow .poolF")) x.classList.toggle("active", x === b);
      renderPool();
    });
  }
  $("poolSuche").addEventListener("input", () => {
    poolSucheText = $<HTMLInputElement>("poolSuche").value;
    renderPool();
  });

  $("expPat").addEventListener("click", exportPattern);
  $("expBank").addEventListener("click", exportBank);
  $("projSave").addEventListener("click", saveProject);
  $("projNew").addEventListener("click", () => {
    if (dirty && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
    project = createProject();
    cur = 0;
    dirty = false;
    void sicherung?.erledigt();
    projektErsetzt();
    renderAll();
  });
  const projFile = $<HTMLInputElement>("projFile");
  $("projOpen").addEventListener("click", () => projFile.click());
  projFile.addEventListener("change", () => {
    const f = projFile.files?.[0];
    projFile.value = "";
    if (f) {
      merkeDateien([f]);
      void openProject(f);
    }
  });
  const importFile = $<HTMLInputElement>("importFile");
  $("importE2").addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", () => {
    if (importFile.files?.length) {
      merkeDateien(importFile.files);
      void importE2Files(importFile.files);
    }
    importFile.value = "";
  });
  $("previewPlay").addEventListener("click", togglePreview);
  setupMidi();

  window.addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });

  renderAll();
  void rettungAnbieten();
}

/**
 * Varianten-Panel. Die Abwandlung landet bewusst am ENDE der Liste, nicht
 * hinter dem Original: `chainTo` zeigt auf den Listenplatz, und ein Einschub
 * in der Mitte verschöbe stumm jede bestehende Kette.
 */
function setupVarianten(): void {
  const wahl = $<HTMLSelectElement>("varArt");
  const hinweis = $("varHinweis");
  wahl.innerHTML = (Object.keys(VARIANTEN) as VariantenArt[])
    .map((a) => `<option value="${a}">${escapeHtml(VARIANTEN[a].titel)}</option>`)
    .join("");
  const zeigeHinweis = (): void => {
    hinweis.textContent = VARIANTEN[wahl.value as VariantenArt]?.hinweis ?? "";
  };
  wahl.addEventListener("change", zeigeHinweis);
  zeigeHinweis();

  $("varMachen").addEventListener("click", () => {
    const original = project.patterns[cur];
    if (!original) return;
    let variante;
    try {
      variante = baueVariante(original, wahl.value as VariantenArt);
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
      return;
    }
    if (project.patterns.length >= MAX_PATTERNS_PER_BANK) {
      alert(`Die Bank fasst ${MAX_PATTERNS_PER_BANK} Patterns — für eine weitere Variante ist kein Platz mehr.`);
      return;
    }
    project.patterns.push(variante);
    const nummer = project.patterns.length;

    // Hing das Original in einer Kette, wird die Variante dazwischengehängt —
    // genau der Fall "Fill vor dem Drop". Ohne Kette bleibt alles, wie es ist:
    // eine Kette zu erfinden, die es vorher nicht gab, wäre eine Überraschung.
    let kettentext = "";
    if (original.chainTo !== undefined && original.chainTo > 0) {
      variante.chainTo = original.chainTo;
      variante.chainRepeat = original.chainRepeat ?? 1;
      original.chainTo = nummer;
      kettentext = ` und zwischen „${escapeHtml(original.name)}" und Pattern ${variante.chainTo} in die Kette gehängt`;
    }
    cur = project.patterns.length - 1;
    markDirty();
    renderAll();
    setMidiStatus?.(`Variante „${variante.name}" als Pattern ${nummer} angelegt${kettentext}.`);
  });
}

/**
 * Liegt ein Notfall-Stand herum, ist die letzte Sitzung nicht sauber zu Ende
 * gegangen. Angeboten wird er als Leiste im Editor, nicht als Dialog — siehe
 * `wiederherstellungsFrage`. Verworfen wird die Datei erst auf ausdrueckliche
 * Ansage; bis dahin bleibt sie liegen und wird beim naechsten Mal erneut
 * angeboten.
 */
async function rettungAnbieten(): Promise<void> {
  const stand = await sicherung?.liegengebliebenerStand();
  if (!stand) return;
  const leiste = document.getElementById("edRettung");
  const text = document.getElementById("edRettungText");
  const ja = document.getElementById("edRettungJa");
  const nein = document.getElementById("edRettungNein");
  if (!leiste || !text || !ja || !nein) return;

  text.textContent = wiederherstellungsFrage(stand, Date.now());
  leiste.classList.remove("hidden");
  // Solange die Frage offen steht, wird NICHT gesichert: sonst überschriebe
  // das frische, leere Projekt genau den Stand, der hier zur Rettung steht —
  // und ein zweiter Absturz kostete die Arbeit endgültig.
  sicherung?.anhalten();

  ja.addEventListener("click", () => {
    try {
      const wieder = deserializeProject(stand.text);
      project = wieder;
      cur = 0;
      // Bleibt absichtlich "geaendert": der Stand steht ja noch nirgends als
      // richtige Projektdatei.
      dirty = true;
      projektErsetzt();
      leiste.classList.add("hidden");
      sicherung?.fortsetzen();
      renderAll();
      // Der gerettete Stand gehört in den Editor — dort sieht man ihn auch.
      document.getElementById("tabEditor")?.click();
      setMidiStatus?.("Notfall-Stand geladen — bitte als Projekt speichern.");
    } catch (err) {
      // Eine unlesbare Sicherung ist wertlos; sie darf aber nicht bei jedem
      // Start erneut aufpoppen.
      leiste.classList.add("hidden");
      void sicherung?.erledigt();
      setMidiStatus?.(
        `Notfall-Stand ließ sich nicht laden (${err instanceof Error ? err.message : String(err)}) — er wurde verworfen.`,
      );
    }
  });
  nein.addEventListener("click", () => {
    leiste.classList.add("hidden");
    void sicherung?.erledigt();
    setMidiStatus?.("Notfall-Stand verworfen.");
  });
}

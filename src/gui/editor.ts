/**
 * editor.ts — Pattern-Editor-UI: Patterns ohne ESX von Grund auf bauen.
 * Grid 16 Parts × 16/32/64 Steps, Step-Popover (Note/Velocity/Gate),
 * Sample-Pool (WAV-Import), Projekt speichern/öffnen, Export .e2spat/Bank.
 */

import {
  createProject,
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
import {
  buildCurrentPatternDump,
  buildPatternWrite,
  buildCurrentPatternRequest,
  buildSearchDevice,
  parseSearchReply,
  decodeDump,
  E2_PRODUCT_ID_SAMPLER,
  type E2SysexOptions,
} from "../core/e2sysex";
import { MidiIO, requestSysex } from "./midi";
import { PART_PARAMS, clampParamValue, type PartParam } from "../core/partParams";
import { PreviewPlayer } from "./preview";
import { $, download, escapeHtml } from "./shared";

let project: EditorProject = createProject();
let cur = 0; // aktueller Pattern-Index
let dirty = false;
/** Merkt sich die zuletzt gesetzte Note pro Part (für neue Steps). */
const lastNote = new Map<number, number>();
const player = new PreviewPlayer();

function markDirty(): void {
  dirty = true;
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
  lastNote.clear();
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

function stepTitle(s: EditorStep): string {
  return `Note ${noteName(s.note)} · Vel ${s.velocity} · Gate ${s.gate === EDITOR_GATE_MAX ? "Tie" : s.gate}`;
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
    muteBtn.title = part.muted ? "Stumm (Vorhören) — klick zum Aufheben" : "Part stummschalten (nur Vorhören)";
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
    fxBtn.title = "Klangparameter (experimentell): Filter/Amp/IFX/Mod…";
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
        cell.textContent = st.note === EDITOR_DEFAULT_NOTE ? "" : noteName(st.note);
        cell.title = stepTitle(st);
      } else {
        cell.style.background = "";
        cell.title = "Klick: Step an · Rechtsklick: Details";
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
  const noteOpts = Array.from({ length: 128 }, (_, n) => {
    const label = n === EDITOR_DEFAULT_NOTE ? `${noteName(n)} (Original)` : noteName(n);
    return `<option value="${n}" ${st.note === n ? "selected" : ""}>${label}</option>`;
  }).join("");
  pop.innerHTML = `
    <b>Part ${pi + 1} · Step ${si + 1}</b>
    <label>Note</label>
    <select id="ppNote" style="width:100%">${noteOpts}</select>
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
    st.note = Number(pop.querySelector<HTMLSelectElement>("#ppNote")!.value);
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

// ─── Part-Klangparameter (EXPERIMENTELL) ─────────────────────────────────────

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
      ⚠ EXPERIMENTELL — Byte-Offsets unbestätigt, am Gerät prüfen. Nicht editierte
      Werte bleiben erhalten.
    </div>
    <div style="max-height:340px;overflow-y:auto">${rows}</div>
    <div class="row"><button id="ppClose" class="ghost" style="flex:1">Schließen</button></div>`;
  document.body.appendChild(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = `${Math.min(window.innerWidth - 320, r.left + window.scrollX)}px`;
  pop.style.top = `${r.bottom + window.scrollY + 4}px`;
  popEl = pop;

  pop.querySelectorAll<HTMLInputElement>("input[data-key]").forEach((inp) => {
    inp.addEventListener("change", () => {
      const key = inp.dataset.key!;
      const raw = inp.type === "checkbox" ? (inp.checked ? 1 : 0) : Number(inp.value);
      const v = clampParamValue(key, raw);
      params[key] = v;
      if (inp.type !== "checkbox") inp.value = String(v);
      markDirty();
    });
  });
  pop.querySelector<HTMLButtonElement>("#ppClose")!.addEventListener("click", closePopover);
}

// ─── Sample-Pool ─────────────────────────────────────────────────────────────

/** Slot, dessen Audio gerade per ↻ ersetzt werden soll. */
let replaceTargetNumber: number | null = null;

function renderPool(): void {
  const tbody = $("poolRows");
  const sorted = [...project.samples].sort((a, b) => a.number - b.number);
  tbody.innerHTML = sorted
    .map(
      (s) => `<tr>
        <td><input class="poolNum" data-num="${s.number}" type="number" min="501" max="999"
              value="${s.number}" style="width:44px;background:var(--elevated);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:2px 3px;font:inherit" /></td>
        <td><input class="poolName" data-num="${s.number}" type="text" maxlength="16"
              value="${escapeHtml(s.name)}" style="width:96px;background:var(--elevated);color:var(--text);border:1px solid var(--border);border-radius:4px;padding:2px 4px;font:inherit" /></td>
        <td>${(s.pcm.length / s.sampleRate).toFixed(1)}</td>
        <td style="white-space:nowrap">
          <a data-play="${s.number}" style="cursor:pointer" title="Anhören">▶</a>
          <a data-replace="${s.number}" style="cursor:pointer;color:var(--accent2)" title="Audio ersetzen (WAV)">↻</a>
          <a data-del="${s.number}" style="cursor:pointer;color:var(--danger)" title="Entfernen">✕</a>
        </td>
      </tr>`,
    )
    .join("");

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
  tbody.querySelectorAll<HTMLAnchorElement>("a[data-play]").forEach((a) =>
    a.addEventListener("click", () => {
      const s = byNum(Number(a.dataset.play));
      if (s) player.audition(s);
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
}

async function openProject(file: File): Promise<void> {
  try {
    project = deserializeProject(await file.text());
    cur = 0;
    dirty = false;
    renderAll();
  } catch (err) {
    alert(err instanceof Error ? err.message : String(err));
  }
}

// ─── MIDI (SysEx-Transfer zum/vom Gerät) ─────────────────────────────────────

const midi = new MidiIO();
let midiChannel = 0;
let midiProductId = E2_PRODUCT_ID_SAMPLER;

function midiOpts(): E2SysexOptions {
  return { channel: midiChannel, productId: midiProductId };
}

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
function pushMonitor(dir: "◀ IN" | "▶ OUT", bytes: number[]): void {
  const hex = bytes.map((b) => b.toString(16).padStart(2, "0")).join(" ");
  const kind = bytes[0] === 0xf0 ? "SysEx" : "MIDI";
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
    midi.onAnyMessage = (bytes) => pushMonitor("◀ IN", bytes);
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
        `Suche ist optional: „→ Gerät (Live)" geht auch mit Standard (Ch 1, Sampler).`,
    );
  }
}

async function midiSendCurrent(): Promise<void> {
  setMidiStatus("sende …");
  try {
    const msg = buildCurrentPatternDump(currentPatternBody(), midiOpts());
    await midi.sendAsync(msg);
    setMidiStatus(`„${project.patterns[cur].name}" → Edit-Buffer gesendet (${msg.length} Bytes)`);
  } catch (err) {
    setMidiStatus(`Senden fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
  }
}

/**
 * Schreibt EIN Pattern dauerhaft auf einen Slot — über den verifizierten Weg:
 * 0x40 (Edit-Buffer, funktioniert nachweislich am Gerät) + 0x11
 * (Write-Buffer→Slot). Beide sind reine Sende-Befehle, brauchen also keinen
 * funktionierenden MIDI-Rückkanal.
 */
async function writePatternToSlot(p: EditorPattern, slot1based: number): Promise<void> {
  const body = new Uint8Array(buildPatternFile(p).slice(0x100));
  await midi.sendAsync(buildCurrentPatternDump(body, midiOpts()));
  await new Promise((r) => setTimeout(r, 150)); // Gerät den Buffer übernehmen lassen
  await midi.sendAsync(buildPatternWrite(slot1based - 1, midiOpts()));
  await new Promise((r) => setTimeout(r, 250)); // Write aufs Flash abwarten
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
    await writePatternToSlot(project.patterns[cur], slot);
    setMidiStatus(
      `„${project.patterns[cur].name}" → Slot ${slot} geschrieben (Edit-Buffer + Write). Am Gerät prüfen.`,
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
    for (let i = 0; i < count; i++) {
      setMidiStatus(`schreibe ${i + 1}/${count} → Slot ${start + i} …`);
      await writePatternToSlot(project.patterns[i], start + i);
    }
    setMidiStatus(`${count} Pattern(s) auf Slots ${start}–${start + count - 1} geschrieben.`);
  } catch (err) {
    setMidiStatus(`Abbruch: ${err instanceof Error ? err.message : err}`);
  }
}

async function midiGetPattern(): Promise<void> {
  try {
    setMidiStatus("fordere aktuelles Pattern an …");
    const reply = await requestSysex(
      midi,
      buildCurrentPatternRequest(midiOpts()),
      (b) => decodeDump(b) !== null,
      2500,
    );
    const dump = decodeDump(reply)!;
    const pattern = editorPatternFromBody(dump.body);
    project.patterns.splice(cur + 1, 0, pattern);
    cur += 1;
    markDirty();
    renderAll();
    setMidiStatus(`Pattern „${pattern.name}" vom Gerät geholt`);
  } catch (err) {
    setMidiStatus(`Holen fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
  }
}

function setupMidi(): void {
  if (!midi.available) {
    $("midiEnable").classList.add("hidden");
    $("midiUnavailable").classList.remove("hidden");
    return;
  }
  $("midiEnable").addEventListener("click", () => void midiEnable());
  $<HTMLSelectElement>("midiOut").addEventListener("change", (e) =>
    midi.selectOutput((e.target as HTMLSelectElement).value),
  );
  $<HTMLSelectElement>("midiIn").addEventListener("change", (e) =>
    midi.selectInput((e.target as HTMLSelectElement).value),
  );
  $("midiSearch").addEventListener("click", () => void midiSearchDevice());
  $("midiSendCurrent").addEventListener("click", midiSendCurrent);
  $("midiSendSlot").addEventListener("click", midiSendSlot);
  $("midiSendAll").addEventListener("click", () => void midiSendAll());
  $("midiGet").addEventListener("click", () => void midiGetPattern());
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
}

export function initEditor(): void {
  $("patAdd").addEventListener("click", () => {
    project.patterns.push(createPattern(`PATTERN ${project.patterns.length + 1}`));
    cur = project.patterns.length - 1;
    markDirty();
    renderAll();
  });
  $("patDup").addEventListener("click", () => {
    const copy = clonePattern(project.patterns[cur]);
    copy.name = (copy.name + " KOPIE").slice(0, 16);
    project.patterns.splice(cur + 1, 0, copy);
    cur++;
    markDirty();
    renderAll();
  });
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
    if (importAllFile.files?.length) void importE2Files(importAllFile.files);
    importAllFile.value = "";
  });
  $("exportAll").addEventListener("click", exportSampleBank);

  $("expPat").addEventListener("click", exportPattern);
  $("expBank").addEventListener("click", exportBank);
  $("projSave").addEventListener("click", saveProject);
  $("projNew").addEventListener("click", () => {
    if (dirty && !confirm("Ungespeicherte Änderungen verwerfen?")) return;
    project = createProject();
    cur = 0;
    dirty = false;
    renderAll();
  });
  const projFile = $<HTMLInputElement>("projFile");
  $("projOpen").addEventListener("click", () => projFile.click());
  projFile.addEventListener("change", () => {
    const f = projFile.files?.[0];
    projFile.value = "";
    if (f) void openProject(f);
  });
  const importFile = $<HTMLInputElement>("importFile");
  $("importE2").addEventListener("click", () => importFile.click());
  importFile.addEventListener("change", () => {
    if (importFile.files?.length) void importE2Files(importFile.files);
    importFile.value = "";
  });
  $("previewPlay").addEventListener("click", togglePreview);
  setupMidi();

  window.addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });

  renderAll();
}

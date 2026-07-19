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
  buildPatternFile,
  buildBankFiles,
  serializeProject,
  deserializeProject,
  editorProjectFromE2Files,
  importSamplesFromAll,
  noteName,
  EDITOR_DEFAULT_NOTE,
  EDITOR_GATE_MAX,
  type EditorProject,
  type EditorPattern,
  type EditorStep,
  type PoolSample,
} from "../core/editorModel";
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

    const headEl = document.createElement("div");
    headEl.className = "rowHead";

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

    headEl.append(label, sampleSel, vol, pan);
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

// ─── Sample-Pool ─────────────────────────────────────────────────────────────

function renderPool(): void {
  const tbody = $("poolRows");
  tbody.innerHTML = project.samples
    .map(
      (s, i) => `<tr>
        <td>${s.number}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>${(s.pcm.length / s.sampleRate).toFixed(1)}</td>
        <td>
          <a data-play="${i}" style="cursor:pointer" title="Anhören">▶</a>
          <a data-del="${i}" style="cursor:pointer;color:var(--danger)" title="Entfernen">✕</a>
        </td>
      </tr>`,
    )
    .join("");
  tbody.querySelectorAll<HTMLAnchorElement>("a[data-play]").forEach((a) =>
    a.addEventListener("click", () => player.audition(project.samples[Number(a.dataset.play)])),
  );
  tbody.querySelectorAll<HTMLAnchorElement>("a[data-del]").forEach((a) =>
    a.addEventListener("click", () => {
      const idx = Number(a.dataset.del);
      const num = project.samples[idx].number;
      const used = project.patterns.some((p) => p.parts.some((pt) => pt.sampleNumber === num));
      if (used && !confirm(`Sample #${num} wird von Parts benutzt — trotzdem entfernen?`)) return;
      project.samples.splice(idx, 1);
      markDirty();
      renderAll();
    }),
  );
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

  window.addEventListener("beforeunload", (e) => {
    if (dirty) e.preventDefault();
  });

  renderAll();
}

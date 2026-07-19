/**
 * converter.ts — ESX-Converter-Tab:
 * ESX laden → Pattern-Auswahl → convertEsxToE2sBank → Downloads
 * ODER Ergebnis (Patterns + Samples) in den Pattern-Editor übergeben.
 */

import { parseEsxBank, type EsxBank, type EsxPattern } from "../core/esxParser";
import {
  convertEsxToE2sBank,
  E2S_USER_SAMPLE_BASE,
  E2S_SAMPLE_SECONDS_CAP,
} from "../core/esxToE2sBank";
import { editorProjectFromE2Files, type EditorProject } from "../core/editorModel";
import type { EsxToE2sResult } from "../core/esxToE2sBank";
import { $, download, escapeHtml } from "./shared";

let bank: EsxBank | null = null;
let stem = "esx";
const selected = new Set<number>();
/** Letztes Konvertierungs-Ergebnis (für „Im Editor öffnen"). */
let lastResult: EsxToE2sResult | null = null;
/** Callback, den main.ts setzt: Projekt an den Editor übergeben + Tab wechseln. */
let sendToEditor: ((project: EditorProject) => void) | null = null;

function isRelevant(p: EsxPattern): boolean {
  return (
    (p.name && p.name.trim().length > 0) ||
    p.parts.some((pt) => pt.steps.some((s) => s.active))
  );
}

function stat(label: string, value: string | number): string {
  return `<div class="stat"><b>${value}</b><span>${label}</span></div>`;
}

function renderLoaded(): void {
  if (!bank) return;
  const pats = bank.patterns.filter(isRelevant);
  $("loadedTitle").textContent = `Geladen: ${bank.source}`;
  $("loadedStats").innerHTML =
    stat("Patterns", pats.length) +
    stat("Mono-Samples", bank.monoSamples.length) +
    stat("Stereo-Samples", bank.stereoSamples.length);
  const patRows = $("patRows");
  patRows.innerHTML = pats
    .map((p) => {
      const active = p.parts.filter((pt) => pt.steps.some((s) => s.active)).length;
      const checked = selected.has(p.index) ? "checked" : "";
      return `<tr>
        <td><input type="checkbox" data-idx="${p.index}" ${checked}></td>
        <td>${p.index + 1}</td>
        <td>${escapeHtml(p.name || "(ohne Name)")}</td>
        <td>${p.bpm.toFixed(1)}</td>
        <td>${p.lengthSteps}</td>
        <td>${active}</td>
      </tr>`;
    })
    .join("");
  patRows.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const idx = Number(cb.dataset.idx);
      if (cb.checked) selected.add(idx);
      else selected.delete(idx);
      updateSelCount();
    });
  });
  updateSelCount();
  $("loaded").classList.remove("hidden");
  $("result").classList.add("hidden");
}

function updateSelCount(): void {
  $("selCount").textContent = `${selected.size} ausgewählt (max. 250 werden exportiert)`;
  $<HTMLButtonElement>("convert").disabled = selected.size === 0;
}

async function loadFile(file: File): Promise<void> {
  try {
    const buf = await file.arrayBuffer();
    const esx = parseEsxBank(new Uint8Array(buf), file.name);
    if (esx.patterns.length === 0 && esx.monoSamples.length === 0) {
      alert(`Keine Patterns/Samples in "${file.name}" gefunden — ist das ein ESX-1-Backup?`);
      return;
    }
    bank = esx;
    stem =
      file.name.replace(/\.(esx|ess)$/i, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 50) ||
      "esx";
    selected.clear();
    for (const p of esx.patterns) if (isRelevant(p)) selected.add(p.index);
    renderLoaded();
  } catch (err) {
    alert(`Laden fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function convert(): void {
  if (!bank || selected.size === 0) return;
  const btn = $<HTMLButtonElement>("convert");
  btn.disabled = true;
  btn.textContent = "Konvertiere …";
  setTimeout(() => {
    try {
      const filtered: EsxBank = {
        ...bank!,
        patterns: bank!.patterns.filter((p) => selected.has(p.index)),
      };
      const base = Number($<HTMLInputElement>("base").value) || E2S_USER_SAMPLE_BASE;
      const cap = Number($<HTMLInputElement>("cap").value) || E2S_SAMPLE_SECONDS_CAP;
      const res = convertEsxToE2sBank(filtered, { userSampleBase: base, secondsCap: cap });
      lastResult = res;
      const s = res.stats;
      $("resultStats").innerHTML =
        stat("Patterns", s.patterns) +
        stat("Samples", s.samples) +
        stat("Audio (s)", s.audioSeconds.toFixed(1)) +
        stat("Aktive Parts", s.activeParts) +
        stat("Verlinkt", `${s.linkedParts}/${s.activeParts}`);
      const warnEl = $("resultWarn");
      if (s.droppedSamples > 0) {
        warnEl.textContent = `⚠ ${s.droppedSamples} Samples wegen Sample-RAM-Limit (~${cap}s mono) weggelassen — Details im Mapping-Report.`;
        warnEl.classList.remove("hidden");
      } else {
        warnEl.classList.add("hidden");
      }
      const downloads = $("downloads");
      downloads.innerHTML = "";
      const mk = (label: string, fn: () => void): void => {
        const b = document.createElement("button");
        b.className = "link";
        b.textContent = label;
        b.addEventListener("click", fn);
        downloads.appendChild(b);
      };
      mk(`⬇ ${stem}.e2sallpat (Pattern-Bank)`, () =>
        download(res.allpat, `${stem}.e2sallpat`, "application/octet-stream"),
      );
      mk(`⬇ ${stem}-samples.all (Sample-Bank)`, () =>
        download(res.all, `${stem}-samples.all`, "application/octet-stream"),
      );
      mk(`⬇ ${stem}-mapping.md (Report)`, () =>
        download(res.mapping, `${stem}-mapping.md`, "text/markdown"),
      );
      $("mapping").textContent = res.mapping;
      $("result").classList.remove("hidden");
      $("result").scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      alert(`Konvertierung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      btn.disabled = false;
      btn.textContent = "Konvertieren →";
    }
  }, 30);
}

export function initConverter(onSendToEditor?: (project: EditorProject) => void): void {
  sendToEditor = onSendToEditor ?? null;
  const dropEl = $("drop");
  const fileEl = $<HTMLInputElement>("file");
  dropEl.addEventListener("click", () => fileEl.click());
  fileEl.addEventListener("change", () => {
    const f = fileEl.files?.[0];
    fileEl.value = "";
    if (f) void loadFile(f);
  });
  dropEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropEl.classList.add("drag");
  });
  dropEl.addEventListener("dragleave", () => dropEl.classList.remove("drag"));
  dropEl.addEventListener("drop", (e) => {
    e.preventDefault();
    dropEl.classList.remove("drag");
    const f = e.dataTransfer?.files?.[0];
    if (f) void loadFile(f);
  });
  $("selAll").addEventListener("click", () => {
    if (!bank) return;
    for (const p of bank.patterns) if (isRelevant(p)) selected.add(p.index);
    renderLoaded();
  });
  $("selNone").addEventListener("click", () => {
    selected.clear();
    renderLoaded();
  });
  $("convert").addEventListener("click", convert);

  $("toEditor").addEventListener("click", () => {
    if (!lastResult) return;
    if (!sendToEditor) {
      alert("Editor nicht verfügbar.");
      return;
    }
    try {
      const project = editorProjectFromE2Files(lastResult.allpat, lastResult.all);
      sendToEditor(project);
    } catch (err) {
      alert(`Übergabe an Editor fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

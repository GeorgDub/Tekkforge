/**
 * TekkForge GUI — läuft komplett clientseitig (Single-File-HTML nach Build).
 * ESX laden → Pattern-Auswahl → convertEsxToE2sBank → Downloads anbieten.
 */

import { parseEsxBank, type EsxBank, type EsxPattern } from "../core/esxParser";
import {
  convertEsxToE2sBank,
  E2S_USER_SAMPLE_BASE,
  E2S_SAMPLE_SECONDS_CAP,
} from "../core/esxToE2sBank";

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} fehlt`);
  return el as T;
};

const dropEl = $("drop");
const fileEl = $<HTMLInputElement>("file");
const loadedEl = $("loaded");
const loadedTitleEl = $("loadedTitle");
const loadedStatsEl = $("loadedStats");
const patRowsEl = $("patRows");
const selCountEl = $("selCount");
const baseEl = $<HTMLInputElement>("base");
const capEl = $<HTMLInputElement>("cap");
const convertBtn = $<HTMLButtonElement>("convert");
const resultEl = $("result");
const resultStatsEl = $("resultStats");
const resultWarnEl = $("resultWarn");
const downloadsEl = $("downloads");
const mappingEl = $("mapping");

let bank: EsxBank | null = null;
let stem = "esx";
/** Auswahl per Pattern-`index` (ESX-Slot), nicht Array-Position. */
const selected = new Set<number>();

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
  loadedTitleEl.textContent = `Geladen: ${bank.source}`;
  loadedStatsEl.innerHTML =
    stat("Patterns", pats.length) +
    stat("Mono-Samples", bank.monoSamples.length) +
    stat("Stereo-Samples", bank.stereoSamples.length);
  patRowsEl.innerHTML = pats
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
  patRowsEl.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((cb) => {
    cb.addEventListener("change", () => {
      const idx = Number(cb.dataset.idx);
      if (cb.checked) selected.add(idx);
      else selected.delete(idx);
      updateSelCount();
    });
  });
  updateSelCount();
  loadedEl.classList.remove("hidden");
  resultEl.classList.add("hidden");
}

function updateSelCount(): void {
  selCountEl.textContent = `${selected.size} ausgewählt (max. 250 werden exportiert)`;
  convertBtn.disabled = selected.size === 0;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
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

function download(data: Uint8Array | string, filename: string, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function convert(): void {
  if (!bank || selected.size === 0) return;
  convertBtn.disabled = true;
  convertBtn.textContent = "Konvertiere …";
  // setTimeout, damit der Button-Zustand vor der (synchronen) Arbeit rendert.
  setTimeout(() => {
    try {
      const filtered: EsxBank = {
        ...bank!,
        patterns: bank!.patterns.filter((p) => selected.has(p.index)),
      };
      const base = Number(baseEl.value) || E2S_USER_SAMPLE_BASE;
      const cap = Number(capEl.value) || E2S_SAMPLE_SECONDS_CAP;
      const res = convertEsxToE2sBank(filtered, { userSampleBase: base, secondsCap: cap });
      const s = res.stats;
      resultStatsEl.innerHTML =
        stat("Patterns", s.patterns) +
        stat("Samples", s.samples) +
        stat("Audio (s)", s.audioSeconds.toFixed(1)) +
        stat("Aktive Parts", s.activeParts) +
        stat("Verlinkt", `${s.linkedParts}/${s.activeParts}`);
      if (s.droppedSamples > 0) {
        resultWarnEl.textContent = `⚠ ${s.droppedSamples} Samples wegen Sample-RAM-Limit (~${cap}s mono) weggelassen — Details im Mapping-Report.`;
        resultWarnEl.classList.remove("hidden");
      } else {
        resultWarnEl.classList.add("hidden");
      }
      downloadsEl.innerHTML = "";
      const mk = (label: string, fn: () => void): void => {
        const b = document.createElement("button");
        b.className = "link";
        b.textContent = label;
        b.addEventListener("click", fn);
        downloadsEl.appendChild(b);
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
      mappingEl.textContent = res.mapping;
      resultEl.classList.remove("hidden");
      resultEl.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (err) {
      alert(`Konvertierung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      convertBtn.disabled = false;
      convertBtn.textContent = "Konvertieren →";
    }
  }, 30);
}

// ─── Wiring ──────────────────────────────────────────────────────────────────

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
convertBtn.addEventListener("click", convert);

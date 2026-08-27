/**
 * sampleManager — Sample-Bank-Werkstatt: zwei Bänke nebeneinander.
 *
 * Links eine geladene QUELLE (.all oder .e2sallpat samt Bank), rechts die
 * ZIELBANK, die man daraus zusammenstellt. Dazwischen wandern Samples per
 * Knopfdruck. Das ist ein anderes Arbeitsmodell als der eine Pool im Editor:
 * man kann aus mehreren Bänken sammeln, ohne die Quelle anzufassen.
 *
 * Die Nummernvergabe und das Nachführen der Pattern-Verweise steckt in
 * `core/zielBank` — hier ist nur die Bedienung. Insbesondere die Regel, dass
 * ein Verweis ohne Ziel geleert statt geraten wird, gehört dorthin und nicht
 * in eine Schaltfläche.
 */

import {
  importSamplesFromAll,
  buildSampleBank,
  type PoolSample,
} from "./../core/editorModel";
import {
  leereZielBank,
  fuegeHinzu,
  entferne,
  ramBytes,
  alsPool,
  RAM_BUDGET_BYTES,
  type ZielBank,
} from "../core/zielBank";
import { filterePool, type PoolFilter } from "../core/poolFilter";
import { tekkFs } from "./tekkFs";
import { download, escapeHtml } from "./shared";

interface Zustand {
  quelle: PoolSample[];
  quellName: string;
  ziel: ZielBank;
  filter: PoolFilter;
  suche: string;
  /** Angehakte Quell-Nummern. */
  markiert: Set<number>;
  /** Angehakte Ziel-Nummern. */
  markiertZiel: Set<number>;
  meldung: string;
}

const z: Zustand = {
  quelle: [],
  quellName: "",
  ziel: leereZielBank(),
  filter: "alle",
  suche: "",
  markiert: new Set(),
  markiertZiel: new Set(),
  meldung: "",
};

const mb = (bytes: number): string => (bytes / 1048576).toFixed(2);
const bytesVon = (s: PoolSample): number => Math.round((s.pcm.length / s.sampleRate) * 44100) * 2;

function gefiltert(): PoolSample[] {
  return filterePool(z.quelle, z.filter, z.suche);
}

function tabelle(
  liste: { nummer: number; name: string; kategorie?: string; gain12db?: boolean; sekunden: number; bytes: number }[],
  markiert: Set<number>,
  klasse: string,
): string {
  if (!liste.length)
    return `<p class="sub" style="margin:10px 0">Nichts da — links eine Bank laden, dann Samples herüberholen.</p>`;
  return `<table style="width:100%;border-collapse:collapse;font-size:11px">
    <thead><tr style="color:var(--muted);text-align:left">
      <th style="width:22px"></th><th style="width:42px">+12 dB</th><th style="width:44px">Slot</th>
      <th>Name</th><th style="width:78px">Kategorie</th><th style="width:54px">Länge</th><th style="width:60px">Größe</th>
    </tr></thead><tbody>${liste
      .map(
        (e) => `<tr style="border-top:1px solid var(--border)">
      <td><input type="checkbox" class="${klasse}" data-nr="${e.nummer}" ${markiert.has(e.nummer) ? "checked" : ""} /></td>
      <td>${e.gain12db ? "✓" : ""}</td><td>${e.nummer}</td>
      <td>${escapeHtml(e.name)}</td><td class="sub">${escapeHtml(e.kategorie ?? "")}</td>
      <td class="sub">${e.sekunden.toFixed(2)} s</td><td class="sub">${(e.bytes / 1024).toFixed(0)} kB</td>
    </tr>`,
      )
      .join("")}</tbody></table>`;
}

function render(): void {
  const host = document.getElementById("viewBank");
  if (!host) return;
  const q = gefiltert();
  const belegt = ramBytes(z.ziel);
  const voll = belegt > RAM_BUDGET_BYTES;
  host.innerHTML = `
    <div class="toolbar" style="justify-content:space-between">
      <div><b>Sample-Bank-Werkstatt</b> <span class="sub">— links laden, rechts zusammenstellen</span></div>
      <div class="sub">Quelle ${z.quelle.length} · Ziel ${z.ziel.eintraege.length} ·
        <b style="color:${voll ? "var(--danger)" : "var(--success)"}">${mb(belegt)} MB</b> von ${(RAM_BUDGET_BYTES / 1048576).toFixed(0)} MB</div>
    </div>
    <div class="edCols" style="grid-template-columns:1fr 1fr;gap:12px">
      <div class="card">
        <h2>Quelle ${z.quellName ? `— ${escapeHtml(z.quellName)}` : ""}</h2>
        <div class="toolbar">
          <button id="bkLaden" class="ghost">.all laden…</button>
          <input id="bkDatei" type="file" accept=".all" class="hidden" />
          <button id="bkAdd" class="primary" ${z.markiert.size ? "" : "disabled"}>Markierte → Zielbank (${z.markiert.size})</button>
          <button id="bkAddAlle" class="ghost" ${q.length ? "" : "disabled"}>Alle sichtbaren → Zielbank</button>
        </div>
        <div class="toolbar">
          <input id="bkSuche" type="text" placeholder="Suchen…" value="${escapeHtml(z.suche)}" style="flex:1;min-width:120px" />
          ${(["alle", "factory", "user"] as PoolFilter[])
            .map(
              (f) =>
                `<button class="ghost bkFilter ${z.filter === f ? "active" : ""}" data-f="${f}">${f === "alle" ? "Alle" : f === "factory" ? "Factory" : "User"} (${filterePool(z.quelle, f, "").length})</button>`,
            )
            .join("")}
        </div>
        <div style="max-height:340px;overflow:auto">${tabelle(
          q.map((s) => ({ nummer: s.number, name: s.name, kategorie: s.kategorie, gain12db: s.gain12db, sekunden: s.pcm.length / s.sampleRate, bytes: bytesVon(s) })),
          z.markiert,
          "bkQ",
        )}</div>
      </div>
      <div class="card">
        <h2>Zielbank</h2>
        <div class="toolbar">
          <button id="bkWeg" class="ghost" ${z.markiertZiel.size ? "" : "disabled"}>Markierte entfernen (${z.markiertZiel.size})</button>
          <button id="bkLeeren" class="ghost" ${z.ziel.eintraege.length ? "" : "disabled"}>Leeren</button>
          <button id="bkSpeichern" class="primary" ${z.ziel.eintraege.length ? "" : "disabled"}>Als .all speichern</button>
          <button id="bkSd" class="ghost" ${z.ziel.eintraege.length ? "" : "disabled"}>Auf SD…</button>
        </div>
        <div style="max-height:392px;overflow:auto">${tabelle(
          z.ziel.eintraege.map((e) => ({ nummer: e.nummer, name: e.name, kategorie: e.kategorie, gain12db: e.gain12db, sekunden: e.pcm.length / e.sampleRate, bytes: Math.round((e.pcm.length / e.sampleRate) * 44100) * 2 })),
          z.markiertZiel,
          "bkZ",
        )}</div>
      </div>
    </div>
    ${z.meldung ? `<div class="${voll ? "warn" : "hinweis"}" style="margin-top:10px">${escapeHtml(z.meldung)}</div>` : ""}`;
  verdrahte();
}

function verdrahte(): void {
  const knopf = (id: string, fn: () => void): void => {
    document.getElementById(id)?.addEventListener("click", fn);
  };
  const datei = document.getElementById("bkDatei") as HTMLInputElement | null;
  knopf("bkLaden", () => datei?.click());
  datei?.addEventListener("change", () => {
    const f = datei.files?.[0];
    datei.value = "";
    if (f) void ladeBank(f);
  });
  knopf("bkAdd", () => uebernehmen(gefiltert().filter((s) => z.markiert.has(s.number))));
  knopf("bkAddAlle", () => uebernehmen(gefiltert()));
  knopf("bkWeg", () => {
    const weg = entferne(z.ziel, [...z.markiertZiel]);
    z.markiertZiel.clear();
    z.meldung = `${weg} Sample(s) aus der Zielbank genommen. Die Nummern der übrigen bleiben, wo sie sind.`;
    render();
  });
  knopf("bkLeeren", () => {
    z.ziel = leereZielBank();
    z.markiertZiel.clear();
    z.meldung = "Zielbank geleert.";
    render();
  });
  knopf("bkSpeichern", speichern);
  knopf("bkSd", () => void aufSd());
  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewBank .bkFilter")) {
    b.addEventListener("click", () => {
      z.filter = (b.dataset.f ?? "alle") as PoolFilter;
      render();
    });
  }
  const suche = document.getElementById("bkSuche") as HTMLInputElement | null;
  suche?.addEventListener("input", () => {
    z.suche = suche.value;
    render();
    // Nach dem Neuzeichnen den Fokus zurückholen, sonst tippt man ins Leere.
    const neu = document.getElementById("bkSuche") as HTMLInputElement | null;
    neu?.focus();
    neu?.setSelectionRange(neu.value.length, neu.value.length);
  });
  for (const [klasse, menge] of [["bkQ", z.markiert], ["bkZ", z.markiertZiel]] as [string, Set<number>][]) {
    for (const c of document.querySelectorAll<HTMLInputElement>(`#viewBank .${klasse}`)) {
      c.addEventListener("change", () => {
        const nr = Number(c.dataset.nr);
        if (c.checked) menge.add(nr);
        else menge.delete(nr);
        // NICHT neu zeichnen: das riss dem Nutzer die Tabelle unter der Hand
        // weg (bei 500 Samples spuerbar), und mehrere Haken hintereinander
        // landeten auf abgehaengten Elementen. Es aendern sich ohnehin nur die
        // beiden Knopf-Beschriftungen.
        zaehlerAuffrischen();
      });
    }
  }
}

/** Nur die beiden Knöpfe nachziehen, deren Text von der Markierung abhängt. */
function zaehlerAuffrischen(): void {
  const add = document.getElementById("bkAdd") as HTMLButtonElement | null;
  if (add) {
    add.textContent = `Markierte → Zielbank (${z.markiert.size})`;
    add.disabled = z.markiert.size === 0;
  }
  const weg = document.getElementById("bkWeg") as HTMLButtonElement | null;
  if (weg) {
    weg.textContent = `Markierte entfernen (${z.markiertZiel.size})`;
    weg.disabled = z.markiertZiel.size === 0;
  }
}

async function ladeBank(f: File): Promise<void> {
  try {
    const bytes = new Uint8Array(await f.arrayBuffer());
    z.quelle = importSamplesFromAll(bytes);
    z.quellName = f.name;
    z.markiert.clear();
    z.meldung = `${z.quelle.length} Samples aus ${f.name} geladen. Die Quelle bleibt unberührt.`;
  } catch (err) {
    z.meldung = `Konnte ${f.name} nicht lesen: ${err instanceof Error ? err.message : String(err)}`;
  }
  render();
}

function uebernehmen(samples: PoolSample[]): void {
  if (!samples.length) return;
  const r = fuegeHinzu(z.ziel, samples, { quelle: z.quellName || "Quelle" });
  z.markiert.clear();
  z.meldung =
    `${r.aufgenommen} Sample(s) übernommen` +
    (r.hinweise.length ? ` — ${r.hinweise.join(" ")}` : ". Die Nummern wurden neu vergeben, Verweise ziehen beim Übernehmen von Patterns mit.");
  render();
}

/** Zielbank als .all-Bytes; leer gibt es keine Datei. */
function bankBytes(): Uint8Array | null {
  return buildSampleBank(alsPool(z.ziel));
}

function speichern(): void {
  try {
    const bytes = bankBytes();
    if (!bytes) {
      z.meldung = "Zielbank ist leer — nichts zu speichern.";
      render();
      return;
    }
    download(bytes, "zielbank.all", "application/octet-stream");
    z.meldung = "zielbank.all abgelegt.";
  } catch (err) {
    z.meldung = `Speichern ging nicht: ${err instanceof Error ? err.message : String(err)}`;
  }
  render();
}

async function aufSd(): Promise<void> {
  const fs = tekkFs();
  if (!fs) {
    z.meldung = "Auf SD kopieren geht nur in der Desktop-App.";
    render();
    return;
  }
  try {
    const medien = await fs.wechselmedien();
    if (!medien.length) {
      z.meldung = "Kein Wechselmedium gefunden — steckt die Karte?";
      render();
      return;
    }
    const bytes = bankBytes();
    if (!bytes) {
      z.meldung = "Zielbank ist leer — nichts zu kopieren.";
      render();
      return;
    }
    // Der Nutzer legt seine Sets unter <Karte>\2026 ab (Ansage vom 2026-08-26).
    const ordner = `${medien[0].pfad}\\2026`;
    const res = await fs.schreibe(ordner, [{ name: "zielbank.all", bytes }]);
    z.meldung = `Geschrieben: ${res.geschrieben.join(", ")}`;
  } catch (err) {
    z.meldung = `Auf SD ging nicht: ${err instanceof Error ? err.message : String(err)}`;
  }
  render();
}

export function initSampleManager(): void {
  render();
}

/** Beim Tabwechsel neu zeichnen (Speicherbalken, Zählerstände). */
export function sampleManagerWirdSichtbar(): void {
  render();
}

/**
 * patternBibliothek — abgelegte Patterns samt ihrer Samples, und was man mit
 * einer Auswahl daraus machen kann.
 *
 * Der Zweck ist das Ende der Sucherei: ein Pattern ohne die Bank, zu der es
 * gehoert, ist wertlos, also liegen beide zusammen im Regal. Man hakt an, was
 * man braucht, und waehlt unten, wohin es soll.
 *
 * Eine Regel zieht sich durch alle Wege aufs Geraet und ist bewusst nicht
 * verhandelbar: **eine Pattern-Datei wird nie ohne die Bank geschrieben, auf
 * die ihre Verweise zeigen.** Die Nummern sind das Einzige, was Pattern und
 * Sample verbindet; passen sie nicht zusammen, laedt das Geraet trotzdem und
 * spielt fremde Samples. Das gibt keinen Fehler — es klingt nur falsch, und
 * man sucht die Ursache im Pattern. Deshalb liefern die beiden Set-Wege je ein
 * fertiges Paar, statt dem Nutzer das Zusammenstellen zu ueberlassen (siehe
 * `core/bibliothekExport`).
 */

import { escapeHtml, download } from "./shared";
import { tekkBib, type BibKopf } from "./tekkBib";
import { tekkFs } from "./tekkFs";
import { panelBridge } from "./editor";
import { eintragZuJson, eintragAusJson } from "../core/bibliothekAblage";
import type { BibliothekEintrag } from "../core/bibliothek";
import {
  dateienEinzeln,
  dateienSeparat,
  dateienGemeinsam,
  type ExportDatei,
  type ExportErgebnis,
} from "../core/bibliothekExport";
import { clonePattern, type EditorPattern, type PoolSample } from "../core/editorModel";

/** Wohin die Sets auf der Karte gehen (Ansage des Nutzers: alles unter 2026). */
const SD_SET_ORDNER = "2026\\Bibliothek";
/** Einzelne Patterns liest das Geraet nur aus seinem eigenen Ordner. */
const SD_PATTERN_ORDNER = "KORG\\electribe sampler\\Pattern";

interface Zustand {
  eintraege: BibKopf[];
  markiert: Set<string>;
  meldung: string;
  /** Erster Geraete-Slot fuer die USB-Uebertragung (1-basiert). */
  slot: number;
  /** Patterns beim gemeinsamen Set aneinanderhaengen. */
  verketten: boolean;
  laeuft: boolean;
}

const z: Zustand = { eintraege: [], markiert: new Set(), meldung: "", slot: 1, verketten: false, laeuft: false };

const datum = (ms: number): string => (ms ? new Date(ms).toLocaleString() : "—");

/** Kennung, die als Dateiname sicher ist — der Name steht getrennt im Eintrag. */
let zaehler = 0;
function neueKennung(): string {
  return `${Date.now().toString(36)}-${(zaehler++).toString(36)}`;
}

/** Die Samples, die dieses Pattern wirklich braucht — nicht der ganze Pool. */
function samplesFuer(p: EditorPattern, pool: readonly PoolSample[]): PoolSample[] {
  const gebraucht = new Set<number>();
  for (const part of p.parts) if (part.sampleNumber !== null) gebraucht.add(part.sampleNumber);
  return pool.filter((s) => gebraucht.has(s.number));
}

function render(): void {
  const host = document.getElementById("viewBib");
  if (!host) return;
  const bib = tekkBib();
  if (!bib) {
    host.innerHTML = `<h2>Pattern-Bibliothek</h2>
      <p class="sub">Die Bibliothek legt Dateien auf der Platte ab — das geht nur in der Desktop-App.</p>`;
    return;
  }
  const n = z.markiert.size;
  const zeilen = z.eintraege.length
    ? z.eintraege
        .map(
          (e) => `<tr style="border-top:1px solid var(--border)">
        <td><input type="checkbox" class="bibC" data-id="${escapeHtml(e.id)}" ${z.markiert.has(e.id) ? "checked" : ""} /></td>
        <td>${escapeHtml(e.name)}</td>
        <td class="sub">${e.samples}</td>
        <td class="sub">${(e.bytes / 1024).toFixed(0)} kB</td>
        <td class="sub">${escapeHtml(datum(e.wann))}</td>
        <td style="text-align:right">
          <button class="bibLaden" data-id="${escapeHtml(e.id)}">In Editor</button>
          <button class="bibWeg" data-id="${escapeHtml(e.id)}">Löschen</button>
        </td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="6" class="sub" style="padding:10px 0">Noch nichts abgelegt — oben ein Pattern aus dem Editor hereinlegen.</td></tr>`;

  host.innerHTML = `
    <h2>Pattern-Bibliothek</h2>
    <p class="sub">
      Jeder Eintrag ist ein Pattern MIT den Samples, die es braucht. Was hier
      liegt, muss nie wieder gesucht werden.
    </p>

    <div class="card">
      <div class="row" style="gap:8px;flex-wrap:wrap">
        <button id="bibAblegen">Aktuelles Pattern ablegen</button>
        <button id="bibAlleAblegen">Alle Patterns des Projekts ablegen</button>
        <span class="railSpacer"></span>
        <button id="bibOrdner" class="ghost">Ordner öffnen</button>
        <button id="bibNeu" class="ghost">Liste auffrischen</button>
      </div>
    </div>

    <div class="card">
      <div class="tableWrap">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead><tr style="color:var(--muted);text-align:left">
            <th style="width:24px"></th><th>Name</th><th style="width:64px">Samples</th>
            <th style="width:70px">Größe</th><th style="width:150px">Abgelegt</th><th style="width:150px"></th>
          </tr></thead>
          <tbody>${zeilen}</tbody>
        </table>
      </div>
      <p class="sub" id="bibZaehler" style="margin:8px 0 0">${z.eintraege.length} Eintrag/Einträge, ${n} markiert.</p>
    </div>

    <div class="card">
      <h3 style="margin-top:0">Mit den markierten …</h3>

      <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
        <button id="bibUsb" ${n ? "" : "disabled"}>Per USB übertragen (${n})</button>
        <label class="sub">ab Slot
          <input id="bibSlot" type="number" min="1" max="250" value="${z.slot}" style="width:64px" />
        </label>
        <span class="sub">Schreibt dauerhaft auf die Geräte-Slots. Die Samples gehen NICHT mit — die passende Bank vorher am Gerät laden.</span>
      </div>

      <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">
        <button id="bibPat" ${n ? "" : "disabled"}>Einzelne .e2spat + Bank auf SD (${n})</button>
        <span class="sub">Je Pattern eine Datei im Pattern-Ordner der Karte, die zugehörige .all daneben.</span>
      </div>

      <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">
        <button id="bibSetSeparat" ${n ? "" : "disabled"}>Set: eine .e2sallpat + Bänke einzeln (${n})</button>
        <span class="sub">Die Nummern bleiben, wie sie sind — am Gerät lädt man zu jedem Pattern seine eigene Bank.</span>
      </div>

      <div class="row" style="gap:8px;margin-top:12px;flex-wrap:wrap">
        <button id="bibSetGemeinsam" ${n ? "" : "disabled"}>Set: eine .e2sallpat + EINE gemeinsame .all (${n})</button>
        <label class="sub"><input id="bibKette" type="checkbox" ${z.verketten ? "checked" : ""} /> Patterns verketten</label>
      </div>
      <p class="sub" style="margin:4px 0 0">Alle Samples in eine Bank, Verweise werden nachgezogen. Ein Import, alles spielbar.</p>

      <p class="sub" style="margin:12px 0 0">
        Ziel auf der Karte: <code>${escapeHtml(SD_SET_ORDNER)}</code> für Sets,
        <code>${escapeHtml(SD_PATTERN_ORDNER)}</code> für einzelne Patterns.
        Steckt keine Karte, landen sie unter <code>Downloads\\TekkForge</code> — der Pfad steht danach in der Meldung.
      </p>
    </div>

    ${z.meldung ? `<p class="sub" id="bibMeldung" style="white-space:pre-wrap">${escapeHtml(z.meldung)}</p>` : ""}
  `;
  verdrahten();
}

function knopf(id: string, fn: () => void): void {
  document.getElementById(id)?.addEventListener("click", fn);
}

function verdrahten(): void {
  knopf("bibAblegen", () => void ablegen(false));
  knopf("bibAlleAblegen", () => void ablegen(true));
  knopf("bibNeu", () => void liste());
  knopf("bibOrdner", () => void tekkBib()?.ordner());
  knopf("bibUsb", () => void perUsb());
  knopf("bibPat", () => void schreibeAus(dateienEinzeln, SD_PATTERN_ORDNER));
  knopf("bibSetSeparat", () => void schreibeAus(dateienSeparat, SD_SET_ORDNER));
  knopf("bibSetGemeinsam", () =>
    void schreibeAus((e) => dateienGemeinsam(e, { verketten: z.verketten }), SD_SET_ORDNER),
  );

  const slot = document.getElementById("bibSlot") as HTMLInputElement | null;
  slot?.addEventListener("change", () => {
    z.slot = Math.min(250, Math.max(1, Math.round(Number(slot.value) || 1)));
    slot.value = String(z.slot);
  });
  const kette = document.getElementById("bibKette") as HTMLInputElement | null;
  kette?.addEventListener("change", () => {
    z.verketten = kette.checked;
  });

  for (const c of document.querySelectorAll<HTMLInputElement>("#viewBib .bibC")) {
    c.addEventListener("change", () => {
      const id = c.dataset.id ?? "";
      if (c.checked) z.markiert.add(id);
      else z.markiert.delete(id);
      // Nur die Knopfbeschriftungen ziehen nach — die Tabelle unter der Hand
      // neu zu zeichnen kostet den naechsten Haken.
      zaehlerAuffrischen();
    });
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewBib .bibLaden"))
    b.addEventListener("click", () => void inEditor(b.dataset.id ?? ""));
  for (const b of document.querySelectorAll<HTMLButtonElement>("#viewBib .bibWeg"))
    b.addEventListener("click", () => void loeschen(b.dataset.id ?? ""));
}

function zaehlerAuffrischen(): void {
  const n = z.markiert.size;
  const texte: [string, string][] = [
    ["bibUsb", `Per USB übertragen (${n})`],
    ["bibPat", `Einzelne .e2spat + Bank auf SD (${n})`],
    ["bibSetSeparat", `Set: eine .e2sallpat + Bänke einzeln (${n})`],
    ["bibSetGemeinsam", `Set: eine .e2sallpat + EINE gemeinsame .all (${n})`],
  ];
  for (const [id, text] of texte) {
    const b = document.getElementById(id) as HTMLButtonElement | null;
    if (!b) continue;
    b.textContent = text;
    b.disabled = n === 0;
  }
  const zaehler = document.getElementById("bibZaehler");
  if (zaehler) zaehler.textContent = `${z.eintraege.length} Eintrag/Einträge, ${n} markiert.`;
}

function melde(text: string): void {
  z.meldung = text;
  render();
}

async function liste(): Promise<void> {
  const bib = tekkBib();
  if (!bib) return;
  try {
    z.eintraege = await bib.liste();
    // Markierungen, deren Eintrag verschwunden ist, mitnehmen — sonst zaehlt
    // die Auswahl Eintraege mit, die es nicht mehr gibt.
    const da = new Set(z.eintraege.map((e) => e.id));
    for (const id of [...z.markiert]) if (!da.has(id)) z.markiert.delete(id);
  } catch (err) {
    z.meldung = `Bibliothek liess sich nicht lesen: ${(err as Error).message}`;
  }
  render();
}

async function ablegen(alle: boolean): Promise<void> {
  const bib = tekkBib();
  if (!bib) return;
  const projekt = panelBridge.project;
  const patterns = alle ? projekt.patterns : [projekt.patterns[panelBridge.patternIndex]];
  let n = 0;
  try {
    for (const p of patterns) {
      if (!p) continue;
      const eintrag: BibliothekEintrag = {
        id: neueKennung(),
        name: p.name,
        pattern: clonePattern(p),
        samples: samplesFuer(p, projekt.samples),
        wann: Date.now(),
      };
      await bib.speichern(eintrag.id, eintragZuJson(eintrag));
      n++;
    }
  } catch (err) {
    melde(`Ablegen ging nicht: ${(err as Error).message}`);
    return;
  }
  await liste();
  melde(`${n} Pattern abgelegt — jeweils mit den Samples, auf die es zeigt.`);
}

async function volleEintraege(): Promise<BibliothekEintrag[]> {
  const bib = tekkBib();
  if (!bib) return [];
  const out: BibliothekEintrag[] = [];
  // In der Reihenfolge der Liste, nicht der Anklick-Reihenfolge: so ist die
  // Nummerierung im Set nachvollziehbar.
  for (const kopf of z.eintraege) {
    if (!z.markiert.has(kopf.id)) continue;
    const text = await bib.lesen(kopf.id);
    if (!text) continue;
    out.push(eintragAusJson(text));
  }
  return out;
}

async function inEditor(id: string): Promise<void> {
  const bib = tekkBib();
  if (!bib) return;
  try {
    const text = await bib.lesen(id);
    if (!text) {
      melde("Eintrag nicht gefunden.");
      return;
    }
    const e = eintragAusJson(text);
    const projekt = panelBridge.project;
    projekt.patterns.push(e.pattern);
    // Samples nur ergaenzen, wenn die Nummer im Pool noch frei ist —
    // eine belegte Nummer zu ueberschreiben zoege fremde Patterns mit.
    const belegt = new Set(projekt.samples.map((s) => s.number));
    const fehlend: number[] = [];
    for (const s of e.samples) {
      if (belegt.has(s.number)) fehlend.push(s.number);
      else projekt.samples.push(s);
    }
    panelBridge.patternIndex = projekt.patterns.length - 1;
    panelBridge.markDirty();
    melde(
      `„${e.name}" in den Editor gelegt.` +
        (fehlend.length
          ? ` Achtung: die Nummern ${[...new Set(fehlend)].join(", ")} waren im Pool schon belegt und wurden NICHT ersetzt — das Pattern spielt dort die Samples, die schon da sind.`
          : ""),
    );
  } catch (err) {
    melde(`Laden ging nicht: ${(err as Error).message}`);
  }
}

async function loeschen(id: string): Promise<void> {
  const bib = tekkBib();
  if (!bib) return;
  const kopf = z.eintraege.find((e) => e.id === id);
  if (!confirm(`„${kopf?.name ?? id}" aus der Bibliothek löschen?`)) return;
  await bib.loeschen(id);
  z.markiert.delete(id);
  await liste();
  melde("Eintrag gelöscht.");
}

/** Dateien auf die Karte legen — oder herunterladen, wenn keine da ist. */
async function schreibeAus(
  bauer: (e: readonly BibliothekEintrag[]) => ExportErgebnis,
  unterordner: string,
): Promise<void> {
  if (z.laeuft) return;
  z.laeuft = true;
  try {
    const eintraege = await volleEintraege();
    if (!eintraege.length) {
      melde("Nichts markiert.");
      return;
    }
    const r = bauer(eintraege);
    if (!r.dateien.length) {
      melde(`Nichts geschrieben.\n${r.hinweise.join("\n")}`);
      return;
    }
    const fs = tekkFs();
    let wohin = "Download-Ordner";
    if (fs) {
      const medien = await fs.wechselmedien();
      // Ohne Karte NICHT der Browser-Download: in der Electron-Huelle
      // verschwindet der still, und die Meldung „gespeichert“ waere gelogen.
      const ausweich = medien.length ? "" : ((await fs.standardOrdner?.()) ?? "");
      if (!medien.length && !ausweich) {
        herunterladen(r.dateien);
      } else {
        const ordner = `${medien.length ? medien[0].pfad : ausweich}\\${unterordner}`;
        const res = await fs.schreibe(ordner, r.dateien as { name: string; bytes: Uint8Array }[]);
        wohin = res.ordner + (medien.length ? "" : " (keine Karte gefunden)");
      }
    } else {
      herunterladen(r.dateien);
    }
    melde(
      `${r.dateien.length} Datei(en) → ${wohin}\n` +
        r.dateien.map((d) => `  ${d.name} (${(d.bytes.length / 1024).toFixed(0)} kB)`).join("\n") +
        (r.hinweise.length ? `\n${r.hinweise.join("\n")}` : ""),
    );
  } catch (err) {
    melde(`Schreiben ging nicht: ${(err as Error).message}`);
  } finally {
    z.laeuft = false;
  }
}

function herunterladen(dateien: readonly ExportDatei[]): void {
  for (const d of dateien) download(d.bytes, d.name, "application/octet-stream");
}

async function perUsb(): Promise<void> {
  if (z.laeuft) return;
  if (!panelBridge.midi.ready) {
    melde("Kein MIDI — erst im Editor auf „MIDI aktivieren“ klicken.");
    return;
  }
  const eintraege = await volleEintraege();
  if (!eintraege.length) {
    melde("Nichts markiert.");
    return;
  }
  const bis = z.slot + eintraege.length - 1;
  if (bis > 250) {
    melde(`Ab Slot ${z.slot} passen nur ${251 - z.slot} Patterns — das Gerät hat 250 Plätze.`);
    return;
  }
  // Der 0x4C-Dump schreibt dauerhaft in den Gerätespeicher. Was dort steht,
  // ist danach weg — das muss vorher dastehen, nicht hinterher.
  if (!confirm(`Slots ${z.slot}–${bis} auf dem Gerät werden überschrieben. Weiter?`)) return;
  z.laeuft = true;
  const gebraucht = new Set<number>();
  let ok = 0;
  try {
    for (let i = 0; i < eintraege.length; i++) {
      const e = eintraege[i];
      for (const part of e.pattern.parts) if (part.sampleNumber !== null) gebraucht.add(part.sampleNumber);
      const bestaetigt = await panelBridge.writePatternToSlotDirect(e.pattern, z.slot + i);
      if (bestaetigt) ok++;
    }
  } catch (err) {
    melde(`Übertragung abgebrochen: ${(err as Error).message}`);
    z.laeuft = false;
    return;
  }
  z.laeuft = false;
  const nummern = [...gebraucht].sort((a, b) => a - b);
  melde(
    `${ok} von ${eintraege.length} Pattern auf die Slots ${z.slot}–${bis} geschrieben` +
      (ok < eintraege.length ? " (der Rest ging raus, blieb aber unbestätigt)" : "") +
      `.\nDie Patterns erwarten die Samples ${nummern.join(", ") || "—"}. Über USB gehen nur Patterns; die passende Bank muss am Gerät geladen sein, sonst spielen sie fremde Samples.`,
  );
}

export function initPatternBibliothek(): void {
  render();
}

/** Beim Tabwechsel frisch von der Platte lesen — andere Fenster legen auch ab. */
export function bibliothekWirdSichtbar(): void {
  void liste();
}

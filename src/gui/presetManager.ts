/**
 * presetManager.ts (GUI) — die ganze Effekt-Preset-Bank und die Groove-Bank
 * als Listen: laden (Geraet, Sicherung, Firmware), umbauen (verschieben,
 * tauschen, umbenennen, loeschen, einfuegen, in den Editor), sichern, und
 * dann entweder fluechtig ins RAM oder dauerhaft in die Firmware.
 *
 * Der Zustand lebt in zwei Kopien: `basis` ist der geladene Stand, `zustand`
 * der umgebaute. Geschrieben werden nur die Unterschiede — fluechtig ueber
 * denselben Schreibweg wie die Sammlung (`verteileEintraege`), dauerhaft
 * ueber `baueFirmware` gegen die Firmware-Datei, die der Nutzer waehlt.
 *
 * Links eine Bibliothek: Presets, Grooves und Sammlungen aus Dateien oder
 * aus dem Editor, zum Ziehen auf einen Platz. Leerer Platz: einfach rein;
 * belegter Platz: Ersetzen, davor oder danach einfuegen.
 *
 * Entwurf: docs/superpowers/specs/2026-09-02-preset-manager-design.md
 */
import { $, escapeHtml, frageText, frageAuswahl, download, sha256Hex, dateiKnopf, dateiKnopfMehrere } from "./shared";
import type { FxPresetHooks } from "./fxPreset";
import { verteileEintraege, oeffneImEditor, aktuellesPreset, ifxMenueErweitern, grooveMenueErweitern } from "./fxPreset";
import {
  MANAGER_ARTEN,
  anzahlPlaetze,
  blockGroesse,
  leererBlock,
  istLeer,
  nameVon,
  algorithmusVon,
  zustandAusBaenken,
  zustandAusSicherung,
  zustandAusFirmware,
  umbenennen,
  verschieben,
  tauschen,
  loeschen,
  ersetzen,
  einfuegen,
  unterschiede,
  alsSammlung,
  hoechsterBelegter,
  luecken,
  doppelte,
  ramMapFuer,
  type ManagerArt,
  type ManagerZustand,
} from "../core/presetManager";
import { baueSammlung, leseSammlung, type SammlungsEintrag } from "../core/sammlung";
import { leseSicherung } from "../core/geraetSicherung";
import { baueFirmware, pruefeFirmware, HACKTRIBE_SHA256 } from "../core/firmwareBau";
import { erkenneKarte, karteLabel } from "../core/firmwareKarte";
import { addressForSlot } from "../core/hacktribeRam";
import { IFX_ZAEHLER, leseZaehlerStand, type ZaehlerWert } from "../core/ifxErweiterung";
import { legeAb } from "./ablage";
import { baueBauplan } from "../core/bauplan";
import {
  leererStand,
  leseStand,
  serialisiereStand,
  bibliotheksEintraege,
  filtereEintraege,
  fuegeHinzu,
  entferne,
  setzeFavorit,
  zeigeEingebaute,
  leereEigene,
  eintraegeAusDatei,
  alsSammlungsText,
  auswahlMitPlaetzen,
  platzBedarf,
  artAusDateiname,
  type BibliotheksStand,
  type BibliotheksEintrag,
  type BibArt,
} from "../core/fxBibliothek";
import { fxStandInPreset, partsMitFxStand, fxStandBeschreibung } from "../core/fxStand";
import { fxBibAblage, type FxBibAblage } from "./tekkFxBib";
import type { EditorPattern } from "../core/editorModel";

let hooks: FxPresetHooks | null = null;
let basis: ManagerZustand | null = null;
let zustand: ManagerZustand | null = null;
let quelle = "";
/** Wurde ein echter Stand (Geraet, Sicherung, Firmware) geladen? Ohne den gibt es kein fluechtiges Schreiben. */
let geladen = false;

/**
 * Die Bibliothek (core/fxBibliothek.ts): mitgelieferte Sets plus eigene
 * Eintraege, mit Favoriten, abgelegt ueber tekkFxBib. `bibliothek` ist die
 * gerade SICHTBARE Liste (gefiltert) — Ziehen und die Test-Aufrufe
 * adressieren sie ueber den Index.
 */
export interface BibEintrag {
  art: ManagerArt;
  name: string;
  bytes: Uint8Array;
  woher: string;
}
let bibStand: BibliotheksStand = leererStand();
let bibliothek: BibliotheksEintrag[] = [];
let bibAblage: FxBibAblage | null = null;
/** Ausgewaehlte Kennungen — nur fuer die Sitzung. */
let auswahl = new Set<string>();
/** Woher der Preset-Manager das Pattern mit den Live-FX-Werten bekommt (vom Panel registriert). */
let fxStandQuelle: (() => { pattern: EditorPattern; name: string } | null) | null = null;

export function registriereFxStandQuelle(fn: () => { pattern: EditorPattern; name: string } | null): void {
  fxStandQuelle = fn;
}

const FIRMWARE_ORDNER = "Firmware";
const ARTEN_LABEL: Record<ManagerArt, string> = { ifx: "IFX", mfx: "MFX", groove: "GROOVE" };
const listenId: Record<ManagerArt, string> = { ifx: "pmIfxListe", mfx: "pmMfxListe", groove: "pmGrooveListe" };
const kopfId: Record<ManagerArt, string> = { ifx: "pmIfxInfo", mfx: "pmMfxInfo", groove: "pmGrooveInfo" };

function setStatus(t: string): void {
  const el = document.getElementById("pmStatus");
  if (el) el.textContent = t;
}

const gleich = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Beide Listen zeigen immer alle Plaetze — auch bevor etwas geladen ist. */
function leererZustand(): ManagerZustand {
  return {
    ifx: Array.from({ length: anzahlPlaetze("ifx") }, () => leererBlock("ifx")),
    mfx: Array.from({ length: anzahlPlaetze("mfx") }, () => leererBlock("mfx")),
    groove: Array.from({ length: anzahlPlaetze("groove") }, () => leererBlock("groove")),
    ifxMaxIndex: -1,
    grooveMaxIndex: -1,
  };
}

const kopieVon = (z: ManagerZustand): ManagerZustand => ({
  ifx: z.ifx.map((b) => b.slice()),
  mfx: z.mfx.map((b) => b.slice()),
  groove: z.groove.map((b) => b.slice()),
  ifxMaxIndex: z.ifxMaxIndex,
  grooveMaxIndex: z.grooveMaxIndex,
});

// ─── Anzeige ─────────────────────────────────────────────────────────────────

function render(): void {
  if (!zustand || !basis) {
    zustand = leererZustand();
    basis = leererZustand();
  }
  const info = document.getElementById("pmInfo");
  const diff = unterschiede(zustand, basis);
  if (info) {
    info.textContent = geladen
      ? `${quelle} — ${diff.length ? `${diff.length} Platz/Plätze geändert` : "unverändert"}`
      : `nichts geladen — leere Bank${diff.length ? `, ${diff.length} Platz/Plätze belegt` : ""}`;
  }
  for (const art of MANAGER_ARTEN) {
    const liste = document.getElementById(listenId[art]);
    const kopf = document.getElementById(kopfId[art]);
    const belegt = hoechsterBelegter(zustand, art);
    const l = luecken(zustand, art);
    const zaehler = art === "ifx" ? zustand.ifxMaxIndex : art === "groove" ? zustand.grooveMaxIndex : -1;
    if (kopf) {
      kopf.textContent =
        `${belegt} von ${anzahlPlaetze(art)} belegt` +
        (zaehler >= 0 ? `, Menü laut Zähler bis ${zaehler + 1}` : "") +
        (l.length ? ` — ⚠ leer dazwischen: ${l.join(", ")}` : "");
    }
    if (!liste) continue;
    // Suchfeld: nur Plaetze zeigen, deren Name oder Algorithmus den Text enthaelt; leer = alle.
    const suche = ((document.getElementById("pmSuche") as HTMLInputElement | null)?.value ?? "").trim().toLowerCase();
    let treffer = 0;
    const dopp = doppelte(zustand, art);
    const zeilen = zustand[art].map((bytes, i) => {
      const platz = i + 1;
      const leer = istLeer(bytes, art);
      const geaendert = !gleich(bytes, basis![art][i]);
      const rohName = leer ? "" : nameVon(bytes, art);
      const rohAlgo = leer ? "" : algorithmusVon(bytes, art);
      if (suche && !`${rohName} ${rohAlgo}`.toLowerCase().includes(suche)) return "";
      treffer++;
      const andere = dopp.get(platz);
      const doppelMarke = andere
        ? ` <span title="byteweise gleich wie Platz ${andere.join(", ")}" style="color:var(--accent2);cursor:help">≡</span>`
        : "";
      const name = leer ? `<span style="color:var(--muted)">— leer —</span>` : escapeHtml(rohName) + doppelMarke;
      const algo = escapeHtml(rohAlgo);
      const k = (op: string, text: string, title: string) =>
        `<button class="ghost pmOp" data-art="${art}" data-platz="${platz}" data-op="${op}" title="${title}" style="padding:1px 6px;font-size:11px">${text}</button>`;
      return (
        `<div class="pmZeile" data-art="${art}" data-platz="${platz}" style="${geaendert ? "background:rgba(255,160,0,.12);" : ""}">` +
        `<span class="rolle" style="min-width:26px;text-align:right">${platz}</span>` +
        `<span style="flex:1 1 70px;min-width:70px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(leer ? "" : nameVon(bytes, art))}">${name}</span>` +
        `<span class="sub" style="margin:0;flex:0 1 96px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${algo}">${algo}</span>` +
        k("auf", "▲", "einen Platz nach vorn (kleinere Nummer)") +
        k("ab", "▼", "einen Platz nach hinten (größere Nummer)") +
        k("tausch", "⇄", "mit einem anderen Platz tauschen") +
        k("name", "✏", "umbenennen (15 Zeichen)") +
        k("editor", "✎", "im Editor oben öffnen — ändern, dann „Aus Editor übernehmen“") +
        k("datei", "⬇", `als Datei sichern (${art === "groove" ? ".e2gv" : art === "mfx" ? ".mfx" : ".e2fxp"})`) +
        k("weg", "✕", "löschen — die folgenden Plätze rücken auf, hinten wird ein Platz frei") +
        `</div>`
      );
    });
    liste.innerHTML =
      suche && !treffer
        ? `<p class="sub" style="margin:0">Kein Platz passt zu „${escapeHtml(suche)}“.</p>`
        : `<div class="startListe" style="max-height:420px;overflow:auto">${zeilen.join("")}</div>`;
    for (const b of liste.querySelectorAll<HTMLButtonElement>(".pmOp")) {
      b.addEventListener("click", () => void pmAktion(b.dataset.op ?? "", b.dataset.art as ManagerArt, Number(b.dataset.platz)));
    }
    // Ziel fuers Ziehen aus der Bibliothek: jede Zeile nimmt einen Bibliotheks-Eintrag ihrer Art an.
    for (const z of liste.querySelectorAll<HTMLElement>(".pmZeile")) {
      z.addEventListener("dragover", (e) => {
        if (!gezogen || gezogen.art !== z.dataset.art) return;
        e.preventDefault();
        z.style.outline = "2px solid var(--accent)";
      });
      z.addEventListener("dragleave", () => {
        z.style.outline = "";
      });
      z.addEventListener("drop", (e) => {
        e.preventDefault();
        z.style.outline = "";
        if (gezogen === null) return;
        const index = gezogen.index;
        gezogen = null;
        void pmBibAblegen(index, z.dataset.art as ManagerArt, Number(z.dataset.platz));
      });
    }
  }
  renderBibliothek();
}

// ─── Bibliothek ──────────────────────────────────────────────────────────────

/** Was gerade gezogen wird — HTML5-Drag traegt nur Text, der Eintrag selbst liegt hier. */
let gezogen: { index: number; art: ManagerArt } | null = null;

function bibSpeichern(): void {
  const text = serialisiereStand(bibStand);
  void bibAblage?.schreiben(text).catch((e: unknown) => setStatus(`Bibliothek nicht abgelegt: ${e instanceof Error ? e.message : String(e)}`));
}

function bibAendern(neu: BibliotheksStand): void {
  bibStand = neu;
  bibSpeichern();
  renderBibliothek();
}

/** Die sichtbare Liste nach Filter, Suche und Favoriten-Haken neu berechnen. */
function bibSichtbar(): BibliotheksEintrag[] {
  const art = ((document.getElementById("pmBibFilter") as HTMLSelectElement | null)?.value || "alle") as BibArt | "alle";
  const suche = (document.getElementById("pmBibSuche") as HTMLInputElement | null)?.value ?? "";
  const nurFavoriten = !!(document.getElementById("pmBibNurFav") as HTMLInputElement | null)?.checked;
  return filtereEintraege(bibliotheksEintraege(bibStand), { art, suche, nurFavoriten });
}

const ablageText = (): string => (bibAblage?.wo === "datei" ? "Ablage: Datei" : bibAblage?.wo === "browser" ? "Ablage: Browser" : "⚠ nur für diese Sitzung");

function renderBibliothek(): void {
  bibliothek = bibSichtbar();
  const alle = bibliotheksEintraege(bibStand);
  const liste = document.getElementById("pmBibListe");
  const info = document.getElementById("pmBibInfo");
  const eigene = bibStand.eigene.length;
  const eingebaut = alle.length - eigene;
  if (info) {
    info.textContent =
      `${eigene} eigene · ${eingebaut} eingebaut · ${bibStand.favoriten.length} Favorit(en)` +
      (bibliothek.length !== alle.length ? ` · ${bibliothek.length} gezeigt` : "") +
      ` · ${ablageText()}`;
  }
  const zeigen = document.getElementById("pmBibEingebaute");
  if (zeigen) zeigen.classList.toggle("hidden", bibStand.ausgeblendet.length === 0);
  const ordnerKnopf = document.getElementById("pmBibOrdner");
  if (ordnerKnopf) ordnerKnopf.classList.toggle("hidden", !bibAblage?.ordner);
  // Auswahl auf sichtbare + vorhandene Kennungen begrenzen
  const bekannt = new Set(alle.map((e) => e.id));
  for (const id of [...auswahl]) if (!bekannt.has(id)) auswahl.delete(id);
  const auswahlInfo = document.getElementById("pmBibAuswahlInfo");
  if (auswahlInfo) {
    const gew = alle.filter((e) => auswahl.has(e.id));
    const b = platzBedarf(gew);
    auswahlInfo.textContent = gew.length ? `${gew.length} (${b.ifx} IFX · ${b.mfx} MFX · ${b.groove} Grooves)` : "keine";
  }
  if (!liste) return;
  liste.innerHTML = bibliothek.length
    ? `<div class="startListe" style="max-height:360px;overflow:auto">${bibliothek
        .map(
          (e, index) =>
            `<div class="pmBib" draggable="true" data-index="${index}" data-id="${escapeHtml(e.id)}" title="${escapeHtml(e.woher)} — ziehen und auf einen ${ARTEN_LABEL[e.art]}-Platz fallen lassen" style="cursor:grab;display:flex;align-items:center;gap:6px">` +
            `<input type="checkbox" class="pmBibWahl" data-id="${escapeHtml(e.id)}"${auswahl.has(e.id) ? " checked" : ""} title="auswählen — für Datei, Bauplan, Manager oder Firmware" />` +
            `<button class="ghost pmBibFav" data-id="${escapeHtml(e.id)}" title="${e.favorit ? "Favorit — Klick entfernt den Stern" : "als Favorit markieren"}" style="padding:0 4px;font-size:13px;color:${e.favorit ? "var(--accent)" : "var(--muted)"}">${e.favorit ? "★" : "☆"}</button>` +
            `<span class="rolle" style="min-width:30px">${ARTEN_LABEL[e.art] === "GROOVE" ? "GV" : ARTEN_LABEL[e.art]}</span>` +
            `<span style="flex:1 1 120px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(e.name)}">${escapeHtml(e.name)}</span>` +
            `<span class="sub" style="margin:0;flex:0 1 110px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(algorithmusVon(e.bytes, e.art))}</span>` +
            `<span class="sub" style="margin:0;flex:0 1 120px;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.7" title="${escapeHtml(e.woher)}">${escapeHtml(e.woher)}</span>` +
            `<button class="ghost pmBibZu" data-index="${index}" title="ohne Ziehen: auf einen Platz legen (fragt nach dem Platz)" style="padding:1px 6px;font-size:11px">→</button>` +
            `<button class="ghost pmBibWeg" data-id="${escapeHtml(e.id)}" title="${e.eingebaut ? "ausblenden (mitgelieferter Eintrag — „Eingebaute zeigen“ holt ihn zurück)" : "aus der Bibliothek entfernen"}" style="padding:1px 6px;font-size:11px">✕</button></div>`,
        )
        .join("")}</div>`
    : `<p class="sub" style="margin:0">${alle.length ? "Nichts passt zu Filter und Suche." : "Noch leer — Presets, Grooves oder Sammlungen laden, oder aus dem Editor übernehmen."}</p>`;
  for (const z of liste.querySelectorAll<HTMLElement>(".pmBib")) {
    z.addEventListener("dragstart", (e) => {
      const index = Number(z.dataset.index);
      gezogen = { index, art: bibliothek[index]?.art ?? "ifx" };
      e.dataTransfer?.setData("text/plain", `tf-bib:${index}`);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = "copy";
    });
    z.addEventListener("dragend", () => {
      gezogen = null;
    });
  }
  for (const b of liste.querySelectorAll<HTMLButtonElement>(".pmBibZu")) {
    b.addEventListener("click", () => void bibZuPlatzGefragt(Number(b.dataset.index)));
  }
  for (const b of liste.querySelectorAll<HTMLButtonElement>(".pmBibWeg")) {
    b.addEventListener("click", () => bibAendern(entferne(bibStand, b.dataset.id ?? "")));
  }
  for (const b of liste.querySelectorAll<HTMLButtonElement>(".pmBibFav")) {
    b.addEventListener("click", () => pmBibFavorit(b.dataset.id ?? "", !bibStand.favoriten.includes(b.dataset.id ?? "")));
  }
  for (const c of liste.querySelectorAll<HTMLInputElement>(".pmBibWahl")) {
    c.addEventListener("change", () => pmBibWaehlen(c.dataset.id ?? "", c.checked));
  }
}

export function pmBibFavorit(id: string, an: boolean): void {
  bibAendern(setzeFavorit(bibStand, id, an));
}

export function pmBibWaehlen(id: string, an: boolean): void {
  if (an) auswahl.add(id);
  else auswahl.delete(id);
  renderBibliothek();
}

/** Fuer Tests: die sichtbare Bibliothek. */
export function pmBibEintraege(): BibliotheksEintrag[] {
  return bibliothek;
}

/** Die ausgewaehlten Eintraege in Bibliotheks-Reihenfolge. */
export function pmBibAuswahl(): BibliotheksEintrag[] {
  return bibliotheksEintraege(bibStand).filter((e) => auswahl.has(e.id));
}

/** Dateien in die Bibliothek: Einzelpresets nach Endung, Sammlungen/Sicherungen/Firmware mit allen Eintraegen. */
async function bibLaden(dateien: readonly File[]): Promise<void> {
  let neu = 0;
  let schonDa = 0;
  let st = bibStand;
  for (const f of dateien) {
    try {
      // Textdateien (Sammlung, Sicherung) kommen auch ohne arrayBuffer() an — z. B. aus dem Test-Stub.
      const bytes = typeof f.arrayBuffer === "function" ? new Uint8Array(await f.arrayBuffer()) : new TextEncoder().encode(await f.text());
      for (const e of eintraegeAusDatei(f.name, bytes)) {
        const r = fuegeHinzu(st, e);
        st = r.stand;
        if (r.vorhanden) schonDa++;
        else neu++;
      }
    } catch (e) {
      bibAendern(st);
      setStatus(e instanceof Error ? e.message : String(e));
      return;
    }
  }
  bibAendern(st);
  setStatus(`${neu} neu in der Bibliothek${schonDa ? `, ${schonDa} schon vorhanden` : ""} — Stern setzen, auswählen oder auf einen Platz ziehen.`);
}

/** Fuer Tests und den „aus Editor"-Knopf: einen Eintrag direkt aufnehmen. */
export function bibAufnehmen(e: BibEintrag): void {
  try {
    const r = fuegeHinzu(bibStand, { art: e.art, name: e.name, bytes: e.bytes, woher: e.woher });
    bibAendern(r.stand);
    if (r.vorhanden) setStatus(`„${e.name}“ ist schon in der Bibliothek.`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
  }
}

/**
 * Die Live-FX-Werte (fxStand.ts) des aktuellen Patterns in die IFX-Presets
 * seiner Parts schreiben — je Part das Preset, das der Part traegt
 * (`ifxType`, 0-basiert) aus dem geladenen Stand — und als eigene Eintraege
 * ablegen, ausgewaehlt. Master-Werte haben kein Preset im Pattern und werden
 * genannt, nicht geschrieben.
 */
export function pmFxStandUebernehmen(): { eintraege: number; meldung: string } {
  const q = fxStandQuelle?.() ?? null;
  if (!q) return { eintraege: 0, meldung: "Kein Pattern bekannt — erst das Panel öffnen (Live-Sync) oder ein Pattern im Editor wählen." };
  const liste = q.pattern.fxStand;
  if (!liste?.length) return { eintraege: 0, meldung: `„${q.name}“ hat keine gemerkten Live-FX-Werte — erst am MIDImix (FX-Layout, Regler 2/3) drehen.` };
  if (!zustand || !geladen) return { eintraege: 0, meldung: "Erst einen Stand laden (Gerät, Sicherung oder Firmware) — sonst ist nicht bekannt, welches Preset der Part trägt." };
  const parts = partsMitFxStand(liste);
  let st = bibStand;
  let n = 0;
  const zeilen: string[] = [];
  for (const part of parts) {
    const p = q.pattern.parts[part - 1];
    const typ = p?.params?.ifxType;
    if (typ === undefined || !Number.isInteger(typ) || typ < 0 || typ >= zustand.ifx.length) {
      zeilen.push(`Part ${part}: IFX-Typ unbekannt`);
      continue;
    }
    const basis = zustand.ifx[typ];
    if (istLeer(basis, "ifx")) {
      zeilen.push(`Part ${part}: Platz ${typ + 1} ist leer`);
      continue;
    }
    const r = fxStandInPreset(basis, liste, part);
    if (!r.gesetzt) {
      zeilen.push(`Part ${part}: kein Wert passt zu „${nameVon(basis, "ifx")}“`);
      continue;
    }
    const f = fuegeHinzu(st, { art: "ifx", name: nameVon(basis, "ifx"), bytes: r.bytes, woher: `${q.name} Part ${part} (Platz ${typ + 1})` });
    st = f.stand;
    auswahl.add(f.id);
    n++;
    zeilen.push(`Part ${part}: „${nameVon(basis, "ifx")}“ + ${r.gesetzt} Wert(e)${r.ausgelassen.length ? `, ${r.ausgelassen.length} ausgelassen` : ""}`);
  }
  if (liste.some((e) => e.part === 0)) zeilen.push("Master-Werte bleiben nur im Pattern (das Pattern kennt kein MFX-Preset)");
  bibAendern(st);
  const meldung = `${n} Preset(s) aus „${q.name}“ in der Bibliothek, ausgewählt — ${fxStandBeschreibung(liste)}. ${zeilen.join("; ")}.`;
  return { eintraege: n, meldung };
}

// ─── Auswahl herausgeben ─────────────────────────────────────────────────────

/** Startplaetze erfragen: Vorschlag ist der erste leere Platz des geladenen Stands, sonst hinter den Werks-Presets. */
async function startPlaetzeFragen(bedarf: Record<BibArt, number>): Promise<Record<BibArt, number> | null> {
  const vorgabe: Record<BibArt, number> = {
    ifx: (geladen && ersterLeerer("ifx")) || 50,
    mfx: (geladen && ersterLeerer("mfx")) || 1,
    groove: (geladen && ersterLeerer("groove")) || 63,
  };
  const out: Record<BibArt, number> = { ...vorgabe };
  for (const art of ["ifx", "mfx", "groove"] as const) {
    if (!bedarf[art]) continue;
    const roh = await frageText(`${bedarf[art]} ${ARTEN_LABEL[art]} ab Platz (1..${anzahlPlaetze(art)}):`, String(vorgabe[art]));
    if (roh === null || roh.trim() === "") return null;
    const n = Number(roh);
    if (!Number.isInteger(n) || n < 1 || n > anzahlPlaetze(art)) {
      setStatus(`Platz ${roh} gibt es nicht — ${ARTEN_LABEL[art]} zählt 1..${anzahlPlaetze(art)}.`);
      return null;
    }
    out[art] = n;
  }
  return out;
}

/** Auswahl mit Plaetzen versehen; meldet, was hinter der Grenze keinen Platz mehr bekam. */
async function auswahlMitPlaetzenGefragt(): Promise<SammlungsEintrag[] | null> {
  const gew = pmBibAuswahl();
  if (!gew.length) {
    setStatus("Nichts ausgewählt — Haken in der Bibliothek setzen.");
    return null;
  }
  const start = await startPlaetzeFragen(platzBedarf(gew));
  if (!start) return null;
  const r = auswahlMitPlaetzen(gew, start);
  if (r.ohnePlatz.length) {
    setStatus(`${r.ohnePlatz.length} Eintrag/Einträge passen hinter die Art-Grenze nicht mehr (${r.ohnePlatz.map((e) => e.name).join(", ")}) — Startplatz kleiner wählen oder weniger auswählen.`);
    return null;
  }
  return r.eintraege;
}

async function auswahlAlsDatei(): Promise<void> {
  const eintraege = await auswahlMitPlaetzenGefragt();
  if (!eintraege) return;
  const titel = (await frageText("Titel der Sammlung:", "Meine Auswahl")) ?? "";
  if (!titel.trim()) return;
  const datei = `${titel.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "auswahl"}.tfsam`;
  download(baueSammlung(eintraege, { titel }), datei, "application/json");
  setStatus(`${eintraege.length} Einträge mit Platz als ${datei} gesichert — „+ Datei einfügen…“ legt sie an ihre Plätze, „Firmware patchen…“ brennt sie ein.`);
}

async function auswahlAlsBauplan(): Promise<void> {
  const eintraege = await auswahlMitPlaetzenGefragt();
  if (!eintraege) return;
  const titel = (await frageText("Titel des Bauplans:", "Meine Presets")) ?? "";
  if (!titel.trim()) return;
  const datei = `${titel.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "bauplan"}.tfbau`;
  download(baueBauplan({ titel, autor: "", eintraege }), datei, "application/json");
  setStatus(`Bauplan ${datei} mit ${eintraege.length} Einträgen gesichert — in der Firmware-Werkbank laden.`);
}

/** Die Auswahl in die Listen rechts legen — ab den erfragten Startplaetzen. Exportiert fuer Tests. */
export async function pmAuswahlInManager(start?: Record<BibArt, number>): Promise<number> {
  if (!zustand) return 0;
  const gew = pmBibAuswahl();
  if (!gew.length) {
    setStatus("Nichts ausgewählt — Haken in der Bibliothek setzen.");
    return 0;
  }
  const s = start ?? (await startPlaetzeFragen(platzBedarf(gew)));
  if (!s) return 0;
  const r = auswahlMitPlaetzen(gew, s);
  let n = 0;
  try {
    for (const e of r.eintraege) {
      zustand = ersetzen(zustand, e.art, e.platz!, e.bytes);
      n++;
    }
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
  }
  render();
  setStatus(`${n} Einträge in den Manager gelegt${r.ohnePlatz.length ? `, ${r.ohnePlatz.length} passten hinter die Art-Grenze nicht` : ""} — „Flüchtig schreiben“ oder „Firmware patchen…“.`);
  return n;
}

async function auswahlInFirmware(f: File): Promise<void> {
  const eintraege = await auswahlMitPlaetzenGefragt();
  if (!eintraege) return;
  await firmwareBauenMit(f, eintraege, `${eintraege.length} Einträge aus der Bibliothek`);
}

export type AblegeModus = "ersetzen" | "vor" | "nach";

/**
 * Einen Bibliotheks-Eintrag auf einen Platz legen. Leerer Platz: einfach rein.
 * Belegter Platz: Ersetzen, davor oder danach einfuegen — gefragt wird nur,
 * wenn `modus` fehlt. Einfuegen rueckt den Rest nach hinten und faellt durch,
 * wenn hinten ein belegter Platz herausfiele.
 */
export async function pmBibAblegen(index: number, art: ManagerArt, platz: number, modus?: AblegeModus): Promise<void> {
  const e = bibliothek[index];
  if (!e || !zustand) return;
  if (e.art !== art) {
    setStatus(`„${e.name}“ ist ein ${ARTEN_LABEL[e.art]}-Eintrag — er gehört in die ${ARTEN_LABEL[e.art]}-Liste.`);
    return;
  }
  try {
    const belegt = platz >= 1 && platz <= anzahlPlaetze(art) && !istLeer(zustand[art][platz - 1], art);
    let wahl: AblegeModus | null = modus ?? (belegt ? null : "ersetzen");
    if (wahl === null) {
      const i = await frageAuswahl(
        `Platz ${platz} ist belegt („${nameVon(zustand[art][platz - 1], art)}“). Was soll mit „${e.name}“ passieren?`,
        ["Ersetzen", "Davor einfügen", "Danach einfügen"],
        0,
      );
      if (i === null) return;
      wahl = (["ersetzen", "vor", "nach"] as const)[i];
    }
    if (wahl === "ersetzen") zustand = ersetzen(zustand, art, platz, e.bytes);
    else if (wahl === "vor") zustand = einfuegen(zustand, art, platz, e.bytes);
    else zustand = einfuegen(zustand, art, platz + 1, e.bytes);
    render();
    const wo = wahl === "ersetzen" ? `auf Platz ${platz}` : wahl === "vor" ? `vor Platz ${platz} (jetzt Platz ${platz})` : `nach Platz ${platz} (jetzt Platz ${platz + 1})`;
    setStatus(`„${e.name}“ ${wo} gelegt${belegt && wahl !== "ersetzen" ? " — der Rest ist nach hinten gerückt" : ""}.`);
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err));
  }
}

async function bibZuPlatzGefragt(index: number): Promise<void> {
  const e = bibliothek[index];
  if (!e || !zustand) return;
  const vorschlag = ersterLeerer(e.art) || 1;
  const roh = await frageText(`„${e.name}“ (${ARTEN_LABEL[e.art]}) auf Platz (1..${anzahlPlaetze(e.art)}):`, String(vorschlag));
  if (roh === null || roh.trim() === "") return; // Escape = abbrechen
  const antwort = Number(roh);
  if (!Number.isFinite(antwort)) return;
  await pmBibAblegen(index, e.art, antwort);
}

// ─── Aktionen je Zeile ───────────────────────────────────────────────────────

/** Die Zeilen-Knoepfe — als Funktion exportiert, damit der Test sie ohne DOM-Ereignisse treiben kann. */
export async function pmAktion(op: string, art: ManagerArt, platz: number, wert?: string | number): Promise<void> {
  if (!zustand) {
    setStatus("Erst einen Stand laden.");
    return;
  }
  try {
    switch (op) {
      case "auf":
        if (platz > 1) zustand = verschieben(zustand, art, platz, platz - 1);
        break;
      case "ab":
        if (platz < anzahlPlaetze(art)) zustand = verschieben(zustand, art, platz, platz + 1);
        break;
      case "nach": {
        // Escape in der Abfrage heisst abbrechen — Number(null) waere 0 und liefe als "Platz 0" weiter.
        const antwort = wert ?? (await frageText(`Platz ${platz} verschieben nach Platz (1..${anzahlPlaetze(art)}):`, String(platz)));
        if (antwort === null || antwort === undefined || String(antwort).trim() === "") return;
        const ziel = Number(antwort);
        if (!Number.isFinite(ziel)) return;
        zustand = verschieben(zustand, art, platz, ziel);
        break;
      }
      case "tausch": {
        const antwort = wert ?? (await frageText(`Platz ${platz} tauschen mit Platz (1..${anzahlPlaetze(art)}):`, ""));
        if (antwort === null || antwort === undefined || String(antwort).trim() === "") return;
        const ziel = Number(antwort);
        if (!Number.isFinite(ziel) || ziel === platz) return;
        zustand = tauschen(zustand, art, platz, ziel);
        break;
      }
      case "name": {
        const alt = nameVon(zustand[art][platz - 1], art);
        const neu = typeof wert === "string" ? wert : await frageText(`Neuer Name für Platz ${platz} (max 15):`, alt);
        if (neu === null || neu === undefined) return;
        zustand = umbenennen(zustand, art, platz, neu);
        break;
      }
      case "weg":
        zustand = loeschen(zustand, art, platz);
        break;
      case "editor":
        if (istLeer(zustand[art][platz - 1], art)) {
          setStatus(`Platz ${platz} ist leer — nichts zu öffnen.`);
          return;
        }
        oeffneImEditor(art, zustand[art][platz - 1], `Manager, ${ARTEN_LABEL[art]}-Platz ${platz}`);
        setStatus(`${ARTEN_LABEL[art]}-Platz ${platz} im Editor. Nach dem Ändern „Aus Editor übernehmen…“ auf Platz ${platz}.`);
        return;
      case "datei": {
        const bytes = zustand[art][platz - 1];
        const name = (nameVon(bytes, art) || `${art}-${platz}`).replace(/[^A-Za-z0-9 _-]/g, "").trim() || `${art}-${platz}`;
        const endung = art === "mfx" ? "mfx" : art === "groove" ? "e2gv" : "e2fxp";
        download(bytes, `${name}.${endung}`, "application/octet-stream");
        setStatus(`Platz ${platz} als ${name}.${endung} gesichert.`);
        return;
      }
      default:
        return;
    }
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e));
    return;
  }
  render();
}

// ─── Laden ───────────────────────────────────────────────────────────────────

function uebernehmen(z: ManagerZustand, woher: string): void {
  basis = z;
  zustand = kopieVon(z);
  quelle = woher;
  geladen = true;
  render();
  setStatus(`${woher}: ${hoechsterBelegter(z, "ifx")} IFX, ${hoechsterBelegter(z, "mfx")} MFX und ${hoechsterBelegter(z, "groove")} Grooves belegt.`);
}

async function vomGeraetLesen(): Promise<void> {
  if (!hooks) return;
  const bank = async (art: ManagerArt, was: string): Promise<Uint8Array | null> => {
    const map = ramMapFuer(art);
    const n = anzahlPlaetze(art);
    const groesse = blockGroesse(art);
    const out = new Uint8Array(n * groesse);
    for (let i = 0; i < n; i++) {
      setStatus(`Lese ${was} Platz ${i + 1}/${n} …`);
      const r = await hooks!.lesen(addressForSlot(map, i), groesse);
      if (!r.ok) {
        setStatus(`Abbruch bei ${was} Platz ${i + 1}: ${r.reason}. Nichts geladen.`);
        return null;
      }
      out.set(r.bytes, i * groesse);
    }
    return out;
  };
  const ifx = await bank("ifx", "IFX");
  if (!ifx) return;
  const mfx = await bank("mfx", "MFX");
  if (!mfx) return;
  const gv = await bank("groove", "Groove");
  if (!gv) return;
  const zaehler: ZaehlerWert[] = [];
  for (const z of IFX_ZAEHLER) {
    const r = await hooks.lesen(z.addr, 1);
    if (!r.ok) {
      setStatus(`Zähler 0x${z.addr.toString(16).toUpperCase()} nicht lesbar: ${r.reason}. Nichts geladen.`);
      return;
    }
    zaehler.push({ addr: z.addr, wert: r.bytes[0] });
  }
  const stand = leseZaehlerStand(zaehler);
  const gAnzahl = await hooks.lesen(0xc007bb88, 1);
  const grooveMax = gAnzahl.ok ? gAnzahl.bytes[0] - 1 : -1;
  uebernehmen(zustandAusBaenken(ifx, mfx, stand.ok ? stand.maxIndex : -1, gv, grooveMax), "Vom Gerät gelesen");
  if (!stand.ok) setStatus(`Geladen, aber die IFX-Zähler widersprechen sich: ${stand.reason}.`);
}

async function ausSicherung(f: File): Promise<void> {
  try {
    uebernehmen(zustandAusSicherung(leseSicherung(await f.text())), `Sicherung ${f.name}`);
  } catch (e) {
    setStatus(`Sicherung nicht lesbar: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function ausFirmware(f: File): Promise<void> {
  try {
    const fw = new Uint8Array(await f.arrayBuffer());
    // Jede Karte darf in den Manager: Hacktribe ueber die Baenke, Stock
    // (Sampler wie Synth) ueber die Zeigertabellen — Plaetze, die die Karte
    // nicht hat, bleiben leer.
    const e = erkenneKarte(fw);
    if (!e.ok) throw new Error(e.reason);
    uebernehmen(zustandAusFirmware(fw, e.karte), `Firmware ${f.name} (${karteLabel(e)})`);
  } catch (e) {
    setStatus(`Firmware nicht lesbar: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── Hinzufuegen ─────────────────────────────────────────────────────────────

function ersterLeerer(art: ManagerArt): number {
  if (!zustand) return 0;
  const i = zustand[art].findIndex((b) => istLeer(b, art));
  return i < 0 ? 0 : i + 1;
}

/** Eine Datei einfuegen: Einzelblock auf den ersten leeren Platz seiner Art, Sammlung an ihre Plaetze. */
async function dateiEinfuegen(f: File): Promise<void> {
  if (!zustand) {
    setStatus("Erst einen Stand laden.");
    return;
  }
  try {
    if (/\.(tfsam|json)$/i.test(f.name)) {
      const s = leseSammlung(await f.text());
      let n = 0;
      for (const e of s.eintraege) {
        const platz = e.platz ?? ersterLeerer(e.art);
        if (!platz) throw new Error(`${ARTEN_LABEL[e.art]} ist voll — „${e.name}“ hat keinen Platz`);
        zustand = ersetzen(zustand, e.art, platz, e.bytes);
        n++;
      }
      render();
      setStatus(`${n} aus „${s.titel}“ eingefügt.`);
      return;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const art = artAusDateiname(f.name);
    if (bytes.length !== blockGroesse(art)) throw new Error(`${bytes.length} Bytes — ein ${ARTEN_LABEL[art]}-Block hat ${blockGroesse(art)}`);
    const platz = ersterLeerer(art);
    if (!platz) throw new Error(`${ARTEN_LABEL[art]} ist voll — erst einen Platz löschen`);
    zustand = ersetzen(zustand, art, platz, bytes);
    render();
    setStatus(`„${nameVon(bytes, art)}“ auf ${ARTEN_LABEL[art]}-Platz ${platz} gelegt.`);
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e));
  }
}

async function ausEditor(platzVorgabe?: number): Promise<void> {
  if (!zustand) {
    setStatus("Erst einen Stand laden.");
    return;
  }
  const p = aktuellesPreset();
  if (!p) {
    setStatus("Im Editor steht kein Preset und keine Groove-Vorlage.");
    return;
  }
  const vorschlag = ersterLeerer(p.art) || 1;
  let antwort = platzVorgabe;
  if (antwort === undefined) {
    const roh = await frageText(`„${nameVon(p.bytes, p.art)}“ (${ARTEN_LABEL[p.art]}) auf Platz (1..${anzahlPlaetze(p.art)}):`, String(vorschlag));
    if (roh === null || roh.trim() === "") return; // Escape = abbrechen
    antwort = Number(roh);
  }
  if (!Number.isFinite(antwort)) return;
  try {
    zustand = ersetzen(zustand, p.art, antwort, p.bytes);
    render();
    setStatus(`„${nameVon(p.bytes, p.art)}“ auf ${ARTEN_LABEL[p.art]}-Platz ${antwort} gelegt.`);
  } catch (e) {
    setStatus(e instanceof Error ? e.message : String(e));
  }
}

async function exportieren(): Promise<void> {
  if (!zustand) {
    setStatus("Erst einen Stand laden.");
    return;
  }
  const eintraege = alsSammlung(zustand);
  const titel = (await frageText("Titel der Sammlung:", "Meine Bank")) ?? "Bank";
  const datei = `${titel.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "bank"}.tfsam`;
  download(baueSammlung(eintraege, { titel }), datei, "application/json");
  setStatus(`${eintraege.length} Einträge mit Platz als ${datei} gesichert.`);
}

// ─── Schreiben ───────────────────────────────────────────────────────────────

function aenderungen(): SammlungsEintrag[] | null {
  if (!zustand || !basis) {
    setStatus("Erst einen Stand laden.");
    return null;
  }
  const diff = unterschiede(zustand, basis);
  if (!diff.length) setStatus("Nichts geändert — es gibt nichts zu schreiben.");
  return diff.length ? diff : null;
}

/** Fluechtig: nur die Unterschiede ins RAM, danach die Zaehler bis zum hoechsten belegten IFX- und Groove-Platz. */
async function fluechtigSchreiben(): Promise<void> {
  if (!geladen) {
    setStatus("Erst einen echten Stand laden (Gerät oder Sicherung) — sonst gibt es keinen Vorher-Stand, gegen den geschrieben wird.");
    return;
  }
  const diff = aenderungen();
  if (!diff || !zustand || !basis) return;
  // Erst die Bloecke, dann die Menues — ausgerichtet am hoechsten BELEGTEN
  // Platz der Bank, nicht am hoechsten geaenderten: wer nur Platz 10 umbenennt,
  // waehrend 50–60 belegt sind, soll 50–60 trotzdem im Menue bekommen.
  const ok = await verteileEintraege(diff, false, "Manager: ");
  const meldungen: string[] = [document.getElementById("fxpStatus")?.textContent ?? ""];
  if (ok) {
    for (const [art, bekannt, anpassen] of [
      ["ifx", zustand.ifxMaxIndex, ifxMenueErweitern],
      ["groove", zustand.grooveMaxIndex, grooveMenueErweitern],
    ] as const) {
      const belegt = hoechsterBelegter(zustand, art);
      const l = luecken(zustand, art);
      if (l.length) {
        meldungen.push(`⚠ ${art === "ifx" ? "IFX" : "Groove"}-Zähler nicht angepasst — leer dazwischen: Platz ${l.join(", ")}.`);
        continue;
      }
      // Nur anfassen, wenn das Menue nicht schon genau bis dorthin reicht.
      if (belegt > 0 && belegt - 1 !== bekannt) {
        const geaendert = await anpassen(belegt, "Manager: ");
        meldungen.push(document.getElementById("fxpStatus")?.textContent ?? "");
        if (geaendert) {
          if (art === "ifx") zustand.ifxMaxIndex = belegt - 1;
          else zustand.grooveMaxIndex = belegt - 1;
        }
      }
    }
    // Der geschriebene Stand ist jetzt die Basis — weitere Aenderungen zaehlen von hier.
    basis = kopieVon(zustand);
    quelle = "Auf dem Gerät (flüchtig)";
    render();
  }
  setStatus(`${meldungen.filter(Boolean).join(" ")} Gilt bis zum Ausschalten; „Alle zurückschreiben“ im FX-Preset-Bereich nimmt es zurück.`);
}

/** Dauerhaft: die Unterschiede zur gewaehlten Firmware-Datei einbrennen. */
async function firmwarePatchen(f: File): Promise<void> {
  // Ohne geladenen Stand ist die leere Bank nur die Vorschau — sie gegen die
  // Datei zu halten hiesse, alle belegten Plaetze der Firmware zu leeren.
  if (!zustand || !geladen) {
    setStatus("Erst einen echten Stand laden (Gerät, Sicherung oder Firmware) — sonst würde die leere Vorschau-Bank jeden belegten Platz der Datei leeren.");
    return;
  }
  const fw = new Uint8Array(await f.arrayBuffer());
  const pr = pruefeFirmware(fw);
  if (!pr.ok) {
    setStatus(`Firmware abgelehnt: ${pr.reason}`);
    return;
  }
  const hash = await sha256Hex(fw);
  if (hash !== null && hash !== HACKTRIBE_SHA256) {
    setStatus(
      `Firmware abgelehnt: ${f.name} ist nicht die unveränderte Hacktribe-Firmware (SHA-256 ${hash.slice(0, 16)}…, erwartet ${HACKTRIBE_SHA256.slice(0, 16)}…). ` +
        "Für schon gepatchte Basen: die Firmware-Werkbank darunter.",
    );
    return;
  }
  let fwZustand: ManagerZustand;
  try {
    fwZustand = zustandAusFirmware(fw);
  } catch (e) {
    setStatus(`Firmware nicht lesbar: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  // Unterschiede zur DATEI, nicht zur geladenen Basis — die Datei ist die Wahrheit fuer den Flash.
  const diff = unterschiede(zustand, fwZustand);
  if (!diff.length) {
    setStatus("Die Firmware enthält diesen Stand schon — nichts einzubrennen.");
    return;
  }
  await firmwareBauenMit(f, diff, `${diff.length} Platz/Plätze`, fw);
}

/**
 * Der eine Bauweg: unveraenderte Hacktribe-Firmware pruefen (Kopf + Hash),
 * die Eintraege mit Platz einbrennen, ablegen. Vom Manager (Unterschiede)
 * und von der Bibliothek (Auswahl) gleichermassen benutzt.
 */
async function firmwareBauenMit(f: File, eintraege: readonly SammlungsEintrag[], was: string, geprueft?: Uint8Array): Promise<void> {
  let fw = geprueft;
  if (!fw) {
    fw = new Uint8Array(await f.arrayBuffer());
    const pr = pruefeFirmware(fw);
    if (!pr.ok) {
      setStatus(`Firmware abgelehnt: ${pr.reason}`);
      return;
    }
    const hash = await sha256Hex(fw);
    if (hash !== null && hash !== HACKTRIBE_SHA256) {
      setStatus(
        `Firmware abgelehnt: ${f.name} ist nicht die unveränderte Hacktribe-Firmware (SHA-256 ${hash.slice(0, 16)}…, erwartet ${HACKTRIBE_SHA256.slice(0, 16)}…). ` +
          "Für schon gepatchte Basen: die Firmware-Werkbank darunter.",
      );
      return;
    }
  }
  const r = baueFirmware(fw, eintraege);
  if (!r.ok) {
    setStatus(`Nicht gebaut: ${r.reason}`);
    return;
  }
  const neu = await sha256Hex(r.bytes);
  const ab = await legeAb("SYSTEM.VSB", r.bytes, FIRMWARE_ORDNER);
  const menue = r.bericht.zaehler.length ? `, IFX-Menü bis Platz ${r.bericht.ifxMaxNachher + 1}` : "";
  const grooves = r.bericht.grooveZaehler.length ? `, Grooves bis Platz ${r.bericht.grooveMaxNachher + 1}` : "";
  setStatus(
    `Firmware gebaut: ${was} eingebrannt${menue}${grooves}` +
      (neu ? `, SHA-256 ${neu.slice(0, 16)}…` : "") +
      (ab.pfad ? ` → ${ab.pfad}.` : " → Download.") +
      " Installieren: als SYSTEM.VSB nach KORG/electribe sampler/System/ auf die SD-Karte, dann am Gerät die Update-Funktion.",
  );
}

// ─── Init ────────────────────────────────────────────────────────────────────

export function initPresetManager(h: FxPresetHooks): void {
  hooks = h;
  if (!document.getElementById("pmPanel")) return;
  $("pmGeraet").addEventListener("click", () => void vomGeraetLesen());
  dateiKnopf("pmSicherungLaden", "pmSicherungIn", (f) => void ausSicherung(f));
  dateiKnopf("pmFirmwareLaden", "pmFirmwareIn", (f) => void ausFirmware(f));
  dateiKnopf("pmDateiEinfuegen", "pmDateiIn", (f) => void dateiEinfuegen(f));
  $("pmAusEditor").addEventListener("click", () => void ausEditor());
  $("pmExport").addEventListener("click", () => void exportieren());
  $("pmSchreiben").addEventListener("click", () => void fluechtigSchreiben());
  dateiKnopf("pmPatchen", "pmBasisIn", (f) => void firmwarePatchen(f));
  $("pmVerwerfen").addEventListener("click", () => {
    if (basis && geladen) uebernehmen(basis, quelle);
    else {
      zustand = leererZustand();
      basis = leererZustand();
      render();
    }
  });
  dateiKnopfMehrere("pmBibLaden", "pmBibIn", (dateien) => void bibLaden(dateien));
  $("pmBibAusEditor").addEventListener("click", () => {
    const p = aktuellesPreset();
    if (!p) {
      setStatus("Im Editor steht kein Preset und keine Groove-Vorlage.");
      return;
    }
    bibAufnehmen({ art: p.art, name: nameVon(p.bytes, p.art) || "Eintrag", bytes: p.bytes, woher: "Editor" });
    setStatus(`„${nameVon(p.bytes, p.art)}“ in die Bibliothek gelegt.`);
  });
  $("pmBibFxStand").addEventListener("click", () => setStatus(pmFxStandUebernehmen().meldung));
  $("pmBibExport").addEventListener("click", () => {
    void (async () => {
      const sichtbar = bibSichtbar();
      if (!sichtbar.length) {
        setStatus("Nichts zu exportieren.");
        return;
      }
      const titel = (await frageText("Titel der Sammlung:", "Meine Bibliothek")) ?? "";
      if (!titel.trim()) return;
      const datei = `${titel.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "bibliothek"}.tfsam`;
      download(alsSammlungsText(sichtbar, titel), datei, "application/json");
      setStatus(`${sichtbar.length} Einträge als ${datei} gesichert (ohne Plätze — „+ Laden…“ holt sie zurück).`);
    })();
  });
  $("pmBibFilter").addEventListener("change", renderBibliothek);
  $("pmBibSuche").addEventListener("input", renderBibliothek);
  $("pmBibNurFav").addEventListener("change", renderBibliothek);
  $("pmBibEingebaute").addEventListener("click", () => bibAendern(zeigeEingebaute(bibStand)));
  $("pmBibOrdner").addEventListener("click", () => void bibAblage?.ordner?.());
  $("pmSuche").addEventListener("input", render);
  $("pmBibLeeren").addEventListener("click", () => {
    if (!bibStand.eigene.length) {
      setStatus("Keine eigenen Einträge da.");
      return;
    }
    bibAendern(leereEigene(bibStand));
    setStatus("Eigene Einträge entfernt — die mitgelieferten bleiben.");
  });
  $("pmBibAlle").addEventListener("click", () => {
    for (const e of bibSichtbar()) auswahl.add(e.id);
    renderBibliothek();
  });
  $("pmBibKeine").addEventListener("click", () => {
    auswahl.clear();
    renderBibliothek();
  });
  $("pmBibAuswahlDatei").addEventListener("click", () => void auswahlAlsDatei());
  $("pmBibAuswahlBauplan").addEventListener("click", () => void auswahlAlsBauplan());
  $("pmBibAuswahlManager").addEventListener("click", () => void pmAuswahlInManager());
  dateiKnopf("pmBibAuswahlFirmware", "pmBibFirmwareIn", (f) => void auswahlInFirmware(f));
  zustand = leererZustand();
  basis = leererZustand();
  geladen = false;
  auswahl = new Set();
  bibStand = leererStand();
  bibAblage = fxBibAblage();
  render();
  // Den abgelegten Stand nachladen — ein reiner Sitzungsspeicher faengt leer an.
  if (bibAblage.wo !== "sitzung") {
    void bibAblage
      .lesen()
      .then((text) => {
        bibStand = leseStand(text);
        renderBibliothek();
      })
      .catch(() => renderBibliothek());
  }
}

/** Fuer Tests: der aktuelle Zustand. */
export function pmZustand(): ManagerZustand | null {
  return zustand;
}

/**
 * Eintraege mit Platz in den Manager legen (Bauplan laden): ist ein Stand
 * geladen, direkt auf ihre Plaetze; sonst in die Bibliothek, damit nichts
 * verloren geht und der Nutzer sie nach dem Laden selbst ablegen kann.
 */
export function pmEintraegeUebernehmen(eintraege: readonly SammlungsEintrag[], woher: string): { gesetzt: number; inBibliothek: number } {
  let gesetzt = 0;
  let inBibliothek = 0;
  for (const e of eintraege) {
    if (geladen && zustand && e.platz !== undefined) {
      try {
        zustand = ersetzen(zustand, e.art, e.platz, e.bytes);
        gesetzt++;
        continue;
      } catch {
        /* dann eben in die Bibliothek */
      }
    }
    try {
      bibStand = fuegeHinzu(bibStand, { art: e.art, name: e.name, bytes: e.bytes, woher }).stand;
      inBibliothek++;
    } catch {
      /* leerer Block — gehoert nirgendwohin */
    }
  }
  bibSpeichern();
  render();
  return { gesetzt, inBibliothek };
}

/** Wurde ein echter Stand geladen? Ohne den ist die leere Bank kein Wunsch, sondern nur die Vorschau. */
export function pmGeladen(): boolean {
  return geladen;
}

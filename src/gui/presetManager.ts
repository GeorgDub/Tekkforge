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
  ramMapFuer,
  type ManagerArt,
  type ManagerZustand,
} from "../core/presetManager";
import { baueSammlung, leseSammlung, type SammlungsEintrag } from "../core/sammlung";
import { leseSicherung } from "../core/geraetSicherung";
import { baueFirmware, pruefeFirmware, HACKTRIBE_SHA256 } from "../core/firmwareBau";
import { addressForSlot } from "../core/hacktribeRam";
import { IFX_ZAEHLER, leseZaehlerStand, type ZaehlerWert } from "../core/ifxErweiterung";
import { legeAb } from "./ablage";

let hooks: FxPresetHooks | null = null;
let basis: ManagerZustand | null = null;
let zustand: ManagerZustand | null = null;
let quelle = "";
/** Wurde ein echter Stand (Geraet, Sicherung, Firmware) geladen? Ohne den gibt es kein fluechtiges Schreiben. */
let geladen = false;

/** Die Bibliothek: Presets und Grooves aus Dateien und aus dem Editor, zum Ziehen auf die Plaetze. */
export interface BibEintrag {
  art: ManagerArt;
  name: string;
  bytes: Uint8Array;
  woher: string;
}
let bibliothek: BibEintrag[] = [];

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
    const zeilen = zustand[art].map((bytes, i) => {
      const platz = i + 1;
      const leer = istLeer(bytes, art);
      const geaendert = !gleich(bytes, basis![art][i]);
      const rohName = leer ? "" : nameVon(bytes, art);
      const rohAlgo = leer ? "" : algorithmusVon(bytes, art);
      if (suche && !`${rohName} ${rohAlgo}`.toLowerCase().includes(suche)) return "";
      treffer++;
      const name = leer ? `<span style="color:var(--muted)">— leer —</span>` : escapeHtml(rohName);
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

function renderBibliothek(): void {
  const liste = document.getElementById("pmBibListe");
  const info = document.getElementById("pmBibInfo");
  const filter = (document.getElementById("pmBibFilter") as HTMLSelectElement | null)?.value || "alle";
  const sichtbar = bibliothek.map((e, index) => ({ e, index })).filter(({ e }) => filter === "alle" || e.art === filter);
  if (info) info.textContent = bibliothek.length ? `${bibliothek.length} Eintrag/Einträge${filter === "alle" ? "" : `, ${sichtbar.length} gezeigt`}` : "leer";
  if (!liste) return;
  liste.innerHTML = sichtbar.length
    ? `<div class="startListe" style="max-height:420px;overflow:auto">${sichtbar
        .map(
          ({ e, index }) =>
            `<div class="pmBib" draggable="true" data-index="${index}" title="${escapeHtml(e.woher)} — ziehen und auf einen ${ARTEN_LABEL[e.art]}-Platz fallen lassen" style="cursor:grab">` +
            `<span class="rolle" style="min-width:30px">${ARTEN_LABEL[e.art] === "GROOVE" ? "GV" : ARTEN_LABEL[e.art]}</span>` +
            `<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(e.name)}">${escapeHtml(e.name)}</span>` +
            `<span class="sub" style="margin:0;flex:0 0 80px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(algorithmusVon(e.bytes, e.art))}</span>` +
            `<button class="ghost pmBibZu" data-index="${index}" title="ohne Ziehen: auf einen Platz legen (fragt nach dem Platz)" style="padding:1px 6px;font-size:11px">→</button>` +
            `<button class="ghost pmBibWeg" data-index="${index}" title="aus der Bibliothek entfernen" style="padding:1px 6px;font-size:11px">✕</button></div>`,
        )
        .join("")}</div>`
    : `<p class="sub" style="margin:0">Noch leer — Presets, Grooves oder Sammlungen laden, oder aus dem Editor übernehmen.</p>`;
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
    b.addEventListener("click", () => {
      bibliothek.splice(Number(b.dataset.index), 1);
      renderBibliothek();
    });
  }
}

/** Art einer Einzeldatei an der Endung: .mfx Master, .e2gv Groove, sonst Insert. */
const artAusDateiname = (name: string): ManagerArt => (/\.mfx$/i.test(name) ? "mfx" : /\.e2gv$/i.test(name) ? "groove" : "ifx");

/** Dateien in die Bibliothek: Einzelpresets nach Endung, Sammlungen mit ihrer Art. */
async function bibLaden(dateien: readonly File[]): Promise<void> {
  let n = 0;
  for (const f of dateien) {
    try {
      if (/\.(tfsam|json)$/i.test(f.name)) {
        const s = leseSammlung(await f.text());
        for (const e of s.eintraege) {
          bibliothek.push({ art: e.art, name: e.name, bytes: e.bytes, woher: `${s.titel} (${f.name})` });
          n++;
        }
      } else {
        const bytes = new Uint8Array(await f.arrayBuffer());
        const art = artAusDateiname(f.name);
        if (bytes.length !== blockGroesse(art)) throw new Error(`${f.name}: ${bytes.length} Bytes — ein ${ARTEN_LABEL[art]}-Block hat ${blockGroesse(art)}`);
        bibliothek.push({ art, name: nameVon(bytes, art) || f.name, bytes, woher: f.name });
        n++;
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
      renderBibliothek();
      return;
    }
  }
  renderBibliothek();
  setStatus(`${n} Eintrag/Einträge in die Bibliothek geladen — jetzt auf einen Platz ziehen.`);
}

/** Fuer Tests und den „aus Editor"-Knopf: einen Eintrag direkt aufnehmen. */
export function bibAufnehmen(e: BibEintrag): void {
  bibliothek.push({ ...e, bytes: e.bytes.slice() });
  renderBibliothek();
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
    uebernehmen(zustandAusFirmware(new Uint8Array(await f.arrayBuffer())), `Firmware ${f.name}`);
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
  const r = baueFirmware(fw, diff);
  if (!r.ok) {
    setStatus(`Nicht gebaut: ${r.reason}`);
    return;
  }
  const neu = await sha256Hex(r.bytes);
  const ab = await legeAb("SYSTEM.VSB", r.bytes, FIRMWARE_ORDNER);
  const menue = r.bericht.zaehler.length ? `, IFX-Menü bis Platz ${r.bericht.ifxMaxNachher + 1}` : "";
  const grooves = r.bericht.grooveZaehler.length ? `, Grooves bis Platz ${r.bericht.grooveMaxNachher + 1}` : "";
  setStatus(
    `Firmware gebaut: ${diff.length} Platz/Plätze eingebrannt${menue}${grooves}` +
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
  $("pmBibFilter").addEventListener("change", renderBibliothek);
  $("pmSuche").addEventListener("input", render);
  $("pmBibLeeren").addEventListener("click", () => {
    bibliothek = [];
    renderBibliothek();
  });
  zustand = leererZustand();
  basis = leererZustand();
  geladen = false;
  bibliothek = [];
  render();
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
    bibliothek.push({ art: e.art, name: e.name, bytes: e.bytes.slice(), woher });
    inBibliothek++;
  }
  render();
  return { gesetzt, inBibliothek };
}

/** Wurde ein echter Stand geladen? Ohne den ist die leere Bank kein Wunsch, sondern nur die Vorschau. */
export function pmGeladen(): boolean {
  return geladen;
}

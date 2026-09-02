/**
 * presetManager.ts (GUI) — die ganze Effekt-Preset-Bank als Liste: laden
 * (Geraet, Sicherung, Firmware), umbauen (verschieben, tauschen, umbenennen,
 * loeschen, einfuegen, in den Editor), sichern, und dann entweder fluechtig
 * ins RAM oder dauerhaft in die Firmware.
 *
 * Der Zustand lebt in zwei Kopien: `basis` ist der geladene Stand, `zustand`
 * der umgebaute. Geschrieben werden nur die Unterschiede — fluechtig ueber
 * denselben Schreibweg wie die Sammlung (`verteileEintraege`), dauerhaft
 * ueber `baueFirmware` gegen die Firmware-Datei, die der Nutzer waehlt.
 *
 * Entwurf: docs/superpowers/specs/2026-09-02-preset-manager-design.md
 */
import { $, escapeHtml, frageText, frageAuswahl } from "./shared";
import type { FxPresetHooks } from "./fxPreset";
import { verteileEintraege, oeffneImEditor, aktuellesPreset } from "./fxPreset";
import {
  IFX_PLAETZE,
  MFX_PLAETZE,
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
  type ManagerArt,
  type ManagerZustand,
} from "../core/presetManager";
import { baueSammlung, leseSammlung, type SammlungsEintrag } from "../core/sammlung";
import { leseSicherung } from "../core/geraetSicherung";
import { baueFirmware, pruefeFirmware, HACKTRIBE_SHA256 } from "../core/firmwareBau";
import { E2_RAM_MAP, addressForSlot } from "../core/hacktribeRam";
import { IFX_ZAEHLER, leseZaehlerStand, type ZaehlerWert } from "../core/ifxErweiterung";
import { FX_PRESET_SIZE } from "../core/e2FxPreset";
import { legeAb } from "./ablage";

let hooks: FxPresetHooks | null = null;
let basis: ManagerZustand | null = null;
let zustand: ManagerZustand | null = null;
let quelle = "";
/** Wurde ein echter Stand (Geraet, Sicherung, Firmware) geladen? Ohne den gibt es kein fluechtiges Schreiben. */
let geladen = false;

/** Die Bibliothek: Presets aus Dateien und aus dem Editor, zum Ziehen auf die Plaetze. */
export interface BibEintrag {
  art: ManagerArt;
  name: string;
  bytes: Uint8Array;
  woher: string;
}
let bibliothek: BibEintrag[] = [];

/** Beide Listen zeigen immer alle Plaetze — auch bevor etwas geladen ist. */
function leererZustand(): ManagerZustand {
  return {
    ifx: Array.from({ length: IFX_PLAETZE }, () => leererBlock("ifx")),
    mfx: Array.from({ length: MFX_PLAETZE }, () => leererBlock("mfx")),
    ifxMaxIndex: -1,
  };
}

const FIRMWARE_ORDNER = "Firmware";

function setStatus(t: string): void {
  const el = document.getElementById("pmStatus");
  if (el) el.textContent = t;
}

const anzahl = (art: ManagerArt): number => (art === "ifx" ? IFX_PLAETZE : MFX_PLAETZE);
const gleich = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

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
  for (const art of ["ifx", "mfx"] as const) {
    const liste = document.getElementById(art === "ifx" ? "pmIfxListe" : "pmMfxListe");
    const kopf = document.getElementById(art === "ifx" ? "pmIfxInfo" : "pmMfxInfo");
    const belegt = hoechsterBelegter(zustand, art);
    const l = luecken(zustand, art);
    if (kopf) {
      kopf.textContent =
        `${belegt} von ${anzahl(art)} belegt` +
        (art === "ifx" && zustand.ifxMaxIndex >= 0 ? `, Menü laut Zähler bis ${zustand.ifxMaxIndex + 1}` : "") +
        (l.length ? ` — ⚠ leer dazwischen: ${l.join(", ")}` : "");
    }
    if (!liste) continue;
    const zeilen = zustand[art].map((bytes, i) => {
      const platz = i + 1;
      const leer = istLeer(bytes);
      const geaendert = !gleich(bytes, basis![art][i]);
      const name = leer ? `<span style="color:var(--muted)">— leer —</span>` : escapeHtml(nameVon(bytes));
      const algo = leer ? "" : escapeHtml(algorithmusVon(bytes, art));
      const k = (op: string, text: string, title: string) =>
        `<button class="ghost pmOp" data-art="${art}" data-platz="${platz}" data-op="${op}" title="${title}" style="padding:1px 6px;font-size:11px">${text}</button>`;
      return (
        `<div class="pmZeile" data-art="${art}" data-platz="${platz}" style="${geaendert ? "background:rgba(255,160,0,.12);" : ""}">` +
        `<span class="rolle" style="min-width:26px;text-align:right">${platz}</span>` +
        `<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(leer ? "" : nameVon(bytes))}">${name}</span>` +
        `<span class="sub" style="margin:0;flex:0 0 96px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${algo}">${algo}</span>` +
        k("auf", "▲", "einen Platz nach vorn (kleinere Nummer)") +
        k("ab", "▼", "einen Platz nach hinten (größere Nummer)") +
        k("tausch", "⇄", "mit einem anderen Platz tauschen") +
        k("name", "✏", "umbenennen (15 Zeichen)") +
        k("editor", "✎", "im Editor oben öffnen — Parameter und Zuordnungen ändern, dann „Aus Editor übernehmen“") +
        k("datei", "⬇", "als Datei sichern (.e2fxp / .mfx)") +
        k("weg", "✕", "löschen — die folgenden Plätze rücken auf, hinten wird ein Platz frei") +
        `</div>`
      );
    });
    liste.innerHTML = `<div class="startListe" style="max-height:420px;overflow:auto">${zeilen.join("")}</div>`;
    for (const b of liste.querySelectorAll<HTMLButtonElement>(".pmOp")) {
      b.addEventListener("click", () => void pmAktion(b.dataset.op ?? "", b.dataset.art as ManagerArt, Number(b.dataset.platz)));
    }
    // Ziel fuers Ziehen aus der Bibliothek: jede Zeile nimmt einen Bibliotheks-Eintrag an.
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
  const filter = (document.getElementById("pmBibFilter") as HTMLSelectElement | null)?.value ?? "alle";
  const sichtbar = bibliothek.map((e, index) => ({ e, index })).filter(({ e }) => filter === "alle" || e.art === filter);
  if (info) info.textContent = bibliothek.length ? `${bibliothek.length} Preset(s)${filter === "alle" ? "" : `, ${sichtbar.length} gezeigt`}` : "leer";
  if (!liste) return;
  liste.innerHTML = sichtbar.length
    ? `<div class="startListe" style="max-height:420px;overflow:auto">${sichtbar
        .map(
          ({ e, index }) =>
            `<div class="pmBib" draggable="true" data-index="${index}" title="${escapeHtml(e.woher)} — ziehen und auf einen ${e.art.toUpperCase()}-Platz fallen lassen" style="cursor:grab">` +
            `<span class="rolle" style="min-width:30px">${e.art.toUpperCase()}</span>` +
            `<span style="flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escapeHtml(e.name)}">${escapeHtml(e.name)}</span>` +
            `<span class="sub" style="margin:0;flex:0 0 80px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(algorithmusVon(e.bytes, e.art))}</span>` +
            `<button class="ghost pmBibZu" data-index="${index}" title="ohne Ziehen: auf einen Platz legen (fragt nach dem Platz)" style="padding:1px 6px;font-size:11px">→</button>` +
            `<button class="ghost pmBibWeg" data-index="${index}" title="aus der Bibliothek entfernen" style="padding:1px 6px;font-size:11px">✕</button></div>`,
        )
        .join("")}</div>`
    : `<p class="sub" style="margin:0">Noch leer — Presets oder Sammlungen laden, oder aus dem Editor übernehmen.</p>`;
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

/** Dateien in die Bibliothek: Einzelpresets nach Endung, Sammlungen mit ihrer Art. */
async function bibLaden(dateien: readonly File[]): Promise<void> {
  let n = 0;
  for (const f of dateien) {
    try {
      if (/\.(tfsam|json)$/i.test(f.name)) {
        const s = leseSammlung(await f.text());
        for (const e of s.eintraege) {
          if (e.art === "groove") continue;
          bibliothek.push({ art: e.art, name: e.name, bytes: e.bytes, woher: `${s.titel} (${f.name})` });
          n++;
        }
      } else {
        const bytes = new Uint8Array(await f.arrayBuffer());
        if (bytes.length !== FX_PRESET_SIZE) throw new Error(`${f.name}: ${bytes.length} Bytes — ein Preset hat ${FX_PRESET_SIZE}`);
        const art: ManagerArt = /\.mfx$/i.test(f.name) ? "mfx" : "ifx";
        bibliothek.push({ art, name: nameVon(bytes) || f.name, bytes, woher: f.name });
        n++;
      }
    } catch (e) {
      setStatus(e instanceof Error ? e.message : String(e));
      renderBibliothek();
      return;
    }
  }
  renderBibliothek();
  setStatus(`${n} Preset(s) in die Bibliothek geladen — jetzt auf einen Platz ziehen.`);
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
    setStatus(`„${e.name}“ ist ein ${e.art.toUpperCase()}-Preset — es gehört in die ${e.art.toUpperCase()}-Liste.`);
    return;
  }
  try {
    const belegt = platz >= 1 && platz <= anzahl(art) && !istLeer(zustand[art][platz - 1]);
    let wahl: AblegeModus | null = modus ?? (belegt ? null : "ersetzen");
    if (wahl === null) {
      const i = await frageAuswahl(
        `Platz ${platz} ist belegt („${nameVon(zustand[art][platz - 1])}“). Was soll mit „${e.name}“ passieren?`,
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
  const antwort = Number(await frageText(`„${e.name}“ (${e.art.toUpperCase()}) auf Platz (1..${anzahl(e.art)}):`, String(vorschlag)));
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
        if (platz < anzahl(art)) zustand = verschieben(zustand, art, platz, platz + 1);
        break;
      case "nach": {
        const ziel = Number(wert ?? (await frageText(`Platz ${platz} verschieben nach Platz (1..${anzahl(art)}):`, String(platz))));
        if (!Number.isFinite(ziel)) return;
        zustand = verschieben(zustand, art, platz, ziel);
        break;
      }
      case "tausch": {
        const ziel = Number(wert ?? (await frageText(`Platz ${platz} tauschen mit Platz (1..${anzahl(art)}):`, "")));
        if (!Number.isFinite(ziel) || ziel === platz) return;
        zustand = tauschen(zustand, art, platz, ziel);
        break;
      }
      case "name": {
        const alt = nameVon(zustand[art][platz - 1]);
        const neu = typeof wert === "string" ? wert : await frageText(`Neuer Name für Platz ${platz} (max 15):`, alt);
        if (neu === null || neu === undefined) return;
        zustand = umbenennen(zustand, art, platz, neu);
        break;
      }
      case "weg":
        zustand = loeschen(zustand, art, platz);
        break;
      case "editor":
        oeffneImEditor(art, zustand[art][platz - 1], `Manager, ${art.toUpperCase()}-Platz ${platz}`);
        setStatus(`${art.toUpperCase()}-Platz ${platz} im Editor. Nach dem Ändern „Aus Editor übernehmen…“ auf Platz ${platz}.`);
        return;
      case "datei": {
        const bytes = zustand[art][platz - 1];
        const name = (nameVon(bytes) || `${art}-${platz}`).replace(/[^A-Za-z0-9 _-]/g, "").trim() || `${art}-${platz}`;
        const endung = art === "mfx" ? "mfx" : "e2fxp";
        const a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([bytes.slice().buffer as ArrayBuffer], { type: "application/octet-stream" }));
        a.download = `${name}.${endung}`;
        a.click();
        URL.revokeObjectURL(a.href);
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
  zustand = { ifx: z.ifx.map((b) => b.slice()), mfx: z.mfx.map((b) => b.slice()), ifxMaxIndex: z.ifxMaxIndex };
  quelle = woher;
  geladen = true;
  render();
  setStatus(`${woher}: ${hoechsterBelegter(z, "ifx")} IFX und ${hoechsterBelegter(z, "mfx")} MFX belegt.`);
}

async function vomGeraetLesen(): Promise<void> {
  if (!hooks) return;
  const ifxMap = E2_RAM_MAP.find((e) => e.key === "ifxPreset")!;
  const mfxMap = E2_RAM_MAP.find((e) => e.key === "mfxPreset")!;
  const bank = async (map: typeof ifxMap, n: number, was: string): Promise<Uint8Array | null> => {
    const out = new Uint8Array(n * FX_PRESET_SIZE);
    for (let i = 0; i < n; i++) {
      setStatus(`Lese ${was} Platz ${i + 1}/${n} …`);
      const r = await hooks!.lesen(addressForSlot(map, i), FX_PRESET_SIZE);
      if (!r.ok) {
        setStatus(`Abbruch bei ${was} Platz ${i + 1}: ${r.reason}. Nichts geladen.`);
        return null;
      }
      out.set(r.bytes, i * FX_PRESET_SIZE);
    }
    return out;
  };
  const ifx = await bank(ifxMap, IFX_PLAETZE, "IFX");
  if (!ifx) return;
  const mfx = await bank(mfxMap, MFX_PLAETZE, "MFX");
  if (!mfx) return;
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
  uebernehmen(zustandAusBaenken(ifx, mfx, stand.ok ? stand.maxIndex : -1), "Vom Gerät gelesen");
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
  const i = zustand[art].findIndex((b) => istLeer(b));
  return i < 0 ? 0 : i + 1;
}

/** Eine Datei einfuegen: Einzelpreset auf den ersten leeren Platz, Sammlung an ihre Plaetze. */
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
        if (e.art === "groove") continue;
        const platz = e.platz ?? ersterLeerer(e.art);
        if (!platz) throw new Error(`${e.art.toUpperCase()} ist voll — „${e.name}“ hat keinen Platz`);
        zustand = ersetzen(zustand, e.art, platz, e.bytes);
        n++;
      }
      render();
      setStatus(`${n} aus „${s.titel}“ eingefügt.`);
      return;
    }
    const bytes = new Uint8Array(await f.arrayBuffer());
    if (bytes.length !== FX_PRESET_SIZE) throw new Error(`${bytes.length} Bytes — ein Preset hat ${FX_PRESET_SIZE}`);
    const art: ManagerArt = /\.mfx$/i.test(f.name) ? "mfx" : "ifx";
    const platz = ersterLeerer(art);
    if (!platz) throw new Error(`${art.toUpperCase()} ist voll — erst einen Platz löschen`);
    zustand = ersetzen(zustand, art, platz, bytes);
    render();
    setStatus(`„${nameVon(bytes)}“ auf ${art.toUpperCase()}-Platz ${platz} gelegt.`);
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
    setStatus("Im Editor steht kein Effekt-Preset.");
    return;
  }
  const vorschlag = ersterLeerer(p.art) || 1;
  const antwort = platzVorgabe ?? Number(await frageText(`„${nameVon(p.bytes)}“ (${p.art.toUpperCase()}) auf Platz (1..${anzahl(p.art)}):`, String(vorschlag)));
  if (!Number.isFinite(antwort)) return;
  try {
    zustand = ersetzen(zustand, p.art, antwort, p.bytes);
    render();
    setStatus(`„${nameVon(p.bytes)}“ auf ${p.art.toUpperCase()}-Platz ${antwort} gelegt.`);
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
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([baueSammlung(eintraege, { titel })], { type: "application/json" }));
  a.download = datei;
  a.click();
  URL.revokeObjectURL(a.href);
  setStatus(`${eintraege.length} Presets mit Platz als ${datei} gesichert.`);
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

/** Fluechtig: nur die Unterschiede ins RAM, danach die Zaehler bis zum hoechsten belegten IFX-Platz. */
async function fluechtigSchreiben(): Promise<void> {
  if (!geladen) {
    setStatus("Erst einen echten Stand laden (Gerät oder Sicherung) — sonst gibt es keinen Vorher-Stand, gegen den geschrieben wird.");
    return;
  }
  const diff = aenderungen();
  if (!diff || !zustand || !basis) return;
  const l = luecken(zustand, "ifx");
  const ok = await verteileEintraege(diff, l.length === 0, "Manager: ");
  const fxStatus = document.getElementById("fxpStatus")?.textContent ?? "";
  if (ok) {
    // Der geschriebene Stand ist jetzt die Basis — weitere Aenderungen zaehlen von hier.
    basis = { ifx: zustand.ifx.map((b) => b.slice()), mfx: zustand.mfx.map((b) => b.slice()), ifxMaxIndex: zustand.ifxMaxIndex };
    quelle = "Auf dem Gerät (flüchtig)";
    render();
  }
  setStatus(
    `${fxStatus}` +
      (l.length ? ` ⚠ IFX-Zähler nicht nachgezogen — leer dazwischen: Platz ${l.join(", ")}.` : "") +
      " Gilt bis zum Ausschalten; „Alle zurückschreiben“ im FX-Preset-Bereich nimmt es zurück.",
  );
}

async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) return null;
  const d = await subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(d))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}

/** Dauerhaft: die Unterschiede zur gewaehlten Firmware-Datei einbrennen. */
async function firmwarePatchen(f: File): Promise<void> {
  if (!zustand) {
    setStatus("Erst einen Stand laden.");
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
        "Für andere Basen: scripts/make-firmware.mjs --basis-egal.",
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
  setStatus(
    `Firmware gebaut: ${diff.length} Platz/Plätze eingebrannt${menue}` +
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
  $("pmSicherungLaden").addEventListener("click", () => ($("pmSicherungIn") as HTMLInputElement).click());
  $("pmSicherungIn").addEventListener("change", () => {
    const f = ($("pmSicherungIn") as HTMLInputElement).files?.[0];
    if (f) void ausSicherung(f);
  });
  $("pmFirmwareLaden").addEventListener("click", () => ($("pmFirmwareIn") as HTMLInputElement).click());
  $("pmFirmwareIn").addEventListener("change", () => {
    const f = ($("pmFirmwareIn") as HTMLInputElement).files?.[0];
    if (f) void ausFirmware(f);
  });
  $("pmDateiEinfuegen").addEventListener("click", () => ($("pmDateiIn") as HTMLInputElement).click());
  $("pmDateiIn").addEventListener("change", () => {
    const f = ($("pmDateiIn") as HTMLInputElement).files?.[0];
    if (f) void dateiEinfuegen(f);
  });
  $("pmAusEditor").addEventListener("click", () => void ausEditor());
  $("pmExport").addEventListener("click", () => void exportieren());
  $("pmSchreiben").addEventListener("click", () => void fluechtigSchreiben());
  $("pmPatchen").addEventListener("click", () => ($("pmBasisIn") as HTMLInputElement).click());
  $("pmBasisIn").addEventListener("change", () => {
    const f = ($("pmBasisIn") as HTMLInputElement).files?.[0];
    if (f) void firmwarePatchen(f);
  });
  $("pmVerwerfen").addEventListener("click", () => {
    if (basis && geladen) uebernehmen(basis, quelle);
    else {
      zustand = leererZustand();
      basis = leererZustand();
      render();
    }
  });
  $("pmBibLaden").addEventListener("click", () => ($("pmBibIn") as HTMLInputElement).click());
  $("pmBibIn").addEventListener("change", () => {
    const f = Array.from(($("pmBibIn") as HTMLInputElement).files ?? []);
    if (f.length) void bibLaden(f);
  });
  $("pmBibAusEditor").addEventListener("click", () => {
    const p = aktuellesPreset();
    if (!p) {
      setStatus("Im Editor steht kein Effekt-Preset.");
      return;
    }
    bibAufnehmen({ art: p.art, name: nameVon(p.bytes) || "Preset", bytes: p.bytes, woher: "Editor" });
    setStatus(`„${nameVon(p.bytes)}“ in die Bibliothek gelegt.`);
  });
  $("pmBibFilter").addEventListener("change", renderBibliothek);
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

/** Wurde ein echter Stand geladen? Ohne den ist die leere Bank kein Wunsch, sondern nur die Vorschau. */
export function pmGeladen(): boolean {
  return geladen;
}

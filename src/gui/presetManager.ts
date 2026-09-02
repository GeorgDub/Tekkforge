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
import { $, escapeHtml, frageText } from "./shared";
import type { FxPresetHooks } from "./fxPreset";
import { verteileEintraege, oeffneImEditor, aktuellesPreset } from "./fxPreset";
import {
  IFX_PLAETZE,
  MFX_PLAETZE,
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

const FIRMWARE_ORDNER = "Firmware";

function setStatus(t: string): void {
  const el = document.getElementById("pmStatus");
  if (el) el.textContent = t;
}

const anzahl = (art: ManagerArt): number => (art === "ifx" ? IFX_PLAETZE : MFX_PLAETZE);
const gleich = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

// ─── Anzeige ─────────────────────────────────────────────────────────────────

function render(): void {
  const info = document.getElementById("pmInfo");
  if (!zustand || !basis) {
    if (info) info.textContent = "nichts geladen";
    for (const art of ["ifx", "mfx"] as const) {
      const liste = document.getElementById(art === "ifx" ? "pmIfxListe" : "pmMfxListe");
      if (liste) liste.innerHTML = "";
    }
    return;
  }
  const diff = unterschiede(zustand, basis);
  if (info) info.textContent = `${quelle} — ${diff.length ? `${diff.length} Platz/Plätze geändert` : "unverändert"}`;
  for (const art of ["ifx", "mfx"] as const) {
    const liste = document.getElementById(art === "ifx" ? "pmIfxListe" : "pmMfxListe");
    const kopf = document.getElementById(art === "ifx" ? "pmIfxInfo" : "pmMfxInfo");
    const belegt = hoechsterBelegter(zustand, art);
    const l = luecken(zustand, art);
    if (kopf) {
      kopf.textContent =
        `belegt bis Platz ${belegt}` +
        (art === "ifx" && zustand.ifxMaxIndex >= 0 ? `, Menü laut Zähler bis ${zustand.ifxMaxIndex + 1}` : "") +
        (l.length ? ` — ⚠ leer dazwischen: ${l.join(", ")}` : "");
    }
    if (!liste) continue;
    const zeilen = zustand[art].map((bytes, i) => {
      const platz = i + 1;
      const leer = istLeer(bytes);
      const geaendert = !gleich(bytes, basis![art][i]);
      const name = leer ? "<i style=\"opacity:.5\">leer</i>" : escapeHtml(nameVon(bytes));
      const algo = leer ? "" : escapeHtml(algorithmusVon(bytes, art));
      const k = (op: string, text: string, title: string) =>
        `<button class="ghost pmOp" data-art="${art}" data-platz="${platz}" data-op="${op}" title="${title}" style="padding:1px 6px;font-size:11px">${text}</button>`;
      return (
        `<div style="${geaendert ? "background:rgba(255,160,0,.12);" : ""}${leer ? "opacity:.75;" : ""}">` +
        `<span class="rolle" style="min-width:28px;text-align:right">${platz}</span>` +
        `<span style="flex:1">${name}</span><span class="sub" style="margin:0;min-width:120px">${algo}</span>` +
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
  }
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
    if (basis) uebernehmen(basis, quelle);
  });
  render();
}

/** Fuer Tests: der aktuelle Zustand. */
export function pmZustand(): ManagerZustand | null {
  return zustand;
}

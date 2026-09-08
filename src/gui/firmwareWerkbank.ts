/**
 * firmwareWerkbank.ts (GUI) — Presets, Grooves, Init-Pattern und Startbild
 * in die Hacktribe-Firmware einbrennen, Baustein fuer Baustein.
 *
 * Basis ist eine SYSTEM.VSB (Hacktribe oder eine fruehere TekkForge-Fassung;
 * `pruefeBasis` verlangt Header, stimmige Zaehler und ein Init-Pattern).
 * Darauf legen sich, je nach Haken: die Unterschiede des Preset-Managers
 * zur Datei, Groove-Vorlagen aus einer Sammlung, das aktuelle Pattern des
 * Editors (oder eine Datei) als Init-Pattern, und das Bild aus dem
 * Pixel-Editor als Startbildschirm. Das Ergebnis geht als SYSTEM.VSB in den
 * Ordner Firmware/.
 *
 * Der Pixel-Editor ist ein Canvas, 4-fach vergroessert: linke Maustaste malt,
 * rechte radiert, ein Bild laesst sich einpassen (Schwelle, Invertieren), und
 * das Bild aus der Basis laesst sich als Ausgang holen.
 */
import { $, escapeHtml, frageText, download, sha256Hex, dateiKnopf, dateiKnopfMehrere } from "./shared";
import { pmZustand, pmGeladen, pmEintraegeUebernehmen } from "./presetManager";
import { baueBauplan, leseBauplan } from "../core/bauplan";

export interface WerkbankHooks {
  /** Das aktuelle Pattern des Editors als .e2spat — kommt von editor.ts, damit hier kein Import-Kreis entsteht. */
  aktuellesPattern(): { name: string; bytes: Uint8Array };
  /** RAM lesen (fuer den Init-Global-Block vom Geraet); fehlt ohne MIDI. */
  lesen?(addr: number, len: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }>;
  /** RAM schreiben mit Rueckleseprobe (fuer die fluechtige Oszillator-Probe); fehlt ohne MIDI. */
  schreiben?(addr: number, bytes: Uint8Array, was: string): Promise<boolean>;
}
let hooks: WerkbankHooks | null = null;
/** Eigene DSP-Patches aus Dateien oder Bauplaenen; das Register kommt dazu. */
let dspEigene: DspPatch[] = [];
const dspGewaehlt = new Set<string>();
/** Neue Oszillator-Eintraege (Varianten), fortlaufend hinter dem Stand der Basis. */
let oszNeu: OszEintragMitPlatz[] = [];
let oszBasisAnzahl = 0;
/** Neue Modulationstypen hinter der Tabelle der Basis (Platz 0-basiert). */
let modNeu: ModEintragMitPlatz[] = [];
let modBasisAnzahl = 0;
const aktuellesPatternDatei = (): { name: string; bytes: Uint8Array } => {
  if (!hooks) throw new Error("kein Editor angebunden");
  return hooks.aktuellesPattern();
};
import {
  pruefeBasis,
  baueFirmware,
  setzeInitPattern,
  setzeSplash,
  liesSplash,
  liesInitPattern,
  liesInitGlobal,
  setzeInitGlobal,
  patternAlsDatei,
  INIT_GLOBAL_GROESSE,
  firmwareAusSicherung,
  HACKTRIBE_SHA256,
  E2SPAT_GROESSE,
  type BasisBefund,
} from "../core/firmwareBau";
import { erkenneKarte, karteLabel, KARTEN, KARTE_HACKTRIBE, dateiOffset, SAMPLER_STOCK_SHA256, SYNTH_STOCK_SHA256, type FirmwareKarte, type KartenId } from "../core/firmwareKarte";
import { ordneDateiEin, ablageStand, basisMoeglich, BASIS_WAHL_LABEL, type AblageStand, type BasisWahl } from "../core/firmwareAblage";
import { hacktribeAusStock, HACKTRIBE_PATCH_SHA256 } from "../core/bspatch";
import { analysiereFirmware, uebernehmeErweiterungen, type FirmwareAnalyse, type Erweiterung } from "../core/firmwareAnalyse";
import { freigabe, LAUFENDE_FIRMWARE, type LaufendeFirmware, type Freigabe } from "../core/firmwareFreigabe";
import { firmwareAblageZugang, sitzungsAblageAufnehmen, type AblageEintrag } from "./tekkFirmware";
import { E2_GLOBAL_CHAIN_MODE_OFF, E2_GLOBAL_CLOCK_SOURCE_OFF } from "../core/e2sysex";
import { zustandAusFirmware, unterschiede, hoechsterBelegter } from "../core/presetManager";
import { leseSammlung, type SammlungsEintrag } from "../core/sammlung";
import { leseSicherung } from "../core/geraetSicherung";
import { vergleicheFirmware } from "../core/firmwareVergleich";
import { schreibeText, textBreite } from "../core/pixelSchrift";
import { DSP_PATCH_REGISTER } from "../core/dspPatchRegister";
import { wendeDspPatchAn, dspPatchStand, leseDspPatchDatei, type DspPatch } from "../core/dspPatch";
import {
  OSZ_TABELLE_ADDR,
  OSZ_LAUFZEIT_ADDR,
  OSZ_GRENZE_STELLEN,
  cmpR0Immediate,
  oszGrenzeSchreibliste,
  OSZ_EINTRAG,
  OSZ_MAX,
  OSZ_ZAEHLER,
  OSZ_ZEIGER_ADDRS,
  KATEGORIE_NAMEN,
  decodeOsz,
  oszVariante,
  liesOsz,
  istOszLeer,
  leseOszStandAusFirmware,
  leseOszStand,
  oszZaehlerSchreibliste,
  setzeOszTabelle,
  fmHalbtonZuParameter,
  fmParameterZuHalbton,
  fmHalbtonGemessen,
  fmSerieFehlend,
  FM_HALBTON_MAX,
  type OszEintragMitPlatz,
} from "../core/oszTabelle";

/** Text ins Startbild schreiben — fuer Tests direkt aufrufbar. */
export function fwTextSchreiben(text: string, skala: number, zeile: number | "mitte"): void {
  if (!text.trim()) {
    setStatus("Erst einen Text eingeben.");
    return;
  }
  schreibeText(pixel, text, "mitte", zeile, skala);
  zeichne();
  const breite = textBreite(text, skala);
  setStatus(`„${text}“ geschrieben (${breite} Pixel breit${breite > SPLASH_BREITE ? " — ragt über den Rand, kleinere Punktgröße wählen" : ""}).`);
}
import {
  SPLASH_BREITE,
  SPLASH_HOEHE,
  splashZuPixel,
  pixelZuSplash,
  bildZuHelligkeit,
  helligkeitZuPixel,
  pixelZuPbm,
  pbmZuPixel,
} from "../core/splash";
import { legeAb } from "./ablage";
import { analysiere, crossgrade, VARIANTEN, BEKANNTE_HASHES, type Variante } from "../core/crossgrade";
import { liesModTabelle, modKombinationen, modName, decodeMod, setzeModTabelle, istModLeer, MOD_TABELLE_ADDR_HACKTRIBE, MOD_EINTRAG, MOD_MAX, MOD_WELLEN, MOD_ZIEL_NAMEN, type ModEintragMitPlatz, modGrenzeSchreibliste, armImmediateWert, MOD_GRENZE_VERGLEICHE, MOD_FELD_ZEIGER, MOD_FELD_BASIS_STOCK, MOD_FELD_BASIS_NEU } from "../core/modTabelle";

const FIRMWARE_ORDNER = "Firmware";
const SKALA = 4;

let basis: Uint8Array | null = null;
let basisName = "";
let basisBefund: BasisBefund | null = null;
let basisHash: string | null = null;
/** Die Karte der Basis — Hacktribe, Sampler-Stock oder Synth-Stock (firmwareKarte.ts). */
let karte: FirmwareKarte = KARTE_HACKTRIBE;
/** Die Firmware-Ablage (userData/firmware bzw. Sitzung) und ihr eingeordneter Stand. */
let ablageDateien: AblageEintrag[] = [];
let ablage: AblageStand | null = null;
/** Die zuletzt analysierte Firmware und die Auswahl ihrer Erweiterungen. */
let analyse: FirmwareAnalyse | null = null;
let analyseName = "";
const analyseAuswahl = new Set<string>();
let grooves: SammlungsEintrag[] = [];
let initDatei: { name: string; bytes: Uint8Array } | null = null;
/** Der Init-Global-Block (256 B) — vom Geraet gelesen oder aus einer Datei. */
let globalBlock: { name: string; bytes: Uint8Array } | null = null;
/** Das Startbild, wie es gemalt ist: 128 × 64, 1 = dunkel. */
let pixel: Uint8Array = new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE);
/** Das zuletzt geladene Bild, schon auf 128 × 64 Helligkeiten reduziert — die Schwelle wirkt darauf, nicht auf das Gemalte. */
let bildHell: Float32Array | null = null;
let invertiert = false;

function setStatus(t: string): void {
  const el = document.getElementById("fwStatus");
  if (el) el.textContent = t;
}

// ─── Pixel-Editor ────────────────────────────────────────────────────────────

function zeichne(): void {
  const canvas = document.getElementById("fwSplashCanvas") as HTMLCanvasElement | null;
  const ctx = canvas && typeof canvas.getContext === "function" ? canvas.getContext("2d") : null;
  if (!ctx) return;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, SPLASH_BREITE * SKALA, SPLASH_HOEHE * SKALA);
  ctx.fillStyle = "#111111";
  for (let y = 0; y < SPLASH_HOEHE; y++) {
    for (let x = 0; x < SPLASH_BREITE; x++) {
      if (pixel[y * SPLASH_BREITE + x]) ctx.fillRect(x * SKALA, y * SKALA, SKALA, SKALA);
    }
  }
}

/** Fuer Tests und den Bild-Weg: das Bild setzen. */
export function fwSetzePixel(px: Uint8Array): void {
  if (px.length !== SPLASH_BREITE * SPLASH_HOEHE) throw new Error("falsche Pixelzahl");
  pixel = px.slice();
  zeichne();
}

export function fwPixel(): Uint8Array {
  return pixel.slice();
}

function malen(canvas: HTMLCanvasElement, e: PointerEvent, wert: 0 | 1): void {
  const rect = canvas.getBoundingClientRect();
  const x = Math.floor(((e.clientX - rect.left) / rect.width) * SPLASH_BREITE);
  const y = Math.floor(((e.clientY - rect.top) / rect.height) * SPLASH_HOEHE);
  if (x < 0 || y < 0 || x >= SPLASH_BREITE || y >= SPLASH_HOEHE) return;
  pixel[y * SPLASH_BREITE + x] = wert;
  zeichne();
}

function bildAnwenden(): void {
  if (!bildHell) return;
  const schwelle = Number(($("fwSplashSchwelle") as HTMLInputElement).value) || 128;
  // Nur noch 8192 Vergleiche je Reglerzug — das Quellbild wurde beim Laden einmal reduziert.
  pixel = helligkeitZuPixel(bildHell, schwelle, invertiert);
  zeichne();
}

async function bildLaden(f: File): Promise<void> {
  try {
    if (/\.pbm$/i.test(f.name)) {
      fwSetzePixel(pbmZuPixel(new Uint8Array(await f.arrayBuffer())));
      bildHell = null;
      setStatus(`${f.name} als Startbild geladen.`);
      return;
    }
    if (typeof createImageBitmap !== "function") throw new Error("Bilder brauchen einen Browser mit createImageBitmap");
    const bmp = await createImageBitmap(f);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("kein Canvas");
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height);
    bildHell = bildZuHelligkeit(d.data, bmp.width, bmp.height);
    bildAnwenden();
    setStatus(`${f.name} (${bmp.width} × ${bmp.height}) eingepasst — Schwelle und Invertieren wirken weiter darauf; Malen geht darüber.`);
  } catch (e) {
    setStatus(`Bild nicht geladen: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── Basis ───────────────────────────────────────────────────────────────────

/**
 * Laufende Nummer des letzten Ladevorgangs: wer zweimal schnell hintereinander
 * eine Basis waehlt, bekommt nur das Ergebnis des letzten Vorgangs — ein
 * aelterer, noch am Hashen, darf Anzeige, Status und die Oszillator-
 * Vormerkliste nicht mehr ueberschreiben.
 */
let basisLauf = 0;

async function basisLaden(f: File): Promise<void> {
  await basisSetzen(new Uint8Array(await f.arrayBuffer()), f.name);
}

/**
 * Ein Abbild als Basis uebernehmen — Karte erkennen (Hacktribe, Sampler-
 * Stock, Synth-Stock; auch umgekoepft), pruefen, Bausteine passend
 * freischalten. Fuer Tests direkt aufrufbar.
 */
export async function basisSetzen(bytes: Uint8Array, name: string): Promise<boolean> {
  const lauf = ++basisLauf;
  const erk = erkenneKarte(bytes);
  const k = erk.ok ? erk.karte : KARTE_HACKTRIBE;
  const befund = pruefeBasis(bytes, k);
  if (!erk.ok || !befund.ok) {
    basis = null;
    basisBefund = null;
    karte = KARTE_HACKTRIBE;
    bausteineFreischalten();
    const grund = erk.ok ? befund.reason : erk.reason;
    ($("fwBasisInfo") as HTMLElement).textContent = `${name}: abgelehnt — ${grund}`;
    setStatus(`Basis abgelehnt: ${grund}`);
    return false;
  }
  basis = bytes;
  basisName = name;
  basisBefund = befund;
  karte = k;
  const hash = await sha256Hex(bytes);
  if (lauf !== basisLauf) return false;
  basisHash = hash;
  const herkunft =
    basisHash === HACKTRIBE_SHA256
      ? "unveränderte Hacktribe-Firmware"
      : basisHash === SAMPLER_STOCK_SHA256 || basisHash === SYNTH_STOCK_SHA256
        ? "unveränderte Korg-Firmware v2.02"
        : k.id === "hacktribe"
          ? "Hacktribe-Bauart, nicht die Hacktribe-Datei (schon gepatcht?)"
          : "Stock-Bauart mit fremdem Hash (verändert?)";
  ($("fwBasisInfo") as HTMLElement).textContent =
    `${name} — ${karteLabel(erk)}, ${herkunft}; IFX-Menü bis ${befund.ifxMaxIndex + 1}${k.grooveBank ? `, Grooves bis ${befund.grooveMaxIndex + 1}` : ", keine Groove-Bank"}, Init-Pattern „${befund.initPatternName || "?"}“`;
  setStatus(k.id === "hacktribe" ? `Basis geladen. Startbild mit „aus Firmware“ holen, Bausteine anhaken, bauen.` : `Basis geladen (${k.label}): Presets ersetzen, Init-Pattern und Init-Global${k.splash !== undefined ? " und Startbild" : ""} gehen; Grooves, Oszillator- und Modulations-Anhang nur mit Hacktribe.`);
  const osz = k.oszTabelle?.erweiterbar ? leseOszStandAusFirmware(bytes) : { ok: false as const, reason: `${k.label}: Tabelle nicht erweiterbar` };
  oszBasisAnzahl = osz.ok ? osz.anzahl : 0;
  oszNeu = [];
  oszListe();
  oszVorlagenFuellen();
  modNeu = [];
  modBasisAnzahl = k.modTabelle?.erweiterbar ? liesModTabelle(basis).length : 0;
  modListe();
  const modInfo = document.getElementById("fwModInfo");
  if (modInfo) modInfo.textContent = basis ? (modBasisAnzahl ? `${modBasisAnzahl} in der Basis` : k.modTabelle?.erweiterbar ? "keine Tabelle bei 0xC01A0000 — Stock-Firmware?" : `${k.label}: nur mit Hacktribe`) : "";
  oszVorlageHinweis();
  if (!osz.ok) ($("fwOszInfo") as HTMLElement).textContent = k.oszTabelle?.erweiterbar ? `Tabelle nicht lesbar: ${osz.reason}` : `${k.label}: nur mit Hacktribe`;
  dspListe();
  bausteineFreischalten();
  zielVorbelegen();
  analyseAnzeigen(); // Uebertragbarkeit gilt je Zielkarte — neu zeichnen
  vorschau();
  return true;
}

/** Bausteine, die die Karte nicht hat, abhaken und ausgrauen. */
function bausteineFreischalten(): void {
  const setze = (id: string, an: boolean, grund: string) => {
    const el = document.getElementById(id) as (HTMLInputElement & { disabled?: boolean; title?: string }) | null;
    if (!el) return;
    el.disabled = !an;
    if (!an) {
      el.checked = false;
      el.title = grund;
    }
  };
  const k = karte;
  setze("fwGrooves", !!k.grooveBank, `${k.label} hat keine Groove-Bank`);
  setze("fwSplash", k.splash !== undefined, `${k.label}: Lage des Startbilds unbekannt`);
  setze("fwOsz", !!k.oszTabelle?.erweiterbar, `${k.label}: Oszillator-Tabelle nicht erweiterbar`);
  setze("fwMod", !!k.modTabelle?.erweiterbar, `${k.label}: Modulations-Tabelle nicht erweiterbar`);
  const info = document.getElementById("fwKarteInfo");
  if (info) {
    info.textContent = basis
      ? `${k.label}: ${k.ifxErweiterbar ? `IFX bis Platz ${k.ifxSchreibMax + 1} (Menü wächst mit)` : `${k.ifxSchreibMax + 1} feste IFX-Plätze (ersetzen)`}, ${k.mfxSchreibMax + 1} MFX${k.grooveBank ? `, ${k.grooveBank.count} Grooves` : ", keine Grooves"}${k.splash !== undefined ? ", Startbild" : ", kein Startbild"}${k.oszTabelle?.erweiterbar ? ", Osz-Anhang" : ""}${k.modTabelle?.erweiterbar ? ", Mod-Anhang" : ""}${k.ldrStart !== undefined ? ", DSP-Kette" : ""}`
      : "";
  }
}

async function groovesLaden(f: File): Promise<void> {
  try {
    const s = leseSammlung(await f.text());
    grooves = s.eintraege.filter((e) => e.art === "groove" && e.platz !== undefined);
    const ohne = s.eintraege.filter((e) => e.art === "groove" && e.platz === undefined).length;
    ($("fwGroovesInfo") as HTMLElement).textContent = `${grooves.length} mit Platz${ohne ? `, ${ohne} ohne Platz übergangen` : ""} (${f.name})`;
    ($("fwGrooves") as HTMLInputElement).checked = grooves.length > 0;
    vorschau();
  } catch (e) {
    setStatus(`Sammlung nicht lesbar: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function initLaden(f: File): Promise<void> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  if (bytes.length !== E2SPAT_GROESSE) {
    setStatus(`${f.name}: ${bytes.length} Bytes — eine ${karte.patternEndung} hat ${E2SPAT_GROESSE}.`);
    return;
  }
  initDatei = { name: f.name, bytes };
  ($("fwInitQuelle") as HTMLSelectElement).value = "datei";
  ($("fwInit") as HTMLInputElement).checked = true;
  ($("fwInitInfo") as HTMLElement).textContent = f.name;
  vorschau();
}

function globalUebernehmen(bytes: Uint8Array, name: string): void {
  if (bytes.length !== INIT_GLOBAL_GROESSE || String.fromCharCode(...bytes.subarray(0, 4)) !== "GLST") {
    setStatus(`${name}: kein Global-Block (${bytes.length} Bytes, erwartet ${INIT_GLOBAL_GROESSE} mit „GLST“).`);
    return;
  }
  globalBlock = { name, bytes: bytes.slice() };
  ($("fwGlobal") as HTMLInputElement).checked = true;
  ($("fwGlobalInfo") as HTMLElement).textContent = `${name} (Chain ${bytes[E2_GLOBAL_CHAIN_MODE_OFF]}, Clock ${bytes[E2_GLOBAL_CLOCK_SOURCE_OFF]})`;
  vorschau();
}

async function globalAusDatei(f: File): Promise<void> {
  globalUebernehmen(new Uint8Array(await f.arrayBuffer()), f.name);
}

/** Den Global-Block aus dem Geraete-RAM holen — dieselbe Stelle, die im Abbild der Werksstand ist. */
async function globalVomGeraet(): Promise<void> {
  if (!hooks?.lesen) {
    setStatus("Ohne MIDI-Verbindung nicht möglich.");
    return;
  }
  setStatus("Lese Global-Block aus dem Gerät …");
  const r = await hooks.lesen(karte.initGlobal, INIT_GLOBAL_GROESSE);
  if (!r.ok) {
    setStatus(`Global-Block nicht lesbar: ${r.reason}`);
    return;
  }
  globalUebernehmen(r.bytes, "Gerät (RAM)");
  setStatus("Global-Block vom Gerät übernommen — ob er den Werksstand oder den laufenden Stand zeigt, ist am Gerät noch offen.");
}

// ─── DSP-Patches ─────────────────────────────────────────────────────────────

const DSP_STATUS_TEXT: Record<DspPatch["status"], string> = {
  "hoerprobe-offen": "Hörprobe offen",
  "am-geraet-gehoert": "am Gerät gehört",
  diskriminator: "nur Nachweis, kein Klang",
};

/** Register plus eigene Patches; ein eigener mit gleicher id verdraengt den Register-Eintrag. */
export function fwDspPatches(): DspPatch[] {
  return [...DSP_PATCH_REGISTER.filter((r) => !dspEigene.some((e) => e.id === r.id)), ...dspEigene];
}

/** Einen Patch an- oder abwaehlen — fuer Tests direkt aufrufbar. */
export function fwDspWaehlen(id: string, an: boolean): void {
  if (an) dspGewaehlt.add(id);
  else dspGewaehlt.delete(id);
  vorschau();
}

/** Einen eigenen Patch aufnehmen (ersetzt einen gleichnamigen) und anhaken. */
export function fwDspAufnehmen(p: DspPatch): void {
  dspEigene = [...dspEigene.filter((e) => e.id !== p.id), p];
  dspGewaehlt.add(p.id);
  dspListe();
  vorschau();
}

function dspListe(): void {
  const el = document.getElementById("fwDspListe");
  if (!el) return;
  const stand = (p: DspPatch): string => {
    if (!basis) return "";
    if (karte.familie !== "sampler") return " · <b>nur Sampler-Bauart</b>";
    const s = dspPatchStand(basis, p);
    return s === "original" ? "" : s === "gepatcht" ? " · <b>in der Basis schon drin</b>" : " · <b>passt nicht zur Basis</b>";
  };
  el.innerHTML = fwDspPatches()
    .map(
      (p) =>
        `<label class="sub" style="margin:2px 0;display:flex;align-items:flex-start;gap:4px" title="${escapeHtml(p.beschreibung)}&#10;Quelle: ${escapeHtml(p.quelle)}"><input type="checkbox" data-dsp="${escapeHtml(p.id)}"${dspGewaehlt.has(p.id) ? " checked" : ""} /><span>${escapeHtml(p.titel)} <span style="opacity:.7">— ${p.edits.reduce((a, e) => a + e.alt.length, 0)} Bytes, ${DSP_STATUS_TEXT[p.status]}${stand(p)}</span></span></label>`,
    )
    .join("");
}

async function dspLaden(f: File): Promise<void> {
  try {
    const p = leseDspPatchDatei(await f.text(), f.name.replace(/\.json$/i, ""));
    fwDspAufnehmen(p);
    setStatus(`DSP-Patch „${p.titel}“ aufgenommen und angehakt (${p.edits.length} Änderung(en)) — ⚠ experimentell, erst am Gerät hören.`);
  } catch (e) {
    setStatus(`Patch-Datei nicht lesbar: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── Oszillator-Tabelle ──────────────────────────────────────────────────────

const oszNaechsterPlatz = (): number => oszBasisAnzahl + oszNeu.length + 1;
/** Bis zu welchem Platz der letzte fluechtige Lauf die Beschreiber am Geraet gesetzt hat (0 = keiner). */
let oszFluechtigBis = 0;

function oszVorlagenFuellen(): void {
  const sel = document.getElementById("fwOszVorlage") as HTMLSelectElement | null;
  if (!sel) return;
  const opts: string[] = [];
  if (basis) {
    for (let p = 1; p <= oszBasisAnzahl; p++) {
      const b = liesOsz(basis, p);
      if (istOszLeer(b)) continue;
      const d = decodeOsz(b);
      opts.push(`<option value="${p}">${p}: ${escapeHtml(d.name)} (${KATEGORIE_NAMEN[d.kategorie] ?? `Kat. ${d.kategorie}`})</option>`);
    }
  }
  sel.innerHTML = opts.join("");
  const info = document.getElementById("fwOszInfo");
  if (info && (basis === null || karte.oszTabelle?.erweiterbar)) info.textContent = basis ? `${oszBasisAnzahl} belegt, ${OSZ_MAX - oszBasisAnzahl} frei (${oszBasisAnzahl + 1}…${OSZ_MAX})` : "";
}

function oszListe(): void {
  const el = document.getElementById("fwOszListe");
  if (!el) return;
  el.innerHTML = oszNeu
    .map((o, i) => {
      const d = decodeOsz(o.bytes);
      const h = fmParameterZuHalbton(d.parameter);
      const p = d.kategorie === 0x0a ? `${h} Halbtöne (${d.parameter}${fmHalbtonGemessen(h) && fmHalbtonZuParameter(h) === d.parameter ? "" : ", geschätzt"})` : `Parameter ${d.parameter}`;
      return `<div class="sub" style="margin:1px 0;display:flex;gap:6px;align-items:center"><span style="min-width:34px">${o.platz}</span><b>${escapeHtml(d.name)}</b><span style="opacity:.7">${KATEGORIE_NAMEN[d.kategorie] ?? `Kat. ${d.kategorie}`} · Programm ${d.programm} · ${p} · Pegel ${d.pegel}</span><button class="ghost" data-osz-weg="${i}" style="padding:0 6px;font-size:11px" title="Eintrag entfernen">✕</button></div>`;
    })
    .join("");
}

/** Eine Variante der Vorlage (Platz in der Basis) anhaengen — fuer Tests direkt aufrufbar. */
export function fwOszAnhaengen(vorlagePlatz: number, name: string, parameter?: number, pegel?: number): { ok: true; platz: number } | { ok: false; reason: string } {
  if (!basis) return { ok: false, reason: "Erst eine Basis laden." };
  if (!karte.oszTabelle?.erweiterbar) return { ok: false, reason: `${karte.label}: Oszillator-Varianten lassen sich nur an die Hacktribe-Firmware anhängen.` };
  if (vorlagePlatz < 1 || vorlagePlatz > oszBasisAnzahl) return { ok: false, reason: `Vorlage ${vorlagePlatz}: die Basis hat Plätze 1…${oszBasisAnzahl}` };
  if (!name.trim()) return { ok: false, reason: "Ein Name fehlt." };
  const platz = oszNaechsterPlatz();
  if (platz > OSZ_MAX) return { ok: false, reason: `Die Tabelle ist voll (${OSZ_MAX} Plätze).` };
  let bytes: Uint8Array;
  try {
    bytes = oszVariante(liesOsz(basis, vorlagePlatz), { name: name.trim(), ...(parameter !== undefined ? { parameter } : {}), ...(pegel !== undefined ? { pegel } : {}) });
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  oszNeu.push({ platz, bytes });
  oszListe();
  ($("fwOsz") as HTMLInputElement).checked = true;
  vorschau();
  return { ok: true, platz };
}

/**
 * FM-Serie: alle Halbtoene −24…+24, die es fuer das DSP-Programm der Vorlage
 * noch nicht gibt — weder in der Basis noch schon vorgemerkt. Hacktribe hat
 * 0, ±1, ±2, ±5…±12, ±16, ±20, ±24; es fehlen 22 (±3, ±4, ±13…±15, ±17…±19,
 * ±21…±23). Was da ist, wird am Parameter erkannt, nicht am Namen.
 */
export function fwOszFmSerie(vorlagePlatz: number): { ok: true; anzahl: number } | { ok: false; reason: string } {
  if (!basis) return { ok: false, reason: "Erst eine Basis laden." };
  if (vorlagePlatz < 1 || vorlagePlatz > oszBasisAnzahl) return { ok: false, reason: `Vorlage ${vorlagePlatz} liegt ausserhalb 1…${oszBasisAnzahl}` };
  const s = fmSerieFehlend(basis, vorlagePlatz, oszBasisAnzahl, oszNeu.map((o) => o.bytes));
  if (!s.ok) return s;
  let n = 0;
  for (const e of s.eintraege) {
    const r = fwOszAnhaengen(vorlagePlatz, e.name, decodeOsz(e.bytes).parameter);
    if (!r.ok) return n ? { ok: true, anzahl: n } : r;
    n++;
  }
  return { ok: true, anzahl: n };
}

export function fwOszEntfernen(index: number): void {
  oszNeu.splice(index, 1);
  oszNeu = oszNeu.map((o, i) => ({ platz: oszBasisAnzahl + i + 1, bytes: o.bytes }));
  oszListe();
  vorschau();
}

export function fwOszNeu(): readonly OszEintragMitPlatz[] {
  return oszNeu;
}

function oszFormularAnhaengen(): void {
  const vorlage = Number(($("fwOszVorlage") as HTMLSelectElement).value);
  const name = ($("fwOszName") as HTMLInputElement).value;
  const pRoh = ($("fwOszParam") as HTMLInputElement).value.trim();
  const pegelRoh = ($("fwOszPegel") as HTMLInputElement).value.trim();
  const r = fwOszAnhaengen(vorlage, name, pRoh === "" ? undefined : Number(pRoh), pegelRoh === "" ? undefined : Number(pegelRoh));
  setStatus(r.ok ? `Oszillator-Variante auf Platz ${r.platz} vorgemerkt — ⚠ ob das Gerät neue Einträge annimmt, ist noch offen; erst flüchtig probieren.` : r.reason);
}

function oszVorlageHinweis(): void {
  const hint = document.getElementById("fwOszParamHinweis");
  const nameEl = document.getElementById("fwOszName") as HTMLInputElement | null;
  if (!hint || !basis) return;
  const p = Number(($("fwOszVorlage") as HTMLSelectElement).value);
  if (!p) return;
  const d = decodeOsz(liesOsz(basis, p));
  hint.textContent = d.kategorie === 0x0a ? `FM: Hacktribe-Kennlinie, nicht linear — ±1→14, ±2→17, ±5→22, ±6…±12→24…48, ±16→53, ±20→58, ±24→63 (Vorlage ${d.parameter} ≙ ${fmParameterZuHalbton(d.parameter)} Halbtöne)` : d.kategorie === 0x10 ? `VPM: 0…32 Ratio-Stufe (Vorlage ${d.parameter})` : `Vorlage: Parameter ${d.parameter}, Pegel ${d.pegel}, Vorgabe ${d.vorgabe}`;
  if (nameEl && !nameEl.value) nameEl.value = d.name.slice(0, 15);
}

// ─── Modulations-Typen ───────────────────────────────────────────────────────

function modListe(): void {
  const el = document.getElementById("fwModListe");
  if (!el) return;
  el.innerHTML = modNeu
    .map((o, i) => {
      const d = decodeMod(o.bytes);
      return `<div class="sub" style="margin:1px 0;display:flex;gap:6px;align-items:center"><span style="min-width:34px">${o.platz + 1}</span><b>${escapeHtml(d.name)}</b><span style="opacity:.7">${MOD_WELLEN[d.welle] ?? `Welle ${d.welle}`}${d.bpm ? " · BPM" : " · frei"} · Ziel ${MOD_ZIEL_NAMEN[d.ziel] ?? d.ziel} · Depth ${d.depthMin}…${d.depthMax}</span><button class="ghost" data-mod-weg="${i}" style="padding:0 6px;font-size:11px" title="Eintrag entfernen">✕</button></div>`;
    })
    .join("");
}

/** Die 36 Kombinationen der Basis vormerken — fuer Tests direkt aufrufbar. */
export function fwModKombinationen(): { ok: true; anzahl: number; fehlend: string[] } | { ok: false; reason: string } {
  if (!basis) return { ok: false, reason: "Erst eine Basis laden." };
  if (!karte.modTabelle?.erweiterbar) return { ok: false, reason: `${karte.label}: Modulations-Typen lassen sich nur an die Hacktribe-Firmware anhängen.` };
  const tabelle = liesModTabelle(basis);
  if (!tabelle.length) return { ok: false, reason: "Die Basis hat keine Modulationstabelle bei 0xC01A0000 (Stock-Firmware?)." };
  const k = modKombinationen([...tabelle, ...modNeu.map((m) => m.bytes)]);
  for (const e of k.eintraege) modNeu.push({ platz: tabelle.length + modNeu.length, bytes: e.bytes });
  modListe();
  ($("fwMod") as HTMLInputElement).checked = true;
  vorschau();
  return { ok: true, anzahl: k.eintraege.length, fehlend: k.fehlend };
}

export function fwModEntfernen(index: number): void {
  modNeu.splice(index, 1);
  modNeu = modNeu.map((o, i) => ({ platz: modBasisAnzahl + i, bytes: o.bytes }));
  modListe();
  vorschau();
}

export function fwModNeu(): readonly ModEintragMitPlatz[] {
  return modNeu;
}

/** Fluechtig: die Eintraege hinter die Tabelle im Geraete-RAM — die Tabelle ist dort live. */
async function modFluechtig(): Promise<void> {
  if (!hooks?.schreiben || !hooks.lesen) {
    setStatus("Kein Geräte-Schreibweg (MIDI aus).");
    return;
  }
  if (karte.id !== "hacktribe") {
    setStatus(`${karte.label}: der Geräteweg (RAM-SysEx) gibt es nur mit Hacktribe.`);
    return;
  }
  if (!modNeu.length) {
    setStatus("Keine Modulations-Typen vorgemerkt.");
    return;
  }
  if (!basis) return;
  // Probe: Platz 1 und der letzte Platz der Basis muessen am Geraet stehen, der erste freie leer sein.
  const erster = await hooks.lesen(MOD_TABELLE_ADDR_HACKTRIBE, MOD_EINTRAG);
  const letzter = await hooks.lesen(MOD_TABELLE_ADDR_HACKTRIBE + (modBasisAnzahl - 1) * MOD_EINTRAG, MOD_EINTRAG);
  const frei = await hooks.lesen(MOD_TABELLE_ADDR_HACKTRIBE + modBasisAnzahl * MOD_EINTRAG, 1);
  if (!erster.ok || !letzter.ok || !frei.ok) {
    setStatus("Modulationstabelle am Gerät nicht lesbar.");
    return;
  }
  const b = liesModTabelle(basis);
  if (modName(erster.bytes) !== modName(b[0]) || modName(letzter.bytes) !== modName(b[modBasisAnzahl - 1])) {
    setStatus(`Die Tabelle am Gerät passt nicht zur Basis (dort „${modName(erster.bytes)}“ … „${modName(letzter.bytes)}“) — nichts geschrieben.`);
    return;
  }
  if (frei.bytes[0] !== 0xff && frei.bytes[0] !== 0) {
    setStatus(`Platz ${modBasisAnzahl + 1} am Gerät ist schon belegt — nichts geschrieben.`);
    return;
  }
  for (const m of modNeu) {
    if (!(await hooks.schreiben(MOD_TABELLE_ADDR_HACKTRIBE + m.platz * MOD_EINTRAG, m.bytes, `Mod-Typ ${m.platz + 1}`))) {
      setStatus(`Mod-Typ ${m.platz + 1} nicht geschrieben — abgebrochen.`);
      return;
    }
  }
  // Die Grenze 72 im Code (25 Stellen + Feld je Part) muss die Tabelle abdecken,
  // sonst setzt das Geraet jeden Typ darueber beim Laden auf 1 zurueck.
  const ziel = modNeu[modNeu.length - 1].platz;
  const cmp = await hooks.lesen(MOD_GRENZE_VERGLEICHE[0].addr, 4);
  const zeiger = await hooks.lesen(MOD_FELD_ZEIGER[0], 4);
  const w32 = (b: Uint8Array): number => (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  const aktuell = cmp.ok ? armImmediateWert(w32(cmp.bytes)) : null;
  const basisFeld = zeiger.ok ? w32(zeiger.bytes) : null;
  let grenzeText = "";
  if (aktuell === null || basisFeld === null || (basisFeld !== MOD_FELD_BASIS_STOCK && basisFeld !== MOD_FELD_BASIS_NEU)) {
    grenzeText = ` ⚠ Grenze im Code am Gerät nicht lesbar/erkannt — Typen über ${aktuell === null ? 72 : aktuell + 1} setzt das Gerät beim Laden auf 1 zurück.`;
  } else {
    const liste = modGrenzeSchreibliste({ maxIndex: aktuell, feldBasis: basisFeld }, ziel, [...b, ...modNeu.map((m) => m.bytes)]);
    if ("ok" in liste) grenzeText = ` ⚠ ${liste.reason}`;
    else {
      if (liste.feld && !(await hooks.schreiben(liste.feld.addr, liste.feld.bytes, "Mod-Feld je Part"))) {
        setStatus(`Mod-Feld bei ${liste.feld.addr.toString(16)} nicht geschrieben — Grenze im Code unverändert (${aktuell + 1}); aus- und einschalten stellt alles zurück.`);
        return;
      }
      for (const z of liste.woerter) {
        const bytes = new Uint8Array([z.wert & 0xff, (z.wert >>> 8) & 0xff, (z.wert >>> 16) & 0xff, (z.wert >>> 24) & 0xff]);
        if (!(await hooks.schreiben(z.addr, bytes, "Mod-Grenze"))) {
          setStatus(`Mod-Grenze bei ${z.addr.toString(16)} nicht geschrieben — Code am Gerät möglicherweise uneinheitlich; aus- und einschalten stellt alles zurück.`);
          return;
        }
      }
      if (liste.woerter.length) grenzeText = ` Grenze im Code ${aktuell + 1} → ${liste.nachher + 1}, Feld je Part nach 0x${MOD_FELD_BASIS_NEU.toString(16).toUpperCase()}.`;
    }
  }
  setStatus(`${modNeu.length} Modulations-Typen flüchtig geschrieben (${modBasisAnzahl + 1}…${modBasisAnzahl + modNeu.length}).${grenzeText} Am Gerät den Mod-Typ eines Parts über ${modBasisAnzahl} hinausdrehen — zeigt er „${modName(modNeu[0].bytes)}“? Gilt bis zum Ausschalten.`);
}

/** Fluechtig: Eintraege und Beschreiber ins Geraete-RAM — bis zum Ausschalten. */
async function oszFluechtig(): Promise<void> {
  if (!hooks?.schreiben || !hooks.lesen) {
    setStatus("Kein Geräte-Schreibweg (MIDI aus).");
    return;
  }
  if (karte.id !== "hacktribe") {
    setStatus(`${karte.label}: der Geräteweg (RAM-SysEx) gibt es nur mit Hacktribe.`);
    return;
  }
  if (!oszNeu.length) {
    setStatus("Keine Oszillator-Einträge vorgemerkt.");
    return;
  }
  const zellen = [];
  for (const z of OSZ_ZAEHLER) {
    const r = await hooks.lesen(z.addr, 4);
    if (!r.ok) {
      setStatus(`Beschreiber nicht lesbar: ${r.reason}`);
      return;
    }
    zellen.push({ addr: z.addr, wert: (r.bytes[0] | (r.bytes[1] << 8) | (r.bytes[2] << 16) | (r.bytes[3] << 24)) >>> 0 });
  }
  const zeiger: number[] = [];
  for (const a of OSZ_ZEIGER_ADDRS) {
    const r = await hooks.lesen(a, 4);
    if (!r.ok) {
      setStatus(`Zeiger nicht lesbar: ${r.reason}`);
      return;
    }
    zeiger.push((r.bytes[0] | (r.bytes[1] << 8) | (r.bytes[2] << 16) | (r.bytes[3] << 24)) >>> 0);
  }
  const stand = leseOszStand(zellen, zeiger);
  if (!stand.ok) {
    setStatus(`Gerät: ${stand.reason} — nichts geschrieben.`);
    return;
  }
  // Nach einem fluechtigen Lauf zaehlt das Geraet schon bis zum zuletzt
  // geschriebenen Platz — das ist kein Widerspruch zur Basis.
  if (stand.anzahl !== oszBasisAnzahl && stand.anzahl !== oszFluechtigBis) {
    setStatus(`Das Gerät zählt ${stand.anzahl} Einträge, die Basis ${oszBasisAnzahl} — die Plätze passen nicht. Erst dieselbe Firmware als Basis laden.`);
    return;
  }
  // Die Anzeige liest nicht die Tabelle im Abbild, sondern die Kopie, die der
  // Start nach OSZ_LAUFZEIT_ADDR legt. Probe, dass sie dort liegt: Platz 1
  // muss der Basis gleichen.
  if (!basis) return;
  const probe = await hooks.lesen(OSZ_LAUFZEIT_ADDR, OSZ_EINTRAG);
  const erster = liesOsz(basis, 1);
  if (!probe.ok || probe.bytes.length !== OSZ_EINTRAG || !probe.bytes.every((b, i) => b === erster[i])) {
    setStatus(`Laufzeitkopie bei 0x${OSZ_LAUFZEIT_ADDR.toString(16).toUpperCase()} passt nicht zur Basis (${probe.ok ? `Platz 1 dort: „${decodeOsz(probe.bytes).name}“` : probe.reason}) — nichts geschrieben.`);
    return;
  }
  for (const o of oszNeu) {
    const laufzeit = await hooks.schreiben(OSZ_LAUFZEIT_ADDR + (o.platz - 1) * OSZ_EINTRAG, o.bytes, `Oszillator ${o.platz} (Laufzeitkopie)`);
    const ok = laufzeit && (await hooks.schreiben(OSZ_TABELLE_ADDR + (o.platz - 1) * OSZ_EINTRAG, o.bytes, `Oszillator ${o.platz}`));
    if (!ok) {
      setStatus(`Platz ${o.platz} nicht geschrieben — abgebrochen, Beschreiber unverändert.`);
      return;
    }
  }
  const ziel = oszNeu[oszNeu.length - 1].platz;
  for (const z of oszZaehlerSchreibliste(ziel)) {
    const b = new Uint8Array([z.wert & 0xff, (z.wert >>> 8) & 0xff, (z.wert >>> 16) & 0xff, (z.wert >>> 24) & 0xff]);
    if (!(await hooks.schreiben(z.addr, b, `Oszillator-Zähler`))) {
      setStatus(`Beschreiber ${z.addr.toString(16)} nicht geschrieben — Liste am Gerät möglicherweise uneinheitlich; aus- und einschalten stellt alles zurück.`);
      return;
    }
  }
  // Die drei cmp r0,#N im Code (Oszillator ↔ Sample) muessen die Liste abdecken.
  const g = await hooks.lesen(OSZ_GRENZE_STELLEN[0], 4);
  const aktuell = g.ok ? cmpR0Immediate((g.bytes[0] | (g.bytes[1] << 8) | (g.bytes[2] << 16) | (g.bytes[3] << 24)) >>> 0) : null;
  let grenzeText = "";
  if (aktuell === null) grenzeText = " ⚠ Oszillator-Grenze im Code nicht lesbar/erkannt — Plätze über 273 laufen evtl. über den Sample-Pfad.";
  else {
    const liste = oszGrenzeSchreibliste(aktuell, ziel - 1);
    for (const z of liste) {
      const b = new Uint8Array([z.wert & 0xff, (z.wert >>> 8) & 0xff, (z.wert >>> 16) & 0xff, (z.wert >>> 24) & 0xff]);
      if (!(await hooks.schreiben(z.addr, b, "Oszillator-Grenze"))) {
        setStatus(`Oszillator-Grenze bei ${z.addr.toString(16)} nicht geschrieben — Plätze über ${aktuell + 1} laufen über den Sample-Pfad; aus- und einschalten stellt alles zurück.`);
        return;
      }
    }
    if (liste.length) grenzeText = ` Grenze im Code ${aktuell} → ${cmpR0Immediate(liste[0].wert)}.`;
  }
  oszFluechtigBis = ziel;
  setStatus(`${oszNeu.length} Oszillator-Einträge flüchtig geschrieben (Laufzeitkopie + Tabelle), Liste bis ${ziel}.${grenzeText} Am Gerät die Sample-Liste ab ${oszBasisAnzahl + 1} prüfen — gilt bis zum Ausschalten.`);
}

// ─── Bauen ───────────────────────────────────────────────────────────────────

interface Bauplan {
  presets: SammlungsEintrag[];
  grooves: SammlungsEintrag[];
  init: { name: string; bytes: Uint8Array } | null;
  global: { name: string; bytes: Uint8Array } | null;
  splash: boolean;
  dsp: DspPatch[];
  osz: OszEintragMitPlatz[];
  mod: ModEintragMitPlatz[];
  zeilen: string[];
}

function bauplan(): Bauplan | null {
  if (!basis || !basisBefund) {
    setStatus("Erst eine Basis laden.");
    return null;
  }
  const an = (id: string): boolean => (document.getElementById(id) as HTMLInputElement | null)?.checked === true;
  const zeilen: string[] = [`Basis: ${basisName} — ${karte.label} (IFX bis ${basisBefund.ifxMaxIndex + 1}${karte.grooveBank ? `, Grooves bis ${basisBefund.grooveMaxIndex + 1}` : ""})`];
  let presets: SammlungsEintrag[] = [];
  if (an("fwPresets")) {
    const z = pmZustand();
    // Ohne geladenen Stand ist die leere Bank des Managers nur die Vorschau —
    // sie als Wunsch zu nehmen hiesse, alle 128 Plaetze der Firmware zu leeren.
    if (z && pmGeladen()) {
      const alle = unterschiede(z, zustandAusFirmware(basis, karte));
      // Plaetze, die die Karte nicht hat, kann der Manager nicht schreiben (Stock: IFX > 38, alle Grooves) — sie werden genannt, nicht verschwiegen.
      const passt = (e: SammlungsEintrag): boolean => {
        const max = e.art === "groove" ? (karte.grooveBank?.count ?? 0) : e.art === "mfx" ? karte.mfxSchreibMax + 1 : karte.ifxSchreibMax + 1;
        return (e.platz ?? 0) <= max;
      };
      presets = alle.filter(passt);
      const draussen = alle.filter((e) => !passt(e));
      if (draussen.length) zeilen.push(`Presets: ${draussen.length} Platz/Plätze des Managers gibt es in ${karte.label} nicht (${draussen.map((e) => `${e.art.toUpperCase()} ${e.platz}`).slice(0, 6).join(", ")}${draussen.length > 6 ? ", …" : ""}) — übergangen`);
      const ifx = presets.filter((e) => e.art === "ifx").length;
      const mfx = presets.filter((e) => e.art === "mfx").length;
      zeilen.push(`Presets: ${presets.length} Platz/Plätze anders als in der Datei (${ifx} IFX, ${mfx} MFX); IFX belegt bis ${hoechsterBelegter(z, "ifx")}`);
    } else zeilen.push("Presets: im Manager ist kein Stand geladen — es werden keine Presets geschrieben");
  }
  const gv = an("fwGrooves") ? grooves : [];
  if (an("fwGrooves")) zeilen.push(`Grooves: ${gv.length} mit Platz${gv.length ? ` (${Math.min(...gv.map((g) => g.platz!))}–${Math.max(...gv.map((g) => g.platz!))})` : ""}`);
  let init: Bauplan["init"] = null;
  if (an("fwInit")) {
    const quelle = ($("fwInitQuelle") as HTMLSelectElement).value;
    if (quelle === "datei") {
      init = initDatei;
      zeilen.push(init ? `Init-Pattern: aus Datei ${init.name}` : "Init-Pattern: keine Datei geladen");
    } else {
      try {
        const p = aktuellesPatternDatei();
        init = { name: p.name, bytes: p.bytes };
        zeilen.push(`Init-Pattern: „${p.name}“ aus dem Editor`);
      } catch (e) {
        zeilen.push(`Init-Pattern: Editor nicht erreichbar (${e instanceof Error ? e.message : String(e)})`);
      }
    }
  }
  const splash = an("fwSplash");
  if (splash) zeilen.push(`Startbild: ${pixel.reduce((a, b) => a + b, 0)} dunkle Pixel aus dem Pixel-Editor`);
  let global: Bauplan["global"] = null;
  if (an("fwGlobal")) {
    global = globalBlock;
    zeilen.push(global ? `Init-Global: ${global.name} (Chain ${global.bytes[E2_GLOBAL_CHAIN_MODE_OFF]}, Clock ${global.bytes[E2_GLOBAL_CLOCK_SOURCE_OFF]})` : "Init-Global: kein Block geladen");
  }
  const dsp = karte.familie === "sampler" ? fwDspPatches().filter((p) => dspGewaehlt.has(p.id)) : [];
  if (dsp.length) zeilen.push(`DSP-Patches (⚠ experimentell): ${dsp.map((p) => p.titel).join(", ")}`);
  else if (karte.familie !== "sampler" && dspGewaehlt.size) zeilen.push(`DSP-Patches: ${dspGewaehlt.size} angehakt, aber ${karte.label} hat eine andere DSP-Kette — übergangen`);
  const osz = an("fwOsz") ? oszNeu : [];
  if (an("fwOsz")) zeilen.push(osz.length ? `Oszillatoren: ${osz.length} Variante(n) auf ${osz[0].platz}–${osz[osz.length - 1].platz}` : "Oszillatoren: nichts vorgemerkt");
  const mod = an("fwMod") ? modNeu : [];
  if (an("fwMod")) zeilen.push(mod.length ? `Modulations-Typen: ${mod.length} neu auf ${mod[0].platz + 1}–${mod[mod.length - 1].platz + 1} (⚠ Menügrenze am Gerät offen)` : "Modulations-Typen: nichts vorgemerkt");
  return { presets, grooves: gv, init, global, splash, dsp, osz, mod, zeilen };
}

function vorschau(): void {
  const plan = bauplan();
  const el = document.getElementById("fwBericht");
  if (el) el.textContent = plan ? plan.zeilen.join("\n") : "";
}

/** Fuer Tests: das Abbild bauen, ohne es abzulegen. */
export function fwBaueAbbild(): { ok: true; bytes: Uint8Array; zeilen: string[] } | { ok: false; reason: string } {
  const plan = bauplan();
  if (!plan || !basis) return { ok: false, reason: "keine Basis" };
  const zeilen = [...plan.zeilen];
  let bytes = basis;
  const eintraege = [...plan.presets, ...plan.grooves];
  if (eintraege.length) {
    const r = baueFirmware(basis, eintraege, karte);
    if (!r.ok) return { ok: false, reason: r.reason };
    bytes = r.bytes;
    if (r.bericht.zaehler.length) zeilen.push(`IFX-Menü: bis ${r.bericht.ifxMaxVorher + 1} → bis ${r.bericht.ifxMaxNachher + 1}`);
    if (r.bericht.grooveZaehler.length) zeilen.push(`Groove-Menü: bis ${r.bericht.grooveMaxVorher + 1} → bis ${r.bericht.grooveMaxNachher + 1}`);
  }
  try {
    if (plan.init) bytes = setzeInitPattern(bytes, plan.init.bytes, karte);
    if (plan.global) bytes = setzeInitGlobal(bytes, plan.global.bytes, karte);
    if (plan.splash) bytes = setzeSplash(bytes, pixelZuSplash(pixel), karte);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  for (const p of plan.dsp) {
    const r = wendeDspPatchAn(bytes, p);
    if (!r.ok) return { ok: false, reason: r.reason };
    bytes = r.bytes;
    zeilen.push(`DSP: ${p.titel} — ${r.stellen.map((st) => `${st.bytes} B @ 0x${st.offset.toString(16).toUpperCase()}`).join(", ")}`);
  }
  if (plan.osz.length) {
    const r = setzeOszTabelle(bytes, plan.osz);
    if (!r.ok) return { ok: false, reason: r.reason };
    bytes = r.bytes;
    zeilen.push(`Oszillator-Tabelle: Liste bis ${r.anzahlVorher} → bis ${r.anzahlNachher}`);
  }
  if (plan.mod.length) {
    const r = setzeModTabelle(bytes, plan.mod);
    if (!r.ok) return { ok: false, reason: r.reason };
    bytes = r.bytes;
    zeilen.push(`Modulations-Tabelle: bis ${r.anzahlVorher} → bis ${r.anzahlNachher}${r.grenze ? `, Grenze im Code ${r.grenze.vorher + 1} → ${r.grenze.nachher + 1}` : ""}`);
  }
  if (!eintraege.length && !plan.init && !plan.global && !plan.splash && !plan.dsp.length && !plan.osz.length && !plan.mod.length) return { ok: false, reason: "Kein Baustein angehakt — es gäbe nichts zu bauen" };
  return { ok: true, bytes, zeilen };
}

/** Zielgeraet + laufende Firmware aus der Oberflaeche. */
function zielWahl(): { geraet: Variante; laufend: LaufendeFirmware } {
  const g = (document.getElementById("fwZielGeraet") as HTMLSelectElement | null)?.value;
  const l = (document.getElementById("fwZielFirmware") as HTMLSelectElement | null)?.value;
  const geraet: Variante = g === "synth" ? "synth" : "sampler";
  const laufend: LaufendeFirmware = l && l in LAUFENDE_FIRMWARE ? (l as LaufendeFirmware) : karte.id === "hacktribe" ? "hacktribe" : karte.id === "synth-stock" ? "synth-stock" : "sampler-stock";
  return { geraet, laufend };
}

/** Nach dem Laden einer Basis das Ziel auf das Naheliegende stellen: das Geraet der Karte, darauf diese Firmware. */
function zielVorbelegen(): void {
  const g = document.getElementById("fwZielGeraet") as HTMLSelectElement | null;
  const l = document.getElementById("fwZielFirmware") as HTMLSelectElement | null;
  if (g) g.value = karte.variante;
  if (l) l.value = karte.id === "hacktribe" ? "hacktribe" : karte.id === "synth-stock" ? "synth-stock" : "sampler-stock";
  zielInfo();
}

function zielInfo(): void {
  const el = document.getElementById("fwZielInfo");
  if (!el) return;
  const z = zielWahl();
  const lf = LAUFENDE_FIRMWARE[z.laufend];
  el.textContent = `→ Kopf ${VARIANTEN[lf.kopf].label} (Device-ID 0x${VARIANTEN[lf.kopf].deviceId.toString(16).toUpperCase().padStart(4, "0")}), Pfad ${VARIANTEN[lf.kopf].sdOrdner}/SYSTEM.VSB${lf.geraet !== z.geraet ? " ⚠ ungewöhnliche Kombination" : ""}`;
}

/** Die Referenz derselben Bauart aus der Ablage (Stock) — fuer Freigabe und Analyse. */
function referenzFuer(k: FirmwareKarte, bevorzugt?: "stock" | "hacktribe"): Uint8Array | undefined {
  if (!ablage) return undefined;
  const wahl = bevorzugt ?? "stock";
  if (k.familie === "sampler" && wahl === "hacktribe") return ablageDateien.find((d) => d.name === ablage?.hacktribe?.name)?.bytes;
  const d = k.familie === "synth" ? ablage.synthStock : ablage.samplerStock;
  return d ? ablageDateien.find((x) => x.name === d.name)?.bytes : undefined;
}

/**
 * Referenz fuer die Freigabe: fuer eine Hacktribe-Basis die unveraenderte
 * Hacktribe (sonst zaehlten Hacktribes eigene Code-Patches als „draussen“),
 * sonst Stock derselben Bauart.
 */
function freigabeReferenz(): Uint8Array | undefined {
  return (karte.id === "hacktribe" ? referenzFuer(karte, "hacktribe") : undefined) ?? referenzFuer(karte);
}

/** Das gebaute Abbild durch die Freigabe fuehren — fuer Tests direkt aufrufbar. */
export function fwFreigabe(): { ok: true; freigabe: Freigabe; zeilen: string[] } | { ok: false; reason: string } {
  const r = fwBaueAbbild();
  if (!r.ok) return r;
  const f = freigabe(r.bytes, zielWahl(), freigabeReferenz());
  return { ok: true, freigabe: f, zeilen: [...r.zeilen, "", ...f.zeilen] };
}

async function bauen(): Promise<void> {
  const r = fwFreigabe();
  if (!r.ok) {
    setStatus(`Nicht gebaut: ${r.reason}`);
    return;
  }
  const el = document.getElementById("fwBericht");
  if (!r.freigabe.ok) {
    if (el) el.textContent = r.zeilen.join("\n");
    setStatus("NICHT FREIGEGEBEN — siehe Bericht. Es wurde keine Datei abgelegt.");
    return;
  }
  const bytes = r.freigabe.bytes;
  const hash = await sha256Hex(bytes);
  const name = (await frageText("Dateiname (im Ordner Firmware/):", "SYSTEM.VSB")) ?? "SYSTEM.VSB";
  const ab = await legeAb(name.trim() || "SYSTEM.VSB", bytes, FIRMWARE_ORDNER);
  // Nach dem Bau die Gegenprobe: was hat sich gegenueber der Basis wirklich geaendert?
  const gegenprobe = basis && karte.id === "hacktribe" ? vergleicheFirmware(basis, bytes).zeilen.map((z) => `  ${z}`) : [];
  if (el) {
    el.textContent = [...r.zeilen, hash ? `Ergebnis SHA-256 ${hash}` : "", ab.pfad ? `→ ${ab.pfad}` : "→ Download", ...(gegenprobe.length ? ["Gegenprobe Basis ↔ Ergebnis:", ...gegenprobe] : [])]
      .filter(Boolean)
      .join("\n");
  }
  setStatus(`Firmware gebaut und freigegeben${ab.pfad ? ` → ${ab.pfad}` : " → Download"}. Installieren: als ${r.freigabe.sdPfad} auf die SD-Karte, dann am Gerät DATA UTILITY → SOFTWARE UPDATE.`);
}

/** Fuer Tests: den ganzen Geraetestand einer Sicherung in die Basis legen, ohne abzulegen. */
export function fwBaueAusSicherung(text: string): { ok: true; bytes: Uint8Array; zeilen: string[] } | { ok: false; reason: string } {
  if (!basis) return { ok: false, reason: "Erst eine Basis laden." };
  let s;
  try {
    s = leseSicherung(text);
  } catch (e) {
    return { ok: false, reason: `Sicherung nicht lesbar: ${e instanceof Error ? e.message : String(e)}` };
  }
  const r = firmwareAusSicherung(basis, s.bloecke, karte);
  if (!r.ok) return r;
  const zeilen = [
    `Basis: ${basisName}`,
    `Sicherung vom ${s.wann || "?"}: ${r.bericht.bereiche.map((b) => `${b.key} (${b.bytes} B)`).join(", ")}`,
    `IFX-Menü bis Platz ${r.bericht.ifxMaxIndex + 1}${r.bericht.grooveMaxIndex >= 0 ? `, Grooves bis ${r.bericht.grooveMaxIndex + 1}` : ""}`,
  ];
  if (r.bericht.fehlend.length) zeilen.push(`Nicht in der Sicherung, bleibt aus der Basis: ${r.bericht.fehlend.join(", ")}`);
  return { ok: true, bytes: r.bytes, zeilen };
}

/** Die Basis gegen eine zweite Datei halten — der Bericht landet im Bauplan-Feld. */
async function vergleichen(f: File): Promise<void> {
  if (!basis) {
    setStatus("Erst eine Basis laden.");
    return;
  }
  try {
    const andere = new Uint8Array(await f.arrayBuffer());
    if (karte.id !== "hacktribe") {
      // Stock-Karten: der Vergleich laeuft ueber die Analyse (platzweise ueber die Zeigertabellen)
      const a = analysiereFirmware(andere, basis);
      const el = document.getElementById("fwBericht");
      if (el) el.textContent = a.ok ? [`Vergleich: ${f.name} gegen die Basis ${basisName}`, ...a.zeilen, ...a.erweiterungen.map((e) => `  ${e.name} — ${e.beschreibung}`)].join("\n") : a.reason;
      setStatus(a.ok ? `${a.erweiterungen.length} Unterschied(e) gegenüber der Basis.` : a.reason);
      return;
    }
    const v = vergleicheFirmware(basis, andere);
    const el = document.getElementById("fwBericht");
    if (el) el.textContent = [`Vergleich: ${basisName} (links) ↔ ${f.name} (rechts)`, ...v.zeilen].join("\n");
    setStatus(v.gleich ? "Die beiden Dateien sind identisch." : `${v.unterschiede.length} Unterschied(e) in bekannten Bereichen, ${v.sonstigeBytes} Bytes außerhalb.`);
  } catch (e) {
    setStatus(`Vergleich nicht möglich: ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** Einen Bereich in 256er-Haeppchen vom Geraet lesen (RAM-Lesen liefert hoechstens 0x100 je Anfrage). */
async function geraetLesen(addr: number, len: number): Promise<Uint8Array | null> {
  if (!hooks?.lesen) return null;
  const out = new Uint8Array(len);
  for (let o = 0; o < len; o += 0x100) {
    const r = await hooks.lesen(addr + o, Math.min(0x100, len - o));
    if (!r.ok) return null;
    out.set(r.bytes.subarray(0, Math.min(0x100, len - o)), o);
  }
  return out;
}

/**
 * Geraet ↔ Basis: Oszillator-Liste (Laufzeitkopie + Beschreiber), Grenze im
 * Code und Modulationstabelle vom laufenden Geraet lesen und gegen die Basis
 * halten. Fuer Tests direkt aufrufbar; liefert die Berichtzeilen.
 */
export async function fwGeraetVergleich(): Promise<string[]> {
  const zeilen: string[] = [];
  const fertig = (status: string): string[] => {
    const el = document.getElementById("fwBericht");
    if (el) el.textContent = zeilen.join("\n");
    setStatus(status);
    return zeilen;
  };
  if (!basis) return fertig("Erst eine Basis laden.");
  if (!hooks?.lesen) return fertig("Kein Geräte-Leseweg (MIDI aus).");
  if (karte.id !== "hacktribe") return fertig(`${karte.label}: den Geräteweg (RAM-SysEx) gibt es nur mit Hacktribe.`);
  zeilen.push(`Gerät ↔ Basis (${basisName})`);
  // 1) Oszillator-Beschreiber
  const zellen = [];
  for (const z of OSZ_ZAEHLER) {
    const r = await hooks.lesen(z.addr, 4);
    if (!r.ok) return fertig(`Beschreiber nicht lesbar: ${r.reason} — erst „Gerät suchen“?`);
    zellen.push({ addr: z.addr, wert: (r.bytes[0] | (r.bytes[1] << 8) | (r.bytes[2] << 16) | (r.bytes[3] << 24)) >>> 0 });
  }
  const stand = leseOszStand(zellen);
  if (!stand.ok) return fertig(`Gerät: ${stand.reason}`);
  zeilen.push(`Oszillator-Beschreiber: Gerät zählt ${stand.anzahl}, Basis ${oszBasisAnzahl}${stand.anzahl === oszBasisAnzahl ? "" : " ⚠"}`);
  // 2) Laufzeitkopie gegen die Basis-Tabelle
  const n = Math.min(stand.anzahl, OSZ_MAX);
  const kopie = await geraetLesen(OSZ_LAUFZEIT_ADDR, n * OSZ_EINTRAG);
  if (!kopie) return fertig("Laufzeitkopie nicht lesbar.");
  let anders = 0;
  let erster = "";
  for (let p = 1; p <= n; p++) {
    const g = kopie.subarray((p - 1) * OSZ_EINTRAG, p * OSZ_EINTRAG);
    const b = p <= oszBasisAnzahl ? liesOsz(basis, p) : null;
    const gleich = !!b && g.every((x, i) => x === b[i]);
    if (!gleich) {
      anders++;
      if (!erster) erster = `${p}: Gerät „${istOszLeer(g) ? "—" : decodeOsz(g).name}“ ↔ Basis „${b && !istOszLeer(b) ? decodeOsz(b).name : "—"}“`;
    }
  }
  const gn = (p: number) => decodeOsz(kopie.subarray((p - 1) * OSZ_EINTRAG, p * OSZ_EINTRAG)).name;
  zeilen.push(`Oszillator-Liste am Gerät: ${n} Plätze, 1 „${gn(1)}“ … ${n} „${gn(n)}“${n >= 35 ? `, 35 „${gn(35)}“` : ""}`);
  zeilen.push(anders ? `  ${anders} Platz/Plätze anders als die Basis — erster: ${erster}` : "  byteweise wie die Basis");
  // 3) Grenze im Code
  const g = await hooks.lesen(OSZ_GRENZE_STELLEN[0], 4);
  const grenze = g.ok ? cmpR0Immediate((g.bytes[0] | (g.bytes[1] << 8) | (g.bytes[2] << 16) | (g.bytes[3] << 24)) >>> 0) : null;
  zeilen.push(grenze === null ? "Oszillator-Grenze im Code: nicht lesbar/erkannt" : `Oszillator-Grenze im Code: ${grenze}${grenze < n - 1 ? ` ⚠ unter dem letzten Platz (${n - 1}) — Plätze darüber laufen über den Sample-Pfad` : " ✓"}`);
  // 4) Modulationstabelle
  const modBasis = liesModTabelle(basis);
  const geraetMod: Uint8Array[] = [];
  for (let i = 0; i < MOD_MAX; i++) {
    const r = await hooks.lesen(MOD_TABELLE_ADDR_HACKTRIBE + i * MOD_EINTRAG, MOD_EINTRAG);
    if (!r.ok) return fertig("Modulationstabelle nicht lesbar.");
    if (istModLeer(r.bytes.subarray(0, MOD_EINTRAG))) break;
    geraetMod.push(r.bytes.slice(0, MOD_EINTRAG));
  }
  const modAnders = geraetMod.filter((b, i) => !modBasis[i] || modName(b) !== modName(modBasis[i])).length;
  zeilen.push(`Modulationstypen am Gerät: ${geraetMod.length} (Basis ${modBasis.length})${geraetMod.length ? `, letzter „${modName(geraetMod[geraetMod.length - 1])}“` : ""}${modAnders ? ` — ${modAnders} Name(n) anders als die Basis` : ""}`);
  // 5) Mod-Grenze im Code (25 Stellen; hier der erste Vergleich und der erste Feld-Zeiger)
  const mg = await hooks.lesen(MOD_GRENZE_VERGLEICHE[0].addr, 4);
  const mz = await hooks.lesen(MOD_FELD_ZEIGER[0], 4);
  const w32 = (b: Uint8Array): number => (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0;
  const modGrenze = mg.ok ? armImmediateWert(w32(mg.bytes)) : null;
  const modFeld = mz.ok ? w32(mz.bytes) : null;
  const feldText = modFeld === MOD_FELD_BASIS_NEU ? "Feld je Part verlegt (TekkForge)" : modFeld === MOD_FELD_BASIS_STOCK ? "Feld je Part im BSS (Stock)" : `Feld-Zeiger ${modFeld === null ? "?" : "0x" + modFeld.toString(16).toUpperCase()}`;
  zeilen.push(
    modGrenze === null
      ? "Mod-Grenze im Code: nicht lesbar/erkannt"
      : `Mod-Grenze im Code: Typen bis ${modGrenze + 1}, ${feldText}${modGrenze + 1 < geraetMod.length ? ` ⚠ unter der Tabelle (${geraetMod.length}) — Typen darüber setzt das Gerät beim Laden auf 1` : " ✓"}`,
  );
  return fertig(`Gerät gelesen: ${n} Oszillatoren (${anders ? `${anders} anders` : "wie die Basis"}), Grenze ${grenze ?? "?"}, ${geraetMod.length} Modulationstypen, Mod-Grenze ${modGrenze === null ? "?" : modGrenze + 1}.`);
}

async function sicherungEinbrennen(f: File): Promise<void> {
  const r = fwBaueAusSicherung(await f.text());
  if (!r.ok) {
    setStatus(`Nicht gebaut: ${r.reason}`);
    return;
  }
  // Auch dieser Weg geht durch die Freigabe — Kopf fuers Ziel, harte Pruefungen.
  const fg = freigabe(r.bytes, zielWahl(), freigabeReferenz());
  const el = document.getElementById("fwBericht");
  if (!fg.ok) {
    if (el) el.textContent = [...r.zeilen, "", ...fg.zeilen].join("\n");
    setStatus("NICHT FREIGEGEBEN — siehe Bericht. Es wurde keine Datei abgelegt.");
    return;
  }
  const hash = await sha256Hex(fg.bytes);
  const name = (await frageText("Dateiname (im Ordner Firmware/):", "SYSTEM.VSB")) ?? "SYSTEM.VSB";
  const ab = await legeAb(name.trim() || "SYSTEM.VSB", fg.bytes, FIRMWARE_ORDNER);
  // Nach dem Bau die Gegenprobe: was hat sich gegenueber der Basis wirklich geaendert?
  const gegenprobe = basis ? vergleicheFirmware(basis, fg.bytes).zeilen.map((z) => `  ${z}`) : [];
  if (el) {
    el.textContent = [...r.zeilen, "", ...fg.zeilen, hash ? `Ergebnis SHA-256 ${hash}` : "", ab.pfad ? `→ ${ab.pfad}` : "→ Download", "Gegenprobe Basis ↔ Ergebnis:", ...gegenprobe]
      .filter(Boolean)
      .join("\n");
  }
  setStatus(`Gerätestand aus ${f.name} eingebrannt und freigegeben${ab.pfad ? ` → ${ab.pfad}` : " → Download"}. Installieren: als ${fg.sdPfad} auf die SD-Karte.`);
}

// ─── Bauplan ─────────────────────────────────────────────────────────────────

/** Die angehakten Bausteine als Bauplan-Text — fuer Tests direkt aufrufbar. */
export function fwBauplanText(titel: string): { ok: true; text: string; zeilen: string[] } | { ok: false; reason: string } {
  const plan = bauplan();
  if (!plan) return { ok: false, reason: "Erst eine Basis laden." };
  if (!plan.presets.length && !plan.grooves.length && !plan.init && !plan.global && !plan.splash && !plan.dsp.length && !plan.osz.length) {
    return { ok: false, reason: "Kein Baustein angehakt — der Bauplan wäre leer." };
  }
  const text = baueBauplan({
    titel,
    autor: "TekkForge",
    basisSha256: basisHash ?? undefined,
    eintraege: [...plan.presets, ...plan.grooves],
    ...(plan.init ? { initPattern: plan.init.bytes } : {}),
    ...(plan.global ? { initGlobal: plan.global.bytes } : {}),
    ...(plan.splash ? { splash: pixelZuSplash(pixel) } : {}),
    ...(plan.dsp.length ? { dsp: plan.dsp } : {}),
    ...(plan.osz.length ? { osz: plan.osz } : {}),
  });
  return { ok: true, text, zeilen: plan.zeilen };
}

async function bauplanSichern(): Promise<void> {
  const titel = (await frageText("Titel des Bauplans:", "Mein Umbau")) ?? "";
  if (!titel.trim()) return;
  const r = fwBauplanText(titel.trim());
  if (!r.ok) {
    setStatus(r.reason);
    return;
  }
  const datei = `${titel.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "bauplan"}.tfbau`;
  download(r.text, datei, "application/json");
  setStatus(`Bauplan als ${datei} gesichert (${r.zeilen.length} Bausteine).`);
}

/** Einen Bauplan in Manager und Werkbank laden — fuer Tests direkt aufrufbar. */
export function fwBauplanLaden(text: string, woher: string): { ok: true; zeilen: string[] } | { ok: false; reason: string } {
  let plan;
  try {
    plan = leseBauplan(text);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
  const zeilen: string[] = [`Bauplan „${plan.titel}“${plan.autor ? ` von ${plan.autor}` : ""}`];
  if (plan.basisSha256 && basisHash && plan.basisSha256 !== basisHash) {
    zeilen.push(`⚠ Der Plan entstand auf einer anderen Basis (SHA-256 ${plan.basisSha256.slice(0, 16)}…) — Plätze und Zähler können abweichen.`);
  }
  if (plan.eintraege.length) {
    const u = pmEintraegeUebernehmen(plan.eintraege, `Bauplan ${woher}`);
    zeilen.push(`Presets/Grooves: ${u.gesetzt} in den Manager gelegt${u.inBibliothek ? `, ${u.inBibliothek} in die Bibliothek (kein Stand geladen)` : ""}`);
    ($("fwPresets") as HTMLInputElement).checked = true;
  }
  if (plan.initPattern) {
    initDatei = { name: `Bauplan ${woher}`, bytes: plan.initPattern.length === E2SPAT_GROESSE ? plan.initPattern : liesInitPatternAlsDatei(plan.initPattern) };
    ($("fwInitQuelle") as HTMLSelectElement).value = "datei";
    ($("fwInit") as HTMLInputElement).checked = true;
    ($("fwInitInfo") as HTMLElement).textContent = initDatei.name;
    zeilen.push("Init-Pattern übernommen");
  }
  if (plan.initGlobal) {
    globalUebernehmen(plan.initGlobal, `Bauplan ${woher}`);
    zeilen.push("Init-Global übernommen");
  }
  if (plan.splash) {
    bildHell = null;
    fwSetzePixel(splashZuPixel(plan.splash));
    ($("fwSplash") as HTMLInputElement).checked = true;
    zeilen.push("Startbild übernommen");
  }
  if (plan.dsp?.length) {
    for (const p of plan.dsp) fwDspAufnehmen(p);
    zeilen.push(`DSP-Patches: ${plan.dsp.length} übernommen und angehakt (⚠ experimentell)`);
  }
  if (plan.osz?.length) {
    // Die Plaetze des Plans gelten, wenn sie hinter dem Stand der Basis anschliessen; sonst werden sie neu vergeben.
    const sortiert = [...plan.osz].sort((a, b) => a.platz - b.platz);
    const passt = sortiert[0].platz === oszBasisAnzahl + 1;
    oszNeu = sortiert.map((o, i) => ({ platz: passt ? o.platz : oszBasisAnzahl + i + 1, bytes: o.bytes }));
    oszListe();
    ($("fwOsz") as HTMLInputElement).checked = true;
    zeilen.push(`Oszillatoren: ${oszNeu.length} übernommen${passt ? "" : " (Plätze neu vergeben, die Basis zählt anders)"}`);
  }
  vorschau();
  return { ok: true, zeilen };
}

/** Einen nackten Init-Block als .e2spat/.e2pat der Karte verpacken — so, wie die Werkbank Dateien erwartet. */
function liesInitPatternAlsDatei(block: Uint8Array): Uint8Array {
  return patternAlsDatei(block, karte);
}

async function bauplanLaden(f: File): Promise<void> {
  const r = fwBauplanLaden(await f.text(), f.name);
  if (!r.ok) {
    setStatus(`Bauplan nicht geladen: ${r.reason}`);
    return;
  }
  const el = document.getElementById("fwBericht");
  if (el) el.textContent = r.zeilen.join("\n");
  setStatus(`Bauplan geladen — Haken prüfen, dann „Firmware bauen“.`);
}

// ─── Firmware-Ablage und Basis-Wahl ──────────────────────────────────────────
//
// Die offiziellen Abbilder (Synth/Sampler v2.02) und hacktribe-2.patch legt
// der Nutzer in userData/firmware (Desktop) — oder waehlt sie im Browser fuer
// die Sitzung. Jede Datei wird am SHA-256 eingeordnet (firmwareAblage.ts);
// die Basis-Wahl nimmt dann die richtige Datei, ohne dass jemand suchen muss.

/** Ein Versprechen aus einem Klick-Handler: Fehler landen in der Statuszeile, nie als unbehandelte Rejection. */
function sicher(p: Promise<unknown>): void {
  p.catch((e) => setStatus(`Fehler: ${e instanceof Error ? e.message : String(e)}`));
}

function ablageAnzeigen(): void {
  const liste = document.getElementById("fwAblageListe");
  const info = document.getElementById("fwAblageInfo");
  if (liste) liste.innerHTML = ablage ? ablage.zeilen.map((z) => `<div>${escapeHtml(z)}</div>`).join("") : "";
  if (info) info.textContent = ablage ? (ablage.fehlend.length ? `Es fehlt: ${ablage.fehlend.join("; ")}` : "Synth, Sampler und Hacktribe(-Patch) sind da.") : "noch nicht eingelesen";
  const eig = document.getElementById("fwBasisEigene") as HTMLSelectElement | null;
  if (eig) eig.innerHTML = (ablage?.eigene ?? []).map((d) => `<option value="${escapeHtml(d.name)}">${escapeHtml(d.name)} — ${escapeHtml(d.rolle === "beschaedigt" ? "⚠ " + d.hinweis.split(" — ")[0] : d.befund ? karteLabel(d.befund) : d.rolle)}</option>`).join("");
  const erz = document.getElementById("fwHacktribeErzeugen") as (HTMLElement & { disabled?: boolean }) | null;
  if (erz) erz.disabled = !(ablage?.samplerStock && ablage?.patch);
}

/** Den Ablage-Ordner (bzw. die Sitzung) einlesen und einordnen — fuer Tests direkt aufrufbar. */
export async function fwAblageLesen(): Promise<AblageStand> {
  const zugang = firmwareAblageZugang();
  const pfadEl = document.getElementById("fwAblagePfad");
  if (pfadEl) pfadEl.textContent = zugang.wo === "ordner" ? await zugang.pfad() : "nur für diese Sitzung (Browser) — Dateien über „Datei hinzufügen…“";
  ablageDateien = await zugang.lesen();
  ablage = ablageStand(ablageDateien.map((d) => ordneDateiEin(d.name, d.sha256, d.bytes)));
  ablageAnzeigen();
  return ablage;
}

/** Dateien aus einem Datei-Feld in die Ablage nehmen (Desktop: in den Ordner kopieren; Browser: Sitzung). */
async function ablageDateienAufnehmen(dateien: File[]): Promise<void> {
  const zugang = firmwareAblageZugang();
  let n = 0;
  for (const f of dateien) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const hash = (await sha256Hex(bytes)) ?? "";
    const name = f.name.replace(/[^A-Za-z0-9._ -]/g, "_");
    if (zugang.wo === "sitzung") sitzungsAblageAufnehmen({ name, groesse: bytes.length, sha256: hash, bytes });
    else await zugang.ablegen(name, bytes, hash);
    n++;
  }
  await fwAblageLesen();
  setStatus(`${n} Datei(en) in die Ablage genommen.`);
}

/** Aus Sampler-Stock + hacktribe-2.patch die Hacktribe-Firmware erzeugen und ablegen — fuer Tests direkt aufrufbar. */
export async function fwHacktribeErzeugen(): Promise<{ ok: true; name: string } | { ok: false; reason: string }> {
  if (!ablage) await fwAblageLesen();
  const stock = ablage?.samplerStock && ablageDateien.find((d) => d.name === ablage?.samplerStock?.name);
  const patch = ablage?.patch && ablageDateien.find((d) => d.name === ablage?.patch?.name);
  if (!stock || !patch) {
    const r = { ok: false as const, reason: "Dafür braucht es die offizielle Sampler-Firmware v2.02 und hacktribe-2.patch in der Ablage." };
    setStatus(r.reason);
    return r;
  }
  setStatus("Hacktribe wird erzeugt (bspatch) …");
  const r = await hacktribeAusStock(stock.bytes, patch.bytes, sha256Hex, { stock: SAMPLER_STOCK_SHA256, patch: HACKTRIBE_PATCH_SHA256, ziel: HACKTRIBE_SHA256 });
  if (!r.ok) {
    setStatus(`Hacktribe nicht erzeugt: ${r.reason}`);
    return r;
  }
  const name = "hacktribe-2_SYSTEM.VSB";
  const zugang = firmwareAblageZugang();
  if (zugang.wo === "sitzung") sitzungsAblageAufnehmen({ name, groesse: r.bytes.length, sha256: HACKTRIBE_SHA256, bytes: r.bytes });
  else await zugang.ablegen(name, r.bytes, HACKTRIBE_SHA256);
  await fwAblageLesen();
  setStatus(`Hacktribe erzeugt und abgelegt (${name}, SHA-256 ${HACKTRIBE_SHA256.slice(0, 16)}… geprüft).`);
  return { ok: true, name };
}

/** Die gewaehlte Basis aus der Ablage nehmen — fuer Tests direkt aufrufbar. */
export async function fwBasisWaehlen(wahl: BasisWahl, eigeneName?: string): Promise<boolean> {
  if (!ablage) await fwAblageLesen();
  const st = ablage!;
  const m = basisMoeglich(st, wahl);
  if (!m.ok) {
    setStatus(`${BASIS_WAHL_LABEL[wahl]}: ${m.grund}`);
    return false;
  }
  let datei: AblageEintrag | undefined;
  if (wahl === "eigene") {
    const name = eigeneName ?? (document.getElementById("fwBasisEigene") as HTMLSelectElement | null)?.value;
    datei = ablageDateien.find((d) => d.name === name);
    if (!datei) {
      setStatus("Keine eigene Firmware in der Ablage gewählt — oder „Firmware laden…“ für eine Datei von anderswo.");
      return false;
    }
  } else if (wahl === "hacktribe") {
    if (!st.hacktribe) {
      const e = await fwHacktribeErzeugen();
      if (!e.ok) return false;
    }
    datei = ablageDateien.find((d) => d.name === ablage?.hacktribe?.name);
  } else {
    const rolle = wahl === "synth-stock" ? st.synthStock : st.samplerStock;
    datei = rolle && ablageDateien.find((d) => d.name === rolle.name);
  }
  if (!datei) {
    setStatus(`${BASIS_WAHL_LABEL[wahl]}: Datei nicht in der Ablage.`);
    return false;
  }
  return basisSetzen(datei.bytes, datei.name);
}

// ─── Analyse einer modifizierten Firmware ────────────────────────────────────

function analyseAnzeigen(): void {
  const bericht = document.getElementById("fwAnalyseBericht");
  const liste = document.getElementById("fwAnalyseListe");
  const inhalt = document.getElementById("fwInhaltListe");
  const info = document.getElementById("fwAnalyseInfo");
  if (!analyse) {
    if (bericht) bericht.textContent = "";
    if (liste) liste.innerHTML = "";
    if (inhalt) inhalt.innerHTML = "";
    if (info) info.textContent = "";
    return;
  }
  const a = analyse;
  if (bericht) bericht.textContent = [`${analyseName}`, ...a.zeilen].join("\n");
  const zielId: KartenId = karte.id;
  if (liste) {
    liste.innerHTML = a.erweiterungen.length
      ? a.erweiterungen
          .map((e) => {
            const u = e.nach[zielId];
            const an = analyseAuswahl.has(e.id);
            return `<label class="sub" style="margin:1px 0;display:flex;align-items:flex-start;gap:4px${u.ok ? "" : ";opacity:.55"}" title="${escapeHtml(u.ok ? (u.hinweis ?? "übertragbar in die Basis") : u.grund)}"><input type="checkbox" data-erw="${escapeHtml(e.id)}"${an ? " checked" : ""}${u.ok ? "" : " disabled"} /><span><b>${escapeHtml(e.name)}</b> <span style="opacity:.7">— ${escapeHtml(e.beschreibung)}${u.ok ? (u.hinweis ? ` · ${escapeHtml(u.hinweis)}` : "") : ` · ✗ ${escapeHtml(u.grund)}`}</span></span></label>`;
          })
          .join("")
      : `<div class="sub">${a.referenz ? "keine Erweiterungen gegenüber der Referenz" : "keine Referenz (Stock derselben Bauart) in der Ablage — nur der Inhalt wird gelistet"}</div>`;
  }
  if (inhalt) {
    const block = (titel: string, eintraege: { platz: number; name: string; info: string; leer: boolean }[]) =>
      eintraege.length
        ? `<details><summary style="cursor:pointer">${escapeHtml(titel)} (${eintraege.filter((e) => !e.leer).length})</summary><div style="max-height:160px;overflow:auto">${eintraege
            .filter((e) => !e.leer)
            .map((e) => `<div class="sub" style="margin:0"><span style="display:inline-block;min-width:34px">${e.platz}</span><b>${escapeHtml(e.name || "(ohne Namen)")}</b> <span style="opacity:.7">${escapeHtml(e.info)}</span></div>`)
            .join("")}</div></details>`
        : "";
    inhalt.innerHTML = [block("IFX", a.ifx), block("MFX", a.mfx), block("Grooves", a.grooves), block("Oszillatoren", a.osz), block("Modulations-Typen", a.mod)].join("");
  }
  if (info) {
    const uebertragbar = a.erweiterungen.filter((e) => e.nach[zielId].ok).length;
    info.textContent = `${analyseAuswahl.size} von ${uebertragbar} übertragbaren Erweiterungen gewählt (Ziel: ${basis ? karte.label : "keine Basis geladen"})`;
  }
}

/** Ein Abbild analysieren — Referenz: Stock derselben Bauart aus der Ablage (oder Hacktribe, wenn gewaehlt). Fuer Tests direkt aufrufbar. */
export function fwAnalysieren(bytes: Uint8Array, name: string, referenz: "stock" | "hacktribe" | "basis" = "stock"): FirmwareAnalyse | { ok: false; reason: string } {
  const e = erkenneKarte(bytes);
  const ref = e.ok ? (referenz === "basis" ? (basis ?? undefined) : referenzFuer(e.karte, referenz)) : undefined;
  const a = analysiereFirmware(bytes, ref);
  analyse = a.ok ? a : null;
  analyseName = a.ok ? `${name} — ${karteLabel(a.befund)}${ref ? "" : " (keine Referenz in der Ablage)"}` : name;
  analyseAuswahl.clear();
  if (a.ok) for (const x of a.erweiterungen) if (x.nach[karte.id].ok && x.art !== "code" && x.art !== "dsp") analyseAuswahl.add(x.id);
  analyseAnzeigen();
  setStatus(a.ok ? `${name} analysiert: ${a.erweiterungen.length} Erweiterung(en)${ref ? "" : " — für Erweiterungen die Stock-Firmware derselben Bauart in die Ablage legen"}.` : `Analyse nicht möglich: ${a.reason}`);
  return a;
}

/**
 * Eine Erweiterung an-/abwaehlen. Code- und DSP-Laeufe sind EIN Patchsatz —
 * halb angewandt waeren sie gefaehrlich (ein Sprung ins Nichts brickt) —
 * darum schalten sie nur gemeinsam.
 */
export function fwAnalyseWaehlen(id: string, an: boolean): void {
  const e = analyse?.erweiterungen.find((x) => x.id === id);
  const ids = e && (e.art === "code" || e.art === "dsp") ? analyse!.erweiterungen.filter((x) => (x.art === "code" || x.art === "dsp") && x.nach[karte.id].ok).map((x) => x.id) : [id];
  for (const i of ids) {
    if (an) analyseAuswahl.add(i);
    else analyseAuswahl.delete(i);
  }
  if (e && ids.length > 1) setStatus(`Code-/DSP-Läufe sind ein Patchsatz — ${ids.length} zusammen ${an ? "gewählt" : "abgewählt"}.`);
  analyseAnzeigen();
}

export function fwAnalyseAuswahl(): string[] {
  return [...analyseAuswahl];
}

/** Die gewaehlten Erweiterungen in die Basis legen — die Basis wird das Ergebnis. Fuer Tests direkt aufrufbar. */
export async function fwAnalyseUebernehmen(): Promise<{ ok: true; zeilen: string[] } | { ok: false; reason: string }> {
  if (!basis) return { ok: false, reason: "Erst eine Basis laden." };
  if (!analyse) return { ok: false, reason: "Erst eine Firmware analysieren." };
  const auswahl: Erweiterung[] = analyse.erweiterungen.filter((e) => analyseAuswahl.has(e.id));
  if (!auswahl.length) return { ok: false, reason: "Nichts ausgewählt." };
  const r = uebernehmeErweiterungen(basis, auswahl);
  if (!r.ok) {
    setStatus(`Nicht übernommen: ${r.reason}`);
    return r;
  }
  const zeilen = [...r.zeilen, ...r.uebersprungen.map((u) => `übersprungen ${u.id}: ${u.grund}`)];
  await basisSetzen(r.bytes, `${basisName} + ${auswahl.length - r.uebersprungen.length} Erweiterung(en)`);
  const el = document.getElementById("fwBericht");
  if (el) el.textContent = zeilen.join("\n");
  setStatus(`${auswahl.length - r.uebersprungen.length} Erweiterung(en) in die Basis übernommen${r.uebersprungen.length ? `, ${r.uebersprungen.length} übersprungen` : ""} — jetzt Ziel wählen und bauen.`);
  return { ok: true, zeilen };
}

function richteAblageEin(): void {
  if (!document.getElementById("fwAblageLesen")) return;
  document.getElementById("fwAblageLesen")?.addEventListener("click", () => void fwAblageLesen().then((st) => setStatus(st.fehlend.length ? `Ablage gelesen — es fehlt: ${st.fehlend.join("; ")}` : "Ablage gelesen — alles da.")));
  document.getElementById("fwAblageOeffnen")?.addEventListener("click", () => {
    const z = firmwareAblageZugang();
    if (z.oeffnen) void z.oeffnen();
    else setStatus("Im Browser gibt es keinen Ordner — Dateien über „Datei hinzufügen…“.");
  });
  dateiKnopfMehrere("fwAblageDatei", "fwAblageIn", (dateien) => sicher(ablageDateienAufnehmen(dateien)));
  document.getElementById("fwHacktribeErzeugen")?.addEventListener("click", () => sicher(fwHacktribeErzeugen()));
  document.getElementById("fwBasisUebernehmen")?.addEventListener("click", () => {
    const wahl = ((document.getElementById("fwBasisWahl") as HTMLSelectElement | null)?.value ?? "hacktribe") as BasisWahl;
    sicher(fwBasisWaehlen(wahl));
  });
  document.getElementById("fwBasisWahl")?.addEventListener("change", () => {
    const wahl = (document.getElementById("fwBasisWahl") as HTMLSelectElement).value as BasisWahl;
    const eig = document.getElementById("fwBasisEigene");
    eig?.classList.toggle("hidden", wahl !== "eigene");
    const m = ablage ? basisMoeglich(ablage, wahl) : { ok: true as const };
    setStatus(m.ok ? `${BASIS_WAHL_LABEL[wahl]} — „als Basis übernehmen“.` : `${BASIS_WAHL_LABEL[wahl]}: ${m.grund}`);
  });
  dateiKnopf("fwAnalyseLaden", "fwAnalyseIn", (f) => {
    void f.arrayBuffer().then((b) => {
      const ref = ((document.getElementById("fwAnalyseReferenz") as HTMLSelectElement | null)?.value ?? "stock") as "stock" | "hacktribe" | "basis";
      fwAnalysieren(new Uint8Array(b), f.name, ref);
    });
  });
  document.getElementById("fwAnalyseBasis")?.addEventListener("click", () => {
    if (!basis) {
      setStatus("Erst eine Basis laden.");
      return;
    }
    const ref = ((document.getElementById("fwAnalyseReferenz") as HTMLSelectElement | null)?.value ?? "stock") as "stock" | "hacktribe" | "basis";
    fwAnalysieren(basis, basisName, ref === "basis" ? "stock" : ref);
  });
  document.getElementById("fwAnalyseListe")?.addEventListener("change", (ev) => {
    const t = (ev as Event | undefined)?.target as HTMLInputElement | null | undefined;
    const id = t?.dataset?.erw;
    if (id) fwAnalyseWaehlen(id, t!.checked);
  });
  document.getElementById("fwAnalyseAlle")?.addEventListener("click", () => {
    if (!analyse) return;
    for (const e of analyse.erweiterungen) if (e.nach[karte.id].ok) analyseAuswahl.add(e.id);
    analyseAnzeigen();
  });
  document.getElementById("fwAnalyseKeine")?.addEventListener("click", () => {
    analyseAuswahl.clear();
    analyseAnzeigen();
  });
  document.getElementById("fwAnalyseUebernehmen")?.addEventListener("click", () => sicher(fwAnalyseUebernehmen()));
  document.getElementById("fwZielGeraet")?.addEventListener("change", zielInfo);
  document.getElementById("fwZielFirmware")?.addEventListener("change", zielInfo);
  void fwAblageLesen().catch(() => undefined);
}

// ─── Init ────────────────────────────────────────────────────────────────────

// ─── Crossgrade: Synth-Firmware fuer den Sampler vorbereiten ──────────────────
//
// Reine Byte-Operation ueber core/crossgrade.ts (am v2.02-Abbild disassembliert,
// Omnitribe docs/reverse/e2synth_auf_e2s_crossgrade_v202.md). Es wird keine
// Korg-Firmware mitgeliefert; der Nutzer laedt sie bei Korg und faehrt sie hier
// durch.

let xgDatei: { name: string; bytes: Uint8Array } | null = null;

function xgStatus(t: string): void {
  const el = document.getElementById("xgStatus");
  if (el) el.textContent = t;
}

async function xgLaden(f: File): Promise<void> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  const b = analysiere(bytes);
  const info = document.getElementById("xgInfo");
  const zuSampler = document.getElementById("xgZuSampler");
  const zuSynth = document.getElementById("xgZuSynth");
  const hash = await sha256Hex(bytes);
  const bekannt = hash ? BEKANNTE_HASHES[hash] : undefined;
  if (!b.ok || b.variante === "?") {
    xgDatei = null;
    if (info) info.textContent = `${f.name}: abgelehnt — ${b.grund}`;
    zuSampler?.classList.add("hidden");
    zuSynth?.classList.add("hidden");
    xgStatus(b.grund);
    return;
  }
  xgDatei = { name: f.name, bytes };
  if (info) info.textContent = `${f.name} — ${VARIANTEN[b.variante].label}${bekannt ? ` (${bekannt})` : ""}`;
  // Anbieten, was NICHT die aktuelle Variante ist.
  zuSampler?.classList.toggle("hidden", b.variante === "sampler");
  zuSynth?.classList.toggle("hidden", b.variante === "synth");
  xgStatus(`Geladen. ${b.variante === "synth" ? "Für Sampler-Hardware umköpfen." : "Für Synth-Hardware umköpfen."}`);
}

async function xgUmkoepfen(ziel: Variante): Promise<void> {
  if (!xgDatei) {
    xgStatus("Erst eine SYSTEM.VSB laden.");
    return;
  }
  let r;
  try {
    r = crossgrade(xgDatei.bytes, ziel);
  } catch (e) {
    xgStatus(e instanceof Error ? e.message : String(e));
    return;
  }
  const hash = await sha256Hex(r.bytes);
  const ab = await legeAb("SYSTEM.VSB", r.bytes, `Crossgrade-${ziel}`);
  xgStatus(
    `Umgeköpft ${r.vonVariante} → ${ziel} (Byte 0x12 und 0x2E)${hash ? `, SHA-256 ${hash.slice(0, 16)}…` : ""}` +
      (ab.pfad ? ` → ${ab.pfad}.` : " → Download.") +
      ` Installieren: als SYSTEM.VSB nach ${r.sdPfad} auf eine FAT32-SD-Karte, dann am Gerät DATA UTILITY → SOFTWARE UPDATE.` +
      " ⚠ Vorher die Werks-SYSTEM.VSB als Rückweg auf der SD behalten.",
  );
}

function richteCrossgradeEin(): void {
  if (!document.getElementById("xgPanel")) return;
  dateiKnopf("xgLaden", "xgIn", (f) => void xgLaden(f));
  document.getElementById("xgZuSampler")?.addEventListener("click", () => void xgUmkoepfen("sampler"));
  document.getElementById("xgZuSynth")?.addEventListener("click", () => void xgUmkoepfen("synth"));
}

export function initFirmwareWerkbank(h: WerkbankHooks): void {
  hooks = h;
  basis = null;
  basisBefund = null;
  grooves = [];
  initDatei = null;
  globalBlock = null;
  bildHell = null;
  invertiert = false;
  dspEigene = [];
  dspGewaehlt.clear();
  oszNeu = [];
  oszBasisAnzahl = 0;
  modNeu = [];
  modBasisAnzahl = 0;
  karte = KARTE_HACKTRIBE;
  analyse = null;
  analyseAuswahl.clear();
  ablage = null;
  ablageDateien = [];
  pixel = new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE);
  if (!document.getElementById("fwPanel")) return;
  dateiKnopf("fwBasisLaden", "fwBasisIn", (f) => void basisLaden(f));
  richteCrossgradeEin();
  richteAblageEin();
  dateiKnopf("fwGrooveLaden", "fwGrooveIn", (f) => void groovesLaden(f));
  dateiKnopf("fwInitLaden", "fwInitIn", (f) => void initLaden(f));
  for (const id of ["fwPresets", "fwGrooves", "fwInit", "fwSplash", "fwGlobal", "fwInitQuelle"]) $(id).addEventListener("change", vorschau);
  dateiKnopf("fwGlobalLaden", "fwGlobalIn", (f) => void globalAusDatei(f));
  $("fwGlobalGeraet").addEventListener("click", () => void globalVomGeraet());
  $("fwBauplanSichern").addEventListener("click", () => void bauplanSichern());
  dateiKnopf("fwBauplanLaden", "fwBauplanIn", (f) => void bauplanLaden(f));
  dateiKnopf("fwDspLaden", "fwDspIn", (f) => void dspLaden(f));
  $("fwOsz").addEventListener("change", vorschau);
  $("fwOszVorlage").addEventListener("change", oszVorlageHinweis);
  $("fwOszAnhaengen").addEventListener("click", oszFormularAnhaengen);
  $("fwOszSerie").addEventListener("click", () => {
    const r = fwOszFmSerie(Number(($("fwOszVorlage") as HTMLSelectElement).value));
    setStatus(r.ok ? `${r.anzahl} FM-Varianten vorgemerkt — die Halbtöne −${FM_HALBTON_MAX}…+${FM_HALBTON_MAX}, die für dieses Programm noch fehlten (Zwischenwerte geschätzt).` : r.reason);
  });
  $("fwOszLeeren").addEventListener("click", () => {
    oszNeu = [];
    oszListe();
    vorschau();
  });
  $("fwOszGeraet").addEventListener("click", () => void oszFluechtig());
  $("fwModKombis").addEventListener("click", () => {
    const r = fwModKombinationen();
    setStatus(r.ok ? `${r.anzahl} Modulations-Typen vorgemerkt (Platz ${modBasisAnzahl + 1}…${modBasisAnzahl + modNeu.length})${r.fehlend.length ? ` — ohne Vorlage: ${r.fehlend.join(", ")}` : ""}. ⚠ Ob das Menü sie zeigt, entscheidet der Versuch am Gerät.` : r.reason);
  });
  $("fwModLeeren").addEventListener("click", () => {
    modNeu = [];
    modListe();
    vorschau();
  });
  $("fwModGeraet").addEventListener("click", () => void modFluechtig());
  $("fwModListe").addEventListener("click", (ev) => {
    const t = (ev as Event | undefined)?.target as HTMLElement | null | undefined;
    const i = t?.dataset?.modWeg;
    if (i !== undefined) fwModEntfernen(Number(i));
  });
  $("fwOszListe").addEventListener("click", (ev) => {
    const t = (ev as Event | undefined)?.target as HTMLElement | null | undefined;
    const i = t?.dataset?.oszWeg;
    if (i !== undefined) fwOszEntfernen(Number(i));
  });
  $("fwDspListe").addEventListener("change", (ev) => {
    const t = (ev as Event | undefined)?.target as HTMLInputElement | null | undefined;
    const id = t?.dataset?.dsp;
    if (id) fwDspWaehlen(id, t!.checked);
  });
  dspListe();
  $("fwSichtbar").addEventListener("click", vorschau);
  $("fwBauen").addEventListener("click", () => void bauen());
  dateiKnopf("fwVergleichen", "fwVergleichIn", (f) => void vergleichen(f));
  $("fwGeraetVergleich").addEventListener("click", () => void fwGeraetVergleich());
  dateiKnopf("fwSicherungBrennen", "fwSicherungIn", (f) => void sicherungEinbrennen(f));

  // Pixel-Editor
  const canvas = document.getElementById("fwSplashCanvas") as HTMLCanvasElement | null;
  if (canvas && typeof canvas.addEventListener === "function") {
    let taste: 0 | 1 | null = null;
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("pointerdown", (e) => {
      taste = e.button === 2 ? 0 : 1;
      malen(canvas, e, taste);
      canvas.setPointerCapture?.(e.pointerId);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (taste !== null) malen(canvas, e, taste);
    });
    const loslassen = () => {
      taste = null;
    };
    canvas.addEventListener("pointerup", loslassen);
    canvas.addEventListener("pointercancel", loslassen);
  }
  dateiKnopf("fwSplashBild", "fwSplashBildIn", (f) => void bildLaden(f));
  $("fwSplashSchwelle").addEventListener("input", bildAnwenden);
  $("fwSplashInvert").addEventListener("click", () => {
    invertiert = !invertiert;
    if (bildHell) bildAnwenden();
    else {
      pixel = pixel.map((v) => (v ? 0 : 1));
      zeichne();
    }
  });
  $("fwSplashAusFw").addEventListener("click", () => {
    if (!basis) {
      setStatus("Erst eine Basis laden.");
      return;
    }
    if (karte.splash === undefined) {
      setStatus(`${karte.label}: die Lage des Startbilds ist nicht bekannt.`);
      return;
    }
    bildHell = null;
    fwSetzePixel(splashZuPixel(liesSplash(basis, karte)));
    setStatus("Startbild aus der Basis geholt.");
  });
  $("fwSplashLeer").addEventListener("click", () => {
    bildHell = null;
    fwSetzePixel(new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE));
  });
  $("fwSplashTextSetzen").addEventListener("click", () => {
    const text = ($("fwSplashText") as HTMLInputElement).value;
    const skala = Math.max(1, Math.min(3, Number(($("fwSplashSkala") as HTMLSelectElement).value) || 2));
    const rohY = (($("fwSplashTextY") as HTMLInputElement).value ?? "mitte").trim().toLowerCase();
    const zeile: number | "mitte" = rohY === "" || rohY === "mitte" ? "mitte" : Math.max(0, Math.min(SPLASH_HOEHE - 1, Math.round(Number(rohY)) || 0));
    fwTextSchreiben(text, skala, zeile);
  });
  $("fwSplashPbm").addEventListener("click", () => {
    download(pixelZuPbm(pixel), "startbild.pbm", "image/x-portable-bitmap");
    setStatus("Startbild als startbild.pbm gesichert.");
  });
  zeichne();
}

/** Fuer Tests: den Init-Pattern-Namen aus einem Abbild lesen. */
export function fwInitPatternName(fw: Uint8Array): string {
  const e = erkenneKarte(fw);
  const pat = liesInitPattern(fw, e.ok ? e.karte : KARTE_HACKTRIBE);
  let n = "";
  for (let i = 0; i < 16 && pat[0x110 + i]; i++) n += String.fromCharCode(pat[0x110 + i]);
  return escapeHtml(n.trim());
}

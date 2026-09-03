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
import { $, escapeHtml, frageText, download, sha256Hex, dateiKnopf } from "./shared";
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
  INIT_GLOBAL_GROESSE,
  firmwareAusSicherung,
  HACKTRIBE_SHA256,
  E2SPAT_GROESSE,
  type BasisBefund,
} from "../core/firmwareBau";
import { E2_RAM_MAP } from "../core/hacktribeRam";
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
import { liesModTabelle, modKombinationen, modName, decodeMod, setzeModTabelle, MOD_TABELLE_ADDR_HACKTRIBE, MOD_EINTRAG, MOD_WELLEN, MOD_ZIEL_NAMEN, type ModEintragMitPlatz } from "../core/modTabelle";

const FIRMWARE_ORDNER = "Firmware";
const SKALA = 4;

let basis: Uint8Array | null = null;
let basisName = "";
let basisBefund: BasisBefund | null = null;
let basisHash: string | null = null;
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

async function basisLaden(f: File): Promise<void> {
  const bytes = new Uint8Array(await f.arrayBuffer());
  const befund = pruefeBasis(bytes);
  if (!befund.ok) {
    basis = null;
    basisBefund = null;
    ($("fwBasisInfo") as HTMLElement).textContent = `${f.name}: abgelehnt — ${befund.reason}`;
    setStatus(`Basis abgelehnt: ${befund.reason}`);
    return;
  }
  basis = bytes;
  basisName = f.name;
  basisBefund = befund;
  basisHash = await sha256Hex(bytes);
  const herkunft = basisHash === HACKTRIBE_SHA256 ? "unveränderte Hacktribe-Firmware" : "nicht die Hacktribe-Datei, Struktur stimmig (schon gepatcht?)";
  ($("fwBasisInfo") as HTMLElement).textContent =
    `${f.name} — ${herkunft}; IFX-Menü bis ${befund.ifxMaxIndex + 1}, Grooves bis ${befund.grooveMaxIndex + 1}, Init-Pattern „${befund.initPatternName || "?"}“`;
  setStatus(`Basis geladen. Startbild mit „aus Firmware“ holen, Bausteine anhaken, bauen.`);
  const osz = leseOszStandAusFirmware(bytes);
  oszBasisAnzahl = osz.ok ? osz.anzahl : 0;
  oszNeu = [];
  oszListe();
  oszVorlagenFuellen();
  modNeu = [];
  modBasisAnzahl = basis ? liesModTabelle(basis).length : 0;
  modListe();
  const modInfo = document.getElementById("fwModInfo");
  if (modInfo) modInfo.textContent = basis ? (modBasisAnzahl ? `${modBasisAnzahl} in der Basis` : "keine Tabelle bei 0xC01A0000 — Stock-Firmware?") : "";
  oszVorlageHinweis();
  if (!osz.ok) ($("fwOszInfo") as HTMLElement).textContent = `Tabelle nicht lesbar: ${osz.reason}`;
  dspListe();
  vorschau();
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
    setStatus(`${f.name}: ${bytes.length} Bytes — eine .e2spat hat ${E2SPAT_GROESSE}.`);
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
  const map = E2_RAM_MAP.find((e) => e.key === "initGlobal")!;
  setStatus("Lese Global-Block aus dem Gerät …");
  const r = await hooks.lesen(map.base, map.size);
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
  if (info) info.textContent = basis ? `${oszBasisAnzahl} belegt, ${OSZ_MAX - oszBasisAnzahl} frei (275…${OSZ_MAX})` : "";
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
  setStatus(`${modNeu.length} Modulations-Typen flüchtig geschrieben (${modBasisAnzahl + 1}…${modBasisAnzahl + modNeu.length}). Am Gerät den Mod-Typ eines Parts über ${modBasisAnzahl} hinausdrehen — zeigt er „${modName(modNeu[0].bytes)}“? Gilt bis zum Ausschalten.`);
}

/** Fluechtig: Eintraege und Beschreiber ins Geraete-RAM — bis zum Ausschalten. */
async function oszFluechtig(): Promise<void> {
  if (!hooks?.schreiben || !hooks.lesen) {
    setStatus("Kein Geräte-Schreibweg (MIDI aus).");
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
  const zeilen: string[] = [`Basis: ${basisName} (IFX bis ${basisBefund.ifxMaxIndex + 1}, Grooves bis ${basisBefund.grooveMaxIndex + 1})`];
  let presets: SammlungsEintrag[] = [];
  if (an("fwPresets")) {
    const z = pmZustand();
    // Ohne geladenen Stand ist die leere Bank des Managers nur die Vorschau —
    // sie als Wunsch zu nehmen hiesse, alle 128 Plaetze der Firmware zu leeren.
    if (z && pmGeladen()) {
      presets = unterschiede(z, zustandAusFirmware(basis));
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
  const dsp = fwDspPatches().filter((p) => dspGewaehlt.has(p.id));
  if (dsp.length) zeilen.push(`DSP-Patches (⚠ experimentell): ${dsp.map((p) => p.titel).join(", ")}`);
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
    const r = baueFirmware(basis, eintraege);
    if (!r.ok) return { ok: false, reason: r.reason };
    bytes = r.bytes;
    if (r.bericht.zaehler.length) zeilen.push(`IFX-Menü: bis ${r.bericht.ifxMaxVorher + 1} → bis ${r.bericht.ifxMaxNachher + 1}`);
    if (r.bericht.grooveZaehler.length) zeilen.push(`Groove-Menü: bis ${r.bericht.grooveMaxVorher + 1} → bis ${r.bericht.grooveMaxNachher + 1}`);
  }
  try {
    if (plan.init) bytes = setzeInitPattern(bytes, plan.init.bytes);
    if (plan.global) bytes = setzeInitGlobal(bytes, plan.global.bytes);
    if (plan.splash) bytes = setzeSplash(bytes, pixelZuSplash(pixel));
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
    zeilen.push(`Modulations-Tabelle: bis ${r.anzahlVorher} → bis ${r.anzahlNachher}`);
  }
  if (!eintraege.length && !plan.init && !plan.global && !plan.splash && !plan.dsp.length && !plan.osz.length && !plan.mod.length) return { ok: false, reason: "Kein Baustein angehakt — es gäbe nichts zu bauen" };
  return { ok: true, bytes, zeilen };
}

async function bauen(): Promise<void> {
  const r = fwBaueAbbild();
  if (!r.ok) {
    setStatus(`Nicht gebaut: ${r.reason}`);
    return;
  }
  const hash = await sha256Hex(r.bytes);
  const name = (await frageText("Dateiname (im Ordner Firmware/):", "SYSTEM.VSB")) ?? "SYSTEM.VSB";
  const ab = await legeAb(name.trim() || "SYSTEM.VSB", r.bytes, FIRMWARE_ORDNER);
  const el = document.getElementById("fwBericht");
  // Nach dem Bau die Gegenprobe: was hat sich gegenueber der Basis wirklich geaendert?
  const gegenprobe = basis ? vergleicheFirmware(basis, r.bytes).zeilen.map((z) => `  ${z}`) : [];
  if (el) {
    el.textContent = [...r.zeilen, hash ? `Ergebnis SHA-256 ${hash}` : "", ab.pfad ? `→ ${ab.pfad}` : "→ Download", "Gegenprobe Basis ↔ Ergebnis:", ...gegenprobe]
      .filter(Boolean)
      .join("\n");
  }
  setStatus(
    `Firmware gebaut${ab.pfad ? ` → ${ab.pfad}` : " → Download"}. Installieren: als SYSTEM.VSB nach KORG/electribe sampler/System/ auf die SD-Karte, dann am Gerät die Update-Funktion.`,
  );
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
  const r = firmwareAusSicherung(basis, s.bloecke);
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
    const v = vergleicheFirmware(basis, andere);
    const el = document.getElementById("fwBericht");
    if (el) el.textContent = [`Vergleich: ${basisName} (links) ↔ ${f.name} (rechts)`, ...v.zeilen].join("\n");
    setStatus(v.gleich ? "Die beiden Dateien sind identisch." : `${v.unterschiede.length} Unterschied(e) in bekannten Bereichen, ${v.sonstigeBytes} Bytes außerhalb.`);
  } catch (e) {
    setStatus(`Vergleich nicht möglich: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function sicherungEinbrennen(f: File): Promise<void> {
  const r = fwBaueAusSicherung(await f.text());
  if (!r.ok) {
    setStatus(`Nicht gebaut: ${r.reason}`);
    return;
  }
  const hash = await sha256Hex(r.bytes);
  const name = (await frageText("Dateiname (im Ordner Firmware/):", "SYSTEM.VSB")) ?? "SYSTEM.VSB";
  const ab = await legeAb(name.trim() || "SYSTEM.VSB", r.bytes, FIRMWARE_ORDNER);
  const el = document.getElementById("fwBericht");
  // Nach dem Bau die Gegenprobe: was hat sich gegenueber der Basis wirklich geaendert?
  const gegenprobe = basis ? vergleicheFirmware(basis, r.bytes).zeilen.map((z) => `  ${z}`) : [];
  if (el) {
    el.textContent = [...r.zeilen, hash ? `Ergebnis SHA-256 ${hash}` : "", ab.pfad ? `→ ${ab.pfad}` : "→ Download", "Gegenprobe Basis ↔ Ergebnis:", ...gegenprobe]
      .filter(Boolean)
      .join("\n");
  }
  setStatus(`Gerätestand aus ${f.name} eingebrannt${ab.pfad ? ` → ${ab.pfad}` : " → Download"}. Installieren wie gehabt über die SD-Karte.`);
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

/** Einen nackten Init-Block als .e2spat verpacken — so, wie die Werkbank Dateien erwartet. */
function liesInitPatternAlsDatei(block: Uint8Array): Uint8Array {
  const out = new Uint8Array(E2SPAT_GROESSE);
  out.fill(0xff, 0x24, 0x100);
  out.set(new TextEncoder().encode("KORG"), 0);
  out.set(new TextEncoder().encode("e2sampler"), 0x10);
  out[0x20] = 1;
  out.set(block, 0x100);
  return out;
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

// ─── Init ────────────────────────────────────────────────────────────────────

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
  pixel = new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE);
  if (!document.getElementById("fwPanel")) return;
  dateiKnopf("fwBasisLaden", "fwBasisIn", (f) => void basisLaden(f));
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
    bildHell = null;
    fwSetzePixel(splashZuPixel(liesSplash(basis)));
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
  const pat = liesInitPattern(fw);
  let n = "";
  for (let i = 0; i < 16 && pat[0x110 + i]; i++) n += String.fromCharCode(pat[0x110 + i]);
  return escapeHtml(n.trim());
}

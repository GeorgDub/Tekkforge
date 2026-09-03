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
import { $, escapeHtml, frageText } from "./shared";
import { pmZustand, pmGeladen } from "./presetManager";

export interface WerkbankHooks {
  /** Das aktuelle Pattern des Editors als .e2spat — kommt von editor.ts, damit hier kein Import-Kreis entsteht. */
  aktuellesPattern(): { name: string; bytes: Uint8Array };
  /** RAM lesen (fuer den Init-Global-Block vom Geraet); fehlt ohne MIDI. */
  lesen?(addr: number, len: number): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; reason: string }>;
}
let hooks: WerkbankHooks | null = null;
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
  bildZuPixel,
  pixelZuPbm,
  pbmZuPixel,
} from "../core/splash";
import { legeAb } from "./ablage";

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
/** Das zuletzt geladene Bild (RGBA) — die Schwelle wirkt darauf, nicht auf das Gemalte. */
let bildRoh: { rgba: Uint8ClampedArray; breite: number; hoehe: number } | null = null;
let invertiert = false;

function setStatus(t: string): void {
  const el = document.getElementById("fwStatus");
  if (el) el.textContent = t;
}

async function sha256Hex(bytes: Uint8Array): Promise<string | null> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) return null;
  const d = await subtle.digest("SHA-256", bytes.slice().buffer as ArrayBuffer);
  return Array.from(new Uint8Array(d))
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
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
  if (!bildRoh) return;
  const schwelle = Number(($("fwSplashSchwelle") as HTMLInputElement).value) || 128;
  pixel = bildZuPixel(bildRoh.rgba, bildRoh.breite, bildRoh.hoehe, schwelle, invertiert);
  zeichne();
}

async function bildLaden(f: File): Promise<void> {
  try {
    if (/\.pbm$/i.test(f.name)) {
      fwSetzePixel(pbmZuPixel(new Uint8Array(await f.arrayBuffer())));
      bildRoh = null;
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
    bildRoh = { rgba: d.data, breite: bmp.width, hoehe: bmp.height };
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

// ─── Bauen ───────────────────────────────────────────────────────────────────

interface Bauplan {
  presets: SammlungsEintrag[];
  grooves: SammlungsEintrag[];
  init: { name: string; bytes: Uint8Array } | null;
  global: { name: string; bytes: Uint8Array } | null;
  splash: boolean;
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
  return { presets, grooves: gv, init, global, splash, zeilen };
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
  if (!eintraege.length && !plan.init && !plan.global && !plan.splash) return { ok: false, reason: "Kein Baustein angehakt — es gäbe nichts zu bauen" };
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
  if (el) el.textContent = [...r.zeilen, hash ? `Ergebnis SHA-256 ${hash}` : "", ab.pfad ? `→ ${ab.pfad}` : "→ Download"].filter(Boolean).join("\n");
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
  if (el) el.textContent = [...r.zeilen, hash ? `Ergebnis SHA-256 ${hash}` : "", ab.pfad ? `→ ${ab.pfad}` : "→ Download"].filter(Boolean).join("\n");
  setStatus(`Gerätestand aus ${f.name} eingebrannt${ab.pfad ? ` → ${ab.pfad}` : " → Download"}. Installieren wie gehabt über die SD-Karte.`);
}

// ─── Init ────────────────────────────────────────────────────────────────────

export function initFirmwareWerkbank(h: WerkbankHooks): void {
  hooks = h;
  basis = null;
  basisBefund = null;
  grooves = [];
  initDatei = null;
  globalBlock = null;
  bildRoh = null;
  invertiert = false;
  pixel = new Uint8Array(SPLASH_BREITE * SPLASH_HOEHE);
  if (!document.getElementById("fwPanel")) return;
  $("fwBasisLaden").addEventListener("click", () => ($("fwBasisIn") as HTMLInputElement).click());
  $("fwBasisIn").addEventListener("change", () => {
    const f = ($("fwBasisIn") as HTMLInputElement).files?.[0];
    if (f) void basisLaden(f);
  });
  $("fwGrooveLaden").addEventListener("click", () => ($("fwGrooveIn") as HTMLInputElement).click());
  $("fwGrooveIn").addEventListener("change", () => {
    const f = ($("fwGrooveIn") as HTMLInputElement).files?.[0];
    if (f) void groovesLaden(f);
  });
  $("fwInitLaden").addEventListener("click", () => ($("fwInitIn") as HTMLInputElement).click());
  $("fwInitIn").addEventListener("change", () => {
    const f = ($("fwInitIn") as HTMLInputElement).files?.[0];
    if (f) void initLaden(f);
  });
  for (const id of ["fwPresets", "fwGrooves", "fwInit", "fwSplash", "fwGlobal", "fwInitQuelle"]) $(id).addEventListener("change", vorschau);
  $("fwGlobalLaden").addEventListener("click", () => ($("fwGlobalIn") as HTMLInputElement).click());
  $("fwGlobalIn").addEventListener("change", () => {
    const f = ($("fwGlobalIn") as HTMLInputElement).files?.[0];
    if (f) void globalAusDatei(f);
  });
  $("fwGlobalGeraet").addEventListener("click", () => void globalVomGeraet());
  $("fwSichtbar").addEventListener("click", vorschau);
  $("fwBauen").addEventListener("click", () => void bauen());
  $("fwVergleichen").addEventListener("click", () => ($("fwVergleichIn") as HTMLInputElement).click());
  $("fwVergleichIn").addEventListener("change", () => {
    const f = ($("fwVergleichIn") as HTMLInputElement).files?.[0];
    if (f) void vergleichen(f);
  });
  $("fwSicherungBrennen").addEventListener("click", () => ($("fwSicherungIn") as HTMLInputElement).click());
  $("fwSicherungIn").addEventListener("change", () => {
    const f = ($("fwSicherungIn") as HTMLInputElement).files?.[0];
    if (f) void sicherungEinbrennen(f);
  });

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
  $("fwSplashBild").addEventListener("click", () => ($("fwSplashBildIn") as HTMLInputElement).click());
  $("fwSplashBildIn").addEventListener("change", () => {
    const f = ($("fwSplashBildIn") as HTMLInputElement).files?.[0];
    if (f) void bildLaden(f);
  });
  $("fwSplashSchwelle").addEventListener("input", bildAnwenden);
  $("fwSplashInvert").addEventListener("click", () => {
    invertiert = !invertiert;
    if (bildRoh) bildAnwenden();
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
    bildRoh = null;
    fwSetzePixel(splashZuPixel(liesSplash(basis)));
    setStatus("Startbild aus der Basis geholt.");
  });
  $("fwSplashLeer").addEventListener("click", () => {
    bildRoh = null;
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
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([pixelZuPbm(pixel).buffer as ArrayBuffer], { type: "image/x-portable-bitmap" }));
    a.download = "startbild.pbm";
    a.click();
    URL.revokeObjectURL(a.href);
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

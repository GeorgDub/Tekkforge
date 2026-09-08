/**
 * firmwareAnalyse — eine (modifizierte) SYSTEM.VSB aufschluesseln und ihre
 * Erweiterungen in ein anderes Abbild uebernehmen.
 *
 * Zwei Fragen beantwortet das Modul:
 *
 *  1. WAS STECKT DRIN? (`analysiereFirmware`) — Karte (Hacktribe / Sampler-
 *     Stock / Synth-Stock, auch umgekoepft), alle IFX-/MFX-Presets mit Namen
 *     und Algorithmus, Groove-Vorlagen, Oszillator- und Modulations-Tabelle,
 *     Init-Pattern, Init-Global, Startbild, DSP-Kette und bekannte DSP-Patches.
 *     Bei Stock-Karten laufen die Presets ueber die Zeigertabellen, bei
 *     Hacktribe ueber die flachen Baenke — die Liste sieht gleich aus.
 *
 *  2. WAS IST ERWEITERUNG? — gegen eine Referenz (das unveraenderte Abbild
 *     derselben Bauart, meist Stock) jeden abweichenden Byte-Lauf dem Bereich
 *     zuordnen, in dem er liegt: IFX-Platz 50, MFX-Platz 3, Groove 7, Init-
 *     Pattern, Startbild, Osz-Eintrag 275, Mod-Typ 97, DSP-Kette — und was
 *     ausserhalb liegt, ist „Code“ (Hacktribes eigene Patches, TekkForge-
 *     Grenzen im Code). Jede Erweiterung sagt fuer jede Zielkarte, ob sie
 *     dorthin uebernommen werden kann:
 *       - Presets: in jede Karte, solange es den Platz gibt (Stock: 38 IFX /
 *         32 MFX werden ERSETZT, Hacktribe: bis Platz 96 / 32, Menue waechst mit)
 *       - Grooves, Osz-Varianten, Mod-Typen: nur nach Hacktribe (Baenke/Tabellen)
 *       - Init-Pattern, Init-Global: in jede Karte; ueber die Variantengrenze
 *         mit Hinweis (Oszillator-Nummern gelten fuer die andere Variante)
 *       - Startbild: nur, wo die Lage bekannt ist (Sampler-Bauart)
 *       - DSP- und Code-Laeufe: nur in dieselbe Bauart, und nur dorthin, wo
 *         das Ziel noch die Referenz-Bytes traegt (Drei-Wege-Regel — sonst
 *         wuerde ein Patch auf fremden Code gelegt, und DAS brickt)
 *
 *  `uebernehmeErweiterungen` legt eine Auswahl davon auf ein Zielabbild und
 *  prueft danach, dass das Ergebnis noch als dieselbe Karte erkannt wird,
 *  die Zaehler stimmen und die DSP-Kette gueltig bleibt.
 */
import {
  erkenneKarte,
  dateiOffset,
  grooveOffset,
  leseZaehler,
  presetName,
  presetOffset,
  presetPlaetze,
  KARTEN,
  type FirmwareKarte,
  type KartenBefund,
  type KartenId,
} from "./firmwareKarte";
import { baueFirmware, setzeInitPattern, setzeInitGlobal, setzeSplash, INIT_PATTERN_GROESSE, INIT_GLOBAL_GROESSE, SPLASH_GROESSE, istGroovePlatzLeer } from "./firmwareBau";
import { decodeFxPreset, FX_PRESET_SIZE } from "./e2FxPreset";
import { decodeGroove, GROOVE_SIZE } from "./e2Groove";
import { istPresetPlatzLeer } from "./ifxErweiterung";
import { decodeOsz, istOszLeer, setzeOszTabelle, OSZ_EINTRAG, type OszEintragMitPlatz } from "./oszTabelle";
import { modName, istModLeer, setzeModTabelle, MOD_EINTRAG, type ModEintragMitPlatz } from "./modTabelle";
import { leseLdrKette, dspPatchStand } from "./dspPatch";
import { DSP_PATCH_REGISTER } from "./dspPatchRegister";
import { E2_GLOBAL_CHAIN_MODE_OFF, E2_GLOBAL_CLOCK_SOURCE_OFF } from "./e2sysex";
import { VSB_HEADER, VSB_TOTAL } from "./crossgrade";
import type { SammlungsEintrag } from "./sammlung";

export type ErweiterungsArt = "ifx" | "mfx" | "groove" | "initPattern" | "initGlobal" | "splash" | "osz" | "mod" | "dsp" | "code" | "zaehler";

export interface AnalyseEintrag {
  /** Platz wie am Geraet, ab 1. */
  platz: number;
  name: string;
  /** Algorithmus, Step-Zahl, Kategorie … */
  info: string;
  offset: number;
  bytes: Uint8Array;
  leer: boolean;
}

export type Uebertragbar = { ok: true; hinweis?: string } | { ok: false; grund: string };

export interface Erweiterung {
  id: string;
  art: ErweiterungsArt;
  platz?: number;
  name: string;
  beschreibung: string;
  offset: number;
  laenge: number;
  /** Die Bytes aus dem analysierten Abbild (Block bzw. Lauf). */
  bytes: Uint8Array;
  /** Die Bytes der Referenz an derselben Stelle (fuer die Drei-Wege-Regel). */
  referenz?: Uint8Array;
  nach: Record<KartenId, Uebertragbar>;
}

export interface FirmwareAnalyse {
  ok: true;
  befund: KartenBefund;
  karte: FirmwareKarte;
  ifx: AnalyseEintrag[];
  mfx: AnalyseEintrag[];
  grooves: AnalyseEintrag[];
  osz: AnalyseEintrag[];
  mod: AnalyseEintrag[];
  ifxMaxIndex: number;
  ifxZaehlerGrund?: string;
  grooveMaxIndex: number;
  initPatternName: string;
  initGlobal: { chain: number; clock: number };
  splash?: { dunkel: number };
  dsp?: { ok: boolean; bloecke: number; gepatcht: string[]; grund?: string };
  /** Nur mit Referenz derselben Bauart. */
  erweiterungen: Erweiterung[];
  referenz?: { karte: KartenId; gleicheBauart: boolean; diffBytes: number };
  zeilen: string[];
}

export type AnalyseErgebnis = FirmwareAnalyse | { ok: false; reason: string };

const ascii = (b: Uint8Array, off: number, len: number): string => {
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = b[off + i];
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
};

function presetInfo(block: Uint8Array, mfx: boolean): string {
  try {
    const p = decodeFxPreset(block, mfx);
    if (mfx) return p.mfx.algorithmus || "—";
    const zweiter = p.ifx2.device ? ` + ${p.ifx2.algorithmus}` : "";
    return (p.ifx1.algorithmus || (p.ifx1.device === 0 ? "Thru" : "?")) + zweiter;
  } catch {
    return "?";
  }
}

function presetListe(bytes: Uint8Array, karte: FirmwareKarte, art: "ifx" | "mfx"): AnalyseEintrag[] {
  const out: AnalyseEintrag[] = [];
  const n = presetPlaetze(karte, art);
  for (let s = 0; s < n; s++) {
    const off = presetOffset(karte, bytes, art, s);
    if (off === null || off + FX_PRESET_SIZE > bytes.length) {
      out.push({ platz: s + 1, name: "", info: "(kein Zeiger)", offset: -1, bytes: new Uint8Array(0), leer: true });
      continue;
    }
    const block = bytes.subarray(off, off + FX_PRESET_SIZE);
    const leer = istPresetPlatzLeer(block);
    out.push({ platz: s + 1, name: presetName(block), info: leer ? "" : presetInfo(block, art === "mfx"), offset: off, bytes: block, leer });
  }
  return out;
}

function grooveListe(bytes: Uint8Array, karte: FirmwareKarte): AnalyseEintrag[] {
  const out: AnalyseEintrag[] = [];
  const bank = karte.grooveBank;
  if (!bank) return out;
  for (let s = 0; s < bank.count; s++) {
    const off = grooveOffset(karte, s)!;
    const block = bytes.subarray(off, off + GROOVE_SIZE);
    const leer = istGroovePlatzLeer(block);
    let name = "";
    let info = "";
    if (!leer) {
      try {
        const g = decodeGroove(block);
        name = g.name;
        info = `${g.laenge} Steps`;
      } catch {
        info = "(unlesbar)";
      }
    }
    out.push({ platz: s + 1, name, info, offset: off, bytes: block, leer });
  }
  return out;
}

function oszListe(bytes: Uint8Array, karte: FirmwareKarte): AnalyseEintrag[] {
  const out: AnalyseEintrag[] = [];
  const t = karte.oszTabelle;
  if (!t) return out;
  for (let i = 0; i < t.count; i++) {
    const off = dateiOffset(t.base) + i * t.stride;
    const e = bytes.subarray(off, off + OSZ_EINTRAG);
    if (istOszLeer(e)) break;
    let name = "";
    let info = "";
    try {
      const o = decodeOsz(e);
      name = o.name;
      info = `Kategorie ${o.kategorie}, Programm ${o.programm}`;
    } catch {
      info = "(unlesbar)";
    }
    out.push({ platz: i + 1, name, info, offset: off, bytes: e, leer: false });
  }
  return out;
}

function modListe(bytes: Uint8Array, karte: FirmwareKarte): AnalyseEintrag[] {
  const out: AnalyseEintrag[] = [];
  const t = karte.modTabelle;
  if (!t) return out;
  for (let i = 0; i < t.count; i++) {
    const off = dateiOffset(t.base) + i * t.stride;
    if (off + MOD_EINTRAG > bytes.length) break;
    const e = bytes.subarray(off, off + MOD_EINTRAG);
    if (istModLeer(e)) break;
    out.push({ platz: i + 1, name: modName(e), info: "", offset: off, bytes: e, leer: false });
  }
  return out;
}

// ─── Bereiche und Laeufe ─────────────────────────────────────────────────────

interface Bereich {
  von: number;
  bis: number; // exklusiv
  art: ErweiterungsArt;
  platz?: number;
}

/** Alle bekannten Bereiche einer Karte im Abbild — Presets ueber die Bytes aufgeloest. */
export function bekannteBereiche(bytes: Uint8Array, karte: FirmwareKarte): Bereich[] {
  const b: Bereich[] = [];
  for (const art of ["ifx", "mfx"] as const) {
    for (let s = 0; s < presetPlaetze(karte, art); s++) {
      const off = presetOffset(karte, bytes, art, s);
      if (off !== null) b.push({ von: off, bis: off + FX_PRESET_SIZE, art, platz: s + 1 });
    }
  }
  if (karte.grooveBank) for (let s = 0; s < karte.grooveBank.count; s++) b.push({ von: grooveOffset(karte, s)!, bis: grooveOffset(karte, s)! + GROOVE_SIZE, art: "groove", platz: s + 1 });
  b.push({ von: dateiOffset(karte.initPattern), bis: dateiOffset(karte.initPattern) + INIT_PATTERN_GROESSE, art: "initPattern" });
  b.push({ von: dateiOffset(karte.initGlobal), bis: dateiOffset(karte.initGlobal) + INIT_GLOBAL_GROESSE, art: "initGlobal" });
  if (karte.splash !== undefined) b.push({ von: dateiOffset(karte.splash), bis: dateiOffset(karte.splash) + SPLASH_GROESSE, art: "splash" });
  if (karte.oszTabelle) {
    const t = karte.oszTabelle;
    for (let i = 0; i < t.count; i++) b.push({ von: dateiOffset(t.base) + i * t.stride, bis: dateiOffset(t.base) + (i + 1) * t.stride, art: "osz", platz: i + 1 });
  }
  if (karte.modTabelle) {
    const t = karte.modTabelle;
    for (let i = 0; i < t.count; i++) b.push({ von: dateiOffset(t.base) + i * t.stride, bis: dateiOffset(t.base) + (i + 1) * t.stride, art: "mod", platz: i + 1 });
  }
  for (const z of karte.ifxZaehler) b.push({ von: dateiOffset(z.addr), bis: dateiOffset(z.addr) + 1, art: "zaehler" });
  for (const z of karte.grooveZaehler ?? []) b.push({ von: dateiOffset(z.addr), bis: dateiOffset(z.addr) + 1, art: "zaehler" });
  if (karte.ldrStart !== undefined) {
    const k = leseLdrKette(bytes, karte.ldrStart);
    const ende = k.ok ? k.ende : karte.ldrStart;
    if (ende > karte.ldrStart) b.push({ von: karte.ldrStart, bis: ende, art: "dsp" });
  }
  return b;
}

export interface Lauf {
  von: number;
  bis: number; // exklusiv
}

/** Abweichende Byte-Laeufe zweier gleich langer Abbilder ab dem Payload; Luecken bis `luecke` Bytes verschmolzen. */
export function unterschiedsLaeufe(a: Uint8Array, b: Uint8Array, luecke = 16, ab = VSB_HEADER): Lauf[] {
  const out: Lauf[] = [];
  const n = Math.min(a.length, b.length);
  let i = ab;
  while (i < n) {
    if (a[i] === b[i]) {
      i++;
      continue;
    }
    const von = i;
    let letzter = i;
    i++;
    while (i < n) {
      if (a[i] !== b[i]) {
        letzter = i;
        i++;
      } else if (i - letzter <= luecke) {
        i++;
      } else break;
    }
    out.push({ von, bis: letzter + 1 });
  }
  return out;
}

const hex = (n: number): string => `0x${n.toString(16).toUpperCase()}`;

/** Regeln, wohin eine Erweiterung darf. */
function uebertragbarkeit(art: ErweiterungsArt, quelle: FirmwareKarte, platz: number | undefined): Record<KartenId, Uebertragbar> {
  const out = {} as Record<KartenId, Uebertragbar>;
  for (const id of Object.keys(KARTEN) as KartenId[]) {
    const ziel = KARTEN[id];
    const gleicheBauart = ziel.familie === quelle.familie;
    let u: Uebertragbar;
    switch (art) {
      case "ifx":
      case "mfx": {
        const max = art === "ifx" ? ziel.ifxSchreibMax : ziel.mfxSchreibMax;
        if (platz === undefined || platz - 1 > max) u = { ok: false, grund: `${ziel.label} hat nur ${max + 1} ${art.toUpperCase()}-Plätze` };
        else if (!ziel.ifxErweiterbar) u = { ok: true, hinweis: `ersetzt Werks-${art.toUpperCase()} ${platz}` };
        else u = { ok: true };
        break;
      }
      case "groove":
        u = ziel.grooveBank ? { ok: true } : { ok: false, grund: `${ziel.label} hat keine Groove-Bank` };
        break;
      case "initPattern":
        u = gleicheBauart ? { ok: true } : { ok: true, hinweis: "andere Variante: Oszillator-/Sample-Nummern im Pattern gelten dort anders — am Gerät prüfen" };
        break;
      case "initGlobal":
        u = gleicheBauart ? { ok: true } : { ok: true, hinweis: "andere Variante: Global-Block wird 1:1 übernommen — am Gerät prüfen" };
        break;
      case "splash":
        u = ziel.splash !== undefined ? { ok: true } : { ok: false, grund: `${ziel.label}: Lage des Startbilds unbekannt` };
        break;
      case "osz":
        u = ziel.oszTabelle?.erweiterbar && gleicheBauart ? { ok: true, hinweis: "wird hinten angehängt" } : { ok: false, grund: `${ziel.label}: Oszillator-Tabelle nicht erweiterbar` };
        break;
      case "mod":
        u = ziel.modTabelle?.erweiterbar && gleicheBauart ? { ok: true, hinweis: "wird hinten angehängt" } : { ok: false, grund: `${ziel.label}: Modulations-Tabelle nicht erweiterbar` };
        break;
      case "dsp":
      case "code":
        u = gleicheBauart ? { ok: true, hinweis: "nur wenn das Ziel dort noch die Referenz-Bytes trägt" } : { ok: false, grund: "Code und DSP-Abbild sind je Variante anders — nicht übertragbar" };
        break;
      default:
        u = { ok: false, grund: "Zähler werden beim Bau neu berechnet" };
    }
    out[id] = u;
  }
  return out;
}

// ─── Analyse ─────────────────────────────────────────────────────────────────

/**
 * Ein Abbild aufschluesseln; mit `referenz` (Abbild derselben Bauart, meist
 * Stock) zusaetzlich die Erweiterungen bestimmen.
 */
export function analysiereFirmware(bytes: Uint8Array, referenz?: Uint8Array): AnalyseErgebnis {
  const e = erkenneKarte(bytes);
  if (!e.ok) return e;
  const karte = e.karte;
  const zeilen: string[] = [];
  const ifx = presetListe(bytes, karte, "ifx");
  const mfx = presetListe(bytes, karte, "mfx");
  const grooves = grooveListe(bytes, karte);
  const osz = oszListe(bytes, karte);
  const mod = modListe(bytes, karte);
  const z = leseZaehler(bytes, karte.ifxZaehler);
  const gz = karte.grooveZaehler ? leseZaehler(bytes, karte.grooveZaehler) : null;
  const initOff = dateiOffset(karte.initPattern);
  const initPatternName = ascii(bytes, initOff + 0x10, 16).trim();
  const gl = dateiOffset(karte.initGlobal);
  const initGlobal = { chain: bytes[gl + E2_GLOBAL_CHAIN_MODE_OFF], clock: bytes[gl + E2_GLOBAL_CLOCK_SOURCE_OFF] };
  let splash: FirmwareAnalyse["splash"];
  if (karte.splash !== undefined) {
    let dunkel = 0;
    const so = dateiOffset(karte.splash);
    for (let i = 0; i < SPLASH_GROESSE; i++) {
      let v = bytes[so + i];
      while (v) {
        dunkel += v & 1;
        v >>= 1;
      }
    }
    splash = { dunkel };
  }
  let dsp: FirmwareAnalyse["dsp"];
  if (karte.ldrStart !== undefined) {
    const k = leseLdrKette(bytes, karte.ldrStart);
    const gepatcht = karte.familie === "sampler" ? DSP_PATCH_REGISTER.filter((p) => dspPatchStand(bytes, p) === "gepatcht").map((p) => p.titel) : [];
    dsp = k.ok ? { ok: true, bloecke: k.bloecke.length, gepatcht } : { ok: false, bloecke: k.bloecke.length, gepatcht, grund: k.reason };
  }

  zeilen.push(`Karte: ${karte.label}${e.umgekoepft ? ` — Kopf umgeköpft auf ${e.kopfVariante}` : ""}`);
  const belegt = (l: AnalyseEintrag[]) => l.filter((x) => !x.leer).length;
  zeilen.push(`IFX: ${belegt(ifx)} belegt von ${ifx.length}${z.ok ? `, Menü bis ${z.maxIndex + 1}` : ` — Zähler: ${z.reason}`}`);
  zeilen.push(`MFX: ${belegt(mfx)} belegt von ${mfx.length}`);
  if (karte.grooveBank) zeilen.push(`Grooves: ${belegt(grooves)} von ${grooves.length}${gz?.ok ? `, Menü bis ${gz.maxIndex + 1}` : ""}`);
  else zeilen.push("Grooves: keine Bank (Stock)");
  if (karte.oszTabelle) zeilen.push(`Oszillatoren: ${osz.length} Einträge${karte.oszTabelle.erweiterbar ? ` (frei bis ${karte.oszTabelle.count})` : ""}`);
  if (karte.modTabelle) zeilen.push(`Modulations-Typen: ${mod.length}`);
  zeilen.push(`Init-Pattern „${initPatternName || "?"}“, Init-Global Chain ${initGlobal.chain}, Clock ${initGlobal.clock}`);
  if (splash) zeilen.push(`Startbild: ${splash.dunkel} dunkle Pixel`);
  if (dsp) zeilen.push(dsp.ok ? `DSP-Kette: ${dsp.bloecke} Blöcke${dsp.gepatcht.length ? `, gepatcht: ${dsp.gepatcht.join(", ")}` : ""}` : `DSP-Kette ungültig: ${dsp.grund}`);

  const analyse: FirmwareAnalyse = {
    ok: true,
    befund: e,
    karte,
    ifx,
    mfx,
    grooves,
    osz,
    mod,
    ifxMaxIndex: z.ok ? z.maxIndex : -1,
    ifxZaehlerGrund: z.ok ? undefined : z.reason,
    grooveMaxIndex: gz?.ok ? gz.maxIndex : -1,
    initPatternName,
    initGlobal,
    splash,
    dsp,
    erweiterungen: [],
    zeilen,
  };

  if (referenz) {
    const r = erkenneKarte(referenz);
    if (!r.ok) zeilen.push(`Referenz unbrauchbar: ${r.reason}`);
    else if (r.karte.familie !== karte.familie) {
      analyse.referenz = { karte: r.karte.id, gleicheBauart: false, diffBytes: -1 };
      zeilen.push(`Referenz ${r.karte.label} hat eine andere Bauart — Erweiterungen lassen sich nur gegen dieselbe Bauart bestimmen`);
    } else {
      const laeufe = unterschiedsLaeufe(bytes, referenz);
      const diffBytes = laeufe.reduce((a, l) => a + (l.bis - l.von), 0);
      analyse.referenz = { karte: r.karte.id, gleicheBauart: true, diffBytes };
      analyse.erweiterungen = erweiterungenAus(bytes, referenz, karte, r.karte, laeufe);
      const n = analyse.erweiterungen.length;
      const je = (art: ErweiterungsArt) => analyse.erweiterungen.filter((x) => x.art === art).length;
      zeilen.push(
        `Gegenüber ${r.karte.label}: ${laeufe.length} Byte-Läufe (${diffBytes} Bytes) → ${n} Erweiterung(en): ${je("ifx")} IFX, ${je("mfx")} MFX, ${je("groove")} Grooves, ${je("osz")} Osz, ${je("mod")} Mod, ${je("initPattern") + je("initGlobal") + je("splash")} Init/Startbild, ${je("dsp")} DSP, ${je("code")} Code`,
      );
    }
  }
  return analyse;
}

function erweiterungenAus(bytes: Uint8Array, referenz: Uint8Array, karte: FirmwareKarte, refKarte: FirmwareKarte, laeufe: Lauf[]): Erweiterung[] {
  const out: Erweiterung[] = [];
  // Maske: 1 = platzweise verglichen (Baenke, Tabellen, Init, Zaehler), 2 = DSP-Kette
  const maske = new Uint8Array(bytes.length);
  const decke = (von: number, bis: number, wert = 1) => maske.fill(wert, Math.max(0, von), Math.min(bytes.length, bis));
  const anders = (a: Uint8Array, b: Uint8Array): number => {
    let n = 0;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
    return n;
  };
  const platzweise = (
    art: ErweiterungsArt,
    platz: number,
    block: Uint8Array,
    ref: Uint8Array | null,
    leer: (b: Uint8Array) => boolean,
    name: string,
    info: string,
  ): void => {
    if (leer(block)) return;
    if (ref && ref.length === block.length && anders(block, ref) === 0) return;
    const neu = !ref || leer(ref);
    out.push({
      id: `${art}:${platz}`,
      art,
      platz,
      name: `${art.toUpperCase()} ${platz}: ${name || "(ohne Namen)"}`,
      beschreibung: `${neu ? "neu" : "geändert"}${info ? `, ${info}` : ""}${ref && !neu ? ` (${anders(block, ref)} Bytes anders)` : ""}`,
      offset: -1,
      laenge: block.length,
      bytes: block,
      referenz: ref ?? undefined,
      nach: uebertragbarkeit(art, karte, platz),
    });
  };

  // Presets: Platz fuer Platz, jeweils ueber die eigene Karte aufgeloest —
  // so vergleicht sich Hacktribes Bank-Slot 3 mit Stocks gezeigtem Block 3,
  // obwohl beide an ganz anderen Stellen liegen.
  for (const art of ["ifx", "mfx"] as const) {
    for (let s = 0; s < presetPlaetze(karte, art); s++) {
      const off = presetOffset(karte, bytes, art, s);
      if (off === null) continue;
      decke(off, off + FX_PRESET_SIZE);
      const block = bytes.subarray(off, off + FX_PRESET_SIZE);
      const refOff = presetOffset(refKarte, referenz, art, s);
      const ref = refOff === null ? null : referenz.subarray(refOff, refOff + FX_PRESET_SIZE);
      platzweise(art, s + 1, block, ref, istPresetPlatzLeer, presetName(block), istPresetPlatzLeer(block) ? "" : presetInfo(block, art === "mfx"));
    }
  }
  if (karte.grooveBank) {
    for (let s = 0; s < karte.grooveBank.count; s++) {
      const off = grooveOffset(karte, s)!;
      decke(off, off + GROOVE_SIZE);
      const block = bytes.subarray(off, off + GROOVE_SIZE);
      const refOff = grooveOffset(refKarte, s);
      const ref = refOff === null ? null : referenz.subarray(refOff, refOff + GROOVE_SIZE);
      let name = "";
      let info = "";
      if (!istGroovePlatzLeer(block)) {
        try {
          const g = decodeGroove(block);
          name = g.name;
          info = `${g.laenge} Steps`;
        } catch {
          info = "(unlesbar)";
        }
      }
      platzweise("groove", s + 1, block, ref, istGroovePlatzLeer, name, info);
    }
  }
  if (karte.oszTabelle) {
    const t = karte.oszTabelle;
    const rt = refKarte.oszTabelle;
    decke(dateiOffset(t.base), dateiOffset(t.base) + t.count * t.stride);
    for (let i = 0; i < t.count; i++) {
      const off = dateiOffset(t.base) + i * t.stride;
      const e = bytes.subarray(off, off + OSZ_EINTRAG);
      if (istOszLeer(e)) break;
      const ref = rt && i < rt.count ? referenz.subarray(dateiOffset(rt.base) + i * rt.stride, dateiOffset(rt.base) + i * rt.stride + OSZ_EINTRAG) : null;
      let name = "";
      try {
        name = decodeOsz(e).name;
      } catch {
        name = "?";
      }
      platzweise("osz", i + 1, e, ref, istOszLeer, name, "");
    }
  }
  if (karte.modTabelle) {
    const t = karte.modTabelle;
    const rt = refKarte.modTabelle;
    decke(dateiOffset(t.base), dateiOffset(t.base) + t.count * t.stride);
    for (let i = 0; i < t.count; i++) {
      const off = dateiOffset(t.base) + i * t.stride;
      if (off + MOD_EINTRAG > bytes.length) break;
      const e = bytes.subarray(off, off + MOD_EINTRAG);
      if (istModLeer(e)) break;
      const ref = rt && i < rt.count ? referenz.subarray(dateiOffset(rt.base) + i * rt.stride, dateiOffset(rt.base) + i * rt.stride + MOD_EINTRAG) : null;
      platzweise("mod", i + 1, e, ref, istModLeer, modName(e), "");
    }
  }
  // Init-Bloecke und Startbild: ein Block, ein Vergleich
  const blockVergleich = (art: "initPattern" | "initGlobal" | "splash", von: number, refVon: number | null, laenge: number, name: string) => {
    decke(von, von + laenge);
    const block = bytes.subarray(von, von + laenge);
    const ref = refVon === null ? null : referenz.subarray(refVon, refVon + laenge);
    if (ref && anders(block, ref) === 0) return;
    out.push({
      id: `${art}:0`,
      art,
      name,
      beschreibung: `${ref ? `${anders(block, ref)} Bytes anders` : "Referenz hat diesen Bereich nicht"}`,
      offset: von,
      laenge,
      bytes: block,
      referenz: ref ?? undefined,
      nach: uebertragbarkeit(art, karte, undefined),
    });
  };
  blockVergleich("initPattern", dateiOffset(karte.initPattern), dateiOffset(refKarte.initPattern), INIT_PATTERN_GROESSE, `Init-Pattern „${ascii(bytes, dateiOffset(karte.initPattern) + 0x10, 16).trim()}“`);
  blockVergleich("initGlobal", dateiOffset(karte.initGlobal), dateiOffset(refKarte.initGlobal), INIT_GLOBAL_GROESSE, "Init-Global");
  if (karte.splash !== undefined) blockVergleich("splash", dateiOffset(karte.splash), refKarte.splash !== undefined ? dateiOffset(refKarte.splash) : null, SPLASH_GROESSE, "Startbild");
  for (const z of karte.ifxZaehler) decke(dateiOffset(z.addr), dateiOffset(z.addr) + 1);
  for (const z of karte.grooveZaehler ?? []) decke(dateiOffset(z.addr), dateiOffset(z.addr) + 1);
  if (karte.ldrStart !== undefined) {
    const k = leseLdrKette(bytes, karte.ldrStart);
    if (k.ok) decke(karte.ldrStart, k.ende, 2);
  }
  // Der Rest: Laeufe an der Maske zerschneiden — 0 = Code, 2 = DSP, 1 = schon erledigt
  for (const l of laeufe) {
    let pos = l.von;
    while (pos < l.bis) {
      const wert = maske[pos];
      let ende = pos;
      while (ende < l.bis && maske[ende] === wert) ende++;
      if (wert === 0 || wert === 2) {
        // Ein verschmolzener Lauf traegt Luecken gleicher Bytes — am Stueck nur das, was wirklich abweicht.
        let von = pos;
        while (von < ende && bytes[von] === referenz[von]) von++;
        let bis = ende;
        while (bis > von && bytes[bis - 1] === referenz[bis - 1]) bis--;
        if (von < bis) {
          const art: ErweiterungsArt = wert === 2 ? "dsp" : "code";
          out.push({
            id: `${art}:${hex(von)}`,
            art,
            name: art === "dsp" ? `DSP-Änderung @ ${hex(von)}` : `Code/Daten @ ${hex(von)}`,
            beschreibung: art === "dsp" ? `${bis - von} Bytes in der BF523-Kette` : `${bis - von} Bytes außerhalb der bekannten Bereiche`,
            offset: von,
            laenge: bis - von,
            bytes: bytes.subarray(von, bis),
            referenz: referenz.subarray(von, bis),
            nach: uebertragbarkeit(art, karte, undefined),
          });
        }
      }
      pos = ende;
    }
  }
  return out;
}

// ─── Uebernahme ──────────────────────────────────────────────────────────────

export interface UebernahmeErgebnis {
  ok: true;
  bytes: Uint8Array;
  zeilen: string[];
  uebersprungen: { id: string; grund: string }[];
}

const gleich = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Eine Auswahl von Erweiterungen auf ein Zielabbild legen. Presets und
 * Grooves gehen ueber `baueFirmware` (Zaehler, Luecken), Init-Bloecke und
 * Startbild ueber die Setzer, Osz-/Mod-Eintraege werden hinten angehaengt,
 * DSP-/Code-Laeufe nur bei erfuellter Drei-Wege-Regel kopiert. Was nicht
 * geht, landet mit Grund in `uebersprungen` — nie halb.
 */
export function uebernehmeErweiterungen(ziel: Uint8Array, auswahl: readonly Erweiterung[]): UebernahmeErgebnis | { ok: false; reason: string } {
  const zk = erkenneKarte(ziel);
  if (!zk.ok) return { ok: false, reason: `Ziel: ${zk.reason}` };
  const karte = zk.karte;
  const zeilen: string[] = [];
  const uebersprungen: { id: string; grund: string }[] = [];
  let out: Uint8Array = ziel.slice();

  const presets: SammlungsEintrag[] = [];
  for (const e of auswahl) {
    const u = e.nach[karte.id];
    if (!u.ok) {
      uebersprungen.push({ id: e.id, grund: u.grund });
      continue;
    }
    if (e.art === "ifx" || e.art === "mfx" || e.art === "groove") {
      presets.push({ art: e.art, platz: e.platz, name: e.name, bytes: e.bytes.slice() });
    }
  }
  if (presets.length) {
    const r = baueFirmware(out, presets, karte);
    if (!r.ok) return { ok: false, reason: `Presets/Grooves: ${r.reason}` };
    out = r.bytes;
    zeilen.push(`${r.bericht.geschrieben.length} Preset-/Groove-Platz/Plätze übernommen${r.bericht.zaehler.length ? `, IFX-Menü bis ${r.bericht.ifxMaxNachher + 1}` : ""}${r.bericht.grooveZaehler.length ? `, Grooves bis ${r.bericht.grooveMaxNachher + 1}` : ""}`);
  }

  try {
    for (const e of auswahl) {
      if (!e.nach[karte.id].ok) continue;
      if (e.art === "initPattern") {
        out = setzeInitPattern(out, e.bytes, karte);
        zeilen.push(`${e.name} übernommen${(e.nach[karte.id] as { hinweis?: string }).hinweis ? " ⚠ (andere Variante — am Gerät prüfen)" : ""}`);
      } else if (e.art === "initGlobal") {
        out = setzeInitGlobal(out, e.bytes, karte);
        zeilen.push("Init-Global übernommen");
      } else if (e.art === "splash") {
        out = setzeSplash(out, e.bytes, karte);
        zeilen.push("Startbild übernommen");
      }
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  // Osz/Mod: ein Eintrag, dessen Platz im Ziel schon belegt ist („geändert“),
  // wird an Ort und Stelle ersetzt; alles andere wird hinten angehaengt.
  const oszAlle = auswahl.filter((e) => e.art === "osz" && e.nach[karte.id].ok);
  if (oszAlle.length) {
    const vorhanden = oszListe(out, karte).length;
    const ersetzt = oszAlle.filter((e) => (e.platz ?? 0) >= 1 && (e.platz ?? 0) <= vorhanden);
    const neu = oszAlle.filter((e) => !ersetzt.includes(e));
    const eintraege: OszEintragMitPlatz[] = [...ersetzt.map((e) => ({ platz: e.platz!, bytes: e.bytes.slice() })), ...neu.map((e, i) => ({ platz: vorhanden + 1 + i, bytes: e.bytes.slice() }))];
    const r = setzeOszTabelle(out, eintraege);
    if (!r.ok) return { ok: false, reason: `Oszillatoren: ${r.reason}` };
    out = r.bytes;
    zeilen.push(`Oszillatoren: ${ersetzt.length} ersetzt, ${neu.length} angehängt (Liste bis ${r.anzahlNachher})`);
  }
  const modAlle = auswahl.filter((e) => e.art === "mod" && e.nach[karte.id].ok);
  if (modAlle.length) {
    const t = karte.modTabelle!;
    const vorhanden = modListe(out, karte).length;
    const ersetzt = modAlle.filter((e) => (e.platz ?? 0) >= 1 && (e.platz ?? 0) <= vorhanden);
    const neu = modAlle.filter((e) => !ersetzt.includes(e));
    for (const e of ersetzt) {
      if (e.bytes.length !== MOD_EINTRAG || istModLeer(e.bytes)) return { ok: false, reason: `Modulations-Typ ${e.platz}: kein gültiger Eintrag` };
      out.set(e.bytes, dateiOffset(t.base) + (e.platz! - 1) * t.stride);
    }
    if (neu.length) {
      const eintraege: ModEintragMitPlatz[] = neu.map((e, i) => ({ platz: vorhanden + i, bytes: e.bytes.slice() }));
      const r = setzeModTabelle(out, eintraege, t.base);
      if (!r.ok) return { ok: false, reason: `Modulations-Typen: ${r.reason}` };
      out = r.bytes;
      zeilen.push(`Modulations-Typen: ${ersetzt.length} ersetzt, ${neu.length} angehängt (bis ${r.anzahlNachher})`);
    } else zeilen.push(`Modulations-Typen: ${ersetzt.length} ersetzt`);
  }

  let roh = 0;
  for (const e of auswahl) {
    if ((e.art !== "dsp" && e.art !== "code") || !e.nach[karte.id].ok) continue;
    if (!e.referenz || !gleich(out.subarray(e.offset, e.offset + e.laenge), e.referenz)) {
      uebersprungen.push({ id: e.id, grund: "das Ziel trägt an dieser Stelle nicht mehr die Referenz-Bytes" });
      continue;
    }
    out.set(e.bytes, e.offset);
    roh++;
  }
  if (roh) zeilen.push(`${roh} DSP-/Code-Lauf/-Läufe kopiert (Drei-Wege-Regel erfüllt)`);

  // Gegenprobe: noch dieselbe Karte, Zaehler stimmig, DSP-Kette gueltig?
  const nach = erkenneKarte(out);
  if (!nach.ok || nach.karte.id !== karte.id) return { ok: false, reason: "Nach der Übernahme wird das Abbild nicht mehr als dieselbe Karte erkannt — verworfen" };
  const z = leseZaehler(out, karte.ifxZaehler);
  if (!z.ok) return { ok: false, reason: `Nach der Übernahme: IFX-${z.reason} — verworfen` };
  if (karte.ldrStart !== undefined) {
    const k = leseLdrKette(out, karte.ldrStart);
    if (!k.ok) return { ok: false, reason: `Nach der Übernahme ist die DSP-Kette ungültig (${k.reason}) — verworfen` };
  }
  if (!zeilen.length && !uebersprungen.length) zeilen.push("nichts ausgewählt");
  return { ok: true, bytes: out, zeilen, uebersprungen };
}

export const VSB_GROESSE_ANALYSE = VSB_TOTAL;

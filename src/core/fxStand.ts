/**
 * fxStand — die Live-FX-Werte (Hacktribe-NRPN) eines Patterns, die das
 * Geraet selbst nicht speichert.
 *
 * Befund am Geraet (Nutzer, 2026-09-06): Wer per MIDImix die FX-Parameter
 * eines Insert-Effekts verstellt (`setFxParam`, hacktribeNrpn.ts) und dann
 * am Geraet „Write“ drueckt, hat nach dem naechsten Patternwechsel wieder die
 * Werte des Presets. Die NRPN-Werte landen im FX-Edit-Buffer des Slots, nicht
 * im Pattern — das Pattern kennt nur die Preset-NUMMER (`ifxType`) und den
 * Stand des IFX-Reglers (`ifxEdit`, Stock-CC 87). Beim Laden eines Patterns
 * zieht die Firmware das Preset frisch in den Slot, und die Live-Werte sind
 * weg.
 *
 * Darum merkt sich TekkForge diese Werte JE PATTERN im Projekt (`fxStand`
 * am EditorPattern) und schickt sie beim Patternwechsel selbst nach — sobald
 * das Geraet den Wechsel meldet (Program Change) oder TekkForge ihn ausloest.
 * Wer die Werte dauerhaft will, patcht sie ueber `fxStandInPreset` in das
 * Preset des Parts und brennt das in die Firmware (Preset-Manager / Werkbank).
 *
 * Ein Eintrag zeigt auf einen FX-Slot (Part 1..16 mit IFX-Slot 0/1, oder den
 * Master-Effekt mit `part: 0`) und einen Parameter-Index, so wie
 * `buildSetFxParam` ihn braucht. Der Parameter-Index zaehlt in den Struct des
 * gerade geladenen Algorithmus — anders als der Name, der je Algorithmus
 * verschieden ist. Wechselt das Preset des Parts, kann derselbe Index also
 * etwas anderes bedeuten; das ist am Geraet genauso.
 */
import { buildSetFxParam, fxSlotForPart, MFX_SLOT } from "./hacktribeNrpn";
import { decodeFxPreset, encodeFxPreset } from "./e2FxPreset";

export interface FxStandEintrag {
  /** 1..16 = Part, 0 = Master-Effekt. */
  part: number;
  /** 0 = IFX 1, 1 = IFX 2 — beim Master ohne Bedeutung (0). */
  slot: 0 | 1;
  /** Parameter-Index im FX-Struct, 0..127. */
  param: number;
  /** 0..127. */
  wert: number;
}

/** Ziel eines Reglers — dieselben Formen wie `ReglerZiel` in midimixLayout. */
export type FxStandZiel = { part: number; slot: 0 | 1; param: number } | { mfx: true; param: number };

const b7 = (v: number): number => Math.max(0, Math.min(127, Math.round(Number.isFinite(v) ? v : 0)));

function zielTeile(ziel: FxStandZiel): { part: number; slot: 0 | 1; param: number } {
  if ("mfx" in ziel) return { part: 0, slot: 0, param: b7(ziel.param) };
  return { part: Math.max(1, Math.min(16, Math.round(ziel.part))), slot: ziel.slot === 1 ? 1 : 0, param: b7(ziel.param) };
}

/** Passt ein Eintrag auf ein Ziel? */
export function trifftZiel(e: FxStandEintrag, ziel: FxStandZiel): boolean {
  const z = zielTeile(ziel);
  return e.part === z.part && (z.part === 0 || e.slot === z.slot) && e.param === z.param;
}

/**
 * Einen Wert merken — liefert eine NEUE Liste; ein vorhandener Eintrag fuer
 * dasselbe Ziel wird ersetzt, sonst kommt einer dazu (sortiert nach Part,
 * Slot, Param, damit die Liste im Projekt stabil bleibt).
 */
export function setzeFxWert(liste: readonly FxStandEintrag[] | undefined, ziel: FxStandZiel, wert: number): FxStandEintrag[] {
  const z = zielTeile(ziel);
  const neu: FxStandEintrag = { ...z, wert: b7(wert) };
  const out = (liste ?? []).filter((e) => !trifftZiel(e, ziel));
  out.push(neu);
  out.sort((a, b) => a.part - b.part || a.slot - b.slot || a.param - b.param);
  return out;
}

/** Den gemerkten Wert eines Ziels lesen, undefined wenn keiner da ist. */
export function fxWert(liste: readonly FxStandEintrag[] | undefined, ziel: FxStandZiel): number | undefined {
  return liste?.find((e) => trifftZiel(e, ziel))?.wert;
}

/** Einen Eintrag wieder entfernen (neue Liste). */
export function loescheFxWert(liste: readonly FxStandEintrag[] | undefined, ziel: FxStandZiel): FxStandEintrag[] {
  return (liste ?? []).filter((e) => !trifftZiel(e, ziel));
}

/**
 * Alle gemerkten Werte als NRPN-Nachrichten (je Eintrag vier CCs) — das ist,
 * was beim Patternwechsel ans Geraet geht. Reihenfolge wie die Liste.
 */
export function fxStandNachrichten(liste: readonly FxStandEintrag[] | undefined, globalKanal0: number): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (const e of liste ?? []) {
    const slot = e.part === 0 ? MFX_SLOT : fxSlotForPart(e.part, e.slot);
    for (const t of buildSetFxParam(globalKanal0, slot, e.param, e.wert)) out.push(Uint8Array.from(t));
  }
  return out;
}

/** Kurztext fuer Status und Tooltip: „P1 IFX1 #0=90 · MFX #2=40“. */
export function fxStandBeschreibung(liste: readonly FxStandEintrag[] | undefined): string {
  if (!liste?.length) return "";
  return liste.map((e) => (e.part === 0 ? `MFX #${e.param}=${e.wert}` : `P${e.part} IFX${e.slot + 1} #${e.param}=${e.wert}`)).join(" · ");
}

/**
 * Aus Unbekanntem (Projekt-JSON) eine saubere Liste machen — Unbrauchbares
 * faellt weg, statt das Laden des Projekts zu stoppen.
 */
export function fxStandNormalisieren(roh: unknown): FxStandEintrag[] {
  if (!Array.isArray(roh)) return [];
  let out: FxStandEintrag[] = [];
  for (const x of roh) {
    if (!x || typeof x !== "object") continue;
    const o = x as Record<string, unknown>;
    const part = Number(o.part);
    const param = Number(o.param);
    const wert = Number(o.wert);
    if (!Number.isInteger(part) || part < 0 || part > 16) continue;
    if (!Number.isInteger(param) || param < 0 || param > 127) continue;
    if (!Number.isFinite(wert)) continue;
    const slot: 0 | 1 = Number(o.slot) === 1 ? 1 : 0;
    out = setzeFxWert(out, part === 0 ? { mfx: true, param } : { part, slot, param }, wert);
  }
  return out;
}

/**
 * Die gemerkten Werte EINES Parts in dessen Preset-Block schreiben: IFX-1-
 * Werte in die Parameter der ersten Stufe, IFX-2-Werte in die zweite. Der
 * Rest des Blocks bleibt byte-treu (encodeFxPreset ueber die Unterlage).
 * Indizes hinter der Parameterliste des Algorithmus werden ausgelassen und
 * gemeldet — sie zeigen auf nichts, das es in diesem Preset gibt.
 */
export function fxStandInPreset(
  presetBytes: Uint8Array,
  liste: readonly FxStandEintrag[] | undefined,
  part: number,
): { bytes: Uint8Array; gesetzt: number; ausgelassen: FxStandEintrag[] } {
  const p = decodeFxPreset(presetBytes, false);
  let gesetzt = 0;
  const ausgelassen: FxStandEintrag[] = [];
  for (const e of liste ?? []) {
    if (e.part !== part) continue;
    const stufe = e.slot === 1 ? p.ifx2 : p.ifx1;
    if (e.param >= stufe.params.length) {
      ausgelassen.push(e);
      continue;
    }
    stufe.params[e.param] = b7(e.wert);
    gesetzt++;
  }
  return { bytes: encodeFxPreset(p, presetBytes), gesetzt, ausgelassen };
}

/** Parts (1..16), fuer die Werte gemerkt sind — ohne den Master. */
export function partsMitFxStand(liste: readonly FxStandEintrag[] | undefined): number[] {
  return [...new Set((liste ?? []).map((e) => e.part).filter((p) => p > 0))].sort((a, b) => a - b);
}

/**
 * partParams.ts — EXPERIMENTELLE Part-Klangparameter (Filter/Amp/IFX/Mod…).
 *
 * Offsets gem. elecmidi-C-Struct + Briefing §4.1 (2026-07-19 per Histogramm
 * über die e2s-2016-Factory-Bank abgeglichen: 0x18=ampLevel, 0x19=ampPan
 * signed, 0x1A=EGOnOff 0/1, 0x14=EGAttack ~0 — Layout konsistent).
 * ⚠ Einzelne Wertebereiche sind weiterhin nicht am Gerät verifiziert.
 *
 * AUSGENOMMEN (fest verdrahtet in e2sExport): Sample @0x08–09 (u16),
 * Mute @0x01, Volume @0x18, Pan @0x19 (signed).
 *
 * Weil der rohe Original-Body erhalten bleibt (EditorPattern.rawBody), ändert
 * das Schreiben eines Parameters nur genau sein Byte — am Gerät gefahrlos
 * testbar, welche Offsets stimmen.
 */

export const PART_PARAMS_STRIDE = 0x330;
export const PART_PARAMS_BASE = 0x800;

export type ParamKind = "u8" | "bool";

export interface PartParam {
  key: string;
  label: string;
  /** Offset relativ zum Part-Start (0x00). */
  offset: number;
  min: number;
  max: number;
  kind: ParamKind;
  group: "Filter" | "Amp/EG" | "Mod" | "IFX" | "Groove" | "Osc";
}

/**
 * Experimenteller Parametersatz. Offsets gem. Format-Doku, konfliktfreie
 * Auswahl (verifizierte Vol/Pan/Sample-Bytes ausgelassen).
 */
export const PART_PARAMS: PartParam[] = [
  { key: "filterType", label: "Filter-Typ", offset: 0x0c, min: 0, max: 7, kind: "u8", group: "Filter" },
  { key: "cutoff", label: "Cutoff", offset: 0x0d, min: 0, max: 127, kind: "u8", group: "Filter" },
  { key: "resonance", label: "Resonanz", offset: 0x0e, min: 0, max: 127, kind: "u8", group: "Filter" },
  { key: "egInt", label: "EG-Int", offset: 0x0f, min: 0, max: 127, kind: "u8", group: "Filter" },
  { key: "modType", label: "Mod-Typ", offset: 0x10, min: 0, max: 15, kind: "u8", group: "Mod" },
  { key: "modSpeed", label: "Mod-Speed", offset: 0x11, min: 0, max: 127, kind: "u8", group: "Mod" },
  { key: "modDepth", label: "Mod-Depth", offset: 0x12, min: 0, max: 127, kind: "u8", group: "Mod" },
  { key: "egAttack", label: "Amp Attack", offset: 0x14, min: 0, max: 127, kind: "u8", group: "Amp/EG" },
  { key: "egDecay", label: "Amp Decay", offset: 0x15, min: 0, max: 127, kind: "u8", group: "Amp/EG" },
  { key: "ampEgOn", label: "Amp-EG an", offset: 0x1a, min: 0, max: 1, kind: "bool", group: "Amp/EG" },
  { key: "mfxSend", label: "MFX-Send", offset: 0x1b, min: 0, max: 127, kind: "u8", group: "Amp/EG" },
  { key: "grooveType", label: "Groove-Typ", offset: 0x1c, min: 0, max: 15, kind: "u8", group: "Groove" },
  { key: "grooveDepth", label: "Groove-Depth", offset: 0x1d, min: 0, max: 127, kind: "u8", group: "Groove" },
  { key: "ifxOn", label: "IFX an", offset: 0x20, min: 0, max: 1, kind: "bool", group: "IFX" },
  { key: "ifxType", label: "IFX-Typ", offset: 0x21, min: 0, max: 63, kind: "u8", group: "IFX" },
  { key: "ifxEdit", label: "IFX-Edit", offset: 0x22, min: 0, max: 127, kind: "u8", group: "IFX" },
  { key: "oscPitch", label: "Pitch (roh)", offset: 0x24, min: 0, max: 127, kind: "u8", group: "Osc" },
  { key: "oscGlide", label: "Glide", offset: 0x25, min: 0, max: 127, kind: "u8", group: "Osc" },
];

const BY_KEY = new Map(PART_PARAMS.map((p) => [p.key, p]));

/**
 * Clampt eine USER-Eingabe auf den (experimentellen) Anzeigebereich des
 * Parameters. NUR für UI-Eingaben — Import/Export arbeiten roh (byte-genau),
 * damit Original-Werte (auch außerhalb des vermuteten Bereichs) erhalten
 * bleiben und nicht durch ein falsches Range-Raten zerstört werden.
 */
export function clampParamValue(key: string, v: number): number {
  const p = BY_KEY.get(key);
  if (!p) return Math.min(255, Math.max(0, Math.round(v) || 0));
  if (!Number.isFinite(v)) return p.min;
  return Math.min(p.max, Math.max(p.min, Math.round(v)));
}

/**
 * Liest alle Parameter-Bytes eines Parts ROH (0..255) aus einem 0x4000-Body.
 * Kein Clampen → Import→Export ist byte-identisch (Preservation).
 */
export function readPartParamsFromBody(
  body: Uint8Array,
  partIndex: number,
): Record<string, number> {
  const start = PART_PARAMS_BASE + partIndex * PART_PARAMS_STRIDE;
  const out: Record<string, number> = {};
  for (const p of PART_PARAMS) {
    const off = start + p.offset;
    if (off < body.length) out[p.key] = body[off];
  }
  return out;
}

/**
 * Schreibt gesetzte Parameter eines Parts BYTE-GENAU (& 0xFF) in einen
 * 0x4000-Body. Roh geschriebene Import-Werte bleiben so identisch; User-Edits
 * sollten vorab via clampParamValue() auf den Anzeigebereich begrenzt werden.
 */
export function writePartParamsToBody(
  body: Uint8Array,
  partIndex: number,
  params: Record<string, number> | undefined,
): void {
  if (!params) return;
  const start = PART_PARAMS_BASE + partIndex * PART_PARAMS_STRIDE;
  for (const key of Object.keys(params)) {
    const p = BY_KEY.get(key);
    if (!p) continue;
    const off = start + p.offset;
    if (off < body.length && Number.isFinite(params[key])) body[off] = params[key] & 0xff;
  }
}

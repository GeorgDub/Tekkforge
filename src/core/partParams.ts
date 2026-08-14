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

/**
 * `i8` = vorzeichenbehaftetes Byte. Gemessen an der KORG-Werksbank
 * `e2s-2016.e2sallpat`: manche Felder sind bipolar und laufen ueber 127 hinaus
 * (z.B. oscPitch bis 253 = -3). Als `u8` gelesen sind das Unsinnswerte.
 */
export type ParamKind = "u8" | "i8" | "bool";

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
 * Parametersatz — Bereiche gegen die **KORG-Werksbank** geprueft.
 *
 * Quelle: `e2s-2016.e2sallpat`, direkt von der offiziellen Korg-Seite, also
 * weder von Hacktribe noch von einem Editor erzeugt. Ausgewertet ueber alle
 * 250 Patterns x 16 Parts = 4000 Parts.
 *
 * Die Beweisrichtung: was in einer Werksbank steht, ist per Definition ein
 * gueltiger Wert. Fuenf Felder haben ihren frueher angenommenen Bereich dabei
 * verletzt — die Annahme war zu eng, nicht die Datei:
 *
 * | Feld        | vorher   | gemessen        | Deutung                      |
 * |-------------|----------|-----------------|------------------------------|
 * | oscPitch    | 0..127   | -63..+63 (i8)   | bipolar, exakt symmetrisch   |
 * | egInt       | 0..127   | -49..+63 (i8)   | bipolar (EG-Intensitaet)     |
 * | filterType  | 0..7     | {0, 1, 7, 12}   | nur 4 Werte, Bereich zu eng  |
 * | modType     | 0..15    | 0..71           | Bereich zu eng               |
 * | grooveType  | 0..15    | 0..23           | Bereich zu eng               |
 *
 * ☠ **Die Werksbank liefert eine UNTERgrenze, keine Obergrenze.** Sie beweist,
 * dass die vorkommenden Werte gueltig sind — nicht, dass es keine hoeheren
 * gibt. Das ist hier nicht theoretisch: **Hacktribe erweitert die Filterliste**
 * (Delta-Doku: Patches an „sampling/filters/osc enable"), und TekkForge
 * spricht ausdruecklich auch mit Hacktribe-Geraeten. Ein Clamp auf den
 * Stock-Bereich wuerde genau die zusaetzlichen Typen abschneiden.
 *
 * Deshalb sind die enum-artigen Felder, die Hacktribe nachweislich anfasst,
 * bewusst auf den vollen Bytebereich geoeffnet; der Stock-Umfang steht als
 * Kommentar daneben. Geklemmt wird nur, was sicher eine Wertebereichsgrenze
 * ist (die bipolaren Felder).
 *
 * Die Offsets selbst bleiben unbestaetigt — die Messung zeigt, dass die dort
 * stehenden Bytes plausible, strukturierte Werte tragen, aber nicht, dass die
 * Zuordnung Feld -> Offset stimmt. `filterType` mit nur vier Werten (0/1/7/12)
 * sieht z.B. enum-artig aus, passt aber zu keiner sauberen 0..n-Nummerierung;
 * moeglich, dass dort etwas anderes steht.
 *
 * Wichtig: die Bereiche wirken NUR beim Klemmen von UI-Eingaben
 * (`clampParamValue`). Import und Export arbeiten roh, damit Geraetewerte
 * ausserhalb des vermuteten Bereichs erhalten bleiben.
 */
export const PART_PARAMS: PartParam[] = [
  { key: "filterType", label: "Filter-Typ", offset: 0x0c, min: 0, max: 255, kind: "u8", group: "Filter" }, // Stock nutzt {0,1,7,12}; Hacktribe ergaenzt Filter -> offen
  { key: "cutoff", label: "Cutoff", offset: 0x0d, min: 0, max: 127, kind: "u8", group: "Filter" },
  { key: "resonance", label: "Resonanz", offset: 0x0e, min: 0, max: 127, kind: "u8", group: "Filter" },
  { key: "egInt", label: "EG-Int", offset: 0x0f, min: -63, max: 63, kind: "i8", group: "Filter" }, // bipolar, Stock -49..+63
  { key: "modType", label: "Mod-Typ", offset: 0x10, min: 0, max: 255, kind: "u8", group: "Mod" }, // Stock bis 71; Obergrenze unbekannt
  { key: "modSpeed", label: "Mod-Speed", offset: 0x11, min: 0, max: 127, kind: "u8", group: "Mod" },
  { key: "modDepth", label: "Mod-Depth", offset: 0x12, min: 0, max: 127, kind: "u8", group: "Mod" },
  { key: "egAttack", label: "Amp Attack", offset: 0x14, min: 0, max: 127, kind: "u8", group: "Amp/EG" },
  { key: "egDecay", label: "Amp Decay", offset: 0x15, min: 0, max: 127, kind: "u8", group: "Amp/EG" },
  { key: "ampEgOn", label: "Amp-EG an", offset: 0x1a, min: 0, max: 1, kind: "bool", group: "Amp/EG" },
  { key: "mfxSend", label: "MFX-Send", offset: 0x1b, min: 0, max: 127, kind: "u8", group: "Amp/EG" },
  { key: "grooveType", label: "Groove-Typ", offset: 0x1c, min: 0, max: 255, kind: "u8", group: "Groove" }, // Stock bis 23; Obergrenze unbekannt
  { key: "grooveDepth", label: "Groove-Depth", offset: 0x1d, min: 0, max: 127, kind: "u8", group: "Groove" },
  { key: "ifxOn", label: "IFX an", offset: 0x20, min: 0, max: 1, kind: "bool", group: "IFX" },
  { key: "ifxType", label: "IFX-Typ", offset: 0x21, min: 0, max: 255, kind: "u8", group: "IFX" }, // Stock bis 37; Hacktribe-FX-Liste laenger
  { key: "ifxEdit", label: "IFX-Edit", offset: 0x22, min: 0, max: 127, kind: "u8", group: "IFX" },
  { key: "oscPitch", label: "Pitch", offset: 0x24, min: -63, max: 63, kind: "i8", group: "Osc" }, // bipolar, exakt +-63
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
 * Liest die Parameter-Bytes eines Parts aus einem 0x4000-Body.
 *
 * Kein Clampen — Import→Export bleibt byte-identisch. `i8`-Felder werden als
 * Vorzeichenwert herausgegeben (253 → -3); beim Schreiben macht `& 0xff`
 * daraus wieder dasselbe Byte, der Round-Trip ist also weiterhin exakt.
 */
export function readPartParamsFromBody(
  body: Uint8Array,
  partIndex: number,
): Record<string, number> {
  const start = PART_PARAMS_BASE + partIndex * PART_PARAMS_STRIDE;
  const out: Record<string, number> = {};
  for (const p of PART_PARAMS) {
    const off = start + p.offset;
    if (off >= body.length) continue;
    const raw = body[off];
    // i8-Felder als Vorzeichenwert herausgeben — sonst erscheint ein Pitch von
    // -3 als 253 und wird beim Klemmen auf 63 verbogen. Gemessen an der
    // KORG-Werksbank (siehe Kopfkommentar).
    out[p.key] = p.kind === "i8" && raw > 127 ? raw - 256 : raw;
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
    // `& 0xff` macht aus -3 wieder 253 — Zweierkomplement, passt fuer i8 wie u8.
    if (off < body.length && Number.isFinite(params[key])) body[off] = params[key] & 0xff;
  }
}

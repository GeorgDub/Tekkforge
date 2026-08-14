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
 * ## Drei Offsets sind am Geraet BESTAETIGT (2026-08-14)
 *
 * Der Nutzer hat ein Testpattern gebaut: auf jedem Part ein anderer Filter, auf
 * jedem Part ein anderes IFX, und IFX abwechselnd an/aus. Der PTST-Block wurde
 * live aus dem Geraete-RAM gelesen (`0xC06B279C` + 0x800, 16 x 816 B) und
 * spaltenweise ueber die Parts ausgewertet:
 *
 * | Offset | Feld       | Beobachtung ueber die 16 Parts              |
 * |--------|------------|---------------------------------------------|
 * | `0x0C` | filterType | 16 verschiedene Werte (1..16)               |
 * | `0x0D` | cutoff     | Rampe `0 10 20 … 100 105 … 120 127`         |
 * | `0x0E` | resonance  | aufsteigende Rampe                          |
 * | `0x0F` | egInt      | absteigend `+63 … 0 … -63` — **signed**     |
 * | `0x20` | ifxOn      | `0 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0` — alterniert |
 * | `0x21` | ifxType    | 16 verschiedene, absteigend 48..34          |
 *
 * Das alternierende Bit bei `0x20` ist der staerkste Einzelbeleg: ein solches
 * Muster entsteht nicht zufaellig, es war die Vorgabe des Testpatterns.
 *
 * ### Cutoff: einzige aufsteigende Spalte
 *
 * Testpattern mit aufsteigendem Cutoff ueber die 16 Parts. `0x0D` las
 * `0 10 20 30 40 50 60 70 80 90 100 105 110 115 120 127` — und war die
 * **einzige streng aufsteigende Spalte** im gesamten 816-B-Part-Block. Kein
 * zweiter Kandidat, also keine Verwechslungsmoeglichkeit.
 *
 * ### Resonanz und EG-Int in einem Durchgang
 *
 * Zwei Parameter gleichzeitig, mit gegenlaeufigen Mustern — die stoeren sich
 * nicht, weil die Suche nach auf- und absteigend getrennt laeuft:
 *
 *     0x0E  0 10 19 30 40 50 60 70 [0] 80 90 100 110 120 127 125   (aufsteigend)
 *     0x0F  63 53 43 33 23 13 3 0 -3 -13 -23 -33 -43 -53 -63 -60   (absteigend)
 *
 * Unter den noch nicht zugeordneten Spalten gab es je genau einen Kandidaten.
 *
 * `0x0F` ist der wichtigere Fund: die Rampe laeuft ins NEGATIVE. Damit ist die
 * bipolare Deutung, die oben nur aus der Werksbank erschlossen war, am Geraet
 * unabhaengig bestaetigt — als `u8` gelesen stuenden dort 253, 243, 233 …
 *
 * (Die Ausreisser — Resonanz 0 bei Part 9, Endwerte 125/-60 — stammen aus dem
 * Testpattern selbst und tun der Zuordnung nichts.)
 *
 * ### Gegenprobe mit Vorhersage
 *
 * Der Nutzer hat das Muster anschliessend auf `1 0 1 0 …` ab Part 1 umgestellt
 * (vorher begann es mit `0 0 1 …`). Die Vorhersage stand VOR der Messung fest
 * und haette scheitern koennen — `0x20` las danach exakt
 * `1 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0`.
 *
 * Noch aussagekraeftiger ist der Spaltenvergleich beider Faelle: unter ALLEN
 * Part-Parametern hat sich **nur `0x20`** geaendert. Damit ist die Zuordnung
 * nicht bloss korreliert, sondern isoliert.
 *
 * Die uebrigen Aenderungen lagen bei `0x30, 0x3C, 0x60, 0x6C, 0x90, 0x9C,
 * 0xC0, 0xCC` — exakt das Raster `0x30 + k * 0x0C`, also der Step-Block (der
 * Nutzer hat beim Ueberarbeiten auch Steps gesetzt). Das bestaetigt nebenbei
 * unabhaengig, dass die Sequenz bei 0x30 beginnt und 12 Byte pro Step belegt.
 *
 * Nebenbefund zur Filterliste: die Werte laufen bis 16, waehrend die Werksbank
 * nur {0,1,7,12} nutzt. Das bestaetigt die Warnung oben — der Stock-Umfang ist
 * eine Untergrenze, und die Obergrenze haette man daraus nicht erraten.
 *
 * ## Die uebrigen Offsets bleiben unbestaetigt
 *
 * Fuer sie gilt weiterhin: die Messung zeigt strukturierte, plausible Bytes,
 * aber nicht, dass die Zuordnung Feld -> Offset stimmt. Wer den naechsten
 * klaeren will, baut ein Testpattern, das genau diesen Parameter ueber die
 * Parts variiert, und sucht die Spalte, die sich entsprechend verhaelt.
 *
 * Wichtig: die Bereiche wirken NUR beim Klemmen von UI-Eingaben
 * (`clampParamValue`). Import und Export arbeiten roh, damit Geraetewerte
 * ausserhalb des vermuteten Bereichs erhalten bleiben.
 */
export const PART_PARAMS: PartParam[] = [
  { key: "filterType", label: "Filter-Typ", offset: 0x0c, min: 0, max: 255, kind: "u8", group: "Filter" }, // ✔ geraetebestaetigt; Testpattern zeigte 1..16
  { key: "cutoff", label: "Cutoff", offset: 0x0d, min: 0, max: 127, kind: "u8", group: "Filter" }, // ✔ geraetebestaetigt (aufsteigende Rampe)
  { key: "resonance", label: "Resonanz", offset: 0x0e, min: 0, max: 127, kind: "u8", group: "Filter" }, // ✔ geraetebestaetigt (aufsteigende Rampe)
  { key: "egInt", label: "EG-Int", offset: 0x0f, min: -63, max: 63, kind: "i8", group: "Filter" }, // ✔ geraetebestaetigt bipolar (+63…-63 gemessen)
  { key: "modType", label: "Mod-Typ", offset: 0x10, min: 0, max: 255, kind: "u8", group: "Mod" }, // Stock bis 71; Obergrenze unbekannt
  { key: "modSpeed", label: "Mod-Speed", offset: 0x11, min: 0, max: 127, kind: "u8", group: "Mod" },
  { key: "modDepth", label: "Mod-Depth", offset: 0x12, min: 0, max: 127, kind: "u8", group: "Mod" },
  { key: "egAttack", label: "Amp Attack", offset: 0x14, min: 0, max: 127, kind: "u8", group: "Amp/EG" },
  { key: "egDecay", label: "Amp Decay", offset: 0x15, min: 0, max: 127, kind: "u8", group: "Amp/EG" },
  { key: "ampEgOn", label: "Amp-EG an", offset: 0x1a, min: 0, max: 1, kind: "bool", group: "Amp/EG" },
  { key: "mfxSend", label: "MFX-Send", offset: 0x1b, min: 0, max: 127, kind: "u8", group: "Amp/EG" },
  { key: "grooveType", label: "Groove-Typ", offset: 0x1c, min: 0, max: 255, kind: "u8", group: "Groove" }, // Stock bis 23; Obergrenze unbekannt
  { key: "grooveDepth", label: "Groove-Depth", offset: 0x1d, min: 0, max: 127, kind: "u8", group: "Groove" },
  { key: "ifxOn", label: "IFX an", offset: 0x20, min: 0, max: 1, kind: "bool", group: "IFX" }, // ✔ geraetebestaetigt (alternierendes Testpattern)
  { key: "ifxType", label: "IFX-Typ", offset: 0x21, min: 0, max: 255, kind: "u8", group: "IFX" }, // ✔ geraetebestaetigt; Testpattern zeigte bis 48
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

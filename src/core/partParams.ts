/**
 * partParams.ts — Part-Klangparameter (Filter/Amp/IFX/Mod/Osc).
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
 * | `0x10` | modType    | V-Muster `0..7` dann `71..64`               |
 * | `0x11` | modSpeed   | Rampe `0 8 16 … 72`, Parts 11-16 unberuehrt |
 * | `0x12` | modDepth   | per Ausschluss (Paar mit 0x11)              |
 * | `0x14` | egAttack   | Rampe `127 117 106 … 37`                    |
 * | `0x15` | egDecay    | Rampe `127 118 … 37`                        |
 * | `0x1A` | ampEgOn    | `0 1 0 1 …` — gegenlaeufig zu 0x1B          |
 * | `0x1B` | mfxSend    | `1 0 1 0 …` — Schalter, nicht Pegel         |
 * | `0x1C` | grooveType | `0..7` dann `61..54` (Anzeige 1..8 / 62..55) |
 * | `0x1D` | grooveDepth| Rampe `0 10 … 120 122 124 127` — exakt      |
 * | `0x20` | ifxOn      | `0 0 1 0 1 0 1 0 1 0 1 0 1 0 1 0` — alterniert |
 * | `0x21` | ifxType    | 16 verschiedene, absteigend 48..34          |
 * | `0x22` | ifxEdit    | Rampe `0 7 17 … 97`                         |
 * | `0x24` | oscPitch   | `+63 … 3, -3 … -63`, Part 14 = 0 — **signed** |
 * | `0x0B` | oscEdit    | Rampe `0 10 30 … 127`                       |
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
 * ### Mod-Block: V-Muster und Differenzvergleich
 *
 * Testpattern: Mod-Typ in den Parts 1-8 aufsteigend, 9-16 absteigend.
 *
 *     0x10  0 1 2 3 4 5 6 7 | 71 70 69 68 67 66 65 64
 *
 * Am Geraet eingestellt waren `1..8` und `72..65` — gespeichert ist also
 * **eins weniger**: die Anzeige ist 1-basiert, der Speicher 0-basiert. Ohne die
 * Angabe des Nutzers waere diese Verschiebung nicht aufgefallen.
 *
 * Speed und Depth wurden im selben Durchgang verstellt, aber nicht als Rampe.
 * Sie sind trotzdem eingegrenzt: gegenueber dem vorigen Test haben sich im
 * Part-Header **genau drei** Spalten geaendert — `0x10`, `0x11`, `0x12` — und
 * genau drei Parameter wurden angefasst. Damit ist `{0x11, 0x12}` sicher
 * `{modSpeed, modDepth}`.
 *
 * **Aufgeloest** durch genau diesen Versuch: Speed wurde als saubere Rampe in
 * 8er-Schritten gesetzt, Depth unangetastet gelassen. `0x11` las danach exakt
 * `0 8 16 24 32 40 48 56 64 72` (nur Parts 1-10 waren angefasst, 11-16 blieben
 * unveraendert). Damit ist `0x11 = modSpeed` belegt und `0x12 = modDepth`
 * folgt per Ausschluss aus dem bereits belegten Paar.
 *
 * ### Level und Attack — und eine Bestaetigung ausserhalb dieser Tabelle
 *
 * Im selben Durchgang Level aufsteigend und Attack absteigend, wieder nur ueber
 * die Parts 1-10:
 *
 *     0x14  127 117 106 97 87 77 67 57 47 37  (egAttack)
 *     0x18    0  10  20 30 40 50 60 70 80 90  (Part-Level)
 *
 * `0x18` steht nicht in dieser Tabelle — es ist der Part-Lautstaerkewert, den
 * `e2sExport.ts` als `PART_VOLUME_OFF` schreibt. Der Offset stammte dort aus
 * der Format-Doku und ist mit dieser Messung erstmals am Geraet belegt.
 *
 * ### Groove — und ein Feld, das hier NICHT hingehoert
 *
 * Groove-Depth als Rampe, Groove-Typ als V-Muster:
 *
 *     0x1D  0 10 20 … 120 122 124 127        exakt wie eingestellt
 *     0x1C  0 1 2 3 4 5 6 7 | 61 60 … 54     eingestellt war 1..8 / 62..55
 *
 * `0x1C` bestaetigt die 0-basierte Speicherung ein zweites Mal — dieselbe
 * Verschiebung wie bei `modType`. Damit ist das kein Einzelfall, sondern das
 * Muster des Formats: **Anzeige 1-basiert, Speicher 0-basiert.**
 *
 * ⚠ Im selben Durchgang wurde „Voice Assign" gesetzt: Parts 1-4 mono1..poly2,
 * Parts 5-11 Chord-Set 1-7, Parts 12-16 Gate-Arp mit Werten 1/50/40/30/20.
 * Reagiert hat davon nur `0x02`, und nur fuer die ersten vier Parts:
 *
 *     0x02  0 1 2 3 | 1 1 1 1 1 1 1 1 1 1 1 1
 *
 * Die Chord-Set- und Gate-Arp-Werte stehen **weder im 816-B-Part-Block noch im
 * PTST-Kopf** (beide gezielt danach abgesucht). Sie liegen also woanders —
 * moeglicherweise in einer eigenen Struktur oder anders kodiert. `0x02` ist
 * deshalb bewusst NICHT als Parameter aufgenommen: ein Feld, dessen Wertebereich
 * man nur zu einem Viertel kennt, gehoert nicht in eine Editier-Tabelle.
 *
 * ### Amp/IFX-Block — das gegenlaeufige Paar
 *
 * Decay absteigend, IFX-Edit aufsteigend, und Amp-EG/MFX-Send abwechselnd
 * **gegeneinander** (Part 1: MFX an, Amp aus; Part 2 umgekehrt):
 *
 *     0x15  127 118 107 97 87 77 66 57 47 37 | 127 …   egDecay
 *     0x1A  0 1 0 1 0 1 0 1 0 1 | 0 0 0 0 0 0        ampEgOn
 *     0x1B  1 0 1 0 1 0 1 0 1 0 | 1 1 1 1 1 1        mfxSend
 *     0x22  0 7 17 27 37 47 67 77 87 97 | 64 …        ifxEdit
 *
 * `0x1A` und `0x1B` sind ueber alle 16 Parts **exakt invers**. Dass zwei
 * unabhaengige Spalten das zufaellig sind, ist ausgeschlossen — und es ist
 * genau die Vorgabe des Testpatterns. Ein Paar gegenlaeufig zu setzen ist
 * deshalb ein staerkeres Pruefmittel als zwei getrennte Rampen.
 *
 * **Korrektur an `mfxSend`:** das Feld traegt nur 0/1, ist also ein SCHALTER
 * und kein Pegel. Zwei unabhaengige Belege — die KORG-Werksbank zeigte ueber
 * 4000 Parts ebenfalls nur die Werte 0 und 1, was mir dort noch nicht
 * aufgefallen war, weil 0..1 im angenommenen Bereich 0..127 liegt und die
 * Pruefung nur Verletzungen meldet. Eine Bereichspruefung findet eben nur
 * Werte, die zu GROSS sind, nie einen zu weiten Bereich.
 *
 * ### Osc-Block — und ein Offset, den es so nicht gibt
 *
 * Pitch absteigend von +63 durch die Null, „Edit" aufsteigend:
 *
 *     0x24  63 53 33 23 13 3 -3 -13 -23 -33 -43 -53 -63 0 0 0   (signed)
 *     0x0B  0 10 30 40 50 60 70 80 90 100 100 110 120 127 0 0
 *
 * `0x24` laeuft durch die Null ins Negative — damit ist die bipolare Speicherung
 * auch am Geraet belegt, nicht nur aus der Werksbank erschlossen.
 *
 * ⚠ **`oscGlide` bei `0x25` wurde entfernt.** Der Nutzer weist darauf hin, dass
 * Pitch und Glide am Geraet EIN Regler sind — es gibt also gar keinen zweiten,
 * separat einstellbaren Wert. Passend dazu hat sich `0x25` in der gesamten
 * Messreihe (sieben Testpattern) **kein einziges Mal** bewegt. Der Eintrag war
 * eine Annahme ohne Grundlage, und ein editierbares Feld auf einem unbekannten
 * Byte laedt dazu ein, etwas zu ueberschreiben, das man nicht versteht.
 *
 * An seine Stelle tritt `oscEdit` bei `0x0B` — der Wert, den der Nutzer als
 * „Edit" gesetzt hat und der dort exakt als Rampe erscheint.
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
  { key: "modType", label: "Mod-Typ", offset: 0x10, min: 0, max: 255, kind: "u8", group: "Mod" }, // ✔ geraetebestaetigt (V-Muster); Speicher 0-basiert, Anzeige 1-basiert
  { key: "modSpeed", label: "Mod-Speed", offset: 0x11, min: 0, max: 127, kind: "u8", group: "Mod" }, // ✔ geraetebestaetigt (8er-Rampe)
  { key: "modDepth", label: "Mod-Depth", offset: 0x12, min: 0, max: 127, kind: "u8", group: "Mod" }, // ✔ per Ausschluss (Paar mit 0x11)
  { key: "egAttack", label: "Amp Attack", offset: 0x14, min: 0, max: 127, kind: "u8", group: "Amp/EG" }, // ✔ geraetebestaetigt (absteigende Rampe)
  { key: "egDecay", label: "Amp Decay", offset: 0x15, min: 0, max: 127, kind: "u8", group: "Amp/EG" }, // ✔ geraetebestaetigt (absteigende Rampe)
  { key: "ampEgOn", label: "Amp-EG an", offset: 0x1a, min: 0, max: 1, kind: "bool", group: "Amp/EG" }, // ✔ geraetebestaetigt (gegenlaeufig zu 0x1B)
  { key: "mfxSend", label: "MFX-Send", offset: 0x1b, min: 0, max: 1, kind: "bool", group: "Amp/EG" }, // ✔ geraetebestaetigt: SCHALTER, nicht Pegel
  { key: "grooveType", label: "Groove-Typ", offset: 0x1c, min: 0, max: 255, kind: "u8", group: "Groove" }, // ✔ geraetebestaetigt; Speicher 0-basiert
  { key: "grooveDepth", label: "Groove-Depth", offset: 0x1d, min: 0, max: 127, kind: "u8", group: "Groove" }, // ✔ geraetebestaetigt (exakte Rampe)
  { key: "ifxOn", label: "IFX an", offset: 0x20, min: 0, max: 1, kind: "bool", group: "IFX" }, // ✔ geraetebestaetigt (alternierendes Testpattern)
  { key: "ifxType", label: "IFX-Typ", offset: 0x21, min: 0, max: 255, kind: "u8", group: "IFX" }, // ✔ geraetebestaetigt; Testpattern zeigte bis 48
  { key: "ifxEdit", label: "IFX-Edit", offset: 0x22, min: 0, max: 127, kind: "u8", group: "IFX" }, // ✔ geraetebestaetigt (aufsteigende Rampe)
  { key: "oscPitch", label: "Pitch", offset: 0x24, min: -63, max: 63, kind: "i8", group: "Osc" }, // ✔ geraetebestaetigt bipolar (durch die Null gemessen)
  { key: "oscEdit", label: "Osc-Edit", offset: 0x0b, min: 0, max: 127, kind: "u8", group: "Osc" }, // ✔ geraetebestaetigt (aufsteigende Rampe)
];

const BY_KEY = new Map(PART_PARAMS.map((p) => [p.key, p]));

/**
 * Clampt eine USER-Eingabe auf den Anzeigebereich des
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

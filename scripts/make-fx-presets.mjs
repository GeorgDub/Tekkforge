/**
 * Erzeugt die Beispiel-Presets in `examples/fx-presets/` — fertig eingestellte
 * 524-Byte-Bloecke fuer Insert- und Master-Effekte, je mit einer Sammlung, die
 * alle auf einmal laedt.
 *
 *   npx tsx scripts/make-fx-presets.mjs [zielordner]
 *
 * ## Wozu
 *
 * Der Preset-Editor kann bisher nur weiterreichen, was vorher vom Geraet kam.
 * Zum Ausprobieren des Schreibpfads braucht es aber etwas, das man ohne Geraet
 * in der Hand hat: Bloecke, in denen jeder Wert gesetzt ist, mit Namen, der im
 * Geraetemenue auftaucht, und mit Zuordnungen auf die Bedienelemente, damit
 * beim Drehen (IFX-Regler) bzw. Wischen (X/Y-Flaeche) auch etwas passiert.
 *
 * ## Zwei Arten, zwei Ziele
 *
 * Insert-Presets (`.e2fxp`) gehoeren nach `0xC00A80F0`, Master-Presets nach
 * `0xC00B4F30` — im Editor entscheidet das die Art-Auswahl. Die Master-Dateien
 * heissen deshalb `.mfx`: auf diese Endung stellt `ausDatei()` die Art selbst
 * um. Ein Master-Preset in einen Insert-Platz geschrieben taete sonst schlicht
 * nichts, und das saehe aus wie ein Fehler der Uebertragung.
 *
 * In beiden Faellen stehen die *nicht* genutzten Stufen auf Thru: ein
 * Insert-Preset soll beim Schreiben nicht den Master umstellen und umgekehrt.
 *
 * ## Woher die Werte kommen — und woher nicht
 *
 * Jedes Preset startet auf den **werkseitigen Defaults** des jeweiligen
 * Algorithmus (`WERKSWERTE` unten, bit-genau aus hacktribe-editor
 * `utils/ht_fx_ram_format.py`, denselben Zahlen wie in Synthstudios
 * `e2FxDefaults.ts`). Nur benannte Parameter weichen davon ab.
 *
 * Was das **nicht** ist: eine Vermessung. Semantische Bereiche und Einheiten
 * der Parameter sind in hacktribe nicht hinterlegt (dort als TODO markiert) —
 * bekannt ist nur 0..127. Die Abweichungen hier folgen dem Parameternamen und
 * der Richtung, die er nahelegt (`gain` hoch heisst mehr Zerre, `bit_depth`
 * runter heisst mehr Kruemel). Ein Wert wie `lfo_sync_note = 6` steht auf dem
 * Werkswert, weil die Notenwert-Tabelle dahinter unbekannt ist — geraten wird
 * nicht.
 *
 * Wo selbst die *Richtung* offen ist, entscheidet nicht das Skript, sondern
 * die Hand: `dry_wet` einer Hallfahne bleibt auf dem Werkswert und liegt
 * stattdessen auf der X-Achse. Wer wischt, hoert in einer Sekunde, was hier
 * keine Vermutung leisten kann.
 *
 * ## Die Zwei-Insert-Regel
 *
 * Ein zweiter Insert ist nur bei „leichten" Algorithmen erlaubt. Die beiden
 * Schwesterprojekte lesen die Whitelist verschieden — Synthstudio prueft sie
 * gegen IFX 2, TekkForge (`ifx2Moeglich`) gegen IFX 1. Solange das nicht am
 * Geraet entschieden ist, nehmen die dreistufigen Presets hier **beide**
 * Slots aus der Whitelist; damit sind sie nach jeder der beiden Lesarten
 * gueltig.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes, IFX2_FAEHIG, FX_PRESET_SIZE } from "../src/core/e2FxPreset.ts";
import { IFX_TYPES, MFX_TYPES } from "../src/core/e2FxParams.ts";
import { baueSammlung } from "../src/core/sammlung.ts";

const ZIEL = process.argv[2] ?? "examples/fx-presets";

/** Insert-Algorithmen, damit die Definitionen unten lesbar bleiben. */
const A = {
  thru: 0x00,
  mkp2Comp: 0x01,
  cheapComp: 0x03,
  punch: 0x04,
  eq4: 0x07,
  decimator: 0x09,
  filter: 0x0a,
  distortion: 0x0f,
  acidDriver: 0x10,
  flanger: 0x12,
  phaser: 0x13,
  tremolo: 0x14,
  ringMod: 0x16,
  shortDelay: 0x18,
};

/** Master-Algorithmen. Eigene Nummernkreis-Tabelle, nicht mit `A` mischen. */
const M = {
  thru: 0x00,
  mkp2Comp: 0x28,
  limiter: 0x2a,
  eq4: 0x2b,
  multiFilter: 0x2d,
  distortion: 0x2e,
  tubePre: 0x2f,
  roomReverb: 0x3a,
  modDelay: 0x3b,
  tapeEcho: 0x3c,
  grainShifter: 0x3d,
  decimator: 0x3e,
  vinylBreak: 0x40,
};

/**
 * Quellen einer Zuordnung im Preset-Block (0x41–0x4A — **nicht** die
 * RAM-Kodierung 0x01–0x0A, die gilt beim NRPN-Senden).
 *
 * Dasselbe Byte heisst je nach Stufe etwas anderes: beim Insert-Effekt ist
 * 0x42 der IFX-Regler, beim Master-Effekt die X-Achse der Flaeche.
 */
const Q = { reglerX: 0x42, achseY: 0x43, beruehrt: 0x41 };
/** Kettenplatz einer Zuordnung. */
const KETTE = { ifx1: 0x00, ifx2: 0x01, mfx: 0x02 };

/**
 * Werkseitige Parameterwerte je Algorithmus, Index-gleich zu
 * `IFX_TYPES[id].params` bzw. `MFX_TYPES[id].params`. Bit-genau aus
 * hacktribe-editor `ht_fx_ram_format.py` (die `Default(Int8ul, …)` je
 * `*_params`-Struct).
 *
 * Ohne diese Basis stuende jeder nicht ausdruecklich gesetzte Parameter auf 0
 * — bei mehreren Algorithmen heisst das `dry_wet = 0`, also ein Effekt, den
 * man nicht hoert.
 */
const WERKSWERTE_IFX = {
  0x00: [],
  0x01: [100, 0, 100, 0, 8, 127, 36, 10, 36, 39],
  0x02: [100, 0, 36, 8, 5, 12, 2, 4, 60, 54],
  0x03: [127, 127, 64, 4, 64, 12],
  0x04: [],
  0x05: [100, 0, 48, 10, 3, 3, 100, 64],
  0x06: [127, 0, 0, 12, 5, 36, 56, 5, 36],
  0x07: [127, 2, 0, 0, 1, 16, 5, 36, 33, 5, 36, 48, 5, 36, 52, 5, 36],
  0x08: [100, 52, 127, 36, 16, 48, 44, 0, 0],
  0x09: [100, 0, 127, 116, 63, 8, 127, 0],
  0x0a: [100, 0, 127, 64],
  0x0f: [0, 64, 35, 15, 48, 16, 5, 36, 43, 5, 42, 53, 5, 25, 25],
  0x10: [30, 40],
  0x11: [50, 0, 64, 1, 0, 28, 6, 0, 0, 36, 0, 0, 0, 0, 46, 0, 0, 0, 0],
  0x12: [75, 0, 75, 1, 0, 6, 1, 50, 0, 0, 18, 0, 2, 0, 0, 75, 0],
  0x13: [50, 1, 100, 60, 104, 0, 2, 0, 0, 5, 2, 0, 0, 18],
  0x14: [100, 0, 100, 2, 50, 0, 0, 80, 6, 50, 0, 0, 18],
  0x15: [127, 24, 6, 126, 0, 1, 1, 33, 6, 0, 18],
  0x16: [50, 67, 0, 0, 14, 2, 0, 18, 127, 0, 127, 50, 0],
  0x18: [120, 30, 127, 0, 65, 24, 35, 17, 36, 0, 0, 15],
  0x27: [0],
};

const WERKSWERTE_MFX = {
  0x00: [],
  0x27: [0],
  0x28: [100, 0, 49, 50, 12, 127, 36, 16, 36, 50],
  0x29: [100, 0, 42, 8, 6, 11, 5, 0, 0, 48],
  0x2a: [100, 0, 36, 0, 8, 8, 50, 72],
  0x2b: [100, 127, 2, 0, 0, 1, 16, 5, 36, 33, 5, 36, 48, 5, 36, 52, 5, 36],
  0x2c: [100, 0, 0, 127, 1, 1, 1, 127, 0, 0, 0, 47, 6, 19, 0, 0, 56],
  0x2d: [100, 127, 5, 75, 1, 64, 0, 25, 6, 0, 36, 63, 40, 63, 127, 0, 0, 0, 127],
  0x2e: [100, 70, 35, 5, 36, 14, 5, 36, 44, 5, 36, 52, 5, 36, 45],
  0x2f: [100, 48, 76, 48, 108, 4, 122, 4, 126, 30, 0, 40, 52],
  0x31: [50, 0, 50, 1, 0, 35, 5, 36, 0, 36, 36, 16, 36, 50, 46, 64, 26, 127, 127],
  0x32: [75, 0, 85, 0, 0, 14, 3, 89, 27, 0, 27, 0, 11, 10, 127, 75, 127],
  0x33: [50, 1, 90, 63, 85, 0, 0, 0, 0, 19, 3, 27, 0, 9],
  0x34: [100, 0, 80, 2, 50, 0, 0, 66, 1, 25, 36, 0, 18],
  0x35: [127, 24, 2, 126, 0, 1, 1, 33, 6, 27, 0, 36],
  0x36: [100, 38, 92, 38, 48, 127, 30, 30, 26],
  0x37: [100, 38, 78, 38, 53, 127, 30, 30, 26],
  0x38: [100, 31, 106, 38, 43, 95, 30, 30, 26],
  0x39: [100, 31, 61, 51, 39, 64, 30, 30, 26],
  0x3a: [100, 31, 68, 7, 46, 127, 30, 30, 0, 102, 64],
  0x3b: [100, 127, 50, 36, 20, 36, 44, 1, 65, 47, 41, 35, 17, 43, 0, 70, 0, 0, 35, 1, 26, 9, 0],
  0x3c: [100, 25, 1, 8, 8, 19, 19, 1, 53, 88, 88, 70, 77, 48, 80, 53, 55, 5, 2, 0, 127, 0, 109, 100],
  0x3d: [50, 0, 45, 42, 3, 6, 0, 78, 7, 0, 0],
  0x3e: [100, 0, 127, 127, 45, 8, 127, 0, 0, 0, 1, 50, 0, 18, 0, 34, 4],
  0x3f: [0, 50, 0, 0, 0, 13, 64, 101],
  0x40: [100, 0, 80, 0, 50, 2, 16],
};

/**
 * Die Insert-Presets. `ifx1`/`ifx2` geben den Algorithmus und die Abweichungen
 * von den Werkswerten (Parameter **beim Namen**, nicht per Index — ein
 * Tippfehler fliegt dann beim Bauen auf statt still im falschen Byte zu
 * landen). `regler` legt fest, was der IFX-Regler am Geraet zieht.
 */
const INSERT_PRESETS = [
  {
    datei: "01-tekk-drive",
    name: "Tekk Drive",
    zweck: "Breite Saettigung fuer Kick und Bass — der Grundstock jedes harten Parts.",
    ifx1: {
      device: A.distortion,
      werte: { dry_wet: 127, gain: 100, output_level: 45, post_eq2_gain: 48, post_eq3_gain: 20 },
    },
    regler: [{ kette: KETTE.ifx1, param: "gain", min: 40, max: 127 }],
  },
  {
    datei: "02-bit-tekk",
    name: "Bit Tekk",
    zweck: "Bitcrusher: Sample-Rate und Aufloesung runter, bis es bricht.",
    ifx1: {
      device: A.decimator,
      werte: { dry_wet: 127, pre_lpf_sw: 1, pre_lpf: 90, hi_damp: 100, sample_freq: 30, bit_depth: 5, output_level: 127 },
    },
    regler: [{ kette: KETTE.ifx1, param: "sample_freq", min: 8, max: 90 }],
  },
  {
    datei: "03-kick-press",
    name: "Kick Press",
    zweck: "Kompressor mit hoher Ansprache — presst die Kick zusammen, Tiefen leicht angehoben.",
    ifx1: {
      device: A.mkp2Comp,
      werte: { dry_wet: 127, sensitivity: 120, attack: 10, output_level: 20, trim: 110, pre_leq_gain: 44, pre_leq_frequency: 8, pre_heq_gain: 40, pre_heq_frequency: 45 },
    },
    regler: [{ kette: KETTE.ifx1, param: "sensitivity", min: 60, max: 127 }],
  },
  {
    datei: "04-ring-tekk",
    name: "Ring Tekk",
    zweck: "Ringmodulator mit Rueckkopplung — macht aus einem Ton eine Glocke, aus einer Snare Metall.",
    ifx1: {
      device: A.ringMod,
      werte: { dry_wet: 110, osc_freq: 48, input_level: 127, hi_damp: 110, feedback: 40 },
    },
    regler: [{ kette: KETTE.ifx1, param: "osc_freq", min: 10, max: 120 }],
  },
  {
    datei: "05-echo-sync",
    name: "Echo Sync",
    zweck: "Kurzes, tempo-gekoppeltes Delay. Notenwert steht auf dem Werkswert — die Tabelle dahinter ist unbekannt.",
    ifx1: {
      device: A.shortDelay,
      werte: { dry_level: 110, wet_level: 70, input_trim: 127, tempo_sync: 1, fb_depth: 70, high_damp: 40, low_damp: 10 },
    },
    regler: [{ kette: KETTE.ifx1, param: "fb_depth", min: 0, max: 110 }],
  },
  {
    datei: "06-flange-jet",
    name: "Flange Jet",
    zweck: "Flanger mit viel Rueckkopplung — der Duesenjet ueber dem Break.",
    ifx1: {
      device: A.flanger,
      werte: { dry_wet: 90, mod_int: 110, lfo_speed: 4, manual: 30, feedback: 110, fb_hicut: 20 },
    },
    regler: [{ kette: KETTE.ifx1, param: "manual", min: 0, max: 127 }],
  },
  {
    datei: "07-phase-sweep",
    name: "Phase Sweep",
    zweck: "Phaser mit hoher Resonanz, langsam schwebend. Regler faehrt den Sweep von Hand.",
    ifx1: {
      device: A.phaser,
      werte: { dry_wet: 90, manual: 64, modint: 110, resonance: 110, high_damp: 10, lfo_speed: 3 },
    },
    regler: [{ kette: KETTE.ifx1, param: "manual", min: 0, max: 127 }],
  },
  {
    datei: "08-gate-chop",
    name: "Gate Chop",
    zweck: "Tremolo als Gate: Rechteck, tempo-gekoppelt, volle Modulationstiefe.",
    ifx1: {
      device: A.tremolo,
      werte: { dry_wet: 127, mod_int: 127, lfo_sync: 1, lfo_shape: 127, lfo_reset: 1 },
    },
    regler: [{ kette: KETTE.ifx1, param: "mod_int", min: 0, max: 127 }],
  },
  {
    datei: "09-kick-eq",
    name: "Kick EQ",
    zweck: "Vier-Band-EQ: Tiefen an, Mitten raus, Hoehen auf. 36 ist neutral (Werkswert aller Gain-Baender).",
    ifx1: {
      device: A.eq4,
      werte: { b1_gain: 46, b2_gain: 28, b4_gain: 44 },
    },
    regler: [{ kette: KETTE.ifx1, param: "b1_gain", min: 36, max: 56 }],
  },
  {
    datei: "10-acid-filter",
    name: "Acid Filter",
    zweck: "Zwei Inserts: Acid Driver in ein resonantes Filter. Der Regler zieht Filter und Drive zugleich.",
    ifx1: { device: A.acidDriver, werte: { drive: 90, output_level: 45 } },
    ifx2: { device: A.filter, werte: { dry_wet: 127, frequency: 70, resonance: 100 } },
    regler: [
      { kette: KETTE.ifx2, param: "frequency", min: 10, max: 127 },
      { kette: KETTE.ifx1, param: "drive", min: 30, max: 127 },
    ],
  },
  {
    datei: "11-punch-filter",
    name: "Punch Filter",
    zweck: "Zwei Inserts: Punch vor einem quakenden Filter. Punch hat selbst keine Parameter.",
    ifx1: { device: A.punch, werte: {} },
    ifx2: { device: A.filter, werte: { dry_wet: 127, frequency: 45, resonance: 115 } },
    regler: [{ kette: KETTE.ifx2, param: "frequency", min: 5, max: 127 }],
  },
  {
    datei: "12-comp-drive",
    name: "Comp Drive",
    zweck: "Zwei Inserts: Cheap Comp verdichtet, Acid Driver zerrt das Ergebnis.",
    ifx1: { device: A.cheapComp, werte: { env_bit_shift: 3, sens: 100, output_level: 20 } },
    ifx2: { device: A.acidDriver, werte: { drive: 110, output_level: 40 } },
    regler: [{ kette: KETTE.ifx2, param: "drive", min: 20, max: 127 }],
  },
].map((p) => ({ ...p, art: "ifx" }));

/**
 * Die Master-Presets. Hier liegt jede Zuordnung auf der X/Y-Flaeche: X (0x42)
 * und Y (0x43) sind die zwei Achsen, 0x41 loest beim Beruehren aus.
 *
 * Wo die Richtung eines Werts nicht aus dem Namen folgt — wie viel Hall ist
 * „richtig"? —, bleibt der Werkswert stehen und der Parameter kommt auf eine
 * Achse. Das ist ehrlicher als eine Zahl zu erfinden, und am Geraet schneller
 * beantwortet als hier.
 */
const MASTER_PRESETS = [
  {
    datei: "m01-master-glue",
    name: "Master Glue",
    zweck: "Bus-Kompressor: haelt den Mix zusammen. X = Ansprache, Y = Attack.",
    mfx: { device: M.mkp2Comp, werte: { dry_wet: 127, sensitivity: 90, attack: 30 } },
    regler: [
      { quelle: Q.reglerX, param: "sensitivity", min: 30, max: 127 },
      { quelle: Q.achseY, param: "attack", min: 0, max: 127 },
    ],
  },
  {
    datei: "m02-master-limit",
    name: "Master Limit",
    zweck: "Limiter fuer den lauten Schluss. X = Schwelle, Y = Roehrensaettigung.",
    mfx: { device: M.limiter, werte: { dry_wet: 127, threshold: 28, tube_sat: 70, output_gain: 80 } },
    regler: [
      { quelle: Q.reglerX, param: "threshold", min: 8, max: 64 },
      { quelle: Q.achseY, param: "tube_sat", min: 0, max: 127 },
    ],
  },
  {
    datei: "m03-master-eq",
    name: "Master EQ",
    zweck: "Vier-Band-EQ ueber alles: Tiefen an, Tiefmitten raus, Luft oben. X/Y sind Kippschalter fuer unten und oben.",
    mfx: { device: M.eq4, werte: { dry_wet: 127, b1_gain: 44, b2_gain: 30, b4_gain: 42 } },
    regler: [
      { quelle: Q.reglerX, param: "b1_gain", min: 24, max: 52 },
      { quelle: Q.achseY, param: "b4_gain", min: 24, max: 52 },
    ],
  },
  {
    datei: "m04-filter-drop",
    name: "Filter Drop",
    zweck: "Das Werkzeug fuer Aufbau und Absturz: X faehrt die Eckfrequenz, Y die Resonanz.",
    mfx: { device: M.multiFilter, werte: { dry_wet: 127, frequency: 90, resonance: 100, drive: 60 } },
    regler: [
      { quelle: Q.reglerX, param: "frequency", min: 5, max: 127 },
      { quelle: Q.achseY, param: "resonance", min: 0, max: 127 },
    ],
  },
  {
    datei: "m05-master-drive",
    name: "Master Drive",
    zweck: "Zerre ueber die Summe. X = Zerrgrad, Y = oberstes EQ-Band (36 ist neutral).",
    mfx: { device: M.distortion, werte: { dry_wet: 127, gain: 95, output_level: 38 } },
    regler: [
      { quelle: Q.reglerX, param: "gain", min: 30, max: 127 },
      { quelle: Q.achseY, param: "post_eq3_gain", min: 20, max: 52 },
    ],
  },
  {
    datei: "m06-tube-warm",
    name: "Tube Warm",
    zweck: "Roehrenvorstufe, zwei Stufen. X und Y saettigen je eine davon.",
    mfx: { device: M.tubePre, werte: { dry_wet: 127, tube1_sat: 100, tube2_sat: 120 } },
    regler: [
      { quelle: Q.reglerX, param: "tube1_sat", min: 40, max: 127 },
      { quelle: Q.achseY, param: "tube2_sat", min: 40, max: 127 },
    ],
  },
  {
    datei: "m07-room-wide",
    name: "Room Wide",
    zweck: "Raum ueber alles. Wie viel — das entscheidet die Hand: X ist der Anteil, Y die Laenge.",
    mfx: { device: M.roomReverb, werte: { time: 45, hi_damp: 80, pre_delay: 10 } },
    regler: [
      { quelle: Q.reglerX, param: "dry_wet", min: 0, max: 127 },
      { quelle: Q.achseY, param: "time", min: 10, max: 100 },
    ],
  },
  {
    datei: "m08-tape-echo",
    name: "Tape Echo",
    zweck: "Bandecho, tempo-gekoppelt (Werkswert). X = Rueckkopplung, Y = Anteil.",
    mfx: { device: M.tapeEcho, werte: { feedback: 95, saturation: 80, hi_damp: 90 } },
    regler: [
      { quelle: Q.reglerX, param: "feedback", min: 0, max: 115 },
      { quelle: Q.achseY, param: "dry_wet", min: 0, max: 127 },
    ],
  },
  {
    datei: "m09-mod-delay",
    name: "Mod Delay",
    zweck: "Modulierendes Delay, tempo-gekoppelt (Werkswert). X = Rueckkopplung, Y = Anteil.",
    mfx: { device: M.modDelay, werte: { fb_depth: 90, mod_depth: 50, high_damp: 40 } },
    regler: [
      { quelle: Q.reglerX, param: "fb_depth", min: 0, max: 115 },
      { quelle: Q.achseY, param: "dry_wet", min: 0, max: 127 },
    ],
  },
  {
    datei: "m10-grain-stutter",
    name: "Grain Stutter",
    zweck: "Koernchen-Stotterer. X blendet ein, Y aendert die Rate (frei laufend, Werkswert der Kopplung ist aus).",
    mfx: { device: M.grainShifter, werte: { dry_wet: 127 } },
    regler: [
      { quelle: Q.reglerX, param: "dry_wet", min: 0, max: 127 },
      { quelle: Q.achseY, param: "off_lfo_freq", min: 5, max: 127 },
    ],
  },
  {
    datei: "m11-vinyl-stop",
    name: "Vinyl Stop",
    zweck: "Der Plattenstopp. Beruehren der Flaeche loest aus, X faehrt die Tonhoehe runter, Y kratzt.",
    mfx: { device: M.vinylBreak, werte: { dry_wet: 127 } },
    regler: [
      { quelle: Q.beruehrt, param: "pad_on", min: 0, max: 1 },
      { quelle: Q.reglerX, param: "delta_pitch", min: 0, max: 127 },
      { quelle: Q.achseY, param: "scratch", min: 0, max: 127 },
    ],
  },
  {
    datei: "m12-master-crush",
    name: "Master Crush",
    zweck: "Bitcrusher ueber die Summe. X = Sample-Rate, Y = Aufloesung.",
    mfx: { device: M.decimator, werte: { dry_wet: 127, sample_freq: 32, bit_depth: 6 } },
    regler: [
      { quelle: Q.reglerX, param: "sample_freq", min: 6, max: 90 },
      { quelle: Q.achseY, param: "bit_depth", min: 2, max: 16 },
    ],
  },
].map((p) => ({ ...p, art: "mfx" }));

/**
 * Variationen — zwei je Basis-Preset, zum Vergleichen am Geraet.
 *
 * Eine Variation nutzt **denselben Algorithmus** wie ihre Basis und verschiebt
 * ihn in genau eine Richtung. Nur so ist der Vergleich einer: wer drei Dateien
 * nacheinander in denselben Platz schreibt und dieselbe Sequenz laufen laesst,
 * hoert den Unterschied und sonst nichts.
 *
 * Angegeben werden nur die **Abweichungen** von der Basis, je Kettenstufe;
 * alles andere kommt von dort. `regler` ueberschreibt die Zuordnungen
 * vollstaendig — noetig, wenn eine Variation ein anderes Ziel unter das
 * Bedienelement legt (bei „Bit Tekk Bits" die Aufloesung statt der Rate).
 *
 * Ein Teil der Paare ist zugleich **Sonde**: zwei Dateien, die sich in genau
 * einem Byte unterscheiden, beantworten am Ohr eine Frage, die in den
 * Format-Unterlagen offen ist. `Kick EQ Boost` gegen `Kick EQ Scoop` sagt, ob
 * 36 wirklich neutral ist und ob hoeher lauter heisst; `Acid Filter Alt` und
 * `Punch Filt Alt2` setzen `output_select` auf 1 bzw. 2, dessen Bedeutung
 * nirgends steht. Was dabei herauskommt, gehoert zurueck in die Tabellen.
 */
const VARIATIONEN = {
  "01-tekk-drive": [
    {
      datei: "01a-tekk-drive-warm",
      name: "Tekk Drive Warm",
      zweck: "Halber Zerrgrad, mehr Ausgangspegel, Hoehen zurueck — Saettigung statt Bruch.",
      ifx1: { werte: { gain: 55, output_level: 60, post_eq2_gain: 40, post_eq3_gain: 14 } },
      regler: [{ kette: KETTE.ifx1, param: "gain", min: 20, max: 90 }],
    },
    {
      datei: "01b-tekk-drive-fuzz",
      name: "Tekk Drive Fuzz",
      zweck: "Anschlag bis zum Rand, Mitten nach vorn. Das laute Ende der Reihe.",
      ifx1: { werte: { gain: 127, output_level: 30, post_eq1_gain: 46, post_eq2_gain: 52, post_eq3_gain: 26 } },
      regler: [{ kette: KETTE.ifx1, param: "gain", min: 60, max: 127 }],
    },
  ],
  "02-bit-tekk": [
    {
      datei: "02a-bit-tekk-rate",
      name: "Bit Tekk Rate",
      zweck: "Nur die Abtastrate runter, Aufloesung bleibt hoch — Aliasing ohne Rauschen.",
      ifx1: { werte: { sample_freq: 14, bit_depth: 16 } },
      regler: [{ kette: KETTE.ifx1, param: "sample_freq", min: 4, max: 60 }],
    },
    {
      datei: "02b-bit-tekk-bits",
      name: "Bit Tekk Bits",
      zweck: "Umgekehrt: Rate hoch, Aufloesung runter — Rauschen ohne Aliasing. Der Regler zieht hier die Bits.",
      ifx1: { werte: { sample_freq: 96, bit_depth: 3 } },
      regler: [{ kette: KETTE.ifx1, param: "bit_depth", min: 2, max: 16 }],
    },
  ],
  "03-kick-press": [
    {
      datei: "03a-kick-press-slow",
      name: "Kick Press Slow",
      zweck: "Langsame Ansprache — der Anschlag kommt durch, erst danach greift die Kompression.",
      ifx1: { werte: { attack: 90 } },
      regler: [{ kette: KETTE.ifx1, param: "attack", min: 0, max: 127 }],
    },
    {
      datei: "03b-kick-press-slam",
      name: "Kick Press Slam",
      zweck: "Volle Ansprache, kein Attack, Tiefen weiter an — die Kick wird flach und breit.",
      ifx1: { werte: { sensitivity: 127, attack: 0, pre_leq_gain: 50 } },
      regler: [{ kette: KETTE.ifx1, param: "sensitivity", min: 80, max: 127 }],
    },
  ],
  "04-ring-tekk": [
    {
      datei: "04a-ring-tekk-low",
      name: "Ring Tekk Low",
      zweck: "Tiefe Modulationsfrequenz — Wummern und Schwebung statt Metall.",
      ifx1: { werte: { osc_freq: 14, feedback: 20 } },
      regler: [{ kette: KETTE.ifx1, param: "osc_freq", min: 2, max: 40 }],
    },
    {
      datei: "04b-ring-tekk-high",
      name: "Ring Tekk High",
      zweck: "Hohe Modulationsfrequenz, mehr Rueckkopplung, voll nass — schrill und glockig.",
      ifx1: { werte: { dry_wet: 127, osc_freq: 100, feedback: 80 } },
      regler: [{ kette: KETTE.ifx1, param: "osc_freq", min: 60, max: 127 }],
    },
  ],
  "05-echo-sync": [
    {
      datei: "05a-echo-sync-slap",
      name: "Echo Sync Slap",
      zweck: "Ohne Rueckkopplung: eine einzige Wiederholung. Der Regler mischt sie ein.",
      ifx1: { werte: { fb_depth: 0, wet_level: 90 } },
      regler: [{ kette: KETTE.ifx1, param: "wet_level", min: 0, max: 127 }],
    },
    {
      datei: "05b-echo-sync-dub",
      name: "Echo Sync Dub",
      zweck: "Lange Fahne, Hoehen und Tiefen weggedaempft — die Wiederholungen werden dumpfer.",
      ifx1: { werte: { fb_depth: 110, wet_level: 85, high_damp: 90, low_damp: 30 } },
      regler: [{ kette: KETTE.ifx1, param: "fb_depth", min: 40, max: 120 }],
    },
  ],
  "06-flange-jet": [
    {
      datei: "06a-flange-jet-slow",
      name: "Flange Jet Slow",
      zweck: "Langsamste Bewegung, volle Tiefe — ein Durchgang dauert.",
      ifx1: { werte: { lfo_speed: 1, mod_int: 127 } },
    },
    {
      datei: "06b-flange-jet-fast",
      name: "Flange Jet Fast",
      zweck: "Schnell und flacher — mehr Vibrato als Duesenjet.",
      ifx1: { werte: { lfo_speed: 30, mod_int: 70, feedback: 80 } },
    },
  ],
  "07-phase-sweep": [
    {
      datei: "07a-phase-auto",
      name: "Phase Auto",
      zweck: "Der LFO faehrt den Sweep selbst; der Regler bleibt fuer die Resonanz.",
      ifx1: { werte: { dry_wet: 100, modint: 127, lfo_speed: 12 } },
      regler: [{ kette: KETTE.ifx1, param: "resonance", min: 0, max: 127 }],
    },
    {
      datei: "07b-phase-wide",
      name: "Phase Wide",
      zweck: "Anderer Phaser-Typ (0 statt 1), zahmere Resonanz — breit statt stechend.",
      ifx1: { werte: { type: 0, modint: 80, resonance: 60 } },
    },
  ],
  "08-gate-chop": [
    {
      datei: "08a-gate-chop-half",
      name: "Gate Chop Half",
      zweck: "Halbe Modulationstiefe und weichere Flanke — pumpt, statt zu schneiden.",
      ifx1: { werte: { mod_int: 64, lfo_shape: 64 } },
    },
    {
      datei: "08b-gate-chop-free",
      name: "Gate Chop Free",
      zweck: "Ohne Tempo-Kopplung, schnell frei laufend — laeuft gegen das Raster.",
      ifx1: { werte: { lfo_sync: 0, lfo_speed: 110 } },
      regler: [{ kette: KETTE.ifx1, param: "lfo_speed", min: 10, max: 127 }],
    },
  ],
  "09-kick-eq": [
    {
      datei: "09a-kick-eq-boost",
      name: "Kick EQ Boost",
      zweck: "Kein Band unter 36, drei darueber. Zusammen mit „Scoop“ die Probe, ob 36 wirklich neutral ist.",
      ifx1: { werte: { b1_gain: 56, b2_gain: 36, b3_gain: 40, b4_gain: 52 } },
      regler: [{ kette: KETTE.ifx1, param: "b1_gain", min: 36, max: 60 }],
    },
    {
      datei: "09b-kick-eq-scoop",
      name: "Kick EQ Scoop",
      zweck: "Tiefe Kuhle in den Mitten, Raender hoch — die Gegenprobe zu „Boost“.",
      ifx1: { werte: { b1_gain: 50, b2_gain: 18, b3_gain: 24, b4_gain: 50 } },
      regler: [{ kette: KETTE.ifx1, param: "b2_gain", min: 12, max: 40 }],
    },
  ],
  "10-acid-filter": [
    {
      datei: "10a-acid-filter-alt",
      name: "Acid Filter Alt",
      zweck: "Sonde: gleiches Preset, nur output_select = 1 statt 0. Was das Filter dann tut, steht nirgends.",
      ifx2: { werte: { output_select: 1 } },
    },
    {
      datei: "10b-acid-filter-hot",
      name: "Acid Filter Hot",
      zweck: "Zerre am Anschlag, Filter an der Selbstschwingung — die harte Fassung.",
      ifx1: { werte: { drive: 127, output_level: 55 } },
      ifx2: { werte: { resonance: 120 } },
    },
  ],
  "11-punch-filter": [
    {
      datei: "11a-punch-filt-alt2",
      name: "Punch Filt Alt2",
      zweck: "Zweite Sonde auf output_select: hier 2. Zusammen mit „Acid Filter Alt“ (1) und der Basis (0) die ganze Reihe.",
      ifx2: { werte: { output_select: 2 } },
    },
    {
      datei: "11b-punch-filt-open",
      name: "Punch Filt Open",
      zweck: "Weit offen, kaum Resonanz — fast nur der Punch, das Filter faerbt nur.",
      ifx2: { werte: { dry_wet: 127, frequency: 110, resonance: 40 } },
    },
  ],
  "12-comp-drive": [
    {
      datei: "12a-comp-drive-soft",
      name: "Comp Drive Soft",
      zweck: "Beide Stufen zurueckgenommen — Verdichtung mit Anwaermung statt Zerre.",
      ifx1: { werte: { sens: 60, output_level: 30 } },
      ifx2: { werte: { drive: 55, output_level: 55 } },
    },
    {
      datei: "12b-comp-drive-max",
      name: "Comp Drive Max",
      zweck: "Beide Stufen am Anschlag. Wenn irgendwo etwas uebersteuert, dann hier.",
      ifx1: { werte: { env_bit_shift: 2, sens: 127, output_level: 14 } },
      ifx2: { werte: { drive: 127, output_level: 34 } },
    },
  ],

  "m01-master-glue": [
    {
      datei: "m01a-glue-soft",
      name: "Glue Soft",
      zweck: "Wenig Ansprache, langsamer Attack — haelt zusammen, ohne zu pumpen.",
      mfx: { werte: { sensitivity: 55, attack: 70 } },
    },
    {
      datei: "m01b-glue-slam",
      name: "Glue Slam",
      zweck: "Volle Ansprache, kein Attack, Tiefen an — der Mix atmet hoerbar.",
      mfx: { werte: { sensitivity: 127, attack: 0, pre_leq_gain: 42 } },
    },
  ],
  "m02-master-limit": [
    {
      datei: "m02a-limit-clean",
      name: "Limit Clean",
      zweck: "Hohe Schwelle, keine Roehre — greift nur bei den Spitzen.",
      mfx: { werte: { threshold: 50, tube_sat: 0, output_gain: 64 } },
    },
    {
      datei: "m02b-limit-max",
      name: "Limit Max",
      zweck: "Schwelle unten, Roehre voll, kurze Freigabe — laut um jeden Preis.",
      mfx: { werte: { threshold: 8, release: 4, tube_sat: 127, output_gain: 100 } },
    },
  ],
  "m03-master-eq": [
    {
      datei: "m03a-eq-tilt-dark",
      name: "EQ Tilt Dark",
      zweck: "Kippe nach unten: Tiefen an, Hoehen weg.",
      mfx: { werte: { b1_gain: 52, b2_gain: 40, b3_gain: 30, b4_gain: 22 } },
    },
    {
      datei: "m03b-eq-tilt-bright",
      name: "EQ Tilt Bright",
      zweck: "Kippe nach oben — die Gegenprobe. Wer beide hintereinander hoert, kennt die Richtung der Gain-Bytes.",
      mfx: { werte: { b1_gain: 26, b2_gain: 32, b3_gain: 44, b4_gain: 54 } },
    },
  ],
  "m04-filter-drop": [
    {
      datei: "m04a-filter-drop-hp",
      name: "Filter Drop HP",
      zweck: "Hochpass statt Tiefpass — der Aufbau, bei dem die Kick verschwindet.",
      mfx: { werte: { lpf24_level: 0, hpf_level: 127, frequency: 40 } },
    },
    {
      datei: "m04b-filter-drop-bp",
      name: "Filter Drop BP",
      zweck: "Bandpass mit hoher Resonanz — das Telefon-Zwischenspiel.",
      mfx: { werte: { lpf24_level: 0, bpf_level: 127, resonance: 120, frequency: 60 } },
    },
  ],
  "m05-master-drive": [
    {
      datei: "m05a-drive-warm",
      name: "Drive Warm",
      zweck: "Halbe Zerre, mehr Pegel, Hoehen zurueck — Anwaermung der Summe.",
      mfx: { werte: { gain: 50, output_level: 52, post_eq3_gain: 30 } },
    },
    {
      datei: "m05b-drive-fuzz",
      name: "Drive Fuzz",
      zweck: "Volle Zerre ueber alles. Grob, und genau dafuer da.",
      mfx: { werte: { gain: 127, output_level: 30, post_eq2_gain: 46 } },
    },
  ],
  "m06-tube-warm": [
    {
      datei: "m06a-tube-warm-lo",
      name: "Tube Warm Lo",
      zweck: "Beide Roehren zurueckgenommen — nur ein Hauch.",
      mfx: { werte: { tube1_gain: 40, tube1_sat: 55, tube2_gain: 40, tube2_sat: 60 } },
    },
    {
      datei: "m06b-tube-warm-hot",
      name: "Tube Warm Hot",
      zweck: "Beide Roehren am Anschlag, mehr Vorverstaerkung — dick und komprimiert.",
      mfx: { werte: { tube1_gain: 80, tube1_sat: 127, tube2_gain: 70, tube2_sat: 127, output_level: 44 } },
    },
  ],
  "m07-room-wide": [
    {
      datei: "m07a-room-short",
      name: "Room Short",
      zweck: "Kurz, gedaempft, viel Erstreflexion — enger Raum statt Halle.",
      mfx: { werte: { time: 18, hi_damp: 110, pre_delay: 0, rev_level: 60, er_level: 90 } },
    },
    {
      datei: "m07b-room-long",
      name: "Room Long",
      zweck: "Lange Fahne, offen, mit Vorlauf — die grosse Halle.",
      mfx: { werte: { time: 100, hi_damp: 40, pre_delay: 30, rev_level: 120, er_level: 30 } },
    },
  ],
  "m08-tape-echo": [
    {
      datei: "m08a-tape-echo-clean",
      name: "Tape Echo Clean",
      zweck: "Wenig Rueckkopplung, kaum Saettigung — ein sauberes Echo.",
      mfx: { werte: { feedback: 55, saturation: 20, hi_damp: 40, lo_damp: 20 } },
    },
    {
      datei: "m08b-tape-echo-wash",
      name: "Tape Echo Wash",
      zweck: "Fast selbstschwingend, gesaettigt, mit Gleichlaufschwankung — die Fahne kippt.",
      mfx: { werte: { feedback: 118, saturation: 110, hi_damp: 115, lfo_depth: 40 } },
    },
  ],
  "m09-mod-delay": [
    {
      datei: "m09a-mod-delay-dry",
      name: "Mod Delay Dry",
      zweck: "Ohne Modulation, wenig Rueckkopplung — ein gerades Delay zum Vergleichen.",
      mfx: { werte: { fb_depth: 40, mod_depth: 0 } },
    },
    {
      datei: "m09b-mod-delay-wide",
      name: "Mod Delay Wide",
      zweck: "Volle Modulation, breit verteilt, lange Fahne.",
      mfx: { werte: { wet_spread: 127, fb_depth: 115, mod_depth: 110, mod_freq: 40 } },
    },
  ],
  "m10-grain-stutter": [
    {
      datei: "m10a-grain-fine",
      name: "Grain Fine",
      zweck: "Kurze Koerner, schnelle Rate — surrt.",
      mfx: { werte: { off_duration: 12, off_lfo_freq: 110 } },
    },
    {
      datei: "m10b-grain-rough",
      name: "Grain Rough",
      zweck: "Lange Koerner, langsame Rate — stottert hoerbar. Mit „Fine“ zusammen sagt das Paar, was off_duration tut.",
      mfx: { werte: { off_duration: 90, off_lfo_freq: 20 } },
    },
  ],
  "m11-vinyl-stop": [
    {
      datei: "m11a-vinyl-slow",
      name: "Vinyl Slow",
      zweck: "Traeger Auslauf: weniger Tonhoehenabfall, laengere Verzoegerung.",
      mfx: { werte: { delta_pitch: 40, scratch_lag: 20, asobi: 40 } },
      regler: [
        { quelle: Q.beruehrt, param: "pad_on", min: 0, max: 1 },
        { quelle: Q.reglerX, param: "delta_pitch", min: 0, max: 80 },
        { quelle: Q.achseY, param: "scratch", min: 0, max: 127 },
      ],
    },
    {
      datei: "m11b-vinyl-scratch",
      name: "Vinyl Scratch",
      zweck: "Kratzen statt Stoppen: die Flaeche wird zum Plattenteller. X = Kratzen, Y = Weite.",
      mfx: { werte: { scratch: 90, scratch_width: 100, scratch_lag: 1 } },
      regler: [
        { quelle: Q.beruehrt, param: "pad_on", min: 0, max: 1 },
        { quelle: Q.reglerX, param: "scratch", min: 0, max: 127 },
        { quelle: Q.achseY, param: "scratch_width", min: 0, max: 127 },
      ],
    },
  ],
  "m12-master-crush": [
    {
      datei: "m12a-crush-rate",
      name: "Crush Rate",
      zweck: "Nur die Abtastrate runter — Aliasing ueber die Summe.",
      mfx: { werte: { sample_freq: 12, bit_depth: 16 } },
    },
    {
      datei: "m12b-crush-bits",
      name: "Crush Bits",
      zweck: "Nur die Aufloesung runter. X zieht hier die Bits, Y bleibt die Rate.",
      mfx: { werte: { sample_freq: 100, bit_depth: 3 } },
      regler: [
        { quelle: Q.reglerX, param: "bit_depth", min: 2, max: 16 },
        { quelle: Q.achseY, param: "sample_freq", min: 6, max: 127 },
      ],
    },
  ],
};

// ─── Bauen ───────────────────────────────────────────────────────────────────

const tabelle = (istMfx) => (istMfx ? MFX_TYPES : IFX_TYPES);
const werkswerte = (istMfx) => (istMfx ? WERKSWERTE_MFX : WERKSWERTE_IFX);

/** Parameterliste eines Algorithmus, mit Werkswerten vorbelegt. */
function parameter(device, werte, istMfx) {
  const namen = tabelle(istMfx)[device]?.params ?? [];
  const basis = werkswerte(istMfx)[device];
  if (!basis) throw new Error(`Keine Werkswerte fuer Algorithmus 0x${device.toString(16)}`);
  if (basis.length !== namen.length) {
    throw new Error(`Algorithmus 0x${device.toString(16)}: ${basis.length} Werkswerte, ${namen.length} Parameter`);
  }
  const out = [...basis];
  for (const [k, v] of Object.entries(werte)) {
    const i = namen.indexOf(k);
    if (i < 0) throw new Error(`Algorithmus 0x${device.toString(16)} hat keinen Parameter "${k}"`);
    if (!Number.isInteger(v) || v < 0 || v > 127) throw new Error(`"${k}" = ${v} liegt nicht in 0..127`);
    out[i] = v;
  }
  return out;
}

/** Index eines Parameters im gewaehlten Kettenglied — das braucht die Zuordnung. */
function paramIndex(device, name, istMfx) {
  const i = (tabelle(istMfx)[device]?.params ?? []).indexOf(name);
  if (i < 0) throw new Error(`Zuordnung auf unbekannten Parameter "${name}"`);
  return i;
}

/**
 * Eine Variation aus ihrer Basis ableiten: Algorithmus und alle nicht genannten
 * Parameter kommen von dort, nur die Abweichungen stehen in `v`. Der
 * Algorithmus ist bewusst **nicht** ueberschreibbar — sonst waere es keine
 * Variation, sondern ein anderes Preset, und der Vergleich am Geraet ginge
 * verloren.
 */
function variante(basis, v) {
  const misch = (rolle) =>
    basis[rolle] || v[rolle]
      ? { device: basis[rolle]?.device ?? A.thru, werte: { ...(basis[rolle]?.werte ?? {}), ...(v[rolle]?.werte ?? {}) } }
      : undefined;
  return {
    art: basis.art,
    datei: v.datei,
    name: v.name,
    zweck: v.zweck,
    basisName: basis.name,
    ifx1: misch("ifx1"),
    ifx2: misch("ifx2"),
    mfx: misch("mfx"),
    regler: v.regler ?? basis.regler,
  };
}

/** Alle Variationen zu einer Liste von Basis-Presets, in deren Reihenfolge. */
function variationen(basisListe) {
  return basisListe.flatMap((b) => (VARIATIONEN[b.datei] ?? []).map((v) => variante(b, v)));
}

function baue(def) {
  const roh = initFxPresetBytes();
  const p = decodeFxPreset(roh, def.art === "mfx");

  if (def.name.length > 15) throw new Error(`Name "${def.name}" ist laenger als 15 Zeichen`);
  p.name = def.name;

  // Nicht genutzte Stufen bleiben Thru: ein Insert-Preset soll beim Schreiben
  // nicht den Master umstellen, ein Master-Preset nicht die Inserts.
  const stufen = {
    ifx1: def.ifx1 ?? { device: A.thru, werte: {} },
    ifx2: def.ifx2 ?? { device: A.thru, werte: {} },
    mfx: def.mfx ?? { device: M.thru, werte: {} },
  };
  for (const [rolle, s] of Object.entries(stufen)) {
    const istMfx = rolle === "mfx";
    p[rolle].device = s.device;
    p[rolle].params = parameter(s.device, s.werte, istMfx);
  }

  // Zwei-Inserts nur mit zwei leichten Algorithmen (siehe Modul-Kopf).
  if (def.ifx2) {
    for (const rolle of ["ifx1", "ifx2"]) {
      const d = stufen[rolle].device;
      if (!IFX2_FAEHIG.includes(d)) {
        throw new Error(`${def.name}: ${rolle} 0x${d.toString(16)} ist fuer zwei Inserts zu schwer`);
      }
    }
  }

  p.controlMap = p.controlMap.map(() => ({ quelle: 0, quelleName: "", kette: 0, ketteName: "", zielParam: 0, min: 0, max: 0 }));
  def.regler.forEach((r, i) => {
    const kette = r.kette ?? (def.art === "mfx" ? KETTE.mfx : KETTE.ifx1);
    const rolle = kette === KETTE.mfx ? "mfx" : kette === KETTE.ifx2 ? "ifx2" : "ifx1";
    p.controlMap[i] = {
      quelle: r.quelle ?? Q.reglerX,
      quelleName: "",
      kette,
      ketteName: "",
      zielParam: paramIndex(stufen[rolle].device, r.param, rolle === "mfx"),
      min: r.min,
      max: r.max,
    };
  });

  const bytes = encodeFxPreset(p, roh);
  if (bytes.length !== FX_PRESET_SIZE) throw new Error(`${def.name}: ${bytes.length} statt ${FX_PRESET_SIZE} Bytes`);
  return bytes;
}

/**
 * Eine Gruppe schreiben: Einzeldateien plus die Sammlung, die alle auf einmal
 * laedt. Die Endung entscheidet im Editor die Art — `.mfx` stellt `ausDatei()`
 * selbst auf Master-Effekt um.
 */
function schreibeGruppe(presets, endung, sammlungsDatei, titel) {
  const eintraege = [];
  for (const def of presets) {
    const bytes = baue(def);
    const datei = path.join(ZIEL, `${def.datei}.${endung}`);
    fs.writeFileSync(datei, bytes);
    eintraege.push({ art: def.art, name: def.name, bytes });
    const p = decodeFxPreset(bytes, def.art === "mfx");
    const stufe = def.art === "mfx" ? p.mfx : p.ifx1;
    const zweiter = def.art === "ifx" && p.ifx2.device ? ` + ${p.ifx2.algorithmus}` : "";
    const her = def.basisName ? `  ← ${def.basisName}` : "";
    console.log(`${datei.padEnd(48)} „${p.name}" — ${stufe.algorithmus || "Punch"}${zweiter}${her}`);
  }
  const ziel = path.join(ZIEL, sammlungsDatei);
  fs.writeFileSync(ziel, baueSammlung(eintraege, { titel, autor: "TekkForge", wann: "2026-08-31T00:00:00.000Z" }));
  console.log(`${ziel.padEnd(48)} ${eintraege.length} Presets in einer Datei.\n`);
}

fs.mkdirSync(ZIEL, { recursive: true });
schreibeGruppe(INSERT_PRESETS, "e2fxp", "TekkForge-IFX-Starter.tfsam", "TekkForge IFX Starter");
schreibeGruppe(MASTER_PRESETS, "mfx", "TekkForge-MFX-Starter.tfsam", "TekkForge MFX Starter");
schreibeGruppe(variationen(INSERT_PRESETS), "e2fxp", "TekkForge-IFX-Variationen.tfsam", "TekkForge IFX Variationen");
schreibeGruppe(variationen(MASTER_PRESETS), "mfx", "TekkForge-MFX-Variationen.tfsam", "TekkForge MFX Variationen");

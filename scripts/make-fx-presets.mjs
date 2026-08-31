/**
 * Erzeugt die Beispiel-IFX-Presets in `examples/fx-presets/` — zwoelf fertig
 * eingestellte 524-Byte-Bloecke plus eine Sammlung, die alle auf einmal laedt.
 *
 *   npx tsx scripts/make-fx-presets.mjs [zielordner]
 *
 * ## Wozu
 *
 * Der Preset-Editor kann bisher nur weiterreichen, was vorher vom Geraet kam.
 * Zum Ausprobieren des Schreibpfads braucht es aber etwas, das man ohne Geraet
 * in der Hand hat: Bloecke, in denen jeder Wert gesetzt ist, mit Namen, der im
 * Geraetemenue auftaucht, und mit einer Zuordnung auf den IFX-Regler, damit
 * beim Drehen auch etwas passiert.
 *
 * ## Woher die Werte kommen — und woher nicht
 *
 * Jedes Preset startet auf den **werkseitigen Defaults** des jeweiligen
 * Algorithmus (`WERKSWERTE` unten, bit-genau aus hacktribe-editor
 * `utils/ht_fx_ram_format.py`, denselben Zahlen wie in Synthstudios
 * `e2FxDefaults.ts`). Nur benannte Parameter werden davon abgewichen.
 *
 * Was das **nicht** ist: eine Vermessung. Semantische Bereiche und Einheiten
 * der Parameter sind in hacktribe nicht hinterlegt (dort als TODO markiert) —
 * bekannt ist nur 0..127. Die Abweichungen hier folgen dem Parameternamen und
 * der Richtung, die er nahelegt (`gain` hoch heisst mehr Zerre, `bit_depth`
 * runter heisst mehr Kruemel). Ein Wert wie `lfo_sync_note = 6` steht auf dem
 * Werkswert, weil die Notenwert-Tabelle dahinter unbekannt ist — geraten wird
 * nicht. Am Geraet gehoert hat das hier niemand; genau dafuer sind es
 * Testdateien.
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
import { IFX_TYPES } from "../src/core/e2FxParams.ts";
import { baueSammlung } from "../src/core/sammlung.ts";

const ZIEL = process.argv[2] ?? "examples/fx-presets";

/** Algorithmus-Kennungen, damit die Definitionen unten lesbar bleiben. */
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

/** Quelle einer Zuordnung im Preset-Block (0x41–0x4A, NICHT die RAM-Kodierung). */
const IFX_REGLER = 0x42;
/** Kettenplatz einer Zuordnung. */
const KETTE = { ifx1: 0x00, ifx2: 0x01 };

/**
 * Werkseitige Parameterwerte je IFX-Algorithmus, Index-gleich zu
 * `IFX_TYPES[id].params`. Bit-genau aus hacktribe-editor `ht_fx_ram_format.py`
 * (die `Default(Int8ul, …)` je `*_params`-Struct).
 *
 * Ohne diese Basis stuende jeder nicht ausdruecklich gesetzte Parameter auf 0
 * — bei mehreren Algorithmen heisst das `dry_wet = 0`, also ein Effekt, den
 * man nicht hoert.
 */
const WERKSWERTE = {
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

/**
 * Die Presets. `ifx1`/`ifx2` geben den Algorithmus und die Abweichungen von
 * den Werkswerten (Parameter **beim Namen**, nicht per Index — ein Tippfehler
 * fliegt dann beim Bauen auf statt still im falschen Byte zu landen).
 * `regler` legt fest, was der IFX-Regler am Geraet zieht.
 */
const PRESETS = [
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
];

// ─── Bauen ───────────────────────────────────────────────────────────────────

/** Parameterliste eines Algorithmus, mit Werkswerten vorbelegt. */
function parameter(device, werte) {
  const namen = IFX_TYPES[device]?.params ?? [];
  const basis = WERKSWERTE[device];
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
function paramIndex(device, name) {
  const i = (IFX_TYPES[device]?.params ?? []).indexOf(name);
  if (i < 0) throw new Error(`Zuordnung auf unbekannten Parameter "${name}"`);
  return i;
}

function baue(def) {
  const roh = initFxPresetBytes();
  const p = decodeFxPreset(roh, false);

  if (def.name.length > 15) throw new Error(`Name "${def.name}" ist laenger als 15 Zeichen`);
  p.name = def.name;

  const stufen = { ifx1: def.ifx1, ifx2: def.ifx2 ?? { device: A.thru, werte: {} } };
  for (const [rolle, s] of Object.entries(stufen)) {
    p[rolle].device = s.device;
    p[rolle].params = parameter(s.device, s.werte);
  }
  // MFX bleibt Thru: diese Dateien gehen in IFX-Plaetze, der Master-Effekt
  // gehoert nicht dazu und soll beim Schreiben nichts umstellen.
  p.mfx.device = A.thru;
  p.mfx.params = [];

  // Zwei-Inserts nur mit zwei leichten Algorithmen (siehe Modul-Kopf).
  if (def.ifx2) {
    for (const [rolle, s] of Object.entries(stufen)) {
      if (!IFX2_FAEHIG.includes(s.device)) {
        throw new Error(`${def.name}: ${rolle} 0x${s.device.toString(16)} ist fuer zwei Inserts zu schwer`);
      }
    }
  }

  p.controlMap = p.controlMap.map(() => ({ quelle: 0, quelleName: "", kette: 0, ketteName: "", zielParam: 0, min: 0, max: 0 }));
  def.regler.forEach((r, i) => {
    const device = r.kette === KETTE.ifx2 ? stufen.ifx2.device : stufen.ifx1.device;
    p.controlMap[i] = {
      quelle: IFX_REGLER,
      quelleName: "",
      kette: r.kette,
      ketteName: "",
      zielParam: paramIndex(device, r.param),
      min: r.min,
      max: r.max,
    };
  });

  const bytes = encodeFxPreset(p, roh);
  if (bytes.length !== FX_PRESET_SIZE) throw new Error(`${def.name}: ${bytes.length} statt ${FX_PRESET_SIZE} Bytes`);
  return bytes;
}

fs.mkdirSync(ZIEL, { recursive: true });
const eintraege = [];
for (const def of PRESETS) {
  const bytes = baue(def);
  const datei = path.join(ZIEL, `${def.datei}.e2fxp`);
  fs.writeFileSync(datei, bytes);
  eintraege.push({ art: "ifx", name: def.name, bytes });
  const p = decodeFxPreset(bytes, false);
  const zweiter = p.ifx2.device ? ` + ${p.ifx2.algorithmus}` : "";
  console.log(`${datei.padEnd(44)} „${p.name}" — ${p.ifx1.algorithmus || "Punch"}${zweiter}`);
}

const sammlung = path.join(ZIEL, "TekkForge-IFX-Starter.tfsam");
fs.writeFileSync(
  sammlung,
  baueSammlung(eintraege, { titel: "TekkForge IFX Starter", autor: "TekkForge", wann: "2026-08-31T00:00:00.000Z" }),
);
console.log(`\n${sammlung} — ${eintraege.length} Presets in einer Datei.`);

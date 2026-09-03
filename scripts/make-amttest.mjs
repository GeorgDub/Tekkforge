/**
 * Erzeugt AMTTEST.all + AMTTEST1.e2spat + AMTTEST2.e2spat — das Hoerset fuer
 * die DSP-Amount-Kurve (Punkt 25, A/B „alles Maximum" ↔ „alles Minimum").
 *
 * Die 14-stufige Kurve liegt im SAMPLE-Pfad des BF523 (Block 15), ihre Rolle
 * ist offen: Filter-Anteil, Pegel oder Modulationstiefe. Der Nutzer hoerte am
 * 2026-09-03 auf „alles Maximum" ein „glaube anders, aber nicht sicher". Das
 * Set ist so gebaut, dass eine Aenderung nicht zu ueberhoeren ist:
 *
 *   AMTTEST1 — FILTER: Paare aus Sample und Synth-Oszillator mit derselben
 *     Einstellung. Aendert sich nur die Sample-Haelfte, ist die Kurve im
 *     Sample-Pfad und wirkt auf Filter/EG.
 *       P1 Sample  LPF cutoff 8,  res 90, EG-Int +63, Decay 110   (EG-Sweep)
 *       P2 Synth   dasselbe mit SAW
 *       P3 Sample  LPF cutoff 30, res 127                          (Resonanz)
 *       P4 Synth   dasselbe
 *       P5 Sample  LPF cutoff 60, res 100, EG-Int −63              (EG negativ)
 *       P6 Synth   dasselbe
 *       P7 Noise   LPF cutoff 40, res 110, EG-Int +63
 *       P8 Sample  ohne Filter, Velocity-Rampe 20…127               (Pegel)
 *
 *   AMTTEST2 — MODULATION: acht Mod-Typen (Speicher 0…7) mit Depth 127 auf
 *     dem Sample, dazwischen dieselben auf SAW. Aendert sich die Tiefe, ist
 *     die Kurve die Modulationstiefe.
 *
 * Jeder Part spielt seine acht Steps allein, 120 BPM — man hoert die Parts
 * nacheinander, je vier Sekunden. Beide Patterns brauchen AMTTEST.all
 * (501 SAW 2 s, 502 NOISE 2 s).
 *
 * ⚠ „Sample Import All" ersetzt die User-Samples 501–999. Wer eigene Samples
 * am Geraet hat, exportiert sie vorher oder spielt sein Set danach zurueck.
 *
 * Aufruf: node scripts/make-amttest.mjs [zielordner]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildE2PatternFileV2 } from "../src/core/e2sExport.ts";
import { bankNumberToE2PatternRef } from "../src/core/e2sPatternSampleLink.ts";
import { createPattern, buildBankFiles, EDITOR_PARTS } from "../src/core/editorModel.ts";

const SR = 44100;
const ZIEL = process.argv[2] ?? "examples/e2s";
const N = 64;
const TIE = 0xff;

// ─── Samples ─────────────────────────────────────────────────────────────────

/** Sägezahn 110 Hz, zwei Sekunden, weiche Ränder — obertonreich, damit ein Filter etwas zu tun hat. */
function saege(sekunden) {
  const n = Math.round(SR * sekunden);
  const pcm = new Float32Array(n);
  const hz = 110;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const ph = (t * hz) % 1;
    const huelle = Math.min(1, i / (SR * 0.005), (n - i) / (SR * 0.05));
    pcm[i] = (2 * ph - 1) * 0.6 * huelle;
  }
  return pcm;
}

/** Weisses Rauschen, zwei Sekunden, deterministisch (LCG). */
function rauschen(sekunden) {
  const n = Math.round(SR * sekunden);
  const pcm = new Float32Array(n);
  let x = 12345;
  for (let i = 0; i < n; i++) {
    x = (x * 1664525 + 1013904223) >>> 0;
    const huelle = Math.min(1, i / (SR * 0.005), (n - i) / (SR * 0.05));
    pcm[i] = ((x / 0xffffffff) * 2 - 1) * 0.5 * huelle;
  }
  return pcm;
}

const samples = [
  { number: 501, name: "AMT SAW", sampleRate: SR, pcm: saege(2) },
  { number: 502, name: "AMT NOISE", sampleRate: SR, pcm: rauschen(2) },
];

// ─── Patterns ────────────────────────────────────────────────────────────────

const SAW_OSC = 1; // Oszillator-Platz 1 = SAW (Anzeige), Referenz 0
const MONO1 = 0;
const steps = (fn) => Array.from({ length: N }, (_, s) => fn(s) ?? { active: false });
/** Part i spielt in seinem Achtel des Patterns: Steps 8i, 8i+3 (zwei Anschläge). */
const fenster = (i, velocity = 120, gate = 40) =>
  steps((s) => (s === 8 * i || s === 8 * i + 3 ? { active: true, notes: [60], velocity, gate } : null));

const LPF = 0; // Filter-Typ Speicher 0 = erste Anzeige (LPF)

function part(sample, params, st) {
  const aktiv = st.filter((s) => s.active).length;
  return {
    sampleId: bankNumberToE2PatternRef(sample),
    steps: st,
    params: { voiceAssign: MONO1, egAttack: 0, ampEgOn: 1, ...params },
    muted: aktiv === 0,
  };
}

const filterParts = [
  part(501, { filterType: LPF, cutoff: 8, resonance: 90, egInt: 63, egDecay: 110 }, fenster(0)),
  part(SAW_OSC, { filterType: LPF, cutoff: 8, resonance: 90, egInt: 63, egDecay: 110 }, fenster(1)),
  part(501, { filterType: LPF, cutoff: 30, resonance: 127, egInt: 0, egDecay: 110 }, fenster(2)),
  part(SAW_OSC, { filterType: LPF, cutoff: 30, resonance: 127, egInt: 0, egDecay: 110 }, fenster(3)),
  part(501, { filterType: LPF, cutoff: 60, resonance: 100, egInt: -63, egDecay: 110 }, fenster(4)),
  part(SAW_OSC, { filterType: LPF, cutoff: 60, resonance: 100, egInt: -63, egDecay: 110 }, fenster(5)),
  part(502, { filterType: LPF, cutoff: 40, resonance: 110, egInt: 63, egDecay: 110 }, fenster(6)),
  // Pegel: Velocity-Rampe 20…127 auf acht Steps, ohne Filterbewegung
  part(
    501,
    { filterType: LPF, cutoff: 127, resonance: 0, egInt: 0, egDecay: 110 },
    steps((s) => (s >= 56 ? { active: true, notes: [60], velocity: 20 + Math.round(((s - 56) * 107) / 7), gate: 20 } : null)),
  ),
];
while (filterParts.length < 16) filterParts.push(part(501, {}, steps(() => null)));

// Modulation: Mod-Typ 0…7 (Speicher), Depth 127, Speed 70 — Sample und SAW im Wechsel, je vier Steps
const modParts = [];
for (let m = 0; m < 8; m++) {
  const st = (i) => steps((s) => (s === 8 * m + i || s === 8 * m + i + 2 ? { active: true, notes: [60], velocity: 120, gate: 30 } : null));
  modParts.push(part(501, { filterType: LPF, cutoff: 70, resonance: 60, egInt: 0, egDecay: 100, modType: m, modSpeed: 70, modDepth: 127 }, st(0)));
  modParts.push(part(SAW_OSC, { filterType: LPF, cutoff: 70, resonance: 60, egInt: 0, egDecay: 100, modType: m, modSpeed: 70, modDepth: 127 }, st(4)));
}

const dateiVon = (name, parts) => Buffer.from(buildE2PatternFileV2({ name, bpm: 120, stepLength: 64, parts, alternate13_14: false, alternate15_16: false }));

// ─── Bank ────────────────────────────────────────────────────────────────────

const dummy = createPattern("AMTTEST");
for (let i = 0; i < EDITOR_PARTS; i++) dummy.parts[i].muted = true;
const { all, warnings } = buildBankFiles({ version: 1, patterns: [dummy], samples });
if (!all) throw new Error("Bank ist leer");

fs.mkdirSync(ZIEL, { recursive: true });
const wegAll = path.join(ZIEL, "AMTTEST.all");
const weg1 = path.join(ZIEL, "AMTTEST1.e2spat");
const weg2 = path.join(ZIEL, "AMTTEST2.e2spat");
fs.writeFileSync(wegAll, all);
fs.writeFileSync(weg1, dateiVon("AMT FILTER", filterParts));
fs.writeFileSync(weg2, dateiVon("AMT MOD", modParts));
console.log(`${wegAll} — ${all.length} Bytes (501 AMT SAW, 502 AMT NOISE, je 2 s)`);
console.log(`${weg1} — AMT FILTER: P1/2 EG-Sweep, P3/4 Resonanz, P5/6 EG negativ, P7 Noise, P8 Velocity-Rampe`);
console.log(`${weg2} — AMT MOD: Mod-Typ 1…8 (Anzeige), Depth 127, je Sample dann SAW`);
for (const w of warnings) console.log(`  ⚠ ${w}`);
console.log("\nAm Geraet: AMTTEST.all (Sample Import All) laden, dann die beiden .e2spat (Pattern Import).\nA/B: dieselbe Datei auf Firmware „alles Maximum“ und „alles Minimum“ hoeren — Sample-Parts gegen Synth-Parts.");

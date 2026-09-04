/**
 * Erzeugt MOTTEST.e2spat — das Hoerset fuer die Motion-ParamIDs aus
 * core/motionGen.ts. Braucht AMTTEST.all (501 AMT SAW).
 *
 * Vier Parts, jeder mit vier Anschlaegen je Takt (volle 64 Steps) und
 * je EINEM Motion-Slot; die uebrigen Parts sind gemutet:
 *
 *   P1  ID 5  Cutoff-Rampe 20 → 127 ueber vier Takte   → muss hoerbar aufgehen
 *   P2  ID 2  Pitch-Fall ab Step 48 von 64 auf 20       → muss im letzten Takt fallen
 *   P3  ID 4  Osc-Edit-Rampe 0 → 127 (gemessene ID)    → Referenz: muss etwas tun
 *   P4  kein Slot                                        → Referenz: bleibt gleich
 *   global ID 16 Master-FX-Edit 0 → 100 (MFX 12 Grain Shifter)
 *
 * Tut P1 nichts, ist 5 nicht der Cutoff; faellt P2 nicht, ist 2 nicht der
 * Pitch. Was stattdessen passiert, sagt, welcher Parameter es wirklich ist.
 *
 * Aufruf: node scripts/make-mottest.mjs [zielordner]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildE2PatternFileV2 } from "../src/core/e2sExport.ts";
import { bankNumberToE2PatternRef } from "../src/core/e2sPatternSampleLink.ts";
import { rampe, fall, MOTION_PARAM } from "../src/core/motionGen.ts";

const ZIEL = process.argv[2] ?? "examples/e2s";
const N = 64;
const steps = (fn) => Array.from({ length: N }, (_, s) => fn(s) ?? { active: false });
const viertel = () => steps((s) => (s % 4 === 0 ? { active: true, notes: [60], velocity: 120, gate: 40 } : null));

const params = { voiceAssign: 0, filterType: 0, cutoff: 60, resonance: 40, egInt: 0, egAttack: 0, egDecay: 110, ampEgOn: 1, ifxOn: 1, ifxType: 8, ifxEdit: 40 };
const parts = [0, 1, 2, 3].map(() => ({ sampleId: bankNumberToE2PatternRef(501), steps: viertel(), params: { ...params }, muted: false }));
while (parts.length < 16) parts.push({ sampleId: bankNumberToE2PatternRef(501), steps: steps(() => null), params: {}, muted: true });

const motionSlots = [
  { paramId: MOTION_PARAM.cutoff, targetPart: 0, values: rampe(20, 127) },
  { paramId: MOTION_PARAM.pitch, targetPart: 1, values: fall(48, 64, 20) },
  { paramId: MOTION_PARAM.oscEdit, targetPart: 2, values: rampe(0, 127) },
  { paramId: MOTION_PARAM.mfxEdit, targetPart: -1, values: rampe(0, 100) },
];

fs.mkdirSync(ZIEL, { recursive: true });
const weg = path.join(ZIEL, "MOTTEST.e2spat");
fs.writeFileSync(weg, Buffer.from(buildE2PatternFileV2({ name: "MOT TEST", bpm: 120, stepLength: 64, mfxType: 11, parts, motionSlots, alternate13_14: false, alternate15_16: false })));
console.log(`${weg} — P1 Cutoff(5) Rampe | P2 Pitch(2) Fall ab Takt 4 | P3 OscEdit(4) Rampe | P4 ohne | global MFX-Edit(16) Rampe`);
console.log("Braucht AMTTEST.all (501). P4 ist die Referenz ohne Motion.");

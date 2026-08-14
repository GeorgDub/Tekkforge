/**
 * Erzeugt ein Testpattern zur Pruefung der Akkord-Unterstuetzung am Geraet.
 *
 * Aufbau (16 Steps, 100 BPM):
 *   Part 1  (Kick)  Steps 1/5/9/13 — einstimmig, als Taktreferenz
 *   Part 11 (Lead)  Steps 1/5/9/13 — 1, 2, 3 und 4 Toene, sonst identisch
 *   Part 16 (FX)    Step 16        — der am Geraet gemessene Grenzfall
 *
 * Auf Part 11 waechst der Akkord Step fuer Step um genau einen Ton. Alles
 * andere bleibt gleich, damit ein Unterschied nur vom Akkord kommen kann.
 */
import * as fs from "node:fs";
import { buildE2PatternFileV2 } from "../src/core/e2sExport.ts";

const leer = () => ({ steps: [] });
const parts = Array.from({ length: 16 }, leer);

const schritt = (notes) => ({ active: true, notes, velocity: 100, gate: 72 });
const bei = (map) => {
  const steps = [];
  for (let i = 0; i < 16; i++) steps[i] = map[i + 1] ?? { active: false };
  return steps;
};

// Taktreferenz: gleiche Note auf jeder Viertel.
parts[0] = { steps: bei({ 1: schritt([60]), 5: schritt([60]), 9: schritt([60]), 13: schritt([60]) }) };

// Der eigentliche Test: 1 -> 2 -> 3 -> 4 Toene.
parts[10] = {
  steps: bei({
    1: schritt([60]),
    5: schritt([60, 64]),
    9: schritt([60, 64, 67]),
    13: schritt([60, 64, 67, 71]),
  }),
};

// Grenzfall: hoechste und niedrigste Note, die das Geraet kennt.
parts[15] = { steps: bei({ 16: schritt([127, 126, 124, 0]) }) };

const buf = Buffer.from(buildE2PatternFileV2({ name: "CHORDTEST", bpm: 100, stepLength: 16, parts }));
const ziel = process.argv[2] ?? "examples/e2s/CHORDTEST.e2spat";
fs.writeFileSync(ziel, buf);
console.log(`${ziel} — ${buf.length} Bytes`);

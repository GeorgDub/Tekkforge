/**
 * Erzeugt CHORDTEST.e2spat — Testpattern fuer Akkorde UND Sample-Zuweisung.
 *
 * Geprueft werden zwei Dinge auf einmal:
 *
 *   Akkorde        Part 11 spielt auf 1/5/9/13 einen Akkord, der Step fuer
 *                  Step um genau einen Ton waechst. Velocity und Gate bleiben
 *                  gleich, damit ein Unterschied nur vom Akkord kommen kann.
 *                  Part 1 laeuft einstimmig als Taktreferenz mit.
 *                  Part 16 traegt den Grenzfall G9/F#9/E9/C-1.
 *
 *   Zuweisung      Alle 16 Parts bekommen ein zur Rolle passendes Sample aus
 *                  der Bank — auch die, die keinen Step spielen. Am Geraet
 *                  laesst sich so jede einzelne Zuweisung ablesen, nicht nur
 *                  die drei hoerbaren.
 *
 * Die Sample-Nummern stehen NICHT roh im Pattern: das Geraet legt sie um eins
 * niedriger ab (siehe bankNumberToE2PatternRef). Genau diese Umrechnung ist
 * hier mit unter Test.
 */
import * as fs from "node:fs";
import { buildE2PatternFileV2 } from "../src/core/e2sExport.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import { bankNumberToE2PatternRef } from "../src/core/e2sPatternSampleLink.ts";

const BANK = process.argv[3] ?? "C:/Users/admin/Desktop/omnitribe-hwtest-kit/luknkicks.all";
const ZIEL = process.argv[2] ?? "examples/e2s/CHORDTEST.e2spat";

// Rolle → Sample-Nummer aus luknkicks.all, nach Name und Laenge gewaehlt.
const ZUWEISUNG = [
  ["Kick", 590], ["Kick 2", 585], ["Snare", 562], ["Clap", 550],
  ["HiHat cl", 553], ["HiHat op", 615], ["Perc 1", 549], ["Perc 2", 592],
  ["Bass", 600], ["Bass 2", 537], ["Lead", 530], ["Stab 1", 543],
  ["Stab 2", 531], ["Stab 3", 512], ["Pad", 501], ["FX", 548],
];

const buf = fs.readFileSync(BANK);
const bank = parseE2sBank(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const nameVon = new Map(bank.slots.filter((s) => s && s.frames > 0).map((s) => [s.sampleNumber, s.name.trim()]));

const schritt = (notes) => ({ active: true, notes, velocity: 100, gate: 72 });
const bei = (map) => Array.from({ length: 16 }, (_, i) => map[i + 1] ?? { active: false });

const STEPS = {
  1: bei({ 1: schritt([60]), 5: schritt([60]), 9: schritt([60]), 13: schritt([60]) }),
  11: bei({
    1: schritt([60]),
    5: schritt([60, 64]),
    9: schritt([60, 64, 67]),
    13: schritt([60, 64, 67, 71]),
  }),
  16: bei({ 16: schritt([127, 126, 124, 0]) }),
};

const parts = ZUWEISUNG.map(([, nr], i) => ({
  sampleId: bankNumberToE2PatternRef(nr),
  steps: STEPS[i + 1] ?? [],
}));

const out = Buffer.from(buildE2PatternFileV2({ name: "CHORDTEST", bpm: 100, stepLength: 16, parts }));
fs.writeFileSync(ZIEL, out);

console.log(`${ZIEL} — ${out.length} Bytes`);
for (const [i, [rolle, nr]] of ZUWEISUNG.entries()) {
  const fehlt = nameVon.has(nr) ? "" : "  ⚠ nicht in der Bank";
  const steps = STEPS[i + 1] ? STEPS[i + 1].filter((s) => s.active).length : 0;
  console.log(
    `  Part ${String(i + 1).padStart(2)}  ${rolle.padEnd(9)} #${nr} ${(nameVon.get(nr) ?? "?").padEnd(10)}` +
      ` Ref ${String(bankNumberToE2PatternRef(nr)).padStart(3)}  ${steps ? steps + " Steps" : "—"}${fehlt}`,
  );
}

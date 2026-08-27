/**
 * Erzeugt MUTETEST.e2sallpat — Probe fuer das Live-Mute ueber NRPN.
 *
 * Die offene Frage (Messung vom 2026-08-27): ein per NRPN gesetztes Mute
 * taucht im Edit-Buffer-Dump NICHT auf. Ob das Geraet es trotzdem hoerbar
 * umsetzt, kann nur ein Ohr entscheiden.
 *
 * Der Aufbau muss dabei eine Falle vermeiden: schickt die Anwendung nach dem
 * Mute das Pattern erneut, wird der Part auch ohne NRPN still — der Test
 * bewiese dann nichts. Deshalb wird hier NUR das Pattern gesetzt, und das Mute
 * kommt aus der NRPN-Werkbank (Kategorie 0, LSB 0, DATA-MSB = Part, Wert 1/0).
 *
 * Es laufen zwei gut unterscheidbare Klaenge im Wechsel, je zwei Sekunden
 * auseinander, ohne Ueberlappung:
 *
 *   Part 1  Stimme (#501)  bei Step 1 und 33
 *   Part 3  Sweep  (#503)  bei Step 17 und 49
 *
 * Verschwindet beim Mute genau EINER der beiden, wirkt NRPN. Bleibt alles wie
 * es war, wirkt es nicht — und die Mute-Pads muessen den Weg ueber den
 * Edit-Buffer nehmen.
 *
 * Braucht die Bank aus make-ratetest.mjs im Geraet (RATETEST.all).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createPattern, buildBankFiles, EDITOR_PARTS } from "../src/core/editorModel.ts";

const ZIEL = process.argv[2] ?? "examples/e2s";

const pattern = createPattern("MUTETEST");
pattern.bpm = 120; // 16tel = 125 ms, 16 Steps = 2 s
pattern.stepLength = 64;

/** Part-Index → [Sample-Nummer, Steps] */
const BELEGUNG = [
  [0, 501, [0, 32]],
  [2, 503, [16, 48]],
];

for (const [idx, nummer, steps] of BELEGUNG) {
  const part = pattern.parts[idx];
  part.sampleNumber = nummer;
  part.muted = false;
  for (const s of steps) {
    part.steps[s].on = true;
    part.steps[s].velocity = 127;
  }
}
const belegt = new Set(BELEGUNG.map(([i]) => i));
for (let i = 0; i < EDITOR_PARTS; i++) if (!belegt.has(i)) pattern.parts[i].muted = true;

// Keine Samples mitgeben: die Bank liegt schon im Geraet, hier zaehlt nur das
// Pattern. buildBankFiles warnt dann ueber die Verweise — das ist hier richtig
// so und wird nur angezeigt, nicht behandelt.
const { allpat, warnings } = buildBankFiles({ version: 1, patterns: [pattern], samples: [] });
fs.mkdirSync(ZIEL, { recursive: true });
const weg = path.join(ZIEL, "MUTETEST.e2sallpat");
fs.writeFileSync(weg, allpat);

console.log(`${weg} — ${allpat.length} Bytes`);
console.log("  Part 1  #501 Stimme  Steps 1, 33");
console.log("  Part 3  #503 Sweep   Steps 17, 49");
console.log(`  ${warnings.length} Hinweis(e) zu Verweisen — erwartet, die Bank liegt im Geraet.`);
console.log(
  "\nMute per NRPN: Kategorie 0 (Panel), LSB 0 (mute), DATA-MSB = Part-Index (0 = Part 1), Wert 1 = stumm, 0 = an.",
);

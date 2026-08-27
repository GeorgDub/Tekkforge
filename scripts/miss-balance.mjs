/**
 * miss-balance.mjs — was steht in einem fertigen Set gegen was?
 *
 * Rendert ein Pattern gruppenweise (nur Schlagzeug, nur Bass/Stabs, nur
 * Melodie, nur Vocals) und misst jede Gruppe fuer sich. Damit wird aus
 * „die Vocals sind zu leise" eine Zahl, an der man eine Aenderung pruefen kann.
 *
 * Aufruf: node scripts/miss-balance.mjs <bank.all> <bank.e2sallpat> [patternNr]
 */
import * as fs from "node:fs";
import { importE2Patterns, importSamplesFromAll } from "../src/core/editorModel.ts";
import { rendere } from "../src/core/patternRender.ts";

const [, , wegAll, wegPat, nrRoh] = process.argv;
const nr = Number(nrRoh ?? 7);

const bankBytes = fs.readFileSync(wegAll);
const patBytes = fs.readFileSync(wegPat);
const samples = importSamplesFromAll(new Uint8Array(bankBytes.buffer, bankBytes.byteOffset, bankBytes.byteLength));
const { patterns } = importE2Patterns(new Uint8Array(patBytes.buffer, patBytes.byteOffset, patBytes.byteLength), true);
const p = patterns[nr - 1];
if (!p) throw new Error(`Pattern ${nr} gibt es nicht (${patterns.length} vorhanden)`);

/** Part-Gruppen nach der festen Belegung des Generators. */
const GRUPPEN = [
  ["Schlagzeug", [0, 1, 2, 3, 4, 5, 6, 7]],
  ["Bass/Stab", [8, 9]],
  ["Shots", [10, 11]],
  ["Melodie", [12, 13]],
  ["Vocals", [14, 15]],
];

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

function rms(pcm) {
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return Math.sqrt(s / Math.max(1, pcm.length));
}

/** Nur die genannten Parts hoerbar lassen — der Rest wird stummgeschaltet. */
function nur(pattern, idx) {
  const kopie = structuredClone({ ...pattern, rawBody: undefined });
  kopie.parts = pattern.parts.map((part, i) => ({
    ...part,
    steps: part.steps.map((s) => ({ ...s })),
    muted: !idx.includes(i),
  }));
  return kopie;
}

console.log(`Pattern ${nr}: „${p.name}"  ${p.bpm} BPM, ${p.stepLength} Steps`);
const werte = [];
for (const [name, idx] of GRUPPEN) {
  // Der Renderer liefert stereo-verschraenkt; fuer den Pegel reicht der
  // Mittelwert beider Kanaele.
  const r = rendere(nur(p, idx), samples, {});
  const pcm = r.pcm;
  const wert = rms(pcm);
  werte.push([name, wert]);
  const aktiv = idx.filter((i) => p.parts[i].steps.some((s) => s.on)).length;
  console.log(
    `  ${name.padEnd(11)} ${db(wert).toFixed(1).padStart(7)} dB RMS   ${aktiv} aktive Part(s)   ` +
      `Vol ${idx.map((i) => p.parts[i].volume).join("/")}`,
  );
}
const drums = werte.find(([n]) => n === "Schlagzeug")[1];
for (const [name, wert] of werte) {
  if (name === "Schlagzeug") continue;
  console.log(`  ${name.padEnd(11)} gegen Schlagzeug: ${(db(wert) - db(drums) >= 0 ? "+" : "") + (db(wert) - db(drums)).toFixed(1)} dB`);
}

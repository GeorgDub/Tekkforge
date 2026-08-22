/**
 * Erzeugt eine .all-Bank aus einem manifest.json (prep-drogen.py): nur die
 * Samples des Ordners, fortlaufend ab einer Startnummer (Default 661 — hinter
 * round1b, damit die Nummern ueber alle Round-Baenke eindeutig bleiben).
 * Loops (kind "loop") bekommen 64 Slice-Marker (Sechzehntel ueber 4 Takte).
 * Schreibt die vergebenen Nummern als `nr` in <ordner>/bank-<zielname>.json.
 *
 * Aufruf: npx tsx scripts/make-folder-bank.mjs <ordner-mit-manifest> <ziel.all> [startnr]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildE2sBank } from "../src/core/e2sBankBuilder.ts";
import { parseWav } from "../src/core/wavCodec.ts";
import {
  displayNumberToOsc,
  displayNumberToSlotIndex,
  oscToDisplayNumber,
} from "../src/core/e2sPatternSampleLink.ts";

const ORDNER = process.argv[2] ?? "examples/e2s/drogen";
const ZIEL = process.argv[3] ?? "examples/e2s/drogen.all";
const START = Number(process.argv[4] ?? 661);

const manifest = JSON.parse(fs.readFileSync(path.join(ORDNER, "manifest.json"), "utf8"));

function slicesFuer(pcm, anzahl) {
  if (!anzahl) return {};
  const frames = pcm.length;
  const slices = [];
  for (let i = 0; i < anzahl; i++) {
    const start = Math.round((i * frames) / anzahl);
    const ende = Math.round(((i + 1) * frames) / anzahl);
    let peak = 0;
    for (let f = start; f < ende; f++) peak = Math.max(peak, Math.abs(pcm[f]));
    slices.push({ start, length: ende - start, attackLength: Math.round((ende - start) / 2), amplitude: Math.round(peak * 32767) });
  }
  const steps = new Uint8Array(64).fill(255);
  for (let i = 0; i < anzahl; i++) steps[Math.round((i * 64) / anzahl)] = i;
  return { slices, sliceSteps: steps, slicingNumSteps: 64, slicingBeat: 0, slicingNumActive: anzahl };
}

const slots = [];
let sekunden = 0;
manifest.samples.forEach((m, i) => {
  const nr = START + i;
  const wav = parseWav(new Uint8Array(fs.readFileSync(path.join(ORDNER, m.file))));
  if (wav.channels !== 1 || wav.sampleRate !== 44100) throw new Error(`${m.file}: erwartet mono 44.1k`);
  slots.push({
    slotIndex: displayNumberToSlotIndex(nr),
    sampleNumber: displayNumberToOsc(nr),
    name: m.name,
    category: m.category,
    pcmData: wav.pcm,
    sampleRate: 44100,
    channels: 1,
    loopType: 1,
    ...slicesFuer(wav.pcm, m.kind === "loop" ? 64 : 0),
  });
  m.nr = nr;
  sekunden += wav.frames / wav.sampleRate;
  console.log(`  #${nr}  ${m.kind.padEnd(7)} "${m.name}"  ${(wav.frames / wav.sampleRate).toFixed(2)}s  [${m.group}]`);
});

const bank = buildE2sBank(slots);
for (const w of bank.warnings ?? []) console.warn("  ! " + w);
const out = Buffer.from(bank.buffer);
fs.writeFileSync(ZIEL, out);
const zielName = path.basename(ZIEL, ".all");
console.log(`${ZIEL} — ${(out.length / 1024 / 1024).toFixed(1)} MB · ${slots.length} Samples (#${START}–${START + slots.length - 1}) · ${sekunden.toFixed(1)} s`);
fs.writeFileSync(ZIEL.replace(/\.all$/, "-inhalt.txt"), slots.map((s) => `${oscToDisplayNumber(s.sampleNumber)}\t${s.name}`).join("\n") + "\n");
fs.writeFileSync(path.join(ORDNER, `bank-${zielName}.json`), JSON.stringify(manifest, null, 1));

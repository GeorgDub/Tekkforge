/**
 * miss-vocalpegel.mjs — wie laut stehen die Vocals gegen das Schlagzeug?
 *
 * Aus dem Nutzerbefund vom 2026-08-27 („die Vocals waren zu leise im Vergleich
 * zum Rest, erst nach dem Muten der Kick ging es") wird hier eine Zahl. Das Set
 * wird ohne Geraet und ohne Demucs aus dem Lied gebaut, gruppenweise gerendert
 * und jede Gruppe fuer sich gemessen.
 *
 * Der Weg ueber `liedZuSet` reicht dafuer: die Lautstaerke-Verhaeltnisse kommen
 * aus der VOLUME-Tabelle des Generators und sind dieselben, ob die Samples nun
 * aus Stems oder aus dem Vollmix stammen.
 *
 * Aufruf: node scripts/miss-vocalpegel.mjs [lied.wav] [patternNr]
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { parseWav, encodeWav16 } from "../src/core/wavCodec.ts";
import { liedZuSet } from "../src/core/liedZuSet.ts";
import { importE2Patterns, importSamplesFromAll } from "../src/core/editorModel.ts";
import { buildE2AllPatFile } from "../src/core/e2sExport.ts";
import { rendere } from "../src/core/patternRender.ts";

const QUELLE =
  process.argv[2] ?? "G:/Mukke Stuff/Musik für Sample/Ori Wav/Nat3 - Amphegott_2313387911 - Nat3.wav";
const NR = Number(process.argv[3] ?? 7);

const GRUPPEN = [
  ["Schlagzeug", [0, 1, 2, 3, 4, 5, 6, 7]],
  ["Bass/Stab", [8, 9]],
  ["Shots", [10, 11]],
  ["Melodie", [12, 13]],
  ["Vocals", [14, 15]],
];

const db = (x) => (x > 0 ? 20 * Math.log10(x) : -Infinity);
const vz = (x) => (x >= 0 ? `+${x.toFixed(1)}` : x.toFixed(1));

function rms(pcm) {
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return Math.sqrt(s / Math.max(1, pcm.length));
}

function nur(pattern, idx) {
  return {
    ...pattern,
    rawBody: undefined,
    parts: pattern.parts.map((part, i) => ({ ...part, muted: !idx.includes(i) })),
  };
}

/**
 * Stem-Trennung wie in der App, nur synchron: Fenster als WAV in einen
 * Temp-Ordner, stems.py darueber, Ergebnis zurueckgelesen. Ohne echte Stems
 * gaebe es weder Vocals noch Schlagzeug — und damit nichts zu messen.
 */
const PY = path.join(process.env.LOCALAPPDATA, "TekkForge", "py-cuda", "Scripts", "python.exe");
function stemsSync(fenster) {
  const basis = fs.mkdtempSync(path.join(os.tmpdir(), "tf-stems-"));
  try {
    const liste = fenster.map((f) => {
      const wav = path.join(basis, `${f.id.replace(/[^A-Za-z0-9_-]/g, "_")}-mix.wav`);
      fs.writeFileSync(wav, encodeWav16(f.pcm, 44100, 1));
      return f.nurVox ? { id: f.id, wav, nurVox: true } : { id: f.id, wav };
    });
    const anfrage = path.join(basis, "anfrage.json");
    fs.writeFileSync(anfrage, JSON.stringify({ fenster: liste, ziel: basis, qualitaet: "schnell" }));
    const out = execFileSync(PY, [path.resolve("scripts/stems.py"), anfrage], { encoding: "utf8", maxBuffer: 1 << 28 });
    const erg = JSON.parse(out.trim().split(/\r?\n/).pop());
    const lies = (weg) => {
      if (!weg) return null;
      const b = fs.readFileSync(weg);
      return parseWav(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)).pcm;
    };
    return erg.fenster.map((f) => ({ id: f.id, melo: lies(f.melo), vox: lies(f.vox), drums: lies(f.drums) }));
  } finally {
    fs.rmSync(basis, { recursive: true, force: true });
  }
}

const roh = fs.readFileSync(QUELLE);
const w = parseWav(new Uint8Array(roh.buffer, roh.byteOffset, roh.byteLength));
const tekk = fs.readFileSync("examples/e2s/tekk4.all");
const set = liedZuSet(w.pcm, w.sampleRate, {
  name: "MESSUNG",
  kanaele: w.channels,
  zielBpm: 190,
  sparsameVocals: true,
  stems: stemsSync,
  tekkDrums: new Uint8Array(tekk.buffer, tekk.byteOffset, tekk.byteLength),
});

// Ueber die Dateien gehen, nicht ueber die Zwischenstaende: gemessen wird das,
// was auch auf der Karte landet.
const allpat = new Uint8Array(buildE2AllPatFile(set.patterns.slice(0, 250)));
const samples = importSamplesFromAll(new Uint8Array(set.bank));
const { patterns } = importE2Patterns(allpat, true);
const p = patterns[NR - 1] ?? patterns[patterns.length - 1];

console.log(`${set.name}: ${set.gemessen.toFixed(1)} BPM ×${set.oktave} → ${set.bpm} BPM, ${patterns.length} Patterns`);
console.log(`Pattern ${NR}: „${p.name}"  ${p.stepLength} Steps\n`);

const werte = new Map();
for (const [name, idx] of GRUPPEN) {
  const wert = rms(rendere(nur(p, idx), samples, {}).pcm);
  werte.set(name, wert);
  const aktiv = idx.filter((i) => p.parts[i].steps.some((s) => s.on)).length;
  console.log(
    `  ${name.padEnd(11)} ${db(wert).toFixed(1).padStart(7)} dB   ${aktiv} aktive Part(s)   Vol ${idx.map((i) => p.parts[i].volume).join("/")}`,
  );
}
const drums = werte.get("Schlagzeug");
console.log("");
for (const [name, wert] of werte) {
  if (name === "Schlagzeug") continue;
  console.log(`  ${name.padEnd(11)} gegen Schlagzeug: ${vz(db(wert) - db(drums))} dB`);
}

// Pegel der Samples selbst, nach Rolle — zeigt, ob der Unterschied vom Regler
// oder vom Material kommt.
const nachRolle = new Map();
for (const smp of set.projekt.samples) {
  const liste = nachRolle.get(smp.rolle) ?? [];
  liste.push(smp.rmsDb);
  nachRolle.set(smp.rolle, liste);
}
console.log("");
for (const [rolle, liste] of [...nachRolle].sort()) {
  const schnitt = liste.reduce((a, b) => a + b, 0) / liste.length;
  console.log(`  ${String(rolle).padEnd(7)} ${String(liste.length).padStart(3)} Sample(s)   RMS im Schnitt ${schnitt.toFixed(1)} dB   (${Math.min(...liste).toFixed(1)} … ${Math.max(...liste).toFixed(1)})`);
}

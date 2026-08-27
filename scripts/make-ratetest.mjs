/**
 * Erzeugt RATETEST.all + RATETEST.e2sallpat — die Antwort auf die einzige
 * offene Annahme der sparsamen Vocals.
 *
 * Die Frage: beachtet die Electribe eine gespeicherte Abtastrate unter
 * 44,1 kHz? Die Bank schreibt sie als `playLogPeriod` (22050 → 18808, gegen
 * echte .all-Dateien geprueft) — aber ob die Wiedergabe sie auch benutzt, hat
 * bisher niemand gehoert. Steht die Antwort, ist „Vocals sparsam" entweder
 * bestaetigt (doppelt so viel Lied je Bank) oder erledigt.
 *
 * Der Aufbau ist so gewaehlt, dass die Antwort nicht zu verfehlen ist:
 *
 *   Part 1  Stimme, 44 100 Hz   ← Referenz
 *   Part 2  DIESELBE Stimme, 22 050 Hz
 *   Part 3  Sinus-Sweep, 44 100 Hz  ← Referenz
 *   Part 4  DERSELBE Sweep, 22 050 Hz
 *
 * Die Paare liegen vier Sekunden auseinander, damit nichts ueberlappt. Klingen
 * die Paare gleich (das zweite nur dumpfer), beachtet das Geraet die Rate.
 * Laeuft das zweite doppelt so schnell und eine Oktave hoeher, tut es das
 * nicht. Der Sweep ist dabei die eindeutige Probe: eine verdoppelte
 * Geschwindigkeit hoert man an ihm auch ohne geuebtes Ohr.
 *
 * Aufruf: node scripts/make-ratetest.mjs [zielordner] [quell-wav]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec.ts";
import { downmixToMono, polyPhaseResample } from "../src/core/audioProcessor.ts";
import { createPattern, buildBankFiles, EDITOR_PARTS } from "../src/core/editorModel.ts";

const SR = 44100;
const ZIEL = process.argv[2] ?? "examples/e2s";
const QUELLE =
  process.argv[3] ?? "G:/Mukke Stuff/Musik für Sample/Ori Wav/Nat3 - Amphegott_2313387911 - Nat3.wav";
/** Ab hier wird geschnitten — mitten im Lied, wo Stimme liegt. */
const AB_SEKUNDE = 60;
const LAENGE_S = 2;

function monoQuelle(datei) {
  const roh = fs.readFileSync(datei);
  const w = parseWav(new Uint8Array(roh.buffer, roh.byteOffset, roh.byteLength));
  const mono = w.channels === 2 ? downmixToMono(w.pcm).pcm : w.pcm;
  return w.sampleRate === SR ? mono : polyPhaseResample(mono, w.sampleRate, SR, 1);
}

/** Logarithmischer Sweep 800 → 200 Hz: fallend, damit „doppelt so schnell" auffaellt. */
function sweep(sekunden) {
  const n = Math.round(SR * sekunden);
  const pcm = new Float32Array(n);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / n;
    const hz = 800 * Math.pow(200 / 800, t);
    phase += (2 * Math.PI * hz) / SR;
    // Raender weich, sonst knackt es und man streitet ueber den falschen Klang.
    const huelle = Math.min(1, i / (SR * 0.01), (n - i) / (SR * 0.01));
    pcm[i] = Math.sin(phase) * 0.7 * huelle;
  }
  return pcm;
}

const lied = monoQuelle(QUELLE);
const von = Math.min(lied.length - 1, Math.round(AB_SEKUNDE * SR));
const stimme = lied.slice(von, Math.min(lied.length, von + Math.round(LAENGE_S * SR)));
const ton = sweep(LAENGE_S);

/** Dieselben Daten, nur mit halber Rate abgelegt — genau wie `bankPlan` es tut. */
const halbe = (pcm) => polyPhaseResample(pcm, SR, SR / 2, 1);

const samples = [
  { number: 501, name: "VOX 44k", sampleRate: SR, pcm: stimme },
  { number: 502, name: "VOX 22k", sampleRate: SR / 2, pcm: halbe(stimme) },
  { number: 503, name: "SWEEP 44k", sampleRate: SR, pcm: ton },
  { number: 504, name: "SWEEP 22k", sampleRate: SR / 2, pcm: halbe(ton) },
];

// 64 Steps bei 60 BPM: ein Sechzehntel ist 250 ms, 16 Steps also 4 Sekunden.
// Damit steht jedes Sample fuer sich, ohne dass eins ins naechste laeuft.
const pattern = createPattern("RATETEST");
pattern.bpm = 60;
pattern.stepLength = 64;
const PLAETZE = [0, 16, 32, 48];
samples.forEach((s, i) => {
  const part = pattern.parts[i];
  part.sampleNumber = s.number;
  part.steps[PLAETZE[i]].on = true;
  part.steps[PLAETZE[i]].velocity = 127;
  part.muted = false;
});
// Parts ohne Steps stummschalten — sonst raet man am Geraet, was mitspielt.
for (let i = samples.length; i < EDITOR_PARTS; i++) pattern.parts[i].muted = true;

const { allpat, all, warnings } = buildBankFiles({ version: 1, patterns: [pattern], samples });
if (!all) throw new Error("Bank ist leer — das kann nicht sein");
fs.mkdirSync(ZIEL, { recursive: true });
const wegAll = path.join(ZIEL, "RATETEST.all");
const wegPat = path.join(ZIEL, "RATETEST.e2sallpat");
fs.writeFileSync(wegAll, all);
fs.writeFileSync(wegPat, allpat);

console.log(`${wegAll} — ${all.length} Bytes`);
console.log(`${wegPat} — ${allpat.length} Bytes`);
for (const s of samples) {
  console.log(
    `  #${s.number} ${s.name.padEnd(10)} ${s.sampleRate} Hz  ${(s.pcm.length / s.sampleRate).toFixed(2)} s  ${s.pcm.length} Frames`,
  );
}
for (const w of warnings) console.log(`  ⚠ ${w}`);
console.log(
  "\nAm Geraet: erst RATETEST.all laden, dann RATETEST.e2sallpat, Pattern 1 starten.\n" +
    "Klingt Nr. 2 wie Nr. 1 (nur dumpfer) → Rate wird beachtet.\n" +
    "Laeuft Nr. 2 doppelt so schnell und hoeher → Rate wird ignoriert.",
);

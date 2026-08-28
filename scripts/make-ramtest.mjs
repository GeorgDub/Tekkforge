/**
 * Erzeugt RAMTEST.all + RAMTEST.e2sallpat — kostet ein 22-kHz-Sample halb so
 * viel Geraetespeicher wie ein gleich langes mit voller Rate?
 *
 * Die Frage entscheidet, ob „Vocals sparsam" wirklich doppelt so viel Lied in
 * eine Bank bringt. Dass die Vocals RICHTIG KLINGEN, ist am 2026-08-27 belegt —
 * aber das beweist nichts ueber den Speicher: es waere auch dann so, wenn das
 * Geraet beim Laden auf 44,1 kHz hochrechnet. Dann kostete die halbe Rate
 * vollen Platz und spart nur auf der Karte.
 *
 * Die Probe trennt beides:
 *
 *   Bank aus 22-kHz-Samples mit rund 20 MB BILDERN.
 *   Nach Bildern gerechnet:  20 MB  → passt in die ~24 MB.
 *   Nach Dauer gerechnet:    40 MB  → passt nicht, das Geraet muss abweisen.
 *
 * Laedt die Bank und spielt, zaehlt die Bildzahl — dann stimmt die neue
 * Rechnung und es passt doppelt so viel Gesang hinein. Bricht der Import ab
 * oder fehlen Samples, zaehlt die Dauer, und „sparsam" spart nur Kartenplatz.
 *
 * Aufruf: node scripts/make-ramtest.mjs [zielordner]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createPattern, buildBankFiles, EDITOR_PARTS } from "../src/core/editorModel.ts";
import { ramBytesSumme } from "../src/core/sampleRam.ts";

const SR = 22050;
const ZIEL = process.argv[2] ?? "examples/e2s";
/** So viele Sekunden je Sample (bei 22 050 Hz sind das 441 000 Bytes). */
const SEK = 10;
/** So viele Samples — 45 × 10 s bei halber Rate sind rund 19,8 MB Bilder. */
const ANZAHL = 45;

/** Hoerbarer Ton mit erkennbarer Tonhoehe je Nummer, damit man Ausfaelle hoert. */
function ton(sekunden, hz) {
  const n = Math.round(SR * sekunden);
  const pcm = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const huelle = Math.min(1, i / (SR * 0.01), (n - i) / (SR * 0.05));
    pcm[i] = Math.sin((2 * Math.PI * hz * i) / SR) * 0.6 * huelle;
  }
  return pcm;
}

const samples = [];
for (let i = 0; i < ANZAHL; i++) {
  samples.push({
    number: 501 + i,
    name: `RAM ${String(i + 1).padStart(2, "0")}`,
    sampleRate: SR,
    pcm: ton(SEK, 220 * Math.pow(2, (i % 12) / 12)),
  });
}

const pattern = createPattern("RAMTEST");
pattern.bpm = 120;
pattern.stepLength = 64;
// Vier Samples aus dem Bestand anspielen: das erste, zwei aus der Mitte und
// das LETZTE. Faellt die Bank hinten ab, hoert man genau das letzte nicht.
const PROBEN = [0, Math.floor(ANZAHL / 3), Math.floor((2 * ANZAHL) / 3), ANZAHL - 1];
PROBEN.forEach((idx, i) => {
  const part = pattern.parts[i];
  part.sampleNumber = samples[idx].number;
  part.steps[i * 16].on = true;
  part.steps[i * 16].velocity = 127;
  part.muted = false;
});
for (let i = PROBEN.length; i < EDITOR_PARTS; i++) pattern.parts[i].muted = true;

const { allpat, all } = buildBankFiles({ version: 1, patterns: [pattern], samples });
if (!all) throw new Error("Bank ist leer");
fs.mkdirSync(ZIEL, { recursive: true });
fs.writeFileSync(path.join(ZIEL, "RAMTEST.all"), all);
fs.writeFileSync(path.join(ZIEL, "RAMTEST.e2sallpat"), allpat);

const bilder = ramBytesSumme(samples);
const dauer = samples.reduce((a, s) => a + Math.round((s.pcm.length / s.sampleRate) * 44100) * 2, 0);
console.log(`RAMTEST.all — ${(all.length / 1048576).toFixed(1)} MB Datei`);
console.log(`  ${ANZAHL} Samples à ${SEK} s bei ${SR} Hz`);
console.log(`  nach Bildern gerechnet: ${(bilder / 1048576).toFixed(1)} MB  → passt in ~24 MB`);
console.log(`  nach Dauer gerechnet:   ${(dauer / 1048576).toFixed(1)} MB  → passt NICHT`);
console.log(`  angespielt werden #${PROBEN.map((i) => samples[i].number).join(", #")}`);

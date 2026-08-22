/**
 * Erzeugt round1<x>.all — EIGENSTAENDIGE Baenke fuer TEKK_MEGA3<X>, je 8 Songs:
 * die 18 tekk4-Samples, die MEGA3 nutzt (Drums, Bass, 8 Synth-Melos — mit ihren
 * ORIGINALEN tekk4-Nummern, also lueckenhaft 501–562), plus die Song-Slices
 * aus „round 1" (scripts/analyze-round1.py → examples/e2s/round1).
 *
 * Warum gesplittet: 16 Songs × 5 Slices (≈19 MB) + Basis sprengen das
 * ~24-MB-Sample-RAM des Geraets. Zwei Baenke à 8 Songs liegen bei ~16 MB.
 * Die Sample-Nummern sind ueber beide Baenke EINDEUTIG (A: 581–620,
 * B: 621–660), damit eine falsch geladene Bank nicht stumm falsch spielt.
 *
 *   je Song fuenf Samples (Anzeige = 581 + (Song-1)·5 + k):
 *     <Tag> MA  = MELO Haelfte A, 4 Takte @175 BPM (5,486 s), 64 Slices, Kat. Phrase
 *     <Tag> MB  = MELO Haelfte B (Alternate-Paar 13/14 → 8-Takt-Loop),  Kat. Phrase
 *     <Tag> VX  = VOX, 4 Takte Vocal-Phrase @175 BPM (UVR-Vocals-Spur),  Kat. Voice
 *     <Tag> DR  = DROP, 1 Takt @175 BPM (1,371 s), 16 Slices,            Kat. Loop
 *     <Tag> ST  = STAB, 0,6 s Einzelklang aus dem Hook,                  Kat. Hits
 *   Fehlt das VOX-WAV (Song ohne Vocals), bleibt die Nummer frei.
 *
 * Slice-Format nach Factory-Bank (sampler_full_501.all, HarpChord/Drum 1):
 * start/length in Frames, attackLength ≈ length/2, amplitude = Spitzenwert,
 * sliceSteps[i] = Slice-Nr oder 255, Metadaten numSteps/beat/numActive.
 *
 * Aufruf: npx tsx scripts/make-round1-bank.mjs <ziel.all> <von>-<bis> [round1-ordner]
 *         z. B. examples/e2s/round1a.all 1-8  ·  examples/e2s/round1b.all 9-16
 * Schreibt <round1-ordner>/mapping-<zielname>.json fuer make-tekk-mega3.mjs.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildE2sBank } from "../src/core/e2sBankBuilder.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import { parseWav } from "../src/core/wavCodec.ts";
import {
  displayNumberToOsc,
  displayNumberToSlotIndex,
  oscToDisplayNumber,
} from "../src/core/e2sPatternSampleLink.ts";

const QUELLE = "examples/e2s/tekk4.all";
const ZIEL = process.argv[2] ?? "examples/e2s/round1a.all";
const BEREICH = (process.argv[3] ?? "1-8").split("-").map(Number);
const ROUND1 = process.argv[4] ?? "examples/e2s/round1";
const ERSTE_NEUE = 581;
const PRO_SONG = 5;
const [VON, BIS] = BEREICH;
if (!(VON >= 1 && BIS >= VON)) throw new Error(`Bereich "${process.argv[3]}" unverstaendlich (z. B. 1-8)`);

/** Aus tekk4 uebernommene Samples (Name-Praefix, wie make-tekk-mega3.mjs sie sucht). */
const BASIS = [
  "HaimKind", "Jumpkick", "clydesna", "snarre-p", "closed 8", "707_hho", "ED Close", "ZaHnI_To",
  "Unison_Bass_C3", "Bassdrum-01fd",
  "T-Mello", "Tau-MeLo", "HBsChE PaRa", "Auf CrystaL", "Holia-MeLo", "melo6dk", "Ha He MeLo", "Krieger",
];

/** Kurztags je Song (Reihenfolge = sortierte Dateinamen, s. analyse.json). */
export const TAGS = [
  "Abovegrnd", "Drogen", "Amphegot2", "Zuckerwat", "NewToday", "RawFloor",
  "TuerkAmph", "JajaVeve", "KlarBengl", "Amphegott", "RoundWrld", "Schmettr",
  "Vorbild", "SteinStn", "Sturmmask", "WasnDas",
];

const ARTEN = ["MELOA", "MELOB", "VOX", "DROP", "STAB"];
const KAT = { MELOA: 14, MELOB: 14, VOX: 9, DROP: 15, STAB: 7 }; // Phrase, Voice, Loop, Hits
const SUFFIX = { MELOA: "MA", MELOB: "MB", VOX: "VX", DROP: "DR", STAB: "ST" };
const SLICES = { MELOA: 64, MELOB: 64, VOX: 64, DROP: 16, STAB: 0 };

const basis = parseE2sBank(new Uint8Array(fs.readFileSync(QUELLE)), QUELLE);
const slots = [];
let hoechsteAnzeige = 0;
const genommen = new Set();
for (const s of basis.slots) {
  if (!s) continue;
  const praefix = BASIS.find((b) => s.name.trim().toLowerCase().startsWith(b.toLowerCase()));
  if (!praefix || genommen.has(praefix)) continue; // erster Treffer je Praefix (wie findeAnzeige)
  genommen.add(praefix);
  hoechsteAnzeige = Math.max(hoechsteAnzeige, oscToDisplayNumber(s.sampleNumber));
  slots.push({
    slotIndex: s.index, sampleNumber: s.sampleNumber, name: s.name,
    category: s.category, pcmData: s.pcmData, sampleRate: s.sampleRate, channels: s.channels,
  });
}
if (hoechsteAnzeige >= ERSTE_NEUE) throw new Error(`tekk4 reicht bis ${hoechsteAnzeige} — ERSTE_NEUE anpassen`);
const fehlt = BASIS.filter((b) => !genommen.has(b));
if (fehlt.length) throw new Error(`in ${QUELLE} nicht gefunden: ${fehlt.join(", ")}`);
console.log(`${QUELLE}: ${slots.length} Basis-Samples uebernommen (Nummern unveraendert, bis ${hoechsteAnzeige})`);

const analyse = JSON.parse(fs.readFileSync(path.join(ROUND1, "analyse.json"), "utf8"));
const songs = analyse.filter((a) => !a.error && a.idx >= VON && a.idx <= BIS);
if (songs.length !== BIS - VON + 1) {
  throw new Error(`Songs ${VON}–${BIS}: nur ${songs.length} analysiert`);
}

/** Gleichmaessige Slices ueber das Sample; amplitude = Spitzenwert je Slice (int16). */
function slicesFuer(pcm, anzahl) {
  if (!anzahl) return {};
  const frames = pcm.length;
  const slices = [];
  for (let i = 0; i < anzahl; i++) {
    const start = Math.round((i * frames) / anzahl);
    const ende = Math.round(((i + 1) * frames) / anzahl);
    let peak = 0;
    for (let f = start; f < ende; f++) peak = Math.max(peak, Math.abs(pcm[f]));
    slices.push({
      start,
      length: ende - start,
      attackLength: Math.round((ende - start) / 2),
      amplitude: Math.round(peak * 32767),
    });
  }
  const steps = new Uint8Array(64).fill(255);
  const schritt = 64 / anzahl; // 64 Slices → jeder Step, 16 → jeder vierte
  for (let i = 0; i < anzahl; i++) steps[Math.round(i * schritt)] = i;
  return {
    slices,
    sliceSteps: steps,
    slicingNumSteps: 64,
    slicingBeat: 0,
    slicingNumActive: anzahl,
  };
}

const mapping = [];
let sekunden = 0;
let letzteNr = 0;
for (const song of songs) {
  const tag = TAGS[song.idx - 1] ?? `Song${song.idx}`;
  const eintrag = { idx: song.idx, tag, file: song.file };
  ARTEN.forEach((art, k) => {
    const nr = ERSTE_NEUE + (song.idx - 1) * PRO_SONG + k;
    const wavPfad = path.join(ROUND1, `${String(song.idx).padStart(2, "0")}-${art}.wav`);
    if (!fs.existsSync(wavPfad)) {
      if (art === "VOX") { console.log(`  #${nr}  VOX  — (Song ohne Vocals)`); return; }
      throw new Error(`${wavPfad} fehlt`);
    }
    const wav = parseWav(new Uint8Array(fs.readFileSync(wavPfad)));
    if (wav.channels !== 1 || wav.sampleRate !== 44100) throw new Error(`${wavPfad}: erwartet mono 44.1k`);
    const name = `${tag} ${SUFFIX[art]}`.slice(0, 16);
    slots.push({
      slotIndex: displayNumberToSlotIndex(nr),
      sampleNumber: displayNumberToOsc(nr),
      name,
      category: KAT[art],
      pcmData: wav.pcm,
      sampleRate: 44100,
      channels: 1,
      loopType: 1,
      ...slicesFuer(wav.pcm, SLICES[art]),
    });
    sekunden += wav.frames / wav.sampleRate;
    eintrag[art] = nr;
    letzteNr = Math.max(letzteNr, nr);
    console.log(`  #${nr}  ${art.padEnd(5)} "${name}"  ${(wav.frames / wav.sampleRate).toFixed(2)}s`);
  });
  mapping.push(eintrag);
}

const bank = buildE2sBank(slots);
for (const w of bank.warnings ?? []) console.warn("  ! " + w);
const out = Buffer.from(bank.buffer ?? bank);
fs.writeFileSync(ZIEL, out);
const zielName = path.basename(ZIEL, ".all");
console.log(`${ZIEL} — ${(out.length / 1024 / 1024).toFixed(1)} MB · ${slots.length} Samples (Songs ${VON}–${BIS}, Slices bis #${letzteNr}) · Slices ${sekunden.toFixed(1)} s`);
fs.writeFileSync(
  ZIEL.replace(/\.all$/, "-inhalt.txt"),
  slots.map((s) => `${oscToDisplayNumber(s.sampleNumber)}\t${s.name}`).join("\n") + "\n",
);
fs.writeFileSync(path.join(ROUND1, `mapping-${zielName}.json`), JSON.stringify(mapping, null, 1));

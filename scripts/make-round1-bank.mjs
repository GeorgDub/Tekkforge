/**
 * Erzeugt round1.all — eine EIGENSTAENDIGE Bank fuer TEKK_MEGA3:
 * die 18 tekk4-Samples, die MEGA3 nutzt (Drums, Bass, Synth-Melos —
 * mit ihren ORIGINALEN tekk4-Nummern, also lueckenhaft 501–577), plus die
 * Song-Slices aus „round 1" (scripts/analyze-round1.py → examples/e2s/round1).
 *
 * Warum nicht tekk4 + Slices: tekk4.all belegt allein ~17,7 MB (≈220 s) vom
 * ~24-MB-Sample-RAM des Geraets; 16 Songs × 13 s Slices (≈18 MB) passen
 * da nicht mehr dazu. Die Auswahl (ohne Pads) haelt die Bank bei ~21 MB.
 *
 *   je Song drei Samples, fortlaufend ab Anzeige 581:
 *     <Tag> MA  = MELO Hälfte A, 4 Takte @175 BPM (5,486 s), 64 Slices, Kat. Phrase
 *     <Tag> MB  = MELO Hälfte B (Alternate-Paar 13/14 → 8-Takt-Loop),  Kat. Phrase
 *     <Tag> DR  = DROP, 1 Takt @175 BPM (1,371 s), 16 Slices,                Kat. Loop
 *     <Tag> ST  = STAB, 0,6 s Einzelklang aus dem Hook,                      Kat. Hits
 *
 * Slice-Format nach Factory-Bank (sampler_full_501.all, HarpChord/Drum 1):
 * start/length in Frames, attackLength ≈ length/2, amplitude = Spitzenwert,
 * sliceSteps[i] = Slice-Nr oder 255, Metadaten numSteps/beat/numActive.
 *
 * Aufruf: npx tsx scripts/make-round1-bank.mjs [ziel.all] [round1-ordner]
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
const ZIEL = process.argv[2] ?? "examples/e2s/round1.all";
const ROUND1 = process.argv[3] ?? "examples/e2s/round1";
const ERSTE_NEUE = 581;

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

const KAT = { MELOA: 14, MELOB: 14, DROP: 15, STAB: 7 }; // Phrase, Loop, Hits
const SUFFIX = { MELOA: "MA", MELOB: "MB", DROP: "DR", STAB: "ST" };
const SLICES = { MELOA: 64, MELOB: 64, DROP: 16, STAB: 0 };

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
const songs = analyse.filter((a) => !a.error);
if (songs.length !== TAGS.length) {
  console.warn(`WARNUNG: ${songs.length} analysierte Songs, ${TAGS.length} Tags`);
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
let nr = ERSTE_NEUE;
let sekunden = 0;
for (const song of songs) {
  const tag = TAGS[song.idx - 1] ?? `Song${song.idx}`;
  const eintrag = { idx: song.idx, tag, file: song.file };
  for (const art of ["MELOA", "MELOB", "DROP", "STAB"]) {
    const wavPfad = path.join(ROUND1, `${String(song.idx).padStart(2, "0")}-${art}.wav`);
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
    console.log(`  #${nr}  ${art.padEnd(4)} "${name}"  ${(wav.frames / wav.sampleRate).toFixed(2)}s`);
    nr++;
  }
  mapping.push(eintrag);
}

const bank = buildE2sBank(slots);
for (const w of bank.warnings ?? []) console.warn("  ! " + w);
const out = Buffer.from(bank.buffer ?? bank);
fs.writeFileSync(ZIEL, out);
console.log(`${ZIEL} — ${(out.length / 1024 / 1024).toFixed(1)} MB · ${slots.length} Samples (Anzeige 501–${nr - 1}) · neue Slices ${sekunden.toFixed(1)} s`);
fs.writeFileSync(
  ZIEL.replace(/\.all$/, "-inhalt.txt"),
  slots.map((s) => `${oscToDisplayNumber(s.sampleNumber)}\t${s.name}`).join("\n") + "\n",
);
fs.writeFileSync(path.join(ROUND1, "mapping.json"), JSON.stringify(mapping, null, 1));

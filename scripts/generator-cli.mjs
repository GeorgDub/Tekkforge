/**
 * generator-cli.mjs — Verzeichnis → Projekt (.all + projekt.json) → Patterns.
 * Kern des Generator-Tabs ohne GUI/KI; nur WAV (Stereo wird gemittelt, Rate
 * auf 44,1 k gebracht). Melodien bleiben ganz (bis 8 Takte), Jam-Pattern als
 * .e2spat, Mini-Set (6 Patterns gechaint) und Pro Melo als .e2sallpat.
 *
 * Aufruf: npx tsx scripts/generator-cli.mjs <verzeichnis> [--modus jam|miniset|promelo]
 *           [--bpm 180] [--melo "Name"] [--beschreibung "…"] [--volume 1] [--tekk-drums]
 *           [--name xyz] [--slot 1] [--out <ordner>]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { parseWav } from "../src/core/wavCodec.ts";
import { polyPhaseResample, downmixToMono } from "../src/core/audioProcessor.ts";
import { scanne } from "../src/core/sampleScan.ts";
import { planeBank } from "../src/core/bankPlan.ts";
import { tempoVorschlag } from "../src/core/tempoAnalyse.ts";
import { regelRezept, regelRezeptProMelo } from "../src/core/rezept.ts";
import { baueRezept, baueProMelo, alsAllPat, alsPat } from "../src/core/patternGen.ts";

const ARG = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const DIR = process.argv[2];
if (!DIR || DIR.startsWith("--")) throw new Error("Verzeichnis fehlt");
const MODUS = ARG("--modus", "jam");
const NAME = ARG("--name", path.basename(DIR).toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 12) || "projekt");
const OUT = ARG("--out", path.join(DIR, "TekkForge"));
fs.mkdirSync(OUT, { recursive: true });

const eingaben = [];
for (const f of fs.readdirSync(DIR).filter((f) => /\.wav$/i.test(f)).sort()) {
  try {
    const w = parseWav(new Uint8Array(fs.readFileSync(path.join(DIR, f))));
    let pcm = w.channels === 2 ? downmixToMono(w.pcm).pcm : w.pcm;
    if (w.sampleRate !== 44100) pcm = polyPhaseResample(pcm, w.sampleRate, 44100, 1);
    eingaben.push({ name: f, pcm, sampleRate: 44100 });
  } catch (e) {
    console.log(`  unlesbar: ${f} (${e.message})`);
  }
}
const { eintraege, uebersprungen } = scanne(eingaben);
for (const u of uebersprungen) console.log(`  weg: ${u.datei} — ${u.grund}`);
const vorschlag = tempoVorschlag(eintraege.map((e) => e.sekunden));
const bpm = Number(ARG("--bpm", vorschlag));
const rollen = {};
for (const e of eintraege) rollen[e.rolle] = (rollen[e.rolle] ?? 0) + 1;
console.log(`${eintraege.length} Samples (${Object.entries(rollen).map(([k, v]) => `${k}:${v}`).join(" ")}) · Tempo-Vorschlag ${vorschlag} BPM · genommen ${bpm}`);

const tekk = process.argv.includes("--tekk-drums") ? new Uint8Array(fs.readFileSync("examples/e2s/tekk4.all")) : undefined;
const { projekt, bank, warnungen } = planeBank(eintraege, { name: NAME, bpm, volume: Number(ARG("--volume", 1)), tekkDrumsBank: tekk });
for (const w of warnungen) console.log("  ! " + w);
fs.writeFileSync(path.join(OUT, `${NAME}.all`), Buffer.from(bank));
fs.writeFileSync(path.join(OUT, "projekt.json"), JSON.stringify(projekt, null, 1));
const sekunden = projekt.samples.reduce((s, x) => s + x.sekunden, 0);
console.log(`${path.join(OUT, NAME + ".all")} — ${projekt.samples.length} Samples · ${sekunden.toFixed(1)} s (Volume ${projekt.volume}/${projekt.volumes})`);

const slot = Number(ARG("--slot", 1));
const upper = NAME.toUpperCase();
if (MODUS === "promelo") {
  const { patterns, hinweise } = baueProMelo(regelRezeptProMelo(projekt, bpm), projekt);
  hinweise.forEach((h) => console.log("  " + h));
  fs.writeFileSync(path.join(OUT, `${upper}-promelo.e2sallpat`), Buffer.from(alsAllPat(patterns)));
  console.log(`${patterns.length} Jam-Patterns (eines je Melodie) → ${upper}-promelo.e2sallpat`);
  patterns.forEach((p, i) => console.log(`  ${String(i + 1).padStart(3)}  ${p.name}`));
} else {
  const rezept = regelRezept(projekt, { modus: MODUS, bpm, melo: ARG("--melo", undefined), beschreibung: ARG("--beschreibung", "") });
  console.log("Warum so? " + rezept.begruendung);
  const { patterns, hinweise } = baueRezept(rezept, projekt, { startSlot: slot });
  hinweise.forEach((h) => console.log("  " + h));
  if (MODUS === "jam") {
    fs.writeFileSync(path.join(OUT, `${upper}-jam.e2spat`), Buffer.from(alsPat(patterns[0])));
    console.log(`Jam-Pattern "${patterns[0].name}" → ${upper}-jam.e2spat`);
  } else {
    fs.writeFileSync(path.join(OUT, `${upper}-miniset.e2sallpat`), Buffer.from(alsAllPat(patterns, slot)));
    console.log(`Mini-Set ${patterns.length} Patterns ab Slot ${slot} → ${upper}-miniset.e2sallpat`);
    patterns.forEach((p, i) => console.log(`  ${String(slot + i).padStart(3)}  ${p.name}  ×${p.chainRepeat} → ${p.chainTo || "Ende"}`));
  }
}

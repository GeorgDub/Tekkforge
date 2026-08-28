/**
 * pruef-herkunft.mjs — stammt jedes Sample aus dem Lied, dessen Namen es traegt?
 *
 * Anlass (2026-08-29, Nutzerbefund am Geraet): „bei dem SpongeBob-Pattern ist
 * ein anderes Vocal, das aber SpongeBob heisst". Name und Inhalt koennen
 * auseinanderlaufen, ohne dass man es am Bildschirm sieht — deshalb wird hier
 * gemessen statt geglaubt.
 *
 * Verfahren: die Lautstaerke-Huellkurve des Samples wird gegen die Huellkurven
 * ALLER Quell-Lieder geschoben und die beste Uebereinstimmung gesucht. Das ist
 * grob genug, um schnell zu sein, und fein genug, um Lieder zu unterscheiden —
 * zwei verschiedene Aufnahmen haben nie denselben Lautstaerkeverlauf.
 *
 * Aufruf: node scripts/pruef-herkunft.mjs <lied1.wav> <lied2.wav> ...
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import { parseWav, encodeWav16 } from "../src/core/wavCodec.ts";
import { downmixToMono, polyPhaseResample } from "../src/core/audioProcessor.ts";
import { liedZuSet } from "../src/core/liedZuSet.ts";
import { importSamplesFromAll } from "../src/core/editorModel.ts";

const SR = 44100;
/** Aufloesung der Huellkurve: 100 Werte je Sekunde. */
const HZ = 100;
const PY = path.join(process.env.LOCALAPPDATA, "TekkForge", "py-cuda", "Scripts", "python.exe");

function monoQuelle(datei) {
  const roh = fs.readFileSync(datei);
  const w = parseWav(new Uint8Array(roh.buffer, roh.byteOffset, roh.byteLength));
  const mono = w.channels === 2 ? downmixToMono(w.pcm).pcm : w.pcm;
  return w.sampleRate === SR ? mono : polyPhaseResample(mono, w.sampleRate, SR, 1);
}

/** Huellkurve: Effektivwert je Fenster, danach auf Mittelwert 0 gebracht. */
function huelle(pcm, sr = SR) {
  const fenster = Math.round(sr / HZ);
  const n = Math.floor(pcm.length / fenster);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = i * fenster; k < (i + 1) * fenster; k++) s += pcm[k] * pcm[k];
    out[i] = Math.sqrt(s / fenster);
  }
  let m = 0;
  for (const v of out) m += v;
  m /= Math.max(1, n);
  for (let i = 0; i < n; i++) out[i] -= m;
  return out;
}

/** Beste normierte Korrelation des kurzen Stuecks irgendwo im langen. */
function besteKorrelation(kurz, lang) {
  if (kurz.length < 8 || lang.length <= kurz.length) return 0;
  let kn = 0;
  for (const v of kurz) kn += v * v;
  kn = Math.sqrt(kn);
  if (kn === 0) return 0;
  let best = 0;
  const schritt = Math.max(1, Math.round(kurz.length / 16));
  for (let off = 0; off + kurz.length <= lang.length; off += schritt) {
    let s = 0;
    let ln = 0;
    for (let i = 0; i < kurz.length; i++) {
      const v = lang[off + i];
      s += kurz[i] * v;
      ln += v * v;
    }
    const r = ln > 0 ? s / (kn * Math.sqrt(ln)) : 0;
    if (r > best) best = r;
  }
  return best;
}

function stemsSync(fenster) {
  const basis = fs.mkdtempSync(path.join(os.tmpdir(), "tf-h-"));
  try {
    const liste = fenster.map((f) => {
      const wav = path.join(basis, `${f.id.replace(/[^A-Za-z0-9_-]/g, "_")}-mix.wav`);
      fs.writeFileSync(wav, encodeWav16(f.pcm, SR, 1));
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

const dateien = process.argv.slice(2);
if (!dateien.length) throw new Error("Aufruf: node scripts/pruef-herkunft.mjs <lied1.wav> ...");

const lieder = dateien.map((d) => ({ name: path.basename(d, ".wav"), pcm: monoQuelle(d) }));
for (const l of lieder) l.huelle = huelle(l.pcm);
console.log(`${lieder.length} Quell-Lied(er): ${lieder.map((l) => l.name).join(", ")}\n`);

for (const quelle of lieder) {
  const set = liedZuSet(quelle.pcm, SR, {
    name: quelle.name.slice(0, 10),
    kanaele: 1,
    zielBpm: 180,
    sparsameVocals: false,
    stems: stemsSync,
  });
  console.log(`— aus „${quelle.name}" gebaut: ${set.projekt.samples.length} Samples`);
  // Die Rollen stehen im Projekt, die Audiodaten in der gebauten Bank —
  // gemessen wird an dem, was wirklich in der Datei landet.
  const audio = new Map(importSamplesFromAll(new Uint8Array(set.bank)).map((x) => [x.number, x]));
  const rolleVon = new Map(set.projekt.samples.map((x) => [x.nr, x.rolle]));
  let daneben = 0;
  for (const [nr, s] of audio) {
    const rolle = rolleVon.get(nr) ?? "?";
    if (rolle !== "vox" && rolle !== "melo") continue;
    const h = huelle(s.pcm, s.sampleRate);
    const werte = lieder.map((l) => ({ name: l.name, r: besteKorrelation(h, l.huelle) }));
    werte.sort((a, b) => b.r - a.r);
    const treffer = werte[0];
    const stimmt = treffer.name === quelle.name;
    if (!stimmt) daneben++;
    console.log(
      `   ${stimmt ? "  " : "⚠ "}#${nr} ${s.name.trim().padEnd(17)} ${rolle.padEnd(4)} → ${treffer.name.slice(0, 18).padEnd(18)} r=${treffer.r.toFixed(2)}` +
        `   (zweitbester ${werte[1] ? `${werte[1].name.slice(0, 12)} r=${werte[1].r.toFixed(2)}` : "—"})`,
    );
  }
  console.log(`   ${daneben ? `⚠ ${daneben} Sample(s) passen NICHT zum Lied im Namen` : "alle Samples stammen aus dem benannten Lied"}\n`);
}

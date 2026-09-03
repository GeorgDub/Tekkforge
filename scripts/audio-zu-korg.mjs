/**
 * audio-zu-korg.mjs — beliebige Audiodateien in eine E2S-Sample-Bank (.all).
 *
 *   npx tsx scripts/audio-zu-korg.mjs <datei|ordner> [...] --ziel <BANK.all> [--ab 501] [--rate 44100|22050]
 *
 * Jede Datei wird ein Sample: WAV direkt, alles andere (MP3, M4A, FLAC, OGG,
 * Opus, WMA, APE, AIFF, Video-Container …) ueber ffmpeg — dasselbe ffmpeg,
 * das der URL-Import nutzt (`imageio-ffmpeg`, oder `ffmpeg` im PATH). Mono,
 * Rate wie angegeben, Name aus dem Dateinamen (16 Zeichen ASCII), Nummern
 * fortlaufend ab `--ab`. Ordner werden rekursiv durchsucht. Was nicht ins
 * ~24-MB-Sample-RAM passt, wird gemeldet.
 *
 * Am Geraet: „Sample Import All" — ⚠ ersetzt die User-Samples 501–999.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { parseWav } from "../src/core/wavCodec.ts";
import { importSampleFromWav, createPattern, buildBankFiles, EDITOR_PARTS } from "../src/core/editorModel.ts";
import { polyPhaseResample } from "../src/core/audioProcessor.ts";
import { dateiArt } from "../src/core/generatorSession.ts";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};
const quellen = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !(i > 0 && all[i - 1].startsWith("--") && all[i - 1] !== "--"));
const ziel = arg("ziel");
const ab = Number(arg("ab", "501"));
const rate = Number(arg("rate", "44100"));
if (!quellen.length || !ziel) {
  console.error("Aufruf: <datei|ordner> [...] --ziel <BANK.all> [--ab 501] [--rate 44100|22050]");
  process.exit(1);
}

function ffmpegPfad() {
  for (const py of ["python", "py"]) {
    try {
      const p = execFileSync(py, ["-c", "import imageio_ffmpeg;print(imageio_ffmpeg.get_ffmpeg_exe())"], { encoding: "utf8", timeout: 20000, windowsHide: true }).trim().split(/\r?\n/).pop();
      if (p && fs.existsSync(p)) return p;
    } catch {
      /* naechster Kandidat */
    }
  }
  return "ffmpeg";
}

function dateien(pfad) {
  const st = fs.statSync(pfad);
  if (st.isFile()) return [pfad];
  return fs
    .readdirSync(pfad, { withFileTypes: true })
    .filter((d) => !d.name.startsWith(".") && d.name.toLowerCase() !== "tekkforge")
    .flatMap((d) => (d.isDirectory() ? dateien(path.join(pfad, d.name)) : [path.join(pfad, d.name)]))
    .filter((f) => dateiArt(path.basename(f)) !== "skip")
    .sort();
}

let ff = null;
function alsWav(datei) {
  if (dateiArt(path.basename(datei)) === "wav") return new Uint8Array(fs.readFileSync(datei));
  ff ??= ffmpegPfad();
  const tmp = path.join(os.tmpdir(), `tekkforge-${process.pid}-${Date.now()}.wav`);
  const r = spawnSync(ff, ["-hide_banner", "-loglevel", "error", "-y", "-i", datei, "-vn", "-acodec", "pcm_s16le", tmp], { windowsHide: true, timeout: 600000 });
  if (r.status !== 0 || !fs.existsSync(tmp)) throw new Error(`ffmpeg: ${(r.stderr || "").toString().trim().split(/\r?\n/).pop() || "kein WAV entstanden"}`);
  const bytes = new Uint8Array(fs.readFileSync(tmp));
  fs.rmSync(tmp, { force: true });
  return bytes;
}

const alle = quellen.flatMap(dateien);
if (!alle.length) {
  console.error("Keine Audiodateien gefunden.");
  process.exit(1);
}
const samples = [];
const fehler = [];
for (const f of alle) {
  try {
    const wav = alsWav(f);
    parseWav(wav); // frueh scheitern, wenn es kein WAV ist
    const s = importSampleFromWav(wav, path.basename(f), samples);
    if (s.sampleRate !== rate) {
      s.pcm = polyPhaseResample(s.pcm, s.sampleRate, rate, 1);
      s.sampleRate = rate;
    }
    s.number = ab + samples.length;
    samples.push(s);
    console.log(`#${s.number} ${s.name.padEnd(16)} ${(s.pcm.length / s.sampleRate).toFixed(2)} s  ← ${path.basename(f)}`);
  } catch (e) {
    fehler.push(`${path.basename(f)}: ${e instanceof Error ? e.message : String(e)}`);
  }
}
if (!samples.length) {
  console.error("Nichts konvertiert:\n" + fehler.join("\n"));
  process.exit(1);
}
const dummy = createPattern("KONVERTIERT");
for (let i = 0; i < EDITOR_PARTS; i++) dummy.parts[i].muted = true;
const { all, warnings } = buildBankFiles({ version: 1, patterns: [dummy], samples });
if (!all) {
  console.error("Bank ist leer.");
  process.exit(1);
}
fs.mkdirSync(path.dirname(path.resolve(ziel)), { recursive: true });
fs.writeFileSync(ziel, all);
const mb = samples.reduce((n, s) => n + s.pcm.length * 2, 0) / 1048576;
console.log(`\n${ziel} — ${samples.length} Samples (${ab}–${ab + samples.length - 1}), ${all.length} Bytes, ~${mb.toFixed(1)} MB Sample-RAM${mb > 24 ? " ⚠ mehr als das Geraet hat (~24 MB)" : ""}`);
for (const w of warnings) console.log(`  ⚠ ${w}`);
for (const f of fehler) console.log(`  ✗ ${f}`);
console.log("Am Geraet: Sample Import All — ersetzt die User-Samples 501–999.");

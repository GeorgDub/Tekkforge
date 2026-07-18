/**
 * TekkForge CLI — KORG ESX-1 → Electribe 2 Sampler Converter.
 *
 * Befehle:
 *   tekkforge convert <input.esx> [-o <dir>] [--base <n>] [--cap <sek>] [--only <regex>]
 *   tekkforge inspect <datei>            (.esx | .all | .e2sallpat)
 *
 * Erzeugt aus einem ESX-1-Backup eine importfertige Pattern-Bank
 * (.e2sallpat, 250 Slots) plus Sample-Bank (.all, User-Samples ab 501)
 * plus Mapping-Report (Markdown).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as process from "node:process";
import { parseEsxBank, type EsxBank } from "./core/esxParser";
import {
  convertEsxToE2sBank,
  E2S_USER_SAMPLE_BASE,
  E2S_SAMPLE_SECONDS_CAP,
} from "./core/esxToE2sBank";
import { detectKorgBankType } from "./core/bankDetect";
import { parseE2sBank, countE2sSlots } from "./core/e2sBankReader";
import { buildE2sSampleMap } from "./core/e2sPatternSampleLink";
import { parseElectribeAllPatBank } from "./core/electribeImport";

const CLI_VERSION = "0.1.0";

const HELP = `TekkForge ${CLI_VERSION} — KORG ESX-1 → Electribe 2 Sampler Converter

Verwendung:
  tekkforge convert <input.esx> [Optionen]     ESX-Backup → .e2sallpat + .all + Mapping
  tekkforge inspect <datei>                    Inhalt anzeigen (.esx / .all / .e2sallpat)
  tekkforge help                               Diese Hilfe

Optionen für convert:
  -o, --out <dir>     Ausgabe-Verzeichnis (Default: neben der Eingabedatei)
  --base <n>          Erste User-Sample-Nummer (Default: ${E2S_USER_SAMPLE_BASE})
  --cap <sekunden>    Sample-RAM-Deckel in Mono-Sekunden (Default: ${E2S_SAMPLE_SECONDS_CAP})
  --only <regex>      Nur Patterns, deren Name auf das Muster passt (case-insensitive)

Beispiel:
  tekkforge convert BOTTROP.ESX -o out/
  → out/BOTTROP.e2sallpat  out/BOTTROP-samples.all  out/BOTTROP-mapping.md
`;

function fail(msg: string): never {
  process.stderr.write(`Fehler: ${msg}\n`);
  process.exit(1);
}

interface ConvertArgs {
  input: string;
  outDir: string;
  base: number;
  cap: number;
  only?: RegExp;
}

function parseConvertArgs(argv: string[]): ConvertArgs {
  let input = "";
  let outDir = "";
  let base = E2S_USER_SAMPLE_BASE;
  let cap = E2S_SAMPLE_SECONDS_CAP;
  let only: RegExp | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-o" || a === "--out") outDir = argv[++i] ?? "";
    else if (a === "--base") base = Number(argv[++i]);
    else if (a === "--cap") cap = Number(argv[++i]);
    else if (a === "--only") {
      const p = argv[++i];
      if (!p) fail("--only braucht ein Muster");
      try {
        only = new RegExp(p, "i");
      } catch {
        fail(`Ungültiges Regex-Muster: ${p}`);
      }
    } else if (a.startsWith("-")) fail(`Unbekannte Option: ${a}`);
    else if (!input) input = a;
    else fail(`Zu viele Argumente: ${a}`);
  }
  if (!input) fail("Keine Eingabedatei angegeben. Siehe: tekkforge help");
  if (!fs.existsSync(input)) fail(`Datei nicht gefunden: ${input}`);
  if (!Number.isFinite(base) || base < 1 || base > 999) fail("--base muss 1..999 sein");
  if (!Number.isFinite(cap) || cap <= 0) fail("--cap muss > 0 sein");
  if (!outDir) outDir = path.dirname(path.resolve(input));
  return { input, outDir, base, cap, only };
}

function cmdConvert(argv: string[]): void {
  const args = parseConvertArgs(argv);
  const bytes = new Uint8Array(fs.readFileSync(args.input));
  const name = path.basename(args.input);
  process.stdout.write(`Lese ${name} (${(bytes.length / 1e6).toFixed(1)} MB) …\n`);

  let esx: EsxBank = parseEsxBank(bytes, name);
  if (esx.patterns.length === 0 && esx.monoSamples.length === 0)
    fail("Keine Patterns/Samples in der Datei gefunden — ist das ein ESX-1-Backup?");

  if (args.only) {
    const filtered = esx.patterns.filter((p) => args.only!.test(p.name || ""));
    if (filtered.length === 0) fail(`--only ${args.only} trifft kein Pattern`);
    esx = { ...esx, patterns: filtered };
  }

  const res = convertEsxToE2sBank(esx, {
    userSampleBase: args.base,
    secondsCap: args.cap,
  });

  fs.mkdirSync(args.outDir, { recursive: true });
  const stem = path
    .basename(args.input)
    .replace(/\.(esx|ess)$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 50) || "esx";
  const outPat = path.join(args.outDir, `${stem}.e2sallpat`);
  const outAll = path.join(args.outDir, `${stem}-samples.all`);
  const outMap = path.join(args.outDir, `${stem}-mapping.md`);
  fs.writeFileSync(outPat, res.allpat);
  fs.writeFileSync(outAll, res.all);
  fs.writeFileSync(outMap, res.mapping, "utf8");

  const s = res.stats;
  process.stdout.write(
    [
      "",
      `Patterns:        ${s.patterns}`,
      `Samples:         ${s.samples} (${s.audioSeconds.toFixed(1)}s Audio, Limit ~${args.cap}s)` +
        (s.droppedSamples ? `  — ${s.droppedSamples} wegen Speicher weggelassen!` : ""),
      `Aktive Parts:    ${s.activeParts}, davon mit Sample verlinkt: ${s.linkedParts}`,
      "",
      `→ ${outPat}`,
      `→ ${outAll}`,
      `→ ${outMap}`,
      "",
      "Import: beide Dateien auf die SD-Karte (KORG/<Ordner>), am Gerät erst die",
      ".all-Sample-Bank, dann die .e2sallpat-Pattern-Bank importieren.",
      "",
    ].join("\n"),
  );
}

function cmdInspect(argv: string[]): void {
  const input = argv[0];
  if (!input) fail("Keine Datei angegeben");
  if (!fs.existsSync(input)) fail(`Datei nicht gefunden: ${input}`);
  const bytes = new Uint8Array(fs.readFileSync(input));
  const lower = input.toLowerCase();

  if (lower.endsWith(".e2sallpat") || lower.endsWith(".e2allpat")) {
    const bank = parseElectribeAllPatBank(bytes);
    process.stdout.write(`Pattern-Bank: ${bank.patterns.length} Patterns\n\n`);
    bank.patterns.forEach((p, i) => {
      const active = p.parts.filter((pt) => pt.steps.some((st) => st.active)).length;
      process.stdout.write(
        `${String(i + 1).padStart(3)}  ${(p.name || "(ohne Name)").padEnd(18)} ${String(p.bpm).padStart(6)} BPM  ${String(p.stepLength).padStart(2)} Steps  ${active} aktive Parts\n`,
      );
    });
    return;
  }

  const kind = detectKorgBankType(bytes);
  if (kind === "esx") {
    const esx = parseEsxBank(bytes, path.basename(input));
    process.stdout.write(
      `ESX-1-Backup: ${esx.patterns.length} Patterns, ${esx.monoSamples.length} Mono- + ${esx.stereoSamples.length} Stereo-Samples\n\n`,
    );
    for (const p of esx.patterns) {
      const active = p.parts.filter((pt) => pt.steps.some((st) => st.active)).length;
      if (!p.name && active === 0) continue;
      process.stdout.write(
        `${String(p.index + 1).padStart(3)}  ${(p.name || "(ohne Name)").padEnd(10)} ${p.bpm.toFixed(1).padStart(6)} BPM  ${String(p.lengthSteps).padStart(3)} Steps  ${active} aktive Parts\n`,
      );
    }
    return;
  }
  if (kind === "e2s") {
    const bank = parseE2sBank(bytes, path.basename(input));
    const map = buildE2sSampleMap(bank);
    process.stdout.write(`E2S-Sample-Bank (.all): ${countE2sSlots(bank)} Slots\n\n`);
    for (const [num, slot] of [...map.entries()].sort((a, b) => a[0] - b[0])) {
      process.stdout.write(`${String(num).padStart(4)}  ${slot.name}\n`);
    }
    return;
  }
  fail("Unbekanntes Format — erwartet .esx, .all oder .e2sallpat");
}

const [, , cmd, ...rest] = process.argv;
switch (cmd) {
  case "convert":
    cmdConvert(rest);
    break;
  case "inspect":
    cmdInspect(rest);
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    process.stdout.write(HELP);
    break;
  case "--version":
  case "-v":
    process.stdout.write(`tekkforge ${CLI_VERSION}\n`);
    break;
  default:
    fail(`Unbekannter Befehl: ${cmd}. Siehe: tekkforge help`);
}

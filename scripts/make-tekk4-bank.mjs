/**
 * Erzeugt tekk4.all — tekk3.all (byte-genau, Anzeige 501–569) plus neue
 * Klangfarben ab 570: Acid/303-Synths, Vocal-Shots und Riser/Sweeps aus den
 * Bestaenden. Material fuer die 100er-Sets (SET9/SET10) und das 50er (SET11).
 * Auswahl-Heuristik, Sperrliste und Namens-Dedupe wie bei tekk3.
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

const QUELLE = "examples/e2s/tekk3.all";
const ZIEL = process.argv[2] ?? "examples/e2s/tekk4.all";
const WURZELN = ["E:\\", "G:\\Mukke Stuff"];

const SPERRLISTE = [
  /^exKicK-10\./i, /^Rad MeLo/i, /^BAHRE_Snare_2/i, /^22inKickPowStrC/i,
  /^tittenspritzer/i, /^Der BasS MusS Fi/i, /^25955__walter/i,
  /^hardbassdrumz_05/i, /^Haus-alarm1\./i, /^Haus-alarm5_Hall/i,
];

/** Neue Klangfarben — Vocals/Acid als PCM (Kategorie 16), Riser als FX (11). */
const NEU = [
  { name: "Acid", kat: 16, anzahl: 4, dauer: [800, 6000], muster: /acid|303|hoover|reese/i },
  { name: "Vocal", kat: 16, anzahl: 4, dauer: [300, 4000], muster: /vocal|voice|shout|\bvox\b|sprech/i },
  { name: "Riser", kat: 11, anzahl: 3, dauer: [1500, 6000], muster: /riser|sweep|uplift|lift/i },
];

const basis = parseE2sBank(new Uint8Array(fs.readFileSync(QUELLE)), QUELLE);
const slots = [];
const vorhandeneNamen = new Set();
let hoechsteAnzeige = 0;
for (const s of basis.slots) {
  if (!s) continue;
  hoechsteAnzeige = Math.max(hoechsteAnzeige, oscToDisplayNumber(s.sampleNumber));
  vorhandeneNamen.add(s.name.trim().toLowerCase());
  slots.push({
    slotIndex: s.index, sampleNumber: s.sampleNumber, name: s.name,
    category: s.category, pcmData: s.pcmData, sampleRate: s.sampleRate, channels: s.channels,
  });
}
console.log(`${QUELLE}: ${slots.length} Samples unveraendert (bis Anzeige ${hoechsteAnzeige})`);

function sammle(wurzel, treffer, gesehen) {
  let stack = [wurzel];
  while (stack.length) {
    const dir = stack.pop();
    let eintraege;
    try {
      eintraege = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of eintraege) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(p);
      else if (/\.wav$/i.test(e.name)) {
        const schluessel = e.name.toLowerCase();
        if (gesehen.has(schluessel)) continue;
        gesehen.add(schluessel);
        treffer.push(p);
      }
    }
  }
}

const alle = [];
const gesehen = new Set();
for (const w of WURZELN) {
  if (!fs.existsSync(w)) continue;
  sammle(w, alle, gesehen);
}
console.log(`${alle.length} eindeutige WAVs in den Bestaenden`);

function kopf(p) {
  let fd;
  try {
    fd = fs.openSync(p, "r");
    const b = Buffer.alloc(64);
    fs.readSync(fd, b, 0, 64, 0);
    if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") return null;
    const rate = b.readUInt32LE(24), kanaele = b.readUInt16LE(22), bits = b.readUInt16LE(34);
    if (!rate || !kanaele || !bits) return null;
    const groesse = fs.statSync(p).size;
    const ms = ((groesse - 44) / (rate * kanaele * (bits / 8))) * 1000;
    return { rate, kanaele, bits, ms };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* egal */ }
  }
}

const kurz = (p) => path.basename(p, path.extname(p)).replace(/[^\x20-\x7e]/g, "").slice(0, 16).trim();

let nr = hoechsteAnzeige + 1;
for (const k of NEU) {
  const [minMs, maxMs] = k.dauer;
  const mitte = (minMs + maxMs) / 2;
  const kandidaten = [];
  const familien = new Map();
  for (const p of alle) {
    const datei = path.basename(p);
    if (!k.muster.test(datei)) continue;
    if (SPERRLISTE.some((rx) => rx.test(datei))) continue;
    if (vorhandeneNamen.has(kurz(p).toLowerCase())) continue;
    const stamm = datei.toLowerCase().replace(/[\d_\-. ]+/g, "").slice(0, 10);
    if ((familien.get(stamm) ?? 0) >= 2) continue;
    const h = kopf(p);
    if (!h || (h.rate !== 44100 && h.rate !== 48000) || h.bits !== 16) continue;
    if (h.ms < minMs || h.ms > maxMs) continue;
    familien.set(stamm, (familien.get(stamm) ?? 0) + 1);
    kandidaten.push({ p, abstand: Math.abs(h.ms - mitte) });
    if (kandidaten.length > k.anzahl * 40) break;
  }
  kandidaten.sort((a, b) => a.abstand - b.abstand);
  let genommen = 0;
  for (const kand of kandidaten) {
    if (genommen >= k.anzahl) break;
    let wav;
    try {
      wav = parseWav(new Uint8Array(fs.readFileSync(kand.p)));
    } catch {
      continue;
    }
    let pcm = wav.pcm;
    if (wav.channels === 2) {
      const mono = new Float32Array(wav.frames);
      for (let i = 0; i < wav.frames; i++) mono[i] = (pcm[i * 2] + pcm[i * 2 + 1]) / 2;
      pcm = mono;
    }
    const name = kurz(kand.p) || `S${nr}`;
    slots.push({
      slotIndex: displayNumberToSlotIndex(nr),
      sampleNumber: displayNumberToOsc(nr),
      name, category: k.kat, pcmData: pcm, sampleRate: wav.sampleRate, channels: 1,
    });
    vorhandeneNamen.add(name.toLowerCase());
    console.log(`  #${nr}  ${k.name.padEnd(5)} "${name}"  ${Math.round(wav.frames / wav.sampleRate * 1000)}ms`);
    nr++;
    genommen++;
  }
  console.log(`  ${k.name}: ${genommen}/${k.anzahl} aus ${kandidaten.length} Kandidaten`);
}

const bank = buildE2sBank(slots);
const out = Buffer.from(bank.buffer ?? bank);
fs.writeFileSync(ZIEL, out);
console.log(`${ZIEL} — ${(out.length / 1024 / 1024).toFixed(1)} MB · ${slots.length} Samples (Anzeige 501–${nr - 1})`);
fs.writeFileSync(
  ZIEL.replace(/\.all$/, "-inhalt.txt"),
  slots.map((s) => `${oscToDisplayNumber(s.sampleNumber)}\t${s.name}`).join("\n") + "\n",
);

/**
 * Erzeugt HARDTEKK.all — eine Sample-Bank aus den Beständen auf E:\ und
 * G:\Mukke Stuff, zugeschnitten auf das Hardtekk-Set.
 *
 * ## Wie ausgewählt wird — und was das nicht kann
 *
 * In beiden Beständen liegen zusammen rund 64 000 WAVs. Gehört habe ich
 * keines davon. Die Auswahl läuft deshalb über **Dateiname und Dauer**, und
 * das ist eine Heuristik, keine Kuratierung: eine Datei namens `kick_03.wav`
 * ist wahrscheinlich ein Kick, aber garantiert ist es nicht. Wo der Name
 * nichts hergibt, entscheidet die Dauer — ein 80-ms-Schnipsel ist eher eine
 * HiHat als eine Fläche.
 *
 * Was die Auswahl dagegen zuverlässig leistet: sie hält Format und Größe
 * ein, verteilt die Kategorien so, wie das Set sie braucht, und bevorzugt
 * innerhalb jeder Kategorie die Dauern, die dort musikalisch passen.
 *
 * Doppelte Dateinamen fliegen raus — die Bestände überschneiden sich stark
 * (beide enthalten `A.D.H.S. Samples`, `Super packet`, `ZaHnI_PacK_2`).
 *
 * ## Format
 *
 * Das Gerät nimmt 44,1 und 48 kHz. Alles andere wird übersprungen statt
 * umgerechnet — eine schlechte Resampling-Stufe hört man, und die Bestände
 * sind groß genug, dass Aussortieren nichts kostet. Stereo wird zu Mono
 * gemischt: halber Speicher, und im Set spielt nichts davon stereo.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildE2sBank } from "../src/core/e2sBankBuilder.ts";
import { parseWav } from "../src/core/wavCodec.ts";

const WURZELN = ["E:\\", "G:\\Mukke Stuff"];
const ZIEL = process.argv[2] ?? "examples/e2s/HARDTEKK.all";
const START_NR = 501;
const BUDGET_MB = 20;

/**
 * Kategorien des Sets. `muster` trifft den Dateinamen, `dauer` gibt den
 * bevorzugten Bereich in Millisekunden, `anzahl` wie viele hineinsollen.
 * `kat` ist die Geräte-Kategorie (siehe E2S_CATEGORY_NAMES).
 */
const KATEGORIEN = [
  { name: "Kick",   kat: 2,  anzahl: 18, dauer: [120, 900],   muster: /\b(kick|bd|bassdrum|kik)\b|kick/i },
  { name: "Snare",  kat: 3,  anzahl: 10, dauer: [80, 700],    muster: /snare|snr|\bsd\b/i },
  { name: "Clap",   kat: 4,  anzahl: 8,  dauer: [80, 600],    muster: /clap|clp/i },
  { name: "HiHat",  kat: 5,  anzahl: 12, dauer: [30, 500],    muster: /hat|hh\b|hihat/i },
  { name: "Perc",   kat: 13, anzahl: 10, dauer: [60, 800],    muster: /perc|conga|bongo|rim|cowbell|shak/i },
  { name: "Bass",   kat: 0,  anzahl: 12, dauer: [150, 2500],  muster: /bass|bas\b|sub\b|derb/i },
  { name: "Lead",   kat: 16, anzahl: 20, dauer: [400, 8000],  muster: /melo|lead|synth|mell|arp|chord|akkord/i },
  { name: "Pad",    kat: 14, anzahl: 8,  dauer: [2000, 12000], muster: /pad|atmo|string|fläche|flaeche|drone/i },
  { name: "FX",     kat: 11, anzahl: 8,  dauer: [200, 6000],  muster: /\bfx\b|sweep|riser|impact|noise|alarm/i },
];

// ─── Dateien einsammeln ──────────────────────────────────────────────────────

function sammle(wurzel, treffer, gesehen) {
  let stack = [wurzel];
  while (stack.length) {
    const dir = stack.pop();
    let eintraege;
    try {
      eintraege = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue; // unlesbare Ordner (System Volume Information o.ä.) still übergehen
    }
    for (const e of eintraege) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        stack.push(p);
      } else if (/\.wav$/i.test(e.name)) {
        const schluessel = e.name.toLowerCase();
        if (gesehen.has(schluessel)) continue; // Bestände überschneiden sich stark
        gesehen.add(schluessel);
        treffer.push(p);
      }
    }
  }
}

console.log("sammle Dateien …");
const alle = [];
const gesehen = new Set();
for (const w of WURZELN) {
  if (!fs.existsSync(w)) { console.log(`  ${w} — nicht vorhanden, übersprungen`); continue; }
  const vorher = alle.length;
  sammle(w, alle, gesehen);
  console.log(`  ${w} — ${alle.length - vorher} neue Dateien`);
}
console.log(`  ${alle.length} eindeutige WAVs`);

// ─── Auswählen ───────────────────────────────────────────────────────────────

/** Liest Kopfdaten, ohne die ganze Datei zu dekodieren. */
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
    return { rate, kanaele, bits, ms, groesse };
  } catch {
    return null;
  } finally {
    if (fd !== undefined) try { fs.closeSync(fd); } catch { /* egal */ }
  }
}

const gewaehlt = [];
const belegt = new Set();
for (const k of KATEGORIEN) {
  const [minMs, maxMs] = k.dauer;
  const mitte = (minMs + maxMs) / 2;
  const kandidaten = [];
  const familien = new Map();
  for (const p of alle) {
    const datei = path.basename(p);
    if (belegt.has(p) || !k.muster.test(datei)) continue;
    if (k.ausser?.test(datei)) continue;
    // Namensfamilien begrenzen: „BaSsKlaTsche55/57/59/64" ist viermal dasselbe.
    // Ziffern und Trennzeichen weg, dann zählt der Stamm.
    const stamm = datei.toLowerCase().replace(/[\d_\-. ]+/g, "").slice(0, 10);
    if ((familien.get(stamm) ?? 0) >= 2) continue;
    const h = kopf(p);
    if (!h || (h.rate !== 44100 && h.rate !== 48000) || h.bits !== 16) continue;
    if (h.ms < minMs || h.ms > maxMs) continue;
    // Näher an der Mitte des Zielbereichs = typischer für die Kategorie.
    familien.set(stamm, (familien.get(stamm) ?? 0) + 1);
    kandidaten.push({ p, h, abstand: Math.abs(h.ms - mitte) });
    if (kandidaten.length > k.anzahl * 40) break; // genug zur Auswahl
  }
  kandidaten.sort((a, b) => a.abstand - b.abstand);
  const nehmen = kandidaten.slice(0, k.anzahl);
  for (const n of nehmen) { belegt.add(n.p); gewaehlt.push({ ...n, kategorie: k }); }
  console.log(`  ${k.name.padEnd(6)} ${String(nehmen.length).padStart(2)}/${k.anzahl} aus ${kandidaten.length} Kandidaten`);
}

// ─── Dekodieren und bauen ────────────────────────────────────────────────────

const kurz = (p) => path.basename(p, path.extname(p)).replace(/[^\x20-\x7e]/g, "").slice(0, 16).trim();

const slots = [];
let bytes = 0, nr = START_NR;
for (const g of gewaehlt) {
  let wav;
  try {
    wav = parseWav(new Uint8Array(fs.readFileSync(g.p)));
  } catch {
    continue; // beschaedigte oder exotische Datei — es gibt genug andere
  }
  // Stereo zu Mono mischen: halber Speicher, und im Set spielt nichts stereo.
  let pcm = wav.pcm;
  if (wav.channels === 2) {
    const mono = new Float32Array(wav.frames);
    for (let i = 0; i < wav.frames; i++) mono[i] = (pcm[i * 2] + pcm[i * 2 + 1]) / 2;
    pcm = mono;
  }
  const b = pcm.length * 2;
  if (bytes + b > BUDGET_MB * 1024 * 1024) continue;
  bytes += b;
  slots.push({
    slotIndex: nr, sampleNumber: nr, name: kurz(g.p) || `S${nr}`,
    category: g.kategorie.kat, pcmData: pcm, sampleRate: wav.sampleRate, channels: 1,
    _kat: g.kategorie.name, _ms: Math.round(wav.frames / wav.sampleRate * 1000),
  });
  nr++;
}

const bank = buildE2sBank(slots.map(({ _kat, _ms, ...s }) => s));
const out = Buffer.from(bank.buffer ?? bank);
fs.writeFileSync(ZIEL, out);

console.log("");
console.log(`${ZIEL} — ${(out.length / 1024 / 1024).toFixed(1)} MB · ${slots.length} Samples ab #${START_NR}`);
const proKat = {};
for (const s of slots) (proKat[s._kat] ??= []).push(s);
for (const [k, list] of Object.entries(proKat)) {
  console.log(`  ${k.padEnd(6)} ${String(list.length).padStart(2)} · #${list[0].sampleNumber}–${list[list.length - 1].sampleNumber}`);
  console.log(`         ${list.slice(0, 6).map((s) => `${s.name}(${s._ms}ms)`).join("  ")}`);
}
fs.writeFileSync(
  ZIEL.replace(/\.all$/, "-inhalt.txt"),
  slots.map((s) => `${s.sampleNumber}\t${s._kat}\t${s.name}\t${s._ms}ms`).join("\n") + "\n",
);

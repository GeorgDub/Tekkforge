/**
 * Erzeugt tekk2.all — die Nutzer-Bank tekk.all, erweitert um das am Geraet
 * fuer gut befundene HARDTEKK-Material (Hoerrunde 7, 2026-08-15: das
 * Kratzen von Set 5 sass letztlich im Rohmaterial — der einzige Synth
 * "Synth Le" traegt keinen Bass, und melodisches Material fehlte).
 *
 *   501–533  die 33 handverlesenen tekk.all-Samples, byte-genau unveraendert
 *   534+     aus HARDTEKK.all uebernommen (dort bereits konvertiert und am
 *            Geraet gehoert): die beiden Wunsch-Baesse, das Sieger-Melo-Paket
 *            aus dem Varianten-Durchhoeren, weitere Melos, Pads und FX.
 *
 * Geraete-Konvention: Index == OSC_0index == Anzeige − 1 (SLOTNUM2-Messung).
 */
import * as fs from "node:fs";
import { buildE2sBank } from "../src/core/e2sBankBuilder.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import {
  displayNumberToOsc,
  displayNumberToSlotIndex,
  oscToDisplayNumber,
} from "../src/core/e2sPatternSampleLink.ts";

const QUELLE_TEKK = "examples/e2s/tekk.all";
const QUELLE_HARDTEKK = "examples/e2s/HARDTEKK.all";
const ZIEL = process.argv[2] ?? "examples/e2s/tekk2.all";

/** Aus HARDTEKK zu uebernehmen (Namens-Anfaenge; Reihenfolge = Nummernfolge). */
const UEBERNAHME = [
  // Baesse — beide am Geraet gewaehlt ("560 oder 565 passen gut").
  "Unison_Bass_C3", "Bassdrum-01fd", "S53vesterbass", "Kick The Bass 2",
  // Sieger-Melos (Paket C) + T-Mello (Part-11-Wahl nach dem Rad-MeLo-Aus).
  "T-Mello", "Tau-MeLo", "HBsChE PaRa MeLo", "Auf CrystaL-MeLo",
  // Weitere Melos zum Zocken/Wechseln.
  "HaMMeR MeLo", "Genetikk - MeLo", "PsyChoTanZmELo1", "Krieger-MeLo",
  "melo neu 2", "SYNTHHS3", "Wfg90_MeLo",
  // Flaechen + FX.
  "Padseq~1", "PAD_ResoChor", "Strings of Wisdo", "TeRR5Rt FX 1!", "Riser 6 4 Bars 1",
];

function lade(pfad) {
  const buf = fs.readFileSync(pfad);
  return parseE2sBank(new Uint8Array(buf), pfad);
}

const tekk = lade(QUELLE_TEKK);
const hardtekk = lade(QUELLE_HARDTEKK);

const slots = [];
let hoechsteAnzeige = 0;
for (const s of tekk.slots) {
  if (!s) continue;
  hoechsteAnzeige = Math.max(hoechsteAnzeige, oscToDisplayNumber(s.sampleNumber));
  slots.push({
    slotIndex: s.index,
    sampleNumber: s.sampleNumber,
    name: s.name,
    category: s.category,
    pcmData: s.pcmData,
    sampleRate: s.sampleRate,
    channels: s.channels,
  });
}
console.log(`tekk.all: ${slots.length} Samples unveraendert (bis Anzeige ${hoechsteAnzeige})`);

let nr = hoechsteAnzeige + 1;
for (const wunsch of UEBERNAHME) {
  const s = hardtekk.slots.find(
    (x) => x && x.name.trim().toLowerCase().startsWith(wunsch.toLowerCase()),
  );
  if (!s) {
    console.log(`  FEHLT in HARDTEKK.all: "${wunsch}" — uebersprungen`);
    continue;
  }
  slots.push({
    slotIndex: displayNumberToSlotIndex(nr),
    sampleNumber: displayNumberToOsc(nr),
    name: s.name,
    category: s.category,
    pcmData: s.pcmData,
    sampleRate: s.sampleRate,
    channels: s.channels,
  });
  console.log(`  #${nr}  ${s.categoryName.padEnd(8)} "${s.name}"`);
  nr++;
}

const bank = buildE2sBank(slots);
const out = Buffer.from(bank.buffer ?? bank);
fs.writeFileSync(ZIEL, out);
console.log(`${ZIEL} — ${(out.length / 1024 / 1024).toFixed(1)} MB · ${slots.length} Samples (Anzeige 501–${nr - 1})`);
fs.writeFileSync(
  ZIEL.replace(/\.all$/, "-inhalt.txt"),
  slots
    .map((s) => `${oscToDisplayNumber(s.sampleNumber)}\t${s.name}`)
    .join("\n") + "\n",
);

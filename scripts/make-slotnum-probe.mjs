/**
 * Erzeugt SLOTNUM.all — eine Minimalbank, die nur eine Frage beantwortet:
 * welche Nummer zeigt das Gerät für einen gegebenen Tabellenplatz?
 *
 * Drei kurze Sinustöne auf den Plätzen 498, 499 und 500, benannt nach ihrem
 * Platz. Am Gerät liest man die Zuordnung dann direkt ab — ohne Umweg über
 * unseren Leser, der genau hier zweimal in die Irre geführt hat.
 *
 * Die Töne sind unterschiedlich hoch, damit auch hörbar ist, welcher spielt.
 */
import * as fs from "node:fs";
import { buildE2sBank } from "../src/core/e2sBankBuilder.ts";

const RATE = 44100;
const ton = (hz, ms = 250) => {
  const n = Math.round((RATE * ms) / 1000);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const h = Math.min(1, i / 200) * Math.min(1, (n - i) / 2000); // weiche Flanken
    a[i] = Math.sin((2 * Math.PI * hz * i) / RATE) * 0.7 * h;
  }
  return a;
};

const PLAETZE = [498, 499, 500];
const HZ = [440, 554, 659]; // A, C#, E — als Dreiklang unterscheidbar

const slots = PLAETZE.map((platz, i) => ({
  slotIndex: platz,
  sampleNumber: platz + 1, // wie bisher: unser Leser nennt das die Anzeigenummer
  name: `PLATZ ${platz}`,
  category: 17,
  pcmData: ton(HZ[i]),
  sampleRate: RATE,
  channels: 1,
}));

const bank = buildE2sBank(slots);
const out = Buffer.from(bank.buffer ?? bank);
fs.writeFileSync("examples/e2s/SLOTNUM.all", out);
console.log(`examples/e2s/SLOTNUM.all — ${(out.length / 1024).toFixed(0)} KB`);
for (const s of slots) console.log(`  Tabellenplatz ${s.slotIndex}  Name "${s.name}"`);

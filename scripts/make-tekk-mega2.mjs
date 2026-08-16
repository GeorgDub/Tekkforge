/**
 * Erzeugt TEKK_MEGA2.e2sallpat — die zweite 250er-Bank, diesmal mit
 * variablen Blockgroessen (Nutzerwunsch 2026-08-16: zwei Sets a 100 plus
 * eines mit 50):
 *
 *     Slots   1–100  TEKK_SET9   (175, Langstrecke, 100 Patterns)
 *     Slots 101–200  TEKK_SET10  (184, Doppeldecker, 100 Patterns)
 *     Slots 201–250  TEKK_SET11  (166, Kurzschluss, 50 Patterns)
 *
 * Bank: tekk4.all. Ketten-Verweise werden je Block um den kumulierten
 * Offset verschoben; 0 (Jam/Ende) bleibt 0.
 */
import * as fs from "node:fs";

const QUELLEN = [
  { pfad: "examples/e2s/TEKK_SET9.e2sallpat", anzahl: 100 },
  { pfad: "examples/e2s/TEKK_SET10.e2sallpat", anzahl: 100 },
  { pfad: "examples/e2s/TEKK_SET11.e2sallpat", anzahl: 50 },
];
const ZIEL = process.argv[2] ?? "examples/e2s/TEKK_MEGA2.e2sallpat";

const ERSTER_SLOT = 0x10100;
const BODY = 0x4000;
const SLOTS = 250;
const CHAIN_TO_OFF = 0x3b00;
const DATEI_GROESSE = ERSTER_SLOT + SLOTS * BODY;

const summe = QUELLEN.reduce((n, q) => n + q.anzahl, 0);
if (summe !== SLOTS) throw new Error(`Bloecke ergeben ${summe} statt ${SLOTS}`);

const dateien = QUELLEN.map((q) => {
  const b = fs.readFileSync(q.pfad);
  if (b.length !== DATEI_GROESSE) throw new Error(`${q.pfad}: unerwartete Groesse ${b.length}`);
  return b;
});

const out = Buffer.from(dateien[0]);
let offset = 0;
for (let block = 0; block < QUELLEN.length; block++) {
  const quelle = dateien[block];
  for (let p = 0; p < QUELLEN[block].anzahl; p++) {
    const von = ERSTER_SLOT + p * BODY;
    const nach = ERSTER_SLOT + (offset + p) * BODY;
    quelle.copy(out, nach, von, von + BODY);
    const chain = out.readUInt16LE(nach + CHAIN_TO_OFF);
    if (chain !== 0) out.writeUInt16LE(chain + offset, nach + CHAIN_TO_OFF);
  }
  offset += QUELLEN[block].anzahl;
}

fs.writeFileSync(ZIEL, out);
console.log(`${ZIEL} — ${out.length} Bytes · ${SLOTS} Patterns aus ${QUELLEN.length} Sets`);
let start = 1;
for (const q of QUELLEN) {
  console.log(`  Slots ${String(start).padStart(3)}–${start + q.anzahl - 1}  ${q.pfad.split("/").pop()}`);
  start += q.anzahl;
}

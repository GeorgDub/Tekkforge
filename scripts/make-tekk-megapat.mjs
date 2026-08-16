/**
 * Erzeugt TEKK_MEGA.e2sallpat — fuenf komplette Sets in EINER Pattern-Bank
 * (Nutzerwunsch 2026-08-15: einmal laden, alles zocken). Eine .e2sallpat
 * fasst exakt 250 Patterns; fuenf Sets x 50 fuellen sie randlos:
 *
 *     Slots   1– 50  TEKK_SET    (160, Final)
 *     Slots  51–100  TEKK_SET8   (170, Wechselspiel + Jams)
 *     Slots 101–150  TEKK_SET5   (192, Vollgas + Jams)
 *     Slots 151–200  TEKK_SET6   (178, Nachtschicht + Jams)
 *     Slots 201–250  TEKK_SET7   (165, Sonnendeck + Jams)
 *
 * SET2/SET3/SET4/SET_180 passen nicht mehr hinein — die Auswahl laesst sich
 * hier in QUELLEN einfach tauschen. Bank: tekk3.all (enthaelt tekk2
 * byte-genau, darum bleiben auch die aelteren Sets kompatibel; SET8 braucht
 * die 554+-Melos aus tekk3).
 *
 * Die Ketten-Verweise (chainTo, 1-basiert) werden je Block um den Offset
 * verschoben, damit jede Kette in ihrem Set bleibt; 0 (Jam/Ende) bleibt 0.
 */
import * as fs from "node:fs";

const QUELLEN = [
  "examples/e2s/TEKK_SET.e2sallpat",
  "examples/e2s/TEKK_SET8.e2sallpat",
  "examples/e2s/TEKK_SET5.e2sallpat",
  "examples/e2s/TEKK_SET6.e2sallpat",
  "examples/e2s/TEKK_SET7.e2sallpat",
];
const ZIEL = process.argv[2] ?? "examples/e2s/TEKK_MEGA.e2sallpat";

// Layout der .e2sallpat (verifiziert in tests/e2s-bank-from-esx.test.ts):
const ERSTER_SLOT = 0x10100;
const BODY = 0x4000;
const SLOTS = 250;
const PRO_SET = 50;
const CHAIN_TO_OFF = 0x3b00; // u16 LE im Pattern-Body, 1-basiert, 0 = Ende
const DATEI_GROESSE = ERSTER_SLOT + SLOTS * BODY;

if (QUELLEN.length * PRO_SET !== SLOTS)
  throw new Error(`${QUELLEN.length} Sets x ${PRO_SET} != ${SLOTS}`);

const dateien = QUELLEN.map((p) => {
  const b = fs.readFileSync(p);
  if (b.length !== DATEI_GROESSE)
    throw new Error(`${p}: unerwartete Groesse ${b.length}`);
  return b;
});

// Kopf + Slot-Bereich von der ersten Quelle uebernehmen, dann Bloecke einsetzen.
const out = Buffer.from(dateien[0]);
for (let block = 0; block < QUELLEN.length; block++) {
  const quelle = dateien[block];
  const offset = block * PRO_SET;
  for (let p = 0; p < PRO_SET; p++) {
    const von = ERSTER_SLOT + p * BODY;
    const nach = ERSTER_SLOT + (offset + p) * BODY;
    quelle.copy(out, nach, von, von + BODY);
    const chain = out.readUInt16LE(nach + CHAIN_TO_OFF);
    if (chain !== 0) out.writeUInt16LE(chain + offset, nach + CHAIN_TO_OFF);
  }
}

fs.writeFileSync(ZIEL, out);
console.log(`${ZIEL} — ${out.length} Bytes · ${SLOTS} Patterns aus ${QUELLEN.length} Sets`);
QUELLEN.forEach((q, k) =>
  console.log(`  Slots ${String(k * PRO_SET + 1).padStart(3)}–${(k + 1) * PRO_SET}  ${q.split("/").pop()}`),
);

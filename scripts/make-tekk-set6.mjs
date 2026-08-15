/**
 * Erzeugt TEKK_SET6.e2sallpat — "NACHTSCHICHT": dunkel-melodisch, 178 BPM,
 * fuer tekk2.all. Nutzt das Material, das bisher nur in den Jams lag:
 * Krieger/PsyChoTanZ/Genetikk/Wfg90 als Melos, PAD_ResoChor als Flaeche,
 * S53vesterbass als Motor, der Riser als Break-FX.
 *
 * Struktur wie Set 5 (bewaehrt): gekettete Segmente, die in loopende
 * JAM-Patterns muenden (Parts 11–14 ungemutet, selbst zocken), weiter geht
 * es per Patternwahl. Alle Glaettungs-Lektionen der Hoerrunden 1–7 sind
 * eingebaut: einstimmige Melos nahe Unity, echter Bass in Basslage, kein
 * doppeltes Sample als Layer, Headroom statt Anschlag.
 */
import * as fs from "node:fs";
import { buildE2AllPatFile } from "../src/core/e2sExport.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import {
  bankNumberToE2PatternRef,
  oscToDisplayNumber,
} from "../src/core/e2sPatternSampleLink.ts";

const BANK = process.argv[3] ?? "examples/e2s/tekk2.all";
const ZIEL = process.argv[2] ?? "examples/e2s/TEKK_SET6.e2sallpat";
const N = 64;
const BPM = Number(process.argv[4]) || 178;

const MONO1 = 0, MONO2 = 1, POLY2 = 3;

/** Dunkel: Am–G–F–E (absteigend, die Nachtfahrt), B faellt nach Dm. */
const THEMA = {
  A: {
    akkorde: [[57, 60, 64], [55, 59, 62], [53, 57, 60], [52, 56, 59]], // Am G F E
    bass: [33, 31, 29, 28],
  },
  B: {
    akkorde: [[50, 53, 57], [53, 57, 60], [52, 56, 59], [52, 56, 59]], // Dm F E E
    bass: [26, 29, 28, 28],
  },
};

const BELEGUNG = [
  ["Kick", "HaimKind"], ["Kick", "Jumpkick"], ["Snare", "clydesna"], ["Snare", "snarre-p"],
  ["HiHat", "closed 8"], ["HiHat", "707_hho"], ["Shots", "ED Close"], ["Shots", "ZaHnI_Ma"],
  ["Analog", "S53vesterbass"], ["Analog", "Unison_Bass_C3"], ["PCM", "Krieger"], ["PCM", "PsyChoTanZ"],
  ["PCM", "Genetikk"], ["PCM", "Wfg90"], ["Phrase", "PAD_ResoChor"], ["FX", "Riser"],
];
const VOLUME = [127, 110, 106, 96, 84, 88, 80, 78, 116, 100, 98, 96, 94, 94, 64, 92];
const VOICE = [MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1,
               MONO2, MONO2, POLY2, POLY2, POLY2, MONO1, POLY2, POLY2];

/** Jam-Saetze — jede Nachtschicht-Pause hat ihr eigenes Werkzeug. */
const JAM_SETS = {
  A: [["PCM", "Krieger"], ["PCM", "PsyChoTanZ"], ["PCM", "Genetikk"], ["PCM", "Wfg90"]],
  B: [["PCM", "T-Mello"], ["PCM", "Tau-MeLo"], ["PCM", "HBsChE PaRa"], ["PCM", "Auf CrystaL"]],
  C: [["PCM", "HaMMeR"], ["PCM", "melo neu 2"], ["PCM", "SYNTHHS3"], ["Loop", "killerme"]],
  D: [["Shots", 0], ["Shots", "Freddy L"], ["Shots", "Sound7-M"], ["Shots", "VEC2 Syn"]],
};

// ─── Dramaturgie: 50 Patterns ────────────────────────────────────────────────
// [Name, Intensität, Thema, Kick-Figur, Wiederholungen, Jam-Satz?]
const PLAN = [
  // Segment 1 → JAM A
  ["EINFAHRT 1",   0, "A", "vier", 2],
  ["EINFAHRT 2",   1, "A", "vier", 2],
  ["SCHICHT 1",    2, "A", "vier", 2],
  ["SCHICHT 2",    3, "A", "hart", 2],
  ["ANDRUCK 1",    4, "A", "roll", 1],
  ["NACHT 1",      5, "A", "hart", 2],
  ["NACHT 2",      5, "A", "doppel", 2],
  ["NACHT 3",      5, "A", "hart", 2],
  ["LEERLAUF 1",   3, "A", "vier", 2],
  ["JAM A",        2, "A", "vier", 1, "A"],
  // Segment 2 → JAM B
  ["SCHICHT 3",    2, "B", "hart", 2],
  ["SCHICHT 4",    3, "B", "vier", 2],
  ["ANDRUCK 2",    4, "B", "roll", 1],
  ["NACHT 4",      5, "B", "hart", 2],
  ["NACHT 5",      5, "B", "doppel", 2],
  ["NACHT 6",      5, "B", "hart", 1],
  ["LEERLAUF 2",   4, "B", "vier", 2],
  ["LEERLAUF 3",   3, "B", "hart", 2],
  ["PAUSE 1",     -1, "B", "kein", 1],
  ["JAM B",        2, "B", "vier", 1, "B"],
  // Segment 3 → JAM C
  ["SCHICHT 5",    3, "A", "hart", 2],
  ["SCHICHT 6",    4, "A", "doppel", 1],
  ["ANDRUCK 3",    5, "A", "roll", 1],
  ["NACHT 7",      5, "A", "doppel", 2],
  ["NACHT 8",      5, "A", "hart", 2],
  ["NACHT 9",      5, "B", "doppel", 1],
  ["LEERLAUF 4",   4, "A", "vier", 2],
  ["LEERLAUF 5",   3, "A", "hart", 2],
  ["PAUSE 2",     -1, "A", "kein", 1],
  ["JAM C",        2, "A", "vier", 1, "C"],
  // Segment 4 → JAM D
  ["SCHICHT 7",    3, "B", "hart", 2],
  ["ANDRUCK 4",    4, "B", "roll", 1],
  ["NACHT 10",     5, "B", "hart", 2],
  ["NACHT 11",     5, "B", "doppel", 2],
  ["NACHT 12",     5, "B", "hart", 2],
  ["NACHT 13",     5, "A", "doppel", 2],
  ["LEERLAUF 6",   4, "B", "vier", 2],
  ["PAUSE 3",     -1, "B", "kein", 1],
  ["JAM D",        2, "B", "vier", 1, "D"],
  ["SCHICHT 8",    3, "A", "hart", 1],
  // Segment 5 → Feierabend
  ["ANDRUCK 5",    4, "A", "roll", 1],
  ["NACHT 14",     5, "A", "hart", 2],
  ["NACHT 15",     5, "A", "doppel", 2],
  ["NACHT 16",     5, "B", "hart", 2],
  ["AUSFAHRT 1",   4, "A", "vier", 2],
  ["AUSFAHRT 2",   3, "A", "vier", 2],
  ["AUSFAHRT 3",   2, "A", "hart", 1],
  ["AUSFAHRT 4",   1, "A", "vier", 2],
  ["FEIERABEND",   0, "A", "vier", 1],
  ["JAM FREI",     2, "A", "vier", 1, "A"],
];

// ─── Bausteine ───────────────────────────────────────────────────────────────

const takt = (s) => Math.floor(s / 16);
const imTakt = (s) => s % 16;
const leer = () => Array.from({ length: N }, () => ({ active: false }));
const hit = (notes, velocity, gate) => ({ active: true, notes, velocity, gate });

function baue(fn) {
  return Array.from({ length: N }, (_, s) => fn(s) ?? { active: false });
}

const KICK = {
  kein: () => leer(),
  vier: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : null)),
  hart: () =>
    baue((s) =>
      s % 4 === 0 ? hit([60], 112, 40) : imTakt(s) === 15 ? hit([60], 108, 14) : null,
    ),
  doppel: () =>
    baue((s) =>
      s % 4 === 0
        ? hit([60], 112, 40)
        : imTakt(s) === 7 || imTakt(s) === 15
          ? hit([60], 106, 14)
          : null,
    ),
  roll: () =>
    baue((s) => (s % 4 === 0 || (takt(s) === 3 && s % 2 === 0) ? hit([60], 112, 28) : null)),
};

function partsFuer(intensitaet, thema, kickFigur, jamMelos) {
  const t = THEMA[thema];
  const breakStelle = intensitaet < 0;
  const i = breakStelle ? 0 : intensitaet;

  const steps = Array.from({ length: 16 }, leer);

  if (!breakStelle) steps[0] = KICK[kickFigur]();
  if (i >= 5) steps[1] = baue((s) => (imTakt(s) === 8 ? hit([60], 98, 22) : null));
  if (i >= 3 || kickFigur === "roll")
    steps[2] = baue((s) => {
      if (kickFigur === "roll" && takt(s) === 3) return hit([60], 102, 10);
      if (i >= 3 && (imTakt(s) === 4 || imTakt(s) === 12)) return hit([60], 108, 28);
      return null;
    });
  if (i >= 4) steps[3] = baue((s) => (imTakt(s) === 12 ? hit([60], 100, 22) : null));
  if (i >= 1) steps[4] = baue((s) => (s % 4 === 2 ? hit([60], 82, 11) : null));
  if (i >= 3)
    steps[5] = baue((s) =>
      imTakt(s) === 14 || (i >= 4 && imTakt(s) === 6) ? hit([60], 88, 32) : null,
    );
  if (i >= 4) steps[6] = baue((s) => (s % 8 === 5 ? hit([60], 78, 13) : null));
  if (i >= 5) steps[7] = baue((s) => (s % 8 === 7 ? hit([60], 72, 11) : null));
  // Bass in Basslage, Offbeats + Pickups — kein Layer-Doppel, Headroom.
  if (i >= 2) {
    steps[8] = baue((s) => {
      if (s % 4 === 2) return hit([t.bass[takt(s)]], 110, 16);
      if (i >= 4 && imTakt(s) === 7) return hit([t.bass[takt(s)]], 100, 9);
      if (i >= 4 && imTakt(s) === 15) return hit([t.bass[(takt(s) + 1) % 4]], 100, 9);
      return null;
    });
  }
  // Melos einstimmig nahe Unity: Frage auf der Eins, Antwort auf der Drei,
  // Akzent jeden zweiten Takt, Laeufer ab Intensitaet 4.
  if (i >= 3) steps[10] = baue((s) => (imTakt(s) === 0 ? hit([t.akkorde[takt(s)][0]], 88, 96) : null));
  if (i >= 4) steps[11] = baue((s) => (imTakt(s) === 8 ? hit([t.akkorde[takt(s)][0]], 86, 96) : null));
  if (i >= 5)
    steps[12] = baue((s) =>
      imTakt(s) === 10 && takt(s) % 2 === 1 ? hit([t.akkorde[takt(s)][0]], 84, 20) : null,
    );
  if (i >= 4) steps[13] = baue((s) => (imTakt(s) === 0 ? hit([t.akkorde[takt(s)][0]], 82, 96) : null));

  if (breakStelle) {
    steps[12] = baue((s) => (imTakt(s) === 0 ? hit([t.akkorde[takt(s)][0]], 84, 96) : null));
    steps[13] = baue((s) => (s === 0 ? hit([t.akkorde[0][0]], 78, 96) : null));
    steps[14] = baue((s) =>
      imTakt(s) === 0 ? hit(t.akkorde[takt(s)].map((n) => n - 12), 62, 96) : null,
    );
    steps[15] = baue((s) => (s === 0 ? hit([60], 88, 96) : null));
  }

  if (jamMelos) {
    // Duennes Starter-Muster (Nutzerwunsch): je ein Anschlag pro Loop,
    // versetzt — im Sequencer greifbar, ueber die Pads frei spielbar.
    steps[10] = baue((s) => (s === 0 ? hit([t.akkorde[0][0]], 88, 96) : null));
    steps[11] = baue((s) => (takt(s) === 1 && imTakt(s) === 8 ? hit([t.akkorde[1][0]], 86, 96) : null));
    steps[12] = baue((s) => (takt(s) === 2 && imTakt(s) === 0 ? hit([t.akkorde[2][0]], 84, 96) : null));
    steps[13] = baue((s) => (takt(s) === 3 && imTakt(s) === 0 ? hit([t.akkorde[3][0]], 84, 96) : null));
  }

  return steps.map((st, idx) => {
    const aktiv = st.filter((x) => x.active).length;
    const jamPart = jamMelos && idx >= 10 && idx <= 13;
    return {
      sampleId: bankNumberToE2PatternRef(jamPart ? jamMelos[idx - 10] : SAMPLES[idx]),
      steps: st,
      volume: jamPart ? 104 : VOLUME[idx],
      params: { voiceAssign: VOICE[idx] },
      muted: jamPart ? false : aktiv === 0, // Jam-Parts bleiben offen zum Zocken.
    };
  });
}

// ─── Bauen ───────────────────────────────────────────────────────────────────

const buf = fs.readFileSync(BANK);
const bank = parseE2sBank(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const belegt = bank.slots.filter((s) => s && s.frames > 0);

const nachKategorie = new Map();
for (const s of belegt) {
  if (!nachKategorie.has(s.categoryName)) nachKategorie.set(s.categoryName, []);
  nachKategorie.get(s.categoryName).push(s);
}

function findeAnzeige(kat, wahl) {
  const liste = nachKategorie.get(kat) ?? [];
  const s =
    typeof wahl === "string"
      ? liste.find((x) => x.name.trim().toLowerCase().startsWith(wahl.toLowerCase()))
      : liste[Math.min(wahl, liste.length - 1)];
  if (!s) throw new Error(`Kategorie "${kat}": "${wahl}" nicht gefunden`);
  return { nr: oscToDisplayNumber(s.sampleNumber), name: s.name.trim() };
}

const SAMPLES = [], NAMEN = [];
for (const [kat, wahl] of BELEGUNG) {
  const a = findeAnzeige(kat, wahl);
  SAMPLES.push(a.nr);
  NAMEN.push(a.name);
}
console.log(`Bank: ${BANK.split(/[\/]/).pop()} — ${belegt.length} Samples · Set 6 NACHTSCHICHT (${BPM} BPM)`);
BELEGUNG.forEach(([kat], i) =>
  console.log(`  Part ${String(i + 1).padStart(2)}  ${kat.padEnd(7)} #${SAMPLES[i]} ${NAMEN[i]}`),
);

const JAM_MELOS = {};
for (const [key, eintraege] of Object.entries(JAM_SETS)) {
  const aufgeloest = eintraege.map(([kat, wahl]) => findeAnzeige(kat, wahl));
  JAM_MELOS[key] = aufgeloest.map((a) => a.nr);
  console.log(`  Jam ${key}: ${aufgeloest.map((a) => `#${a.nr} ${a.name}`).join(" · ")}`);
}

const patterns = PLAN.map(([name, intens, thema, kick, wdh, jam], i) => ({
  name,
  bpm: BPM,
  stepLength: 64,
  parts: partsFuer(intens, thema, kick, jam ? JAM_MELOS[jam] : undefined),
  alternate13_14: false,
  alternate15_16: false,
  chainTo: jam || i + 1 >= PLAN.length ? 0 : i + 2,
  chainRepeat: wdh,
}));

const out = Buffer.from(buildE2AllPatFile(patterns));
fs.writeFileSync(ZIEL, out);

console.log(`${ZIEL} — ${out.length} Bytes · ${patterns.length} Patterns · ${BPM} BPM`);
let takte = 0;
for (const [i, p] of patterns.entries()) {
  const [name, intens, , kick, wdh] = PLAN[i];
  takte += wdh * 4;
  if (!p.chainTo)
    console.log(`  ${String(i + 1).padStart(2)} ${name.padEnd(12)} → Ende (Jam/Loop)`);
}
console.log(`  Kette gesamt: ${takte} Takte ≈ ${Math.round((takte * 4 * 60) / BPM / 60)} Minuten`);

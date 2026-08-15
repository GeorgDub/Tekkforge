/**
 * Erzeugt TEKK_SET7.e2sallpat — "SONNENDECK": warm und rollend, 165 BPM,
 * fuer tekk2.all. Das entspannteste der Familie: Pump-Groove ueber die
 * Offbeat-Snare, HaMMeR/melo neu 2/SYNTHHS3/T-Mello als Melos, Strings of
 * Wisdo als Flaeche, Kick The Bass 2 als runder Motor. Breaks duerfen hier
 * atmen (2x), die Drops bleiben freundlich.
 *
 * Struktur wie Set 5/6: gekettete Segmente muenden in loopende JAM-Patterns
 * (Parts 11–14 ungemutet, selbst zocken). Alle Glaettungs-Lektionen der
 * Hoerrunden 1–7 sind eingebaut.
 */
import * as fs from "node:fs";
import { buildE2AllPatFile } from "../src/core/e2sExport.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import {
  bankNumberToE2PatternRef,
  oscToDisplayNumber,
} from "../src/core/e2sPatternSampleLink.ts";

const BANK = process.argv[3] ?? "examples/e2s/tekk2.all";
const ZIEL = process.argv[2] ?? "examples/e2s/TEKK_SET7.e2sallpat";
const N = 64;
const BPM = Number(process.argv[4]) || 165;

const MONO1 = 0, MONO2 = 1, POLY2 = 3;

/** Warm: F–C–G–Am (die freundliche Runde), B hebt ueber Dm–F–C–G an. */
const THEMA = {
  A: {
    akkorde: [[53, 57, 60], [55, 60, 64], [55, 59, 62], [57, 60, 64]], // F C G Am
    bass: [29, 36, 31, 33],
  },
  B: {
    akkorde: [[50, 53, 57], [53, 57, 60], [55, 60, 64], [55, 59, 62]], // Dm F C G
    bass: [26, 29, 36, 31],
  },
};

const BELEGUNG = [
  ["Kick", "HaimKind"], ["Kick", "Jumpkick"], ["Snare", "clydesna"], ["Snare", "snarre-p"],
  ["HiHat", "closed 8"], ["HiHat", "707_hho"], ["Shots", "ED Close"], ["Shots", "ZaHnI_To"],
  ["Analog", "Kick The Bass 2"], ["Analog", "Unison_Bass_C3"], ["PCM", "HaMMeR"], ["PCM", "melo neu 2"],
  ["PCM", "SYNTHHS3"], ["PCM", "T-Mello"], ["Phrase", "Strings of Wisdo"], ["FX", "TeRR5Rt"],
];
const VOLUME = [127, 108, 104, 94, 84, 88, 80, 78, 114, 100, 98, 96, 92, 94, 68, 88];
const VOICE = [MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1,
               MONO2, MONO2, POLY2, POLY2, POLY2, MONO1, POLY2, POLY2];

const JAM_SETS = {
  A: [["PCM", "HaMMeR"], ["PCM", "melo neu 2"], ["PCM", "SYNTHHS3"], ["PCM", "T-Mello"]],
  B: [["PCM", "T-Mello"], ["PCM", "Tau-MeLo"], ["PCM", "HBsChE PaRa"], ["PCM", "Auf CrystaL"]],
  C: [["PCM", "Genetikk"], ["PCM", "Krieger"], ["PCM", "PsyChoTanZ"], ["PCM", "Wfg90"]],
  D: [["Loop", "killerme"], ["Shots", "Sound7-M"], ["Shots", "Remember"], ["Shots", "VEC2 Syn"]],
};

// ─── Dramaturgie: 50 Patterns ────────────────────────────────────────────────
// [Name, Intensität, Thema, Kick-Figur, Wiederholungen, Jam-Satz?]
const PLAN = [
  // Segment 1 → JAM A
  ["MORGEN 1",     0, "A", "vier", 2],
  ["MORGEN 2",     1, "A", "vier", 2],
  ["DECK 1",       2, "A", "pump", 2],
  ["DECK 2",       3, "A", "pump", 2],
  ["WELLE 1",      3, "A", "vier", 2],
  ["WELLE 2",      4, "A", "pump", 2],
  ["SONNE 1",      5, "A", "vier", 2],
  ["SONNE 2",      5, "A", "pump", 2],
  ["TREIBEN 1",    3, "A", "vier", 2],
  ["JAM A",        2, "A", "pump", 1, "A"],
  // Segment 2 → JAM B
  ["DECK 3",       2, "B", "pump", 2],
  ["DECK 4",       3, "B", "vier", 2],
  ["WELLE 3",      4, "B", "pump", 2],
  ["SONNE 3",      5, "B", "vier", 2],
  ["SONNE 4",      5, "B", "pump", 2],
  ["SONNE 5",      5, "B", "roll", 1],
  ["TREIBEN 2",    4, "B", "vier", 2],
  ["TREIBEN 3",    3, "B", "pump", 2],
  ["BRISE 1",     -1, "B", "kein", 2],
  ["JAM B",        2, "B", "pump", 1, "B"],
  // Segment 3 → JAM C
  ["DECK 5",       3, "A", "pump", 2],
  ["WELLE 4",      4, "A", "vier", 2],
  ["WELLE 5",      4, "A", "roll", 1],
  ["SONNE 6",      5, "A", "pump", 2],
  ["SONNE 7",      5, "A", "vier", 2],
  ["SONNE 8",      5, "B", "pump", 2],
  ["TREIBEN 4",    4, "A", "vier", 2],
  ["TREIBEN 5",    3, "A", "pump", 2],
  ["BRISE 2",     -1, "A", "kein", 2],
  ["JAM C",        2, "A", "pump", 1, "C"],
  // Segment 4 → JAM D
  ["DECK 6",       3, "B", "pump", 2],
  ["WELLE 6",      4, "B", "pump", 2],
  ["WELLE 7",      4, "B", "roll", 1],
  ["SONNE 9",      5, "B", "pump", 2],
  ["SONNE 10",     5, "B", "vier", 2],
  ["SONNE 11",     5, "A", "pump", 2],
  ["TREIBEN 6",    4, "B", "vier", 2],
  ["BRISE 3",     -1, "B", "kein", 2],
  ["JAM D",        2, "B", "pump", 1, "D"],
  ["DECK 7",       3, "A", "pump", 2],
  // Segment 5 → Abend
  ["WELLE 8",      4, "A", "vier", 2],
  ["SONNE 12",     5, "A", "pump", 2],
  ["SONNE 13",     5, "A", "vier", 2],
  ["SONNE 14",     5, "B", "pump", 2],
  ["ABEND 1",      4, "A", "vier", 2],
  ["ABEND 2",      3, "A", "pump", 2],
  ["ABEND 3",      2, "A", "vier", 2],
  ["ABEND 4",      1, "A", "vier", 2],
  ["HAFEN",        0, "A", "vier", 1],
  ["JAM FREI",     2, "A", "pump", 1, "A"],
];

// ─── Bausteine ───────────────────────────────────────────────────────────────

const takt = (s) => Math.floor(s / 16);
const imTakt = (s) => s % 16;
const leer = () => Array.from({ length: N }, () => ({ active: false }));
const hit = (notes, velocity, gate) => ({ active: true, notes, velocity, gate });

function baue(fn) {
  return Array.from({ length: N }, (_, s) => fn(s) ?? { active: false });
}

/** "pump" laesst die Kick gerade laufen — das Pumpen kommt aus der
 *  Offbeat-Snare (zweite Snare, Part 4) in partsFuer. */
const KICK = {
  kein: () => leer(),
  vier: () => baue((s) => (s % 4 === 0 ? hit([60], 110, 40) : null)),
  pump: () => baue((s) => (s % 4 === 0 ? hit([60], 110, 40) : null)),
  roll: () =>
    baue((s) => (s % 4 === 0 || (takt(s) === 3 && s % 2 === 0) ? hit([60], 110, 28) : null)),
};

function partsFuer(intensitaet, thema, kickFigur, jamMelos) {
  const t = THEMA[thema];
  const breakStelle = intensitaet < 0;
  const i = breakStelle ? 0 : intensitaet;

  // Nutzerwunsch 2026-08-15: ALLE Parts tragen ihre Figur in voller Dichte —
  // Intensitaet/Break steuern nur noch, wer UNGEMUTET startet (`wach`).
  const steps = Array.from({ length: 16 }, leer);
  const wach = new Array(16).fill(false);

  steps[0] = KICK[kickFigur === "kein" ? "vier" : kickFigur]();
  wach[0] = !breakStelle;
  steps[1] = baue((s) => (imTakt(s) === 8 ? hit([60], 94, 22) : null));
  wach[1] = i >= 5;
  steps[2] = baue((s) => {
    if (kickFigur === "roll" && takt(s) === 3) return hit([60], 98, 10);
    if (imTakt(s) === 4 || imTakt(s) === 12) return hit([60], 104, 28);
    return null;
  });
  wach[2] = i >= 3 || kickFigur === "roll";
  // Pump: die zweite Snare traegt die Offbeats — das Sonnendeck-Wippen.
  if (kickFigur === "pump") {
    steps[3] = baue((s) => (s % 4 === 2 ? hit([60], 88, 16) : null));
    wach[3] = i >= 2;
  } else {
    steps[3] = baue((s) => (imTakt(s) === 12 ? hit([60], 94, 22) : null));
    wach[3] = i >= 4;
  }
  steps[4] = baue((s) => (s % 4 === 2 ? hit([60], 80, 12) : null));
  wach[4] = i >= 1;
  steps[5] = baue((s) =>
    imTakt(s) === 14 || imTakt(s) === 6 ? hit([60], 86, 34) : null,
  );
  wach[5] = i >= 3;
  steps[6] = baue((s) => (s % 8 === 5 ? hit([60], 76, 13) : null));
  wach[6] = i >= 4;
  steps[7] = baue((s) => (s % 8 === 7 ? hit([60], 70, 11) : null));
  wach[7] = i >= 5;
  steps[8] = baue((s) => {
    if (s % 4 === 2) return hit([t.bass[takt(s)]], 106, 18);
    if (imTakt(s) === 15) return hit([t.bass[(takt(s) + 1) % 4]], 96, 9);
    return null;
  });
  wach[8] = i >= 2;
  // Zock-Reserve: Unison-Layer auf der Eins, startet gemutet.
  steps[9] = baue((s) => (imTakt(s) === 0 ? hit([t.bass[takt(s)]], 98, 40) : null));
  if (breakStelle) {
    steps[10] = baue((s) => (imTakt(s) === 0 ? hit([t.akkorde[takt(s)][0]], 84, 96) : null));
    wach[10] = true;
    steps[13] = baue((s) => (s % 4 === 0 ? hit([t.akkorde[takt(s)][(s / 4) % 3]], 74, 40) : null));
    wach[13] = true;
  } else {
    steps[10] = baue((s) => (imTakt(s) === 0 ? hit([t.akkorde[takt(s)][0]], 90, 96) : null));
    wach[10] = i >= 2;
    steps[13] = baue((s) => (imTakt(s) === 0 ? hit([t.akkorde[takt(s)][0]], 84, 96) : null));
    wach[13] = i >= 5;
  }
  steps[11] = baue((s) =>
    imTakt(s) === 8 && takt(s) % 2 === 1 ? hit([t.akkorde[takt(s)][0]], 86, 96) : null,
  );
  wach[11] = !breakStelle && i >= 3;
  steps[12] = baue((s) => (imTakt(s) === 10 ? hit([t.akkorde[takt(s)][0]], 82, 18) : null));
  wach[12] = !breakStelle && i >= 4;
  steps[14] = baue((s) =>
    imTakt(s) === 0 ? hit(t.akkorde[takt(s)], breakStelle ? 76 : 66, 96) : null,
  );
  wach[14] = i >= 4 || breakStelle;
  steps[15] = baue((s) => (s === 0 ? hit([60], 84, 96) : null));
  wach[15] = breakStelle;

  if (jamMelos) {
    // Duennes Starter-Muster (Nutzerwunsch): je ein Anschlag pro Loop,
    // versetzt — im Sequencer greifbar, ueber die Pads frei spielbar.
    steps[10] = baue((s) => (s === 0 ? hit([t.akkorde[0][0]], 88, 96) : null));
    steps[11] = baue((s) => (takt(s) === 1 && imTakt(s) === 8 ? hit([t.akkorde[1][0]], 86, 96) : null));
    steps[12] = baue((s) => (takt(s) === 2 && imTakt(s) === 0 ? hit([t.akkorde[2][0]], 84, 96) : null));
    steps[13] = baue((s) => (takt(s) === 3 && imTakt(s) === 0 ? hit([t.akkorde[3][0]], 84, 96) : null));
  }

  return steps.map((st, idx) => {
    const jamPart = jamMelos && idx >= 10 && idx <= 13;
    return {
      sampleId: bankNumberToE2PatternRef(jamPart ? jamMelos[idx - 10] : SAMPLES[idx]),
      steps: st,
      volume: jamPart ? 104 : VOLUME[idx],
      // Kicks (Parts 1+2) mit IFX "09 LOW EQ" voll aufgedreht — mehr Druck
      // (Nutzerwunsch 2026-08-15; Anzeige 09 = Speicher 8, 0-basiert wie
      // Mod- und Groove-Typ — am Geraet gegenpruefen).
      params:
        idx <= 1
          ? { voiceAssign: VOICE[idx], ifxOn: 1, ifxType: 8, ifxEdit: 127 }
          : { voiceAssign: VOICE[idx] },
      muted: jamPart ? false : !wach[idx],
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
console.log(`Bank: ${BANK.split(/[\/]/).pop()} — ${belegt.length} Samples · Set 7 SONNENDECK (${BPM} BPM)`);
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
  // MFX "12 GRAIN SHIFTER" (Anzeige 12 = Speicher 11, 0-basiert vermutet;
  // Offset 0x3d unverifiziert) — Nutzerwunsch 2026-08-15, am Geraet pruefen.
  mfxType: 11,
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
  const [name, , , , wdh] = PLAN[i];
  takte += wdh * 4;
  if (!p.chainTo)
    console.log(`  ${String(i + 1).padStart(2)} ${name.padEnd(12)} → Ende (Jam/Loop)`);
}
console.log(`  Kette gesamt: ${takte} Takte ≈ ${Math.round((takte * 4 * 60) / BPM / 60)} Minuten`);

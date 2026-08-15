/**
 * Erzeugt TEKK_SET4.e2sallpat — "PRESSWERK": hart und schnell (186 BPM),
 * gebaut fuer die Nutzer-Bank tekk.all. Richtung Crackpots: unerbittliche
 * Kick, pumpender Offbeat-Bass, Shouts/Stabs statt Melodieflaechen, Breaks
 * nur als kurzes Luftholen (1x).
 *
 * Nutzerwunsch (2026-08-15): die "keyboard"-Samples bleiben WEG — die
 * Melodie-Parts spielen Shots ([ViNTeKk, lemmy br), VEC2 Syn ist die Sirene,
 * Remember und killerme existieren nur in den Breaks.
 *
 * Konventionen: 64 Steps, Parts ohne Steps gemutet, Velocity je Part und
 * Pattern konstant, Wiederholungen max 2x (oft 1x).
 */
import * as fs from "node:fs";
import { buildE2AllPatFile } from "../src/core/e2sExport.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import {
  bankNumberToE2PatternRef,
  oscToDisplayNumber,
} from "../src/core/e2sPatternSampleLink.ts";

const BANK = process.argv[3] ?? "examples/e2s/tekk.all";
const ZIEL = process.argv[2] ?? "examples/e2s/TEKK_SET4.e2sallpat";
const N = 64;
const BPM = Number(process.argv[4]) || 186;

const MONO1 = 0, MONO2 = 1, POLY2 = 3;

/** Dunkel und eng: A-Moll mit Reibung zur bII (B), Thema B faellt nach E. */
const THEMA = {
  A: {
    akkorde: [[57, 60, 64], [58, 62, 65], [57, 60, 64], [55, 59, 62]], // Am Bb Am G
    bass: [33, 34, 33, 31],
  },
  B: {
    akkorde: [[57, 60, 64], [53, 57, 60], [52, 55, 59], [52, 55, 59]], // Am F Em Em
    bass: [33, 29, 28, 28],
  },
};

// tekk.all-Belegung OHNE keyboard: Stabs uebernehmen die Melo-Parts.
const BELEGUNG = [
  ["Kick", "HaimKind"], ["Kick", "Jumpkick"], ["Snare", "clydesna"], ["Snare", "snarre-p"],
  ["HiHat", "closed 8"], ["HiHat", "707_hho"], ["Shots", "ED Close"], ["Shots", "ZaHnI_To"],
  ["Analog", "Synth Le"], ["Analog", "Synth Le"], ["Shots", "[ViNTeKk"], ["Shots", "lemmy br"],
  ["Shots", "VEC2 Syn"], ["Shots", "Remember"], ["Loop", "killerme"], ["Shots", "Wuuuuup"],
];
const VOLUME = [127, 110, 106, 96, 84, 88, 80, 78, 120, 106, 98, 96, 92, 90, 64, 94];
const VOICE = [MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1,
               MONO2, MONO2, POLY2, POLY2, POLY2, MONO1, POLY2, POLY2];

// ─── Dramaturgie: 50 Patterns ────────────────────────────────────────────────
// [Name, Intensität, Thema, Kick-Figur, Wiederholungen in der Kette]
const PLAN = [
  ["WERK 1",       0, "A", "vier",   2],
  ["WERK 2",       1, "A", "vier",   2],
  ["WERK 3",       2, "A", "hart",   2],
  ["DAMPF 1",      3, "A", "vier",   2],
  ["DAMPF 2",      3, "A", "hart",   1],
  ["RAMME 1",      4, "A", "roll",   1],
  ["PRESSE 1",     5, "A", "hart",   2],
  ["PRESSE 2",     5, "A", "doppel", 2],
  ["PRESSE 3",     5, "A", "hart",   1],
  ["PRESSE 4",     5, "A", "doppel", 2],
  ["TAKT 1",       3, "A", "vier",   2],
  ["TAKT 2",       4, "A", "hart",   2],
  ["TAKT 3",       3, "B", "vier",   2],
  ["LUFT 1",      -1, "B", "kein",   1],
  ["ANZUG 1",      2, "B", "hart",   2],
  ["ANZUG 2",      3, "B", "doppel", 2],
  ["RAMME 2",      4, "B", "roll",   1],
  ["PRESSE 5",     5, "B", "hart",   2],
  ["PRESSE 6",     5, "B", "doppel", 2],
  ["PRESSE 7",     5, "B", "hart",   2],
  ["PRESSE 8",     5, "B", "doppel", 1],
  ["TAKT 4",       4, "B", "vier",   2],
  ["TAKT 5",       3, "B", "hart",   2],
  ["TAKT 6",       3, "A", "hart",   2],
  ["DAMPF 3",      4, "A", "doppel", 2],
  ["RAMME 3",      5, "A", "roll",   1],
  ["PRESSE 9",     5, "A", "doppel", 2],
  ["PRESSE 10",    5, "A", "hart",   2],
  ["PRESSE 11",    5, "B", "doppel", 2],
  ["LUFT 2",      -1, "A", "kein",   1],
  ["LUFT 3",      -1, "B", "kein",   1],
  ["ANZUG 3",      3, "B", "hart",   2],
  ["DAMPF 4",      4, "B", "doppel", 2],
  ["RAMME 4",      5, "B", "roll",   1],
  ["ENDDRUCK 1",   5, "B", "hart",   2],
  ["ENDDRUCK 2",   5, "B", "doppel", 2],
  ["ENDDRUCK 3",   5, "A", "hart",   2],
  ["ENDDRUCK 4",   5, "A", "doppel", 2],
  ["RAMME 5",      5, "A", "roll",   1],
  ["ENDDRUCK 5",   5, "A", "hart",   2],
  ["ENDDRUCK 6",   5, "A", "doppel", 2],
  ["ENDDRUCK 7",   5, "B", "hart",   2],
  ["ENDDRUCK 8",   5, "B", "doppel", 1],
  ["ABDAMPF 1",    4, "A", "hart",   2],
  ["ABDAMPF 2",    3, "A", "vier",   2],
  ["ABDAMPF 3",    2, "A", "vier",   2],
  ["ABDAMPF 4",    2, "A", "hart",   1],
  ["ABDAMPF 5",    1, "A", "vier",   2],
  ["KALT 1",       1, "A", "vier",   2],
  ["KALT 2",       0, "A", "vier",   2],
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
  // Hart: 16tel-Doppelschlag direkt vor jeder Takt-Eins.
  hart: () =>
    baue((s) =>
      s % 4 === 0 ? hit([60], 112, 40) : imTakt(s) === 15 ? hit([60], 108, 16) : null,
    ),
  // Doppel: Doubles vor der Drei UND vor der Eins — das Presswerk.
  doppel: () =>
    baue((s) =>
      s % 4 === 0
        ? hit([60], 112, 40)
        : imTakt(s) === 7 || imTakt(s) === 15
          ? hit([60], 108, 16)
          : null,
    ),
  // Rollend: durchgehende Achtel im letzten Takt (Snare-Build dazu, s.u.).
  roll: () =>
    baue((s) => (s % 4 === 0 || (takt(s) === 3 && s % 2 === 0) ? hit([60], 112, 30) : null)),
};

function partsFuer(intensitaet, thema, kickFigur) {
  const t = THEMA[thema];
  const breakStelle = intensitaet < 0;
  const i = breakStelle ? 0 : intensitaet;

  const steps = Array.from({ length: 16 }, leer);

  if (!breakStelle) steps[0] = KICK[kickFigur]();
  if (i >= 5) steps[1] = baue((s) => (imTakt(s) === 8 ? hit([60], 98, 24) : null));
  // Snare: Backbeat ab 3; bei "roll" 16tel-Build im letzten Takt.
  if (i >= 3 || kickFigur === "roll")
    steps[2] = baue((s) => {
      if (kickFigur === "roll" && takt(s) === 3) return hit([60], 102, 10);
      if (i >= 3 && (imTakt(s) === 4 || imTakt(s) === 12)) return hit([60], 108, 30);
      return null;
    });
  if (i >= 4) steps[3] = baue((s) => (imTakt(s) === 12 ? hit([60], 100, 24) : null));
  // Hats: Offbeats; im Drop 16tel im letzten Takt.
  if (i >= 1)
    steps[4] = baue((s) => {
      if (s % 4 === 2) return hit([60], 82, 12);
      if (i >= 5 && takt(s) === 3 && s % 2 === 1) return hit([60], 76, 8);
      return null;
    });
  if (i >= 3)
    steps[5] = baue((s) =>
      imTakt(s) === 14 || (i >= 4 && imTakt(s) === 6) ? hit([60], 88, 36) : null,
    );
  if (i >= 4) steps[6] = baue((s) => (s % 8 === 5 ? hit([60], 78, 14) : null));
  if (i >= 5) steps[7] = baue((s) => (s % 8 === 7 ? hit([60], 72, 12) : null));
  // Bass-Motor: Offbeats, Pickups ab 4, im Drop tiefer.
  if (i >= 2) {
    const tief = i >= 5 ? -12 : 0;
    steps[8] = baue((s) => {
      if (s % 4 === 2) return hit([t.bass[takt(s)] + tief], 110, 18);
      if (i >= 4 && imTakt(s) === 7) return hit([t.bass[takt(s)] + tief], 100, 10);
      if (i >= 4 && imTakt(s) === 15) return hit([t.bass[(takt(s) + 1) % 4] + tief], 100, 10);
      return null;
    });
  }
  if (i >= 4) steps[9] = baue((s) => (imTakt(s) === 0 ? hit([t.bass[takt(s)] - 12], 98, 56) : null));
  // Shouts/Stabs statt Melos.
  if (i >= 3) steps[10] = baue((s) => (imTakt(s) === 8 ? hit(t.akkorde[takt(s)], 94, 14) : null));
  if (i >= 4)
    steps[11] = baue((s) =>
      imTakt(s) === 12 && takt(s) % 2 === 1 ? hit(t.akkorde[takt(s)], 92, 12) : null,
    );
  // Sirene: nur auf der Drop-Eins jedes zweiten Takts.
  if (i >= 5)
    steps[12] = baue((s) =>
      imTakt(s) === 0 && takt(s) % 2 === 0 ? hit(t.akkorde[takt(s)], 88, 18) : null,
    );
  if (i >= 5) steps[15] = baue((s) => (s === 0 ? hit([60], 92, 36) : null));

  if (breakStelle) {
    // Kurzes Luftholen: Sirene, Remember-Bogen, killerme tief, Riser.
    steps[12] = baue((s) => (imTakt(s) === 0 ? hit(t.akkorde[takt(s)], 84, 96) : null));
    steps[13] = baue((s) => (s === 0 ? hit(t.akkorde[0], 78, 96) : null));
    steps[14] = baue((s) =>
      imTakt(s) === 0 ? hit(t.akkorde[takt(s)].map((n) => n - 12), 62, 96) : null,
    );
    steps[15] = baue((s) => (s === 0 ? hit([60], 88, 96) : null));
  }

  return steps.map((st, idx) => {
    const aktiv = st.filter((x) => x.active).length;
    return {
      sampleId: bankNumberToE2PatternRef(SAMPLES[idx]),
      steps: st,
      volume: VOLUME[idx],
      params: { voiceAssign: VOICE[idx] },
      muted: aktiv === 0, // Konvention: was nichts spielt, wird gemutet.
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

// Anzeige am Geraet = Nummernfeld (OSC_0index) + 1 (SLOTNUM2-Messung 2026-08-15).
const SAMPLES = [], NAMEN = [];
for (const [kat, wahl] of BELEGUNG) {
  const liste = nachKategorie.get(kat) ?? [];
  if (!liste.length) throw new Error(`Bank enthaelt keine Kategorie "${kat}"`);
  const s =
    typeof wahl === "string"
      ? liste.find((x) => x.name.trim().toLowerCase().startsWith(wahl.toLowerCase()))
      : liste[Math.min(wahl, liste.length - 1)];
  if (!s) throw new Error(`Kategorie "${kat}": kein Sample beginnt mit "${wahl}"`);
  SAMPLES.push(oscToDisplayNumber(s.sampleNumber));
  NAMEN.push(s.name.trim());
}
console.log(`Bank: ${BANK.split(/[\/]/).pop()} — ${belegt.length} Samples · Set 4 PRESSWERK (${BPM} BPM)`);
BELEGUNG.forEach(([kat], i) =>
  console.log(`  Part ${String(i + 1).padStart(2)}  ${kat.padEnd(7)} #${SAMPLES[i]} ${NAMEN[i]}`),
);

const patterns = PLAN.map(([name, intens, thema, kick, wdh], i) => ({
  name,
  bpm: BPM,
  stepLength: 64,
  parts: partsFuer(intens, thema, kick),
  alternate13_14: false,
  alternate15_16: false,
  chainTo: i + 1 < PLAN.length ? i + 2 : 0,
  chainRepeat: wdh,
}));

const out = Buffer.from(buildE2AllPatFile(patterns));
fs.writeFileSync(ZIEL, out);

console.log(`${ZIEL} — ${out.length} Bytes · ${patterns.length} Patterns · ${BPM} BPM`);
let takte = 0;
for (const [i, p] of patterns.entries()) {
  const aktiv = p.parts.filter((x) => !x.muted).length;
  const [name, intens, thema, kick, wdh] = PLAN[i];
  takte += wdh * 4;
  console.log(
    `  ${String(i + 1).padStart(2)} ${name.padEnd(11)} ${intens < 0 ? "Break" : "Int " + intens}` +
      ` · Thema ${thema} · Kick ${kick.padEnd(6)} · ${String(aktiv).padStart(2)} Parts` +
      ` · ${wdh}× → ${p.chainTo || "Ende"}`,
  );
}
console.log(`  Kette gesamt: ${takte} Takte ≈ ${Math.round((takte * 4 * 60) / BPM / 60)} Minuten`);

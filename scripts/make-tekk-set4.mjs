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

const BANK = process.argv[3] ?? "examples/e2s/tekk2.all";
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

// tekk2-Belegung OHNE keyboard: Stabs bleiben die rauen tekk-Shots (das ist
// der Charakter dieses Sets), aber der Bass ist seit Hoerrunde 7 echt —
// Synth Le war ein Lead und kratzte; Part 10 layert jetzt ein ANDERES
// Sample (kein Kammfilter mehr wie bei der Synth-Le-Doppelung).
const BELEGUNG = [
  ["Kick", "HaimKind"], ["Kick", "Jumpkick"], ["Snare", "clydesna"], ["Snare", "snarre-p"],
  ["HiHat", "closed 8"], ["HiHat", "707_hho"], ["Shots", "ED Close"], ["Shots", "ZaHnI_To"],
  ["Analog", "Unison_Bass_C3"], ["Analog", "Bassdrum-01fd"], ["Shots", "[ViNTeKk"], ["Shots", "lemmy br"],
  ["Shots", "VEC2 Syn"], ["Shots", "Remember"], ["Loop", "killerme"], ["Shots", "Wuuuuup"],
];
// Bass 120 -> 116: Headroom-Lektion aus Set 5 (Summe uebersteuerte mit Kick).
const VOLUME = [127, 110, 106, 96, 84, 88, 80, 78, 116, 104, 98, 96, 92, 90, 64, 94];
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

  // Nutzerwunsch 2026-08-15: ALLE Parts tragen ihre Figur in voller Dichte —
  // Intensitaet/Break steuern nur noch, wer UNGEMUTET startet (`wach`).
  const steps = Array.from({ length: 16 }, leer);
  const wach = new Array(16).fill(false);

  steps[0] = KICK[kickFigur === "kein" ? "vier" : kickFigur]();
  wach[0] = !breakStelle;
  steps[1] = baue((s) => (imTakt(s) === 8 ? hit([60], 98, 24) : null));
  wach[1] = i >= 5;
  steps[2] = baue((s) => {
    if (kickFigur === "roll" && takt(s) === 3) return hit([60], 102, 10);
    if (imTakt(s) === 4 || imTakt(s) === 12) return hit([60], 108, 30);
    return null;
  });
  wach[2] = i >= 3 || kickFigur === "roll";
  steps[3] = baue((s) => (imTakt(s) === 12 ? hit([60], 100, 24) : null));
  wach[3] = i >= 4;
  steps[4] = baue((s) => {
    if (s % 4 === 2) return hit([60], 82, 12);
    if (takt(s) === 3 && s % 2 === 1) return hit([60], 76, 8);
    return null;
  });
  wach[4] = i >= 1;
  steps[5] = baue((s) =>
    imTakt(s) === 14 || imTakt(s) === 6 ? hit([60], 88, 36) : null,
  );
  wach[5] = i >= 3;
  steps[6] = baue((s) => (s % 8 === 5 ? hit([60], 78, 14) : null));
  wach[6] = i >= 4;
  steps[7] = baue((s) => (s % 8 === 7 ? hit([60], 72, 12) : null));
  wach[7] = i >= 5;
  // Bass-Motor in voller Ausbaustufe (Drop-Fassung, tief).
  steps[8] = baue((s) => {
    if (s % 4 === 2) return hit([t.bass[takt(s)] - 12], 110, 18);
    if (imTakt(s) === 7) return hit([t.bass[takt(s)] - 12], 100, 10);
    if (imTakt(s) === 15) return hit([t.bass[(takt(s) + 1) % 4] - 12], 100, 10);
    return null;
  });
  wach[8] = i >= 2;
  steps[9] = baue((s) => (imTakt(s) === 0 ? hit([t.bass[takt(s)] - 12], 98, 56) : null));
  wach[9] = i >= 4;
  // Shouts/Stabs statt Melos.
  steps[10] = baue((s) => (imTakt(s) === 8 ? hit(t.akkorde[takt(s)], 94, 14) : null));
  wach[10] = i >= 3;
  steps[11] = baue((s) =>
    imTakt(s) === 12 && takt(s) % 2 === 1 ? hit(t.akkorde[takt(s)], 92, 12) : null,
  );
  wach[11] = i >= 4;
  steps[12] = baue((s) =>
    imTakt(s) === 0 && takt(s) % 2 === 0 ? hit(t.akkorde[takt(s)], breakStelle ? 84 : 88, breakStelle ? 96 : 18) : null,
  );
  wach[12] = i >= 5 || breakStelle;
  steps[13] = baue((s) => (s === 0 ? hit(t.akkorde[0], 78, 96) : null));
  wach[13] = breakStelle;
  steps[14] = baue((s) =>
    imTakt(s) === 0 ? hit(t.akkorde[takt(s)].map((n) => n - 12), 62, 96) : null,
  );
  wach[14] = breakStelle;
  steps[15] = baue((s) => (s === 0 ? hit([60], breakStelle ? 88 : 92, breakStelle ? 96 : 36) : null));
  wach[15] = i >= 5 || breakStelle;

  return steps.map((st, idx) => {
    return {
      sampleId: bankNumberToE2PatternRef(SAMPLES[idx]),
      steps: st,
      volume: VOLUME[idx],
      // Kicks (Parts 1+2) mit IFX "09 LOW EQ" voll aufgedreht — mehr Druck
      // (Nutzerwunsch 2026-08-15; Anzeige 09 = Speicher 8, 0-basiert wie
      // Mod- und Groove-Typ — am Geraet gegenpruefen).
      params:
        idx <= 1
          ? { voiceAssign: VOICE[idx], ifxOn: 1, ifxType: 8, ifxEdit: 127 }
          : { voiceAssign: VOICE[idx] },
      muted: !wach[idx],
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
  // MFX "12 GRAIN SHIFTER" (Anzeige 12 = Speicher 11, 0-basiert vermutet;
  // Offset 0x3d unverifiziert) — Nutzerwunsch 2026-08-15, am Geraet pruefen.
  mfxType: 11,
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

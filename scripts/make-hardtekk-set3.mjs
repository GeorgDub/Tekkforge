/**
 * Erzeugt HARDTEKK_SET3.e2sallpat — das dritte Set: hart und dunkel, 174 BPM
 * (knapp unter der 175er-Grenze, damit die Tekk-Vorschlaege noch knallen).
 * Gleiche finale Sample-Palette wie Set 1/2, aber:
 *
 *   - Harmonik phrygisch-dunkel: Thema A = Em–F–G–F (die Halbtonreibung
 *     E→F), Thema B = Em–C–D–H abwaerts. Tiefe, enge Voicings.
 *   - Kick dominiert: "vier", "tekk" (mit Vorschlag), neu "hart"
 *     (16tel-Doppelschlag vor jeder Takt-Eins) und "roll" — bei Roll-
 *     Patterns spielt die Snare im letzten Takt durchgehende 16tel (Build).
 *   - Bass als Motor: durchgehende Offbeats, ab Intensitaet 4 mit
 *     16tel-Pickups, im Drop (5) eine Oktave tiefer.
 *   - Melos nur als Stiche: kurze Stabs statt Flaechen. HBsChE PaRa liegt
 *     als Sirene NUR in den Breaks, das Pad fast nie (tief, nur Break).
 *   - FX-Stab auf jeder Drop-Eins; Breaks kurz und angespannt (Sirene,
 *     tiefes Pad, Sub-Drone, Riser) statt breit und offen.
 *   - Dramaturgie: WARNUNG → ABRISS → KELLER (stripped) → PRESSLUFT
 *     (Builds) → DRUCKLOS (kurze Breaks) → FINALE. Wiederholungen max 2x,
 *     oft nur 1x — rastlos.
 *
 * Konventionen wie immer: 64 Steps, Parts ohne Steps gemutet, Velocity je
 * Part und Pattern konstant.
 */
import * as fs from "node:fs";
import { buildE2AllPatFile } from "../src/core/e2sExport.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import {
  bankNumberToE2PatternRef,
  oscToDisplayNumber,
} from "../src/core/e2sPatternSampleLink.ts";

const BANK = process.argv[3] ?? "examples/e2s/HARDTEKK.all";
const ZIEL = process.argv[2] ?? "examples/e2s/HARDTEKK_SET3.e2sallpat";
const N = 64;
const BPM = Number(process.argv[4]) || 174;

const MONO1 = 0, MONO2 = 1, POLY2 = 3;

/** Tief und eng gefuehrt — dunkler als Set 2. H = H-Dur als Dominante. */
const THEMA = {
  A: {
    akkorde: [[52, 55, 59], [53, 57, 60], [55, 59, 62], [53, 57, 60]], // Em F G F
    bass: [28, 29, 31, 29],
  },
  B: {
    akkorde: [[52, 55, 59], [48, 52, 55], [50, 54, 57], [47, 51, 54]], // Em C D H
    bass: [28, 24, 26, 23],
  },
};

// Finale Belegung (am Geraet durchgehoert, 2026-08-15) — per Name gepinnt.
const BELEGUNG_HARDTEKK = [
  ["Kick", "spetzial-kick10"], ["Kick", "Jumpkick 20"], ["Snare", "Snare 001"], ["Clap", 0],
  ["HiHat", 0], ["HiHat", 5], ["Perc.", 0], ["Perc.", 3],
  ["Analog", "Bassdrum-01fd"], ["Analog", "Unison_Bass_C3"], ["PCM", "T-Mello"], ["PCM", "Tau-MeLo"],
  ["PCM", "HBsChE PaRa"], ["PCM", "Auf CrystaL"], ["Phrase", "Padseq~1"], ["FX", 0],
];

// Belegung fuer die Nutzer-Bank tekk.all — Details siehe make-hardtekk-set.mjs.
const BELEGUNG_TEKK = [
  ["Kick", "HaimKind"], ["Kick", "Jumpkick"], ["Snare", "clydesna"], ["Snare", "snarre-p"],
  ["HiHat", "closed 8"], ["HiHat", "707_hho"], ["Shots", "ED Close"], ["Shots", "ZaHnI_To"],
  ["Analog", "Synth Le"], ["Analog", "Synth Le"], ["Shots", "keyboard"], ["Shots", 11],
  ["Shots", "VEC2 Syn"], ["Shots", "Remember"], ["Loop", "killerme"], ["Shots", "Wuuuuup"],
];

const BELEGUNG = /tekk\.all$/i.test(BANK) ? BELEGUNG_TEKK : BELEGUNG_HARDTEKK;
const VOLUME = [127, 110, 106, 94, 84, 88, 80, 78, 120, 106, 96, 94, 90, 92, 66, 92];
const VOICE = [MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1,
               MONO2, MONO2, POLY2, POLY2, POLY2, MONO1, POLY2, POLY2];

// ─── Dramaturgie: 50 Patterns ────────────────────────────────────────────────
// [Name, Intensität, Thema, Kick-Figur, Wiederholungen in der Kette]
// Wiederholungen max 2×, oft 1× — das Set soll treiben, nicht stehen.
const PLAN = [
  ["WARNUNG 1",    0, "A", "vier", 2],
  ["WARNUNG 2",    1, "A", "vier", 2],
  ["WARNUNG 3",    2, "A", "tekk", 2],
  ["DRUCK 1",      2, "A", "vier", 2],
  ["DRUCK 2",      3, "A", "tekk", 2],
  ["DRUCK 3",      3, "A", "hart", 1],
  ["PRESSLUFT 1",  4, "A", "roll", 1],
  ["ABRISS 1",     5, "A", "tekk", 2],
  ["ABRISS 2",     5, "A", "hart", 2],
  ["ABRISS 3",     5, "A", "tekk", 1],
  ["ABRISS 4",     5, "A", "hart", 2],
  ["KELLER 1",     3, "A", "vier", 2],
  ["KELLER 2",     3, "A", "tekk", 2],
  ["KELLER 3",     4, "A", "tekk", 2],
  ["KELLER 4",     3, "B", "vier", 2],
  ["DRUCKLOS 1",  -1, "B", "kein", 1],
  ["DRUCKLOS 2",  -1, "B", "kein", 1],
  ["ANSATZ 1",     2, "B", "tekk", 2],
  ["ANSATZ 2",     3, "B", "hart", 2],
  ["PRESSLUFT 2",  4, "B", "roll", 1],
  ["ABRISS 5",     5, "B", "tekk", 2],
  ["ABRISS 6",     5, "B", "hart", 2],
  ["ABRISS 7",     5, "B", "tekk", 2],
  ["ABRISS 8",     5, "B", "hart", 1],
  ["KELLER 5",     4, "B", "vier", 2],
  ["KELLER 6",     3, "B", "tekk", 2],
  ["KELLER 7",     3, "A", "tekk", 2],
  ["DRUCK 4",      4, "A", "hart", 2],
  ["PRESSLUFT 3",  5, "A", "roll", 1],
  ["ABRISS 9",     5, "A", "hart", 2],
  ["ABRISS 10",    5, "A", "tekk", 2],
  ["ABRISS 11",    5, "B", "hart", 2],
  ["KELLER 8",     3, "A", "vier", 2],
  ["KELLER 9",     2, "A", "tekk", 2],
  ["DRUCKLOS 3",  -1, "A", "kein", 1],
  ["DRUCKLOS 4",  -1, "B", "kein", 1],
  ["ANSATZ 3",     3, "B", "tekk", 2],
  ["DRUCK 5",      4, "B", "hart", 2],
  ["PRESSLUFT 4",  5, "B", "roll", 1],
  ["FINALE 1",     5, "B", "tekk", 2],
  ["FINALE 2",     5, "B", "hart", 2],
  ["FINALE 3",     5, "A", "tekk", 2],
  ["FINALE 4",     5, "A", "hart", 2],
  ["PRESSLUFT 5",  5, "A", "roll", 1],
  ["FINALE 5",     5, "A", "hart", 2],
  ["FINALE 6",     5, "A", "tekk", 2],
  ["ABWURF 1",     4, "A", "tekk", 2],
  ["ABWURF 2",     3, "A", "vier", 2],
  ["ABWURF 3",     2, "A", "vier", 2],
  ["NACHHALL",     0, "A", "vier", 2],
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
  tekk: () =>
    baue((s) =>
      s % 4 === 0
        ? hit([60], 112, 40)
        : BPM < 175 && imTakt(s) === 7
          ? hit([60], 112, 22)
          : null,
    ),
  // Hart: 16tel-Doppelschlag direkt vor jeder Takt-Eins.
  hart: () =>
    baue((s) =>
      s % 4 === 0 ? hit([60], 112, 40) : imTakt(s) === 15 ? hit([60], 108, 16) : null,
    ),
  // Rollend: durchgehende Achtel im letzten Takt (dazu Snare-Build, s.u.).
  roll: () =>
    baue((s) => (s % 4 === 0 || (takt(s) === 3 && s % 2 === 0) ? hit([60], 112, 30) : null)),
};

function partsFuer(intensitaet, thema, kickFigur) {
  const t = THEMA[thema];
  const breakStelle = intensitaet < 0;
  const i = breakStelle ? 0 : intensitaet;

  const steps = Array.from({ length: 16 }, leer);

  if (!breakStelle) steps[0] = KICK[kickFigur]();
  if (i >= 5) steps[1] = baue((s) => (imTakt(s) === 8 ? hit([60], 96, 24) : null));
  // Snare: Backbeat ab 3 — und bei "roll" im letzten Takt durchgehende 16tel.
  if (i >= 3 || kickFigur === "roll")
    steps[2] = baue((s) => {
      if (kickFigur === "roll" && takt(s) === 3) return hit([60], 100, 10);
      if (i >= 3 && (imTakt(s) === 4 || imTakt(s) === 12)) return hit([60], 108, 30);
      return null;
    });
  if (i >= 4) steps[3] = baue((s) => (imTakt(s) === 12 ? hit([60], 100, 26) : null));
  // HiHat: Offbeat-Achtel; im Drop 16tel im letzten Takt als Druck zur Eins.
  if (i >= 1)
    steps[4] = baue((s) => {
      if (s % 4 === 2) return hit([60], 82, 14);
      if (i >= 5 && takt(s) === 3 && s % 2 === 1) return hit([60], 76, 10);
      return null;
    });
  if (i >= 3)
    steps[5] = baue((s) =>
      imTakt(s) === 14 || (i >= 4 && imTakt(s) === 6) ? hit([60], 88, 40) : null,
    );
  if (i >= 4) steps[6] = baue((s) => (s % 8 === 5 ? hit([60], 78, 16) : null));
  if (i >= 5) steps[7] = baue((s) => (s % 8 === 7 ? hit([60], 72, 12) : null));
  // Bass-Motor: Offbeats immer, Pickups ab 4, im Drop eine Oktave tiefer.
  if (i >= 2) {
    const tief = i >= 5 ? -12 : 0;
    steps[8] = baue((s) => {
      if (s % 4 === 2) return hit([t.bass[takt(s)] + tief], 110, 20);
      if (i >= 4 && imTakt(s) === 7) return hit([t.bass[takt(s)] + tief], 100, 10);
      if (i >= 4 && imTakt(s) === 15) return hit([t.bass[(takt(s) + 1) % 4] + tief], 100, 10);
      return null;
    });
  }
  if (i >= 4) steps[9] = baue((s) => (imTakt(s) === 0 ? hit([t.bass[takt(s)] - 12], 98, 60) : null));
  // Melos nur als Stiche.
  if (i >= 3) steps[10] = baue((s) => (imTakt(s) === 8 ? hit(t.akkorde[takt(s)], 92, 14) : null));
  if (i >= 4) steps[11] = baue((s) => (imTakt(s) === 12 ? hit(t.akkorde[takt(s)], 90, 12) : null));
  if (i >= 5)
    steps[13] = baue((s) =>
      imTakt(s) === 0 && takt(s) % 2 === 0 ? hit(t.akkorde[takt(s)], 88, 20) : null,
    );
  // FX-Stab auf jeder Drop-Eins.
  if (i >= 5) steps[15] = baue((s) => (s === 0 ? hit([60], 90, 40) : null));

  if (breakStelle) {
    // Kurz und angespannt: Sirene, tiefes Pad, Sub-Drone, Riser.
    steps[9] = baue((s) => (imTakt(s) === 0 ? hit([t.bass[takt(s)] - 12], 92, 96) : null));
    steps[12] = baue((s) => (imTakt(s) === 0 ? hit(t.akkorde[takt(s)], 84, 96) : null));
    steps[14] = baue((s) =>
      imTakt(s) === 0 ? hit(t.akkorde[takt(s)].map((n) => n - 12), 66, 96) : null,
    );
    steps[15] = baue((s) => (s === 0 ? hit([60], 86, 96) : null));
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
console.log(`Bank: ${BANK.split(/[\/]/).pop()} — ${belegt.length} Samples · Set 3 (hart, ${BPM} BPM)`);
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
    `  ${String(i + 1).padStart(2)} ${name.padEnd(12)} ${intens < 0 ? "Break" : "Int " + intens}` +
      ` · Thema ${thema} · Kick ${kick.padEnd(5)} · ${String(aktiv).padStart(2)} Parts` +
      ` · ${wdh}× → ${p.chainTo || "Ende"}`,
  );
}
console.log(`  Kette gesamt: ${takte} Takte ≈ ${Math.round((takte * 4 * 60) / BPM / 60)} Minuten`);

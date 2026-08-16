/**
 * Erzeugt TEKK_SET8.e2sallpat — "WECHSELSPIEL": 170 BPM, fuer tekk3.all.
 *
 * Kernidee (Nutzerwunsch 2026-08-16, "abwechslungsreich — nicht die ganze
 * Zeit eine Melo laufen lassen"): VIER Melo-Themen rotieren durch die
 * Segmente, und jedes Thema bringt nicht nur andere Samples (Parts 11–14 +
 * Pad), sondern auch eine andere SPIELFIGUR mit:
 *
 *   T1  Sieger-Paket    — Frage/Antwort mit vollen Gates
 *   T2  Frisch I        — Arpeggio-Lauf (Chord-Toene versetzt)
 *   T3  Frisch II       — Stabs und Off-Akzente
 *   T4  Dunkel          — Traeger auf der Eins + Antwort-Akzent
 *
 * Struktur wie die Jam-Sets: fuenf gekettete Segmente (je ein Thema), jedes
 * muendet in einen loopenden Jam mit dem Themen-Satz. Alle Lektionen der
 * Hoerrunden sind drin: Mute-Zock-Fuellung (alle Parts tragen Figuren, die
 * Intensitaet steuert nur Mutes), Kick-IFX 09 LOW EQ, MFX 12 GRAIN SHIFTER,
 * echter Bass, einstimmige Melos nahe Unity, Headroom.
 */
import * as fs from "node:fs";
import { buildE2AllPatFile } from "../src/core/e2sExport.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import {
  bankNumberToE2PatternRef,
  oscToDisplayNumber,
} from "../src/core/e2sPatternSampleLink.ts";

const BANK = process.argv[3] ?? "examples/e2s/tekk3.all";
const ZIEL = process.argv[2] ?? "examples/e2s/TEKK_SET8.e2sallpat";
const N = 64;
const BPM = Number(process.argv[4]) || 170;

const MONO1 = 0, MONO2 = 1, POLY2 = 3;

/** A rollt in Am, B hebt nach C — beides eng gefuehrt nahe Unity. */
const THEMA = {
  A: {
    akkorde: [[57, 60, 64], [55, 59, 62], [53, 57, 60], [55, 59, 62]], // Am G F G
    bass: [33, 31, 29, 31],
  },
  B: {
    akkorde: [[60, 64, 67], [55, 59, 62], [57, 60, 64], [53, 57, 60]], // C G Am F
    bass: [36, 31, 33, 29],
  },
};

const BELEGUNG = [
  ["Kick", "HaimKind"], ["Kick", "Jumpkick"], ["Snare", "clydesna"], ["Snare", "snarre-p"],
  ["HiHat", "closed 8"], ["HiHat", "707_hho"], ["Shots", "ED Close"], ["Shots", "ZaHnI_To"],
  ["Analog", "Unison_Bass_C3"], ["Analog", "Bassdrum-01fd"], ["PCM", "T-Mello"], ["PCM", "Tau-MeLo"],
  ["PCM", "HBsChE PaRa"], ["PCM", "Auf CrystaL"], ["Phrase", "Padseq~1"], ["FX", "TeRR5Rt"],
];
const VOLUME = [127, 108, 105, 94, 84, 88, 80, 78, 116, 100, 98, 96, 94, 94, 66, 90];
const VOICE = [MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1,
               MONO2, MONO2, POLY2, POLY2, POLY2, MONO1, POLY2, POLY2];

/**
 * Die vier Melo-Themen: je vier Melos (Parts 11–14), eine Flaeche (Part 15)
 * und ein Figuren-Stil. Aufgeloest wird per Name gegen tekk3.all.
 */
const THEMEN = {
  T1: {
    stil: "frage",
    melos: [["PCM", "T-Mello"], ["PCM", "Tau-MeLo"], ["PCM", "HBsChE PaRa"], ["PCM", "Auf CrystaL"]],
    pad: ["Phrase", "Padseq~1"],
  },
  T2: {
    stil: "arp",
    melos: [["PCM", "Holia-MeLo"], ["PCM", "LuZZiFeR_MeLo"], ["PCM", "melo6dk"], ["PCM", "HyPer__MeLo"]],
    pad: ["Phrase", "120CHOIRC23sD"],
  },
  T3: {
    stil: "stab",
    melos: [["PCM", "Ha He MeLo"], ["PCM", "Bse MeLo"], ["PCM", "KoRgeR KlAnG"], ["PCM", "Schrauber MeloNe"]],
    pad: ["Phrase", "120CHOIRCAD"],
  },
  T4: {
    stil: "traeger",
    melos: [["PCM", "Krieger"], ["PCM", "PsyChoTanZ"], ["PCM", "Genetikk"], ["PCM", "RoBBaFFerT_MeLo"]],
    pad: ["Phrase", "PAD_ResoChor"],
  },
};

// ─── Dramaturgie: 50 Patterns ────────────────────────────────────────────────
// [Name, Intensität, Thema, Kick-Figur, Wiederholungen, Melo-Thema, Jam?]
const PLAN = [
  // Segment 1 — Thema T1 (Sieger)
  ["AUFTAKT 1",   0, "A", "vier", 2, "T1"],
  ["AUFTAKT 2",   1, "A", "vier", 2, "T1"],
  ["SPIEL 1",     2, "A", "vier", 2, "T1"],
  ["SPIEL 2",     3, "A", "hart", 2, "T1"],
  ["ANLAUF 1",    4, "A", "roll", 1, "T1"],
  ["WECHSEL 1",   5, "A", "hart", 2, "T1"],
  ["WECHSEL 2",   5, "A", "vier", 2, "T1"],
  ["WECHSEL 3",   5, "A", "hart", 2, "T1"],
  ["RUHE 1",      3, "A", "vier", 2, "T1"],
  ["JAM T1",      2, "A", "vier", 1, "T1", true],
  // Segment 2 — Thema T2 (Frisch I, Arp)
  ["SPIEL 3",     2, "B", "vier", 2, "T2"],
  ["SPIEL 4",     3, "B", "hart", 2, "T2"],
  ["ANLAUF 2",    4, "B", "roll", 1, "T2"],
  ["WECHSEL 4",   5, "B", "hart", 2, "T2"],
  ["WECHSEL 5",   5, "B", "vier", 2, "T2"],
  ["WECHSEL 6",   5, "B", "hart", 2, "T2"],
  ["RUHE 2",      4, "B", "vier", 2, "T2"],
  ["RUHE 3",      3, "B", "hart", 2, "T2"],
  ["LUFT 1",     -1, "B", "kein", 2, "T2"],
  ["JAM T2",      2, "B", "vier", 1, "T2", true],
  // Segment 3 — Thema T3 (Frisch II, Stabs)
  ["SPIEL 5",     3, "A", "hart", 2, "T3"],
  ["SPIEL 6",     4, "A", "vier", 2, "T3"],
  ["ANLAUF 3",    5, "A", "roll", 1, "T3"],
  ["WECHSEL 7",   5, "A", "hart", 2, "T3"],
  ["WECHSEL 8",   5, "A", "vier", 2, "T3"],
  ["WECHSEL 9",   5, "B", "hart", 2, "T3"],
  ["RUHE 4",      4, "A", "vier", 2, "T3"],
  ["RUHE 5",      3, "A", "hart", 2, "T3"],
  ["LUFT 2",     -1, "A", "kein", 2, "T3"],
  ["JAM T3",      2, "A", "vier", 1, "T3", true],
  // Segment 4 — Thema T4 (Dunkel)
  ["SPIEL 7",     3, "B", "hart", 2, "T4"],
  ["ANLAUF 4",    4, "B", "roll", 1, "T4"],
  ["WECHSEL 10",  5, "B", "hart", 2, "T4"],
  ["WECHSEL 11",  5, "B", "vier", 2, "T4"],
  ["WECHSEL 12",  5, "A", "hart", 2, "T4"],
  ["WECHSEL 13",  5, "A", "vier", 2, "T4"],
  ["RUHE 6",      4, "B", "vier", 2, "T4"],
  ["LUFT 3",     -1, "B", "kein", 2, "T4"],
  ["JAM T4",      2, "B", "vier", 1, "T4", true],
  ["SPIEL 8",     3, "A", "hart", 1, "T1"],
  // Segment 5 — Finale: Themen im Schnellwechsel
  ["ANLAUF 5",    4, "A", "roll", 1, "T1"],
  ["FINALE T1",   5, "A", "hart", 2, "T1"],
  ["FINALE T2",   5, "B", "vier", 2, "T2"],
  ["FINALE T3",   5, "A", "hart", 2, "T3"],
  ["FINALE T4",   5, "B", "vier", 2, "T4"],
  ["ABSPANN 1",   3, "A", "vier", 2, "T1"],
  ["ABSPANN 2",   2, "A", "vier", 2, "T2"],
  ["ABSPANN 3",   1, "A", "vier", 2, "T1"],
  ["STILLE",      0, "A", "vier", 1, "T1"],
  ["JAM FREI",    2, "A", "vier", 1, "T2", true],
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
  roll: () =>
    baue((s) => (s % 4 === 0 || (takt(s) === 3 && s % 2 === 0) ? hit([60], 112, 28) : null)),
};

/** Melo-Figuren je Themen-Stil — Parts 11 und 12 spielen die Hauptrollen. */
const STIL_FIGUREN = {
  frage: (t) => [
    baue((s) => (imTakt(s) === 0 && takt(s) % 2 === 0 ? hit([t.akkorde[takt(s)][0]], 90, 96) : null)),
    baue((s) => (imTakt(s) === 0 && takt(s) % 2 === 1 ? hit([t.akkorde[takt(s)][0]], 88, 96) : null)),
    baue((s) => (imTakt(s) === 10 ? hit([t.akkorde[takt(s)][0]], 82, 18) : null)),
    baue((s) => (takt(s) === 3 && imTakt(s) === 8 ? hit([t.akkorde[3][0]], 84, 40) : null)),
  ],
  arp: (t) => [
    baue((s) => (s % 4 === 0 ? hit([t.akkorde[takt(s)][(s / 4) % 3]], 88, 24) : null)),
    baue((s) => (s % 8 === 6 ? hit([t.akkorde[takt(s)][2]], 82, 16) : null)),
    baue((s) => (imTakt(s) === 0 ? hit([t.akkorde[takt(s)][0]], 84, 96) : null)),
    baue((s) => (imTakt(s) === 12 && takt(s) % 2 === 1 ? hit([t.akkorde[takt(s)][1]], 80, 20) : null)),
  ],
  stab: (t) => [
    baue((s) => (imTakt(s) === 4 || imTakt(s) === 12 ? hit([t.akkorde[takt(s)][0]], 90, 14) : null)),
    baue((s) => (imTakt(s) === 6 && takt(s) % 2 === 0 ? hit([t.akkorde[takt(s)][1]], 86, 12) : null)),
    baue((s) => (imTakt(s) === 0 ? hit([t.akkorde[takt(s)][0]], 84, 40) : null)),
    baue((s) => (imTakt(s) === 14 && takt(s) === 3 ? hit([t.akkorde[3][0]], 84, 20) : null)),
  ],
  traeger: (t) => [
    baue((s) => (imTakt(s) === 0 ? hit([t.akkorde[takt(s)][0]], 90, 96) : null)),
    baue((s) => (imTakt(s) === 8 && takt(s) % 2 === 1 ? hit([t.akkorde[takt(s)][0]], 86, 30) : null)),
    baue((s) => (imTakt(s) === 0 && takt(s) === 0 ? hit([t.akkorde[0][0]], 82, 16) : null)),
    baue((s) => (imTakt(s) === 12 ? hit([t.akkorde[takt(s)][0]], 80, 18) : null)),
  ],
};

function partsFuer(intensitaet, thema, kickFigur, themenKey, jam) {
  const t = THEMA[thema];
  const theme = THEMEN_AUFGELOEST[themenKey];
  const breakStelle = intensitaet < 0;
  const i = breakStelle ? 0 : intensitaet;

  // Mute-Zock-Fuellung: alle Parts tragen Figuren, `wach` steuert die Mutes.
  const steps = Array.from({ length: 16 }, leer);
  const wach = new Array(16).fill(false);

  steps[0] = KICK[kickFigur === "kein" ? "vier" : kickFigur]();
  wach[0] = !breakStelle;
  steps[1] = baue((s) => (imTakt(s) === 8 ? hit([60], 96, 22) : null));
  wach[1] = i >= 5;
  steps[2] = baue((s) => {
    if (kickFigur === "roll" && takt(s) === 3) return hit([60], 100, 10);
    if (imTakt(s) === 4 || imTakt(s) === 12) return hit([60], 106, 28);
    return null;
  });
  wach[2] = i >= 3 || kickFigur === "roll";
  steps[3] = baue((s) => (imTakt(s) === 12 ? hit([60], 96, 22) : null));
  wach[3] = i >= 4;
  steps[4] = baue((s) => (s % 4 === 2 ? hit([60], 82, 12) : null));
  wach[4] = i >= 1;
  steps[5] = baue((s) =>
    imTakt(s) === 14 || imTakt(s) === 6 ? hit([60], 86, 34) : null,
  );
  wach[5] = i >= 3;
  steps[6] = baue((s) => (s % 8 === 5 ? hit([60], 78, 13) : null));
  wach[6] = i >= 4;
  steps[7] = baue((s) => (s % 8 === 7 ? hit([60], 72, 11) : null));
  wach[7] = i >= 5;
  steps[8] = baue((s) => {
    if (s % 4 === 2) return hit([t.bass[takt(s)]], 108, 17);
    if (imTakt(s) === 15) return hit([t.bass[(takt(s) + 1) % 4]], 98, 9);
    return null;
  });
  wach[8] = i >= 2;
  steps[9] = baue((s) => (imTakt(s) === 0 ? hit([t.bass[takt(s)]], 98, 40) : null));

  // Melo-Figuren nach Themen-Stil; im Jam ein duennes Starter-Muster.
  const figuren = STIL_FIGUREN[theme.stil](t);
  if (jam) {
    steps[10] = baue((s) => (s === 0 ? hit([t.akkorde[0][0]], 88, 96) : null));
    steps[11] = baue((s) => (takt(s) === 1 && imTakt(s) === 8 ? hit([t.akkorde[1][0]], 86, 96) : null));
    steps[12] = baue((s) => (takt(s) === 2 && imTakt(s) === 0 ? hit([t.akkorde[2][0]], 84, 96) : null));
    steps[13] = baue((s) => (takt(s) === 3 && imTakt(s) === 0 ? hit([t.akkorde[3][0]], 84, 96) : null));
  } else {
    steps[10] = figuren[0];
    wach[10] = i >= 2;
    steps[11] = figuren[1];
    wach[11] = i >= 3;
    steps[12] = figuren[2];
    wach[12] = i >= 4;
    steps[13] = figuren[3];
    wach[13] = i >= 5;
  }
  steps[14] = baue((s) =>
    imTakt(s) === 0 ? hit(t.akkorde[takt(s)], breakStelle ? 76 : 66, 96) : null,
  );
  wach[14] = i >= 4 || breakStelle;
  steps[15] = baue((s) => (s === 0 ? hit([60], 86, 96) : null));
  wach[15] = breakStelle;

  return steps.map((st, idx) => {
    const themenPart = idx >= 10 && idx <= 13;
    const sampleNr = themenPart
      ? theme.meloNr[idx - 10]
      : idx === 14
        ? theme.padNr
        : SAMPLES[idx];
    return {
      sampleId: bankNumberToE2PatternRef(sampleNr),
      steps: st,
      volume: jam && themenPart ? 104 : VOLUME[idx],
      // Kicks (Parts 1+2) mit IFX "09 LOW EQ" voll aufgedreht — mehr Druck.
      params:
        idx <= 1
          ? { voiceAssign: VOICE[idx], ifxOn: 1, ifxType: 8, ifxEdit: 127 }
          : { voiceAssign: VOICE[idx] },
      muted: jam && themenPart ? false : !wach[idx],
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
console.log(`Bank: ${BANK.split(/[\/]/).pop()} — ${belegt.length} Samples · Set 8 WECHSELSPIEL (${BPM} BPM)`);

const THEMEN_AUFGELOEST = {};
for (const [key, th] of Object.entries(THEMEN)) {
  const melos = th.melos.map(([kat, wahl]) => findeAnzeige(kat, wahl));
  const pad = findeAnzeige(th.pad[0], th.pad[1]);
  THEMEN_AUFGELOEST[key] = { stil: th.stil, meloNr: melos.map((m) => m.nr), padNr: pad.nr };
  console.log(
    `  ${key} (${th.stil.padEnd(7)}): ${melos.map((m) => `#${m.nr} ${m.name}`).join(" · ")} · Pad #${pad.nr} ${pad.name}`,
  );
}

const patterns = PLAN.map(([name, intens, thema, kick, wdh, themenKey, jam], i) => ({
  name,
  bpm: BPM,
  // MFX "12 GRAIN SHIFTER" — Offset 0x3d, am Geraet bestaetigt (2026-08-16).
  mfxType: 11,
  stepLength: 64,
  parts: partsFuer(intens, thema, kick, themenKey, jam),
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
  if (!p.chainTo) console.log(`  ${String(i + 1).padStart(2)} ${name.padEnd(11)} → Ende (Jam/Loop)`);
}
console.log(`  Kette gesamt: ${takte} Takte ≈ ${Math.round((takte * 4 * 60) / BPM / 60)} Minuten`);

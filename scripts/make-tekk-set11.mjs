/**
 * Erzeugt TEKK_SET11.e2sallpat — "KURZSCHLUSS": 50 Patterns, 166 BPM, fuer
 * tekk4.all. Das kompakte Gegenstueck zu den Langformaten: fuenf Segmente,
 * fuenf Themen (inkl. Vocal-Farbe), gleiche Engine wie Set 9/10.
 */
import * as fs from "node:fs";
import { buildE2AllPatFile } from "../src/core/e2sExport.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import {
  bankNumberToE2PatternRef,
  oscToDisplayNumber,
} from "../src/core/e2sPatternSampleLink.ts";

const BANK = process.argv[3] ?? "examples/e2s/tekk4.all";
const ZIEL = process.argv[2] ?? "examples/e2s/TEKK_SET11.e2sallpat";
const N = 64;
const BPM = Number(process.argv[4]) || 166;

const MONO1 = 0, MONO2 = 1, POLY2 = 3;

const THEMA = {
  A: {
    akkorde: [[57, 60, 64], [55, 59, 62], [53, 57, 60], [55, 59, 62]], // Am G F G
    bass: [33, 31, 29, 31],
  },
  B: {
    akkorde: [[50, 53, 57], [53, 57, 60], [55, 59, 62], [52, 56, 59]], // Dm F G E
    bass: [26, 29, 31, 28],
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

/** Sechs Themen — die neuen tekk4-Farben (Acid, Vocal) sind T5/T6. */
const THEMEN = {
  T1: { stil: "frage", melos: [["PCM", "T-Mello"], ["PCM", "Tau-MeLo"], ["PCM", "HBsChE PaRa"], ["PCM", "Auf CrystaL"]], pad: ["Phrase", "Padseq~1"] },
  T2: { stil: "arp", melos: [["PCM", "Holia-MeLo"], ["PCM", "LuZZiFeR_MeLo"], ["PCM", "melo6dk"], ["PCM", "HyPer__MeLo"]], pad: ["Phrase", "120CHOIRC23sD"] },
  T3: { stil: "stab", melos: [["PCM", "Ha He MeLo"], ["PCM", "Bse MeLo"], ["PCM", "KoRgeR KlAnG"], ["PCM", "Schrauber MeloNe"]], pad: ["Phrase", "120CHOIRCAD"] },
  T4: { stil: "traeger", melos: [["PCM", "Krieger"], ["PCM", "PsyChoTanZ"], ["PCM", "Genetikk"], ["PCM", "RoBBaFFerT_MeLo"]], pad: ["Phrase", "PAD_ResoChor"] },
  T5: { stil: "arp", melos: [["PCM", "Bx BassShoot ACI"], ["PCM", "21999__djgriffin"], ["PCM", "BxReese 190 F 01"], ["PCM", "BxReese 190 F 02"]], pad: ["Phrase", "120CHOIRDAQF"] },
  T6: { stil: "frage", melos: [["PCM", "MilitaryVoice"], ["PCM", "Zni Vocal"], ["PCM", "vOCALRW"], ["PCM", "choir voice"]], pad: ["Phrase", "Strings of Wisdo"] },
};

// ─── Plan: 10 Segmente x 10 Patterns, programmatisch ─────────────────────────

const THEMEN_FOLGE = ["T1", "T6", "T2", "T4", "T3"];
const PLAN = [];
THEMEN_FOLGE.forEach((tk, seg) => {
  const harm = seg % 2 === 0 ? "A" : "B";
  const p = (name, intens, kick, wdh, jam) =>
    PLAN.push([`S${seg + 1} ${name}`, intens, harm, kick, wdh, tk, jam]);
  p("AUF 1", seg === 0 ? 0 : 2, "vier", 2);
  p("AUF 2", seg === 0 ? 1 : 3, "hart", 2);
  p("ANLAUF", 4, "roll", 1);
  p("DROP 1", 5, "hart", 2);
  p("DROP 2", 5, "vier", 2);
  p("DROP 3", 5, "hart", 2);
  p("RUHE 1", 4, "vier", 2);
  p("RUHE 2", 3, "hart", 2);
  if (seg % 2 === 1) p("LUFT", -1, "kein", 2);
  else p("DROP 4", 5, "vier", 2);
  p("JAM", 2, "vier", 1, true);
});
if (PLAN.length !== 50) throw new Error(`Plan hat ${PLAN.length} statt 50 Patterns`);

// ─── Bausteine (Engine wie Set 8) ────────────────────────────────────────────

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
console.log(`Bank: ${BANK.split(/[\/]/).pop()} — ${belegt.length} Samples · Set 11 KURZSCHLUSS (${BPM} BPM, ${PLAN.length} Patterns)`);

const THEMEN_AUFGELOEST = {};
for (const [key, th] of Object.entries(THEMEN)) {
  const melos = th.melos.map(([kat, wahl]) => findeAnzeige(kat, wahl));
  const pad = findeAnzeige(th.pad[0], th.pad[1]);
  THEMEN_AUFGELOEST[key] = { stil: th.stil, meloNr: melos.map((m) => m.nr), padNr: pad.nr };
  console.log(`  ${key} (${th.stil.padEnd(7)}): ${melos.map((m) => m.name).join(" · ")} · Pad ${pad.name}`);
}

const patterns = PLAN.map(([name, intens, thema, kick, wdh, themenKey, jam], i) => ({
  name,
  bpm: BPM,
  mfxType: 11, // "12 GRAIN SHIFTER" — am Geraet bestaetigt.
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
  takte += PLAN[i][4] * 4;
  if (!p.chainTo && i + 1 < PLAN.length)
    console.log(`  ${String(i + 1).padStart(3)} ${PLAN[i][0].padEnd(11)} → Ende (Jam/Loop)`);
}
console.log(`  Kette gesamt: ${takte} Takte ≈ ${Math.round((takte * 4 * 60) / BPM / 60)} Minuten`);

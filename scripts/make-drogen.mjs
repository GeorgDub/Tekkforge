/**
 * Erzeugt DROGEN.e2sallpat — 250 Patterns, 175 BPM, aus den Song-Samples in
 * drogen.all (Ableton-Stem-Export, prep-drogen.py) plus den tekk4-Drums.
 *
 * Parts (Drums = bewaehrte tekk4-Samples, Song-Snare/-Perc als Layer):
 *    1 HaimKind  2 Jumpkick  3 clydesna  4 Dr SnareL2  5 closed 8  6 707_hho  7 ED Close  8 Dr PercL2
 *    9 BASS    = 4-Takt-Chunk der Sub-Bass-Spur (wechselt je Pattern → Bassline laeuft)
 *   10 STAB    = "Upper Punch" Melodie-Hit, rhythmisch, Oktav-/Quintversatz
 *   11 SHOT A  = Vocal-One-Shot (wechselt je Thema)
 *   12 SHOT B  = zweiter Vocal-One-Shot
 *   13 MELO A  Alternate-Paar 13/14: zwei 4-Takt-Chunks einer Melodie-Phrase
 *   14 MELO B  → 8-Takt-Melodie loopt in einem Pattern
 *   15 VERS A  Alternate-Paar 15/16: zwei 4-Takt-Chunks der Rap-Strophe
 *   16 VERS B  → 8 Takte Strophe
 *
 * 8 Themen a 30 Patterns (Melo-Phrase × Bass-Spur × Strophen-Haelfte), je
 * Thema Durchlauf 1 melo-zentriert, Durchlauf 2 vocal-zentriert (wie MEGA3),
 * Slots 241–250 = JAM je Thema + 2 ACAPELLA.
 *
 * Aufruf: npx tsx scripts/make-drogen.mjs [ziel.e2sallpat] [bank-json]
 */
import * as fs from "node:fs";
import { buildE2AllPatFile } from "../src/core/e2sExport.ts";
import { bankNumberToE2PatternRef } from "../src/core/e2sPatternSampleLink.ts";

const ZIEL = process.argv[2] ?? "examples/e2s/DROGEN.e2sallpat";
const BANKJSON = process.argv[3] ?? "examples/e2s/drogen/bank-drogen.json";
const BPM = 175;
const N = 64;
const SLOTS = 250;
const PRO_BLOCK = 30;

const MONO1 = 0, MONO2 = 1, POLY2 = 3;
const P_BASS = 8, P_STAB = 9, P_SHOTA = 10, P_SHOTB = 11, P_MELOA = 12, P_MELOB = 13, P_VERSA = 14, P_VERSB = 15;

const bank = JSON.parse(fs.readFileSync(BANKJSON, "utf8"));
const byName = new Map(bank.samples.map((s) => [s.name, s.nr]));
const byPrefix = (p) => bank.samples.find((s) => s.name.toLowerCase().startsWith(p.toLowerCase()))?.nr;
const nr = (name) => {
  const n = byName.get(name) ?? byPrefix(name);
  if (n === undefined) throw new Error(`Sample "${name}" nicht in ${BANKJSON}`);
  return n;
};
const gruppe = (g) => bank.samples.filter((s) => s.group === g).map((s) => s.name);

/** Drums: bewaehrte tekk4-Kicks/Snares/Hats (SET9–11, MEGA3) + Song-Snare und -Perc als Layer. */
const DRUMS = ["HaimKind", "Jumpkick", "clydesna", "Dr SnareL2", "closed 8", "707_hho", "ED Close", "Dr PercL2"];
const BASS1 = gruppe("Bass1"), BASS2 = gruppe("Bass2");
const MELO1 = gruppe("Melo1"), MELO2 = gruppe("Melo2"), MELO3 = gruppe("Melo3"), MELO4 = gruppe("Melo4");
const VERS = gruppe("Vers1");
const SHOTS = gruppe("Vox");
const STAB = "Dr Stab1";
if (VERS.length < 4 || MELO1.length < 3 || MELO2.length < 3 || SHOTS.length < 4) throw new Error("Manifest unvollstaendig");

/** Themen: Melo-Paar (A/B), Bass-Chunks, Strophen-Paar, zwei Shots. */
const THEMEN = [
  { tag: "T1", melo: [MELO1[0], MELO1[1]], bass: BASS1, vers: [VERS[0], VERS[1]], shots: [SHOTS[0], SHOTS[1]] },
  { tag: "T2", melo: [MELO1[1], MELO1[2]], bass: BASS1, vers: [VERS[2], VERS[3]], shots: [SHOTS[2], SHOTS[3]] },
  { tag: "T3", melo: [MELO2[0], MELO2[1]], bass: BASS2, vers: [VERS[0], VERS[1]], shots: [SHOTS[4 % SHOTS.length], SHOTS[5 % SHOTS.length]] },
  { tag: "T4", melo: [MELO2[1], MELO2[2]], bass: BASS2, vers: [VERS[2], VERS[3]], shots: [SHOTS[6 % SHOTS.length], SHOTS[7 % SHOTS.length]] },
  { tag: "T5", melo: [MELO3[0], MELO3[0]], bass: BASS1, vers: [VERS[0], VERS[1]], shots: [SHOTS[8 % SHOTS.length], SHOTS[0]] },
  { tag: "T6", melo: [MELO4[0], MELO4[0]], bass: BASS2, vers: [VERS[2], VERS[3]], shots: [SHOTS[1], SHOTS[2]] },
  { tag: "T7", melo: [MELO1[0], MELO1[1]], bass: BASS2, vers: [VERS[2], VERS[3]], shots: [SHOTS[3], SHOTS[4 % SHOTS.length]] },
  { tag: "T8", melo: [MELO2[0], MELO2[1]], bass: BASS1, vers: [VERS[0], VERS[1]], shots: [SHOTS[5 % SHOTS.length], SHOTS[6 % SHOTS.length]] },
];

//            K1   K2   SN  SN2  HH  HH2  PC  PC2  BASS STAB SHA  SHB  MELA MELB VRA  VRB
const VOLUME = [127, 104, 110, 96, 88, 82, 84, 80, 118, 100, 112, 108, 112, 112, 116, 116];
const VOICE = [MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1,
               MONO1, POLY2, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1];

// ─── Bausteine ────────────────────────────────────────────────────────────────

const takt = (s) => Math.floor(s / 16);
const imTakt = (s) => s % 16;
const leer = () => Array.from({ length: N }, () => ({ active: false }));
const hit = (notes, velocity, gate) => ({ active: true, notes, velocity, gate });
const baue = (fn) => Array.from({ length: N }, (_, s) => fn(s) ?? { active: false });
const einmal = () => baue((s) => (s === 0 ? hit([60], 127, 96) : null));

const KICK = {
  kein: () => leer(),
  vier: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : null)),
  hart: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : imTakt(s) === 15 ? hit([60], 108, 14) : null)),
  roll: () => baue((s) => (s % 4 === 0 || (takt(s) === 3 && s % 2 === 0) ? hit([60], 112, 28) : null)),
};

/** Stab-Figuren: Oktave/Quinte relativ zum Originalton (Tonart unbekannt, daher nur Eigenintervalle). */
const STAB_FIG = {
  ruhig: () => baue((s) => (imTakt(s) === 0 && takt(s) % 2 === 0 ? hit([60], 92, 40) : null)),
  stab: () => baue((s) => (imTakt(s) === 4 || imTakt(s) === 12 ? hit([takt(s) === 3 && imTakt(s) === 12 ? 67 : 60], 96, 14) : null)),
  arp: () => baue((s) => (s % 4 === 2 ? hit([[60, 67, 72, 67][takt(s)]], 88, 12) : null)),
  frage: () => baue((s) => (imTakt(s) === 0 ? hit([takt(s) % 2 ? 55 : 60], 94, 40) : imTakt(s) === 10 ? hit([60], 84, 14) : null)),
};

/** Vocal-Shots: A auf die Eins von Takt 1 und 3, B auf die Drei von Takt 2 und 4 (Variante: Takt 4 Ende). */
const SHOT_FIG = {
  a: () => baue((s) => (s === 0 || s === 32 ? hit([60], 118, 96) : null)),
  a2: () => baue((s) => (s === 0 ? hit([60], 118, 96) : null)),
  b: () => baue((s) => (s === 24 || s === 56 ? hit([60], 112, 96) : null)),
  b2: () => baue((s) => (s === 60 ? hit([60], 112, 96) : null)),
};

function parts(thema, intens, kickFigur, lagen, bassIdx) {
  const breakStelle = intens < 0;
  const i = breakStelle ? 0 : intens;
  const steps = Array.from({ length: 16 }, leer);
  const wach = new Array(16).fill(false);

  steps[0] = KICK[kickFigur === "kein" ? "vier" : kickFigur]();
  wach[0] = !breakStelle && kickFigur !== "kein";
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
  steps[5] = baue((s) => (s % 2 === 1 ? hit([60], 70, 8) : null));
  wach[5] = i >= 3;
  steps[6] = baue((s) => (s % 8 === 5 ? hit([60], 78, 13) : null));
  wach[6] = i >= 4;
  steps[7] = baue((s) => (imTakt(s) === 14 && takt(s) % 2 === 1 ? hit([60], 84, 40) : null));
  wach[7] = i >= 5;

  steps[P_BASS] = einmal();
  wach[P_BASS] = !!lagen.bass && !breakStelle;
  steps[P_STAB] = STAB_FIG[lagen.stab ?? "stab"]();
  wach[P_STAB] = !!lagen.stab;
  steps[P_SHOTA] = SHOT_FIG[lagen.shot === 2 ? "a2" : "a"]();
  wach[P_SHOTA] = !!lagen.shot;
  steps[P_SHOTB] = SHOT_FIG[lagen.shot === 2 ? "b2" : "b"]();
  wach[P_SHOTB] = lagen.shot === 1;
  steps[P_MELOA] = einmal();
  steps[P_MELOB] = einmal();
  wach[P_MELOA] = wach[P_MELOB] = !!lagen.melo;
  steps[P_VERSA] = einmal();
  steps[P_VERSB] = einmal();
  wach[P_VERSA] = wach[P_VERSB] = !!lagen.vers;

  const bassName = thema.bass[bassIdx % thema.bass.length];
  const nrFuer = (idx) =>
    idx < 8 ? nr(DRUMS[idx])
      : idx === P_BASS ? nr(bassName)
      : idx === P_STAB ? nr(STAB)
      : idx === P_SHOTA ? nr(thema.shots[0])
      : idx === P_SHOTB ? nr(thema.shots[1])
      : idx === P_MELOA ? nr(thema.melo[0])
      : idx === P_MELOB ? nr(thema.melo[1])
      : idx === P_VERSA ? nr(thema.vers[0])
      : nr(thema.vers[1]);

  return steps.map((st, idx) => {
    const params = { voiceAssign: VOICE[idx] };
    if (idx <= 1) Object.assign(params, { ifxOn: 1, ifxType: 8, ifxEdit: 127 });
    if (idx >= P_BASS && idx !== P_STAB) params.ampEgOn = 0; // Loops/Shots laufen durch
    return { sampleId: bankNumberToE2PatternRef(nrFuer(idx)), steps: st, volume: VOLUME[idx], params, muted: !wach[idx] };
  });
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

//            Name      Intens Kick    Wdh  Lagen
const BLOCK = [
  // Durchlauf 1 — Melo-zentriert
  ["INTRO",   1, "vier", 2, { melo: 1 }],
  ["AUF 1",   2, "vier", 2, { melo: 1, bass: 1 }],
  ["AUF 2",   3, "hart", 2, { melo: 1, bass: 1, stab: "ruhig" }],
  ["ANLAUF",  4, "roll", 2, { bass: 1, stab: "arp", shot: 2 }],
  ["DROP 1",  5, "hart", 2, { melo: 1, bass: 1, stab: "stab" }],
  ["DROP 2",  5, "vier", 2, { melo: 1, bass: 1, shot: 1 }],
  ["DROP 3",  5, "hart", 2, { melo: 1, bass: 1, vers: 1 }],
  ["RUHE 1",  2, "vier", 2, { melo: 1, bass: 1 }],
  ["RUHE 2",  3, "vier", 2, { bass: 1, stab: "frage", shot: 2 }],
  ["LUFT",   -1, "kein", 2, { melo: 1 }],
  ["DROP 4",  5, "hart", 2, { melo: 1, bass: 1, stab: "stab", shot: 1 }],
  ["DROP 5",  5, "vier", 2, { melo: 1, bass: 1, vers: 1, stab: "arp" }],
  ["AUSKL",   3, "vier", 2, { melo: 1, bass: 1 }],
  ["JAM ST",  2, "vier", 2, { bass: 1, stab: "arp", shot: 1 }],
  ["JAM",     2, "vier", 2, { melo: 1, bass: 1, vers: 1, stab: "stab", shot: 1 }],
  // Durchlauf 2 — Vocal-zentriert
  ["VOX IN",  1, "vier", 2, { vers: 1 }],
  ["VOX 1",   3, "hart", 2, { vers: 1, bass: 1 }],
  ["VOX 2",   4, "vier", 2, { vers: 1, bass: 1, melo: 1 }],
  ["BREAK",  -1, "kein", 2, { vers: 1 }],
  ["DRP2 1",  5, "hart", 2, { melo: 1, vers: 1, bass: 1, stab: "stab" }],
  ["DRP2 2",  5, "roll", 2, { melo: 1, bass: 1, shot: 1 }],
  ["DRP2 3",  5, "hart", 2, { vers: 1, bass: 1, stab: "arp", shot: 2 }],
  ["RUHE 3",  2, "vier", 2, { bass: 1, stab: "ruhig", shot: 2 }],
  ["RUHE 4",  3, "vier", 2, { melo: 1, bass: 1, shot: 2 }],
  ["LUFT 2", -1, "kein", 2, { melo: 1, vers: 1 }],
  ["DRP2 4",  5, "hart", 2, { melo: 1, vers: 1, bass: 1, stab: "stab", shot: 1 }],
  ["DRP2 5",  5, "vier", 2, { melo: 1, bass: 1, stab: "frage", shot: 1 }],
  ["AUSKL2",  3, "vier", 2, { vers: 1, bass: 1 }],
  ["JAM VX",  2, "vier", 2, { vers: 1, bass: 1, shot: 1 }],
  ["JAM 2",   2, "vier", 2, { melo: 1, vers: 1, bass: 1, stab: "stab", shot: 1 }],
];
if (BLOCK.length !== PRO_BLOCK) throw new Error(`Block hat ${BLOCK.length} statt ${PRO_BLOCK}`);

const pattern = (name, thema, intens, kick, lagen, bassIdx, chainTo, wdh) => ({
  name: name.slice(0, 16),
  bpm: BPM,
  mfxType: 11, // "12 GRAIN SHIFTER"
  stepLength: 64,
  parts: parts(thema, intens, kick, lagen, bassIdx),
  alternate13_14: true, // MELO A/B
  alternate15_16: true, // VERS A/B
  chainTo,
  chainRepeat: wdh,
});

const patterns = [];
for (const thema of THEMEN) {
  const start = patterns.length;
  BLOCK.forEach(([name, intens, kick, wdh, lagen], p) => {
    const letzte = p === BLOCK.length - 1;
    patterns.push(pattern(`Dr ${thema.tag} ${name}`, thema, intens, kick, lagen, p, letzte ? 0 : start + p + 2, wdh));
  });
}
for (const thema of THEMEN) {
  patterns.push(pattern(`Dr ${thema.tag} ALLES`, thema, 5, "hart", { melo: 1, vers: 1, bass: 1, stab: "stab", shot: 1 }, 0, 0, 2));
}
patterns.push(pattern("Dr ACAPELLA 1", THEMEN[0], -1, "kein", { vers: 1, shot: 2 }, 0, 0, 2));
patterns.push(pattern("Dr ACAPELLA 2", THEMEN[1], -1, "kein", { vers: 1, shot: 2 }, 0, 0, 2));
if (patterns.length !== SLOTS) throw new Error(`${patterns.length} Patterns statt ${SLOTS}`);

const out = Buffer.from(buildE2AllPatFile(patterns));
fs.writeFileSync(ZIEL, out);
console.log(`${ZIEL} — ${out.length} Bytes · ${patterns.length} Patterns · ${BPM} BPM · Bank ${BANKJSON}`);
THEMEN.forEach((t, i) =>
  console.log(`  ${t.tag}  Slots ${String(i * PRO_BLOCK + 1).padStart(3)}–${String((i + 1) * PRO_BLOCK).padStart(3)}  Melo ${t.melo.join(" / ")} · Bass ${t.bass[0].slice(0, 8)} (${t.bass.length} Chunks) · Vers ${t.vers.join(" / ")} · Shots ${t.shots.join(", ")}`),
);
console.log(`  Slots 241–248  ALLES je Thema · 249–250 ACAPELLA`);

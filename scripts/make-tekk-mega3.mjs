/**
 * Erzeugt TEKK_MEGA3.e2sallpat — "ROUND 1": 250 Patterns, 175 BPM, auf round1.all.
 *
 * 16 Song-Bloecke a 15 Patterns (Slots 1–240) + 10 TRANS-Patterns (241–250).
 * Jeder Block baut einen Song aus „round 1" als Tekk nach — Melos im Fokus:
 *
 *   Part 11 MELO  = 4-Takt-Hook des Songs (Slice, 175 BPM, echte Tonart)
 *   Part 12 DROP  = 1-Takt-Loop aus dem Drop des Songs
 *   Part 13 STAB  = Einzelklang aus dem Hook, spielt die erkannte Melodie
 *                   (transponiert relativ zur gemessenen Stab-Tonhoehe)
 *   Part 14 SYN   = tekk4-PCM-Melo spielt dieselbe Melodie (ohne Loops —
 *                   Samplegrundton unbekannt, darum nie gleichzeitig)
 *   Part 15 ARP   = STAB-Sample als Achtel-Arpeggio ueber die Song-Akkorde
 *   Part 16 PAD   = Choir/Pad-Akkorde (nur in Synth-Patterns)
 *   Parts 1–10    = Tekk-Drums + Bass (Bass folgt den Song-Akkordwurzeln)
 *
 * Blockverlauf (15): INTRO · AUF 1 · AUF 2 · ANLAUF · DROP 1 · DROP 2 · DROP 3 ·
 * RUHE 1 · RUHE 2 · LUFT · DROP 4 · DROP 5 · AUSKL · JAM SY · JAM (Kettenende).
 * TRANS = DJ-Uebergang: Takte 1–2 DROP-Loop Song A, Takte 3–4 DROP-Loop Song B.
 *
 * Eingaben: examples/e2s/round1/analyse.json (analyze-round1.py),
 *           examples/e2s/round1/mapping.json (make-round1-bank.mjs), round1.all.
 * Aufruf:   npx tsx scripts/make-tekk-mega3.mjs [ziel.e2sallpat] [bank.all]
 */
import * as fs from "node:fs";
import { buildE2AllPatFile } from "../src/core/e2sExport.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import {
  bankNumberToE2PatternRef,
  oscToDisplayNumber,
} from "../src/core/e2sPatternSampleLink.ts";

const ZIEL = process.argv[2] ?? "examples/e2s/TEKK_MEGA3.e2sallpat";
const BANK = process.argv[3] ?? "examples/e2s/round1.all";
const ROUND1 = "examples/e2s/round1";
const BPM = 175;
const N = 64;
const SLOTS = 250;
const PRO_BLOCK = 15;

const MONO1 = 0, MONO2 = 1, POLY2 = 3;

const analyse = JSON.parse(fs.readFileSync(`${ROUND1}/analyse.json`, "utf8")).filter((a) => !a.error);
const mapping = JSON.parse(fs.readFileSync(`${ROUND1}/mapping.json`, "utf8"));
const songs = mapping.map((m) => {
  const a = analyse.find((x) => x.idx === m.idx);
  if (!a) throw new Error(`Song ${m.idx} ohne Analyse`);
  return { ...a, ...m };
});
if (songs.length !== 16) throw new Error(`${songs.length} Songs, erwartet 16`);

// ─── Bank-Belegung ────────────────────────────────────────────────────────────

const BELEGUNG = [
  ["Kick", "HaimKind"], ["Kick", "Jumpkick"], ["Snare", "clydesna"], ["Snare", "snarre-p"],
  ["HiHat", "closed 8"], ["HiHat", "707_hho"], ["Shots", "ED Close"], ["Shots", "ZaHnI_To"],
  ["Analog", "Unison_Bass_C3"], ["Analog", "Bassdrum-01fd"],
];
const SYNTH_MELOS = [
  ["PCM", "T-Mello"], ["PCM", "Tau-MeLo"], ["PCM", "HBsChE PaRa"], ["PCM", "Auf CrystaL"],
  ["PCM", "Holia-MeLo"], ["PCM", "melo6dk"], ["PCM", "Ha He MeLo"], ["PCM", "Krieger"],
];
const PADS = [
  ["Phrase", "Padseq~1"], ["Phrase", "120CHOIRC23sD"], ["Phrase", "PAD_ResoChor"], ["Phrase", "Strings of Wisdo"],
];
//            K1   K2   SN  SN2  HH  HHO  SH  SH2  BASS BAS2 MELO DROP STAB SYN  ARP  PAD
const VOLUME = [127, 108, 105, 94, 84, 88, 80, 78, 116, 100, 112, 108, 104, 96, 90, 66];
const VOICE = [MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1,
               MONO2, MONO2, MONO1, MONO1, MONO1, POLY2, MONO1, POLY2];

const buf = fs.readFileSync(BANK);
const bank = parseE2sBank(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const belegt = bank.slots.filter((s) => s && s.frames > 0);
const nachKategorie = new Map();
for (const s of belegt) {
  if (!nachKategorie.has(s.categoryName)) nachKategorie.set(s.categoryName, []);
  nachKategorie.get(s.categoryName).push(s);
}
const vorhandeneNr = new Set(belegt.map((s) => oscToDisplayNumber(s.sampleNumber)));
function findeAnzeige(kat, wahl) {
  const liste = nachKategorie.get(kat) ?? [];
  const s = liste.find((x) => x.name.trim().toLowerCase().startsWith(wahl.toLowerCase()));
  if (!s) throw new Error(`Kategorie "${kat}": "${wahl}" nicht gefunden`);
  return oscToDisplayNumber(s.sampleNumber);
}
const SAMPLES = BELEGUNG.map(([k, w]) => findeAnzeige(k, w));
const SYN_NR = SYNTH_MELOS.map(([k, w]) => findeAnzeige(k, w));
const PAD_NR = PADS.map(([k, w]) => findeAnzeige(k, w));
for (const s of songs) {
  for (const art of ["MELO", "DROP", "STAB"]) {
    if (!vorhandeneNr.has(s[art])) throw new Error(`Song ${s.idx}: Sample #${s[art]} (${art}) fehlt in ${BANK}`);
  }
}
console.log(`Bank: ${BANK.split(/[\/]/).pop()} — ${belegt.length} Samples · MEGA3 ROUND 1 (${BPM} BPM, ${SLOTS} Patterns)`);

// ─── Bausteine ────────────────────────────────────────────────────────────────

const takt = (s) => Math.floor(s / 16);
const imTakt = (s) => s % 16;
const leer = () => Array.from({ length: N }, () => ({ active: false }));
const hit = (notes, velocity, gate) => ({ active: true, notes, velocity, gate });
const baue = (fn) => Array.from({ length: N }, (_, s) => fn(s) ?? { active: false });
const fold = (n, lo, hi) => {
  while (n < lo) n += 12;
  while (n > hi) n -= 12;
  return n;
};
const gateFuer = (laenge) => (laenge <= 1 ? 14 : laenge === 2 ? 24 : laenge <= 4 ? 40 : laenge <= 8 ? 64 : 96);

const KICK = {
  kein: () => leer(),
  vier: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : null)),
  hart: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : imTakt(s) === 15 ? hit([60], 108, 14) : null)),
  roll: () => baue((s) => (s % 4 === 0 || (takt(s) === 3 && s % 2 === 0) ? hit([60], 112, 28) : null)),
};

/**
 * Melodie-Ereignisse des Songs als [step, absNote, laenge]. Weniger als 6
 * erkannte Ereignisse → Achtel-Arpeggio aus den Song-Akkorden als Ersatz.
 */
function melodie(song) {
  let ev = song.events ?? [];
  if (ev.length < 6) {
    ev = [];
    for (let s = 0; s < N; s += 2) {
      const akk = song.chords[takt(s)];
      ev.push([s, akk[[0, 2, 1, 2][(s / 2) % 4]]]);
    }
  }
  return ev.map(([s, n], i) => [s, n, Math.min(16, (ev[i + 1]?.[0] ?? N) - s)]);
}

/** Referenzton des STAB-Samples: gemessen, sonst Median der Melodie, sonst 60. */
function stabRef(song) {
  if (song.stab?.note) return song.stab.note;
  const noten = (song.events ?? []).map((e) => e[1]).sort((a, b) => a - b);
  return noten.length ? noten[Math.floor(noten.length / 2)] : 60;
}

function songParts(song, intens, kickFigur, lagen, jam) {
  const breakStelle = intens < 0;
  const i = breakStelle ? 0 : intens;
  const ref = stabRef(song);
  const ev = melodie(song);
  const bass = song.bass;
  const akk = song.chords;

  const steps = Array.from({ length: 16 }, leer);
  const wach = new Array(16).fill(false);

  // Drums (0–7) — Intensitaetsstufen wie SET9–11
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
  steps[5] = baue((s) => (imTakt(s) === 14 || imTakt(s) === 6 ? hit([60], 86, 34) : null));
  wach[5] = i >= 3;
  steps[6] = baue((s) => (s % 8 === 5 ? hit([60], 78, 13) : null));
  wach[6] = i >= 4;
  steps[7] = baue((s) => (s % 8 === 7 ? hit([60], 72, 11) : null));
  wach[7] = i >= 5;
  // Bass (8–9) folgt den Akkordwurzeln des Songs
  steps[8] = baue((s) => {
    if (s % 4 === 2) return hit([bass[takt(s)]], 108, 17);
    if (imTakt(s) === 15) return hit([bass[(takt(s) + 1) % 4]], 98, 9);
    return null;
  });
  wach[8] = i >= 2;
  steps[9] = baue((s) => (imTakt(s) === 0 ? hit([bass[takt(s)]], 98, 40) : null));
  wach[9] = !breakStelle;

  // Song-Lagen (10–15)
  steps[10] = baue((s) => (s === 0 ? hit([60], 127, 96) : null));           // MELO, 4 Takte
  wach[10] = !!lagen.melo;
  steps[11] = baue((s) => (imTakt(s) === 0 ? hit([60], 120, 96) : null));   // DROP, je Takt
  wach[11] = !!lagen.drop;
  steps[12] = baue((s) => {                                                  // STAB spielt Melodie
    const e = ev.find((x) => x[0] === s);
    return e ? hit([fold(60 + (e[1] - ref), 40, 84)], 104, gateFuer(e[2])) : null;
  });
  wach[12] = !!lagen.stab;
  steps[13] = baue((s) => {                                                  // SYN spielt Melodie
    const e = ev.find((x) => x[0] === s);
    return e ? hit([fold(e[1], 55, 79)], 92, gateFuer(e[2])) : null;
  });
  wach[13] = !!lagen.syn;
  steps[14] = baue((s) =>                                                    // ARP: STAB ueber Akkorde
    s % 2 === 0 ? hit([fold(60 + (akk[takt(s)][[0, 1, 2, 1][(s / 2) % 4]] - ref), 48, 72)], 84, 12) : null,
  );
  wach[14] = !!lagen.arp;
  steps[15] = baue((s) => (imTakt(s) === 0 ? hit(akk[takt(s)], breakStelle ? 76 : 66, 96) : null)); // PAD
  wach[15] = !!lagen.pad;

  const synNr = SYN_NR[(song.idx - 1) % SYN_NR.length];
  const padNr = PAD_NR[(song.idx - 1) % PAD_NR.length];
  const nrFuer = (idx) =>
    idx < 10 ? SAMPLES[idx] : idx === 10 ? song.MELO : idx === 11 ? song.DROP
      : idx === 12 || idx === 14 ? song.STAB : idx === 13 ? synNr : padNr;

  return steps.map((st, idx) => {
    const params = { voiceAssign: VOICE[idx] };
    if (idx <= 1) Object.assign(params, { ifxOn: 1, ifxType: 8, ifxEdit: 127 });
    if (idx === 10 || idx === 11) params.ampEgOn = 0; // Loops laufen durch
    return {
      sampleId: bankNumberToE2PatternRef(nrFuer(idx)),
      steps: st,
      volume: VOLUME[idx],
      params,
      muted: !wach[idx],
    };
  });
}

/** TRANS: Takte 1–2 DROP von A, Takte 3–4 DROP von B, Drums dazwischen. */
function transParts(a, b) {
  const lagen = {};
  const parts = songParts(a, 4, "hart", lagen, false);
  parts[11].steps = baue((s) => (imTakt(s) === 0 && takt(s) < 2 ? hit([60], 120, 96) : null));
  parts[11].muted = false;
  parts[12] = {
    sampleId: bankNumberToE2PatternRef(b.DROP),
    steps: baue((s) => (imTakt(s) === 0 && takt(s) >= 2 ? hit([60], 120, 96) : null)),
    volume: VOLUME[11],
    params: { voiceAssign: MONO1, ampEgOn: 0 },
    muted: false,
  };
  // Bass: erste Haelfte A, zweite Haelfte B
  parts[8].steps = baue((s) => {
    const src = takt(s) < 2 ? a : b;
    return s % 4 === 2 ? hit([src.bass[takt(s)]], 108, 17) : null;
  });
  parts[9].steps = baue((s) => (imTakt(s) === 0 ? hit([(takt(s) < 2 ? a : b).bass[takt(s)]], 98, 40) : null));
  return parts;
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

//            Name      Intens Kick    Wdh  Lagen
const BLOCK = [
  ["INTRO",   1, "vier", 2, { melo: 1 }],
  ["AUF 1",   2, "vier", 2, { melo: 1 }],
  ["AUF 2",   3, "hart", 2, { melo: 1, arp: 1 }],
  ["ANLAUF",  4, "roll", 1, { syn: 1, pad: 1 }],
  ["DROP 1",  5, "hart", 2, { melo: 1, stab: 1 }],
  ["DROP 2",  5, "vier", 2, { drop: 1, stab: 1 }],
  ["DROP 3",  5, "hart", 2, { melo: 1, drop: 1 }],
  ["RUHE 1",  2, "vier", 2, { melo: 1 }],
  ["RUHE 2",  3, "vier", 2, { syn: 1, pad: 1 }],
  ["LUFT",   -1, "kein", 2, { melo: 1 }],
  ["DROP 4",  5, "hart", 2, { melo: 1, stab: 1, arp: 1 }],
  ["DROP 5",  5, "vier", 2, { stab: 1, arp: 1 }],
  ["AUSKL",   3, "vier", 2, { melo: 1 }],
  ["JAM SY",  2, "vier", 1, { syn: 1, arp: 0, pad: 1 }],
  ["JAM",     2, "vier", 1, { melo: 1, drop: 1, stab: 1, arp: 1 }],
];
if (BLOCK.length !== PRO_BLOCK) throw new Error("Block hat nicht 15 Patterns");

const TRANS = [[1, 2], [3, 4], [5, 6], [7, 8], [9, 10], [11, 12], [13, 14], [15, 16], [16, 1], [8, 9]];

const patterns = [];
for (const song of songs) {
  const start = patterns.length; // 0-basiert
  BLOCK.forEach(([name, intens, kick, wdh, lagen], p) => {
    const letzte = p === BLOCK.length - 1;
    patterns.push({
      name: `${song.tag.slice(0, 9)} ${name}`.slice(0, 16),
      bpm: BPM,
      mfxType: 11, // "12 GRAIN SHIFTER"
      stepLength: 64,
      parts: songParts(song, intens, kick, lagen, name.startsWith("JAM")),
      alternate13_14: false,
      alternate15_16: false,
      chainTo: letzte ? 0 : start + p + 2,
      chainRepeat: wdh,
    });
  });
}
for (const [ia, ib] of TRANS) {
  const a = songs[ia - 1], b = songs[ib - 1];
  patterns.push({
    name: `TR ${a.tag.slice(0, 5)}>${b.tag.slice(0, 5)}`.slice(0, 16),
    bpm: BPM,
    mfxType: 11,
    stepLength: 64,
    parts: transParts(a, b),
    alternate13_14: false,
    alternate15_16: false,
    chainTo: 0,
    chainRepeat: 2,
  });
}
if (patterns.length !== SLOTS) throw new Error(`${patterns.length} Patterns statt ${SLOTS}`);

const out = Buffer.from(buildE2AllPatFile(patterns));
fs.writeFileSync(ZIEL, out);
console.log(`${ZIEL} — ${out.length} Bytes · ${patterns.length} Patterns · ${BPM} BPM`);
for (const [i, s] of songs.entries()) {
  const ev = melodie(s);
  console.log(
    `  Block ${String(i + 1).padStart(2)}  Slots ${String(i * PRO_BLOCK + 1).padStart(3)}–${(i + 1) * PRO_BLOCK}  ${s.tag.padEnd(9)} ` +
    `${s.key.padEnd(6)} ${String(s.bpm).padStart(5)}→175  Melo-Events ${String((s.events ?? []).length).padStart(2)}${(s.events ?? []).length < 6 ? " (Arp-Ersatz)" : ""}  Stab-Ref ${stabRef(s)}  #${s.MELO}/${s.DROP}/${s.STAB}`,
  );
}
console.log(`  Slots 241–250  TRANS ${TRANS.map(([a, b]) => `${a}>${b}`).join(" ")}`);

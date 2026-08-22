/**
 * Erzeugt TEKK_MEGA3<X>.e2sallpat — "ROUND 1": 250 Patterns, 175 BPM, je 8 Songs
 * auf round1<x>.all (A: Songs 1–8, B: Songs 9–16).
 *
 * 8 Song-Bloecke a 30 Patterns (Slots 1–240) + 10 TRANS-Patterns (241–250).
 * Jeder Block baut einen Song aus „round 1" als Tekk nach — Melos im Fokus:
 *
 *   Part 13 MELO A = Takte 1–4 der 8-Takt-Hook (UVR-Instrumental → Demucs ohne
 *   Part 14 MELO B = Takte 5–8   Drums/Bass, 175 BPM, echte Tonart). Das Paar
 *                    13/14 ist am Geraet ALTERNATE geschaltet: jeder Pattern-
 *                    Durchlauf spielt abwechselnd A und B → eine 8-Takt-Melodie
 *                    loopt in einem einzelnen Pattern.
 *   Part 12 VOX    = 4-Takt-Vocal-Phrase aus der UVR-Vocals-Spur (Songs ohne
 *                    Vocals: stattdessen der DROP-Loop)
 *   Part  8 DROP   = 1-Takt-Loop aus dem Drop des Songs (Vollmix), je Takt
 *   Part 11 STAB   = Einzelklang aus dem Hook, spielt die erkannte Melodie
 *                    (transponiert relativ zur gemessenen Stab-Tonhoehe)
 *   Part 15 ARP    = STAB-Sample als Achtel-Arpeggio ueber die Song-Akkorde
 *   Part 16 SYN    = tekk4-PCM-Melo spielt dieselbe Melodie (ohne Loops —
 *                    Samplegrundton unbekannt, darum nie gleichzeitig)
 *   Parts 1–7, 9–10 = Tekk-Drums + Bass (Bass folgt den Song-Akkordwurzeln)
 *
 * Blockverlauf (30): Durchlauf 1 (Melo-zentriert): INTRO · AUF 1 · AUF 2 · ANLAUF ·
 * DROP 1 · DROP 2 · DROP 3 · RUHE 1 · RUHE 2 · LUFT · DROP 4 · DROP 5 · AUSKL ·
 * JAM SY · JAM — Durchlauf 2 (Vocal-zentriert): VOX IN · VOX 1 · VOX 2 · BREAK ·
 * DRP2 1–3 · RUHE 3 · RUHE 4 · LUFT 2 · DRP2 4 · DRP2 5 · AUSKL2 · JAM VX ·
 * JAM 2 (Kettenende).
 * TRANS = Mashup-Uebergang: VOX (bzw. DROP) von Song A ueber MELO A/B von Song B,
 *         Bass folgt B.
 *
 * Eingaben: examples/e2s/round1/analyse.json (analyze-round1.py),
 *           examples/e2s/round1/mapping-<bank>.json (make-round1-bank.mjs), Bank.
 * Aufruf:   npx tsx scripts/make-tekk-mega3.mjs <ziel.e2sallpat> <bank.all>
 *           z. B. examples/e2s/TEKK_MEGA3A.e2sallpat examples/e2s/round1a.all
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildE2AllPatFile } from "../src/core/e2sExport.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import {
  bankNumberToE2PatternRef,
  oscToDisplayNumber,
} from "../src/core/e2sPatternSampleLink.ts";

const ZIEL = process.argv[2] ?? "examples/e2s/TEKK_MEGA3A.e2sallpat";
const BANK = process.argv[3] ?? "examples/e2s/round1a.all";
const ROUND1 = "examples/e2s/round1";
const MAPPING = path.join(ROUND1, `mapping-${path.basename(BANK, ".all")}.json`);
const BPM = 175;
const N = 64;
const SLOTS = 250;
const PRO_BLOCK = 30;
const SONGS_JE_BANK = 8;

const MONO1 = 0, MONO2 = 1, POLY2 = 3;

// Part-Indizes (0-basiert)
const P_DROP = 7, P_STAB = 10, P_VOX = 11, P_MELOA = 12, P_MELOB = 13, P_ARP = 14, P_SYN = 15;

/** Songs, deren STAB-Tonhoehe nicht messbar war (Vollmix-Fenster ohne klare
 *  Einzelnoten): STAB- und ARP-Part bleiben stumm, sonst verstimmt gegen den Loop. */
const OHNE_STAB = new Set([5, 10, 13]); // NewToday, Amphegott, Vorbild

const analyse = JSON.parse(fs.readFileSync(`${ROUND1}/analyse.json`, "utf8")).filter((a) => !a.error);
const mapping = JSON.parse(fs.readFileSync(MAPPING, "utf8"));
const songs = mapping.map((m) => {
  const a = analyse.find((x) => x.idx === m.idx);
  if (!a) throw new Error(`Song ${m.idx} ohne Analyse`);
  return { ...a, ...m };
});
if (songs.length !== SONGS_JE_BANK) throw new Error(`${songs.length} Songs in ${MAPPING}, erwartet ${SONGS_JE_BANK}`);

// ─── Bank-Belegung ────────────────────────────────────────────────────────────

const BELEGUNG = [
  ["Kick", "HaimKind"], ["Kick", "Jumpkick"], ["Snare", "clydesna"], ["Snare", "snarre-p"],
  ["HiHat", "closed 8"], ["HiHat", "707_hho"], ["Shots", "ED Close"], null /* DROP */,
  ["Analog", "Unison_Bass_C3"], ["Analog", "Bassdrum-01fd"],
];
const SYNTH_MELOS = [
  ["PCM", "T-Mello"], ["PCM", "Tau-MeLo"], ["PCM", "HBsChE PaRa"], ["PCM", "Auf CrystaL"],
  ["PCM", "Holia-MeLo"], ["PCM", "melo6dk"], ["PCM", "Ha He MeLo"], ["PCM", "Krieger"],
];
//            K1   K2   SN  SN2  HH  HHO  SH  DROP BASS BAS2 STAB VOX  MELA MELB ARP  SYN
const VOLUME = [127, 108, 105, 94, 84, 88, 80, 104, 116, 100, 104, 118, 114, 114, 90, 96];
const VOICE = [MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1,
               MONO2, MONO2, MONO1, MONO1, MONO1, MONO1, MONO1, POLY2];

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
const SAMPLES = BELEGUNG.map((b) => (b ? findeAnzeige(b[0], b[1]) : null));
const SYN_NR = SYNTH_MELOS.map(([k, w]) => findeAnzeige(k, w));
for (const s of songs) {
  for (const art of ["MELOA", "MELOB", "DROP", "STAB", ...(s.VOX ? ["VOX"] : [])]) {
    if (!vorhandeneNr.has(s[art])) throw new Error(`Song ${s.idx}: Sample #${s[art]} (${art}) fehlt in ${BANK}`);
  }
}
console.log(`Bank: ${path.basename(BANK)} — ${belegt.length} Samples · ${path.basename(ZIEL, ".e2sallpat")} (${BPM} BPM, ${SLOTS} Patterns, Songs ${songs[0].idx}–${songs.at(-1).idx})`);

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
 * Melodie-Ereignisse der ersten 4 Takte als [step, absNote, laenge]
 * (STAB/SYN alternieren nicht, darum nur Haelfte A). Weniger als 6
 * erkannte Ereignisse → Achtel-Arpeggio aus den Song-Akkorden als Ersatz.
 */
function melodie(song) {
  let ev = (song.events ?? []).filter((e) => e[0] < N);
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

function songParts(song, intens, kickFigur, lagen) {
  const breakStelle = intens < 0;
  const i = breakStelle ? 0 : intens;
  const ref = stabRef(song);
  const ev = melodie(song);
  const bass = song.bass;
  const akk = song.chords;
  const hatVox = !!song.VOX;

  const steps = Array.from({ length: 16 }, leer);
  const wach = new Array(16).fill(false);

  // Drums (0–6) — Intensitaetsstufen wie SET9–11
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
  // DROP-Loop (7), je Takt
  steps[P_DROP] = baue((s) => (imTakt(s) === 0 ? hit([60], 120, 96) : null));
  wach[P_DROP] = !!lagen.drop || (!!lagen.vox && !hatVox);
  // Bass (8–9) folgt den Akkordwurzeln des Songs (Takte 1–4)
  steps[8] = baue((s) => {
    if (s % 4 === 2) return hit([bass[takt(s)]], 108, 17);
    if (imTakt(s) === 15) return hit([bass[(takt(s) + 1) % 4]], 98, 9);
    return null;
  });
  wach[8] = i >= 2;
  steps[9] = baue((s) => (imTakt(s) === 0 ? hit([bass[takt(s)]], 98, 40) : null));
  wach[9] = !breakStelle;

  // Song-Lagen (10–15)
  steps[P_STAB] = baue((s) => {
    const e = ev.find((x) => x[0] === s);
    return e ? hit([fold(60 + (e[1] - ref), 40, 84)], 104, gateFuer(e[2])) : null;
  });
  wach[P_STAB] = !!lagen.stab && !OHNE_STAB.has(song.idx);
  steps[P_VOX] = baue((s) => (s === 0 ? hit([60], 127, 96) : null)); // 4 Takte, einmal triggern
  wach[P_VOX] = !!lagen.vox && hatVox;
  steps[P_MELOA] = baue((s) => (s === 0 ? hit([60], 127, 96) : null)); // Alternate: Durchlauf 1, 3, …
  steps[P_MELOB] = baue((s) => (s === 0 ? hit([60], 127, 96) : null)); // Alternate: Durchlauf 2, 4, …
  wach[P_MELOA] = wach[P_MELOB] = !!lagen.melo;
  steps[P_ARP] = baue((s) =>
    s % 2 === 0 ? hit([fold(60 + (akk[takt(s)][[0, 1, 2, 1][(s / 2) % 4]] - ref), 48, 72)], 84, 12) : null,
  );
  wach[P_ARP] = !!lagen.arp && !OHNE_STAB.has(song.idx);
  steps[P_SYN] = baue((s) => {
    const e = ev.find((x) => x[0] === s);
    return e ? hit([fold(e[1], 55, 79)], 92, gateFuer(e[2])) : null;
  });
  wach[P_SYN] = !!lagen.syn;

  const synNr = SYN_NR[(song.idx - 1) % SYN_NR.length];
  const nrFuer = (idx) =>
    idx === P_DROP ? song.DROP
      : idx < 10 ? SAMPLES[idx]
      : idx === P_STAB || idx === P_ARP ? song.STAB
      : idx === P_VOX ? (song.VOX ?? song.DROP)
      : idx === P_MELOA ? song.MELOA
      : idx === P_MELOB ? song.MELOB
      : synNr;

  return steps.map((st, idx) => {
    const params = { voiceAssign: VOICE[idx] };
    if (idx <= 1) Object.assign(params, { ifxOn: 1, ifxType: 8, ifxEdit: 127 });
    if (idx === P_DROP || idx === P_VOX || idx === P_MELOA || idx === P_MELOB) params.ampEgOn = 0; // Loops laufen durch
    return {
      sampleId: bankNumberToE2PatternRef(nrFuer(idx)),
      steps: st,
      volume: VOLUME[idx],
      params,
      muted: !wach[idx],
    };
  });
}

/** TRANS (Mashup): VOX/DROP von Song A ueber MELO A/B von Song B (Alternate an), Bass folgt B. */
function transParts(a, b) {
  const parts = songParts(b, 4, "hart", { melo: 1 });
  parts[P_VOX] = {
    sampleId: bankNumberToE2PatternRef(a.VOX ?? a.DROP),
    steps: a.VOX
      ? baue((s) => (s === 0 ? hit([60], 120, 96) : null))
      : baue((s) => (imTakt(s) === 0 ? hit([60], 120, 96) : null)),
    volume: VOLUME[P_VOX],
    params: { voiceAssign: MONO1, ampEgOn: 0 },
    muted: false,
  };
  return parts;
}

// ─── Plan ─────────────────────────────────────────────────────────────────────

//            Name      Intens Kick    Wdh  Lagen
const BLOCK = [
  // Durchlauf 1 — Melo-zentriert
  ["INTRO",   1, "vier", 2, { melo: 1 }],
  ["AUF 1",   2, "vier", 2, { melo: 1 }],
  ["AUF 2",   3, "hart", 2, { melo: 1, arp: 1 }],
  ["ANLAUF",  4, "roll", 2, { syn: 1 }],
  ["DROP 1",  5, "hart", 2, { melo: 1, stab: 1 }],
  ["DROP 2",  5, "vier", 2, { drop: 1, stab: 1 }],
  ["DROP 3",  5, "hart", 2, { melo: 1, drop: 1 }],
  ["RUHE 1",  2, "vier", 2, { melo: 1 }],
  ["RUHE 2",  3, "vier", 2, { syn: 1, arp: 1 }],
  ["LUFT",   -1, "kein", 2, { melo: 1 }],
  ["DROP 4",  5, "hart", 2, { melo: 1, stab: 1, arp: 1 }],
  ["DROP 5",  5, "vier", 2, { drop: 1, stab: 1, arp: 1 }],
  ["AUSKL",   3, "vier", 2, { melo: 1 }],
  ["JAM SY",  2, "vier", 2, { syn: 1, arp: 1 }],
  ["JAM",     2, "vier", 2, { melo: 1, drop: 1, stab: 1, arp: 1 }],
  // Durchlauf 2 — Vocal-zentriert
  ["VOX IN",  1, "vier", 2, { vox: 1 }],
  ["VOX 1",   3, "hart", 2, { vox: 1, arp: 1 }],
  ["VOX 2",   4, "vier", 2, { vox: 1, melo: 1 }],
  ["BREAK",  -1, "kein", 2, { vox: 1 }],
  ["DRP2 1",  5, "hart", 2, { melo: 1, vox: 1, stab: 1 }],
  ["DRP2 2",  5, "roll", 2, { melo: 1, arp: 1 }],
  ["DRP2 3",  5, "hart", 2, { vox: 1, stab: 1, arp: 1 }],
  ["RUHE 3",  2, "vier", 2, { syn: 1 }],
  ["RUHE 4",  3, "vier", 2, { melo: 1, arp: 1 }],
  ["LUFT 2", -1, "kein", 2, { melo: 1, vox: 1 }],
  ["DRP2 4",  5, "hart", 2, { melo: 1, vox: 1, stab: 1, arp: 1 }],
  ["DRP2 5",  5, "vier", 2, { melo: 1, stab: 1, drop: 1 }],
  ["AUSKL2",  3, "vier", 2, { vox: 1 }],
  ["JAM VX",  2, "vier", 2, { vox: 1, arp: 1 }],
  ["JAM 2",   2, "vier", 2, { melo: 1, vox: 1, stab: 1, arp: 1 }],
];
if (BLOCK.length !== PRO_BLOCK) throw new Error(`Block hat ${BLOCK.length} statt ${PRO_BLOCK} Patterns`);

// Uebergaenge innerhalb der Bank (Indizes 1..8 relativ zur Bank)
const TRANS = [[1, 2], [3, 4], [5, 6], [7, 8], [8, 1], [2, 3], [4, 5], [6, 7], [1, 5], [3, 7]];

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
      parts: songParts(song, intens, kick, lagen),
      alternate13_14: true, // MELO A/B abwechselnd → 8-Takt-Loop
      alternate15_16: false,
      chainTo: letzte ? 0 : start + p + 2,
      chainRepeat: wdh, // gerade Wiederholungen → A und B kommen beide dran
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
    alternate13_14: true, // MELO A/B von Song B
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
  const evA = (s.events ?? []).filter((e) => e[0] < N).length;
  console.log(
    `  Block ${String(i + 1)}  Slots ${String(i * PRO_BLOCK + 1).padStart(3)}–${String((i + 1) * PRO_BLOCK).padStart(3)}  ${s.tag.padEnd(9)} ` +
    `${s.key.padEnd(6)} ${String(s.bpm).padStart(5)}→175${s.varispeed ? ` VS${s.shift >= 0 ? "+" : ""}${s.shift}` : ""}  ` +
    `${s.stems ? "Stem" : "Inst"}  ${s.VOX ? "VOX" : "—  "}  Melo-Events ${String((s.events ?? []).length).padStart(2)} (A: ${String(evA).padStart(2)}${evA < 6 ? ", Arp-Ersatz" : ""})  Stab ${OHNE_STAB.has(s.idx) ? "stumm" : "Ref " + stabRef(s)}  #${s.MELOA}–${s.STAB}`,
  );
}
console.log(`  Slots 241–250  TRANS ${TRANS.map(([a, b]) => `${songs[a - 1].idx}>${songs[b - 1].idx}`).join(" ")}`);

/**
 * make-folder-set.mjs — 250-Pattern-Bank (.e2sallpat) aus einer mit
 * prep-folder.py + make-folder-bank.mjs gebauten Sample-Bank.
 *
 * Idee: Jedes Thema = eine Melodie (Alternate-Paar 13/14) × eine Kick-Familie
 * × ein Vocal-Loop bzw. zweite Melodie (Alternate-Paar 15/16), dazu Snare/
 * Clap/Hats/Percs/Bass/Stab/Shots aus den Pools der Bank, rotierend, damit
 * ueber die Bank moeglichst alles einmal zu hoeren ist. Je Thema ein
 * gechainter Arrangement-Block (Intro → Aufbau → Drop → Ruhe → Drop 2 →
 * Ausklang → Jam; zweiter Durchlauf vocal-zentriert). Slots hinter den
 * Themen: KICK PARADE (16 verschiedene Kicks je Pattern, jeder Beat ein
 * anderer) und ALLES je Thema.
 *
 * Parts:  1 Kick A   2 Kick B (wechselt je Block-Position)   3 Snare
 *         4 Clap/Snare 2   5 Hat closed   6 Hat open/2   7 Perc/Ton   8 Perc 2
 *         9 Bass (Offbeat)  10 Stab (Poly, Ton/Phrase)  11 Shot A (Vox/FX)
 *        12 Shot B (FX/Riser-Loop)  13/14 Melo A/B  15/16 Vers A/B bzw. Melo2
 * Parts ohne Steps sind gemutet (Testpattern-Konvention).
 *
 * Konzept-JSON (optional): { "themes": [ { "tag": "H1", "melo": "1MEHeiko",
 *   "melo2": "1SPHeiko", "vers": "...", "kick": "<familie>", "stab": "..." } ] }
 * — Namen sind Praefixe von Sample-Namen bzw. Familien; Fehlendes wird
 * automatisch aufgefuellt.
 *
 * Aufruf: npx tsx scripts/make-folder-set.mjs <bank-json> <ziel.e2sallpat>
 *           --bpm 180 --prefix K3 [--konzept datei.json] [--themes 8] [--mfx 11]
 */
import * as fs from "node:fs";
import { buildE2AllPatFile } from "../src/core/e2sExport.ts";
import { bankNumberToE2PatternRef } from "../src/core/e2sPatternSampleLink.ts";

const ARG = (k, d) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1] : d);
const POS = process.argv.slice(2).filter((a, i, arr) => !a.startsWith("--") && !(arr[i - 1] ?? "").startsWith("--"));
const BANKJSON = POS[0];
const ZIEL = POS[1];
const bank = JSON.parse(fs.readFileSync(BANKJSON, "utf8"));
const BPM = Number(ARG("--bpm", bank.target_bpm ?? 180));
const PREFIX = ARG("--prefix", bank.prefix ?? "Xx");
const MFX = Number(ARG("--mfx", 11));
const KONZEPT = process.argv.includes("--konzept") ? JSON.parse(fs.readFileSync(ARG("--konzept"), "utf8")) : {};
const SLOTS = 250;
const N = 64;
const MONO1 = 0, POLY2 = 3;
const [P_K1, P_K2, P_SN, P_CL, P_HH, P_HH2, P_PC, P_PC2, P_BASS, P_STAB, P_SHA, P_SHB, P_MELA, P_MELB, P_VRA, P_VRB] =
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

// ─── Pools ────────────────────────────────────────────────────────────────────
/** tekk4-Drums (make-folder-bank --tekk-drums) bekommen ihre Rolle ueber den Namen. */
const TEKK_ROLLE = [
  ["HaimKind", "kick"], ["Jumpkick", "kick"], ["Bassdrum-01fd", "kick"], ["clydesna", "snare"], ["snarre-p", "snare"],
  ["closed 8", "hat"], ["707_hho", "hat"], ["ED Close", "hat"], ["ZaHnI_To", "ton"], ["Unison_Bass_C3", "bass"],
];
const samples = bank.samples.map((s) => {
  if (s.group === "tekk") {
    const t = TEKK_ROLLE.find(([p]) => s.name.trim().toLowerCase().startsWith(p.toLowerCase()));
    return { ...s, name: s.name.trim(), role: t?.[1] ?? "perc", family: "tekk", kind: "oneshot", bars: 0, seconds: s.seconds ?? 0.3 };
  }
  return s;
});
const byRole = (r, kind) => samples.filter((s) => s.role === r && (!kind || s.kind === kind));
const eigene = (list) => list.filter((s) => s.family !== "tekk");
const mitFallback = (list, fallback) => (eigene(list).length ? eigene(list) : list.length ? list : fallback);

const kicksAlle = byRole("kick");
const snares = mitFallback(byRole("snare"), byRole("perc"));
const claps = byRole("clap").length ? byRole("clap") : snares.slice(1).concat(snares.slice(0, 1));
const hatsSort = byRole("hat").slice().sort((a, b) => a.seconds - b.seconds);
const hatsClosed = hatsSort.filter((h) => h.seconds < 0.3).length ? hatsSort.filter((h) => h.seconds < 0.3) : hatsSort;
const hatsOpen = hatsSort.filter((h) => h.seconds >= 0.18).length ? hatsSort.filter((h) => h.seconds >= 0.18).reverse() : hatsSort;
const tonsShort = byRole("ton").filter((t) => t.seconds < 0.6);
const tonsLong = byRole("ton").filter((t) => t.seconds >= 0.6);
const percs = byRole("perc").concat(tonsShort, hatsSort.slice(2));
const phrasen = byRole("melo", "oneshot");
const stabs = (tonsLong.length ? tonsLong : []).concat(phrasen, tonsShort);
const basses = byRole("bass");
const fxShots = byRole("fx", "oneshot");
const fxLoops = byRole("fx", "loop");
const voxShots = byRole("vox", "oneshot");
const voxLoops = byRole("vox", "loop");
const meloLoops = byRole("melo", "loop");
if (!kicksAlle.length || !hatsSort.length) throw new Error("Bank ohne Kick oder Hat — make-folder-bank mit --tekk-drums bauen");

/** Loops zu Paaren [A, B] je Gruppe (Chunks einer Phrase); 4-Takt-Chunks bevorzugt. */
function paare(loops) {
  const gruppen = new Map();
  for (const l of loops) {
    const g = l.group ?? l.name;
    if (!gruppen.has(g)) gruppen.set(g, []);
    gruppen.get(g).push(l);
  }
  const out = [], rest = [];
  for (const [g, list] of gruppen) {
    const vier = list.filter((l) => l.bars === 4);
    const kurz = list.filter((l) => l.bars !== 4);
    if (vier.length >= 2) {
      for (let i = 0; i + 1 < vier.length; i += 2) out.push({ tag: g, a: vier[i], b: vier[i + 1] });
      if (vier.length % 2) out.push({ tag: g, a: vier[vier.length - 1], b: vier[vier.length - 1] });
      rest.push(...kurz);
    } else if (vier.length === 1) { out.push({ tag: g, a: vier[0], b: vier[0] }); rest.push(...kurz); }
    else out.push({ tag: g, a: list[0], b: list[0] }); // 2-/3-Takt-Loop auf beiden
  }
  return { paare: out, rest };
}
const { paare: meloPaare, rest: meloRest } = paare(meloLoops);
const { paare: voxPaare, rest: voxRest } = paare(voxLoops);
voxShots.push(...voxRest);   // 2-Takt-Vocal-Reste als Shots
stabs.push(...meloRest);     // kurze Melo-Reste als Phrasen-Stabs
/** Ohne Bass-Samples: Kick mit langem Schwanz (oder irgendeine Kick) eine Oktave tiefer = Kick-Bass. */
const bassFallback = kicksAlle.filter((k) => k.seconds >= 0.6).concat(kicksAlle);

/** Kick-Familien, groesste zuerst; Einzelgaenger werden zu einer Sammelfamilie. */
function kickFamilien() {
  const fam = new Map();
  for (const k of kicksAlle) {
    if (!fam.has(k.family)) fam.set(k.family, []);
    fam.get(k.family).push(k);
  }
  const gross = [...fam.entries()].filter(([, l]) => l.length >= 2).sort((a, b) => b[1].length - a[1].length);
  const einzel = [...fam.entries()].filter(([, l]) => l.length < 2).flatMap(([, l]) => l);
  const out = gross.map(([name, list]) => ({ name, kicks: list }));
  for (let i = 0; i < einzel.length; i += 3) out.push({ name: einzel[i].family, kicks: einzel.slice(i, i + 3) });
  // lauteste zuerst
  for (const f of out) f.kicks.sort((a, b) => (b.rms ?? -99) - (a.rms ?? -99));
  return out;
}
const familien = kickFamilien();

// ─── Themen ───────────────────────────────────────────────────────────────────
const such = (liste, praefix) =>
  praefix == null ? undefined : liste.find((s) => (s.tag ?? s.name ?? s.a?.name).toLowerCase().startsWith(String(praefix).toLowerCase()))
    ?? liste.find((s) => (s.a?.name ?? s.name ?? "").toLowerCase().startsWith(String(praefix).toLowerCase()));
const tagsVergeben = new Map();
const tagAus = (paar, i) => {
  const n = (paar?.a?.label ?? paar?.tag ?? paar?.a?.name ?? `T${i + 1}`).replace(/^(melo|vox|fx):/, "").replace(/^[^A-Za-z0-9#]+/, "");
  let tag = n.split(/\s+/)[0].slice(0, 4) || `T${i + 1}`;
  const n2 = (tagsVergeben.get(tag.toLowerCase()) ?? 0) + 1;
  tagsVergeben.set(tag.toLowerCase(), n2);
  if (n2 > 1) tag = tag.slice(0, 3) + n2;
  return tag;
};
const ANZ_THEMEN = Number(ARG("--themes", KONZEPT.themes?.length || Math.min(Math.max(meloPaare.length, 8), 12)));
const rot = (list, i) => (list.length ? list[i % list.length] : undefined);

const THEMEN = [];
for (let i = 0; i < ANZ_THEMEN; i++) {
  const k = KONZEPT.themes?.[i] ?? {};
  const melo = such(meloPaare, k.melo) ?? rot(meloPaare, i);
  const nMelo = Math.max(meloPaare.length, 1);
  const verschieden = (list, praefix, schritt) => such(list, praefix) ?? rot(list, i + Math.floor(i / nMelo) * schritt);
  const vers = voxPaare.length ? verschieden(voxPaare, k.vers, 1) : null;
  const melo2 = !voxPaare.length && meloPaare.length > ANZ_THEMEN
    ? such(meloPaare, k.melo2) ?? meloPaare[(i + ANZ_THEMEN) % meloPaare.length]
    : such(meloPaare, k.melo2) ?? null;
  const fam = familien.find((f) => k.kick && f.name.startsWith(String(k.kick).toLowerCase())) ?? rot(familien, i);
  const kicks = fam.kicks.length >= 2 ? fam.kicks : fam.kicks.concat(rot(familien, i + 1).kicks.slice(0, 2));
  THEMEN.push({
    idx: i,
    tag: k.tag ?? tagAus(melo, i),
    melo, melo2, vers,
    kicks,
    snare: such(snares, k.snare) ?? rot(snares, i),
    clap: rot(claps, i + 1),
    hh: rot(hatsClosed, i), hh2: rot(hatsOpen, i + 1),
    pc: rot(percs, i * 2), pc2: rot(percs, i * 2 + 1),
    bass: such(basses, k.bass) ?? rot(basses, i) ?? rot(bassFallback, i),
    stab: such(stabs, k.stab) ?? rot(stabs, i),
    shotA: voxShots.length ? rot(voxShots, i * 2) : rot(fxShots, i * 2),
    shotA2: voxShots.length > 1 ? rot(voxShots, i * 2 + 1) : rot(fxShots, i * 2 + 1),
    shotB: fxShots.length ? rot(fxShots, i) : rot(voxShots, i + 1),
    riser: rot(fxLoops, i),
  });
}

// ─── Bausteine ────────────────────────────────────────────────────────────────
const takt = (s) => Math.floor(s / 16);
const imTakt = (s) => s % 16;
const leer = () => Array.from({ length: N }, () => ({ active: false }));
const hit = (notes, velocity, gate) => ({ active: true, notes, velocity, gate });
const baue = (fn) => Array.from({ length: N }, (_, s) => fn(s) ?? { active: false });
/** Loop-Trigger nach Taktlaenge: 4 → Step 0, 2 → 0/32, 1 → jeder Takt, 3 → 0. */
const loopHit = (sample, vel = 127) => {
  const b = sample?.bars || 4;
  const alle = b === 1 ? 16 : b === 2 ? 32 : 64;
  return baue((s) => (s % alle === 0 ? hit([60], vel, 96) : null));
};

const KICK = {
  vier: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : null)),
  hart: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : imTakt(s) === 15 ? hit([60], 108, 14) : null)),
  roll: () => baue((s) => (s % 4 === 0 || (takt(s) === 3 && s % 2 === 0) ? hit([60], 112, 28) : null)),
  galopp: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : s % 8 === 6 ? hit([60], 100, 14) : null)),
};
const STAB_FIG = {
  ruhig: () => baue((s) => (imTakt(s) === 0 && takt(s) % 2 === 0 ? hit([60], 92, 40) : null)),
  stab: () => baue((s) => (imTakt(s) === 4 || imTakt(s) === 12 ? hit([takt(s) === 3 && imTakt(s) === 12 ? 67 : 60], 96, 14) : null)),
  arp: () => baue((s) => (s % 4 === 2 ? hit([[60, 67, 72, 67][takt(s)]], 88, 12) : null)),
  frage: () => baue((s) => (imTakt(s) === 0 ? hit([takt(s) % 2 ? 55 : 60], 94, 40) : imTakt(s) === 10 ? hit([60], 84, 14) : null)),
  phrase: () => baue((s) => (s === 0 || s === 32 ? hit([60], 100, 96) : null)),
};
const SHOT_FIG = {
  a: () => baue((s) => (s === 0 || s === 32 ? hit([60], 118, 96) : null)),
  a2: () => baue((s) => (s === 0 ? hit([60], 118, 96) : null)),
  b: () => baue((s) => (s === 24 || s === 56 ? hit([60], 112, 96) : null)),
  b2: () => baue((s) => (s === 60 ? hit([60], 112, 96) : null)),
};
const BASS_FIG = {
  off: () => baue((s) => (s % 4 === 2 ? hit([takt(s) === 3 && imTakt(s) >= 8 ? 67 : 60], 110, 12) : null)),
  roll: () => baue((s) => (takt(s) < 3 ? (s % 4 === 2 ? hit([60], 110, 12) : null) : s % 2 === 1 ? hit([60], 104, 8) : null)),
  acht: () => baue((s) => (s % 2 === 1 ? hit([imTakt(s) === 15 ? 55 : 60], 104, 8) : null)),
};

//            K1   K2   SN   CL   HH  HH2   PC  PC2  BASS STAB SHA  SHB  MELA MELB VRA  VRB
const VOLUME = [127, 104, 110, 96, 88, 82, 84, 80, 118, 100, 112, 108, 112, 112, 114, 114];

function parts(thema, intens, kickFigur, lagen, blockPos) {
  const i = intens;
  const steps = Array.from({ length: 16 }, leer);
  const wach = new Array(16).fill(false);
  const kick2 = thema.kicks[1 + (blockPos % Math.max(thema.kicks.length - 1, 1))] ?? thema.kicks[0];

  steps[P_K1] = KICK[kickFigur]();
  wach[P_K1] = true;
  steps[P_K2] = baue((s) => (imTakt(s) === 8 ? hit([60], 96, 22) : takt(s) === 3 && imTakt(s) === 14 ? hit([60], 100, 14) : null));
  wach[P_K2] = i >= 4;
  steps[P_SN] = baue((s) => {
    if (kickFigur === "roll" && takt(s) === 3) return hit([60], 100, 10);
    if (imTakt(s) === 4 || imTakt(s) === 12) return hit([60], 106, 28);
    return null;
  });
  wach[P_SN] = i >= 3 || kickFigur === "roll";
  steps[P_CL] = baue((s) => (imTakt(s) === 12 ? hit([60], 96, 22) : takt(s) === 1 && imTakt(s) === 14 ? hit([60], 84, 12) : null));
  wach[P_CL] = i >= 4;
  steps[P_HH] = baue((s) => (s % 4 === 2 ? hit([60], 82, 12) : null));
  wach[P_HH] = i >= 1;
  steps[P_HH2] = baue((s) => (s % 2 === 1 ? hit([60], takt(s) === 3 ? 78 : 70, 8) : null));
  wach[P_HH2] = i >= 3;
  steps[P_PC] = baue((s) => (s % 8 === 5 ? hit([60], 78, 13) : null));
  wach[P_PC] = i >= 4;
  steps[P_PC2] = baue((s) => (imTakt(s) === 14 && takt(s) % 2 === 1 ? hit([60], 84, 40) : imTakt(s) === 7 && takt(s) === 3 ? hit([60], 80, 10) : null));
  wach[P_PC2] = i >= 5;

  steps[P_BASS] = BASS_FIG[lagen.bass === "roll" ? "roll" : lagen.bass === "acht" ? "acht" : "off"]();
  wach[P_BASS] = !!lagen.bass && !!thema.bass;
  const stabS = stabs.length > ANZ_THEMEN ? rot(stabs, thema.idx + Math.floor(blockPos / 3) * ANZ_THEMEN) : thema.stab;
  const stabFig = stabS && (stabS.kind === "loop" || (stabS.kind === "oneshot" && stabS.seconds >= 2)) ? "phrase" : lagen.stab ?? "stab";
  steps[P_STAB] = STAB_FIG[stabFig]();
  wach[P_STAB] = !!lagen.stab && !!stabS;
  const shotA = voxShots.length > 2 * ANZ_THEMEN
    ? rot(voxShots, thema.idx * 2 + (lagen.shot === 3 ? 1 : 0) + Math.floor(blockPos / 2) * 2 * ANZ_THEMEN)
    : lagen.shot === 3 ? thema.shotA2 : thema.shotA;
  steps[P_SHA] = shotA?.kind === "loop" ? loopHit(shotA, 118) : SHOT_FIG[lagen.shot === 2 ? "a2" : "a"]();
  wach[P_SHA] = !!lagen.shot && !!shotA;
  const shotB = lagen.riser && thema.riser ? thema.riser : thema.shotB;
  steps[P_SHB] = lagen.riser && thema.riser ? loopHit(thema.riser, 110) : SHOT_FIG[lagen.shot === 2 ? "b2" : "b"]();
  wach[P_SHB] = (!!lagen.riser && !!thema.riser) || (lagen.shot === 1 && !!thema.shotB);
  steps[P_MELA] = loopHit(thema.melo?.a);
  steps[P_MELB] = loopHit(thema.melo?.b);
  wach[P_MELA] = wach[P_MELB] = !!lagen.melo && !!thema.melo;
  const zweite = thema.vers ?? thema.melo2;
  steps[P_VRA] = loopHit(zweite?.a);
  steps[P_VRB] = loopHit(zweite?.b);
  wach[P_VRA] = wach[P_VRB] = !!lagen.vers && !!zweite;

  // Percs/Tons und FX-Shots wandern je Block-Position durch die Pools, damit grosse Sammlungen ganz zu hoeren sind
  const pc = percs.length > 2 * ANZ_THEMEN ? rot(percs, thema.idx * 2 + blockPos * 2 * ANZ_THEMEN) : thema.pc;
  const pc2 = percs.length > 2 * ANZ_THEMEN ? rot(percs, thema.idx * 2 + 1 + blockPos * 2 * ANZ_THEMEN) : thema.pc2;
  const stab = stabs.length > ANZ_THEMEN ? rot(stabs, thema.idx + Math.floor(blockPos / 3) * ANZ_THEMEN) : thema.stab;
  const shotBx = !(lagen.riser && thema.riser) && fxShots.length > ANZ_THEMEN ? rot(fxShots, thema.idx + Math.floor(blockPos / 2) * ANZ_THEMEN) : shotB;
  const sampleFuer = [
    thema.kicks[0], kick2, thema.snare, thema.clap, thema.hh, thema.hh2, pc, pc2,
    thema.bass, stab, shotA, shotBx, thema.melo?.a, thema.melo?.b, zweite?.a, zweite?.b,
  ];
  return steps.map((st, idx) => {
    const smp = sampleFuer[idx];
    const params = { voiceAssign: idx === P_STAB ? POLY2 : MONO1 };
    if (idx <= P_K2) Object.assign(params, { ifxOn: 1, ifxType: 8, ifxEdit: 127 });
    if (smp?.kind === "loop" || (idx >= P_SHA && smp?.seconds >= 1)) params.ampEgOn = 0; // Loops/Phrasen laufen durch
    if (idx === P_BASS && smp?.role === "kick") params.oscPitch = -12;
    if (idx === P_HH2) Object.assign(params, { egDecay: 60 });
    if (!wach[idx]) return { sampleId: smp ? bankNumberToE2PatternRef(smp.nr) : 0, steps: leer(), volume: VOLUME[idx], params, muted: true };
    if (!smp) throw new Error(`Part ${idx + 1} ohne Sample`);
    return { sampleId: bankNumberToE2PatternRef(smp.nr), steps: st, volume: VOLUME[idx], params, muted: false };
  });
}

// ─── Arrangement-Block ────────────────────────────────────────────────────────
//             Name      Intens Kick      Prio  Lagen
const BLOCK_VOLL = [
  ["INTRO",   1, "vier",   1, { melo: 1 }],
  ["AUF 1",   2, "vier",   2, { melo: 1, bass: 1 }],
  ["AUF 2",   3, "hart",   1, { melo: 1, bass: 1, stab: "ruhig" }],
  ["ANLAUF",  4, "roll",   1, { bass: "roll", stab: "arp", shot: 2, riser: 1 }],
  ["DROP 1",  5, "hart",   1, { melo: 1, bass: 1, stab: "stab" }],
  ["DROP 2",  5, "vier",   2, { melo: 1, bass: 1, shot: 1 }],
  ["DROP 3",  5, "galopp", 1, { melo: 1, bass: 1, vers: 1 }],
  ["RUHE 1",  2, "vier",   2, { melo: 1, bass: 1 }],
  ["RUHE 2",  3, "vier",   3, { bass: 1, stab: "frage", shot: 2 }],
  ["FAHRT",   4, "vier",   2, { melo: 1, bass: "acht", shot: 2, riser: 1 }],
  ["DROP 4",  5, "hart",   1, { melo: 1, bass: 1, stab: "stab", shot: 1 }],
  ["DROP 5",  5, "vier",   2, { melo: 1, bass: "acht", vers: 1, stab: "arp" }],
  ["AUSKL",   3, "vier",   3, { melo: 1, bass: 1 }],
  ["JAM ST",  2, "vier",   3, { bass: 1, stab: "arp", shot: 1 }],
  ["JAM",     2, "vier",   2, { melo: 1, bass: 1, vers: 1, stab: "stab", shot: 1 }],
  ["VX IN",   1, "vier",   2, { vers: 1 }],
  ["VX 1",    3, "hart",   1, { vers: 1, bass: 1 }],
  ["VX 2",    4, "vier",   2, { vers: 1, bass: 1, melo: 1 }],
  ["VX 3",    4, "galopp", 3, { vers: 1, bass: "acht", stab: "arp", shot: 3 }],
  ["DRP2 1",  5, "hart",   1, { melo: 1, vers: 1, bass: 1, stab: "stab" }],
  ["DRP2 2",  5, "roll",   2, { melo: 1, bass: "roll", shot: 3 }],
  ["DRP2 3",  5, "hart",   2, { vers: 1, bass: 1, stab: "arp", shot: 2 }],
  ["RUHE 3",  2, "vier",   3, { bass: 1, stab: "ruhig", shot: 2 }],
  ["RUHE 4",  3, "vier",   3, { melo: 1, bass: 1, shot: 3, riser: 1 }],
  ["DRP2 6",  5, "roll",   2, { melo: 1, vers: 1, bass: "roll" }],
  ["DRP2 4",  5, "galopp", 1, { melo: 1, vers: 1, bass: 1, stab: "stab", shot: 1 }],
  ["DRP2 5",  5, "vier",   3, { melo: 1, bass: "acht", stab: "frage", shot: 3 }],
  ["AUSKL2",  3, "vier",   3, { vers: 1, bass: 1 }],
  ["JAM VX",  2, "vier",   3, { vers: 1, bass: 1, shot: 1 }],
  ["JAM 2",   2, "vier",   2, { melo: 1, vers: 1, bass: 1, stab: "stab", shot: 1 }],
];
const PRO_THEMA = Math.floor((SLOTS - 10) / ANZ_THEMEN);
function blockFuer(n) {
  if (n >= BLOCK_VOLL.length) return BLOCK_VOLL;
  const mitIdx = BLOCK_VOLL.map((b, i) => ({ b, i }));
  const gewaehlt = mitIdx.sort((x, y) => x.b[3] - y.b[3] || x.i - y.i).slice(0, n).sort((x, y) => x.i - y.i);
  return gewaehlt.map((x) => x.b);
}
const BLOCK = blockFuer(PRO_THEMA);

const pattern = (name, thema, intens, kick, lagen, blockPos, chainTo, wdh) => ({
  name: name.slice(0, 16),
  bpm: BPM,
  mfxType: MFX,
  stepLength: 64,
  parts: parts(thema, intens, kick, lagen, blockPos),
  alternate13_14: true,
  alternate15_16: true,
  chainTo,
  chainRepeat: wdh,
});

const patterns = [];
for (const thema of THEMEN) {
  const start = patterns.length;
  BLOCK.forEach(([name, intens, kick, , lagen], p) => {
    const letzte = p === BLOCK.length - 1;
    patterns.push(pattern(`${PREFIX} ${thema.tag} ${name}`, thema, intens, kick, lagen, p, letzte ? 0 : start + p + 2, 2));
  });
}

// ─── Rest: Kick-Parade + ALLES ────────────────────────────────────────────────
const hauptKicks = new Set(THEMEN.flatMap((t) => t.kicks.slice(0, 2).map((k) => k.nr)));
const restKicks = kicksAlle.filter((k) => !hauptKicks.has(k.nr));
const paradeKicks = restKicks.length >= 8 ? restKicks : kicksAlle;
function parade(nr, kicks, thema) {
  const teile = [];
  for (let idx = 0; idx < 16; idx++) {
    const k = kicks[idx % kicks.length];
    const bar = Math.floor(idx / 4), beat = idx % 4;
    const st = baue((s) => (takt(s) === bar && imTakt(s) === beat * 4 ? hit([60], 118, 40) : null));
    teile.push({ sampleId: bankNumberToE2PatternRef(k.nr), steps: st, volume: 120, params: { voiceAssign: MONO1, ifxOn: 1, ifxType: 8, ifxEdit: 127 }, muted: false });
  }
  return { name: `${PREFIX} KICKPARADE ${nr}`.slice(0, 16), bpm: BPM, mfxType: MFX, stepLength: 64, parts: teile, alternate13_14: false, alternate15_16: false, chainTo: 0, chainRepeat: 1 };
}
const rest = SLOTS - patterns.length;
const paraden = paradeKicks.length >= 8 ? Math.min(Math.ceil(paradeKicks.length / 16), Math.max(1, Math.floor(rest / 2)), 3) : 0;
for (let p = 0; p < paraden; p++) patterns.push(parade(p + 1, paradeKicks.slice(p * 16, p * 16 + 16).length >= 4 ? paradeKicks.slice(p * 16, p * 16 + 16) : paradeKicks.slice(0, 16), THEMEN[0]));
let t = 0;
while (patterns.length < SLOTS) {
  const thema = THEMEN[t % THEMEN.length];
  const vx = Math.floor(t / THEMEN.length) % 2 === 1;
  patterns.push(pattern(`${PREFIX} ${thema.tag} ${vx ? "ALLES VX" : "ALLES"}`, thema, 5, vx ? "galopp" : "hart",
    vx ? { vers: 1, bass: "acht", shot: 1, stab: "arp" } : { melo: 1, vers: 1, bass: 1, stab: "stab", shot: 1 }, t, 0, 2));
  t++;
}
if (patterns.length !== SLOTS) throw new Error(`${patterns.length} Patterns statt ${SLOTS}`);

const out = Buffer.from(buildE2AllPatFile(patterns));
fs.writeFileSync(ZIEL, out);
const nm = (s) => (s ? s.name : "—");
console.log(`${ZIEL} — ${out.length} Bytes · ${patterns.length} Patterns · ${BPM} BPM · ${ANZ_THEMEN} Themen × ${BLOCK.length} · ${paraden} Kick-Paraden (${paradeKicks.length} Kicks) · Bank ${BANKJSON}`);
console.log(`  Pools: ${kicksAlle.length} Kicks/${familien.length} Familien · ${snares.length} Snares · ${claps.length} Claps · ${hatsSort.length} Hats · ${percs.length} Percs · ${basses.length} Bass · ${stabs.length} Stabs · ${voxShots.length} Vox-Shots · ${fxShots.length}+${fxLoops.length} FX · ${meloPaare.length} Melo-Paare · ${voxPaare.length} Vox-Paare`);
THEMEN.forEach((th, i) => {
  const a = i * BLOCK.length + 1;
  console.log(`  ${th.tag.padEnd(4)} ${String(a).padStart(3)}–${String(a + BLOCK.length - 1).padStart(3)}  Melo ${nm(th.melo?.a)}/${nm(th.melo?.b)} · ${th.vers ? "Vers " + nm(th.vers.a) + "/" + nm(th.vers.b) : th.melo2 ? "Melo2 " + nm(th.melo2.a) + "/" + nm(th.melo2.b) : "—"} · Kick ${nm(th.kicks[0])} (+${th.kicks.length - 1}) · Sn ${nm(th.snare)} · Cl ${nm(th.clap)} · HH ${nm(th.hh)}/${nm(th.hh2)} · Bass ${nm(th.bass)} · Stab ${nm(th.stab)} · Shots ${nm(th.shotA)}, ${nm(th.shotB)}${th.riser ? " · Riser " + th.riser.name : ""}`);
});
console.log(`  ${ANZ_THEMEN * BLOCK.length + 1}–${SLOTS}: ${paraden} × KICKPARADE, dann ALLES / ALLES VX je Thema`);

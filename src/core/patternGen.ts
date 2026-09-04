/**
 * patternGen — Rezept → E2PatternInput[] (Figuren-Bibliothek aus
 * scripts/make-folder-set.mjs, ohne 250er-Ketten).
 *  Parts: 1 Kick A, 2 Kick B, 3 Snare, 4 Clap, 5 Hat closed, 6 Hat open, 7 Perc, 8 Perc 2,
 *         9 Bass, 10 Stab (Poly), 11 Shot A, 12 Shot B/Riser, 13/14 Melo, 15/16 Vers.
 *  Loops > 4 Takte: nur Part 13/15 triggert, 14/16 schweigt (Alternate laesst 8 Takte laufen).
 *  Parts ohne Steps sind gemutet.
 */
import type { E2PatternInput, E2PartInput, E2StepInput } from "./electribePatternBuilder";
import { buildE2AllPatFile, buildE2PatternFileV2 } from "./e2sExport";
import { bankNumberToE2PatternRef } from "./e2sPatternSampleLink";
import type { Projekt, ProjektSample } from "./bankPlan";
import { type Rezept, type Abschnitt, type Thema, type KickFigur, type BassFigur, type StabFigur, type Lage, pools } from "./rezept";
import { stabAusRaster, bassAnMelo } from "./meloRaster";
import { fillSchlaege } from "./patternVarianten";
import { variierePattern } from "./kettenVariation";
import { aufbauMotion, dropMotion } from "./motionGen";

const N = 64;
const MONO1 = 0;
const POLY2 = 3;
const takt = (s: number) => Math.floor(s / 16);
const imTakt = (s: number) => s % 16;
const leer = (): E2StepInput[] => Array.from({ length: N }, () => ({ active: false }));
const hit = (notes: number[], velocity: number, gate: number): E2StepInput => ({ active: true, notes, velocity, gate });
const baue = (fn: (s: number) => E2StepInput | null): E2StepInput[] => Array.from({ length: N }, (_, s) => fn(s) ?? { active: false });
/** Loop-Trigger nach Taktlaenge: 1 → jeder Takt, 2 → 0/32, >= 4 → einmal je Durchlauf. */
const loopHit = (takte: number, vel = 127): E2StepInput[] => {
  const alle = takte === 1 ? 16 : takte === 2 ? 32 : 64;
  return baue((s) => (s % alle === 0 ? hit([60], vel, 96) : null));
};

const KICK: Record<KickFigur, () => E2StepInput[]> = {
  vier: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : null)),
  hart: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : imTakt(s) === 15 ? hit([60], 108, 14) : null)),
  roll: () => baue((s) => (s % 4 === 0 || (takt(s) === 3 && s % 2 === 0) ? hit([60], 112, 28) : null)),
  galopp: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : s % 8 === 6 ? hit([60], 100, 14) : null)),
};
const STAB: Record<StabFigur | "phrase", () => E2StepInput[]> = {
  ruhig: () => baue((s) => (imTakt(s) === 0 && takt(s) % 2 === 0 ? hit([60], 92, 40) : null)),
  stab: () => baue((s) => (imTakt(s) === 4 || imTakt(s) === 12 ? hit([takt(s) === 3 && imTakt(s) === 12 ? 67 : 60], 96, 14) : null)),
  arp: () => baue((s) => (s % 4 === 2 ? hit([[60, 67, 72, 67][takt(s)]], 88, 12) : null)),
  frage: () => baue((s) => (imTakt(s) === 0 ? hit([takt(s) % 2 ? 55 : 60], 94, 40) : imTakt(s) === 10 ? hit([60], 84, 14) : null)),
  phrase: () => baue((s) => (s === 0 || s === 32 ? hit([60], 100, 96) : null)),
};
const BASS: Record<BassFigur, () => E2StepInput[]> = {
  off: () => baue((s) => (s % 4 === 2 ? hit([takt(s) === 3 && imTakt(s) >= 8 ? 67 : 60], 110, 12) : null)),
  roll: () => baue((s) => (takt(s) < 3 ? (s % 4 === 2 ? hit([60], 110, 12) : null) : s % 2 === 1 ? hit([60], 104, 8) : null)),
  acht: () => baue((s) => (s % 2 === 1 ? hit([imTakt(s) === 15 ? 55 : 60], 104, 8) : null)),
};
/**
 * Gibt der Kick einen eigenen vierten Takt.
 *
 * Nutzerbefund: "monoton von der Kick her". Nachgemessen stimmte das genau —
 * "vier", "hart" und "galopp" hatten ueber alle vier Takte GENAU EINE Zeile,
 * viermal hintereinander. Einzig "roll" wich im letzten Takt ab, und ausgerechnet
 * die hat der Nutzer nicht bemaengelt; sie ist hier das Vorbild.
 *
 * Der letzte Takt laesst die Zwoelf aus (die Luecke ist das, was man hoert) und
 * setzt eine Fuenfzehn als Auftakt in den naechsten Durchlauf. Bewusst NICHT
 * die Vierzehn: dort sitzen Kick 2 und Perc 2 schon mit ihrem Akzent, und beim
 * Nachrechnen tuermten sich dort sechs Lagen.
 *
 * Die Takte 1 bis 3 bleiben unangetastet — sie sind der Anker, an dem man den
 * Groove wiedererkennt.
 */
function kickMitViertemTakt(steps: E2StepInput[]): E2StepInput[] {
  const raus = steps.map((s) => ({ ...s }));
  const letzter = 3 * 16;
  raus[letzter + 12] = { active: false };
  const vorlage = steps.find((s) => s.active);
  raus[letzter + 15] = hit([60], Math.min(127, (vorlage?.velocity ?? 112) + 4), vorlage?.gate ?? 14);
  return raus;
}

const SHOT_A = () => baue((s) => (s === 0 || s === 32 ? hit([60], 118, 96) : null));
const SHOT_B = () => baue((s) => (s === 24 || s === 56 ? hit([60], 112, 96) : null));
/**
 * Part-Lautstaerken. Der Bass steht bewusst weit unten.
 *
 * Nutzerbefund am Geraet (2026-08-29): „Unison Bass muss mehr in den
 * Hintergrund, weil es sonst zu dominant ist." Nachgemessen war der
 * Bass-Sample mit -6,8 dB das LAUTESTE der ganzen Bank — rund 4 dB ueber den
 * Kicks — und stand mit 118 direkt hinter der Haupt-Kick. Ein gehaltener Ton
 * wirkt gegenueber Schlaegen ohnehin praesenter, als sein Effektivwert
 * vermuten laesst; deshalb 70 statt 118 (rund 4,5 dB zurueck). Im Drop hebt
 * `punch()` ihn weiterhin um 6 an.
 */
//            K1   K2   SN   CL   HH  HH2   PC  PC2  BASS STAB SHA  SHB  MELA MELB VRA  VRB
const VOLUME = [127, 104, 110, 96, 88, 82, 84, 80, 70, 100, 112, 108, 112, 112, 127, 127];

/**
 * Wie weit Melodie und Vocals im schlanken Satz zurueckgenommen werden.
 *
 * Nicht geraten, sondern am gerenderten Ergebnis gemessen: die Schleifen lagen
 * mit +3,8 dB ueber dem GESAMTEN Schlagzeug und klangen 87 % der Zeit. Damit
 * deckten sie genau die Luecken zu, die das Ausduennen der Drums geschaffen
 * hatte — in der Vollmischung war zwischen schlank und voll fast kein
 * Unterschied messbar (8,8 % gegen 8,6 % Ruhe), waehrend er auf der reinen
 * Schlagzeugspur deutlich war (65,5 % gegen 60,6 %).
 *
 * 0,78 sind rund 2,2 dB. Bewusst nicht mehr: die ganze Vocalspur soll hoerbar
 * bleiben, das war eine ausdrueckliche Vorgabe. Die Drums bleiben unangetastet,
 * es aendert sich nur das Verhaeltnis.
 */
const SCHLEIFEN_DAEMPFUNG = 0.78;

function parts(rezept: Rezept, projekt: Projekt, a: Abschnitt, pos: number, zweiteHaelfte: boolean, stepsImmer = false): E2PartInput[] {
  const pl = pools(projekt);
  const byName = (n?: string) => (n ? projekt.samples.find((s) => s.name === n) : undefined);
  const t: Thema = rezept.thema;
  const fam = pl.familien.find((f) => f.name === t.kickFamilie) ?? pl.familien[0];
  const famKicks = fam?.kicks ?? pl.kicks.slice(0, 1);
  const kicks = famKicks.length >= 2 ? famKicks : famKicks.concat(pl.kicks.filter((k) => !famKicks.includes(k)).slice(0, 2));
  const kick2 = kicks[1 + (pos % Math.max(kicks.length - 1, 1))] ?? kicks[0];
  const haelfte = (s?: ProjektSample) => {
    if (!s || !s.chunks) return s;
    const b = projekt.samples.find((x) => x.gruppe === s.gruppe && x.chunk === 1);
    return zweiteHaelfte && b ? b : s;
  };
  const melo = haelfte(byName(t.melo));
  // Vocal-Paar (4-Takt-Chunks A/B): A auf Part 15, B auf Part 16 — Alternate
  // spielt beide als durchgehende 8 Takte, einzeln entmuten geht am Geraet
  const versRoh = byName(t.vers);
  // Partner strukturell ueber gruppe+chunk (wie haelfte()) — Namens-Chirurgie
  // bricht, sobald eindeutig() bei Kollisionen umbenennt
  const versB = versRoh?.chunk === 0 && versRoh.takte === 4
    ? projekt.samples.find((x) => x.gruppe === versRoh.gruppe && x.chunk === 1)
    : undefined;
  const vers = versB ? versRoh : haelfte(versRoh);
  const stab = byName(t.stab);
  const bass = byName(t.bass);
  const shotA = byName(t.shots?.[0]);
  const riser = byName(t.riser);
  const riserAktiv = a.lagen.includes("riser") && !!riser;
  const shotB = riserAktiv ? riser : byName(t.shots?.[1]);
  const i = a.intensitaet;
  const hatsOff = rezept.figuren.hatsOffbeat;
  // Ohne Angabe schlank: der dichte Satz war der beanstandete.
  const schlank = rezept.figuren.dichte !== "voll";
  const lang = (s?: ProjektSample) => !!s && s.kind === "loop" && s.takte > 4;

  const steps: E2StepInput[][] = Array.from({ length: 16 }, leer);
  const wach = new Array<boolean>(16).fill(false);
  steps[0] = schlank ? kickMitViertemTakt(KICK[a.kick]()) : KICK[a.kick]();
  wach[0] = true;
  steps[1] = baue((s) => (imTakt(s) === 8 ? hit([60], 96, 22) : takt(s) === 3 && imTakt(s) === 14 ? hit([60], 100, 14) : null));
  wach[1] = i >= 4;
  steps[2] = baue((s) => (a.kick === "roll" && takt(s) === 3 ? hit([60], 100, 10) : imTakt(s) === 4 || imTakt(s) === 12 ? hit([60], 106, 28) : null));
  wach[2] = i >= 3 || a.kick === "roll";
  // Clap schlank nur in Takt 2 und 4: sonst liegt er in JEDEM Takt auf
  // demselben Step wie die Snare — ein doppelter Backbeat, der mehr nach
  // "anstrengend" klingt als jede Trefferzahl.
  const clapTakt = (s: number) => !schlank || takt(s) % 2 === 1;
  steps[3] = baue((s) => (imTakt(s) === 12 && clapTakt(s) ? hit([60], 96, 22) : takt(s) === 1 && imTakt(s) === 14 ? hit([60], 84, 12) : null));
  wach[3] = i >= 4;
  steps[4] = baue((s) => (s % 4 === (hatsOff ? 2 : 0) ? hit([60], 82, 12) : null));
  wach[4] = i >= 1;
  // Offene HiHat: voll rasselt sie auf JEDEM zweiten Step (32 Treffer in vier
  // Takten) — offene Hats klingen nach, das ist der ermuedendste Einzelposten
  // im ganzen Satz. Schlank bleibt ein Achtel-Akzent uebrig.
  steps[5] = baue((s) => ((schlank ? s % 8 === 7 : s % 2 === 1) ? hit([60], takt(s) === 3 ? 78 : 70, 8) : null));
  wach[5] = i >= 3;
  steps[6] = baue((s) => (s % 8 === 5 ? hit([60], 78, 13) : null));
  wach[6] = i >= 4;
  steps[7] = baue((s) => (imTakt(s) === 14 && takt(s) % 2 === 1 ? hit([60], 84, 40) : imTakt(s) === 7 && takt(s) === 3 ? hit([60], 80, 10) : null));
  wach[7] = i >= 5;
  // Melo-Raster: Bass weicht Melo-Bass aus, Stab-Hits sitzen auf den staerksten Melo-Onsets
  const raster = melo?.raster;
  steps[8] = raster ? bassAnMelo(BASS[rezept.figuren.bass](), raster) : BASS[rezept.figuren.bass]();
  wach[8] = a.lagen.includes("bass") && !!bass;
  const stabFig: StabFigur | "phrase" = stab && (stab.kind === "loop" || stab.sekunden >= 2) ? "phrase" : rezept.figuren.stab;
  steps[9] = raster && stabFig !== "phrase" ? stabAusRaster(raster) : STAB[stabFig]();
  wach[9] = a.lagen.includes("stab") && !!stab;
  steps[10] = shotA?.kind === "loop" ? loopHit(shotA.takte, 118) : SHOT_A();
  wach[10] = a.lagen.includes("shot") && !!shotA;
  steps[11] = shotB?.kind === "loop" ? loopHit(shotB.takte, 110) : SHOT_B();
  wach[11] = riserAktiv || (a.lagen.includes("shot") && !!shotB);
  steps[12] = melo ? loopHit(melo.takte) : leer();
  steps[13] = melo && !lang(melo) ? loopHit(melo.takte) : leer();
  wach[12] = a.lagen.includes("melo") && !!melo;
  wach[13] = wach[12] && !lang(melo);
  steps[14] = vers ? loopHit(vers.takte) : leer();
  steps[15] = versB ? loopHit(versB.takte) : vers && !lang(vers) ? loopHit(vers.takte) : leer();
  wach[14] = a.lagen.includes("vers") && !!vers;
  wach[15] = wach[14] && (versB ? true : !lang(vers));

  const pc = pl.percs.length ? pl.percs[(2 * pos) % pl.percs.length] : undefined;
  const pc2 = pl.percs.length ? pl.percs[(2 * pos + 1) % pl.percs.length] : undefined;
  const sample: (ProjektSample | undefined)[] = [
    kicks[0], kick2, byName(t.snare), byName(t.clap), byName(t.hats[0]), byName(t.hats[1]),
    byName(t.percs?.[0]) ?? pc, byName(t.percs?.[1]) ?? pc2, bass, stab, shotA, shotB, melo, melo, vers, versB ?? vers,
  ];
  return steps.map((st, idx) => {
    const smp = sample[idx];
    const params: Record<string, number> = { voiceAssign: idx === 9 ? POLY2 : MONO1 };
    if (idx <= 1) Object.assign(params, { ifxOn: 1, ifxType: 8, ifxEdit: 127 });
    if (smp?.kind === "loop" || (idx >= 10 && (smp?.sekunden ?? 0) >= 1)) params.ampEgOn = 0;
    if (idx === 8 && smp?.rolle === "kick") params.oscPitch = -12;
    if (idx === 5) params.egDecay = 60;
    const an = wach[idx] && !!smp;
    // stepsImmer: Steps auch bei gemuteten Parts setzen (Mute/Unmute-Spielweise am Geraet)
    return {
      sampleId: smp ? bankNumberToE2PatternRef(smp.nr) : 0,
      steps: an || (stepsImmer && smp) ? st : leer(),
      // Nur die MELODIE wird im schlanken Satz zurueckgenommen (12/13), nicht
      // die Vocals (14/15). Beide gleich zu daempfen war der Fehler: am Geraet
      // gehoert (2026-08-27) lagen die Vocals 9,1 dB unter dem Schlagzeug und
      // kamen erst durch, nachdem der Nutzer die Kick stummgeschaltet hatte.
      volume: idx >= 12 && idx <= 13 && schlank ? Math.round(VOLUME[idx] * SCHLEIFEN_DAEMPFUNG) : VOLUME[idx],
      params,
      muted: !an,
    };
  });
}

function tagAus(rezept: Rezept): string {
  const n = (rezept.thema.melo ?? "T").replace(/^[^A-Za-z0-9#]+/, "");
  return n.split(/\s+/)[0].slice(0, 4) || "T";
}

export function baueRezept(
  rezept: Rezept,
  projekt: Projekt,
  opts: { startSlot?: number; mfxType?: number } = {},
): { patterns: E2PatternInput[]; hinweise: string[] } {
  const start = opts.startSlot ?? 1;
  const hinweise: string[] = [];
  const tag = tagAus(rezept);
  const n = rezept.abschnitte.length;
  const patterns: E2PatternInput[] = rezept.abschnitte.map((a, i) => ({
    name: (rezept.modus === "miniset" ? `${tag} ${a.name}` : `${tag} JAM`).slice(0, 16),
    bpm: rezept.bpm,
    mfxType: opts.mfxType ?? 11,
    stepLength: 64 as const,
    parts: parts(rezept, projekt, a, i, n > 1 && i >= Math.ceil(n / 2)),
    alternate13_14: true,
    alternate15_16: true,
    chainTo: rezept.modus === "miniset" && i < n - 1 ? start + i + 1 : 0,
    chainRepeat: rezept.modus === "miniset" ? a.wiederholungen : 1,
  }));
  if (!rezept.thema.melo) hinweise.push("keine Melodie im Projekt — Pattern nur Drums/Bass/Shots");
  return { patterns, hinweise };
}

/** Stufen der Aufbau-Kette: welche Part-Indizes je Pattern dazukommen. Kicks (0/1) erst im Drop. */
const AUFBAU_STUFEN: number[][] = [
  [12, 13, 2], // Melo + Snare
  [4, 5], // Hats
  [3, 6, 7], // Clap + Percs
  [8, 9], // Bass + Stab
  [14, 15, 10, 11], // Vers + Shots/Riser
];

/**
 * Vocal-Paare (Chunk-A-Loops mit 4 Takten) in Liedreihenfolge — zusammen decken
 * sie die ganze Vocalspur ab. `meloName` filtert bei Multi-Select aufs eigene
 * Lied (gleicher Namensstamm); ohne Treffer zaehlen alle Paare.
 */
export function voxPaare(projekt: Projekt, meloName?: string): ProjektSample[] {
  const alle = projekt.samples
    .filter((s) => s.rolle === "vox" && s.kind === "loop" && s.chunk === 0 && s.takte === 4)
    .sort((a, b) => a.nr - b.nr);
  // Lied-Zuordnung strukturell (sample.lied), NIE ueber Namen mischen: bei
  // Multi-Select bekommt jedes Lied nur die eigenen Vocals — ein Lied ohne
  // eigene bleibt instrumental, statt fremde Verse zu singen
  const melo = meloName ? projekt.samples.find((s) => s.name === meloName) : undefined;
  if (melo?.lied && alle.some((s) => s.lied)) return alle.filter((s) => s.lied === melo.lied);
  // Ordner-Scans ohne Lied-Info: Namensstamm als Naeherung, sonst alle
  const stamm = meloName?.split(/\s+/)[0]?.toLowerCase();
  const eigene = stamm ? alle.filter((s) => s.name.toLowerCase().startsWith(stamm)) : [];
  return eigene.length ? eigene : alle;
}

/**
 * Pegel der ersten und der letzten Aufbau-Stufe, in Dezibel unter dem Drop.
 * Dazwischen wird gleichmaessig verteilt; der Drop laeuft voll.
 */
const AUFBAU_DB_VON = -7;
const AUFBAU_DB_BIS = -2;

/**
 * Aufbau-Kette (Mute/Unmute-Spielweise): alle Patterns tragen dieselben vollen
 * Steps des Drop-Abschnitts, entmutet wird stufenweise — Melo + Snare zuerst,
 * die Kicks erst im Drop. Damit der Drop kickt, laufen die Aufbau-Stufen mit
 * gedimmten Drum-Velocities, die letzte Stufe endet in einem Snare-Fill, und
 * der Drop bekommt Kicks auf 127 plus lauteren Bass. Die Vocal-Paare des Lieds
 * verteilen sich ueber die Kette (AUF → Paar 1, DROP → Paar 2, VRS-Patterns →
 * Rest), so dass ein Durchlauf die ganze Vocalspur spielt.
 */
export function baueAufbau(
  rezept: Rezept,
  projekt: Projekt,
  opts: {
    startSlot?: number;
    mfxType?: number;
    versAb?: number;
    versExtras?: boolean;
    /**
     * "duenn" laesst die erste Aufbau-Stufe nur jeden zweiten Schlagzeug-Schlag
     * spielen. Vorgabe ist "voll", denn ohne diese Option gilt die Zusage: alle
     * Stufen tragen dieselben Steps, nur die Mutes unterscheiden sich. Das ist
     * kein Zufall, sondern das Spielmodell — entmutet wird stufenweise, und die
     * Snare aus Stufe 1 soll dieselbe Figur sein, die bis in den Drop traegt.
     * Wer ausduennt, gibt das bewusst auf.
     */
    intro?: "duenn" | "voll";
    /** Ketten-Variation (Vorgabe an): jedes Pattern ausser dem Drop bekommt eine eigene Handschrift. */
    variation?: boolean;
    /** Motion-Sequenzen (Vorgabe an): Filter-Sweep ueber den Aufbau, MFX-Rampe und Kick-Fall im Drop. */
    motion?: boolean;
  } = {},
): { patterns: E2PatternInput[]; hinweise: string[] } {
  const start = opts.startSlot ?? 1;
  const hinweise: string[] = [];
  const tag = tagAus(rezept);
  const t = rezept.thema;
  const paare = voxPaare(projekt, t.melo ?? t.vers);
  // versAb: bei mehreren Ketten eines Lieds laufen die Paare ueber die Ketten
  // weiter (Kette 2 beginnt beim dritten Paar usw., Modulo wickelt um)
  const ab = opts.versAb ?? 0;
  const versFuer = (i: number) => (paare.length ? paare[(ab + i) % paare.length].name : t.vers);
  const lagen: Lage[] = (["melo", "vers", "bass", "stab", "shot"] as Lage[]).filter((l) =>
    l === "melo" ? !!t.melo : l === "vers" ? !!t.vers || paare.length > 0 : l === "bass" ? !!t.bass : l === "stab" ? !!t.stab : !!t.shots,
  );
  if (t.riser) lagen.push("riser");
  const kick = rezept.abschnitte.reduce((a, b) => (b.intensitaet > a.intensitaet ? b : a), rezept.abschnitte[0]).kick;
  const drop: Abschnitt = { name: "DROP", wiederholungen: 1, intensitaet: 5, kick, lagen };
  const partsFuer = (vers?: string) => parts({ ...rezept, thema: { ...t, vers } }, projekt, drop, 0, false, true);
  const dropParts = partsFuer(versFuer(0));
  const hoerbar = (idx: number) => !dropParts[idx].muted;
  const aktiv = new Set<number>();
  const stufen: Set<number>[] = [];
  for (const s of AUFBAU_STUFEN) {
    if (!s.some(hoerbar)) continue;
    for (const idx of s) aktiv.add(idx);
    stufen.push(new Set(aktiv));
  }
  const mitMutes = (basisParts: E2PartInput[], an: Set<number> | null): E2PartInput[] =>
    basisParts.map((p, idx) => ({ ...p, muted: p.muted || (an ? !an.has(idx) : false) }));
  /**
   * Der Aufbau wird STUFENWEISE lauter — alle Lagen zusammen, nicht nur die Drums.
   *
   * Vorher lag ueber den Drums ein fester Daempfer von 0,85, und die Melodie-
   * schleife lief von Stufe 1 an auf voller Lautstaerke. Gemessen wuchsen die
   * ersten Stufen dadurch um 0,08 / 0,26 / 0,57 dB — das hoert kein Mensch, und
   * der Drop kam aus dem Nichts statt aus einer Steigerung. Nutzerbefund dazu:
   * "nirgends kam der Drop und es hat gekickt".
   *
   * Jetzt liegt auf jeder Stufe ein Pegel, gleichmaessig in DEZIBEL verteilt
   * (nicht in Prozent — sonst schrumpfen die Schritte nach hinten). Erste Stufe
   * rund 7 dB unter dem Drop, letzte 2 dB darunter; der Drop selbst voll. Das
   * ergibt gleich grosse, hoerbare Schritte und einen Sprung am Ende.
   */
  const stufenPegel = (ps: E2PartInput[], stufe: number, anzahl: number): E2PartInput[] => {
    const anteil = anzahl > 1 ? stufe / (anzahl - 1) : 1;
    const db = AUFBAU_DB_VON + (AUFBAU_DB_BIS - AUFBAU_DB_VON) * anteil;
    const faktor = Math.pow(10, db / 20);
    return ps.map((p, idx) => ({ ...p, volume: Math.max(1, Math.round((p.volume ?? VOLUME[idx]) * faktor)) }));
  };
  // Snare-Fill im letzten Takt der letzten Aufbau-Stufe — der Uebergang in den
  // Drop. Die Schlaege kommen aus derselben Definition wie im Editor
  // (patternVarianten), damit eine Verbesserung nicht nur eine Haelfte trifft.
  const fill = (ps: E2PartInput[]): E2PartInput[] => {
    const schlaege = new Map(fillSchlaege(N).map((s) => [s.index, s]));
    return ps.map((p, idx) =>
      idx === 2
        ? {
            ...p,
            steps: p.steps.map((s, i) => {
              const schlag = schlaege.get(i);
              return schlag ? hit([60], schlag.velocity, schlag.gate) : s;
            }),
          }
        : p,
    );
  };
  // Drop-Punch: Kicks auf Maximum, Bass lauter
  const punch = (ps: E2PartInput[]): E2PartInput[] =>
    ps.map((p, idx) =>
      idx <= 1
        ? { ...p, steps: p.steps.map((s) => (s.active ? { ...s, velocity: 127 } : s)) }
        : idx === 8
          ? { ...p, volume: Math.min(127, (p.volume ?? VOLUME[8]) + 6) }
          : p,
    );
  /**
   * Jeden zweiten Schlag der Schlagzeug-/Bass-Parts weglassen. Gezaehlt werden
   * die TREFFER, nicht die Steps: so bleibt die Figur als Figur erkennbar,
   * egal auf welchem Raster sie sitzt. Parts 12–15 (Melo, Vocals) bleiben ganz
   * — Melodien werden nicht zerstueckelt.
   */
  const ausduennen = (ps: E2PartInput[]): E2PartInput[] =>
    ps.map((p, idx) => {
      if (idx > 11) return p;
      let nr = 0;
      const steps = p.steps.map((s) => (s.active ? (nr++ % 2 === 0 ? s : { active: false }) : s));
      return { ...p, steps, muted: p.muted || !steps.some((s) => s.active) };
    });
  const basis = { bpm: rezept.bpm, mfxType: opts.mfxType ?? 11, stepLength: 64 as const, alternate13_14: true, alternate15_16: true };
  const duennesIntro = opts.intro === "duenn";
  // Ketten-Variation: jedes Pattern ausser dem Drop bekommt eine eigene
  // Handschrift (Velocity-Streuung, Hat-Rotation, Ghost-Kick, Fill). Im
  // Aufbau VOR dem Snare-Fill, damit der Fill exakt die Editor-Definition
  // traegt; in den VRS-Patterns NACH dem Punch, damit die Kicks leben.
  const variiere = (ps: E2PartInput[], k: number): E2PartInput[] =>
    opts.variation === false ? ps : variierePattern({ ...basis, name: "", parts: ps }, k).parts;
  const patterns: E2PatternInput[] = stufen.map((an, i) => ({
    ...basis,
    name: `${tag} AUF${i + 1}`.slice(0, 16),
    parts: (i === stufen.length - 1 ? fill : i === 0 && duennesIntro ? ausduennen : (x: E2PartInput[]) => x)(
      variiere(stufenPegel(mitMutes(dropParts, an), i, stufen.length), i),
    ),
    // Filter-Sweep ueber die Melo-Parts: die Kette spielt einen durchgehenden Anstieg
    motionSlots: opts.motion === false ? undefined : aufbauMotion(i, stufen.length),
    chainTo: start + i + 1,
    // EINMAL je Stufe, nicht zweimal.
    //
    // Nutzerbefund (2026-08-27): einzeln klangen Sample, Vocal-Pattern und
    // Melodie-Pattern alle richtig, die ganze Kette aber "zu langsam". Es lag
    // nicht am Klang, sondern hieran: jedes Pattern lief zweimal, also
    // schritt das Lied halb so schnell voran wie im Original. Nebenbei zog
    // sich der Aufbau damit auf ueber vierzig Sekunden.
    chainRepeat: 1,
  }));
  const extras = opts.versExtras === false ? 0 : Math.max(0, paare.length - ab - 2);
  patterns.push({
    ...basis,
    name: `${tag} DROP`.slice(0, 16),
    parts: punch(mitMutes(partsFuer(versFuer(1)), null)),
    // Master-FX faehrt hoch, die Kick faellt im letzten halben Takt
    motionSlots: opts.motion === false ? undefined : dropMotion(),
    chainTo: extras ? start + patterns.length + 1 : 0,
    chainRepeat: 4,
  });
  // Rest der Vocalspur: je Paar ein Drop-Vollbild hinter dem Drop (nur an der
  // letzten Kette eines Lieds — versExtras: false laesst sie weg)
  for (let k = 0; k < extras; k++) {
    patterns.push({
      ...basis,
      name: `${tag} VRS${ab + k + 3}`.slice(0, 16),
      parts: variiere(punch(mitMutes(partsFuer(versFuer(2 + k)), null)), stufen.length + 1 + k),
      chainTo: k < extras - 1 ? start + patterns.length + 1 : 0,
      // Je Durchgang ein Vocal-Segment weiter — sonst dauert die Kette doppelt
      // so lang wie das Lied, das sie abdecken soll.
      chainRepeat: 1,
    });
  }
  if (!t.melo) hinweise.push("keine Melodie im Projekt — Aufbau nur ueber Drums/Bass/Shots");
  if (paare.length) hinweise.push(`Vocalspur in ${paare.length} Paaren ueber die Kette verteilt`);
  return { patterns, hinweise };
}

export function baueProMeloAufbau(rezepte: Rezept[], projekt: Projekt): { patterns: E2PatternInput[]; hinweise: string[] } {
  const out: E2PatternInput[] = [];
  const hinweise: string[] = [];
  // Die Vocal-Paare eines Lieds laufen ueber dessen Ketten weiter (Kette 1:
  // Paar 1+2, Kette 2: Paar 3+4 …); uebrige Paare haengen als VRS-Patterns an
  // der LETZTEN Kette des Lieds — so wird die Vocalspur genau einmal gespielt.
  const schluessel = rezepte.map((r) => voxPaare(projekt, r.thema.melo ?? r.thema.vers).map((p) => p.nr).join(","));
  const letzte = new Map<string, number>();
  schluessel.forEach((k, i) => letzte.set(k, i));
  const versAb = new Map<string, number>();
  rezepte.forEach((r, i) => {
    const k = schluessel[i];
    const ab = versAb.get(k) ?? 0;
    const res = baueAufbau(r, projekt, { startSlot: out.length + 1, versAb: ab, versExtras: letzte.get(k) === i });
    versAb.set(k, ab + 2);
    out.push(...res.patterns);
    hinweise.push(...res.hinweise);
  });
  return { patterns: out, hinweise };
}

export function baueProMelo(rezepte: Rezept[], projekt: Projekt): { patterns: E2PatternInput[]; hinweise: string[] } {
  const out: E2PatternInput[] = [];
  const hinweise: string[] = [];
  rezepte.forEach((r, i) => {
    const res = baueRezept(r, projekt, { startSlot: i + 1 });
    out.push(...res.patterns);
    hinweise.push(...res.hinweise);
  });
  return { patterns: out, hinweise };
}

const LEER: E2PatternInput = { name: "-", bpm: 120, stepLength: 16, parts: [] };

/**
 * 250-Slot-Bank: Patterns ab `startSlot` (1-basiert), Rest leere Init-Patterns.
 * Ketten, die ueber Slot 250 hinauszeigen, werden gekappt (chainTo 0) — sonst
 * klemmt der Export chainTo auf 250 und Slot 250 verkettet sich mit sich selbst
 * (Endlosschleife am Geraet).
 */
export function alsAllPat(patterns: E2PatternInput[], startSlot = 1): ArrayBuffer {
  const alle: E2PatternInput[] = Array.from({ length: 250 }, () => LEER);
  patterns.forEach((p, i) => {
    if (startSlot - 1 + i < 250) alle[startSlot - 1 + i] = p.chainTo && p.chainTo > 250 ? { ...p, chainTo: 0 } : p;
  });
  return buildE2AllPatFile(alle);
}

/** Einzelnes Pattern als .e2spat-Datei. */
export function alsPat(pattern: E2PatternInput): Uint8Array {
  return new Uint8Array(buildE2PatternFileV2(pattern));
}

/**
 * Erzeugt HARDTEKK_SET2.e2sallpat — das zweite Set: melodisch und euphorisch,
 * 172 BPM. Gleiche finale Sample-Belegung wie Set 1 (Melos C, Pad A,
 * Snare 001, die am Geraet gewaehlten Baesse), aber eine NEUE Komposition:
 *
 *   - Harmonik: Thema A = C–G–Am–F (die Hymnen-Folge), Thema B = F–G–Am–C
 *     als steigende Aufloesung. Dur-Anteile statt durchgehend Moll.
 *   - Die Melos tragen frueh (ab Intensitaet 2) und wechseln sich taktweise
 *     ab (Frage in geraden, Antwort in ungeraden Takten) statt alle
 *     gleichzeitig zu spielen.
 *   - Kick-Figuren: "vier", "tekk" (bei 172 mit Vorschlag) und "pump" —
 *     die Pumpe kommt dort aus der Offbeat-Clap, nicht aus der Kick.
 *   - Breaks mit Pad-Flaeche, Melo-Arpeggio und FX-Riser (Part 16 spielt
 *     hier wirklich — in Set 1 blieb er stumm).
 *   - Drei Boegen: AUFGANG → HYMNE, Mittelbreak → GIPFEL, letzter Break →
 *     FINALE. Wiederholungen maximal 2 (Lektion aus Set 1: 4x ist monoton).
 *
 * Konventionen wie immer: 64 Steps, Parts ohne Steps gemutet, Velocity je
 * Part und Pattern konstant — Dynamik durch Anwesenheit, nicht Anschlag.
 */
import * as fs from "node:fs";
import { buildE2AllPatFile } from "../src/core/e2sExport.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import {
  bankNumberToE2PatternRef,
  oscToDisplayNumber,
} from "../src/core/e2sPatternSampleLink.ts";

const BANK = process.argv[3] ?? "examples/e2s/HARDTEKK.all";
const ZIEL = process.argv[2] ?? "examples/e2s/HARDTEKK_SET2.e2sallpat";
const N = 64;
const BPM = Number(process.argv[4]) || 172;

const MONO1 = 0, MONO2 = 1, POLY2 = 3;

/** Voicings eng gefuehrt (G3..E4), damit die Melo-Loops nicht springen. */
const THEMA = {
  A: {
    akkorde: [[55, 60, 64], [55, 59, 62], [57, 60, 64], [53, 57, 60]], // C G Am F
    bass: [36, 31, 33, 29],
  },
  B: {
    akkorde: [[53, 57, 60], [55, 59, 62], [57, 60, 64], [60, 64, 67]], // F G Am C↑
    bass: [29, 31, 33, 36],
  },
};

// Finale Belegung aus Set 1 (am Geraet durchgehoert, 2026-08-15) — per Name
// gepinnt, damit Bank-Umbauten die Klaenge nicht stillschweigend verschieben.
const BELEGUNG_HARDTEKK = [
  ["Kick", "spetzial-kick10"], ["Kick", "Jumpkick 20"], ["Snare", "Snare 001"], ["Clap", 0],
  ["HiHat", 0], ["HiHat", 5], ["Perc.", 0], ["Perc.", 3],
  ["Analog", "Bassdrum-01fd"], ["Analog", "Unison_Bass_C3"], ["PCM", "T-Mello"], ["PCM", "Tau-MeLo"],
  ["PCM", "HBsChE PaRa"], ["PCM", "Auf CrystaL"], ["Phrase", "Padseq~1"], ["FX", 0],
];

// Belegung fuer die Nutzer-Bank tekk2.all — Details siehe make-hardtekk-set.mjs.
const BELEGUNG_TEKK = [
  ["Kick", "HaimKind"], ["Kick", "Jumpkick"], ["Snare", "clydesna"], ["Snare", "snarre-p"],
  ["HiHat", "closed 8"], ["HiHat", "707_hho"], ["Shots", "ED Close"], ["Shots", "ZaHnI_To"],
  ["Analog", "Unison_Bass_C3"], ["Analog", "Bassdrum-01fd"], ["PCM", "T-Mello"], ["PCM", "Tau-MeLo"],
  ["PCM", "HBsChE PaRa"], ["PCM", "Auf CrystaL"], ["Phrase", "Padseq~1"], ["FX", "TeRR5Rt"],
];

const BELEGUNG = /tekk2?\.all$/i.test(BANK) ? BELEGUNG_TEKK : BELEGUNG_HARDTEKK;
const VOLUME = [127, 108, 105, 92, 84, 88, 80, 78, 118, 104, 100, 95, 95, 92, 72, 88];
const VOICE = [MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1,
               MONO2, MONO2, POLY2, POLY2, POLY2, MONO1, POLY2, POLY2];

// ─── Dramaturgie: 50 Patterns ────────────────────────────────────────────────
// [Name, Intensität, Thema, Kick-Figur, Wiederholungen in der Kette]
// Wiederholungen maximal 2× — Dynamik aus dem Wechsel, nicht dem Stehenbleiben.
const PLAN = [
  ["AUFGANG 1",     0, "A", "vier", 2],
  ["AUFGANG 2",     1, "A", "vier", 2],
  ["AUFGANG 3",     2, "A", "vier", 2],
  ["ROLLE 1",       2, "A", "pump", 2],
  ["ROLLE 2",       3, "A", "pump", 2],
  ["STEIGUNG 1",    3, "A", "vier", 2],
  ["STEIGUNG 2",    4, "A", "pump", 2],
  ["STEIGUNG 3",    4, "A", "tekk", 1],
  ["HYMNE 1",       5, "A", "tekk", 2],
  ["HYMNE 2",       5, "A", "tekk", 2],
  ["HYMNE 3",       5, "A", "pump", 2],
  ["HYMNE 4",       5, "A", "tekk", 2],
  ["ATMEN 1",       3, "A", "vier", 2],
  ["ATMEN 2",       2, "A", "pump", 2],
  ["BREAK 1",      -1, "A", "kein", 2],
  ["BREAK 2",      -1, "B", "kein", 2],
  ["ANLAUF 1",      2, "B", "vier", 2],
  ["ANLAUF 2",      3, "B", "pump", 2],
  ["ANLAUF 3",      4, "B", "tekk", 1],
  ["HYMNE 5",       5, "B", "tekk", 2],
  ["HYMNE 6",       5, "B", "pump", 2],
  ["HYMNE 7",       5, "B", "tekk", 2],
  ["OFFEN 1",       4, "B", "pump", 2],
  ["OFFEN 2",       3, "B", "vier", 2],
  ["THEMA W 1",     3, "A", "vier", 2],
  ["THEMA W 2",     4, "A", "pump", 2],
  ["THEMA W 3",     4, "B", "pump", 2],
  ["MITTE BREAK 1",-1, "B", "kein", 2],
  ["MITTE BREAK 2",-1, "B", "kein", 2],
  ["MITTE BREAK 3",-1, "A", "kein", 2],
  ["AUFZUG 1",      1, "A", "vier", 2],
  ["AUFZUG 2",      2, "A", "pump", 2],
  ["AUFZUG 3",      3, "A", "pump", 2],
  ["AUFZUG 4",      4, "A", "tekk", 1],
  ["AUFZUG 5",      5, "A", "tekk", 1],
  ["GIPFEL 1",      5, "A", "tekk", 2],
  ["GIPFEL 2",      5, "A", "pump", 2],
  ["GIPFEL 3",      5, "A", "tekk", 2],
  ["GIPFEL 4",      5, "B", "tekk", 2],
  ["GIPFEL 5",      5, "B", "pump", 2],
  ["LICHTUNG 1",    3, "B", "vier", 2],
  ["LICHTUNG 2",    4, "B", "pump", 2],
  ["LETZTER BREAK",-1, "A", "kein", 2],
  ["FINALE 1",      4, "A", "tekk", 1],
  ["FINALE 2",      5, "A", "tekk", 2],
  ["FINALE 3",      5, "A", "pump", 2],
  ["FINALE 4",      5, "B", "tekk", 2],
  ["ABSTIEG 1",     3, "A", "vier", 2],
  ["ABSTIEG 2",     2, "A", "pump", 2],
  ["AUSKLANG",      0, "A", "vier", 2],
];

// ─── Bausteine ───────────────────────────────────────────────────────────────

const takt = (s) => Math.floor(s / 16);
const imTakt = (s) => s % 16;
const leer = () => Array.from({ length: N }, () => ({ active: false }));
const hit = (notes, velocity, gate) => ({ active: true, notes, velocity, gate });

function baue(fn) {
  return Array.from({ length: N }, (_, s) => fn(s) ?? { active: false });
}

/** Kick-Figuren. "pump" laesst die Kick gerade laufen — das Pumpen uebernimmt
 *  die Offbeat-Clap in partsFuer. */
const KICK = {
  kein: () => leer(),
  vier: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : null)),
  pump: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : null)),
  tekk: () =>
    baue((s) =>
      s % 4 === 0
        ? hit([60], 112, 40)
        : BPM < 175 && imTakt(s) === 7
          ? hit([60], 112, 22)
          : null,
    ),
};

function partsFuer(intensitaet, thema, kickFigur) {
  const t = THEMA[thema];
  const breakStelle = intensitaet < 0;
  const i = breakStelle ? 0 : intensitaet;

  const steps = Array.from({ length: 16 }, leer);

  if (!breakStelle) steps[0] = KICK[kickFigur]();
  if (i >= 5) steps[1] = baue((s) => (imTakt(s) === 8 ? hit([60], 96, 24) : null));
  if (i >= 3) steps[2] = baue((s) => (imTakt(s) === 4 || imTakt(s) === 12 ? hit([60], 108, 30) : null));
  // Clap: bei "pump" durchgehende Offbeats (das Pumpen), sonst Akzent auf 12.
  if (kickFigur === "pump" && i >= 2)
    steps[3] = baue((s) => (s % 4 === 2 ? hit([60], 92, 18) : null));
  else if (i >= 4) steps[3] = baue((s) => (imTakt(s) === 12 ? hit([60], 100, 26) : null));
  if (i >= 1) steps[4] = baue((s) => (s % 4 === 2 ? hit([60], 80, 14) : null));
  if (i >= 3)
    steps[5] = baue((s) =>
      imTakt(s) === 14 || (i >= 4 && imTakt(s) === 6) ? hit([60], 86, 40) : null,
    );
  if (i >= 4) steps[6] = baue((s) => (s % 8 === 5 ? hit([60], 78, 16) : null));
  if (i >= 5) steps[7] = baue((s) => (s % 8 === 7 ? hit([60], 72, 12) : null));
  // Bass: pumpende Offbeat-Achtel; im Drop ein 16tel-Anlauf auf die naechste Eins.
  if (i >= 2)
    steps[8] = baue((s) => {
      if (s % 4 === 2) return hit([t.bass[takt(s)]], 106, 22);
      if (i >= 5 && imTakt(s) === 15) return hit([t.bass[(takt(s) + 1) % 4]], 96, 12);
      return null;
    });
  if (i >= 4) steps[9] = baue((s) => (imTakt(s) === 0 ? hit([t.bass[takt(s)] - 12], 98, 60) : null));
  // Melo 1 + 2: Frage (gerade Takte) und Antwort (ungerade) — tragen frueh.
  if (i >= 2)
    steps[10] = baue((s) =>
      imTakt(s) === 0 && takt(s) % 2 === 0 ? hit(t.akkorde[takt(s)], 96, 96) : null,
    );
  if (i >= 3)
    steps[11] = baue((s) =>
      imTakt(s) === 0 && takt(s) % 2 === 1 ? hit(t.akkorde[takt(s)], 94, 96) : null,
    );
  if (i >= 4)
    steps[12] = baue((s) =>
      imTakt(s) === 8 || imTakt(s) === 10 ? hit(t.akkorde[takt(s)], 88, 16) : null,
    );
  if (i >= 5) steps[13] = baue((s) => (imTakt(s) === 12 ? hit(t.akkorde[takt(s)], 90, 20) : null));

  if (breakStelle) {
    // Break: Flaeche + Antwort-Melo als Bogen, Arpeggio, Pad und Riser.
    steps[10] = baue((s) => (imTakt(s) === 0 ? hit(t.akkorde[takt(s)], 88, 96) : null));
    steps[13] = baue((s) =>
      s % 4 === 0 ? hit([t.akkorde[takt(s)][(s / 4) % 3]], 76, 40) : null,
    );
    steps[14] = baue((s) => (imTakt(s) === 0 ? hit(t.akkorde[takt(s)], 74, 96) : null));
    steps[15] = baue((s) => (s === 0 ? hit([60], 84, 96) : null));
  } else if (i >= 4) {
    steps[14] = baue((s) => (imTakt(s) === 0 ? hit(t.akkorde[takt(s)], 70, 96) : null));
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

// Anzeige am Geraet = Nummernfeld (OSC_0index) + 1 — am Geraet gemessen
// (SLOTNUM2.all, 2026-08-15); oscToDisplayNumber uebersetzt in die Nummern,
// die Geraet und Set meinen.
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
console.log(`Bank: ${BANK.split(/[\/]/).pop()} — ${belegt.length} Samples · Set 2 (euphorisch, ${BPM} BPM)`);
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
    `  ${String(i + 1).padStart(2)} ${name.padEnd(13)} ${intens < 0 ? "Break" : "Int " + intens}` +
      ` · Thema ${thema} · Kick ${kick.padEnd(5)} · ${String(aktiv).padStart(2)} Parts` +
      ` · ${wdh}× → ${p.chainTo || "Ende"}`,
  );
}
console.log(`  Kette gesamt: ${takte} Takte ≈ ${Math.round((takte * 4 * 60) / BPM / 60)} Minuten`);

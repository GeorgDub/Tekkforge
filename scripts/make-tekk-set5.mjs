/**
 * Erzeugt TEKK_SET5.e2sallpat — "VOLLGAS": das schnellste und roheste Set
 * (192 BPM), gebaut fuer die Nutzer-Bank tekk.all. Richtung Syntekkz:
 * Dreier-Anlauf in die Eins, Offbeat-Bass ohne Pause, Sirene auf jeder
 * Drop-Eins, Breaks nur als einzelne Atemzuege (1x).
 *
 * Nutzerwunsch (2026-08-15): "keyboard" bleibt weg — hier stossen die
 * anderen Shots dazu: zweiter [ViNTeKk und Freddy L, ZaHnI_Ma als zweite
 * Perc. Zweite Hoerrunde: Bass lauter (Volume UND Velocity), und die
 * Melos laufen komplett durch — [ViNTeKk/Freddy L mit vollen Gates als
 * Frage/Antwort, Remember ab Intensitaet 4 als durchgehende Ebene;
 * killerme bleibt Break-exklusiv.
 *
 * Konventionen: 64 Steps, Parts ohne Steps gemutet, Velocity je Part und
 * Pattern konstant, Wiederholungen fast durchgehend 1x.
 */
import * as fs from "node:fs";
import { buildE2AllPatFile } from "../src/core/e2sExport.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import {
  bankNumberToE2PatternRef,
  oscToDisplayNumber,
} from "../src/core/e2sPatternSampleLink.ts";

const BANK = process.argv[3] ?? "examples/e2s/tekk.all";
const ZIEL = process.argv[2] ?? "examples/e2s/TEKK_SET5.e2sallpat";
const N = 64;
const BPM = Number(process.argv[4]) || 192;

const MONO1 = 0, MONO2 = 1, POLY2 = 3;

/** Phrygisch-minimal: fast nur Em, die Bewegung kommt aus dem Bass. */
const THEMA = {
  A: {
    akkorde: [[52, 55, 59], [53, 57, 60], [52, 55, 59], [50, 54, 57]], // Em F Em D
    bass: [28, 29, 28, 26],
  },
  B: {
    akkorde: [[52, 55, 59], [52, 55, 59], [48, 52, 55], [47, 51, 54]], // Em Em C H
    bass: [28, 28, 24, 23],
  },
};

// tekk.all-Belegung OHNE keyboard — Set 5 nimmt die haerteren Shots.
const BELEGUNG = [
  ["Kick", "HaimKind"], ["Kick", "Jumpkick"], ["Snare", "clydesna"], ["Snare", "snarre-p"],
  ["HiHat", "closed 8"], ["HiHat", "707_hho"], ["Shots", "ED Close"], ["Shots", "ZaHnI_Ma"],
  ["Analog", "Synth Le"], ["Analog", "Synth Le"], ["Shots", 1], ["Shots", "Freddy L"],
  ["Shots", "VEC2 Syn"], ["Shots", "Remember"], ["Loop", "killerme"], ["Shots", "Wuuuuup"],
];
// Hoerrunde 2026-08-15: Bass war zu leise — Part 9 auf Anschlag, Sub nach.
const VOLUME = [127, 110, 106, 96, 84, 88, 80, 78, 127, 112, 98, 96, 94, 96, 62, 96];
const VOICE = [MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1,
               MONO2, MONO2, POLY2, POLY2, POLY2, MONO1, POLY2, POLY2];

// ─── Dramaturgie: 50 Patterns ────────────────────────────────────────────────
// [Name, Intensität, Thema, Kick-Figur, Wiederholungen in der Kette]
const PLAN = [
  ["ZUENDUNG 1",   0, "A", "vier", 2],
  ["ZUENDUNG 2",   1, "A", "vier", 2],
  ["ZUENDUNG 3",   2, "A", "hart", 1],
  ["GANG 1",       3, "A", "vier", 2],
  ["GANG 2",       3, "A", "hart", 1],
  ["GANG 3",       4, "A", "drei", 1],
  ["NADEL 1",      4, "A", "roll", 1],
  ["VOLLGAS 1",    5, "A", "hart", 2],
  ["VOLLGAS 2",    5, "A", "drei", 2],
  ["VOLLGAS 3",    5, "A", "hart", 1],
  ["VOLLGAS 4",    5, "A", "drei", 1],
  ["KETTE 1",      4, "A", "hart", 2],
  ["KETTE 2",      3, "A", "vier", 2],
  ["ATEM 1",      -1, "A", "kein", 1],
  ["ANRISS 1",     3, "B", "hart", 1],
  ["ANRISS 2",     4, "B", "drei", 1],
  ["NADEL 2",      5, "B", "roll", 1],
  ["VOLLGAS 5",    5, "B", "hart", 2],
  ["VOLLGAS 6",    5, "B", "drei", 2],
  ["VOLLGAS 7",    5, "B", "hart", 1],
  ["VOLLGAS 8",    5, "B", "drei", 2],
  ["KETTE 3",      4, "B", "hart", 2],
  ["KETTE 4",      3, "B", "vier", 2],
  ["KETTE 5",      4, "A", "hart", 1],
  ["NADEL 3",      5, "A", "roll", 1],
  ["VOLLGAS 9",    5, "A", "drei", 2],
  ["VOLLGAS 10",   5, "A", "hart", 2],
  ["VOLLGAS 11",   5, "B", "drei", 2],
  ["ATEM 2",      -1, "B", "kein", 1],
  ["ANRISS 3",     4, "B", "hart", 1],
  ["NADEL 4",      5, "B", "roll", 1],
  ["SCHLEUDER 1",  5, "B", "drei", 2],
  ["SCHLEUDER 2",  5, "B", "hart", 2],
  ["SCHLEUDER 3",  5, "A", "drei", 2],
  ["SCHLEUDER 4",  5, "A", "hart", 2],
  ["KETTE 6",      4, "A", "vier", 2],
  ["KETTE 7",      4, "A", "hart", 2],
  ["ATEM 3",      -1, "A", "kein", 1],
  ["ANRISS 4",     4, "A", "drei", 1],
  ["NADEL 5",      5, "A", "roll", 1],
  ["ENDLAUF 1",    5, "A", "hart", 2],
  ["ENDLAUF 2",    5, "A", "drei", 2],
  ["ENDLAUF 3",    5, "B", "hart", 2],
  ["ENDLAUF 4",    5, "B", "drei", 2],
  ["ENDLAUF 5",    5, "A", "hart", 1],
  ["AUSROLLEN 1",  4, "A", "vier", 2],
  ["AUSROLLEN 2",  3, "A", "vier", 2],
  ["AUSROLLEN 3",  2, "A", "hart", 1],
  ["AUSROLLEN 4",  1, "A", "vier", 2],
  ["STILLSTAND",   0, "A", "vier", 2],
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
  // Hart: 16tel-Doppelschlag vor jeder Takt-Eins.
  hart: () =>
    baue((s) =>
      s % 4 === 0 ? hit([60], 112, 40) : imTakt(s) === 15 ? hit([60], 108, 14) : null,
    ),
  // Drei: Dreier-Anlauf (13/14/15) in die naechste Eins — das Syntekkz-Brett.
  drei: () =>
    baue((s) =>
      s % 4 === 0 ? hit([60], 112, 40) : imTakt(s) >= 13 ? hit([60], 106, 10) : null,
    ),
  // Rollend: Achtel im letzten Takt (Snare-Build dazu, s.u.).
  roll: () =>
    baue((s) => (s % 4 === 0 || (takt(s) === 3 && s % 2 === 0) ? hit([60], 112, 28) : null)),
};

function partsFuer(intensitaet, thema, kickFigur) {
  const t = THEMA[thema];
  const breakStelle = intensitaet < 0;
  const i = breakStelle ? 0 : intensitaet;

  const steps = Array.from({ length: 16 }, leer);

  if (!breakStelle) steps[0] = KICK[kickFigur]();
  if (i >= 5) steps[1] = baue((s) => (imTakt(s) === 8 ? hit([60], 98, 22) : null));
  if (i >= 3 || kickFigur === "roll")
    steps[2] = baue((s) => {
      if (kickFigur === "roll" && takt(s) === 3) return hit([60], 104, 9);
      if (i >= 3 && (imTakt(s) === 4 || imTakt(s) === 12)) return hit([60], 108, 28);
      return null;
    });
  if (i >= 4) steps[3] = baue((s) => (imTakt(s) === 12 ? hit([60], 100, 22) : null));
  if (i >= 1)
    steps[4] = baue((s) => {
      if (s % 4 === 2) return hit([60], 82, 11);
      if (i >= 5 && takt(s) === 3 && s % 2 === 1) return hit([60], 76, 8);
      return null;
    });
  if (i >= 3)
    steps[5] = baue((s) =>
      imTakt(s) === 14 || (i >= 4 && imTakt(s) === 6) ? hit([60], 88, 32) : null,
    );
  if (i >= 4) steps[6] = baue((s) => (s % 8 === 5 ? hit([60], 78, 13) : null));
  if (i >= 5) steps[7] = baue((s) => (s % 8 === 7 ? hit([60], 72, 11) : null));
  // Bass ohne Pause: Offbeats, ab 4 Pickups, im Drop tiefer.
  // Hoerrunde 2026-08-15: Velocities hoch — der Bass soll vorne stehen.
  if (i >= 2) {
    const tief = i >= 5 ? -12 : 0;
    steps[8] = baue((s) => {
      if (s % 4 === 2) return hit([t.bass[takt(s)] + tief], 118, 16);
      if (i >= 4 && imTakt(s) === 7) return hit([t.bass[takt(s)] + tief], 108, 9);
      if (i >= 4 && imTakt(s) === 15) return hit([t.bass[(takt(s) + 1) % 4] + tief], 108, 9);
      return null;
    });
  }
  if (i >= 4) steps[9] = baue((s) => (imTakt(s) === 0 ? hit([t.bass[takt(s)] - 12], 104, 52) : null));
  // Melos laufen KOMPLETT durch, aber EINSTIMMIG (Hoerrunde 2, 2026-08-15):
  // als Dreiklang gespielte Shots stapeln drei transponierte Kopien
  // uebereinander — das war das "Kratzige". Grundton reicht, volle Gates,
  // Frage auf der Eins, Antwort auf der Drei, Velocities zurueckgenommen.
  if (i >= 3) steps[10] = baue((s) => (imTakt(s) === 0 ? hit([t.akkorde[takt(s)][0]], 88, 96) : null));
  if (i >= 4) steps[11] = baue((s) => (imTakt(s) === 8 ? hit([t.akkorde[takt(s)][0]], 86, 96) : null));
  // Sirene nur noch jeden zweiten Takt — jede Eins war zu viel.
  if (i >= 5)
    steps[12] = baue((s) =>
      imTakt(s) === 0 && takt(s) % 2 === 0 ? hit([t.akkorde[takt(s)][0]], 84, 16) : null,
    );
  // Remember laeuft ab Intensitaet 4 als durchgehende Melodie-Ebene mit.
  if (i >= 4) steps[13] = baue((s) => (imTakt(s) === 0 ? hit([t.akkorde[takt(s)][0]], 84, 96) : null));
  if (i >= 5) steps[15] = baue((s) => (s === 0 ? hit([60], 94, 32) : null));

  if (breakStelle) {
    steps[12] = baue((s) => (imTakt(s) === 0 ? hit(t.akkorde[takt(s)], 84, 96) : null));
    steps[13] = baue((s) => (s === 0 ? hit(t.akkorde[0], 78, 96) : null));
    steps[14] = baue((s) =>
      imTakt(s) === 0 ? hit(t.akkorde[takt(s)].map((n) => n - 12), 60, 96) : null,
    );
    steps[15] = baue((s) => (s === 0 ? hit([60], 90, 96) : null));
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
console.log(`Bank: ${BANK.split(/[\/]/).pop()} — ${belegt.length} Samples · Set 5 VOLLGAS (${BPM} BPM)`);
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

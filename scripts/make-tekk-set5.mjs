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

const BANK = process.argv[3] ?? "examples/e2s/tekk2.all";
const ZIEL = process.argv[2] ?? "examples/e2s/TEKK_SET5.e2sallpat";
const N = 64;
const BPM = Number(process.argv[4]) || 192;

const MONO1 = 0, MONO2 = 1, POLY2 = 3;

/**
 * Phrygisch-minimal: fast nur Em, die Bewegung kommt aus dem Bass.
 *
 * Hoerrunde 4 (2026-08-15): eine Oktave HOEHER als zuerst gebaut. Die
 * tekk.all-Samples (Synth Le, Shots) liefen bis zu drei Oktaven unter der
 * Originaltonhoehe (Note 60) — so tief gepitcht wird jedes Sample koernig,
 * DAS war das verbliebene Kratzen. Melo-Grundtoene liegen jetzt nahe 60,
 * der Bass eine Oktave darunter.
 */
const THEMA = {
  A: {
    akkorde: [[64, 67, 71], [65, 69, 72], [64, 67, 71], [62, 66, 69]], // Em F Em D
    // Hoerrunde 7: mit echtem Bass (Unison_Bass_C3 aus tekk2) darf der Bass
    // wieder in die Basslage — die HARDTEKK-Sets spielten ihn dort sauber.
    bass: [28, 29, 28, 26],
  },
  B: {
    akkorde: [[64, 67, 71], [64, 67, 71], [60, 64, 67], [59, 63, 66]], // Em Em C H
    bass: [28, 28, 24, 23],
  },
};

// tekk2.all-Belegung (Hoerrunde 7): Drums bleiben die handverlesenen
// tekk-Samples, aber Bass und Melos kommen aus dem am Geraet fuer gut
// befundenen HARDTEKK-Material — das Kratzen sass im Rohmaterial (Synth Le
// war ein Lead, kein Bass). Keyboard bleibt weiterhin draussen.
const BELEGUNG = [
  ["Kick", "HaimKind"], ["Kick", "Jumpkick"], ["Snare", "clydesna"], ["Snare", "snarre-p"],
  ["HiHat", "closed 8"], ["HiHat", "707_hho"], ["Shots", "ED Close"], ["Shots", "ZaHnI_Ma"],
  ["Analog", "Unison_Bass_C3"], ["Analog", "Bassdrum-01fd"], ["PCM", "T-Mello"], ["PCM", "Tau-MeLo"],
  ["PCM", "HBsChE PaRa"], ["PCM", "Auf CrystaL"], ["Phrase", "Padseq~1"], ["FX", "TeRR5Rt"],
];

/**
 * Melo-Saetze fuer die JAM-Patterns (Parts 11–14): dort sind keine Steps
 * programmiert, die Parts sind UNGEMUTET — man zockt sie selbst ueber die
 * Pads (Trigger-Modus am Geraet). Jeder Jam traegt einen anderen Satz;
 * die rauen tekk-Shots leben im Jam D weiter.
 */
const JAM_SETS = {
  A: [["PCM", "T-Mello"], ["PCM", "Tau-MeLo"], ["PCM", "HBsChE PaRa"], ["PCM", "Auf CrystaL"]],
  B: [["PCM", "HaMMeR"], ["PCM", "Genetikk"], ["PCM", "PsyChoTanZ"], ["PCM", "Krieger"]],
  C: [["PCM", "melo neu 2"], ["PCM", "SYNTHHS3"], ["PCM", "Wfg90"], ["Shots", "VEC2 Syn"]],
  D: [["Shots", 0], ["Shots", "Freddy L"], ["Shots", "Sound7-M"], ["Shots", "Remember"]],
};
// Hoerrunde 6: Bass von Anschlag (127) auf 116 — zusammen mit der Kick
// uebersteuerte die Summe hoerbar ("kratzen"). Part 10 traegt keine Steps
// mehr (Kammfilter-Doppelung, s. partsFuer) und ist nur noch Jam-Reserve.
const VOLUME = [127, 110, 106, 96, 84, 88, 80, 78, 116, 100, 98, 96, 94, 96, 62, 96];
const VOICE = [MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1,
               MONO2, MONO2, POLY2, POLY2, POLY2, MONO1, POLY2, POLY2];

// ─── Dramaturgie: 50 Patterns ────────────────────────────────────────────────
// [Name, Intensität, Thema, Kick-Figur, Wiederholungen in der Kette]
// [Name, Intensität, Thema, Kick-Figur, Wiederholungen, Jam-Satz?]
// Ein Jam-Satz beendet die Kette (Pattern loopt): Fundament laeuft, die
// Melo-Parts sind frei zum Selberspielen. Weiter geht es erst, wenn man am
// Geraet das naechste Pattern anwaehlt — fuenf gekettete Segmente, jedes
// muendet in einen Jam mit anderem Melo-Satz.
const PLAN = [
  // Segment 1 → JAM A
  ["ZUENDUNG 1",   0, "A", "vier", 2],
  ["ZUENDUNG 2",   1, "A", "vier", 2],
  ["GANG 1",       2, "A", "vier", 2],
  ["GANG 2",       3, "A", "hart", 1],
  ["NADEL 1",      4, "A", "roll", 1],
  ["VOLLGAS 1",    5, "A", "hart", 2],
  ["VOLLGAS 2",    5, "A", "drei", 2],
  ["VOLLGAS 3",    5, "A", "hart", 1],
  ["KETTE 1",      4, "A", "vier", 2],
  ["JAM A",        2, "A", "vier", 1, "A"],
  // Segment 2 → JAM B
  ["ANRISS 1",     2, "B", "hart", 1],
  ["ANRISS 2",     3, "B", "drei", 1],
  ["NADEL 2",      4, "B", "roll", 1],
  ["VOLLGAS 4",    5, "B", "hart", 2],
  ["VOLLGAS 5",    5, "B", "drei", 2],
  ["VOLLGAS 6",    5, "B", "hart", 1],
  ["KETTE 2",      4, "B", "vier", 2],
  ["KETTE 3",      3, "B", "hart", 1],
  ["ATEM 1",      -1, "B", "kein", 1],
  ["JAM B",        2, "B", "vier", 1, "B"],
  // Segment 3 → JAM C
  ["DRUCK 1",      3, "A", "hart", 1],
  ["DRUCK 2",      4, "A", "drei", 1],
  ["NADEL 3",      5, "A", "roll", 1],
  ["VOLLGAS 7",    5, "A", "drei", 2],
  ["VOLLGAS 8",    5, "A", "hart", 2],
  ["VOLLGAS 9",    5, "B", "drei", 1],
  ["KETTE 4",      4, "A", "vier", 2],
  ["KETTE 5",      3, "A", "hart", 1],
  ["ATEM 2",      -1, "A", "kein", 1],
  ["JAM C",        2, "A", "vier", 1, "C"],
  // Segment 4 → JAM D
  ["ANRISS 3",     3, "B", "hart", 1],
  ["NADEL 4",      4, "B", "roll", 1],
  ["VOLLGAS 10",   5, "B", "hart", 2],
  ["VOLLGAS 11",   5, "B", "drei", 2],
  ["VOLLGAS 12",   5, "B", "hart", 1],
  ["SCHLEUDER 1",  5, "B", "drei", 2],
  ["SCHLEUDER 2",  5, "A", "hart", 2],
  ["KETTE 6",      4, "B", "vier", 2],
  ["ATEM 3",      -1, "B", "kein", 1],
  ["JAM D",        2, "B", "vier", 1, "D"],
  // Segment 5 → Finale + freier Jam
  ["ENDLAUF 1",    4, "A", "hart", 1],
  ["NADEL 5",      5, "A", "roll", 1],
  ["ENDLAUF 2",    5, "A", "drei", 2],
  ["ENDLAUF 3",    5, "A", "hart", 2],
  ["ENDLAUF 4",    5, "B", "drei", 2],
  ["ABKUEHLUNG 1", 3, "A", "vier", 2],
  ["ABKUEHLUNG 2", 2, "A", "vier", 2],
  ["AUSKLANG",     1, "A", "vier", 2],
  ["STILLSTAND",   0, "A", "vier", 1],
  ["JAM FREI",     2, "A", "vier", 1, "A"],
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
  // Drei: Anlauf in die naechste Eins. Hoerrunde 5: nur noch Doppel (14/15)
  // statt Dreier — drei 16tel hintereinander verschmierten zum Kratzen.
  drei: () =>
    baue((s) =>
      s % 4 === 0 ? hit([60], 112, 40) : imTakt(s) >= 14 ? hit([60], 106, 10) : null,
    ),
  // Rollend: Achtel im letzten Takt (Snare-Build dazu, s.u.).
  roll: () =>
    baue((s) => (s % 4 === 0 || (takt(s) === 3 && s % 2 === 0) ? hit([60], 112, 28) : null)),
};

/**
 * @param jamMelos Anzeigenummern fuer die Parts 11–14 in einem JAM-Pattern —
 *   dort bleiben diese Parts ohne Steps, aber UNGEMUTET (selbst zocken).
 */
function partsFuer(intensitaet, thema, kickFigur, jamMelos) {
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
  // Hoerrunde 5: die 16tel-Hats im Drop-Endtakt raus — zu viel Reibung.
  if (i >= 1) steps[4] = baue((s) => (s % 4 === 2 ? hit([60], 82, 11) : null));
  if (i >= 3)
    steps[5] = baue((s) =>
      imTakt(s) === 14 || (i >= 4 && imTakt(s) === 6) ? hit([60], 88, 32) : null,
    );
  if (i >= 4) steps[6] = baue((s) => (s % 8 === 5 ? hit([60], 78, 13) : null));
  if (i >= 5) steps[7] = baue((s) => (s % 8 === 7 ? hit([60], 72, 11) : null));
  // Bass ohne Pause: Offbeats, ab 4 Pickups. Kein Oktav-Drop (Hoerrunde 4:
  // zu tief wird koernig) und KEIN Sub-Layer mehr (Hoerrunde 6: Part 10
  // spielte dasselbe Sample auf gleicher Hoehe — zwei identische Wellen
  // leicht versetzt kratzen als Kammfilter, und zusammen mit der Kick
  // uebersteuerte die Summe). Velocities entsprechend zurueck auf Headroom.
  if (i >= 2) {
    steps[8] = baue((s) => {
      if (s % 4 === 2) return hit([t.bass[takt(s)]], 110, 16);
      if (i >= 4 && imTakt(s) === 7) return hit([t.bass[takt(s)]], 100, 9);
      if (i >= 4 && imTakt(s) === 15) return hit([t.bass[(takt(s) + 1) % 4]], 100, 9);
      return null;
    });
  }
  // Melos laufen KOMPLETT durch, aber EINSTIMMIG (Hoerrunde 2, 2026-08-15):
  // als Dreiklang gespielte Shots stapeln drei transponierte Kopien
  // uebereinander — das war das "Kratzige". Grundton reicht, volle Gates,
  // Frage auf der Eins, Antwort auf der Drei, Velocities zurueckgenommen.
  if (i >= 3) steps[10] = baue((s) => (imTakt(s) === 0 ? hit([t.akkorde[takt(s)][0]], 88, 96) : null));
  if (i >= 4) steps[11] = baue((s) => (imTakt(s) === 8 ? hit([t.akkorde[takt(s)][0]], 86, 96) : null));
  // Sirene nur noch jeden VIERTEN Takt (Hoerrunde 5) — als Akzent, nicht Dauerton.
  if (i >= 5)
    steps[12] = baue((s) =>
      imTakt(s) === 0 && takt(s) === 0 ? hit([t.akkorde[takt(s)][0]], 82, 16) : null,
    );
  // Remember laeuft ab Intensitaet 4 als durchgehende Melodie-Ebene mit.
  if (i >= 4) steps[13] = baue((s) => (imTakt(s) === 0 ? hit([t.akkorde[takt(s)][0]], 84, 96) : null));
  // Hoerrunde 5: FX-Stab auf der Drop-Eins raus — Wuuuuup nur noch im Break.

  if (breakStelle) {
    steps[12] = baue((s) => (imTakt(s) === 0 ? hit(t.akkorde[takt(s)], 84, 96) : null));
    steps[13] = baue((s) => (s === 0 ? hit(t.akkorde[0], 78, 96) : null));
    steps[14] = baue((s) =>
      imTakt(s) === 0 ? hit(t.akkorde[takt(s)].map((n) => n - 12), 60, 96) : null,
    );
    steps[15] = baue((s) => (s === 0 ? hit([60], 90, 96) : null));
  }

  if (jamMelos) {
    // JAM: Fundament laeuft, und die Melo-Parts tragen ein DUENNES
    // Starter-Muster (je ein Anschlag pro 4-Takte-Loop, versetzt) —
    // Nutzerwunsch: im Sequencer-Modus greifbar/erweiterbar, und ueber
    // die Pads trotzdem frei spielbar.
    steps[10] = baue((s) => (s === 0 ? hit([t.akkorde[0][0]], 88, 96) : null));
    steps[11] = baue((s) => (takt(s) === 1 && imTakt(s) === 8 ? hit([t.akkorde[1][0]], 86, 96) : null));
    steps[12] = baue((s) => (takt(s) === 2 && imTakt(s) === 0 ? hit([t.akkorde[2][0]], 84, 96) : null));
    steps[13] = baue((s) => (takt(s) === 3 && imTakt(s) === 0 ? hit([t.akkorde[3][0]], 84, 96) : null));
  }

  return steps.map((st, idx) => {
    const aktiv = st.filter((x) => x.active).length;
    const jamPart = jamMelos && idx >= 10 && idx <= 13;
    return {
      sampleId: bankNumberToE2PatternRef(jamPart ? jamMelos[idx - 10] : SAMPLES[idx]),
      steps: st,
      volume: jamPart ? 104 : VOLUME[idx],
      // Kicks (Parts 1+2) mit IFX "09 LOW EQ" voll aufgedreht — mehr Druck
      // (Nutzerwunsch 2026-08-15; Anzeige 09 = Speicher 8, 0-basiert wie
      // Mod- und Groove-Typ — am Geraet gegenpruefen).
      params:
        idx <= 1
          ? { voiceAssign: VOICE[idx], ifxOn: 1, ifxType: 8, ifxEdit: 127 }
          : { voiceAssign: VOICE[idx] },
      // Konvention: was nichts spielt, wird gemutet — AUSSER den Jam-Parts,
      // die gerade deshalb offen bleiben (zum Selberspielen ueber die Pads).
      muted: jamPart ? false : aktiv === 0,
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

/** Loest ein [Kategorie, Name/Position]-Paar in die Anzeigenummer auf. */
function findeAnzeige(kat, wahl) {
  const liste = nachKategorie.get(kat) ?? [];
  const s =
    typeof wahl === "string"
      ? liste.find((x) => x.name.trim().toLowerCase().startsWith(wahl.toLowerCase()))
      : liste[Math.min(wahl, liste.length - 1)];
  if (!s) throw new Error(`Jam-Satz: Kategorie "${kat}", "${wahl}" nicht gefunden`);
  return { nr: oscToDisplayNumber(s.sampleNumber), name: s.name.trim() };
}

const JAM_MELOS = {};
for (const [key, eintraege] of Object.entries(JAM_SETS)) {
  const aufgeloest = eintraege.map(([kat, wahl]) => findeAnzeige(kat, wahl));
  JAM_MELOS[key] = aufgeloest.map((a) => a.nr);
  console.log(`  Jam ${key}: ${aufgeloest.map((a) => `#${a.nr} ${a.name}`).join(" · ")}`);
}

const patterns = PLAN.map(([name, intens, thema, kick, wdh, jam], i) => ({
  name,
  bpm: BPM,
  stepLength: 64,
  parts: partsFuer(intens, thema, kick, jam ? JAM_MELOS[jam] : undefined),
  alternate13_14: false,
  alternate15_16: false,
  // Jams beenden die Kette: das Pattern loopt, bis man selbst weiterschaltet.
  chainTo: jam || i + 1 >= PLAN.length ? 0 : i + 2,
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

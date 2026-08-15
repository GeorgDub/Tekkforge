/**
 * Erzeugt HARDTEKK_SET.e2sallpat — 50 aufeinander aufbauende Patterns als Set.
 *
 * Der Aufbau ist durchkomponiert, nicht zusammengewürfelt: ein Dramaturgie-
 * Plan legt je Pattern eine **Intensität 0..5** und ein **Thema** fest, alles
 * Weitere folgt daraus. So bauen benachbarte Patterns hörbar aufeinander auf,
 * und man kann sie in der Reihenfolge durchspielen wie ein Set.
 *
 *   Intensität   was mitspielt
 *   0            nur Kick, sehr offen — Intro und Ausklang
 *   1            + geschlossene HiHat
 *   2            + Bass (der Motor)
 *   3            + Snare, offene HiHat
 *   4            + Lead-Akkorde, Clap
 *   5            + zweiter Kick, Perc, Stabs — voll
 *   Break        kein Kick, nur Pad und Lead
 *
 * Alles aus der Lautstärke-Lektion bleibt eingehalten: **Velocity je Part und
 * Pattern konstant**, kein Groove, keine Motion, Akkorde durchgehend
 * dreistimmig. Die Dynamik über das Set entsteht durch **Anwesenheit** von
 * Parts, nicht durch schwankenden Anschlag — genau das war der Fehler, der die
 * früheren Patterns pumpen liess.
 *
 * Ketten: jedes Pattern zeigt auf seinen Nachfolger, mit
 * abschnittsabhängiger Wiederholungszahl. Das letzte Pattern beendet die Kette.
 *
 * A-Moll durchgehend, 160 BPM. Zwei Themen:
 *   A: Am – F – C – G     (die Hauptfolge)
 *   B: Am – Dm – F – E    (dunkler, für die zweite Hälfte)
 */
import * as fs from "node:fs";
import { buildE2AllPatFile } from "../src/core/e2sExport.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import {
  bankNumberToE2PatternRef,
  oscToDisplayNumber,
} from "../src/core/e2sPatternSampleLink.ts";

const BANK = process.argv[3] ?? "examples/e2s/HARDTEKK.all";
const ZIEL = process.argv[2] ?? "examples/e2s/HARDTEKK_SET.e2sallpat";
const N = 64;
/**
 * Tempo. Als drittes Argument uebergebbar — dieselbe Komposition traegt 150
 * bis 190; darueber wird der Vorschlag der Tekk-Figur zum Flattern, weil ein
 * Sechzehntel dann unter 80 ms liegt.
 */
const BPM = Number(process.argv[4]) || 160;
/**
 * Klangvariante (argv[5], Default A). Gleiche Komposition, anderes
 * Sample-Paket — zum Durchhoeren am Geraet, welche Melos/Drums besser
 * tragen. Pattern-Namen tragen den Variantenbuchstaben als Praefix
 * (ausser A), damit am Geraet sichtbar ist, welche Fassung geladen ist.
 */
const VARIANTE = (process.argv[5] ?? "A").toUpperCase();

const MONO1 = 0, MONO2 = 1, POLY2 = 3;

const THEMA = {
  A: {
    akkorde: [[57, 60, 64], [53, 57, 60], [55, 60, 64], [55, 59, 62]], // Am F C G
    bass: [33, 29, 36, 31],
  },
  B: {
    akkorde: [[57, 60, 64], [50, 53, 57], [53, 57, 60], [52, 56, 59]], // Am Dm F E
    bass: [33, 26, 29, 28],
  },
};

/**
 * Sample-Belegung der 16 Parts. Die Nummern werden NICHT fest verdrahtet,
 * sondern aus der Bank nach Kategorie geholt — sonst zeigt das Set nach einem
 * Bankwechsel auf ganz andere Klaenge, ohne dass irgendetwas auffaellt.
 *
 * Je Part: [Kategorie-Name, Position ODER Namens-Anfang]. Ein String pinnt
 * das Sample per Name — fuer Klaenge, die am Geraet durchgehoert und fuer gut
 * befunden wurden (2026-08-15): Part 9 "Bassdrum-01fd" und Part 10
 * "Unison_Bass_C3" ueberleben so auch Umsortierungen der Bank.
 */
// Stammbelegung = FINALE Fassung nach dem Varianten-Durchhoeren am Geraet
// (2026-08-15): Melos aus Paket C, Pad aus A (Padseq~1), Snare am Geraet
// gewaehlt — snare-rush fiel durch ("klingt furchtbar"), "Snare 001" (#525)
// ist der vom Nutzer bestimmte Ersatz.
// Dritte Hoerrunde (2026-08-15): exKicK-10 und Rad MeLo waren "zu kratzig" —
// Part 2 jetzt Jumpkick (Nutzerwunsch), Part 11 T-Mello. Kicks namentlich
// gepinnt, weil die Jumpkicks die Kick-Reihenfolge der Bank verschoben haben.
const BELEGUNG_HARDTEKK = [
  ["Kick", "spetzial-kick10"], ["Kick", "Jumpkick 20"], ["Snare", "Snare 001"], ["Clap", 0],
  ["HiHat", 0], ["HiHat", 5], ["Perc.", 0], ["Perc.", 3],
  ["Analog", "Bassdrum-01fd"], ["Analog", "Unison_Bass_C3"], ["PCM", "T-Mello"], ["PCM", "Tau-MeLo"],
  ["PCM", "HBsChE PaRa"], ["PCM", "Auf CrystaL"], ["Phrase", "Padseq~1"], ["FX", 0],
];

/**
 * Belegung fuer die NUTZER-Bank tekk.all (33 Samples, 2026-08-15). Dort gibt
 * es keine Clap/Perc/PCM-Kategorien — zweite Snare als Clap, Shots als
 * Perc/Melos, der einzige Analog-Synth traegt Bass UND Sub, killerme (Loop)
 * ist die Flaeche. ["Shots", 11] = zweites "keyboard" (Namen doppelt).
 */
// Seit Hoerrunde 7 fuer tekk2.all: echter Bass (Unison/Bassdrum-01fd statt
// des kratzenden Synth Le) und das Sieger-Melo-Paket aus HARDTEKK.
const BELEGUNG_TEKK = [
  ["Kick", "HaimKind"], ["Kick", "Jumpkick"], ["Snare", "clydesna"], ["Snare", "snarre-p"],
  ["HiHat", "closed 8"], ["HiHat", "707_hho"], ["Shots", "ED Close"], ["Shots", "ZaHnI_To"],
  ["Analog", "Unison_Bass_C3"], ["Analog", "Bassdrum-01fd"], ["PCM", "T-Mello"], ["PCM", "Tau-MeLo"],
  ["PCM", "HBsChE PaRa"], ["PCM", "Auf CrystaL"], ["Phrase", "Padseq~1"], ["FX", "TeRR5Rt"],
];

const IST_TEKK = /tekk2?\.all$/i.test(BANK);
const BELEGUNG = IST_TEKK ? BELEGUNG_TEKK : BELEGUNG_HARDTEKK;
if (IST_TEKK && VARIANTE !== "A")
  throw new Error("Varianten sind auf die HARDTEKK-Bank gepinnt — mit tekk.all nur Variante A.");

/**
 * Varianten: Tausch je Part-Index (0-basiert) gegen die Stammbelegung A.
 * Rhythmusgruppe und die beiden am Geraet fuer gut befundenen Baesse bleiben
 * ueberall gleich — getauscht wird das Melodie-Paket (Parts 11–14 + Pad 15),
 * in D zusaetzlich die Drums. So vergleicht man Klangpakete, nicht Sets.
 */
const VARIANTEN = {
  A: { titel: "Final (Melos C · Pad A · Snare 001)", tausch: {} },
  B: {
    titel: "Melo-Paket B (T-Mello/Genetikk/PsyChoTanZ/Krieger)",
    tausch: {
      10: ["PCM", "T-Mello"],
      11: ["PCM", "Genetikk"],
      12: ["PCM", "PsyChoTanZ"],
      13: ["PCM", "Krieger-MeLo"],
      14: ["Phrase", "Killa Bees"],
    },
  },
  C: {
    titel: "Melo-Paket C (Rad MeLo/Tau-MeLo/PaRa/CrystaL)",
    tausch: {
      10: ["PCM", "PsyChoTanZ"], // Rad MeLo flog aus der Bank (zu kratzig)
      11: ["PCM", "Tau-MeLo"],
      12: ["PCM", "HBsChE PaRa"],
      13: ["PCM", "Auf CrystaL"],
      14: ["Phrase", "Strings of Wisdo"],
    },
  },
  D: {
    titel: "Melo-Paket D + Drums B (Bluezone/Synthbeat/Arp/melo neu 2)",
    tausch: {
      2: ["Snare", "MaschinenMafia_K"], // BAHRE_Snare_2 flog aus der Bank (Ohrprobe)
      3: ["Clap", "SZ_Clap"],
      4: ["HiHat", "TeKK_HaT2"],
      5: ["HiHat", "DuUB HaT"],
      6: ["Perc.", "Digital_Conga_01"],
      7: ["Perc.", "Digital_Shake_01"],
      10: ["PCM", "Bluezone"],
      11: ["PCM", "DL_Synthbeat"],
      12: ["PCM", "SynthArpSample3"],
      13: ["PCM", "melo neu 2"],
      14: ["Phrase", "PAD_ResoChor"],
    },
  },
};

const V = VARIANTEN[VARIANTE];
if (!V) throw new Error(`Unbekannte Variante "${VARIANTE}" (kenne ${Object.keys(VARIANTEN).join(", ")})`);
for (const [idx, wahl] of Object.entries(V.tausch)) BELEGUNG[Number(idx)] = wahl;
const VOLUME = [127, 108, 105, 92, 84, 88, 80, 78, 118, 104, 100, 95, 95, 92, 68, 88];
const VOICE = [MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1, MONO1,
               MONO2, MONO2, POLY2, POLY2, POLY2, MONO1, POLY2, POLY2];

// ─── Dramaturgie: 50 Patterns ────────────────────────────────────────────────
// [Name, Intensität, Thema, Kick-Figur, Wiederholungen in der Kette]
//
// Wiederholungen maximal 2× — die urspruenglichen 4×-Bloecke klangen am
// Geraet zu monoton (Feedback 2026-08-15). Dynamik kommt aus dem Wechsel,
// nicht aus dem Stehenbleiben.
const PLAN = [
  ["INTRO 1",    0, "A", "vier",   2],
  ["INTRO 2",    1, "A", "vier",   2],
  ["INTRO 3",    1, "A", "vier",   2],
  ["ROLLEN 1",   2, "A", "vier",   2],
  ["ROLLEN 2",   2, "A", "vier",   2],
  ["ROLLEN 3",   3, "A", "vier",   2],
  ["THEMA A 1",  3, "A", "vier",   2],
  ["THEMA A 2",  4, "A", "vier",   2],
  ["THEMA A 3",  4, "A", "vier",   2],
  ["AUFBAU 1",   4, "A", "vier",   2],
  ["DROP 1 A",   5, "A", "tekk",   2],
  ["DROP 1 B",   5, "A", "tekk",   2],
  ["DROP 1 C",   5, "A", "roll",   2],
  ["DROP 1 D",   5, "A", "tekk",   2],
  ["ABZUG 1",    3, "A", "vier",   2],
  ["ABZUG 2",    2, "A", "vier",   2],
  ["BREAK 1",   -1, "A", "kein",   2],
  ["BREAK 2",   -1, "A", "kein",   2],
  ["BREAK 3",   -1, "B", "kein",   2],
  ["AUFBAU 2",   1, "B", "vier",   2],
  ["AUFBAU 3",   2, "B", "vier",   2],
  ["AUFBAU 4",   3, "B", "vier",   2],
  ["AUFBAU 5",   4, "B", "roll",   1],
  ["DROP 2 A",   5, "B", "tekk",   2],
  ["DROP 2 B",   5, "B", "tekk",   2],
  ["DROP 2 C",   5, "B", "roll",   2],
  ["DROP 2 D",   5, "B", "tekk",   2],
  ["DROP 2 E",   5, "B", "roll",   2],
  ["STRIPPED 1", 3, "B", "vier",   2],
  ["STRIPPED 2", 2, "B", "vier",   2],
  ["THEMA B 1",  3, "B", "vier",   2],
  ["THEMA B 2",  4, "B", "vier",   2],
  ["THEMA B 3",  4, "B", "vier",   2],
  ["THEMA B 4",  4, "A", "vier",   2],
  ["AUFBAU 6",   4, "A", "roll",   2],
  ["AUFBAU 7",   5, "A", "roll",   1],
  ["AUFBAU 8",   5, "A", "roll",   1],
  ["DROP 3 A",   5, "A", "tekk",   2],
  ["DROP 3 B",   5, "A", "tekk",   2],
  ["DROP 3 C",   5, "A", "roll",   2],
  ["DROP 3 D",   5, "A", "tekk",   2],
  ["DROP 3 E",   5, "B", "tekk",   2],
  ["BREAK 4",   -1, "B", "kein",   2],
  ["BREAK 5",   -1, "A", "kein",   2],
  ["FINALE 1",   4, "A", "vier",   2],
  ["FINALE 2",   5, "A", "tekk",   2],
  ["FINALE 3",   5, "A", "tekk",   2],
  ["AUSKLANG 1", 3, "A", "vier",   2],
  ["AUSKLANG 2", 1, "A", "vier",   2],
  ["AUSKLANG 3", 0, "A", "vier",   2],
];

// ─── Bausteine ───────────────────────────────────────────────────────────────

const takt = (s) => Math.floor(s / 16);
const imTakt = (s) => s % 16;
const leer = () => Array.from({ length: N }, () => ({ active: false }));
const hit = (notes, velocity, gate) => ({ active: true, notes, velocity, gate });

function baue(fn) {
  return Array.from({ length: N }, (_, s) => fn(s) ?? { active: false });
}

/** Kick-Figuren — der eigentliche Charakter im Hardtekk. */
const KICK = {
  kein: () => leer(),
  vier: () => baue((s) => (s % 4 === 0 ? hit([60], 112, 40) : null)),
  // Tekk: Vier auf den Boden plus ein Vorschlag vor der Drei.
  // Bei hohem Tempo faellt der Vorschlag weg: bei 180 BPM liegt ein Sechzehntel
  // bei 83 ms, und Kick plus Vorschlag verschmieren zu einem Doppelschlag.
  tekk: () =>
    baue((s) =>
      s % 4 === 0
        ? hit([60], 112, 40)
        : BPM < 175 && imTakt(s) === 7
          ? hit([60], 112, 22)
          : null,
    ),
  // Rollend: durchgehende Achtel im letzten Takt.
  roll: () =>
    baue((s) => (s % 4 === 0 || (takt(s) === 3 && s % 2 === 0) ? hit([60], 112, 30) : null)),
};

function partsFuer(intensitaet, thema, kickFigur) {
  const t = THEMA[thema];
  const breakStelle = intensitaet < 0;
  const i = breakStelle ? 0 : intensitaet;

  const steps = Array.from({ length: 16 }, leer);

  if (!breakStelle) steps[0] = KICK[kickFigur]();
  if (i >= 5) steps[1] = baue((s) => (imTakt(s) === 10 ? hit([60], 96, 24) : null));
  if (i >= 3) steps[2] = baue((s) => (imTakt(s) === 4 || imTakt(s) === 12 ? hit([60], 108, 30) : null));
  if (i >= 4) steps[3] = baue((s) => (imTakt(s) === 12 ? hit([60], 100, 26) : null));
  if (i >= 1) steps[4] = baue((s) => (s % 2 === 0 ? hit([60], 78, 12) : null));
  if (i >= 3) steps[5] = baue((s) => (imTakt(s) === 14 ? hit([60], 86, 40) : null));
  if (i >= 5) steps[6] = baue((s) => (imTakt(s) === 6 ? hit([60], 82, 20) : null));
  if (i >= 5) steps[7] = baue((s) => (s % 8 === 3 ? hit([60], 74, 14) : null));
  if (i >= 2) steps[8] = baue((s) => (s % 4 === 2 ? hit([t.bass[takt(s)]], 106, 22) : null));
  if (i >= 5) steps[9] = baue((s) => (imTakt(s) === 0 ? hit([t.bass[takt(s)] - 12], 98, 60) : null));
  if (i >= 4 || breakStelle)
    steps[10] = baue((s) => {
      const a = t.akkorde[takt(s)];
      if (imTakt(s) === 0) return hit(a, 96, 96);
      if (imTakt(s) === 10) return hit(a, 96, 20);
      return null;
    });
  if (i >= 5) steps[11] = baue((s) => (imTakt(s) === 6 ? hit(t.akkorde[takt(s)], 92, 18) : null));
  if (breakStelle) steps[14] = baue((s) => (imTakt(s) === 0 ? hit(t.akkorde[takt(s)], 72, 96) : null));
  else if (i >= 4) steps[14] = baue((s) => (imTakt(s) === 0 ? hit(t.akkorde[takt(s)], 70, 96) : null));

  return steps.map((st, idx) => {
    const aktiv = st.filter((x) => x.active).length;
    return {
      sampleId: bankNumberToE2PatternRef(SAMPLES[idx]),
      steps: st,
      volume: VOLUME[idx],
      // Kicks (Parts 1+2) mit IFX "09 LOW EQ" voll aufgedreht — mehr Druck
      // (Nutzerwunsch 2026-08-15; Anzeige 09 = Speicher 8, 0-basiert wie
      // Mod- und Groove-Typ — am Geraet gegenpruefen).
      params:
        idx <= 1
          ? { voiceAssign: VOICE[idx], ifxOn: 1, ifxType: 8, ifxEdit: 127 }
          : { voiceAssign: VOICE[idx] },
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
// Anzeige am Geraet = Nummernfeld (OSC_0index) + 1 — am Geraet gemessen mit
// der entkoppelten Probe SLOTNUM2.all (2026-08-15); der Tabellenplatz ist fuer
// die Anzeige irrelevant. `sampleNumber` aus dem Reader IST das Nummernfeld,
// also uebersetzt oscToDisplayNumber in die Nummern, die Geraet und Set meinen.
// (Der fruehere GERAETE_VERSATZ=0 stammte aus der Zeit, als unsere Baenke die
// Anzeigenummer direkt ins Feld schrieben.)

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
console.log(`Bank: ${BANK.split(/[\/]/).pop()} — ${belegt.length} Samples · Variante ${VARIANTE}: ${V.titel}`);
BELEGUNG.forEach(([kat], i) =>
  console.log(`  Part ${String(i + 1).padStart(2)}  ${kat.padEnd(7)} #${SAMPLES[i]} ${NAMEN[i]}`),
);

const patterns = PLAN.map(([name, intens, thema, kick, wdh], i) => ({
  // Variantenbuchstabe im Namen, damit am Geraet sichtbar ist, was geladen ist.
  name: VARIANTE === "A" ? name : `${VARIANTE} ${name}`,
  bpm: BPM,
  stepLength: 64,
  parts: partsFuer(intens, thema, kick),
  alternate13_14: false,
  alternate15_16: false,
  // 1-basierte Nummer des Folgepatterns; das letzte beendet die Kette.
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
    `  ${String(i + 1).padStart(2)} ${name.padEnd(11)} ${intens < 0 ? "Break" : "Int " + intens}` +
      ` · Thema ${thema} · Kick ${kick.padEnd(5)} · ${String(aktiv).padStart(2)} Parts` +
      ` · ${wdh}× → ${p.chainTo || "Ende"}`,
  );
}
console.log(`  Kette gesamt: ${takte} Takte ≈ ${Math.round((takte * 4 * 60) / BPM / 60)} Minuten`);

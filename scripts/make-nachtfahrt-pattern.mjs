/**
 * Erzeugt NACHTFAHRT.e2spat — ein Pattern zum Hören, nicht zum Messen.
 *
 * Die Testpatterns davor klangen absichtlich ungleichmäßig: Velocity-Spannen
 * bis 70, Groove-Depth bis 70 und wechselnde Akkorddichte waren jeweils der
 * Prüfgegenstand. Hier ist genau das ausgeräumt:
 *
 *   - **Velocity je Part konstant.** Balance läuft über die Part-Lautstärke,
 *     nicht über schwankende Anschlagstärke.
 *   - **Kein Groove.** Groove verschiebt am Gerät Timing UND Anschlag.
 *   - **Keine Motion.** Ein Osc-Edit-Sweep verändert den Sample-Start und damit
 *     den wahrgenommenen Pegel über den Pattern-Verlauf.
 *   - **Akkorde immer dreistimmig.** Wechselnde Stimmenzahl heißt wechselnde
 *     Lautheit — der Grund, warum CHORDTEST anschwoll.
 *   - **Wenige gleichzeitige Stimmen**, damit das Gerät keine Stimmen klaut.
 *
 * A-Moll, vier Takte: Am – F – C – G. 160 BPM.
 *
 * Konvention: Parts ohne Steps werden gemutet — hier acht Stück, damit am
 * Gerät sofort sichtbar ist, was mitspielt.
 */
import * as fs from "node:fs";
import { buildE2PatternFileV2 } from "../src/core/e2sExport.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import { bankNumberToE2PatternRef } from "../src/core/e2sPatternSampleLink.ts";

const BANK = process.argv[3] ?? "C:/Users/admin/Desktop/omnitribe-hwtest-kit/luknkicks.all";
const ZIEL = process.argv[2] ?? "examples/e2s/NACHTFAHRT.e2spat";
const N = 64;

const MONO1 = 0, MONO2 = 1, POLY2 = 3;

/** Am – F – C – G, enge Lage, immer dreistimmig. */
const AKKORDE = [
  [57, 60, 64], // Am
  [53, 57, 60], // F
  [55, 60, 64], // C
  [55, 59, 62], // G
];
/** Grundtöne, zwei Oktaven tiefer. */
const BASS = [33, 29, 36, 31];

const takt = (s) => Math.floor(s / 16);
const imTakt = (s) => s % 16;

function steps(fn) {
  return Array.from({ length: N }, (_, s) => fn(s) ?? { active: false });
}
const hit = (notes, velocity, gate) => ({ active: true, notes, velocity, gate });

const PARTS = [
  {
    rolle: "Kick", sample: 590, voice: MONO1, volume: 127,
    // Vier auf den Boden, gleichbleibend — das ist der Anker.
    steps: steps((s) => (s % 4 === 0 ? hit([60], 112, 40) : null)),
  },
  { rolle: "Kick 2", sample: 585, voice: MONO1, volume: 100, steps: steps(() => null) },
  {
    rolle: "Snare", sample: 562, voice: MONO1, volume: 105,
    steps: steps((s) => (imTakt(s) === 4 || imTakt(s) === 12 ? hit([60], 108, 30) : null)),
  },
  {
    rolle: "Clap", sample: 550, voice: MONO1, volume: 92,
    // Nur die zweite Hälfte jedes Takts — Abwechslung über Anwesenheit
    // statt über Lautstärke.
    steps: steps((s) => (imTakt(s) === 12 ? hit([60], 100, 26) : null)),
  },
  {
    rolle: "HiHat cl", sample: 553, voice: MONO1, volume: 84,
    steps: steps((s) => (s % 2 === 0 ? hit([60], 78, 12) : null)),
  },
  {
    rolle: "HiHat op", sample: 615, voice: MONO1, volume: 88,
    steps: steps((s) => (imTakt(s) === 14 ? hit([60], 86, 40) : null)),
  },
  { rolle: "Perc 1", sample: 549, voice: MONO1, volume: 80, steps: steps(() => null) },
  { rolle: "Perc 2", sample: 592, voice: MONO1, volume: 80, steps: steps(() => null) },
  {
    rolle: "Bass", sample: 600, voice: MONO2, volume: 118,
    params: { cutoff: 58, resonance: 70, egInt: 30, egAttack: 0, egDecay: 70 },
    // Rollende Achtel-Offbeats — der Motor des Ganzen.
    steps: steps((s) => (s % 4 === 2 ? hit([BASS[takt(s)]], 106, 22) : null)),
  },
  { rolle: "Bass 2", sample: 537, voice: MONO2, volume: 100, steps: steps(() => null) },
  {
    rolle: "Lead", sample: 530, voice: POLY2, volume: 100,
    params: { cutoff: 92, resonance: 30, egAttack: 4, egDecay: 100 },
    // Ein gehaltener Dreiklang je Takt, dazu ein kurzer Nachschlag.
    steps: steps((s) => {
      const a = AKKORDE[takt(s)];
      if (imTakt(s) === 0) return hit(a, 96, 96);
      if (imTakt(s) === 10) return hit(a, 96, 20);
      return null;
    }),
  },
  { rolle: "Stab 1", sample: 543, voice: POLY2, volume: 95, steps: steps(() => null) },
  { rolle: "Stab 2", sample: 531, voice: POLY2, volume: 95, steps: steps(() => null) },
  { rolle: "Stab 3", sample: 512, voice: MONO1, volume: 95, steps: steps(() => null) },
  {
    rolle: "Pad", sample: 501, voice: POLY2, volume: 68,
    params: { egAttack: 70, egDecay: 127, cutoff: 62 },
    // Flächig darunter, leise und gleichbleibend.
    steps: steps((s) => (imTakt(s) === 0 ? hit(AKKORDE[takt(s)], 72, 96) : null)),
  },
  { rolle: "FX", sample: 548, voice: POLY2, volume: 90, steps: steps(() => null) },
];

const buf = fs.readFileSync(BANK);
const bank = parseE2sBank(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
const nameVon = new Map(
  bank.slots.filter((s) => s && s.frames > 0).map((s) => [s.sampleNumber, s.name.trim()]),
);

const parts = PARTS.map((p) => {
  const aktiv = p.steps.filter((s) => s.active).length;
  return {
    sampleId: bankNumberToE2PatternRef(p.sample),
    steps: p.steps,
    volume: p.volume,
    params: { ...(p.params ?? {}), voiceAssign: p.voice },
    muted: aktiv === 0,
  };
});

const out = Buffer.from(
  buildE2PatternFileV2({
    name: "NACHTFAHRT",
    bpm: 160,
    stepLength: 64,
    parts,
    alternate13_14: false,
    alternate15_16: false,
  }),
);
fs.writeFileSync(ZIEL, out);

console.log(`${ZIEL} — ${out.length} Bytes · 160 BPM · ${N} Steps · Am F C G`);
let stimmen = 0;
for (const [i, p] of PARTS.entries()) {
  const aktiv = p.steps.filter((s) => s.active);
  const vel = [...new Set(aktiv.map((s) => s.velocity))];
  stimmen += aktiv.reduce((m, s) => Math.max(m, s.notes.length), 0);
  console.log(
    `  Part ${String(i + 1).padStart(2)} ${p.rolle.padEnd(9)} #${p.sample} ${(nameVon.get(p.sample) ?? "?").padEnd(10)}` +
      (aktiv.length
        ? `${String(aktiv.length).padStart(3)} Steps · Vel ${vel.join("/")} · Vol ${p.volume}`
        : "  [gemutet]"),
  );
}
console.log(`  maximal ${stimmen} gleichzeitige Stimmen`);

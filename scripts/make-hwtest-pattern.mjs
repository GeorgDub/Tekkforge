/**
 * Erzeugt HWTEST.e2spat — ein Pattern, das alles ausreizt, was am Gerät
 * gemessen und im Code hinterlegt ist.
 *
 * Geprüft werden in einem Durchgang:
 *
 *   Noten          MIDI+1-Kodierung über den ganzen Bereich, inklusive der
 *                  Randfälle G9 und C-1
 *   Akkorde        bis zu vier Töne je Step auf den polyphonen Parts
 *   Voice Assign   Part-Offset 0x02 — ohne Poly klingt ein Akkord einstimmig,
 *                  und genau das lässt sich im Speicher NICHT sehen
 *   Gate           reguläre Werte 0..96 und der Sentinel 127 (TIE)
 *   Sample-Verweis die ±1-Umrechnung Bank-Nummer → Pattern-Referenz
 *   Motion         Spuren im Pattern-Kopf (Ziel 0x100, Parameter 0x118,
 *                  Werte 0x130) mit der Osc-Edit-Werteleiter
 *   Klangparameter Filter, Amp-EG, Groove, Pitch, Osc-Edit an ihren Offsets
 *   IFX            auf mehreren Parts gesetzt UND aktiviert
 *   Länge          64 Steps über vier Takte, mit Variation in jedem Takt
 *
 * Konvention: Parts ohne gesetzte Steps werden gemutet, damit am Gerät sofort
 * sichtbar ist, was aktiv ist. Hier ist jeder Part bespielt, die Regel greift
 * also nicht — sie steht trotzdem im Code, weil sie für jedes erzeugte Pattern
 * gelten soll.
 */
import * as fs from "node:fs";
import { buildE2PatternFileV2, encodeOscEditMotion } from "../src/core/e2sExport.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import { bankNumberToE2PatternRef } from "../src/core/e2sPatternSampleLink.ts";

const BANK = process.argv[3] ?? "C:/Users/admin/Desktop/omnitribe-hwtest-kit/luknkicks.all";
const ZIEL = process.argv[2] ?? "examples/e2s/HWTEST.e2spat";
const N = 64;

const TIE = 0xff; // Export schreibt den Factory-Sentinel; Geraet zeigt TIE
const MONO1 = 0, MONO2 = 1, POLY2 = 3; // Voice Assign, Part-Offset 0x02

/** Akkorde der Progression — je Takt einer. */
const AKKORDE = [
  [60, 64, 67, 71], // Cmaj7
  [57, 60, 64, 67], // Am7
  [53, 57, 60, 64], // Fmaj7
  [55, 59, 62, 65], // G7
];

const takt = (s) => Math.floor(s / 16);
const jede = (n, off = 0) => (s) => s % n === off;

/** Baut 64 Steps aus einer Funktion, die je Step ein Step-Objekt oder null gibt. */
function steps(fn) {
  return Array.from({ length: N }, (_, s) => fn(s) ?? { active: false });
}
const hit = (notes, velocity, gate) => ({ active: true, notes, velocity, gate });

// ─── Parts ───────────────────────────────────────────────────────────────────

const PARTS = [
  {
    rolle: "Kick", sample: 590, voice: MONO1,
    params: { grooveType: 2, grooveDepth: 40, egDecay: 90 },
    // Vier auf den Boden; im letzten Takt eine 16tel-Figur.
    steps: steps((s) =>
      takt(s) === 3 && s >= 58
        ? hit([60], 100 + (s - 58) * 4, 30)
        : jede(4)(s) ? hit([60], s % 16 === 0 ? 127 : 105, 40) : null,
    ),
  },
  {
    rolle: "Kick 2", sample: 585, voice: MONO1,
    params: { egDecay: 70, oscPitch: -5 },
    // Nur in Takt 2 und 4, auf den Offbeats.
    steps: steps((s) => (takt(s) % 2 === 1 && jede(8, 6)(s) ? hit([60], 90, 25) : null)),
  },
  {
    rolle: "Snare", sample: 562, voice: MONO1,
    params: { ifxOn: 1, ifxType: 5, ifxEdit: 70, cutoff: 100, resonance: 30 },
    // Backbeat, im letzten Takt ein Wirbel mit steigender Velocity.
    steps: steps((s) =>
      takt(s) === 3 && s >= 56
        ? hit([60], 50 + (s - 56) * 10, 20)
        : jede(8, 4)(s) ? hit([60], 115, 35) : null,
    ),
  },
  {
    rolle: "Clap", sample: 550, voice: MONO1,
    params: { mfxSend: 1, egDecay: 100 },
    steps: steps((s) => (takt(s) % 2 === 1 && jede(8, 4)(s) ? hit([60], 100, 30) : null)),
  },
  {
    rolle: "HiHat cl", sample: 553, voice: MONO1,
    params: { grooveType: 4, grooveDepth: 70, cutoff: 110 },
    // Achtel, Velocity abwechselnd — hörbarer Groove.
    steps: steps((s) => (jede(2)(s) ? hit([60], s % 4 === 0 ? 110 : 65, 12) : null)),
  },
  {
    rolle: "HiHat op", sample: 615, voice: MONO1,
    params: { ifxOn: 1, ifxType: 12, ifxEdit: 90, egDecay: 110 },
    steps: steps((s) => (jede(8, 6)(s) ? hit([60], 95, 45) : null)),
  },
  {
    rolle: "Perc 1", sample: 549, voice: MONO1,
    // Tonhöhe wandert über die Takte — prüft Noten jenseits von C4.
    params: { cutoff: 90 },
    steps: steps((s) => (jede(16, 6)(s) ? hit([60 + takt(s) * 3], 85, 30) : null)),
  },
  {
    rolle: "Perc 2", sample: 592, voice: MONO1,
    params: { oscPitch: 12, egDecay: 40 },
    steps: steps((s) => (jede(8, 3)(s) ? hit([60], 75, 15) : null)),
  },
  {
    rolle: "Bass", sample: 600, voice: MONO2,
    params: { cutoff: 60, resonance: 90, egInt: 40, egAttack: 0, egDecay: 80 },
    // Grundton des jeweiligen Akkords, eine Oktave tiefer, mit TIE auf der Eins.
    steps: steps((s) =>
      jede(4)(s) ? hit([AKKORDE[takt(s)][0] - 24], s % 16 === 0 ? 120 : 95, s % 16 === 0 ? TIE : 35) : null,
    ),
  },
  {
    rolle: "Bass 2", sample: 537, voice: MONO2,
    params: { cutoff: 45, oscPitch: -12 },
    steps: steps((s) => (jede(8, 2)(s) ? hit([AKKORDE[takt(s)][0] - 12], 85, 50) : null)),
  },
  {
    rolle: "Lead", sample: 530, voice: POLY2,
    params: { ifxOn: 1, ifxType: 18, ifxEdit: 60, cutoff: 95, resonance: 40, oscEdit: 30 },
    // Der eigentliche Akkordtest: je Takt ein Vierklang, auf der Eins gehalten,
    // dazu zwei kürzere Wiederholungen mit weniger Tönen.
    steps: steps((s) => {
      const a = AKKORDE[takt(s)];
      if (s % 16 === 0) return hit(a, 110, TIE);
      if (s % 16 === 6) return hit(a.slice(0, 3), 90, 30);
      if (s % 16 === 11) return hit(a.slice(0, 2), 80, 25);
      return null;
    }),
  },
  {
    rolle: "Stab 1", sample: 543, voice: POLY2,
    params: { ifxOn: 1, ifxType: 9, ifxEdit: 40, cutoff: 105 },
    steps: steps((s) => (jede(16, 10)(s) ? hit(AKKORDE[takt(s)].slice(0, 3), 100, 20) : null)),
  },
  {
    rolle: "Stab 2", sample: 531, voice: POLY2,
    params: { cutoff: 80, modType: 2, modSpeed: 40, modDepth: 60 },
    steps: steps((s) => (jede(16, 14)(s) ? hit(AKKORDE[takt(s)].slice(1, 3), 95, 18) : null)),
  },
  {
    rolle: "Stab 3", sample: 512, voice: MONO1,
    params: { oscPitch: 7, cutoff: 120 },
    steps: steps((s) => (jede(32, 24)(s) ? hit([AKKORDE[takt(s)][2]], 90, 40) : null)),
  },
  {
    rolle: "Pad", sample: 501, voice: POLY2,
    params: { egAttack: 60, egDecay: 127, cutoff: 70, mfxSend: 1 },
    // Ein gehaltener Vierklang je Takt — testet TIE zusammen mit Polyphonie.
    steps: steps((s) => (s % 16 === 0 ? hit(AKKORDE[takt(s)], 70, TIE) : null)),
  },
  {
    rolle: "FX", sample: 548, voice: POLY2,
    params: { ifxOn: 1, ifxType: 16, ifxEdit: 100 },
    // Grenzfall: höchste und niedrigste Note, die das Gerät kennt.
    steps: steps((s) => (s === 63 ? hit([127, 126, 124, 0], 110, 60) : null)),
  },
];

// ─── Motion-Spuren ───────────────────────────────────────────────────────────
// Osc Edit (Parameter-Kennung 4) auf Lead und Pad. Nur die FWD-Hälfte der
// Leiter, damit die Werte im gesicherten Bereich 1..64 bleiben.
const rampe = (von, bis) =>
  Array.from({ length: N }, (_, s) => encodeOscEditMotion(von + ((bis - von) * s) / (N - 1), "fwd"));

const motionSlots = [
  { paramId: 4, targetPart: 10, values: rampe(0, 98) },
  { paramId: 4, targetPart: 14, values: rampe(98, 0) },
];

// ─── Bauen ───────────────────────────────────────────────────────────────────

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
    params: { ...p.params, voiceAssign: p.voice },
    // Konvention: was nichts spielt, wird gemutet.
    muted: aktiv === 0,
  };
});

const out = Buffer.from(
  buildE2PatternFileV2({
    name: "HWTEST",
    bpm: 160,
    stepLength: 64,
    parts,
    motionSlots,
    // Beide Alternate-Paare aus — sonst spielen 13/14 und 15/16 abwechselnd,
    // was die Zuordnung Part -> Klang beim Hoeren verwischt.
    alternate13_14: false,
    alternate15_16: false,
  }),
);
fs.writeFileSync(ZIEL, out);

const VOICE = { 0: "Mono 1", 1: "Mono 2", 2: "Poly 1", 3: "Poly 2" };
console.log(`${ZIEL} — ${out.length} Bytes · 160 BPM · ${N} Steps`);
for (const [i, p] of PARTS.entries()) {
  const aktiv = p.steps.filter((s) => s.active).length;
  const akkorde = p.steps.filter((s) => s.active && s.notes.length > 1).length;
  const ties = p.steps.filter((s) => s.active && s.gate === TIE).length;
  const ifx = p.params.ifxOn ? ` IFX#${p.params.ifxType}` : "";
  console.log(
    `  Part ${String(i + 1).padStart(2)} ${p.rolle.padEnd(9)} #${p.sample} ${(nameVon.get(p.sample) ?? "?").padEnd(10)}` +
      `${String(aktiv).padStart(3)} Steps` +
      `${akkorde ? `, ${akkorde} Akkorde` : ""}${ties ? `, ${ties}× TIE` : ""}` +
      `  ${VOICE[p.voice]}${ifx}${aktiv === 0 ? "  [gemutet]" : ""}`,
  );
}

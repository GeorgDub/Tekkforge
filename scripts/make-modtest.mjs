/**
 * Erzeugt MODTEST.e2spat — das Hoerset fuer die neuen Modulationstypen 97…132
 * (core/modTabelle.ts). Braucht AMTTEST.all (501 AMT SAW, 502 AMT NOISE).
 *
 * Jeder Part spielt sein Achtel des Patterns (zwei Anschlaege) mit Depth 127:
 *
 *   P1  Mod 97  SawUp Filter   (frei)      ← neu
 *   P2  Mod 37  SawUpB Filter  (im Takt)   ← Hacktribe, zum Vergleich
 *   P3  Mod 98  SawUp Pitch                ← neu
 *   P4  Mod 38  SawUpB Pitch               ← Vergleich
 *   P5  Mod 109 SquUp Filter               ← neu
 *   P6  Mod 49  SquUpB Filter              ← Vergleich
 *   P7  Mod 121 S&H Filter                 ← neu (frei)
 *   P8  Mod 61  S&HBPM Filter              ← Vergleich
 *   P9  Mod 128 RandomB Pitch              ← neu (im Takt)
 *   P10 Mod 68  Random Pitch               ← Vergleich (frei)
 *
 * Ein Part traegt seinen Mod-Typ als Zahl im Pattern — er wirkt, sobald die
 * Tabelle den Eintrag hat (fluechtig oder eingebrannt), unabhaengig davon, ob
 * das Menue ihn zeigt. Klingt P1 wie P2, nur nicht im Takt, laeuft der neue
 * Typ; klingt P1 unmoduliert, greift der DSP den Eintrag nicht.
 *
 * Aufruf: node scripts/make-modtest.mjs [zielordner]
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { buildE2PatternFileV2 } from "../src/core/e2sExport.ts";
import { bankNumberToE2PatternRef } from "../src/core/e2sPatternSampleLink.ts";

const ZIEL = process.argv[2] ?? "examples/e2s";
const N = 64;
const steps = (fn) => Array.from({ length: N }, (_, s) => fn(s) ?? { active: false });
const fenster = (i) => steps((s) => (s === 6 * i || s === 6 * i + 3 ? { active: true, notes: [60], velocity: 120, gate: 40 } : null));

// Anzeige-Nummern (1-basiert) → gespeichert −1
const PAARE = [
  [97, "SawUp Filter"], [37, "SawUpB Filter"],
  [98, "SawUp Pitch"], [38, "SawUpB Pitch"],
  [109, "SquUp Filter"], [49, "SquUpB Filter"],
  [121, "S&H Filter"], [61, "S&HBPM Filter"],
  [128, "RandomB Pitch"], [68, "Random Pitch"],
];
const parts = PAARE.map(([anzeige], i) => ({
  sampleId: bankNumberToE2PatternRef(501),
  steps: fenster(i),
  params: { voiceAssign: 0, filterType: 0, cutoff: 70, resonance: 60, egInt: 0, egAttack: 0, egDecay: 110, ampEgOn: 1, modType: anzeige - 1, modSpeed: 60, modDepth: 127 },
  muted: false,
}));
while (parts.length < 16) parts.push({ sampleId: bankNumberToE2PatternRef(501), steps: steps(() => null), params: {}, muted: true });

fs.mkdirSync(ZIEL, { recursive: true });
const weg = path.join(ZIEL, "MODTEST.e2spat");
fs.writeFileSync(weg, Buffer.from(buildE2PatternFileV2({ name: "MOD TEST", bpm: 120, stepLength: 64, parts, alternate13_14: false, alternate15_16: false })));
console.log(`${weg} — ${PAARE.map(([n, t], i) => `P${i + 1} ${n} ${t}`).join(" | ")}`);
console.log("Braucht AMTTEST.all (501). Neu ↔ Vergleich paarweise hoeren; neu = frei laufend, Vergleich = im Takt (bzw. umgekehrt bei Random).");

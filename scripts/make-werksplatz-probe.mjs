/**
 * make-werksplatz-probe.mjs — WERKSPLATZ.all: laesst sich ein WERKS-Sampleplatz
 * (Anzeige 1–499) ueber den .all-Import ueberschreiben?
 *
 * Hintergrund (2026-09-03): der Wunsch, „die Firmware-Samples zu aendern“.
 * Die Werks-Samples liegen nicht in der SYSTEM.VSB (siehe README, DSP-
 * Patches), sondern im Sample-Speicher — und der einzige bekannte Schreibweg
 * dorthin ist der Import einer e2sSample.all. Ob das Geraet dabei auch die
 * Plaetze 1–499 nimmt oder nur 501–999, steht nirgends. Diese Bank fragt es:
 *
 *   Name          Index  OSC   Anzeige   Ton
 *   TF WERK 001     0      0      1      440 Hz (A)
 *   TF WERK 250   249    249    250      554 Hz (C#)
 *   TF WERK 499   498    498    499      659 Hz (E)
 *
 * Ablesen am Geraet nach „Sample Import All“: zeigt Platz 1 den Namen
 * „TF WERK 001“ und spielt den A-Ton → Werksplaetze sind beschreibbar. Bleibt
 * das Werks-Sample → nur 501+ werden genommen, und eigene „Werks“-Samples
 * bleiben ein Wunsch.
 *
 * ⚠ Der Import ersetzt den ganzen User-Bereich (501–999). Vorher die eigenen
 * Samples als e2sSample.all exportieren. Werks-Samples stellt KORGs
 * „Factory Sample“-Datei von der Produktseite wieder her — nur mit ihr auf
 * der Karte den Versuch machen.
 */
import * as fs from "node:fs";
import { buildE2sBank } from "../src/core/e2sBankBuilder.ts";
import { displayNumberToSlotIndex, displayNumberToOsc } from "../src/core/e2sPatternSampleLink.ts";

const RATE = 44100;
const ton = (hz, ms = 300) => {
  const n = Math.round((RATE * ms) / 1000);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const h = Math.min(1, i / 200) * Math.min(1, (n - i) / 2000);
    a[i] = Math.sin((2 * Math.PI * hz * i) / RATE) * 0.7 * h;
  }
  return a;
};

const PROBEN = [
  { anzeige: 1, hz: 440 },
  { anzeige: 250, hz: 554 },
  { anzeige: 499, hz: 659 },
];

const slots = PROBEN.map((p) => ({
  slotIndex: displayNumberToSlotIndex(p.anzeige),
  sampleNumber: displayNumberToOsc(p.anzeige),
  name: `TF WERK ${String(p.anzeige).padStart(3, "0")}`,
  category: 17,
  pcmData: ton(p.hz),
  sampleRate: RATE,
  channels: 1,
}));

const bank = buildE2sBank(slots);
const out = Buffer.from(bank.buffer ?? bank);
fs.writeFileSync("examples/e2s/WERKSPLATZ.all", out);
console.log(`examples/e2s/WERKSPLATZ.all — ${(out.length / 1024).toFixed(0)} KB, ${bank.slotCount ?? slots.length} Slots`);
for (const s of slots) console.log(`  Index ${s.slotIndex}  OSC ${s.sampleNumber}  "${s.name}"`);

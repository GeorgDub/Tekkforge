/**
 * Erzeugt SLOTNUM2.all — die Entscheidungsbank zwischen zwei Modellen, die die
 * erste SLOTNUM-Messung beide erklaeren:
 *
 *   Modell A: Anzeige = Tabellenindex + 2       (aktuell im Kern)
 *   Modell B: Anzeige = OSC_0index (esli) + 1   (passt zur Geraete-Bank)
 *
 * SLOTNUM.all konnte das nicht unterscheiden, weil dort OSC = Index + 1
 * gekoppelt war — beide Modelle sagten dieselben Anzeigen voraus. Ausloeser
 * fuer den Zweifel: die vom Geraet selbst geschriebene
 * H:\KORG\hacktribe\Sample\e2sSample.all legt ihre User-Samples auf
 * Index 500.. mit OSC == Index — unter Modell A wuerde das Geraet seine
 * eigene Bank verschoben wiederladen, unter Modell B ist es selbstkonsistent.
 *
 * Hier sind Index und OSC deshalb ENTKOPPELT. Am Geraet einfach ablesen,
 * unter welcher Nummer jeder Ton erscheint:
 *
 *   Name        Index  OSC   Modell A sagt   Modell B sagt
 *   I499 O551    499   551        501             552
 *   I549 O502    549   502        551             503
 *   I520 O520    520   520        522             521
 *
 * Drei verschiedene Tonhoehen (A, C#, E), damit auch hoerbar ist, wer spielt.
 */
import * as fs from "node:fs";
import { buildE2sBank } from "../src/core/e2sBankBuilder.ts";

const RATE = 44100;
const ton = (hz, ms = 250) => {
  const n = Math.round((RATE * ms) / 1000);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const h = Math.min(1, i / 200) * Math.min(1, (n - i) / 2000); // weiche Flanken
    a[i] = Math.sin((2 * Math.PI * hz * i) / RATE) * 0.7 * h;
  }
  return a;
};

const PROBEN = [
  { idx: 499, osc: 551, hz: 440 },
  { idx: 549, osc: 502, hz: 554 },
  { idx: 520, osc: 520, hz: 659 },
];

const slots = PROBEN.map((p) => ({
  slotIndex: p.idx,
  sampleNumber: p.osc,
  name: `I${p.idx} O${p.osc}`,
  category: 17,
  pcmData: ton(p.hz),
  sampleRate: RATE,
  channels: 1,
}));

const bank = buildE2sBank(slots);
const out = Buffer.from(bank.buffer ?? bank);
fs.writeFileSync("examples/e2s/SLOTNUM2.all", out);
console.log(`examples/e2s/SLOTNUM2.all — ${(out.length / 1024).toFixed(0)} KB`);
for (const p of PROBEN) {
  console.log(
    `  Index ${p.idx}  OSC ${p.osc}  "I${p.idx} O${p.osc}"  ` +
      `→ Modell A: ${p.idx + 2}, Modell B: ${p.osc + 1}`,
  );
}

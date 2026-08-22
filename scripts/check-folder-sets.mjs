/**
 * check-folder-sets.mjs — prueft die mit make-folder-set.mjs gebauten Paare
 * <bank>.all / <BANK>.e2sallpat: 250 Patterns, jede unmuted Part-Referenz zeigt
 * auf ein Sample der Bank, keine unmuted Parts ohne Steps, Chain-Ziele im Bereich,
 * und listet unbenutzte Samples. Aufruf: npx tsx scripts/check-folder-sets.mjs
 */
import * as fs from "node:fs";
import { parseElectribeAllPatBank } from "../src/core/electribeImport.ts";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import { e2PatternRefToBankNumber, oscToDisplayNumber } from "../src/core/e2sPatternSampleLink.ts";
const PAARE = [["korg3","KORG3"],["korg2","KORG2"],["korg1","KORG1"],["heiko","HEIKO"],["project5","PROJECT5"],["durchgetekkt","DURCHGETEKKT"],["rauschgift","RAUSCHGIFT"],["tommi","TOMMI"],["neulee","NEULEE"],["melopack","MELOPACK"],["melopack2","MELOPACK2"],["melopack3","MELOPACK3"],["melopack4","MELOPACK4"],["melopack5","MELOPACK5"],["melopack6","MELOPACK6"],["melopack7","MELOPACK7"]];
let fehler = 0;
for (const [b, p] of PAARE) {
  const bank = parseE2sBank(new Uint8Array(fs.readFileSync(`examples/e2s/${b}.all`)), `${b}.all`);
  const nummern = new Set(bank.slots.filter(Boolean).map((s) => oscToDisplayNumber(s.sampleNumber)));
  const pat = parseElectribeAllPatBank(fs.readFileSync(`examples/e2s/${p}.e2sallpat`));
  const benutzt = new Set(); let mutes = 0, leerAktiv = 0, refFehl = 0, chainFehl = 0, namen = new Set(), bpms = new Set();
  pat.patterns.forEach((pt, i) => {
    namen.add(pt.name); bpms.add(pt.bpm);
    if (pt.chainTo !== undefined && pt.chainTo !== 0 && (pt.chainTo < 1 || pt.chainTo > 250)) chainFehl++;
    pt.parts.forEach((part, pi) => {
      const aktiv = part.steps.some((s) => s.active);
      if (part.muted) mutes++;
      if (!part.muted && !aktiv) leerAktiv++;
      if (!part.muted) {
        const nr = e2PatternRefToBankNumber(part.sampleId);
        if (!nummern.has(nr)) { refFehl++; if (refFehl < 4) console.log(`   ! ${p} #${i + 1} Part ${pi + 1}: Ref ${part.sampleId} → #${nr} nicht in Bank`); }
        else benutzt.add(nr);
      }
    });
  });
  const unbenutzt = [...nummern].filter((n) => !benutzt.has(n));
  const ok = refFehl === 0 && leerAktiv === 0 && chainFehl === 0 && pat.patterns.length === 250;
  if (!ok) fehler++;
  console.log(`${ok ? "OK " : "!! "} ${p.padEnd(13)} ${pat.patterns.length} Patterns · BPM ${[...bpms].join("/")} · ${namen.size} Namen · Mutes ${mutes} · unmuted-ohne-Steps ${leerAktiv} · Ref-Fehler ${refFehl} · Chain-Fehler ${chainFehl} · Bank ${nummern.size} Samples, ${benutzt.size} benutzt, unbenutzt: ${unbenutzt.length}${unbenutzt.length ? " (" + unbenutzt.slice(0, 12).map((n) => n + " " + bank.slots.find((s) => s && oscToDisplayNumber(s.sampleNumber) === n)?.name.trim()).join(", ") + (unbenutzt.length > 12 ? " …" : "") + ")" : ""}`);
}
console.log(fehler ? `${fehler} Bank(en) mit Fehlern` : "alle Paare konsistent");

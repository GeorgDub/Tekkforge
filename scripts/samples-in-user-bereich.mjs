/**
 * samples-in-user-bereich.mjs — alle Samples einer e2sSample.all in den
 * User-Bereich (Anzeige ab 501) schieben und die bearbeiteten Init-Patterns
 * einer .e2sallpat auf dieselben Samples nachziehen.
 *
 *   npx tsx scripts/samples-in-user-bereich.mjs --bank <e2sSample.all> [--patterns <x.e2sallpat>] --out <ordner> [--ab 501]
 *
 * Bank: Reihenfolge (Tabellenindex) bleibt, erstes Sample wird `--ab` (Anzeige, Default 501;
 * `--ab 19` legt z. B. den KORG-Werkssatz zurueck auf die Stock-Plaetze 19-421);
 * bitgenau per Roh-RIFF-Durchreichung, geändert werden nur Tabellenindex und
 * die drei Nummernfelder im korg/esli-Chunk (+0x08, +0x1C, +0x56). Neben die
 * Bank kommt `<bank>.abbildung.json` (Anzeige alt -> neu, remap-osz-kompatibel).
 * Patterns: nur Init-Patterns ab 151, die vom unberührten Init abweichen;
 * Verweise, die vorher ein Sample trafen, treffen danach dasselbe. Verweise
 * ins Leere (kein Sample unter der Nummer) bleiben stehen.
 * Geräte-Regeln: README „Sample-Nummerierung", core/e2sPatternSampleLink.ts.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { parseE2sBank } from "../src/core/e2sBankReader.ts";
import { buildE2sBank } from "../src/core/e2sBankBuilder.ts";
import { ESLI_OSC_INDEX_OFFSET, ESLI_IMPORT_NUM_OFFSET, ESLI_SAMPLE_INDEX_OFFSET, KORG_SUBCHUNK_ID } from "../src/core/constants.ts";
import { E2S_BODY_SIZE, E2S_ALLPAT_PREFIX_SIZE, E2S_ALLPAT_SLOT_COUNT, E2S_ALLPAT_FILE_SIZE } from "../src/core/e2sExport.ts";
import { remapOszInBody } from "../src/core/oszRemap.ts";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : undefined; };
const bankDatei = arg("bank"), patDatei = arg("patterns"), out = arg("out");
const ab = Number(arg("ab") ?? 501) - 1; // Anzeige -> OSC_0index
if (!Number.isInteger(ab) || ab < 0) { console.error("--ab muss eine Anzeigenummer >= 1 sein"); process.exit(1); }
if (!bankDatei || !out) { console.error("Aufruf: --bank <e2sSample.all> [--patterns <.e2sallpat>] --out <ordner>"); process.exit(1); }
fs.mkdirSync(out, { recursive: true });

// ── Bank ────────────────────────────────────────────────────────────────────
const bank = parseE2sBank(new Uint8Array(fs.readFileSync(bankDatei)), path.basename(bankDatei), { preserveRawRiff: true });
const slots = bank.slots.filter(Boolean).sort((a, b) => a.index - b.index);
const korgPayload = (riff) => {
  const dv = new DataView(riff.buffer, riff.byteOffset, riff.byteLength);
  for (let pos = 12; pos + 8 <= riff.length; ) {
    const ss = dv.getUint32(pos + 4, true);
    if (KORG_SUBCHUNK_ID.every((b, i) => riff[pos + i] === b)) return pos + 8;
    pos += 8 + ss + (ss & 1);
  }
  throw new Error("korg-Chunk fehlt");
};
const abbildung = {};
const inputs = slots.map((s, i) => {
  const neu = ab + i;
  const riff = s.rawRiff.slice();
  const dv = new DataView(riff.buffer, riff.byteOffset, riff.byteLength);
  const k = korgPayload(riff);
  // importNum: fuer User-Samples (ab 500) schreibt das Geraet OSC+50 -> so auch hier;
  // Werkssamples auf 18..420 tragen ihre eigene Zaehlung ab 50 (Slot 18 -> 50), die bleibt.
  const altImp = dv.getUint16(k + ESLI_IMPORT_NUM_OFFSET, true), altOsc = dv.getUint16(k + ESLI_OSC_INDEX_OFFSET, true);
  dv.setUint16(k + ESLI_OSC_INDEX_OFFSET, neu, true);
  dv.setUint16(k + ESLI_SAMPLE_INDEX_OFFSET, neu, true);
  if (altImp === altOsc + 50 || neu >= 500) dv.setUint16(k + ESLI_IMPORT_NUM_OFFSET, Math.min(0xffff, neu + 50), true);
  abbildung[s.sampleNumber + 1] = neu + 1;
  return { slotIndex: neu, sampleNumber: neu, name: s.name, pcmData: s.pcmData, sampleRate: s.sampleRate, channels: s.channels, rawRiff: riff, isDirty: false };
});
const r = buildE2sBank(inputs, { preserveRawRiff: true });
const bankOut = path.join(out, path.basename(bankDatei));
fs.writeFileSync(bankOut, new Uint8Array(r.buffer));
fs.writeFileSync(bankOut + ".abbildung.json", JSON.stringify({ hinweis: "Anzeige alt -> Anzeige neu (1-basiert)", altNachNeu: abbildung }, null, 2));
const first = slots[0]?.sampleNumber + 1, lastNeu = ab + slots.length;
console.log(`${bankOut}: ${slots.length} Samples, vorher ab ${first}, jetzt ${ab + 1}..${lastNeu}${r.warnings.length ? `; Builder: ${r.warnings.join(" | ")}` : ""}`);

// ── Patterns ────────────────────────────────────────────────────────────────
if (patDatei) {
  const pat = new Uint8Array(fs.readFileSync(patDatei));
  if (pat.length !== E2S_ALLPAT_FILE_SIZE) throw new Error(`${patDatei}: ${pat.length} Bytes, keine .e2sallpat (${E2S_ALLPAT_FILE_SIZE})`);
  const hashes = new Map(), hOf = [];
  for (let i = 0; i < E2S_ALLPAT_SLOT_COUNT; i++) {
    const off = E2S_ALLPAT_PREFIX_SIZE + i * E2S_BODY_SIZE;
    const h = crypto.createHash("md5").update(pat.subarray(off, off + E2S_BODY_SIZE)).digest("hex");
    hOf.push(h); if (i >= 150) hashes.set(h, (hashes.get(h) ?? 0) + 1);
  }
  const pristine = [...hashes.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const bericht = { geaendert: [], unbekannt: [] }, bearbeitet = [];
  for (let i = 150; i < E2S_ALLPAT_SLOT_COUNT; i++) {
    if (hOf[i] === pristine) continue;
    const off = E2S_ALLPAT_PREFIX_SIZE + i * E2S_BODY_SIZE;
    if (!(pat[off] === 0x50 && pat[off + 1] === 0x54 && pat[off + 2] === 0x53 && pat[off + 3] === 0x54)) continue;
    bearbeitet.push(i + 1);
    remapOszInBody(pat.subarray(off, off + E2S_BODY_SIZE), abbildung, i, bericht);
  }
  const patOut = path.join(out, path.basename(patDatei));
  fs.writeFileSync(patOut, pat);
  console.log(`${patOut}: bearbeitete Init-Patterns ${bearbeitet.join(", ") || "keine"}; ${bericht.geaendert.length} Part-Verweise nachgezogen`);
  for (const [p, part, alt, neu] of bericht.geaendert) console.log(`  Pattern ${p + 1} Part ${part + 1}: ${alt} -> ${neu}`);
}

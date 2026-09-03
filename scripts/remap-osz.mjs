/**
 * remap-osz.mjs — Pattern-Dateien nach dem Sortieren der Oszillator-Tabelle
 * umnummerieren.
 *
 *   npx tsx scripts/remap-osz.mjs --abbildung <SYSTEM.VSB.osz-abbildung.json> --in <a.e2spat|a.e2sallpat> [--out <b>]
 *
 * Ohne --out wird `<in>` als `<in>.vorher` gesichert und an Ort und Stelle
 * ersetzt. Verweise auf User-Samples (501+) und leere Parts bleiben stehen.
 * Ablauf am Geraet: Pattern Export All → Datei umnummerieren → Import All.
 */
import * as fs from "node:fs";
import { leseOszAbbildung, remapOszDatei } from "../src/core/oszRemap.ts";

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : undefined;
};
const abb = arg("abbildung");
const ein = arg("in");
if (!abb || !ein) {
  console.error("Aufruf: --abbildung <…osz-abbildung.json> --in <.e2spat|.e2sallpat> [--out <datei>]");
  process.exit(1);
}
const abbildung = leseOszAbbildung(fs.readFileSync(abb, "utf8"));
const r = remapOszDatei(new Uint8Array(fs.readFileSync(ein)), abbildung);
const out = arg("out") ?? ein;
if (out === ein) fs.copyFileSync(ein, `${ein}.vorher`);
fs.writeFileSync(out, r.bytes);
console.log(`${out} (${r.art}): ${r.bericht.geaendert.length} Part-Verweis(e) umnummeriert${r.bericht.unbekannt.length ? `; unveraendert, weil nicht in der Abbildung: ${r.bericht.unbekannt.join(", ")}` : ""}`);
for (const [pat, part, alt, neu] of r.bericht.geaendert.slice(0, 40)) console.log(`  Pattern ${pat + 1} Part ${part + 1}: ${alt} → ${neu}`);
if (r.bericht.geaendert.length > 40) console.log(`  … ${r.bericht.geaendert.length - 40} weitere`);

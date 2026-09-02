/**
 * make-firmware.mjs — eine Sammlung in die Hacktribe-Firmware einbrennen.
 *
 *   npx tsx scripts/make-firmware.mjs --basis <SYSTEM.VSB> --ziel <out.VSB> [--sammlung <.tfsam>] [--ab <platz>] [--richtung auf|ab]
 *                                     [--init-pattern <.e2spat>] [--splash <128x64.pbm>] [--basis-egal]
 *
 * `--ab` nummeriert die Sammlung vorher wie der ▲/▼-Knopf im Panel neu (je
 * Art eine Reihe ab diesem Platz); Eintraege hinter der Art-Grenze fallen
 * weg. Ohne `--ab` gelten die Plaetze aus der Datei, und jeder Eintrag
 * braucht einen.
 *
 * Die Basis muss die unveraenderte Hacktribe-Firmware sein (SHA-256 wie in
 * hacktribe/hash/hacked-SYSTEM.VSB.sha) — eine andere Datei wird abgelehnt,
 * es sei denn, `--basis-egal` steht dabei (dann nur Header-Pruefung).
 *
 * Was rauskommt, ist eine SYSTEM.VSB fuer `KORG/electribe sampler/System/`
 * plus die Update-Funktion des Geraets. Siehe Kopf von core/firmwareBau.ts.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { baueFirmware, pruefeFirmware, pruefeBasis, HACKTRIBE_SHA256, dateiOffset, setzeInitPattern, setzeSplash } from "../src/core/firmwareBau.ts";
import { pixelZuSplash, pbmZuPixel } from "../src/core/splash.ts";
import { leseSammlung, nummerierePlaetze } from "../src/core/sammlung.ts";
import { decodeFxPreset } from "../src/core/e2FxPreset.ts";
import { E2_RAM_MAP, addressForSlot } from "../src/core/hacktribeRam.ts";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : fallback;
};
const flag = (name) => process.argv.includes(`--${name}`);

const basisPfad = arg("basis");
const sammlungPfad = arg("sammlung");
const zielPfad = arg("ziel");
const ab = arg("ab");
const richtung = arg("richtung", "auf");
if (!basisPfad || !zielPfad) {
  console.error("Aufruf: --basis <SYSTEM.VSB> --ziel <out.VSB> [--sammlung <.tfsam>] [--ab <platz>] [--richtung auf|ab] [--init-pattern <.e2spat>] [--splash <.pbm>] [--basis-egal]");
  process.exit(1);
}

const sha = (b) => createHash("sha256").update(b).digest("hex");
const basis = new Uint8Array(fs.readFileSync(basisPfad));
const pr = pruefeFirmware(basis);
if (!pr.ok) {
  console.error(`Basis abgelehnt: ${pr.reason}`);
  process.exit(1);
}
const basisSha = sha(basis);
const struktur = pruefeBasis(basis);
if (basisSha !== HACKTRIBE_SHA256) {
  // Eine schon gepatchte TekkForge-Firmware ist als Basis erlaubt, wenn ihre Struktur stimmt.
  if (!struktur.ok && !flag("basis-egal")) {
    console.error(`Basis abgelehnt: nicht die Hacktribe-Firmware (SHA-256 ${basisSha.slice(0, 16)}…) und ${struktur.reason}. Mit --basis-egal trotzdem bauen.`);
    process.exit(1);
  }
  console.log(`Basis ist nicht die unveränderte Hacktribe-Firmware (SHA-256 ${basisSha.slice(0, 16)}…), Struktur ${struktur.ok ? "stimmig — vermutlich schon gepatcht, wird fortgeschrieben" : "NICHT stimmig (--basis-egal)"}.`);
}
if (struktur.ok) console.log(`Basis: IFX-Menü bis Platz ${struktur.ifxMaxIndex + 1}, Grooves bis ${struktur.grooveMaxIndex + 1}, Init-Pattern „${struktur.initPatternName}“.`);

let eintraege = sammlungPfad ? leseSammlung(fs.readFileSync(sammlungPfad, "utf8")).eintraege : [];
if (ab !== undefined) {
  const n = nummerierePlaetze(eintraege, Number(ab), richtung === "ab" ? "ab" : "auf");
  eintraege = n.eintraege.filter((e) => e.platz !== undefined);
  console.log(`Nummeriert ${richtung === "ab" ? "absteigend" : "aufsteigend"} ab Platz ${ab}: ${n.vergeben} mit Platz, ${n.ohnePlatz} fallen weg.`);
}

let r = eintraege.length
  ? baueFirmware(basis, eintraege)
  : { ok: true, bytes: basis.slice(), bericht: { geschrieben: [], ifxMaxVorher: -1, ifxMaxNachher: -1, zaehler: [], grooveMaxVorher: -1, grooveMaxNachher: -1, grooveZaehler: [] } };
if (!r.ok) {
  console.error(`Nicht gebaut: ${r.reason}`);
  process.exit(1);
}

// Init-Pattern (.e2spat) und Startbild (PBM P4, 128 × 64) — optional.
const initPfad = arg("init-pattern");
if (initPfad) {
  try {
    r = { ...r, bytes: setzeInitPattern(r.bytes, new Uint8Array(fs.readFileSync(initPfad))) };
    console.log(`Init-Pattern: ${initPfad}`);
  } catch (e) {
    console.error(`Init-Pattern nicht gesetzt: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
const splashPfad = arg("splash");
if (splashPfad) {
  try {
    r = { ...r, bytes: setzeSplash(r.bytes, pixelZuSplash(pbmZuPixel(new Uint8Array(fs.readFileSync(splashPfad))))) };
    console.log(`Startbild: ${splashPfad}`);
  } catch (e) {
    console.error(`Startbild nicht gesetzt: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
if (!eintraege.length && !initPfad && !splashPfad) {
  console.error("Nichts zu tun: die Sammlung ist leer und weder --init-pattern noch --splash angegeben.");
  process.exit(1);
}

// Rueckleseprobe an der fertigen Datei: jeder Platz traegt den Namen des Eintrags.
const ifxMap = E2_RAM_MAP.find((e) => e.key === "ifxPreset");
const mfxMap = E2_RAM_MAP.find((e) => e.key === "mfxPreset");
let fehl = 0;
for (const g of r.bericht.geschrieben) {
  if (g.art === "groove") continue;
  const off = dateiOffset(addressForSlot(g.art === "mfx" ? mfxMap : ifxMap, g.platz - 1));
  const p = decodeFxPreset(r.bytes.subarray(off, off + 0x20c), g.art === "mfx");
  if (p.name !== g.name.slice(0, 15)) {
    fehl++;
    console.error(`Platz ${g.platz} (${g.art}): erwartet „${g.name}“, gelesen „${p.name}“`);
  }
}
if (fehl) process.exit(1);

fs.mkdirSync(path.dirname(path.resolve(zielPfad)), { recursive: true });
fs.writeFileSync(zielPfad, r.bytes);
const geschrieben = r.bericht.geschrieben;
const arten = ["ifx", "mfx", "groove"].map((a) => [a, geschrieben.filter((g) => g.art === a)]).filter(([, l]) => l.length);
console.log(`\n${zielPfad}`);
console.log(`  Basis   ${basisPfad}  (SHA-256 ${basisSha.slice(0, 16)}…)`);
console.log(`  Ergebnis SHA-256 ${sha(r.bytes)}`);
for (const [a, l] of arten) {
  const plaetze = l.map((g) => g.platz);
  console.log(`  ${a.toUpperCase().padEnd(6)} ${l.length} Presets auf Platz ${Math.min(...plaetze)}–${Math.max(...plaetze)}`);
}
if (r.bericht.zaehler.length) {
  console.log(`  IFX-Menü: bis Platz ${r.bericht.ifxMaxVorher + 1} → bis Platz ${r.bericht.ifxMaxNachher + 1} (13 Zähler gesetzt)`);
} else if (r.bericht.ifxMaxVorher >= 0) {
  console.log(`  IFX-Menü unverändert: bis Platz ${r.bericht.ifxMaxVorher + 1}`);
}
if (r.bericht.grooveZaehler.length) {
  console.log(`  Groove-Menü: bis Platz ${r.bericht.grooveMaxVorher + 1} → bis Platz ${r.bericht.grooveMaxNachher + 1} (4 Zähler gesetzt)`);
}
console.log("\nInstallieren: als SYSTEM.VSB nach KORG/electribe sampler/System/ auf die SD-Karte, dann am Gerät die Update-Funktion.");

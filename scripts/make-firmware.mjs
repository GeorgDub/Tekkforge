/**
 * make-firmware.mjs — eine Sammlung in die Hacktribe-Firmware einbrennen.
 *
 *   npx tsx scripts/make-firmware.mjs --basis <SYSTEM.VSB> --ziel <out.VSB> [--sammlung <.tfsam>] [--ab <platz>] [--richtung auf|ab]
 *                                     [--init-pattern <.e2spat>] [--splash <128x64.pbm>] [--dsp id,id] [--dsp-datei <patch.json>]
 *                                     [--osz-serie X-SAW,X-SINE|alle] [--basis-egal]
 *
 * `--osz-serie` haengt je FM-Programm (X-SAW, X-SQUARE, X-TRI, X-SINE) die
 * Halbtoene −24…+24 an, die Hacktribe nicht hat — 22 je Programm, ab Platz
 * 275. Am Geraet belegt (2026-09-03): Platz 275 „X-SAW -3“ erschien in der
 * Sample-Liste und klang richtig, nachdem die Laufzeitkopie geschrieben war.
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
import { wendeDspPatchAn, leseDspPatchDatei } from "../src/core/dspPatch.ts";
import { DSP_PATCH_REGISTER } from "../src/core/dspPatchRegister.ts";
import { pixelZuSplash, pbmZuPixel } from "../src/core/splash.ts";
import { leseSammlung, nummerierePlaetze } from "../src/core/sammlung.ts";
import { decodeFxPreset } from "../src/core/e2FxPreset.ts";
import { E2_RAM_MAP, addressForSlot } from "../src/core/hacktribeRam.ts";
import { leseOszStandAusFirmware, setzeOszTabelle, liesOsz, decodeOsz, istOszLeer, oszStamm, fmSerieFehlend, OSZ_MAX } from "../src/core/oszTabelle.ts";

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
  console.error("Aufruf: --basis <SYSTEM.VSB> --ziel <out.VSB> [--sammlung <.tfsam>] [--ab <platz>] [--richtung auf|ab] [--init-pattern <.e2spat>] [--splash <.pbm>] [--dsp id,id] [--dsp-datei <patch.json>] [--osz-serie X-SAW,X-SINE|alle] [--basis-egal]");
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
// DSP-Patches (experimentell): --dsp id1,id2 aus dem Register, --dsp-datei <json> als eigener Patch.
const dspIds = (arg("dsp") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const dspDatei = arg("dsp-datei");
const dspPatches = [];
for (const id of dspIds) {
  const p = DSP_PATCH_REGISTER.find((x) => x.id === id);
  if (!p) {
    console.error(`Unbekannter DSP-Patch „${id}“. Bekannt: ${DSP_PATCH_REGISTER.map((x) => x.id).join(", ")}`);
    process.exit(1);
  }
  dspPatches.push(p);
}
if (dspDatei) {
  try {
    dspPatches.push(leseDspPatchDatei(fs.readFileSync(dspDatei, "utf8"), path.basename(dspDatei).replace(/\.json$/i, "")));
  } catch (e) {
    console.error(`DSP-Patch-Datei nicht lesbar: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
for (const p of dspPatches) {
  const d = wendeDspPatchAn(r.bytes, p);
  if (!d.ok) {
    console.error(`DSP-Patch nicht gesetzt: ${d.reason}`);
    process.exit(1);
  }
  r = { ...r, bytes: d.bytes };
  console.log(`DSP-Patch: ${p.titel} (${p.status}) — ${d.stellen.map((s) => `${s.bytes} B @ 0x${s.offset.toString(16).toUpperCase()}`).join(", ")} ⚠ experimentell, Hörprobe am Gerät`);
}
// Oszillator-Varianten: --osz-serie X-SAW,X-SINE oder alle — je FM-Programm
// die Halbtoene −24…+24 anhaengen, die Hacktribe nicht hat (22 je Programm).
// Die Firmware braucht nur Tabelle + Beschreiber: der Start legt die
// Laufzeitkopie selbst an (siehe OSZ_LAUFZEIT_ADDR in core/oszTabelle.ts).
const oszSerie = arg("osz-serie");
let oszBericht = null;
if (oszSerie) {
  const stand = leseOszStandAusFirmware(r.bytes);
  if (!stand.ok) {
    console.error(`Oszillator-Tabelle: ${stand.reason}`);
    process.exit(1);
  }
  const vorlagen = new Map();
  for (let p = 1; p <= stand.anzahl; p++) {
    const b = liesOsz(r.bytes, p);
    if (istOszLeer(b)) continue;
    const d = decodeOsz(b);
    if (d.kategorie === 0x0a && !vorlagen.has(d.programm)) vorlagen.set(d.programm, { platz: p, stamm: oszStamm(d.name) });
  }
  const bekannt = [...vorlagen.values()].map((v) => v.stamm);
  const wunsch = oszSerie.toLowerCase() === "alle" ? bekannt : oszSerie.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const fremd = wunsch.filter((w) => !bekannt.includes(w));
  if (fremd.length) {
    console.error(`Unbekanntes FM-Programm „${fremd.join("“, „")}“. In der Basis: ${bekannt.join(", ")} (oder „alle“).`);
    process.exit(1);
  }
  const neu = [];
  let platz = stand.anzahl + 1;
  const jeProgramm = [];
  for (const v of [...vorlagen.values()].filter((v) => wunsch.includes(v.stamm))) {
    const s = fmSerieFehlend(r.bytes, v.platz, stand.anzahl, neu.map((n) => n.bytes));
    if (!s.ok) {
      console.error(`FM-Serie ${v.stamm}: ${s.reason}`);
      process.exit(1);
    }
    for (const e of s.eintraege) neu.push({ platz: platz++, bytes: e.bytes });
    jeProgramm.push(`${v.stamm} ${s.eintraege.length}`);
  }
  if (platz - 1 > OSZ_MAX) {
    console.error(`${neu.length} Varianten passen nicht: die Tabelle endet bei Platz ${OSZ_MAX}, gebraucht würden ${platz - 1}.`);
    process.exit(1);
  }
  const t = setzeOszTabelle(r.bytes, neu);
  if (!t.ok) {
    console.error(`Oszillator-Varianten nicht gesetzt: ${t.reason}`);
    process.exit(1);
  }
  r = { ...r, bytes: t.bytes };
  oszBericht = { von: stand.anzahl + 1, bis: platz - 1, n: neu.length, jeProgramm };
  console.log(`Oszillator-Varianten: ${neu.length} auf Platz ${oszBericht.von}–${oszBericht.bis} (${jeProgramm.join(", ")}); Liste bis ${stand.anzahl} → bis ${oszBericht.bis}`);
}
if (!eintraege.length && !initPfad && !splashPfad && !dspPatches.length && !oszBericht) {
  console.error("Nichts zu tun: die Sammlung ist leer und weder --init-pattern, --splash, --dsp noch --osz-serie angegeben.");
  process.exit(1);
}

// Rueckleseprobe an der fertigen Datei: jeder Platz traegt den Namen, der in
// den BYTES des Eintrags steht — nicht das Etikett aus der Sammlungs-Datei.
// Das Etikett darf abweichen (Umlaute, von Hand geaendert); die Bytes koennen
// nur ASCII tragen, und genau die landen in der Firmware.
const ifxMap = E2_RAM_MAP.find((e) => e.key === "ifxPreset");
const mfxMap = E2_RAM_MAP.find((e) => e.key === "mfxPreset");
const eintragFuer = (g) => eintraege.find((e) => e.art === g.art && e.platz === g.platz);
let fehl = 0;
for (const g of r.bericht.geschrieben) {
  if (g.art === "groove") continue;
  const off = dateiOffset(addressForSlot(g.art === "mfx" ? mfxMap : ifxMap, g.platz - 1));
  const p = decodeFxPreset(r.bytes.subarray(off, off + 0x20c), g.art === "mfx");
  const quelle = eintragFuer(g);
  const soll = quelle ? decodeFxPreset(quelle.bytes, g.art === "mfx").name : g.name.slice(0, 15);
  if (p.name !== soll) {
    fehl++;
    console.error(`Platz ${g.platz} (${g.art}): erwartet „${soll}“, gelesen „${p.name}“`);
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
if (oszBericht) {
  // Rueckleseprobe an der fertigen Datei: Beschreiber und Namen der neuen Plaetze.
  const nach = leseOszStandAusFirmware(r.bytes);
  const namen = [];
  for (let p = oszBericht.von; p <= oszBericht.bis; p++) namen.push(decodeOsz(liesOsz(r.bytes, p)).name);
  console.log(`  Oszillatoren: ${oszBericht.n} Varianten auf Platz ${oszBericht.von}–${oszBericht.bis}, Beschreiber ${nach.ok ? `zählen ${nach.anzahl}` : `FEHLER: ${nach.reason}`}; ${namen[0]} … ${namen[namen.length - 1]}`);
}
console.log("\nInstallieren: als SYSTEM.VSB nach KORG/electribe sampler/System/ auf die SD-Karte, dann am Gerät die Update-Funktion.");

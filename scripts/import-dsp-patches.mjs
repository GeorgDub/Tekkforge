/**
 * import-dsp-patches.mjs — Omnitribes BF523-Patch-Dateien in das TekkForge-
 * Register uebersetzen (`src/core/dspPatchRegister.ts`).
 *
 *   npx tsx scripts/import-dsp-patches.mjs [omnitribe-patch-ordner] [hacktribe-SYSTEM.VSB]
 *
 * Omnitribe (`../Omnitribe/src/firmware/patches/*.json`) kennt drei Formen:
 *   - eine Liste von {vaddr, old, new, label}
 *   - ein Objekt mit old/new (Fenster) und vaddr_window
 *   - ein Objekt mit fill_repr (alle Eintraege auf einen Wert) oder einer
 *     Transformation („INVERT ramp") — dann kommen die alten Bytes aus dem
 *     Fenster der Hacktribe-Datei (vsb_file_off, bytes), und die neuen werden
 *     hier berechnet.
 * Jeder Patch bekommt Titel, deutsche Kurzbeschreibung und einen ehrlichen
 * Status. Was Omnitribe nur als Hypothese fuehrt, bleibt Hypothese.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ORDNER = process.argv[2] ?? "../Omnitribe/src/firmware/patches";
const VSB = process.argv[3] ?? "../hacktribe/fertige firmwares/SYSTEM.VSB";
const ZIEL = "src/core/dspPatchRegister.ts";

const vsb = fs.existsSync(VSB) ? new Uint8Array(fs.readFileSync(VSB)) : null;
const hex = (u) => Array.from(u).map((b) => b.toString(16).padStart(2, "0")).join("");

/** Deutsche Kurzfassung und Status je Patch — von Hand, aus Omnitribes Beschreibungen. */
const TEXTE = {
  bf523_coslut_zero: ["Wellentabelle nullen (Diskriminator)", "Die 129-Punkt-Halbcosinus-Tabelle im L1 auf Null. ✔ Am Gerät gehört (2026-09-03, auf der Gesamtfirmware): „klingt alles unverändert“ — die Tabelle liegt auf keinem hörbaren Pfad, oder das Gerät liest sie nicht aus diesem Block. Damit sind die anderen Wellentabellen-Patches voraussichtlich wirkungslos.", "am-geraet-gehoert"],
  bf523_coslut_halfamp: ["Wellentabelle halbe Amplitude", "Halbcosinus-Tabelle (129 × int16) um 6 dB leiser, gleiche Form. ⚠ Der Diskriminator „nullen“ blieb am Gerät unhörbar (2026-09-03) — voraussichtlich ohne Wirkung. Betrifft Klangquellen, die diese Tabelle lesen (LFO/Oszillator im DSP).", "hoerprobe-offen"],
  bf523_coslut_quarteramp: ["Wellentabelle viertel Amplitude", "Dieselbe Tabelle um 12 dB leiser. ⚠ Der Diskriminator „nullen“ blieb am Gerät unhörbar (2026-09-03) — voraussichtlich ohne Wirkung.", "hoerprobe-offen"],
  bf523_coslut_triangle: ["Wellentabelle Dreieck statt Cosinus", "Die Halbcosinus-Form wird durch eine lineare Rampe mit denselben Endpunkten ersetzt — härterer Verlauf. ⚠ Der Diskriminator „nullen“ blieb am Gerät unhörbar (2026-09-03) — voraussichtlich ohne Wirkung.", "hoerprobe-offen"],
  bf523_blk15_paramcurve_halftop: ["Voice-Kurve: Endpunkt halbiert", "8-stufige int16-Parameterkurve im Sample-Pfad (SDRAM-Block 15): nur der Vollausschlag 0x7FFF → 0x3FFF.", "hoerprobe-offen"],
  bf523_blk15_paramcurve_halfall: ["Voice-Kurve: alles halbiert", "Dieselbe Kurve, alle 8 Stufen halbiert, Form bleibt.", "hoerprobe-offen"],
  bf523_blk15_amount_halfmax: ["Amount-Kurve: Maximum halbiert", "14-stufige float-Kurve 0,02…1,00 im Sample-Pfad: nur das Maximum 1,0 → 0,5. Rolle unklar (Filter-Anteil, Pegel oder Modulationstiefe).", "hoerprobe-offen"],
  bf523_filter_amtcurve_max: ["Amount-Kurve: alles Maximum (A/B)", "Alle 14 Stufen auf 1,0 — A/B-Partner zu „alles Minimum“. Klingt der Unterschied, liegt die Kurve auf einem aktiven Pfad.", "diskriminator"],
  bf523_filter_amtcurve_min: ["Amount-Kurve: alles Minimum (A/B)", "Alle 14 Stufen auf 0,05 — A/B-Partner zu „alles Maximum“.", "diskriminator"],
  bf523_filter_amtcurve_inv: ["Amount-Kurve: umgekehrt", "Die Rampe 0,02…1,00 wird zu 1,00…0,02 — größtmögliche Änderung der Daten bei gleicher Länge.", "hoerprobe-offen"],
  bf523_osc007d0_fullscale: ["Oszillator-Konstante 0x7FFF → 0x7000", "Eine Vollausschlag-Konstante im L1-Code (LOAD R2.H) auf 0x7000 — Code-Immediate, höheres Risiko als Tabellen.", "hoerprobe-offen"],
};

function bytesAus(j, feld) {
  return typeof j[feld] === "string" ? j[feld].replace(/[^0-9a-fA-F]/g, "") : null;
}

function fensterAusVsb(j) {
  if (!vsb) return null;
  const off = Number(j.vsb_file_off ?? j.file_off_window_vsb ?? NaN);
  const n = Number(j.bytes ?? NaN);
  if (!Number.isFinite(off) || !Number.isFinite(n)) return null;
  return hex(vsb.subarray(off, off + n));
}

function umkehrenFloats(altHex) {
  const b = Buffer.from(altHex, "hex");
  const out = Buffer.alloc(b.length);
  const n = b.length / 4;
  for (let i = 0; i < n; i++) b.copy(out, i * 4, (n - 1 - i) * 4, (n - i) * 4);
  return out.toString("hex");
}

const patches = [];
for (const f of fs.readdirSync(ORDNER).filter((x) => x.endsWith(".json")).sort()) {
  const j = JSON.parse(fs.readFileSync(path.join(ORDNER, f), "utf8"));
  const id = f.replace(/\.json$/, "");
  const edits = [];
  if (Array.isArray(j)) {
    for (const e of j) edits.push({ vaddr: e.vaddr, old: e.old.replace(/[^0-9a-fA-F]/g, ""), new: e.new.replace(/[^0-9a-fA-F]/g, "") });
  } else {
    let old = bytesAus(j, "old");
    let neu = bytesAus(j, "new");
    if (!old) old = fensterAusVsb(j);
    if (!neu && j.fill_repr) neu = j.fill_repr.replace(/[^0-9a-fA-F]/g, "");
    if (!neu && old && /INVERT/i.test(j.transform ?? "")) neu = umkehrenFloats(old);
    if (!old || !neu) {
      console.warn(`übersprungen: ${f} — old/new nicht herleitbar`);
      continue;
    }
    if (old.length !== neu.length) {
      console.warn(`übersprungen: ${f} — Längen ${old.length / 2} ≠ ${neu.length / 2}`);
      continue;
    }
    const vaddr = j.vaddr ?? j.vaddr_window;
    edits.push({ vaddr: vaddr && /^0x[0-9a-f]+$/i.test(String(vaddr)) ? vaddr : undefined, old, new: neu });
  }
  const t = TEXTE[id] ?? [id, String(j.desc ?? j[0]?.label ?? ""), "hoerprobe-offen"];
  patches.push({ id, titel: t[0], beschreibung: t[1], status: t[2], edits, quelle: `Omnitribe src/firmware/patches/${f}` });
  console.log(`${id.padEnd(36)} ${edits.length} Änderung(en), ${edits.reduce((a, e) => a + e.old.length / 2, 0)} Bytes`);
}

const ts = `/**
 * dspPatchRegister — bekannte, gleichlange Aenderungen im BF523-DSP-Abbild.
 *
 * ERZEUGT von scripts/import-dsp-patches.mjs aus Omnitribes Patch-Dateien
 * (src/firmware/patches/*.json), nicht von Hand pflegen. Die alten Bytes sind
 * der Fingerabdruck, die neuen die Aenderung; Status ehrlich nach Omnitribes
 * Stand. Details zu Herkunft und Mechanik: core/dspPatch.ts.
 */
import { hexZuBytes, type DspPatch } from "./dspPatch";

const ROH = ${JSON.stringify(patches, null, 1)} as const;

export const DSP_PATCH_REGISTER: readonly DspPatch[] = ROH.map((p) => ({
  id: p.id,
  titel: p.titel,
  beschreibung: p.beschreibung,
  quelle: p.quelle,
  status: p.status as DspPatch["status"],
  edits: p.edits.map((e) => ({ ...(e.vaddr ? { vaddr: Number(e.vaddr) } : {}), alt: hexZuBytes(e.old), neu: hexZuBytes(e.new) })),
}));
`;
fs.writeFileSync(ZIEL, ts);
console.log(`${ZIEL}: ${patches.length} Patches`);

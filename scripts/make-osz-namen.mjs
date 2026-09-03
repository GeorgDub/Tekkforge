/**
 * make-osz-namen.mjs — die Oszillator-Namen zweier Firmwares als TypeScript-
 * Konstanten fuer den Editor (Part-Auswahl „Oszillatoren").
 *
 *   node scripts/make-osz-namen.mjs [<hacktribe.VSB>] [<tekkforge.VSB>]
 *
 * Erzeugt src/core/oszNamen.ts mit OSZ_NAMEN_HACKTRIBE (274, Hacktribes
 * Reihenfolge) und OSZ_NAMEN_TEKKFORGE (362, sortiert: FM je Programm
 * −24…+24, VPM dahinter — die ALLES2-Firmware). Index = Anzeige − 1.
 */
import * as fs from "node:fs";

const HT = process.argv[2] ?? "G:/IdeaProjects/hacktribe/fertige firmwares/SYSTEM.VSB";
const TF = process.argv[3] ?? "G:/Downloads/TekkForge/Firmware/TekkForge-ALLES2-SYSTEM.VSB";
const ZIEL = "src/core/oszNamen.ts";
const BASE = 0xd9bb0;
const KAT = { 0: "Analog", 1: "Audio In", 0x0a: "FM", 0x10: "VPM" };

function namen(pfad) {
  const b = fs.readFileSync(pfad);
  const out = [];
  for (let p = 1; p <= 421; p++) {
    const o = BASE + (p - 1) * 32;
    if (b[o] === 0xff) break;
    let n = "";
    for (let i = 0; i < 15 && b[o + i]; i++) n += String.fromCharCode(b[o + i]);
    out.push([n, KAT[b[o + 0x10]] ?? `Kat. ${b[o + 0x10]}`]);
  }
  return out;
}
const ht = namen(HT);
const tf = fs.existsSync(TF) ? namen(TF) : [];
const liste = (arr) => arr.map(([n, k]) => `  [${JSON.stringify(n)}, ${JSON.stringify(k)}],`).join("\n");
const ts = `/**
 * oszNamen — die Oszillator-Listen (Anzeige „Sample 001 …") zweier Firmwares,
 * erzeugt von scripts/make-osz-namen.mjs aus den SYSTEM.VSB-Dateien
 * (Tabelle bei Datei 0xD9BB0, 32 Bytes je Platz). Index = Anzeige − 1.
 *
 *   - HACKTRIBE: ${ht.length} Plaetze, Hacktribes Reihenfolge (FM 35–142, VPM 143–274).
 *   - TEKKFORGE: ${tf.length} Plaetze, die ALLES2-Firmware — FM je Programm −24…+24
 *     (35–230), VPM 231–362.
 *
 * Der Editor bietet sie in der Part-Auswahl unter „Oszillatoren" an; welche
 * Liste gilt, entscheidet die Einstellung „Oszillator-Liste" (Standard
 * TekkForge, weil das Geraet des Nutzers diese Firmware traegt).
 */
export type OszNameEintrag = readonly [name: string, kategorie: string];

export const OSZ_NAMEN_HACKTRIBE: readonly OszNameEintrag[] = [
${liste(ht)}
];

export const OSZ_NAMEN_TEKKFORGE: readonly OszNameEintrag[] = [
${liste(tf)}
];

export const OSZ_LISTEN = { tekkforge: OSZ_NAMEN_TEKKFORGE, hacktribe: OSZ_NAMEN_HACKTRIBE } as const;
export type OszListe = keyof typeof OSZ_LISTEN;
`;
fs.writeFileSync(ZIEL, ts);
console.log(`${ZIEL}: Hacktribe ${ht.length}, TekkForge ${tf.length}`);

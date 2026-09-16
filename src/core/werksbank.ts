/**
 * werksbank — die unberührte Werks-Pattern-Bank des Geräts als `.e2sallpat`.
 *
 * Der Werksreset (CommandTask-Handler 0x11) nimmt sie aus dem Flash: Selektor 0x63 (0x630000,
 * Werks-Global 0x100) und Selektor 0x64 (0x640000, SQEZ-Strom, entpackt 250 × 0x4000). Genau das
 * bauen wir hier als Datei — aus einem 16-MiB-Dump oder direkt vom Gerät (0x100 + ~128 KiB,
 * gut eine Sekunde). Am Gerät belegt 2026-09-16: CRC stimmt, 243 der 250 Records waren im
 * Flash noch unverändert, Pattern 1 hatte der Nutzer überschrieben.
 */
import { PATTERN_BANK, PATTERN_BANK_FLASH_GROESSE, baueE2sallpat, patternNamenAb } from "./flashKarte";
import { GLOBAL_FLASH } from "./globalFlash";
import { entpackeSqez, liesSqezKopfDaten, SQEZ_KOPF } from "./sqez";
import { liesFlashKomplett, type LesenFlash } from "./geraeteFlash";

export interface WerksbankAbweichung {
  /** 1-basierte Patternnummer */
  nummer: number;
  imFlash: string;
  imWerk: string;
}

export type WerksbankErgebnis =
  | { ok: true; bank: Uint8Array; crcOk: boolean; namen: string[]; abweichungen: WerksbankAbweichung[] | null }
  | { ok: false; grund: string };

/** Aus Werks-Global (0x100) und SQEZ-Strom die Werksbank bauen; `flashRecords` (optional) liefert den Vergleich mit der Pattern-Region. */
export function baueWerksbank(werkGlobal: Uint8Array, sqez: Uint8Array, flashRecords?: Uint8Array): WerksbankErgebnis {
  if (String.fromCharCode(werkGlobal[0], werkGlobal[1], werkGlobal[2], werkGlobal[3]) !== "GLST") return { ok: false, grund: "bei 0x630000 steht kein Werks-Global (GLST)" };
  const r = entpackeSqez(sqez, 0);
  if (!r.ok) return { ok: false, grund: `SQEZ: ${r.grund}` };
  if (r.bytes.length !== PATTERN_BANK.anzahl * PATTERN_BANK.stride) return { ok: false, grund: `SQEZ entpackt ${r.bytes.length} Bytes, erwartet ${PATTERN_BANK.anzahl * PATTERN_BANK.stride}` };
  const stueck = new Uint8Array(PATTERN_BANK_FLASH_GROESSE).fill(0xff);
  stueck.set(werkGlobal.subarray(0, GLOBAL_FLASH.groesse), 0);
  stueck.set(r.bytes, PATTERN_BANK.glstGroesse);
  const bank = baueE2sallpat(stueck);
  const namen = patternNamenAb(r.bytes, 0);
  let abweichungen: WerksbankAbweichung[] | null = null;
  if (flashRecords && flashRecords.length >= r.bytes.length) {
    abweichungen = [];
    const flashNamen = patternNamenAb(flashRecords, 0);
    for (let i = 0; i < PATTERN_BANK.anzahl; i++) {
      const a = r.bytes.subarray(i * PATTERN_BANK.stride, (i + 1) * PATTERN_BANK.stride);
      const b = flashRecords.subarray(i * PATTERN_BANK.stride, (i + 1) * PATTERN_BANK.stride);
      let gleich = true;
      for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) { gleich = false; break; }
      if (!gleich) abweichungen.push({ nummer: i + 1, imFlash: flashNamen[i], imWerk: namen[i] });
    }
  }
  return { ok: true, bank, crcOk: r.crcOk, namen, abweichungen };
}

/** Werksbank aus einem 16-MiB-Dump (mit Vergleich gegen die Pattern-Region 0x240000). */
export function werksbankAusDump(dump: Uint8Array): WerksbankErgebnis {
  if (dump.length < GLOBAL_FLASH.sqez + SQEZ_KOPF) return { ok: false, grund: "kein 16-MiB-Flash-Dump" };
  const kopf = liesSqezKopfDaten(dump, GLOBAL_FLASH.sqez);
  if (!kopf.ok) return { ok: false, grund: "bei 0x640000 steht kein SQEZ-Strom" };
  return baueWerksbank(
    dump.subarray(GLOBAL_FLASH.werk, GLOBAL_FLASH.werk + GLOBAL_FLASH.groesse),
    dump.subarray(GLOBAL_FLASH.sqez, GLOBAL_FLASH.sqez + Math.min(kopf.seriell + SQEZ_KOPF, 0x70000)),
    dump.subarray(PATTERN_BANK.patterns, PATTERN_BANK.patterns + PATTERN_BANK.anzahl * PATTERN_BANK.stride),
  );
}

/** Werksbank direkt vom Gerät: Werks-Global (0x100) + SQEZ-Kopf (16 B) + Strom (Länge aus dem Kopf). Kein Vergleich. */
export async function liesWerksbankVomGeraet(lesen: LesenFlash, opts: { chunk?: number; fortschritt?: (gelesen: number, gesamt: number) => void } = {}): Promise<WerksbankErgebnis> {
  const g = await lesen(GLOBAL_FLASH.werk, GLOBAL_FLASH.groesse);
  if (!g.ok) return { ok: false, grund: `Werks-Global: ${g.reason}` };
  const k = await lesen(GLOBAL_FLASH.sqez, 16);
  if (!k.ok) return { ok: false, grund: `SQEZ-Kopf: ${k.reason}` };
  const kopf = liesSqezKopfDaten(k.bytes);
  if (!kopf.ok) return { ok: false, grund: "bei 0x640000 steht kein SQEZ-Strom" };
  const laenge = Math.min(kopf.seriell + SQEZ_KOPF, 0x70000);
  const r = await liesFlashKomplett(lesen, { start: GLOBAL_FLASH.sqez, gesamt: laenge, chunk: opts.chunk, block: 0x4000, fortschritt: (f) => opts.fortschritt?.(f.gelesen, f.gesamt) });
  if (!r.ok) return { ok: false, grund: `SQEZ-Strom: ${r.reason}` };
  return baueWerksbank(g.bytes, r.bytes);
}

export function werksbankZeile(w: WerksbankErgebnis): string {
  if (!w.ok) return `Werks-Pattern-Bank (SQEZ): ${w.grund}`;
  const ab = w.abweichungen;
  const abText = ab
    ? ab.length
      ? `; im Flash weichen ${ab.length} Records ab: ${ab.slice(0, 6).map((x) => `${x.nummer} „${x.imFlash}“${x.imFlash !== x.imWerk ? ` (Werk „${x.imWerk}“)` : ""}`).join(", ")}${ab.length > 6 ? ", …" : ""}`
      : "; die Pattern-Region ist noch der Werkszustand"
    : "";
  return `Werks-Pattern-Bank (SQEZ 0x640000): 250 Patterns entpackt, CRC ${w.crcOk ? "stimmt" : "FALSCH"}, z. B. ${w.namen.slice(0, 3).map((n) => `„${n}“`).join(", ")}${abText} — als .e2sallpat ausschneidbar`;
}

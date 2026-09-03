/**
 * oszRemap — Oszillator-/Sample-Verweise in Pattern-Dateien umnummerieren.
 *
 * Ein Part zeigt ueber die NUMMER auf seinen Oszillator (u16 bei Part-Offset
 * 0x08, 0-basiert: Anzeige − 1). Wer die Oszillator-Tabelle umsortiert
 * (`--osz-sortieren`), verschiebt Nummern — die Abbildung alt → neu liegt
 * dann als `<ziel>.osz-abbildung.json` neben der Firmware. Hier wird sie auf
 * .e2spat (ein Body bei 0x100) und .e2sallpat (250 Bodies ab 0x10100)
 * angewandt. Verweise, die nicht in der Abbildung stehen (User-Samples 501+,
 * leere Parts), bleiben unveraendert.
 */
import { E2S_BODY_SIZE, E2S_ALLPAT_PREFIX_SIZE, E2S_ALLPAT_SLOT_COUNT, E2S_ALLPAT_FILE_SIZE } from "./e2sExport";

const PARTS_OFF = 0x800;
const PART_STRIDE = 0x330;
const PART_SAMPLE_OFF = 0x08;
const E2SPAT_SIZE = 0x100 + E2S_BODY_SIZE;

/** Abbildung Anzeige alt → Anzeige neu (1-basiert), z. B. aus der JSON-Datei des Firmware-Baus. */
export type OszAbbildung = Readonly<Record<number, number>>;

export interface RemapBericht {
  /** Parts, deren Verweis sich geaendert hat: [Pattern-Index, Part-Index, alt, neu] (Anzeige-Nummern). */
  geaendert: [number, number, number, number][];
  /** Parts mit Verweis ausserhalb der Abbildung (unveraendert gelassen), als Anzeige-Nummern. */
  unbekannt: number[];
}

/** Die Abbildung aus der JSON-Datei des Firmware-Baus (Feld `altNachNeu`) oder einem flachen Objekt. */
export function leseOszAbbildung(text: string): OszAbbildung {
  const j = JSON.parse(text) as Record<string, unknown>;
  const quelle = (typeof j.altNachNeu === "object" && j.altNachNeu ? j.altNachNeu : j) as Record<string, unknown>;
  const out: Record<number, number> = {};
  for (const [k, v] of Object.entries(quelle)) {
    const alt = Number(k);
    const neu = Number(v);
    if (Number.isInteger(alt) && Number.isInteger(neu) && alt >= 1 && neu >= 1) out[alt] = neu;
  }
  if (!Object.keys(out).length) throw new Error("Die Abbildung enthält keine Zuordnungen alt → neu.");
  return out;
}

/** Einen 0x4000-Body umnummerieren (in place). */
export function remapOszInBody(body: Uint8Array, abbildung: OszAbbildung, patternIndex: number, bericht: RemapBericht): void {
  for (let p = 0; p < 16; p++) {
    const off = PARTS_OFF + p * PART_STRIDE + PART_SAMPLE_OFF;
    const ref = body[off] | (body[off + 1] << 8);
    const anzeige = ref + 1;
    const neu = abbildung[anzeige];
    if (neu === undefined) {
      if (anzeige <= 500 && !bericht.unbekannt.includes(anzeige)) bericht.unbekannt.push(anzeige);
      continue;
    }
    if (neu === anzeige) continue;
    const nref = neu - 1;
    body[off] = nref & 0xff;
    body[off + 1] = (nref >> 8) & 0xff;
    bericht.geaendert.push([patternIndex, p, anzeige, neu]);
  }
}

/** .e2spat oder .e2sallpat umnummerieren; liefert die neue Datei und den Bericht. */
export function remapOszDatei(datei: Uint8Array, abbildung: OszAbbildung): { bytes: Uint8Array; bericht: RemapBericht; art: "e2spat" | "e2sallpat" } {
  const out = datei.slice();
  const bericht: RemapBericht = { geaendert: [], unbekannt: [] };
  if (out.length === E2SPAT_SIZE) {
    remapOszInBody(out.subarray(0x100, 0x100 + E2S_BODY_SIZE), abbildung, 0, bericht);
    return { bytes: out, bericht, art: "e2spat" };
  }
  if (out.length === E2S_ALLPAT_FILE_SIZE) {
    for (let i = 0; i < E2S_ALLPAT_SLOT_COUNT; i++) {
      const off = E2S_ALLPAT_PREFIX_SIZE + i * E2S_BODY_SIZE;
      // leere Slots (0xFF) und Init-Patterns ueberspringen: kein PTST-Kopf
      if (!(out[off] === 0x50 && out[off + 1] === 0x54 && out[off + 2] === 0x53 && out[off + 3] === 0x54)) continue;
      remapOszInBody(out.subarray(off, off + E2S_BODY_SIZE), abbildung, i, bericht);
    }
    return { bytes: out, bericht, art: "e2sallpat" };
  }
  throw new Error(`${datei.length} Bytes — weder .e2spat (${E2SPAT_SIZE}) noch .e2sallpat (${E2S_ALLPAT_FILE_SIZE})`);
}

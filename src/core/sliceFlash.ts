/**
 * sliceFlash — die Slice-Metadaten im seriellen Flash (Selektor 0x75, 0x750000, 0x90000 Bytes).
 *
 * Das Gerät legt je Sample einen 0x444-Byte-Record ab (LoadSliceVsbToSerialFlash 0xC003A388,
 * ReadSliceSerialFlashImage 0xC002A1B8 → Pcm_RebuildRuntimeSampleCatalog kopiert ihn in den
 * 0x45C-Laufzeit-Record ab +0x18). Der Record ist der Schwanz des ESLI-Blocks aus der E2S-WAV
 * (ab `ESLI_SLICES_OFFSET` 0x58): 64 Slices à 16 Bytes (Start, Länge, Attack, Amplitude, LE32),
 * 64 Step-Zuordnungen (0xFF = kein Slice), dann Schrittzahl, Beat, Zahl der aktiven Slices, 1 Byte
 * Rest. Am Gerätedump 2026-09-16 belegt: Records 0–402 und 420 beschrieben, 33 davon mit Slices
 * (z. B. 8 Slices auf 32 Schritten, 11 auf 32, 9 auf 16); Record 420 ist ein 0xFF-Rest.
 * Record i gehört mutmaßlich zu Sample i+1 (Werks-Slices der Sampler-PCM; die Bildorganisation
 * nennt electribe2-re „unresolved“).
 */
import { ESLI_SLICES_COUNT, ESLI_SLICE_STRUCT_SIZE, ESLI_SLICE_STEPS_LEN } from "./constants";

export const SLICE_FLASH = { offset: 0x750000, groesse: 0x90000, record: 0x444, anzahl: Math.floor(0x90000 / 0x444) } as const;

export interface SliceEintrag {
  start: number;
  laenge: number;
  attack: number;
  amplitude: number;
}

export interface SliceRecord {
  /** 0-basierter Record-Index (mutmaßlich Sample-Nr − 1) */
  index: number;
  zustand: "leer" | "null" | "belegt" | "rest";
  slices: SliceEintrag[];
  steps: number[];
  schritte: number;
  beat: number;
  aktiv: number;
}

const u32 = (b: Uint8Array, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** Einen 0x444-Record zerlegen. */
export function dekodiereSliceRecord(bytes: Uint8Array, index = 0): SliceRecord {
  const leer: SliceRecord = { index, zustand: "leer", slices: [], steps: [], schritte: 0, beat: 0, aktiv: 0 };
  if (bytes.length < SLICE_FLASH.record) return leer;
  let alleFF = true;
  let alleNull = true;
  for (let i = 0; i < SLICE_FLASH.record; i++) {
    if (bytes[i] !== 0xff) alleFF = false;
    if (bytes[i] !== 0) alleNull = false;
    if (!alleFF && !alleNull) break;
  }
  if (alleFF) return leer;
  if (alleNull) return { ...leer, zustand: "null" };
  const stepsOff = ESLI_SLICES_COUNT * ESLI_SLICE_STRUCT_SIZE;
  const schritte = bytes[stepsOff + ESLI_SLICE_STEPS_LEN];
  const beat = bytes[stepsOff + ESLI_SLICE_STEPS_LEN + 1];
  const aktiv = bytes[stepsOff + ESLI_SLICE_STEPS_LEN + 2];
  if (schritte === 0xff && aktiv === 0xff) return { ...leer, zustand: "rest" };
  const slices: SliceEintrag[] = [];
  for (let k = 0; k < ESLI_SLICES_COUNT; k++) {
    const o = k * ESLI_SLICE_STRUCT_SIZE;
    const s = { start: u32(bytes, o), laenge: u32(bytes, o + 4), attack: u32(bytes, o + 8), amplitude: u32(bytes, o + 12) };
    if (s.start || s.laenge || s.attack || s.amplitude) slices.push(s);
  }
  const steps = Array.from(bytes.subarray(stepsOff, stepsOff + ESLI_SLICE_STEPS_LEN));
  return { index, zustand: "belegt", slices, steps, schritte, beat, aktiv };
}

export interface SliceKarte {
  records: number;
  beschrieben: number;
  mitSlices: SliceRecord[];
  hoechsterIndex: number;
}

/** Alle Records einer Slice-Region (roh, 0x90000 Bytes, oder ein 16-MiB-Dump). */
export function sliceKarte(bytes: Uint8Array): SliceKarte {
  const basis = bytes.length >= SLICE_FLASH.offset + SLICE_FLASH.groesse ? SLICE_FLASH.offset : 0;
  const karte: SliceKarte = { records: SLICE_FLASH.anzahl, beschrieben: 0, mitSlices: [], hoechsterIndex: -1 };
  for (let i = 0; i < SLICE_FLASH.anzahl; i++) {
    const o = basis + i * SLICE_FLASH.record;
    if (o + SLICE_FLASH.record > bytes.length) break;
    const r = dekodiereSliceRecord(bytes.subarray(o, o + SLICE_FLASH.record), i);
    if (r.zustand === "leer") continue;
    karte.beschrieben++;
    karte.hoechsterIndex = i;
    if (r.zustand === "belegt" && r.aktiv > 0) karte.mitSlices.push(r);
  }
  return karte;
}

export function sliceZeile(k: SliceKarte): string {
  if (!k.beschrieben) return "Slice-Region (0x750000): leer";
  const bsp = k.mitSlices.slice(0, 4).map((r) => `Sample ${r.index + 1}: ${r.aktiv} Slices/${r.schritte} Schritte`).join(", ");
  return `Slice-Region (0x750000): ${k.beschrieben} von ${k.records} Records beschrieben (bis Sample ${k.hoechsterIndex + 1}), ${k.mitSlices.length} mit Slices${bsp ? ` — ${bsp}${k.mitSlices.length > 4 ? ", …" : ""}` : ""}`;
}

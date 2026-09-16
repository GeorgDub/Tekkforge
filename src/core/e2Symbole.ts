/**
 * e2Symbole — benannte RAM-Adressen der Sampler-Firmware mit Dekodern für das RAM-Panel.
 *
 * Quelle: Ghidra-Programm HACKTRIBE.bin von vanasoft23 (electribe2-re, Export 2026-09-16 in
 * Omnitribe `docs/reverse/vendor/electribe2-re/ghidra-export/`). Hacktribe patcht die Stock-
 * Sampler-Firmware in-place, TekkForge-Builds bauen darauf auf — die Adressen gelten für alle
 * drei. Für die Synth-Firmware (anderes Layout) gelten sie NICHT; `symbolFuerKarte` sagt das.
 *
 * Nur Lesen. Die Dekoder nehmen die Byte-Fenster, die das RAM-Panel per SysEx 0x52 holt, und
 * werfen bei falscher Fenstergröße — ein halbes Fenster ergäbe stumm falsche Zahlen.
 *
 * ⚠ RAM-Lesen bei LAUFENDEM Sequencer liefert stumm verschobene Daten (Skill-Notiz
 * run-tekkforge). Der Monitor liest darum nur auf Klick und sagt dazu, wann die Lesung gilt.
 */
import type { Familie } from "./firmwareKarte";

const QUELLE = "vanasoft23/electribe2-re, Ghidra HACKTRIBE.bin (Sampler-Layout)";

export interface E2Symbol {
  key: string;
  label: string;
  addr: number;
  /** Gesamtgröße in Bytes (count × stride bei Tabellen). */
  size: number;
  count?: number;
  stride?: number;
  quelle: string;
  hinweis?: string;
}

/** Stimmen-Zuteilung (VoiceTask): 24 Oszillator-Slots, die der ARM an den BF523 vergibt. */
export const STIMMEN = {
  /** g_dwActiveOscillatorVoiceSlotMask — 24-Bit-Spiegel der am DSP aktiven Slots. */
  maske: 0xc06914ec,
  /** g_aArmOscillatorVoiceSlots — 24 × E2_ArmOscillatorVoiceSlot48. */
  slots: 0xc06916a0,
  slotGroesse: 0x48,
  anzahl: 24,
  /** g_acOscillatorVoiceSlotNoteState — Bit 0–6 MIDI-Note, Bit 7 gedrückt. */
  noten: 0xc0691486,
  /** g_abOscillatorVoiceSlotReleaseFlags — Bit 0 losgelassen (normal), Bit 1 losgelassen (One-Shot). */
  release: 0xc069143b,
  /** g_abOscillatorVoiceSlotPriorityOrder — Permutation 0..23 fürs Stehlen. */
  prioritaet: 0xc069146b,
  /** g_wOscillatorVoiceAllocationGeneration — zählt je Noten-Ereignis hoch. */
  generation: 0xc0691484,
  /** g_VoiceTable (Zeigerzelle 0xC009AF54 im Sampler-Abbild) — 16 × voice_t. */
  voiceTabelle: 0xc069ea44,
  voiceGroesse: 0x148,
  voiceAnzahl: 16,
} as const;

/** Batterie-Überwachung (VoiceTaskBatteryMonitorClient, 0x330 Bytes, lazy angelegt). */
export const BATTERIE = {
  /** Zeigervariable auf den Client (aus der Zeigerzelle 0xC003A858 in ProcessVsbUpdateSequence). */
  zeigerVariable: 0xc03405c8,
  /** Fenster ab Client+0x318: Schwellen-Zeiger(4) · chemieGültig(1+3) · Rohwert i32 · Chemie(1+3) · Stufe u32 · Latch(1+3). */
  fensterOffset: 0x318,
  fensterGroesse: 0x18,
  schwellenNiMh: 0xc00e4594,
  schwellenAlkali: 0xc00e4590,
  /** Werte der beiden Schwellentabellen (Rohwert > t0 → Stufe 4 … ≤ t3 → Stufe 0). */
  tabelleNiMh: [134, 129, 124, 97],
  tabelleAlkali: [127, 110, 104, 97],
  /** Ab dieser Stufe lässt das Gerät ein SD-Update zu (ProcessVsbUpdateSequence: Status 0x1A darunter). */
  updateAbStufe: 2,
} as const;

/** Laufzeit-Sample-Katalog (999 × E2_PcmRuntimeSample45C) — Zustand der PCM-/User-Samples. */
export const SAMPLE_LAUFZEIT = {
  base: 0xc036ad88,
  stride: 0x45c,
  count: 999,
  offLaenge: 0x04,
  offStereoRolle: 0x09,
  offLadezustand: 0x0b,
  offRate: 0x10,
} as const;

export const E2_SYMBOLE: readonly E2Symbol[] = [
  { key: "stimmenMaske", label: "Stimmen: aktive Slot-Maske (24 Bit)", addr: STIMMEN.maske, size: 4, quelle: QUELLE },
  { key: "stimmenSlots", label: "Stimmen: 24 Oszillator-Slots (ARM-Seite)", addr: STIMMEN.slots, size: STIMMEN.anzahl * STIMMEN.slotGroesse, count: STIMMEN.anzahl, stride: STIMMEN.slotGroesse, quelle: QUELLE, hinweis: "+0x04 Zeiger auf voice_t (Part), +0x14 DSP-Slot, +0x3A Oszillator-ID, +0x42 One-Shot, +0x43 Betriebsart" },
  { key: "stimmenNoten", label: "Stimmen: Notenzustand je Slot", addr: STIMMEN.noten, size: STIMMEN.anzahl, quelle: QUELLE, hinweis: "Bit 0–6 Note, Bit 7 gedrückt" },
  { key: "stimmenRelease", label: "Stimmen: Release-Flags je Slot", addr: STIMMEN.release, size: STIMMEN.anzahl, quelle: QUELLE, hinweis: "Bit 0 normal, Bit 1 One-Shot" },
  { key: "stimmenPrioritaet", label: "Stimmen: Prioritätsreihenfolge (Steal-Order)", addr: STIMMEN.prioritaet, size: STIMMEN.anzahl, quelle: QUELLE },
  { key: "stimmenGeneration", label: "Stimmen: Zuteilungs-Generation", addr: STIMMEN.generation, size: 2, quelle: QUELLE },
  { key: "voiceTabelle", label: "Parts: 16 × voice_t (0x148)", addr: STIMMEN.voiceTabelle, size: STIMMEN.voiceAnzahl * STIMMEN.voiceGroesse, count: 16, stride: STIMMEN.voiceGroesse, quelle: QUELLE, hinweis: "+0x2E Voice-Assign, +0x31 DSP-Voice, +0x34 Oszillator-ID, +0x38 One-Shot" },
  { key: "batterieZeiger", label: "Batterie: Zeiger auf den Monitor-Client", addr: BATTERIE.zeigerVariable, size: 4, quelle: QUELLE, hinweis: "0 solange kein Update-/Batterie-Pfad lief; sonst Adresse des 0x330-Objekts" },
  { key: "sampleLaufzeit", label: "PCM: Laufzeit-Sample-Katalog (999 × 0x45C)", addr: SAMPLE_LAUFZEIT.base, size: SAMPLE_LAUFZEIT.count * SAMPLE_LAUFZEIT.stride, count: SAMPLE_LAUFZEIT.count, stride: SAMPLE_LAUFZEIT.stride, quelle: QUELLE, hinweis: "+0x04 Länge Bytes, +0x09 Stereo-Rolle, +0x0B geladen, +0x10 Rate" },
  { key: "oszLaufzeit", label: "Oszillatoren: Laufzeitkatalog (999 × 32)", addr: 0xc047b08c, size: 999 * 32, count: 999, stride: 32, quelle: QUELLE, hinweis: "16 Zeichen Name, +0x12 DSP-Selektor (PCM = Selektor − 50)" },
  { key: "sharedControlZeiger", label: "Global: Zeiger auf Shared-Control-Cache", addr: 0xc0691324, size: 4, quelle: QUELLE, hinweis: "→ +0x24 Batterietyp (0 Ni-MH, 1 Alkali), +0x25 Auto-Power-Off, +0x29 Power-Save" },
  { key: "seqRecordsAktiv", label: "Sequencer: Records-aktiv-Tor", addr: 0xc068fc6c, size: 1, quelle: QUELLE },
  { key: "seqCountdown", label: "Sequencer: Timing-Countdown (0x60-Einheiten)", addr: 0xc068fc80, size: 4, quelle: QUELLE },
  { key: "seqOverrun", label: "Sequencer: Transport-Overrun-Flag", addr: 0xc069009c, size: 1, quelle: QUELLE },
  { key: "pcmSpeicherEnde", label: "PCM: CPU-seitiges Speicherende (Zeigerzelle 0xC004E208-Pfad)", addr: 0xc0345a20, size: 4, quelle: QUELLE, hinweis: "Export-Ergebnis-Flag; Speicherende siehe Pcm_GetCurrentSampleStorageEnd" },
];

export function symbolFuer(key: string): E2Symbol | undefined {
  return E2_SYMBOLE.find((s) => s.key === key);
}

/** Gilt die Tabelle für dieses Firmware-Layout? */
export function symbolTabelleGilt(familie: Familie | null | undefined): { ok: true } | { ok: false; grund: string } {
  return familie === "synth" ? { ok: false, grund: "Synth-Firmware: anderes Layout — diese Adressen gelten nur für Sampler/Hacktribe/TekkForge-Builds." } : { ok: true };
}

const u16 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number): number => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
const i32 = (b: Uint8Array, o: number): number => b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24);

export type ReleaseArt = "keine" | "normal" | "oneshot";

export interface StimmenSlot {
  slot: number;
  /** Bit in der DSP-Aktiv-Maske gesetzt. */
  aktiv: boolean;
  /** Part-Index 0–15 aus dem voice_t-Zeiger; null, wenn der Zeiger nicht in die Tabelle zeigt. */
  part: number | null;
  dspSlot: number;
  /** Laufzeit-Oszillator-ID (0–998; Anzeige am Gerät = ID + 1). */
  oszId: number;
  note: number;
  gedrueckt: boolean;
  release: ReleaseArt;
  /** Wie Voice_IsOscillatorSlotInUse: gedrückt ODER ein Release-Flag gesetzt. */
  inBenutzung: boolean;
  oneShot: boolean;
  betriebsart: number;
}

export function dekodiereStimmen(maske: number, slots: Uint8Array, noten: Uint8Array, release: Uint8Array): StimmenSlot[] {
  const n = STIMMEN.anzahl;
  if (slots.length < n * STIMMEN.slotGroesse) throw new Error(`Slot-Fenster zu klein: ${slots.length} < ${n * STIMMEN.slotGroesse}`);
  if (noten.length < n || release.length < n) throw new Error("Noten-/Release-Fenster zu klein");
  const out: StimmenSlot[] = [];
  for (let i = 0; i < n; i++) {
    const o = i * STIMMEN.slotGroesse;
    const owner = u32(slots, o + 0x04);
    const rel = owner - STIMMEN.voiceTabelle;
    const part = rel >= 0 && rel % STIMMEN.voiceGroesse === 0 && rel / STIMMEN.voiceGroesse < STIMMEN.voiceAnzahl ? rel / STIMMEN.voiceGroesse : null;
    const gedrueckt = (noten[i] & 0x80) !== 0;
    const r = release[i] & 0x03;
    const releaseArt: ReleaseArt = r & 0x02 ? "oneshot" : r & 0x01 ? "normal" : "keine";
    out.push({
      slot: i,
      aktiv: ((maske >>> i) & 1) === 1,
      part,
      dspSlot: slots[o + 0x14],
      oszId: u16(slots, o + 0x3a),
      note: noten[i] & 0x7f,
      gedrueckt,
      release: releaseArt,
      inBenutzung: gedrueckt || r !== 0,
      oneShot: slots[o + 0x42] !== 0,
      betriebsart: slots[o + 0x43],
    });
  }
  return out;
}

export interface BatterieStand {
  schwellen: number[];
  roh: number;
  stufe: number;
  chemie: "Ni-MH" | "Alkali" | "?";
  updateErlaubt: boolean;
  plausibel: boolean;
  latch: boolean;
}

/** Fenster = BATTERIE.fensterGroesse Bytes ab Client + BATTERIE.fensterOffset. */
export function dekodiereBatterie(fenster: Uint8Array): BatterieStand {
  if (fenster.length < BATTERIE.fensterGroesse) throw new Error(`Batterie-Fenster zu klein: ${fenster.length} < ${BATTERIE.fensterGroesse}`);
  const zeiger = u32(fenster, 0);
  const chemieByte = fenster[0x0c];
  const stufe = u32(fenster, 0x10);
  const schwellen = zeiger === BATTERIE.schwellenNiMh ? [...BATTERIE.tabelleNiMh] : zeiger === BATTERIE.schwellenAlkali ? [...BATTERIE.tabelleAlkali] : [];
  const chemie: BatterieStand["chemie"] = schwellen.length ? (zeiger === BATTERIE.schwellenNiMh ? "Ni-MH" : "Alkali") : chemieByte === 0 && fenster[4] ? "Ni-MH" : chemieByte === 1 && fenster[4] ? "Alkali" : "?";
  const plausibel = schwellen.length > 0 && stufe <= 4;
  return { schwellen, roh: i32(fenster, 8), stufe, chemie, updateErlaubt: plausibel && stufe >= BATTERIE.updateAbStufe, plausibel, latch: fenster[0x14] !== 0 };
}

export interface SampleStand {
  /** Katalog-Index (0-basiert; User-Samples ab 500). */
  index: number;
  /** Anzeige-Nummer am Gerät = Index + 1. */
  anzeige: number;
  geladen: boolean;
  laengeBytes: number;
  rate: number;
  stereoRolle: number;
}

/** `records` = anzahl × 0x45C Bytes ab Katalog-Index `abIndex` (0-basiert). */
export function dekodiereSampleStand(records: Uint8Array, anzahl: number, abIndex = 0): SampleStand[] {
  if (records.length < anzahl * SAMPLE_LAUFZEIT.stride) throw new Error("Sample-Fenster zu klein");
  const out: SampleStand[] = [];
  for (let i = 0; i < anzahl; i++) {
    const o = i * SAMPLE_LAUFZEIT.stride;
    out.push({
      index: abIndex + i,
      anzeige: abIndex + i + 1,
      geladen: records[o + SAMPLE_LAUFZEIT.offLadezustand] === 1,
      laengeBytes: u32(records, o + SAMPLE_LAUFZEIT.offLaenge),
      rate: u32(records, o + SAMPLE_LAUFZEIT.offRate),
      stereoRolle: records[o + SAMPLE_LAUFZEIT.offStereoRolle],
    });
  }
  return out;
}

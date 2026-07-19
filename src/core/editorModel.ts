/**
 * editorModel.ts — Datenmodell + Export-Logik des Pattern-Editors.
 *
 * Reine Logik (kein DOM): Patterns von Grund auf erstellen, Samples aus WAV
 * importieren (Downmix→Mono + Resample auf 44.1/48 kHz via convertToE2sSpec),
 * Projekt als JSON serialisieren und importfertige Geräte-Dateien bauen:
 *   - `.e2spat`     Einzel-Pattern (16640 Bytes, buildE2PatternFileV2)
 *   - `.e2sallpat`  250-Slot-Bank (4 161 792 Bytes, buildE2AllPatFile)
 *   - `.all`        Sample-Bank (buildE2sBank), User-Nummern ab 501
 */

import type { E2PatternInput } from "./electribePatternBuilder";
import { buildE2AllPatFile, buildE2PatternFileV2 } from "./e2sExport";
import { buildE2sBank, type E2sSlotInput } from "./e2sBankBuilder";
import { convertToE2sSpec, downmixToMono } from "./audioProcessor";
import { parseWav, encodeWav16, bytesToBase64, base64ToBytes } from "./wavCodec";
import { parseElectribeBank, type ParsedPattern } from "./electribeImport";
import { parseE2sBank, type E2sBank } from "./e2sBankReader";

export const EDITOR_PARTS = 16;
export const EDITOR_MAX_STEPS = 64;
/** User-Sample-Nummern beginnen bei 501 (Factory 1..~500). */
export const EDITOR_SAMPLE_BASE = 501;
/** Höchste sinnvolle Geräte-Sample-Nummer. */
export const EDITOR_SAMPLE_MAX = 999;
/** MIDI-Note "Originaltonhöhe" (C4 = 60 = 0x3C, Briefing §4.1 + Hardtekk). */
export const EDITOR_DEFAULT_NOTE = 0x3c;
export const EDITOR_DEFAULT_VELOCITY = 96;
/** Gate-Länge 1..96 (96 = Tie). Default 72 wie Init-Template/Hardtekk. */
export const EDITOR_DEFAULT_GATE = 72;
export const EDITOR_GATE_MAX = 96;

/** Festes Part-Layout aus dem TekkForge-Briefing (Kick=1, Snare=3, Bass=9 …). */
export const PART_LAYOUT_LABELS: readonly string[] = [
  "Kick",
  "Kick 2",
  "Snare",
  "Clap",
  "HiHat cl",
  "HiHat op",
  "Perc 1",
  "Perc 2",
  "Bass",
  "Bass 2",
  "Lead",
  "Stab 1",
  "Stab 2",
  "Stab 3",
  "Pad",
  "FX",
];

export interface EditorStep {
  on: boolean;
  /** 1..127. */
  velocity: number;
  /** MIDI 0..127 (60 = C4 = Originaltonhöhe). */
  note: number;
  /** Gate-Länge 1..96 (96 = Tie). */
  gate: number;
}

export interface EditorPart {
  label: string;
  /** Geräte-Sample-Nummer (501+) oder null = kein Sample zugewiesen. */
  sampleNumber: number | null;
  /** 0..127. */
  volume: number;
  /** 0..127, 64 = Center. */
  pan: number;
  /** Immer EDITOR_MAX_STEPS Einträge; stepLength bestimmt den genutzten Teil. */
  steps: EditorStep[];
}

export interface EditorPattern {
  name: string;
  bpm: number;
  stepLength: 16 | 32 | 64;
  parts: EditorPart[];
}

export interface PoolSample {
  /** Geräte-Nummer (501+), eindeutig im Pool. */
  number: number;
  name: string;
  /** 44100 oder 48000 nach Import-Pipeline. */
  sampleRate: number;
  /** Mono-Float32. */
  pcm: Float32Array;
}

export interface EditorProject {
  version: 1;
  patterns: EditorPattern[];
  samples: PoolSample[];
}

// ─── Factories ───────────────────────────────────────────────────────────────

export function createStep(): EditorStep {
  return {
    on: false,
    velocity: EDITOR_DEFAULT_VELOCITY,
    note: EDITOR_DEFAULT_NOTE,
    gate: EDITOR_DEFAULT_GATE,
  };
}

export function createPart(label: string): EditorPart {
  return {
    label,
    sampleNumber: null,
    volume: 127,
    pan: 64,
    steps: Array.from({ length: EDITOR_MAX_STEPS }, createStep),
  };
}

export function createPattern(name: string): EditorPattern {
  return {
    name,
    bpm: 165,
    stepLength: 16,
    parts: PART_LAYOUT_LABELS.map((l) => createPart(l)),
  };
}

export function createProject(): EditorProject {
  return { version: 1, patterns: [createPattern("PATTERN 1")], samples: [] };
}

export function clonePattern(p: EditorPattern): EditorPattern {
  return JSON.parse(JSON.stringify(p)) as EditorPattern;
}

// ─── Sample-Pool ─────────────────────────────────────────────────────────────

/** Nächste freie Geräte-Nummer ab 501. */
export function nextFreeSampleNumber(samples: readonly PoolSample[]): number {
  const used = new Set(samples.map((s) => s.number));
  for (let n = EDITOR_SAMPLE_BASE; n <= EDITOR_SAMPLE_MAX; n++) {
    if (!used.has(n)) return n;
  }
  throw new Error("Kein freier Sample-Slot mehr (501..999 belegt)");
}

/**
 * Importiert eine WAV-Datei in den Pool: parse → Downmix Mono → Resample
 * (44.1 kHz, poly-phase) → nächste freie Nummer. Gibt das neue PoolSample
 * zurück (Pool wird NICHT mutiert — Aufrufer pusht selbst).
 */
export function importSampleFromWav(
  bytes: Uint8Array,
  filename: string,
  existing: readonly PoolSample[],
): PoolSample {
  const p = processWavToMono(bytes, filename);
  return { number: nextFreeSampleNumber(existing), ...p };
}

/** Filtert einen Sample-Namen auf druckbares ASCII, max 16 Zeichen. */
export function sanitizeSampleName(name: string): string {
  return name.replace(/[^\x20-\x7e]+/g, "").trim().slice(0, 16) || "Sample";
}

/**
 * WAV → E2S-Mono-Audio (Parse → Downmix → Resample 44.1/48 kHz), OHNE
 * Slot-Nummer. Basis für Neu-Import UND Audio-Replace eines Slots.
 */
export function processWavToMono(
  bytes: Uint8Array,
  filename: string,
): { name: string; sampleRate: number; pcm: Float32Array } {
  const wav = parseWav(bytes);
  if (wav.frames === 0) throw new Error(`"${filename}" enthält kein Audio`);
  const channels = wav.channels === 1 ? 1 : 2;
  // >2 Kanäle: nimm die ersten beiden (interleaved extrahieren)
  let pcm = wav.pcm;
  if (wav.channels > 2) {
    pcm = new Float32Array(wav.frames * 2);
    for (let i = 0; i < wav.frames; i++) {
      pcm[i * 2] = wav.pcm[i * wav.channels];
      pcm[i * 2 + 1] = wav.pcm[i * wav.channels + 1];
    }
  }
  const processed = convertToE2sSpec(pcm, wav.sampleRate, channels, {
    forceMono: true,
    targetSampleRate: wav.sampleRate === 48000 ? 48000 : 44100,
  });
  return {
    name: sanitizeSampleName(filename.replace(/\.[^.]+$/, "")),
    sampleRate: processed.sampleRate,
    pcm: processed.pcm,
  };
}

// ─── Export ──────────────────────────────────────────────────────────────────

export function patternToE2Input(p: EditorPattern): E2PatternInput {
  return {
    name: p.name,
    bpm: p.bpm,
    stepLength: p.stepLength,
    parts: p.parts.map((part) => ({
      volume: part.volume,
      pan: part.pan,
      sampleId: part.sampleNumber ?? undefined,
      steps: part.steps.slice(0, p.stepLength).map((s) => ({
        active: s.on,
        velocity: s.velocity,
        note: s.note,
        gate: s.gate,
      })),
    })),
  };
}

/** Einzel-Pattern als .e2spat (16640 Bytes). */
export function buildPatternFile(p: EditorPattern): Uint8Array {
  return new Uint8Array(buildE2PatternFileV2(patternToE2Input(p)));
}

// ─── Import (.e2spat / .e2sallpat → Editor) ──────────────────────────────────

const STEP_LENGTHS = [16, 32, 64] as const;

function coerceStepLength(n: number): 16 | 32 | 64 {
  return STEP_LENGTHS.includes(n as 16 | 32 | 64) ? (n as 16 | 32 | 64) : 16;
}

/** True, wenn das Pattern mindestens einen aktiven Step hat. */
export function patternHasContent(p: EditorPattern): boolean {
  return p.parts.some((part) => part.steps.some((s) => s.on));
}

/**
 * Mappt ein geparstes Electribe-Pattern (aus einer .e2spat/.e2sallpat-Datei)
 * zurück ins Editor-Modell. Part-Labels kommen aus dem festen Layout (die
 * Datei speichert keine Part-Namen). sampleId 0 → kein Sample.
 */
export function editorPatternFromParsed(p: ParsedPattern): EditorPattern {
  const stepLength = coerceStepLength(p.stepLength);
  const parts: EditorPart[] = Array.from({ length: EDITOR_PARTS }, (_, pi) => {
    const src = p.parts[pi];
    const part = createPart(PART_LAYOUT_LABELS[pi] ?? `Part ${pi + 1}`);
    if (!src) return part;
    part.sampleNumber = src.sampleId > 0 ? src.sampleId : null;
    part.volume = clamp127(src.volume, 127);
    part.pan = clamp127(src.pan, 64);
    for (let si = 0; si < EDITOR_MAX_STEPS; si++) {
      const st = src.steps[si];
      if (!st) continue;
      part.steps[si] = {
        on: !!st.active,
        velocity: clampRange(st.velocity, 1, 127, EDITOR_DEFAULT_VELOCITY),
        note: clampRange(st.note ?? EDITOR_DEFAULT_NOTE, 0, 127, EDITOR_DEFAULT_NOTE),
        // 0xFF-Tie-Sentinel oder 96 → Tie (Editor kennt nur 1..96).
        gate:
          st.gate === undefined || st.gate >= EDITOR_GATE_MAX
            ? EDITOR_GATE_MAX
            : clampRange(st.gate, 1, EDITOR_GATE_MAX, EDITOR_DEFAULT_GATE),
      };
    }
    return part;
  });
  return {
    name: (p.name || "PATTERN").slice(0, 16),
    bpm: clampRange(p.bpm, 20, 300, 120),
    stepLength,
    parts,
  };
}

function clamp127(v: number, def: number): number {
  return clampRange(v, 0, 127, def);
}
function clampRange(v: number, lo: number, hi: number, def: number): number {
  if (!Number.isFinite(v)) return def;
  return Math.min(hi, Math.max(lo, Math.round(v)));
}

export interface ImportE2Result {
  patterns: EditorPattern[];
  /** Anzahl im File gefundener Patterns (vor dem Leer-Filter). */
  totalInFile: number;
  /** True, wenn nur belegte Patterns übernommen wurden. */
  filteredEmpty: boolean;
}

/**
 * Parst eine `.e2spat`- oder `.e2sallpat`-Datei und liefert Editor-Patterns.
 * `onlyNonEmpty` (default true) überspringt leere Init-Slots — nützlich, damit
 * aus einer 250-Slot-Bank nicht 218 leere Grids importiert werden. Bleibt so
 * nichts übrig, wird das erste Pattern trotzdem behalten.
 */
export function importE2Patterns(bytes: Uint8Array, onlyNonEmpty = true): ImportE2Result {
  const bank = parseElectribeBank(bytes);
  const all = bank.patterns.map(editorPatternFromParsed);
  if (!onlyNonEmpty) return { patterns: all, totalInFile: all.length, filteredEmpty: false };
  const nonEmpty = all.filter(patternHasContent);
  const patterns = nonEmpty.length > 0 ? nonEmpty : all.slice(0, 1);
  return {
    patterns,
    totalInFile: all.length,
    filteredEmpty: patterns.length < all.length,
  };
}

// ─── Import (.all → Sample-Pool) ─────────────────────────────────────────────

/**
 * Wandelt eine geparste `.all`-Sample-Bank in Pool-Samples (mono). Stereo-Slots
 * werden gemischt. Die vom Gerät angezeigte Nummer (sampleNumber, z.B. 501+)
 * bleibt erhalten — so linken die importierten Pattern-Parts direkt.
 */
export function poolSamplesFromE2sBank(bank: E2sBank): PoolSample[] {
  const out: PoolSample[] = [];
  for (const slot of bank.slots) {
    if (!slot) continue;
    let pcm = slot.pcmData;
    if (slot.channels === 2) pcm = downmixToMono(pcm).pcm;
    out.push({
      number: slot.sampleNumber,
      name: (slot.name || `Sample ${slot.sampleNumber}`).slice(0, 16),
      sampleRate: slot.sampleRate,
      pcm,
    });
  }
  return out;
}

/** Convenience: `.all`-Bytes → Pool-Samples. */
export function importSamplesFromAll(bytes: Uint8Array): PoolSample[] {
  return poolSamplesFromE2sBank(parseE2sBank(bytes, "import.all"));
}

/**
 * Baut ein Editor-Projekt aus einer Pattern-Bank (.e2sallpat/.e2spat) plus
 * optionaler Sample-Bank (.all). Genau der Weg für „ESX-Converter-Ergebnis im
 * Editor öffnen" (allpat + all aus convertEsxToE2sBank) und für den
 * Datei-Import mit begleitender .all.
 */
export function editorProjectFromE2Files(
  allpatBytes: Uint8Array,
  allBytes?: Uint8Array | null,
): EditorProject {
  const { patterns } = importE2Patterns(allpatBytes, true);
  const samples = allBytes ? importSamplesFromAll(allBytes) : [];
  return { version: 1, patterns: patterns.length ? patterns : [createPattern("PATTERN 1")], samples };
}

export interface BankBuildResult {
  /** .e2sallpat (4 161 792 Bytes). */
  allpat: Uint8Array;
  /** .all Sample-Bank (leer wenn Pool leer — dann nicht anbieten). */
  all: Uint8Array | null;
  /** Nicht-blockierende Hinweise (z.B. Part zeigt auf fehlende Sample-Nummer). */
  warnings: string[];
}

/** Baut Pattern-Bank + Sample-Bank aus dem Projekt. */
export function buildBankFiles(project: EditorProject): BankBuildResult {
  const warnings: string[] = [];
  const known = new Set(project.samples.map((s) => s.number));
  project.patterns.forEach((p, pi) => {
    p.parts.forEach((part) => {
      const hasSteps = part.steps.some((s) => s.on);
      if (hasSteps && part.sampleNumber !== null && !known.has(part.sampleNumber)) {
        warnings.push(
          `Pattern ${pi + 1} „${p.name}": Part „${part.label}" zeigt auf Sample #${part.sampleNumber}, das nicht im Pool ist`,
        );
      }
      if (hasSteps && part.sampleNumber === null) {
        warnings.push(
          `Pattern ${pi + 1} „${p.name}": Part „${part.label}" hat Steps, aber kein Sample zugewiesen`,
        );
      }
    });
  });

  const allpat = new Uint8Array(
    buildE2AllPatFile(project.patterns.slice(0, 250).map(patternToE2Input)),
  );

  return { allpat, all: buildSampleBank(project.samples), warnings };
}

/**
 * Baut nur die `.all`-Sample-Bank aus einer Sample-Liste (null wenn leer).
 * Samples werden nach Geräte-Nummer sortiert, max 250. Standalone nutzbar zum
 * `.all`-Bearbeiten/Exportieren (unabhängig von Patterns).
 */
export function buildSampleBank(samples: readonly PoolSample[]): Uint8Array | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((a, b) => a.number - b.number).slice(0, 250);
  const slots: E2sSlotInput[] = sorted.map((s, i) => ({
    slotIndex: i,
    sampleNumber: s.number,
    category: 17, // "User"
    name: s.name,
    pcmData: s.pcm,
    sampleRate: s.sampleRate,
    channels: 1,
  }));
  return new Uint8Array(buildE2sBank(slots).buffer);
}

// ─── Sample-Bank bearbeiten (rename/renumber/replace) ────────────────────────

/**
 * Ändert die Geräte-Nummer eines Pool-Samples und remappt ALLE Parts, die
 * darauf zeigen — so bleiben Pattern-Verknüpfungen intakt. Gibt false zurück
 * bei Kollision, out-of-range oder unbekanntem Sample.
 */
export function renumberSample(
  project: EditorProject,
  oldNumber: number,
  newNumber: number,
): boolean {
  if (oldNumber === newNumber) return true;
  if (!Number.isFinite(newNumber) || newNumber < EDITOR_SAMPLE_BASE || newNumber > EDITOR_SAMPLE_MAX)
    return false;
  if (project.samples.some((s) => s.number === newNumber)) return false;
  const s = project.samples.find((x) => x.number === oldNumber);
  if (!s) return false;
  s.number = newNumber;
  for (const p of project.patterns)
    for (const part of p.parts) if (part.sampleNumber === oldNumber) part.sampleNumber = newNumber;
  return true;
}

// ─── Projekt-Serialisierung (.tekkforge JSON, Samples als Base64-WAV) ────────

interface SerializedSample {
  number: number;
  name: string;
  /** 16-bit-Mono-WAV, Base64. */
  wavB64: string;
}

interface SerializedProject {
  app: "tekkforge";
  version: 1;
  patterns: EditorPattern[];
  samples: SerializedSample[];
}

export function serializeProject(project: EditorProject): string {
  const doc: SerializedProject = {
    app: "tekkforge",
    version: 1,
    patterns: project.patterns,
    samples: project.samples.map((s) => ({
      number: s.number,
      name: s.name,
      wavB64: bytesToBase64(encodeWav16(s.pcm, s.sampleRate, 1)),
    })),
  };
  return JSON.stringify(doc);
}

export function deserializeProject(text: string): EditorProject {
  let doc: SerializedProject;
  try {
    doc = JSON.parse(text) as SerializedProject;
  } catch {
    throw new Error("Keine gültige Projekt-Datei (JSON-Fehler)");
  }
  if (doc.app !== "tekkforge" || doc.version !== 1 || !Array.isArray(doc.patterns))
    throw new Error("Keine gültige TekkForge-Projekt-Datei");
  const samples: PoolSample[] = (doc.samples ?? []).map((s) => {
    const wav = parseWav(base64ToBytes(s.wavB64));
    return { number: s.number, name: s.name, sampleRate: wav.sampleRate, pcm: wav.pcm };
  });
  // Patterns defensiv normalisieren (fehlende Felder → Defaults)
  const patterns: EditorPattern[] = doc.patterns.map((p, i) => {
    const base = createPattern(p.name || `PATTERN ${i + 1}`);
    base.bpm = Number.isFinite(p.bpm) ? Math.min(300, Math.max(20, p.bpm)) : 165;
    base.stepLength = p.stepLength === 32 || p.stepLength === 64 ? p.stepLength : 16;
    for (let pi = 0; pi < EDITOR_PARTS; pi++) {
      const src = p.parts?.[pi];
      if (!src) continue;
      const dst = base.parts[pi];
      dst.label = typeof src.label === "string" && src.label ? src.label : dst.label;
      dst.sampleNumber = typeof src.sampleNumber === "number" ? src.sampleNumber : null;
      dst.volume = Number.isFinite(src.volume) ? Math.min(127, Math.max(0, src.volume)) : 127;
      dst.pan = Number.isFinite(src.pan) ? Math.min(127, Math.max(0, src.pan)) : 64;
      for (let si = 0; si < EDITOR_MAX_STEPS; si++) {
        const st = src.steps?.[si];
        if (!st) continue;
        dst.steps[si] = {
          on: !!st.on,
          velocity: Number.isFinite(st.velocity) ? Math.min(127, Math.max(1, st.velocity)) : EDITOR_DEFAULT_VELOCITY,
          note: Number.isFinite(st.note) ? Math.min(127, Math.max(0, st.note)) : EDITOR_DEFAULT_NOTE,
          gate: Number.isFinite(st.gate) ? Math.min(EDITOR_GATE_MAX, Math.max(1, st.gate)) : EDITOR_DEFAULT_GATE,
        };
      }
    }
    return base;
  });
  if (patterns.length === 0) patterns.push(createPattern("PATTERN 1"));
  return { version: 1, patterns, samples };
}

// ─── Anzeige-Helper ──────────────────────────────────────────────────────────

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

/** MIDI-Note → Anzeigename ("60" → "C4", 72 → "C5" Originaltonhöhe). */
export function noteName(midi: number): string {
  const n = Math.min(127, Math.max(0, Math.round(midi)));
  return `${NOTE_NAMES[n % 12]}${Math.floor(n / 12) - 1}`;
}

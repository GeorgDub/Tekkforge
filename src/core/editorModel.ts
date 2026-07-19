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
import { convertToE2sSpec } from "./audioProcessor";
import { parseWav, encodeWav16, bytesToBase64, base64ToBytes } from "./wavCodec";

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
  const name =
    filename
      .replace(/\.[^.]+$/, "")
      .replace(/[^\x20-\x7e]+/g, "")
      .trim()
      .slice(0, 16) || "Sample";
  return {
    number: nextFreeSampleNumber(existing),
    name,
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

  let all: Uint8Array | null = null;
  if (project.samples.length > 0) {
    const sorted = [...project.samples].sort((a, b) => a.number - b.number).slice(0, 250);
    const slots: E2sSlotInput[] = sorted.map((s, i) => ({
      slotIndex: i,
      sampleNumber: s.number,
      category: 17, // "User"
      name: s.name,
      pcmData: s.pcm,
      sampleRate: s.sampleRate,
      channels: 1,
    }));
    all = new Uint8Array(buildE2sBank(slots).buffer);
  }

  return { allpat, all, warnings };
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

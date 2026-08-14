/**
 * esxToE2sBank.ts — Direkt-Converter KORG ESX-1 (.esx) → Electribe 2 Sampler.
 *
 * Produziert aus einem geparsten ESX-1-Backup beides zum Import auf die E2S:
 *   - `.e2sallpat` Pattern-Bank (250 Slots), Parts auf User-Sample-Nummern (501+)
 *     repointet → spielen direkt die mit-konvertierten Samples.
 *   - `.all` Sample-Bank: die von den Patterns genutzten Samples, nummeriert ab
 *     501 (OSC_0index +0x08 + +0x56), korrekt mit WAV_dataSize/playLogPeriod/UFix.
 *
 * Reine TS-Logik (kein DOM) — die UI (EsxToE2sConverter) lädt nur die ESX-Datei
 * und bietet die zurückgegebenen Bytes als Download an.
 *
 * Verknüpfung Pattern↔Sample über die ESX-Sample-Slot-ID (Part.sampleId ==
 * EsxSample.index). Nur Samples, die ein Part mit aktiven Steps triggert, werden
 * exportiert; bei Überschreiten des E2S-Sample-RAMs (~270s mono) werden die
 * überzähligen weggelassen (Report) — das verhindert den "Import-Fehler".
 */

import type { EsxBank, EsxPart, EsxPattern, EsxSample } from "./esxParser";
import { buildE2sBank, type E2sSlotInput } from "./e2sBankBuilder";
import { E2S_SLOT_INDEX_MAX } from "./constants";
import { bankNumberToE2PatternRef } from "./e2sPatternSampleLink";
import { buildE2AllPatFile } from "./e2sExport";
import type { E2PatternInput } from "./electribePatternBuilder";

/** E2S User-Sample-Nummerierung beginnt bei 501 (Factory 1..~500). */
export const E2S_USER_SAMPLE_BASE = 501;
/** Sicherer Mono-Sekunden-Deckel fürs Sample-RAM (Hardware ~270s mono). */
export const E2S_SAMPLE_SECONDS_CAP = 260;
/** MIDI-Note für "keine Tonhöhenänderung" — C4 = 60 = Originaltonhöhe des
 *  Samples (TekkForge-Korrektur: vorher 0x48/C5, was nach dem Step-Layout-Fix
 *  alles +12 Halbtöne transponiert hätte). */
const E2_BASE_NOTE = 0x3c;

export interface EsxToE2sResult {
  /** .e2sallpat-Bytes (4 161 792). */
  allpat: Uint8Array;
  /** .all-Sample-Bank-Bytes. */
  all: Uint8Array;
  /** Mapping/Anleitung (Markdown). */
  mapping: string;
  stats: {
    patterns: number;
    samples: number;
    droppedSamples: number;
    audioSeconds: number;
    activeParts: number;
    linkedParts: number;
  };
}

export interface EsxToE2sOptions {
  userSampleBase?: number;
  secondsCap?: number;
  /**
   * Ziel-Steplänge pro Pattern (Key = EsxPattern.index). ESX kann bis 128
   * Steps, die E2S nur 16/32/64 — fehlt ein Eintrag, greift
   * suggestE2StepLength(). Steps jenseits des Ziels werden abgeschnitten.
   */
  stepTargets?: Record<number, 16 | 32 | 64>;
}

/**
 * Vorschlag für die E2-Steplänge: kleinstes 16/32/64 ≥ Original-Steps;
 * ab 65+ wird bei 64 gecuttet (E2-Hardware-Maximum).
 */
export function suggestE2StepLength(totalSteps: number): 16 | 32 | 64 {
  if (totalSteps <= 16) return 16;
  if (totalSteps <= 32) return 32;
  return 64;
}

/** Linearer Mono-Resampler (dependency-frei). */
function resampleMono(pcm: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || pcm.length === 0) return pcm;
  const ratio = toRate / fromRate;
  const outLen = Math.max(1, Math.round(pcm.length * ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i / ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(pcm.length - 1, i0 + 1);
    const frac = src - i0;
    out[i] = pcm[i0] * (1 - frac) + pcm[i1] * frac;
  }
  return out;
}

/**
 * Konvertiert ein geparstes ESX-1-Backup in E2S-Bank-Dateien.
 */
/**
 * ESX-Filter/Mod → E2-Part-Parameter.
 *
 * Beide Enden sind belegt: die ESX-Offsets gegen open-electribe-editor, die
 * E2-Offsets am Geraet (Messreihe 2026-08-14). Uebertragen wird trotzdem NUR,
 * was in beiden Formaten dieselbe Bedeutung hat.
 *
 * **Uebernommen** — durchgehende 0..127-Werte, gleiche Bedeutung auf beiden
 * Geraeten: Cutoff, Resonanz, Mod-Speed, Mod-Depth.
 *
 * **Bewusst NICHT uebernommen:**
 *
 * - `filterType`. Die Enums sind verschieden: ESX kennt vier Typen
 *   (0=LPF, 1=HPF, 2=BPF, 3=BPF+), das E2-Feld trug im Testpattern Werte bis
 *   16. Eine Zuordnung 0..3 -> 0..3 waere geraten, und ein falscher Filtertyp
 *   klingt nicht „etwas anders", sondern falsch.
 * - `modType`/`modDest`. Dasselbe Problem: ESX hat 0=Saw…4=Env plus ein
 *   getrenntes Ziel-Feld, das E2-Byte lief bis 71 und packt moeglicherweise
 *   mehrere Felder. Ohne Zuordnungstabelle bliebe es Raten.
 * - `egIntensity`. Auf dem E2 ist das Feld **bipolar** (-63..+63, am Geraet
 *   gemessen); die ESX-Seite lesen wir als 0..127. Welcher ESX-Wert der Null
 *   entspricht, ist nicht belegt — ein direkter Uebertrag koennte aus „keine
 *   Modulation" eine volle negative Huellkurve machen.
 *
 * Was nicht uebertragen wird, steht weiterhin im Mapping-Bericht und laesst
 * sich von Hand nachziehen.
 */
function esxFilterToE2Params(
  f: EsxPart["filter"],
): Record<string, number> | undefined {
  if (!f) return undefined;
  const b = (v: number) => Math.max(0, Math.min(127, Math.round(v)));
  return {
    cutoff: b(f.cutoff),
    resonance: b(f.resonance),
    modSpeed: b(f.modSpeed),
    modDepth: b(f.modDepth),
  };
}

export function convertEsxToE2sBank(
  esx: EsxBank,
  opts: EsxToE2sOptions = {},
): EsxToE2sResult {
  const base = opts.userSampleBase ?? E2S_USER_SAMPLE_BASE;
  const secondsCap = opts.secondsCap ?? E2S_SAMPLE_SECONDS_CAP;

  // 1) Nicht-leere Patterns (Name ODER mind. ein aktiver Step), max 250.
  const selected = esx.patterns
    .filter(
      (p) =>
        (p.name && p.name.trim().length > 0) ||
        p.parts.some((pt) => pt.steps.some((s) => s.active)),
    )
    .slice(0, 250);

  // 2) Nur Samples, die ein Part mit aktiven Steps triggert.
  const usedIndices = new Set<number>();
  for (const p of selected) {
    for (const part of p.parts) {
      if (part.steps.some((s) => s.active)) usedIndices.add(part.sampleId);
    }
  }

  // 3) Sample-Liste aufbauen, gedeckelt aufs Sample-RAM (mono-Sekunden).
  //    Mono = Sekunden, Stereo = 2× (interner Speicher-Daumenwert).
  const sampleMap = new Map<number, { hwNumber: number; name: string }>();
  const slots: E2sSlotInput[] = [];
  let audioSeconds = 0;
  let droppedSamples = 0;
  let nextSlot = 0;
  for (const s of esx.monoSamples as EsxSample[]) {
    if (!usedIndices.has(s.index)) continue;
    // Deckel ist jetzt der Slot-INDEX (== Geräte-Nummer), nicht mehr eine
    // Anzahl: oberhalb von E2S_SLOT_INDEX_MAX bietet das Gerät keinen
    // wählbaren Sample-Platz mehr an.
    if (base + nextSlot >= E2S_SLOT_INDEX_MAX) {
      droppedSamples++;
      continue;
    }
    const seconds = s.sampleRate > 0 ? s.frames / s.sampleRate : 0;
    if (audioSeconds + seconds > secondsCap) {
      droppedSamples++;
      continue;
    }
    const targetRate = s.sampleRate === 48000 ? 48000 : 44100;
    const pcm = resampleMono(s.pcmData, s.sampleRate, targetRate);
    const name = (s.name && s.name.trim()) || `ESX ${s.index}`;
    const hwNumber = base + nextSlot;
    sampleMap.set(s.index, { hwNumber, name });
    slots.push({
      // Der Tabellen-Index IST die Geräte-Nummer — nicht die Position in der
      // Auswahl. Früher stand hier `nextSlot` (0,1,2,…), was zusammen mit dem
      // damals falschen Tabellenstart 0x07E0 eine um eins fehlnummerierte Bank
      // ergab (Omnitribe-Geometrie-Check: „Versatz: KONSTANT -1").
      slotIndex: hwNumber,
      sampleNumber: hwNumber,
      category: 17, // "User"
      name,
      pcmData: pcm,
      sampleRate: targetRate,
      channels: 1,
    });
    audioSeconds += seconds;
    nextSlot++;
  }

  // 4) Patterns → E2PatternInput, Parts auf die User-Nummern repointen.
  //    Steplänge: gewähltes Ziel (stepTargets) oder Vorschlag aus der echten
  //    ESX-Länge (bis 128 Steps) — gecuttet auf 16/32/64.
  let activeParts = 0;
  let linkedParts = 0;
  const e2Inputs: E2PatternInput[] = selected.map((p: EsxPattern) => {
    const stepLength = opts.stepTargets?.[p.index] ?? suggestE2StepLength(p.lengthSteps);
    const usedSteps = Math.min(stepLength, p.lengthSteps);
    const parts = p.parts.map((part) => {
      const active = part.steps.slice(0, usedSteps).some((s) => s.active);
      const mapped = sampleMap.get(part.sampleId);
      if (active) {
        activeParts++;
        if (mapped) linkedParts++;
      }
      // Fallback-Note aus Part-Pitch (Drum/Stretch); Keyboard-Steps bringen
      // ihre eigene Note mit (ESX NoteNumber = MIDI, C4=60 = E2-Unity).
      const partNote = Math.max(0, Math.min(127, E2_BASE_NOTE + (part.pitch ?? 0)));
      return {
        volume: part.volume,
        pan: part.pan,
        // Bank-/Geräte-Nummer → Pattern-Referenz (−1, am Gerät gemessen).
        sampleId: mapped
          ? bankNumberToE2PatternRef(mapped.hwNumber)
          : undefined,
        params: esxFilterToE2Params(part.filter),
        steps: part.steps.slice(0, stepLength).map((s, si) => ({
          active: si < usedSteps && !!s.active,
          velocity: typeof s.velocity === "number" && s.velocity > 0 ? s.velocity : undefined,
          accent: !!s.accent,
          note:
            typeof s.note === "number"
              ? Math.max(0, Math.min(127, s.note))
              : partNote,
          // ESX-Gate 0..127 → E2-Gate 1..96 (96 = Tie)
          gate:
            typeof s.gate === "number"
              ? Math.max(1, Math.min(96, Math.round((s.gate * 96) / 127)))
              : undefined,
        })),
      };
    });
    return { name: p.name || "ESX Pattern", bpm: p.bpm, stepLength, parts };
  });

  // 5) Bytes bauen.
  const allpat = new Uint8Array(buildE2AllPatFile(e2Inputs));
  const all = new Uint8Array(buildE2sBank(slots).buffer);

  // 6) Mapping/Anleitung.
  const lines: string[] = [];
  lines.push("# ESX → KORG Electribe 2 Sampler — Import-Anleitung");
  lines.push("");
  lines.push(`Quelle: ${esx.source}`);
  lines.push("");
  lines.push("## Dateien");
  lines.push("- `*.all` → auf SD-Karte (Sample-Ordner), am Gerät importieren. User-Samples ab " + base + ".");
  lines.push("- `*.e2sallpat` → Pattern-Bank importieren. Parts zeigen bereits auf die Nummern.");
  lines.push("");
  lines.push(`## Stats`);
  lines.push(`- Patterns: ${selected.length}`);
  lines.push(`- Samples: ${slots.length} (${audioSeconds.toFixed(1)}s, Limit ~${secondsCap}s)` + (droppedSamples ? `, ${droppedSamples} wegen Speicher weggelassen` : ""));
  lines.push(`- Aktive Parts: ${activeParts}, davon mit Sample verlinkt: ${linkedParts}`);
  lines.push("");
  lines.push("## Sample-Liste (Geräte-Nr. → Name → ESX-Index)");
  lines.push("");
  lines.push("| Geräte-# | Name | ESX-Index |");
  lines.push("|---:|---|---:|");
  for (const [esxIdx, m] of [...sampleMap.entries()].sort((a, b) => a[1].hwNumber - b[1].hwNumber)) {
    lines.push(`| ${m.hwNumber} | ${m.name} | ${esxIdx} |`);
  }

  // Filter-/Mod-Einstellungen der Quelle dokumentieren.
  //
  // Bewusst NUR als Bericht und NICHT in die Pattern-Bytes geschrieben: die
  // ESX-Seite ist verifiziert (open-electribe-editor), die E2-Zielseite aber
  // nicht — `partParams.ts` nennt seine Offsets ausdrücklich experimentell.
  // Unbestätigte Offsets in einen funktionierenden Konvertierungspfad zu
  // schreiben würde eine belegte Funktion gegen eine unbelegte eintauschen.
  // So sieht man wenigstens, was am Gerät eingestellt war, und kann es von
  // Hand nachziehen.
  // Cutoff/Resonanz/Mod-Speed/Mod-Depth werden inzwischen ins Pattern
  // geschrieben (siehe esxFilterToE2Params); der Bericht bleibt fuer die
  // Felder, die bewusst NICHT uebertragen werden.
  const FILTER_NAMES = ["LPF", "HPF", "BPF", "BPF+"];
  const MOD_TYPES = ["Saw", "Square", "Tri", "S&H", "Env"];
  const MOD_DESTS = ["Pitch", "Cutoff", "Amp", "Pan"];
  const mitFilter = selected
    .flatMap((p: EsxPattern) =>
      p.parts.map((part, pi) => ({ p, pi, f: part.filter })),
    )
    .filter((x) => x.f && (x.f.cutoff !== 0 || x.f.resonance !== 0 || x.f.modDepth !== 0));
  if (mitFilter.length > 0) {
    lines.push("");
    lines.push("## Filter/Mod der ESX-Quelle (nur Bericht — nicht übertragen)");
    lines.push("");
    lines.push(
      "**Cutoff, Resonanz, Mod-Speed und Mod-Depth werden übertragen** — beide " +
        "Byte-Offsets sind belegt (ESX gegen open-electribe-editor, E2 am Gerät). " +
        "**Filter-Typ, Mod-Typ/-Ziel und EG-Intensität werden NICHT übertragen**: " +
        "die Enums unterscheiden sich zwischen den Geräten, und EG-Int ist auf " +
        "der E2 bipolar, auf der ESX nicht. Diese Spalten sind zum Nachstellen " +
        "von Hand da.",
    );
    lines.push("");
    lines.push("| Pattern | Part | Filter | Cutoff | Reso | EG-Int | Mod | → Ziel | Speed | Depth |");
    lines.push("|---|---:|---|---:|---:|---:|---|---|---:|---:|");
    for (const { p, pi, f } of mitFilter) {
      if (!f) continue;
      lines.push(
        `| ${p.name || p.index + 1} | ${pi + 1} | ${FILTER_NAMES[f.filterType] ?? f.filterType} | ` +
          `${f.cutoff} | ${f.resonance} | ${f.egIntensity} | ${MOD_TYPES[f.modType] ?? f.modType} | ` +
          `${MOD_DESTS[f.modDest] ?? f.modDest} | ${f.modSpeed} | ${f.modDepth} |`,
      );
    }
  }
  const mapping = lines.join("\n") + "\n";

  return {
    allpat,
    all,
    mapping,
    stats: {
      patterns: selected.length,
      samples: slots.length,
      droppedSamples,
      audioSeconds,
      activeParts,
      linkedParts,
    },
  };
}

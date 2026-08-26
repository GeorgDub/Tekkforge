/**
 * liedZuSet — aus einem Lied ein spielbares Tekk-Set.
 *
 * Derselbe Weg wie der Knopf „Alles aus dem Lied" im Generator, nur ohne
 * Fenster: Tempo und Abschnitte messen → Fenster und Vocal-Segmente schneiden
 * → wahlweise die Stems trennen und aus dem Drums-Stem Kick/Snare/Hat schneiden
 * → Bank planen → Rezept → Aufbau-Kette. Gedacht fuer den Stapelbetrieb: wer
 * sechzehn Lieder umsetzen will, klickt das nicht sechzehnmal durch.
 *
 * Die Stem-Trennung selbst steckt NICHT hier drin — sie laeuft ueber Python
 * (scripts/stems.py) und wird als Funktion hereingereicht. So bleibt dieser
 * Kern rein und pruefbar, und der Aufrufer entscheidet, ob Demucs ueberhaupt
 * verfuegbar ist.
 *
 * ⚠ Ohne Stems entstehen NUR Melodie-Fenster — kein Schlagzeug und keine
 * getrennten Vocals. Ein Set ohne `tekkDrums` haette dann gar keine Kick.
 */

import { analysiereLied } from "./liedAnalyse";
import { voxSegmentEintrag } from "./generatorSession";
import { rmsDb, peakVon, familie, type ScanEintrag } from "./sampleScan";
import { schneideDrums, type DrumTreffer } from "./drumSchnitt";
import { planeBank, type Projekt } from "./bankPlan";
import { regelRezept } from "./rezept";
import { baueAufbau, baueRezept } from "./patternGen";
import type { E2PatternInput } from "./electribePatternBuilder";

/** Kuerzel je Drum-Rolle, wie im Generator-Tab. */
const DRUM_KURZ: Record<string, string> = { kick: "K", snare: "S", hat: "H" };

export interface StemErgebnis {
  id: string;
  melo: Float32Array | null;
  vox: Float32Array | null;
  drums: Float32Array | null;
}

export interface LiedZuSetOptionen {
  /** Name des Lieds (fuer Sample- und Pattern-Namen). */
  name: string;
  /** Zielrichtung fuer die Oktavwahl des Tempos. */
  zielBpm?: number;
  /** Feste BPM statt der gemessenen. */
  bpm?: number;
  /** tekk4-Bank als Schlagzeug-Ersatz, wenn das Lied keins hergibt. */
  tekkDrums?: Uint8Array;
  /** Aufbau-Kette (Vorgabe) oder ein einzelnes Jam-Pattern. */
  aufbau?: boolean;
  /** Vocals mit halber Abtastrate ablegen — doppelte Abdeckung je Megabyte. */
  sparsameVocals?: boolean;
  /**
   * Stem-Trennung. Bekommt die geschnittenen Fenster und gibt Melodie, Vocals
   * und Drums zurueck. Fehlt sie, laeuft der Vollmix-Weg.
   */
  stems?: (fenster: { id: string; pcm: Float32Array; nurVox: boolean }[]) => StemErgebnis[];
}

export interface LiedSet {
  name: string;
  /** Gemessenes Tempo, gewaehlte Oktave und das daraus folgende Tekk-Tempo. */
  gemessen: number;
  oktave: number;
  bpm: number;
  projekt: Projekt;
  bank: ArrayBuffer;
  patterns: E2PatternInput[];
  hinweise: string[];
  /** Was tatsaechlich hineingeflossen ist — fuer den Bericht. */
  zaehler: { fenster: number; vox: number; drums: number };
}

function eintrag(lied: string, label: string, pcm: Float32Array, rolle: ScanEintrag["rolle"]): ScanEintrag {
  const kurz = lied.slice(0, Math.max(3, 16 - label.length - 1));
  const stem = `${kurz} ${label}`;
  return {
    datei: `${stem}.wav`,
    stem,
    rolle,
    familie: familie(stem),
    sekunden: pcm.length / 44100,
    rmsDb: rmsDb(pcm),
    peak: peakVon(pcm),
    pcm,
    sampleRate: 44100,
    lied,
  } as ScanEintrag;
}

function drumEintrag(lied: string, t: DrumTreffer, nr: number): ScanEintrag {
  const label = `${DRUM_KURZ[t.rolle] ?? "P"}${nr}`;
  const kurz = lied.slice(0, Math.max(3, 16 - label.length - 1));
  const stem = `${kurz} ${label}`;
  return {
    datei: `${stem}.wav`,
    stem,
    rolle: t.rolle,
    familie: familie(stem),
    sekunden: t.pcm.length / 44100,
    rmsDb: t.rmsDb,
    peak: peakVon(t.pcm),
    pcm: t.pcm,
    sampleRate: 44100,
    lied,
  } as ScanEintrag;
}

export function liedZuSet(pcm: Float32Array, sr: number, opts: LiedZuSetOptionen): LiedSet {
  const name = opts.name;
  const zielBpm = opts.zielBpm ?? 180;
  const analyse = analysiereLied(pcm, sr, { zielBpm, bpmHinweis: opts.bpm });
  // Das Tekk-Tempo ist das gemessene MAL der gewaehlten Oktave.
  const bpm = opts.bpm ?? Math.round(analyse.bpm * analyse.k * 10) / 10;

  const eintraege: ScanEintrag[] = [];
  const zaehler = { fenster: 0, vox: 0, drums: 0 };

  if (opts.stems) {
    // Genau wie die App: die drei Abschnitte liefern Melodie, Vocals UND den
    // Drums-Stem; die uebrigen Segmente nur die Vocals (Vollabdeckung).
    const anfrage = [
      ...analyse.fenster.map((f) => ({ id: f.label, pcm: f.pcm, nurVox: false })),
      ...(analyse.segmente ?? []).map((s) => ({ id: `SEG${s.index}`, pcm: s.pcm, nurVox: true })),
    ];
    const raus = opts.stems(anfrage);
    let drumNr = { kick: 0, snare: 0, hat: 0 } as Record<string, number>;
    for (const r of raus) {
      if (r.melo) {
        eintraege.push(eintrag(name, r.id, r.melo, "melo"));
        zaehler.fenster++;
      }
      if (r.vox) {
        const segNr = /^SEG(\d+)$/.exec(r.id);
        eintraege.push(
          segNr ? voxSegmentEintrag(name, Number(segNr[1]), r.vox) : eintrag(name, `V${r.id}`, r.vox, "vox"),
        );
        zaehler.vox++;
      }
      if (r.drums) {
        for (const t of schneideDrums(r.drums, 44100)) {
          drumNr[t.rolle] = (drumNr[t.rolle] ?? 0) + 1;
          eintraege.push(drumEintrag(name, t, drumNr[t.rolle]));
          zaehler.drums++;
        }
      }
    }
  } else {
    // Vollmix-Weg: nur die Abschnitte als Melodie. Ohne tekkDrums hat das Set
    // hinterher keine einzige Kick — deshalb steht das auch im Hinweis.
    for (const f of analyse.fenster) {
      eintraege.push(eintrag(name, f.label, f.pcm, "melo"));
      zaehler.fenster++;
    }
  }

  const { projekt, bank, warnungen } = planeBank(eintraege, {
    name: name.slice(0, 12),
    bpm,
    bankZeit: new Date(0).toISOString(),
    tekkDrumsBank: opts.tekkDrums,
    sparsameVocals: opts.sparsameVocals,
  });
  const rezept = regelRezept(projekt, { modus: "jam", bpm });
  const gebaut = opts.aufbau === false ? baueRezept(rezept, projekt) : baueAufbau(rezept, projekt);

  const hinweise = [...warnungen, ...gebaut.hinweise];
  if (!opts.stems && !opts.tekkDrums)
    hinweise.push("Ohne Stem-Trennung und ohne tekk4-Drums hat dieses Set kein Schlagzeug.");
  if (!zaehler.vox) hinweise.push("Keine getrennten Vocals — die Vocalspur kann nicht ueber die Kette verteilt werden.");

  return {
    name,
    gemessen: analyse.bpm,
    oktave: analyse.k,
    bpm,
    projekt,
    bank,
    patterns: gebaut.patterns,
    hinweise,
    zaehler,
  };
}

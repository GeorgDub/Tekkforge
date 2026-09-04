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
import { polyPhaseResample, downmixToMono } from "./audioProcessor";
import { voxSegmentEintrag } from "./generatorSession";
import { rmsDb, peakVon, familie, type ScanEintrag } from "./sampleScan";
import { schneideDrums, type DrumTreffer } from "./drumSchnitt";
import { planeBank, type Projekt } from "./bankPlan";
import { regelRezept } from "./rezept";
import { baueAufbau, baueRezept } from "./patternGen";
import type { E2PatternInput } from "./electribePatternBuilder";
import { grooveFuerLied, mitSwing, type LiedGroove } from "./grooveAnschluss";
import type { Groove } from "./e2Groove";

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
  /**
   * Kanalzahl der uebergebenen Daten — ABSICHTLICH ohne Vorgabewert.
   *
   * `parseWav` liefert VERSCHRAENKTES Stereo (L,R,L,R). Wer das als Mono
   * weiterreicht, hat ein doppelt so langes Feld: alles spielt halb so schnell,
   * und die abwechselnden Kanaele klingen zerhackt. Genau so ist es passiert.
   * Ohne Vorgabe muss jeder Aufrufer eine Zahl hinschreiben und dabei kurz
   * nachsehen, was er da eigentlich hat.
   */
  kanaele: number;
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
   * Das Timing des Lieds messen und als Swing auf alle Patterns legen
   * (Vorgabe an). Gemessen wird auf dem Drums-Stem, sonst auf dem Drop-Fenster.
   */
  groove?: boolean;
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
  /**
   * Tempo, auf das die Fenster tatsaechlich gedehnt wurden. Muss `bpm` sein —
   * steht hier, damit ein Auseinanderlaufen auffaellt statt zu klingen.
   */
  zielBpm: number;
  projekt: Projekt;
  bank: ArrayBuffer;
  patterns: E2PatternInput[];
  hinweise: string[];
  /** Was tatsaechlich hineingeflossen ist — fuer den Bericht. */
  zaehler: { fenster: number; vox: number; drums: number };
  /** Gemessener Swing in Prozent (0 = gerade), liegt auf allen Patterns. */
  swing: number;
  /** Groove-Vorlage aus dem Lied (16 Steps) — fuer Werkbank oder Firmware; fehlt ohne Messung. */
  groove?: Groove;
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

export function liedZuSet(pcmRoh: Float32Array, srRoh: number, opts: LiedZuSetOptionen): LiedSet {
  const name = opts.name;
  /**
   * Zuerst auf 44,1 kHz bringen — ALLES dahinter rechnet damit.
   *
   * Die Eintraege tragen fest `sampleRate: 44100` und `sekunden = laenge/44100`.
   * Kommt das Lied mit 48 oder 96 kHz herein (beides lag hier auf der Platte),
   * stimmt diese Angabe nicht mehr mit den Daten ueberein: die Bank haelt ein
   * Sample fuer kuerzer, als es ist, spielt es entsprechend verstimmt ab, und
   * ein Vier-Takt-Loop wird zu 4,5 Takten und laeuft aus dem Takt. Am Geraet
   * gehoert: vom Lied bleibt nichts wiedererkennbar.
   *
   * Der Generator-Tab hat das Problem nie gehabt, weil die Web-Audio-Dekodierung
   * dort ohnehin auf 44,1 kHz liefert. Beim Herausloesen in diesen Kern fiel
   * diese stille Voraussetzung weg — also hier ausdruecklich herstellen.
   */
  const sr = 44100;
  // Erst auf einen Kanal, dann auf 44,1 kHz — in dieser Reihenfolge, sonst
  // rechnet der Resampler auf verschraenkten Daten und verruehrt die Kanaele.
  const einKanal = opts.kanaele > 1 ? downmixToMono(pcmRoh).pcm : pcmRoh;
  const pcm = srRoh === sr ? einKanal : polyPhaseResample(einKanal, srRoh, sr, 1);
  /**
   * ZWEI Durchgaenge — und das ist keine Feinheit, sondern der Unterschied
   * zwischen "man erkennt das Lied" und "man erkennt gar nichts".
   *
   * `analysiereLied` dehnt die Fenster auf `zielBpm`. Wer mit 180 analysiert,
   * das Pattern aber mit 209,5 laufen laesst, spielt jedes Sample 16 % zu
   * schnell und entsprechend verstimmt ab — die Melodie ist keine Melodie mehr,
   * das Vocal kein Vocal, und ein Vier-Takt-Loop ist ploetzlich 4,5 Takte lang
   * und laeuft aus dem Takt. Genau so klang es am Geraet.
   *
   * Also erst in einem billigen Vorlauf (ein Fenster) das Tekk-Tempo bestimmen
   * und DANN mit diesem Ziel richtig analysieren. So macht es der Generator-Tab
   * seit jeher; hier war es beim Herausloesen verlorengegangen.
   */
  const vorlauf = analysiereLied(pcm, sr, { zielBpm: opts.zielBpm ?? 180, bpmHinweis: opts.bpm, anzahl: 1 });
  const bpm = opts.bpm ?? Math.round(vorlauf.bpm * vorlauf.k * 10) / 10;
  const analyse = analysiereLied(pcm, sr, { zielBpm: bpm, bpmHinweis: opts.bpm });

  const eintraege: ScanEintrag[] = [];
  const zaehler = { fenster: 0, vox: 0, drums: 0 };
  let grooveQuelle: Float32Array | null = null;

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
      // Das Timing kommt vom Schlagzeug des Drops — der Abschnitt, den die
      // Patterns nachbauen. Sonst vom ersten Stem, das Drums hat.
      if (r.drums && (!grooveQuelle || r.id === "DROP")) grooveQuelle = r.drums;
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

  // Groove: die Fenster sind auf `bpm` gedehnt, also passt das Raster genau.
  // Ohne Stems nimmt die Messung das Drop-Fenster aus dem Vollmix.
  let grooveErgebnis: LiedGroove | null = null;
  if (opts.groove !== false) {
    const quelle = grooveQuelle ?? (analyse.fenster.find((f) => f.label === "DROP") ?? analyse.fenster[0])?.pcm ?? null;
    if (quelle) grooveErgebnis = grooveFuerLied(quelle, sr, bpm, name);
  }
  const swing = grooveErgebnis?.swing ?? 0;
  const patterns = mitSwing(gebaut.patterns, swing);

  const hinweise = [...warnungen, ...gebaut.hinweise];
  if (grooveErgebnis) hinweise.push(swing ? `Swing ${swing > 0 ? "+" : ""}${swing} % aus dem Lied auf allen Patterns` : "Lied laeuft gerade — kein Swing gesetzt");
  if (!opts.stems && !opts.tekkDrums)
    hinweise.push("Ohne Stem-Trennung und ohne tekk4-Drums hat dieses Set kein Schlagzeug.");
  if (!zaehler.vox) hinweise.push("Keine getrennten Vocals — die Vocalspur kann nicht ueber die Kette verteilt werden.");

  return {
    name,
    gemessen: vorlauf.bpm,
    oktave: vorlauf.k,
    bpm,
    zielBpm: bpm,
    projekt,
    bank,
    patterns,
    hinweise,
    zaehler,
    swing,
    groove: grooveErgebnis?.groove,
  };
}

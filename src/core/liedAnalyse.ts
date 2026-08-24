/**
 * liedAnalyse — ein ganzes Lied zu 8-Takt-Fenstern im Bank-Tempo:
 * Tempo (Takt-Autokorrelation oder Hinweis), Half-/Double-Time zum Ziel,
 * Varispeed, Downbeat-Phase ueber Bassenergie, dann Fensterwahl:
 * DROP = lautestes, BREAK = leisestes hoerbares in der Mitte, VAR = hoerbar
 * und klangfarblich am weitesten vom DROP, INTRO = erstes hoerbare.
 * Reine Funktionen, 44,1 k mono.
 */
import { tempoSchaetzen } from "./tempoAnalyse";
import { polyPhaseResample, peakNormalize } from "./audioProcessor";
import { bandEnergien, bassAnteil } from "./dsp";
import { rmsDb } from "./sampleScan";

export type FensterLabel = "DROP" | "BREAK" | "VAR" | "INTRO" | `PART${number}`;

export interface LiedFenster {
  label: FensterLabel;
  startSek: number;
  pcm: Float32Array;
  pegelDb: number;
  /** Position in `segmente` (Vocal-Vollabdeckung ordnet Fenster und Segmente einander zu) */
  index?: number;
}

/** Ein hoerbares 8-Takt-Segment des Lieds — zusammen decken sie das ganze Lied ab. */
export interface LiedSegment {
  index: number;
  startSek: number;
  pcm: Float32Array;
  pegelDb: number;
}

export interface LiedAnalyse {
  bpm: number;
  k: number;
  rate: number;
  offsetSek: number;
  fenster: LiedFenster[];
  segmente: LiedSegment[];
}

const HOERBAR_DB = -35;

/** Downbeat-Phase 0..3: Beat-Position mit dem meisten Bass (Kick) im Raster. */
function downbeatPhase(pcm: Float32Array, sr: number, beatSek: number): number {
  const beatFrames = beatSek * sr;
  const summen = [0, 0, 0, 0];
  const maxBeats = Math.min(Math.floor(pcm.length / beatFrames) - 1, 256);
  for (let b = 0; b < maxBeats; b++) {
    const start = Math.round(b * beatFrames);
    if (start + 2048 > pcm.length) break;
    summen[b % 4] += bassAnteil(pcm.subarray(start, start + 2048), sr);
  }
  let best = 0;
  for (let p = 1; p < 4; p++) if (summen[p] > summen[best]) best = p;
  return best;
}

function abstand(a: Float32Array, b: Float32Array): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) * (a[i] - b[i]);
  return Math.sqrt(s);
}

export function analysiereLied(
  pcm: Float32Array,
  sr: number,
  opts: { zielBpm: number; bpmHinweis?: number; fensterTakte?: number; anzahl?: number },
): LiedAnalyse {
  const fensterTakte = opts.fensterTakte ?? 8;
  const anzahl = opts.anzahl ?? 3;
  const y0 = peakNormalize(pcm, 0.95);
  const bpm = opts.bpmHinweis && opts.bpmHinweis > 0 ? opts.bpmHinweis : tempoSchaetzen(y0, sr);
  const k = [0.5, 1, 2].reduce((a, b) => (Math.abs(bpm * b - opts.zielBpm) < Math.abs(bpm * a - opts.zielBpm) ? b : a));
  const rate = (bpm * k) / opts.zielBpm;
  const y = Math.abs(rate - 1) < 0.002 ? y0 : polyPhaseResample(y0, Math.round(sr * rate), sr, 1);
  const beatSek = 60 / opts.zielBpm;
  const offsetSek = downbeatPhase(y, sr, beatSek) * beatSek;
  const n = Math.round(fensterTakte * 4 * beatSek * sr);
  const starts: number[] = [];
  for (let s = Math.round(offsetSek * sr); s + n <= y.length; s += n) starts.push(s);
  const segs = starts.map((s) => y.subarray(s, s + n));
  const pegel = segs.map((s) => rmsDb(s));
  const hoerbar = pegel.map((p, i) => (p > HOERBAR_DB ? i : -1)).filter((i) => i >= 0);
  const gewaehlt = new Map<FensterLabel, number>();
  if (hoerbar.length) {
    const drop = hoerbar.reduce((a, b) => (pegel[b] > pegel[a] ? b : a));
    gewaehlt.set("DROP", drop);
    if (anzahl >= 2) {
      const mitte = hoerbar.filter((i) => i >= 0.2 * segs.length && i <= 0.85 * segs.length && i !== drop);
      if (mitte.length) gewaehlt.set("BREAK", mitte.reduce((a, b) => (pegel[b] < pegel[a] ? b : a)));
    }
    if (anzahl >= 3) {
      const belegt = new Set(gewaehlt.values());
      const kand = hoerbar.filter((i) => !belegt.has(i) && pegel[i] > pegel[drop] - 12);
      if (kand.length) {
        const farben = new Map<number, Float32Array>();
        const farbe = (i: number) => {
          if (!farben.has(i)) farben.set(i, bandEnergien(segs[i], sr));
          return farben.get(i)!;
        };
        const dropFarbe = farbe(drop);
        gewaehlt.set("VAR", kand.reduce((a, b) => (abstand(farbe(b), dropFarbe) > abstand(farbe(a), dropFarbe) ? b : a)));
      }
    }
    if (anzahl >= 4) {
      const belegt = new Set(gewaehlt.values());
      const erstes = hoerbar.find((i) => !belegt.has(i));
      if (erstes !== undefined) gewaehlt.set("INTRO", erstes);
    }
    let part = 1;
    for (const i of hoerbar.slice().sort((a, b) => pegel[b] - pegel[a])) {
      if (gewaehlt.size >= anzahl) break;
      if (![...gewaehlt.values()].includes(i)) gewaehlt.set(`PART${part++}`, i);
    }
  }
  // Ein normalisierter Puffer je Segment — Fenster und Segmente teilen ihn
  // (sonst haelt eine 5-Minuten-Analyse ueber 50 MB an Doppelkopien)
  const norm = new Map<number, Float32Array>();
  const normFuer = (i: number): Float32Array => {
    let p = norm.get(i);
    if (!p) {
      p = peakNormalize(segs[i], 0.95);
      norm.set(i, p);
    }
    return p;
  };
  const fenster: LiedFenster[] = [...gewaehlt.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([label, i]) => ({ label, startSek: starts[i] / sr, pcm: normFuer(i), pegelDb: pegel[i], index: i }));
  const segmente: LiedSegment[] = hoerbar.map((i) => ({ index: i, startSek: starts[i] / sr, pcm: normFuer(i), pegelDb: pegel[i] }));
  return { bpm, k, rate, offsetSek, fenster, segmente };
}

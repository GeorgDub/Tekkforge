/**
 * tempoAnalyse — Takt-Passung, Onset-Kurve, Tempo-Schaetzung per
 * Takt-Autokorrelation und Tempo-Vorschlag fuer ein Verzeichnis.
 * Reine Zahlen, keine Dekodierung, kein DOM.
 */

/** Naechste ganze Taktzahl (1..16) fuer eine Dauer bei `bpm` und die relative Abweichung. */
export function taktPassung(sekunden: number, bpm: number): { takte: number; abweichung: number } {
  const taktSek = 240 / bpm;
  const roh = sekunden / taktSek;
  const takte = Math.min(16, Math.max(1, Math.round(roh)));
  return { takte, abweichung: Math.abs(roh - takte) / takte };
}

/** Halbwellen-gleichgerichtete Energie-Differenz je Hop (einfache Onset-Staerke). */
export function onsetKurve(pcm: Float32Array, sampleRate: number, hop = 256): Float32Array {
  void sampleRate;
  const n = Math.floor(pcm.length / hop);
  const energie = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = i * hop; k < (i + 1) * hop; k++) s += pcm[k] * pcm[k];
    energie[i] = Math.log1p((s / hop) * 1000);
  }
  const out = new Float32Array(n);
  for (let i = 1; i < n; i++) out[i] = Math.max(0, energie[i] - energie[i - 1]);
  return out;
}

function autokorrelationBeiLag(x: Float32Array, lag: number): number {
  let s = 0;
  for (let i = lag; i < x.length; i++) s += x[i] * x[i - lag];
  return s;
}

/**
 * BPM aus der Autokorrelation der Onset-Kurve (0,25er-Raster). Bewertet wird
 * die Summe aus Beat-Lag und Takt-Lag (4 Beats) — nur der Beat-Lag faellt auf
 * 5/4-Vielfache herein, nur der Takt-Lag auf 5-Beat-Abstaende; zusammen nicht.
 */
export function tempoSchaetzen(pcm: Float32Array, sampleRate: number, min = 80, max = 200): number {
  const hop = 256;
  const on = onsetKurve(pcm, sampleRate, hop);
  const fps = sampleRate / hop;
  const ac0 = autokorrelationBeiLag(on, 0) || 1;
  let best = 180;
  let bestWert = -Infinity;
  for (let bpm = min; bpm <= max; bpm += 0.25) {
    const beatLag = Math.round((60 * fps) / bpm);
    const taktLag = Math.round((4 * 60 * fps) / bpm);
    if (beatLag <= 0 || taktLag >= on.length) continue;
    const w = autokorrelationBeiLag(on, beatLag) / ac0 + autokorrelationBeiLag(on, taktLag) / ac0;
    if (w > bestWert) {
      bestWert = w;
      best = bpm;
    }
  }
  return best;
}

/** BPM, bei dem die meisten Dauern taktgenau (<= 3 %) sind; bei Gleichstand die kleinste mittlere Abweichung, dann 180; kein Treffer → 180. */
export function tempoVorschlag(dauern: number[], kandidaten?: number[]): number {
  const kand = kandidaten ?? Array.from({ length: 51 }, (_, i) => 150 + i);
  let best = 180;
  let bestZahl = 0;
  let bestAbw = Infinity;
  for (const bpm of kand) {
    const treffer = dauern.map((d) => (d >= 1 ? taktPassung(d, bpm).abweichung : 1)).filter((a) => a <= 0.03);
    const zahl = treffer.length;
    const abw = zahl ? treffer.reduce((x, y) => x + y, 0) / zahl : Infinity;
    const besser = zahl > bestZahl || (zahl === bestZahl && zahl > 0 && (abw < bestAbw - 1e-9 || (Math.abs(abw - bestAbw) <= 1e-9 && bpm === 180)));
    if (besser) {
      bestZahl = zahl;
      bestAbw = abw;
      best = bpm;
    }
  }
  return bestZahl > 0 ? best : 180;
}

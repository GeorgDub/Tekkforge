/**
 * loopPunkte — Loop-Punkte auf Taktgrenzen und die Frage, ob ein Loop sich
 * schon nach der Haelfte wiederholt.
 *
 * `planeBank` setzte fuer JEDEN Slot `loopType: 1` (One-Shot) und nie einen
 * Punkt — `pruefeLoop` im Sample-Editor pruefte etwas, das dort nie entstand.
 * Jetzt bekommt jede Schleife (melo, vox, fx, bass, ton als Loop) den
 * Loop-Typ „forward“ mit Start 0 und Ende auf der letzten vollen Taktgrenze,
 * beide auf den naechsten Nulldurchgang gezogen. Das Geraet spielt so eine
 * Schleife rund, solange die Note haelt (Amp-EG aus, Tie im Pattern).
 *
 * Dazu die Wiederholung: klingt ein Vier-Takter in der zweiten Haelfte genau
 * wie in der ersten (normierte Kreuzkorrelation ueber 0,985), reicht es, die
 * erste Haelfte zu speichern — der Loop fuellt die vier Takte von selbst.
 * Das ist kein Zerstueckeln der Melodie: es ist dieselbe Musik, einmal
 * gespeichert statt zweimal. Vocals bleiben davon ausgenommen — sie
 * wiederholen sich fast nie exakt, und ein „fast“ hoert man dort sofort.
 */

export interface LoopPunkte {
  /** Frames, inklusive. */
  start: number;
  /** Frames, exklusiv — die letzte volle Taktgrenze. */
  ende: number;
  /** Ganze Takte innerhalb der Punkte. */
  takte: number;
}

/** Frames eines Takts (4/4) bei diesem Tempo. */
export const taktFrames = (sampleRate: number, bpm: number): number => (240 / bpm) * sampleRate;

/** Naechster Nulldurchgang um `frame` herum (±fenster), sonst `frame` selbst. */
export function nulldurchgang(pcm: Float32Array, frame: number, fenster = 64): number {
  const f = Math.max(0, Math.min(pcm.length, Math.round(frame)));
  let bester = f;
  let bestAbstand = Infinity;
  for (let i = Math.max(1, f - fenster); i < Math.min(pcm.length, f + fenster); i++) {
    if ((pcm[i - 1] <= 0 && pcm[i] > 0) || (pcm[i - 1] >= 0 && pcm[i] < 0) || pcm[i] === 0) {
      const d = Math.abs(i - f);
      if (d < bestAbstand) {
        bestAbstand = d;
        bester = i;
      }
    }
  }
  return bester;
}

/**
 * Loop-Punkte fuer `takte` Takte: Start 0, Ende auf der letzten vollen
 * Taktgrenze, die noch im Sample liegt (hoechstens `takte`). Ein Sample, das
 * kuerzer als ein Takt ist, bekommt sein Ende als Loop-Ende.
 */
export function loopPunkte(frames: number, takte: number, sampleRate: number, bpm: number): LoopPunkte {
  const tf = taktFrames(sampleRate, bpm);
  const volle = Math.max(0, Math.min(takte, Math.floor(frames / tf + 0.02)));
  const ende = volle ? Math.min(frames, Math.round(volle * tf)) : frames;
  return { start: 0, ende, takte: volle || 0 };
}

/** Loop-Punkte auf Nulldurchgaenge gezogen (Start bleibt 0). */
export function loopPunkteAufNull(pcm: Float32Array, takte: number, sampleRate: number, bpm: number): LoopPunkte {
  const p = loopPunkte(pcm.length, takte, sampleRate, bpm);
  return { ...p, ende: Math.max(1, nulldurchgang(pcm, p.ende)) };
}

/** Normierte Kreuzkorrelation zweier gleich langer Ausschnitte (−1…1). */
export function aehnlichkeit(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < n; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
}

/** Ab dieser Aehnlichkeit gilt die zweite Haelfte als Wiederholung der ersten. */
export const WIEDERHOLUNG_AB = 0.985;

/**
 * Wiederholt sich der Loop nach der Haelfte? Nur bei gerader Taktzahl ≥ 2;
 * liefert die Haelfte in Takten oder null.
 */
export function wiederholtSich(pcm: Float32Array, takte: number, sampleRate: number, bpm: number, schwelle = WIEDERHOLUNG_AB): number | null {
  if (takte < 2 || takte % 2) return null;
  const tf = taktFrames(sampleRate, bpm);
  const halb = Math.round((takte / 2) * tf);
  if (halb * 2 > pcm.length + 2) return null;
  const a = pcm.subarray(0, halb);
  const b = pcm.subarray(halb, Math.min(pcm.length, 2 * halb));
  return aehnlichkeit(a, b) >= schwelle ? takte / 2 : null;
}

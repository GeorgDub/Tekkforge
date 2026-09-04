/**
 * hookSuche — welches 8-Takt-Fenster ist der Hook?
 *
 * `novitaetsMarken` liefert hoechstens eine Marke, `analysiereLied` nimmt
 * fuer den DROP schlicht das lauteste Fenster. Der Hook eines Lieds ist
 * aber das, was WIEDERKEHRT: der Refrain, die Hookline. Hier wird je Takt
 * ein Chroma-Vektor gemessen (12 Tonklassen, Goertzel ueber fuenf Oktaven),
 * jedes Fenster als Folge seiner Takt-Chromas beschrieben und gegen jedes
 * andere Fenster verglichen — mittlere Kosinus-Aehnlichkeit Takt fuer Takt.
 * Das Fenster mit den meisten Nahezu-Wiederholungen ist der Hook.
 *
 * Damit landet der Hook im Drop, und der Grundsatz „Melos nicht
 * zerstueckeln“ bleibt gewahrt: es wird nur GEWAEHLT, nicht geschnitten.
 */
import { chromaAusPcm } from "./keyAnalyse";

/** Ab dieser mittleren Kosinus-Aehnlichkeit gilt ein Fenster als Wiederholung. */
export const WIEDERHOLUNG_AB = 0.9;

export interface Hook {
  /** Position in der uebergebenen Fensterliste. */
  index: number;
  /** Wie viele andere Fenster ihm gleichen. */
  wiederholungen: number;
}

const kosinus = (a: number[], b: number[]): number => {
  let ab = 0;
  let aa = 0;
  let bb = 0;
  for (let i = 0; i < a.length; i++) {
    ab += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : 0;
};

/** Viererbloecke mitteln: die Chroma-Bins reichen bis B6 (knapp 2 kHz), da genuegt ein Viertel der Rate. */
const DEZIMIERUNG = 4;

function dezimiert(pcm: Float32Array): Float32Array {
  const n = Math.floor(pcm.length / DEZIMIERUNG);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = i * DEZIMIERUNG;
    out[i] = (pcm[k] + pcm[k + 1] + pcm[k + 2] + pcm[k + 3]) * 0.25;
  }
  return out;
}

/** Chroma je Takt eines Fensters (auf ein Viertel der Rate gebracht — viermal schneller, gleiche Tonklassen). */
export function taktChromas(pcm: Float32Array, sr: number, bpm: number): number[][] {
  const y = dezimiert(pcm);
  const srY = sr / DEZIMIERUNG;
  const tf = (240 / bpm) * srY;
  const takte = Math.max(1, Math.floor(y.length / tf + 0.02));
  const out: number[][] = [];
  for (let t = 0; t < takte; t++) {
    const von = Math.round(t * tf);
    const bis = Math.min(y.length, Math.round((t + 1) * tf));
    out.push(chromaAusPcm(y.subarray(von, bis), srY));
  }
  return out;
}

/** Mittlere Kosinus-Aehnlichkeit zweier Fenster, Takt fuer Takt (0…1). */
export function fensterAehnlichkeit(a: number[][], b: number[][]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let s = 0;
  for (let i = 0; i < n; i++) s += kosinus(a[i], b[i]);
  return s / n;
}

/**
 * Der Hook unter den Fenstern: die meisten Wiederholungen; bei Gleichstand
 * das fruehere. null, wenn sich kein Fenster wiederholt.
 */
export function hookFenster(fenster: readonly Float32Array[], sr: number, bpm: number, schwelle = WIEDERHOLUNG_AB): Hook | null {
  if (fenster.length < 2) return null;
  const chromas = fenster.map((f) => taktChromas(f, sr, bpm));
  let best: Hook | null = null;
  for (let i = 0; i < chromas.length; i++) {
    let w = 0;
    for (let j = 0; j < chromas.length; j++) if (j !== i && fensterAehnlichkeit(chromas[i], chromas[j]) >= schwelle) w++;
    if (w > 0 && (!best || w > best.wiederholungen)) best = { index: i, wiederholungen: w };
  }
  return best;
}

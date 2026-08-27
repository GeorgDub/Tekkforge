/**
 * stemWerkbank — Spuren, Marken und Schnitte von Hand.
 *
 * Der Generator schneidet automatisch, und meistens ist das richtig. Wenn es
 * das nicht ist, brauchte man bisher ein anderes Programm. Hier liegen die
 * Spuren des getrennten Lieds untereinander auf EINER Zeitachse: anhoeren,
 * Marken setzen, schneiden — mit der Maus, nicht ueber Parameter.
 *
 * Zwei Entscheidungen stecken in diesem Modul und nicht in der Oberflaeche:
 *
 * - **Marken gehoeren zur Spur, nicht zur Zeitachse.** Naheliegend waere ein
 *   gemeinsames Raster, denn die Stems teilen sich ja die Zeit. Aber die
 *   Vocals will man in acht Phrasen zerlegen und die Melodie hoechstens
 *   halbieren — mit gemeinsamen Marken ginge beides nicht nebeneinander.
 * - **Jede Marke schnappt auf den naechsten Nulldurchgang.** Ein Schnitt
 *   mitten in der Halbwelle knackt hoerbar; auf dem Geraet faellt das erst auf,
 *   wenn die Bank schon drauf ist.
 */

import type { PoolSample } from "./editorModel";

/** Wie nah zwei Klicks sein duerfen, bevor sie als dieselbe Marke gelten. */
export const MARKE_TOLERANZ_MS = 8;
/** Wie weit von der Klickstelle nach einem Nulldurchgang gesucht wird. */
export const SCHNAPP_FENSTER_MS = 12;
/** Kuerzer schneiden lohnt nicht — das ist ein Klick, kein Klang. */
export const MIN_ABSCHNITT_MS = 40;

/** Wofuer die Spur steht — entscheidet ueber Hinweise, nicht ueber Technik. */
export type SpurRolle = "melo" | "vox" | "drums" | "bass" | "mix" | "sonst";

export interface Spur {
  id: string;
  name: string;
  rolle: SpurRolle;
  pcm: Float32Array;
  sampleRate: number;
  /** Schnittstellen in Frames, aufsteigend, ohne Anfang und Ende. */
  marken: number[];
  stumm: boolean;
  solo: boolean;
  /** Wiedergabe-Lautstaerke der Werkbank (aendert die Daten nicht). */
  gain: number;
}

let laufendeNummer = 0;

export function neueSpur(name: string, pcm: Float32Array, sampleRate: number, rolle: SpurRolle = "sonst"): Spur {
  return {
    id: `spur-${++laufendeNummer}`,
    name,
    rolle,
    pcm,
    sampleRate,
    marken: [],
    stumm: false,
    solo: false,
    gain: 1,
  };
}

const msZuFrames = (ms: number, sr: number): number => Math.max(1, Math.round((ms * sr) / 1000));

/**
 * Naechster Nulldurchgang um `frame` herum.
 *
 * Gesucht wird in beide Richtungen und genommen, was zuerst kommt. Findet sich
 * im Fenster keiner (Rauschen ohne Nulldurchgang, Gleichanteil), bleibt die
 * Stelle wie geklickt — raten waere schlimmer als nicht schnappen.
 */
export function nullDurchgang(pcm: Float32Array, frame: number, fensterFrames: number): number {
  const mitte = Math.max(0, Math.min(pcm.length - 1, Math.round(frame)));
  for (let d = 0; d <= fensterFrames; d++) {
    for (const i of d === 0 ? [mitte] : [mitte - d, mitte + d]) {
      if (i <= 0 || i >= pcm.length) continue;
      // Vorzeichenwechsel zwischen i-1 und i: da liegt die Null.
      if ((pcm[i - 1] <= 0 && pcm[i] >= 0) || (pcm[i - 1] >= 0 && pcm[i] <= 0)) return i;
    }
  }
  return mitte;
}

/**
 * Marke setzen. Anfang und Ende sind keine Marken — sie begrenzen ohnehin.
 * Eine Stelle, an der schon eine Marke steht, setzt keine zweite.
 */
export function setzeMarke(spur: Spur, frame: number, opts: { schnappen?: boolean } = {}): void {
  const schnappen = opts.schnappen !== false;
  let f = Math.round(frame);
  // Erst die geklickte Stelle pruefen, dann schnappen: sonst zieht das
  // Schnappen einen Klick auf den Rand nach innen und legt dort eine Marke an,
  // die niemand gesetzt hat.
  if (f <= 0 || f >= spur.pcm.length) return;
  if (schnappen) f = nullDurchgang(spur.pcm, f, msZuFrames(SCHNAPP_FENSTER_MS, spur.sampleRate));
  if (f <= 0 || f >= spur.pcm.length) return;
  const tol = msZuFrames(MARKE_TOLERANZ_MS, spur.sampleRate);
  if (spur.marken.some((m) => Math.abs(m - f) <= tol)) return;
  spur.marken.push(f);
  spur.marken.sort((a, b) => a - b);
}

/** Marke in der Naehe entfernen; true, wenn eine getroffen wurde. */
export function entferneMarke(spur: Spur, frame: number, toleranzFrames?: number): boolean {
  const tol = toleranzFrames ?? msZuFrames(MARKE_TOLERANZ_MS * 4, spur.sampleRate);
  let beste = -1;
  let abstand = Infinity;
  spur.marken.forEach((m, i) => {
    const d = Math.abs(m - frame);
    if (d <= tol && d < abstand) {
      abstand = d;
      beste = i;
    }
  });
  if (beste < 0) return false;
  spur.marken.splice(beste, 1);
  return true;
}

export interface Abschnitt {
  von: number;
  bis: number;
  index: number;
}

/** Die Spur zwischen ihren Marken — lueckenlos und ohne Ueberlappung. */
export function abschnitte(spur: Spur): Abschnitt[] {
  const grenzen = [0, ...spur.marken, spur.pcm.length];
  const out: Abschnitt[] = [];
  for (let i = 0; i < grenzen.length - 1; i++) out.push({ von: grenzen[i], bis: grenzen[i + 1], index: i });
  return out;
}

/**
 * Marken auf die Taktgrenzen legen — der automatische Teil.
 *
 * `takte` sagt, wie grob: 1 schneidet jeden Takt, 8 die uebliche
 * Tekk-Phrase. Ohne brauchbares Tempo gibt es kein Raster statt einer
 * Endlosschleife.
 */
export function rasterMarken(laengeFrames: number, sampleRate: number, bpm: number, takte = 1): number[] {
  if (!Number.isFinite(bpm) || bpm <= 0 || takte <= 0) return [];
  const schritt = (takte * 4 * 60 * sampleRate) / bpm;
  if (!Number.isFinite(schritt) || schritt < 1) return [];
  const out: number[] = [];
  for (let f = schritt; f < laengeFrames - 1; f += schritt) out.push(Math.round(f));
  return out;
}

export interface SchnittErgebnis {
  samples: PoolSample[];
  hinweise: string[];
  /** Was die Schnipsel im Sample-RAM des Geraets belegen wuerden. */
  bytes: number;
}

/**
 * Die Abschnitte einer Spur als Pool-Samples.
 *
 * Zu kurze Schnipsel fallen heraus: sie entstehen beim Danebenklicken und
 * waeren auf dem Geraet ein Knacken mit eigener Nummer.
 */
export function schneideSpur(
  spur: Spur,
  opts: { basisNummer: number; nurAbschnitt?: number },
): SchnittErgebnis {
  const hinweise: string[] = [];
  const minFrames = msZuFrames(MIN_ABSCHNITT_MS, spur.sampleRate);
  let alle = abschnitte(spur);
  if (opts.nurAbschnitt !== undefined) alle = alle.filter((a) => a.index === opts.nurAbschnitt);
  const brauchbar = alle.filter((a) => a.bis - a.von >= minFrames);
  const verworfen = alle.length - brauchbar.length;
  if (verworfen) hinweise.push(`${verworfen} Abschnitt(e) unter ${MIN_ABSCHNITT_MS} ms — zu kurz, weggelassen.`);
  if (spur.rolle === "melo" && brauchbar.length > 2) {
    hinweise.push(
      `„${spur.name}" ist eine Melodie und zerfaellt in ${brauchbar.length} Teile. Melodien bleiben besser ganz, hoechstens zwei Haelften — von Hand geht es, aber es sollte Absicht sein.`,
    );
  }
  const samples: PoolSample[] = brauchbar.map((a, i) => ({
    number: opts.basisNummer + i,
    name: teilName(spur.name, i, brauchbar.length),
    sampleRate: spur.sampleRate,
    pcm: spur.pcm.slice(a.von, a.bis),
  }));
  let bytes = 0;
  for (const s of samples) bytes += Math.round((s.pcm.length / s.sampleRate) * 44100) * 2;
  return { samples, hinweise, bytes };
}

/** Name eines Schnipsels — kurz genug fuers Geraetefeld, mit Nummer bei mehreren. */
function teilName(spurName: string, index: number, gesamt: number): string {
  const basis = spurName.replace(/[^A-Za-z0-9 _-]/g, "").trim() || "SPUR";
  if (gesamt <= 1) return basis.slice(0, 15);
  return `${basis.slice(0, 11)} ${String(index + 1).padStart(2, "0")}`;
}

/**
 * Laenge der gemeinsamen Zeitachse in Frames.
 *
 * Die laengste Spur gibt sie vor; eine kuerzere endet eben frueher. Nie null,
 * sonst teilt die Anzeige beim Zeichnen durch null.
 */
export function zeitachse(spuren: readonly Spur[]): number {
  let max = 1;
  for (const s of spuren) if (s.pcm.length > max) max = s.pcm.length;
  return max;
}

/** Welche Spuren beim Anhoeren wirklich klingen (Solo sticht Stumm). */
export function hoerbareSpuren(spuren: readonly Spur[]): Spur[] {
  const solo = spuren.filter((s) => s.solo);
  const kandidaten = solo.length ? solo : spuren;
  return kandidaten.filter((s) => !s.stumm || s.solo);
}

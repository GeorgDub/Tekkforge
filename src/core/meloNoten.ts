/**
 * meloNoten — die Melodie eines Fensters als MIDI-Noten je 16tel, und was der
 * Generator daraus macht.
 *
 * Nutzerwunsch 2026-09-04: „die MIDI auch aus der Melo erstellen, damit der
 * Kick und die anderen Samples passend zur Melo laufen“. Bisher kannte der
 * Generator von der Melodie nur Onsets und Bassanteil (`meloRaster`); die
 * Tonhoehen blieben ungenutzt. Hier laeuft die einstimmige Transkription
 * (`transkribiereAudio`, Autokorrelation je 16tel) ueber den Melo-Loop, und
 * das Ergebnis wird zu einer Linie je Step:
 *
 * - **Stab** spielt die Melodie mit: an jedem Notenanfang ein Anschlag mit
 *   der Tonklasse der Melodie in der Stab-Oktave (60…71), Gate nach
 *   Notenlaenge. Ein Stab-Sample auf C spielt so die Hookline.
 * - **Bass** bekommt, wenn kein Bass-Stem da ist, den Grundton je Viertel
 *   aus der Melodie — die tiefste klingende Note des Viertels.
 * - **Kick** bleibt die Tekk-Figur, aber: Anschlaege, die mit einem
 *   Melodie-Notenanfang auf einer Viertel zusammenfallen, bekommen den
 *   Akzent 127; Zusatz-Kicks (Auftakt, Ghost) auf Steps, an denen die
 *   Melodie selbst neu ansetzt, entfallen — Kick und Melo treten sich nicht.
 *
 * Reine Rechnung auf dem Melo-PCM, kein Python. Die Linie ist JSON-faehig
 * und liegt am ProjektSample (`meloLinie`), damit Rezept und Pattern-Bau sie
 * ohne Audio benutzen; als SmfLied geht sie in den MIDI-Wizard.
 */
import { transkribiereAudio, alsSmfLied, AUDIO_TPQ } from "./audioZuMidi";
import type { SmfNote, SmfLied } from "./midiImport";
import type { E2StepInput } from "./electribePatternBuilder";
import type { MeloRaster } from "./meloRaster";

const N = 64;
const T16 = AUDIO_TPQ / 4;

export interface MeloLinie {
  /** MIDI-Note je 16tel-Step (64 Werte, 4 Takte), null = Pause. */
  noten: (number | null)[];
  /** true, wo eine Note beginnt. */
  anschlag: boolean[];
  /** Anschlagstaerke 1…127 je Step, 0 wo keine Note beginnt. */
  velocity: number[];
  /** Wie viele Noten die Transkription fand (ueber die ganze Laenge, nicht nur vier Takte). */
  anzahl: number;
}

/** Notenliste (Ticks) → Linie je 16tel ueber vier Takte; laengere Loops zeigen ihre ersten vier Takte. */
export function linieAusNoten(noten: readonly SmfNote[], ticksProViertel = AUDIO_TPQ): MeloLinie {
  const t16 = ticksProViertel / 4;
  const out: MeloLinie = { noten: new Array(N).fill(null), anschlag: new Array(N).fill(false), velocity: new Array(N).fill(0), anzahl: noten.length };
  for (const n of noten) {
    const von = Math.round(n.tick / t16);
    const bis = Math.max(von + 1, Math.round((n.tick + n.dauer) / t16));
    if (von >= N) continue;
    out.anschlag[von] = true;
    out.velocity[von] = Math.max(1, Math.min(127, n.velocity));
    for (let s = von; s < Math.min(bis, N); s++) out.noten[s] = n.note;
  }
  return out;
}

/** Die Melodie eines Loops als Linie — einstimmig, 55–1050 Hz. */
export function meloNoten(pcm: Float32Array, sr: number, bpm: number): { linie: MeloLinie; noten: SmfNote[] } {
  const noten = transkribiereAudio(pcm, sr, { bpm, stimmen: 1 });
  return { linie: linieAusNoten(noten), noten };
}

/** Die Linie als SMF-Lied fuer den MIDI-Wizard (eine Spur). */
export function meloAlsSmf(noten: readonly SmfNote[], bpm: number, name: string): SmfLied {
  return alsSmfLied([...noten], bpm, name);
}

/** Tonklasse in die Stab-Oktave 60…71 legen (Stab-Sample auf C, Note 60 = Originaltonhoehe). */
export const noteFuerStab = (midi: number): number => 60 + ((((midi % 12) + 12) % 12) as number);

/**
 * Stab spielt die Melodie: Anschlag an jedem Notenanfang, Tonklasse in der
 * Stab-Oktave, Gate = Notenlaenge in Steps (hoechstens 4 Steps, 24 je Step),
 * Velocity aus der Transkription, mit dem Onset-Raster gemischt, wenn es da ist.
 */
export function stabAusLinie(linie: MeloLinie, raster?: MeloRaster): E2StepInput[] {
  const out: E2StepInput[] = Array.from({ length: N }, () => ({ active: false }));
  for (let s = 0; s < N; s++) {
    if (!linie.anschlag[s] || linie.noten[s] === null) continue;
    let len = 1;
    while (s + len < N && linie.noten[s + len] === linie.noten[s] && !linie.anschlag[s + len]) len++;
    const vel = raster ? Math.round(0.5 * linie.velocity[s] + 0.5 * (70 + 50 * (raster.onset[s] ?? 0))) : linie.velocity[s];
    out[s] = { active: true, notes: [noteFuerStab(linie.noten[s]!)], velocity: Math.max(40, Math.min(127, vel)), gate: Math.min(96, 24 * Math.min(4, len)) };
  }
  return out;
}

/** Grundton je Viertel aus der Melodie: die tiefste Note, die im Viertel klingt; null bei Pause. */
export function bassLinieAusMelo(linie: MeloLinie): (number | null)[] {
  const out: (number | null)[] = [];
  for (let v = 0; v < N / 4; v++) {
    let tief: number | null = null;
    for (let s = v * 4; s < v * 4 + 4; s++) {
      const n = linie.noten[s];
      if (n !== null && (tief === null || n < tief)) tief = n;
    }
    out.push(tief);
  }
  return out;
}

/**
 * Kick zur Melodie: Anschlaege auf Vierteln, an denen die Melodie eine Note
 * beginnt, bekommen 127; Kicks abseits der Viertel (Auftakt, Ghost, Roll)
 * entfallen dort, wo die Melodie selbst neu ansetzt. Die Viertel bleiben immer.
 */
export function kickAnMelo(steps: E2StepInput[], linie: MeloLinie): E2StepInput[] {
  return steps.map((st, s) => {
    if (!st.active) return st;
    const viertel = s % 4 === 0;
    if (viertel) return linie.anschlag[s] ? { ...st, velocity: 127 } : st;
    return linie.anschlag[s] ? { active: false } : st;
  });
}

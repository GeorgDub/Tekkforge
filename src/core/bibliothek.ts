/**
 * bibliothek — abgelegte Patterns samt ihrer Samples, und das Zusammenführen.
 *
 * Der Zweck: nicht mehr suchen. Ein Pattern gehört zu seiner Sample-Bank, und
 * beides zusammen ist erst ein spielbares Ergebnis. Wer drei Patterns aus drei
 * Sets auf dem Geraet haben will, braucht heute drei .all-Dateien und muss am
 * Geraet dreimal importieren — oder EINE gemeinsame Bank, in der die Verweise
 * stimmen.
 *
 * Das Zusammenführen ist der anspruchsvolle Teil und steckt hier:
 *
 * - Zwei Sets haben beide ein Sample 501. In der gemeinsamen Bank kann nur
 *   eines die 501 behalten — jede Nummer wandert über eine Abbildung.
 * - Zwei Patterns aus DEMSELBEN Set teilen sich dieselbe Kick. Die zweimal
 *   abzulegen verschenkt das knappe Sample-RAM, also wird entdoppelt — aber
 *   nur bei gleichem INHALT. Namen sind kein Beweis: zwei Sets können beide
 *   „Kick" heissen und ganz verschieden klingen.
 * - Ein Verweis ohne Ziel wird geleert und der Part stummgeschaltet, nie mit
 *   der alten Nummer stehengelassen (siehe `zielBank`).
 */

import type { EditorPattern, PoolSample } from "./editorModel";
import { leereZielBank, fuegeHinzu, uebernehmeMuster, alsPool, ramBytes, RAM_BUDGET_BYTES } from "./zielBank";

export interface BibliothekEintrag {
  id: string;
  name: string;
  pattern: EditorPattern;
  /** Die Samples, die dieses Pattern braucht. */
  samples: PoolSample[];
  /** Ablagezeitpunkt (ms seit Epoch). */
  wann: number;
}

export interface SammelErgebnis {
  patterns: EditorPattern[];
  samples: PoolSample[];
  hinweise: string[];
  /** Wie viele Samples durch Entdoppelung eingespart wurden. */
  doppelt: number;
  /** Wie viele Parts auf ein fehlendes Sample zeigten. */
  verwaist: number;
}

/**
 * Fingerabdruck eines Samples — Laenge, Rate und eine Stichprobe der Werte.
 *
 * Bewusst nicht der ganze Puffer: bei 24 MB Bank waere das je Vergleich ein
 * Megabyte-Durchlauf. Eine Stichprobe an festen Stellen plus die Laenge trennt
 * verschiedene Samples zuverlaessig; zwei Samples, die an 64 Stellen und in der
 * Laenge uebereinstimmen, sind in der Praxis dasselbe.
 */
function fingerabdruck(s: PoolSample): string {
  const n = s.pcm.length;
  const teile: string[] = [String(n), String(s.sampleRate)];
  const schritte = 64;
  for (let i = 0; i < schritte; i++) {
    const idx = Math.floor((i * n) / schritte);
    teile.push(idx < n ? s.pcm[idx].toFixed(6) : "0");
  }
  return teile.join(",");
}

/**
 * Ausgewaehlte Eintraege zu einer gemeinsamen Bank und einer Pattern-Liste.
 *
 * `verketten` haengt die Patterns aneinander, damit das Geraet sie der Reihe
 * nach durchspielt — das letzte endet die Kette.
 */
export function fuehreZusammen(
  eintraege: readonly BibliothekEintrag[],
  opts: { verketten?: boolean } = {},
): SammelErgebnis {
  const bank = leereZielBank();
  const patterns: EditorPattern[] = [];
  const hinweise: string[] = [];
  /** Fingerabdruck → Nummer in der gemeinsamen Bank. */
  const bekannt = new Map<string, number>();
  let doppelt = 0;
  let verwaist = 0;

  for (const e of eintraege) {
    // Je Eintrag eine eigene Abbildung: seine alten Nummern → die neuen.
    const abbildung = new Map<number, number>();
    const neuAufzunehmen: PoolSample[] = [];
    for (const s of e.samples) {
      const fp = fingerabdruck(s);
      const schon = bekannt.get(fp);
      if (schon !== undefined) {
        abbildung.set(s.number, schon);
        doppelt++;
        continue;
      }
      neuAufzunehmen.push(s);
    }
    if (neuAufzunehmen.length) {
      const r = fuegeHinzu(bank, neuAufzunehmen, { quelle: e.name });
      for (const [alt, neu] of r.abbildung) abbildung.set(alt, neu);
      for (const s of neuAufzunehmen) {
        const neu = r.abbildung.get(s.number);
        if (neu !== undefined) bekannt.set(fingerabdruck(s), neu);
      }
      // Budget-Hinweise sammeln, aber nur einmal.
      for (const h of r.hinweise) if (!hinweise.includes(h)) hinweise.push(h);
    }
    const bericht = uebernehmeMuster(bank, [e.pattern], abbildung);
    verwaist += bericht.verwaist;
    for (const h of bericht.hinweise) hinweise.push(`${e.name}: ${h}`);
    patterns.push(...bericht.patterns);
  }

  if (opts.verketten) {
    patterns.forEach((p, i) => {
      p.chainTo = i < patterns.length - 1 ? i + 2 : 0;
      p.chainRepeat = 1;
    });
  }

  const belegt = ramBytes(bank);
  if (belegt > RAM_BUDGET_BYTES && !hinweise.some((h) => /RAM|passt nicht/i.test(h))) {
    hinweise.push(
      `Die gemeinsame Bank passt nicht ins Sample-RAM: ${(belegt / 1048576).toFixed(1)} MB von ${(RAM_BUDGET_BYTES / 1048576).toFixed(0)} MB.`,
    );
  }
  if (doppelt) {
    hinweise.push(`${doppelt} doppelte(s) Sample nur einmal abgelegt — das spart Platz im Sample-RAM.`);
  }
  return { patterns, samples: alsPool(bank), hinweise, doppelt, verwaist };
}

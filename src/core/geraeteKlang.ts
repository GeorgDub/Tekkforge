/**
 * geraeteKlang — wie klingt ein Sample, nachdem das Geraet es angefasst hat?
 *
 * Zwischen der Datei am Rechner und dem, was aus der Electribe kommt, liegen
 * vier Schritte, die man nicht sieht und sehr wohl hoert: alles wird auf EINEN
 * Kanal gelegt, auf 16 Bit quantisiert, gegebenenfalls im Tempo angepasst —
 * und eine gespeicherte Abtastrate unter 44,1 kHz ist eine offene Frage.
 *
 * Diese Frage ist der eigentliche Grund fuer das Modul. Sparsam abgelegte
 * Vocals (22050) verdoppeln die Abdeckung einer Bank — **wenn** das Geraet die
 * gespeicherte Rate beachtet. Tut es das nicht, liest es dieselben Bilder mit
 * 44,1 kHz und alles laeuft doppelt so schnell. Am Geraet ist das noch nicht
 * abgenommen. Statt zu raten, rechnet dieses Modul BEIDE Faelle aus: man hoert
 * vorher, was einen erwartet, und erkennt hinterher am Klang sofort, welcher
 * der beiden eingetreten ist.
 *
 * Kein Filter, keine Effekte — das ist nicht der Geraeteklang, sondern der
 * Weg der Daten. Genau die Unterschiede, die vom Speichern kommen.
 */

import { downmixToMono, polyPhaseResample } from "./audioProcessor";

/** Mit dieser Rate gibt die Electribe aus. */
export const GERAET_RATE = 44100;
/** Kleinster Schritt eines 16-Bit-Wortes. */
export const SCHRITT_16BIT = 1 / 32767;

export interface KlangOptionen {
  /** 2 = interleaved Stereo; wird auf einen Kanal gelegt wie im Geraet. */
  kanaele?: 1 | 2;
  /** Varispeed beim Bankbau (1 = unveraendert). */
  rate?: number;
  /**
   * Beachtet das Geraet eine gespeicherte Rate unter 44,1 kHz?
   * Vorgabe true — das ist die Annahme, unter der die sparsamen Vocals gebaut
   * werden. `false` rechnet den anderen Fall aus.
   */
  rateBeachtet?: boolean;
}

export interface KlangErgebnis {
  pcm: Float32Array;
  sampleRate: number;
  hinweise: string[];
}

/** Auf 16 Bit runden und klemmen — genau das macht die Bank beim Speichern. */
function quantisiere(pcm: Float32Array): { pcm: Float32Array; geklemmt: number } {
  const out = new Float32Array(pcm.length);
  let geklemmt = 0;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i];
    if (v > 1 || v < -1) geklemmt++;
    // Klemmen VOR dem Runden: ein ueberlaufendes 16-Bit-Wort klappt sonst ins
    // Negative um, und aus einem lauten Sample wird ein Knacken.
    const k = Math.max(-1, Math.min(1, v));
    out[i] = Math.round(k * 32767) / 32767;
  }
  return { pcm: out, geklemmt };
}

/**
 * Das Sample so, wie es aus dem Geraet kommt — auf 44,1 kHz.
 *
 * Die Laenge ist die Antwort: bleibt sie gleich, stimmt die Tonhoehe; halbiert
 * sie sich, laeuft das Sample doppelt so schnell.
 */
export function wieAmGeraet(pcm: Float32Array, srQuelle: number, opts: KlangOptionen = {}): KlangErgebnis {
  const hinweise: string[] = [];
  if (!pcm.length) return { pcm: new Float32Array(0), sampleRate: GERAET_RATE, hinweise };

  let arbeit = pcm;
  if (opts.kanaele === 2) {
    arbeit = downmixToMono(arbeit).pcm;
    hinweise.push("Zwei Kanäle auf einen gelegt — die Electribe legt ein zweikanaliges Sample sonst auf ZWEI Parts.");
  }

  const beachtet = opts.rateBeachtet !== false;
  if (srQuelle !== GERAET_RATE) {
    if (beachtet) {
      arbeit = polyPhaseResample(arbeit, srQuelle, GERAET_RATE, 1);
    } else {
      // Das Geraet liest die Bilder stur mit seiner eigenen Rate: dieselben
      // Daten, nur schneller. Rechnerisch heisst das — nichts tun.
      const faktor = GERAET_RATE / srQuelle;
      hinweise.push(
        `Beachtet das Gerät die gespeicherten ${srQuelle} Hz nicht, läuft das Sample ${faktor.toFixed(2)}× schneller und klingt entsprechend höher.`,
      );
    }
  }

  const rate = opts.rate ?? 1;
  if (Number.isFinite(rate) && rate > 0 && Math.abs(rate - 1) > 1e-6) {
    // Varispeed heisst: mit veraenderter Rate lesen. Das ist dasselbe wie
    // umrechnen von (44100 · rate) auf 44100.
    arbeit = polyPhaseResample(arbeit, Math.round(GERAET_RATE * rate), GERAET_RATE, 1);
  }

  const q = quantisiere(arbeit);
  if (q.geklemmt) {
    hinweise.push(`${q.geklemmt} Werte waren übersteuert und wurden geklemmt — im Sample hörbar als harte Kanten.`);
  }
  return { pcm: q.pcm, sampleRate: GERAET_RATE, hinweise };
}

/**
 * Beide Lesarten nebeneinander — nur sinnvoll, wenn die Rate ueberhaupt
 * abweicht. Bei 44,1 kHz sind sie identisch, und dann gibt es nichts zu
 * vergleichen.
 */
export function beideLesarten(
  pcm: Float32Array,
  srQuelle: number,
  opts: KlangOptionen = {},
): { beachtet: KlangErgebnis; ignoriert: KlangErgebnis | null } {
  const beachtet = wieAmGeraet(pcm, srQuelle, { ...opts, rateBeachtet: true });
  if (srQuelle === GERAET_RATE) return { beachtet, ignoriert: null };
  return { beachtet, ignoriert: wieAmGeraet(pcm, srQuelle, { ...opts, rateBeachtet: false }) };
}

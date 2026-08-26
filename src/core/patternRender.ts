/**
 * patternRender — ein Pattern am Rechner zu Audio ausrechnen.
 *
 * Zweck ist doppelt: der Nutzer bekommt eine WAV zum Mitnehmen (Kopfhoerer,
 * Handy, Auto), und wir bekommen etwas Messbares. Behauptungen wie "der Drop
 * kickt haerter" oder "der schlanke Satz ist weniger anstrengend" lassen sich
 * am gerenderten Ergebnis nachrechnen, statt sie zu behaupten.
 *
 * ⚠ **Was hier herauskommt, ist NICHT der Klang des Geraets.** Gerechnet wird
 * dieselbe vereinfachte Vorschau wie in `gui/preview.ts` (siehe
 * `patternStimmen`): Samples antriggern, Anschlag zu Pegel, Note zu
 * Abspielrate, Gate zu Dauer. Kein Filter, keine Huellkurve, keine Insert- und
 * Master-Effekte. Jede Messung daraus ist eine Aussage ueber das
 * ARRANGEMENT — ueber Dichte, Verteilung, Pegelverlauf — und nicht darueber,
 * was am Ende aus dem E2S kommt.
 */

import type { EditorPattern, PoolSample } from "./editorModel";
import { stepDauer, stimmen } from "./patternStimmen";

export interface RenderErgebnis {
  /** Ineinander verschraenkt: L, R, L, R … */
  pcm: Float32Array;
  sampleRate: number;
  kanaele: 2;
  /** Laenge in Sekunden. */
  sekunden: number;
}

export interface RenderOptionen {
  /** Wie oft das Pattern durchlaeuft (Vorgabe 1). */
  durchgaenge?: number;
  sampleRate?: number;
  /** Zusatzzeit am Ende, damit nichts abgeschnitten wird (Sekunden, Vorgabe 1). */
  ausklang?: number;
}

/** Kuerzeste Tonlaenge — auch ein Gate von 1 soll nicht knacksen statt klingen. */
const MIN_DAUER_S = 0.02;
/** Weiche Kante am Tonende. Ohne sie knackt jeder Gate-Schnitt in der Datei. */
const RELEASE_S = 0.003;

export function rendere(
  pattern: EditorPattern,
  samples: readonly PoolSample[],
  opts: RenderOptionen = {},
): RenderErgebnis {
  const sr = opts.sampleRate ?? 44100;
  const durchgaenge = Math.max(1, Math.floor(opts.durchgaenge ?? 1));
  const ausklang = Math.max(0, opts.ausklang ?? 1);
  const stepS = stepDauer(pattern.bpm);
  const laengeS = pattern.stepLength * durchgaenge * stepS + ausklang;
  const frames = Math.max(1, Math.ceil(laengeS * sr));
  const links = new Float32Array(frames);
  const rechts = new Float32Array(frames);

  const nachNummer = new Map(samples.map((s) => [s.number, s]));
  const stimmenListe = stimmen(pattern);

  for (let d = 0; d < durchgaenge; d++) {
    for (const v of stimmenListe) {
      const s = nachNummer.get(v.sampleNumber);
      // Ein Part kann auf eine Nummer zeigen, die es im Pool nicht (mehr) gibt.
      // Dann bleibt er still, statt den ganzen Lauf abzubrechen.
      if (!s || s.pcm.length === 0) continue;
      const startFrame = Math.round((d * pattern.stepLength + v.step) * stepS * sr);
      if (startFrame >= frames) continue;
      // Zwei Gruende fuer eine andere Schrittweite als 1: die Tonhoehe und ein
      // Sample, das mit einer anderen Abtastrate abgelegt ist.
      const schritt = v.rate * ((s.sampleRate || sr) / sr);
      const dauerS = v.dauerSteps === null ? Infinity : Math.max(MIN_DAUER_S, v.dauerSteps * stepS);
      const maxFrames = dauerS === Infinity ? frames - startFrame : Math.ceil(dauerS * sr);
      // Panorama gleicher Leistung — so wie es der Vorhoer-Spieler im Fenster macht.
      const x = ((v.pan + 1) / 2) * (Math.PI / 2);
      const gl = Math.cos(x) * v.gain;
      const gr = Math.sin(x) * v.gain;
      const releaseFrames = Math.max(1, Math.round(RELEASE_S * sr));

      for (let n = 0; n < maxFrames; n++) {
        const ziel = startFrame + n;
        if (ziel >= frames) break;
        const pos = n * schritt;
        const i = Math.floor(pos);
        if (i + 1 >= s.pcm.length) break;
        // Zwischen zwei Abtastwerten linear mitteln, sonst rauscht jede
        // Tonhoehenaenderung hoerbar.
        const t = pos - i;
        const wert = s.pcm[i] * (1 - t) + s.pcm[i + 1] * t;
        // Weiche Kante nur, wenn der Ton wirklich abgeschnitten wird.
        const huelle = dauerS === Infinity ? 1 : Math.min(1, (maxFrames - n) / releaseFrames);
        links[ziel] += wert * gl * huelle;
        rechts[ziel] += wert * gr * huelle;
      }
    }
  }

  // Erst am Ende begrenzen: Summen duerfen intern ueber 1 gehen, aus der Datei
  // soll aber nichts herausstehen.
  const pcm = new Float32Array(frames * 2);
  for (let f = 0; f < frames; f++) {
    pcm[f * 2] = Math.max(-1, Math.min(1, links[f]));
    pcm[f * 2 + 1] = Math.max(-1, Math.min(1, rechts[f]));
  }
  return { pcm, sampleRate: sr, kanaele: 2, sekunden: frames / sr };
}

/**
 * Eine ganze Kette ausrechnen: ab `start` den `chainTo`-Verweisen folgen und
 * jedes Pattern so oft spielen, wie `chainRepeat` sagt.
 *
 * `grenze` bricht Ringe ab — eine Kette, die auf sich selbst zeigt, wuerde
 * sonst endlos rendern. Das ist kein Sonderfall: das Geraet spielt so eine
 * Kette tatsaechlich endlos.
 */
export function rendereKette(
  patterns: readonly EditorPattern[],
  samples: readonly PoolSample[],
  opts: RenderOptionen & { start?: number; grenze?: number } = {},
): RenderErgebnis {
  const sr = opts.sampleRate ?? 44100;
  const grenze = opts.grenze ?? 64;
  const teile: RenderErgebnis[] = [];
  let i = Math.max(0, opts.start ?? 0);
  const gesehen = new Set<number>();
  for (let n = 0; n < grenze; n++) {
    const p = patterns[i];
    if (!p) break;
    teile.push(rendere(p, samples, { sampleRate: sr, durchgaenge: Math.max(1, p.chainRepeat ?? 1), ausklang: 0 }));
    const weiter = (p.chainTo ?? 0) - 1;
    if (weiter < 0 || weiter >= patterns.length) break;
    // Ring erkannt: das Geraet liefe endlos, die Datei soll das nicht.
    if (gesehen.has(weiter)) break;
    gesehen.add(weiter);
    i = weiter;
  }
  if (!teile.length) return { pcm: new Float32Array(2), sampleRate: sr, kanaele: 2, sekunden: 0 };
  const gesamt = teile.reduce((a, t) => a + t.pcm.length, 0);
  const pcm = new Float32Array(gesamt + Math.round(sr * 2)); // etwas Ausklang
  let off = 0;
  for (const t of teile) {
    pcm.set(t.pcm, off);
    off += t.pcm.length;
  }
  return { pcm, sampleRate: sr, kanaele: 2, sekunden: pcm.length / 2 / sr };
}

/**
 * grooveAusLied — das Timing-Gefühl eines Lieds als Groove-Vorlage.
 *
 * Der Gedanke: Ein Stueck klingt nicht deshalb lebendig, weil die Schlaege
 * genau auf dem Raster liegen, sondern weil sie **daneben** liegen — mal
 * frueher, mal spaeter, mit wechselnder Anschlagstaerke. Genau das misst diese
 * Analyse und giesst es in eine Vorlage, die das Geraet auf eigene Patterns
 * anwenden kann.
 *
 * Ablauf: Tempo bestimmen (oder uebernehmen), Anschlaege finden, ein
 * 16tel-Raster darueberlegen und je Step nachsehen, wie weit der naechste
 * Anschlag daneben liegt. Ueber alle Takte gemittelt, damit ein einzelner
 * Ausreisser nicht die ganze Vorlage verbiegt.
 *
 * Reine Rechnung auf Mono-PCM — kein Geraet, keine Oberflaeche.
 */
import { onsetKurve, tempoSchaetzen } from "./tempoAnalyse";
import { GROOVE_STEPS, TRIGGER_MAX, VELOCITY_MAX, GATE_MAX, type Groove, type GrooveStep } from "./e2Groove";

const HOP = 256;
/** Ein voller Step entspricht 96 Einheiten; ±48 ist die halbe Steplaenge. */
const EINHEITEN_PRO_STEP = 2 * TRIGGER_MAX;

export interface GrooveAusLiedOpts {
  /** Bekanntes Tempo; ohne Angabe wird gemessen. */
  bpm?: number;
  /** Wie viele 16tel ausgewertet werden (Standard 64 = vier Takte). */
  steps?: number;
  /** Name der Vorlage. */
  name?: string;
}

export interface GrooveAusLiedErgebnis {
  bpm: number;
  groove: Groove;
  /** Steps, an denen wirklich ein Anschlag gefunden wurde. */
  belegteSteps: number;
}

/**
 * Anschlaege als Positionen in Frames, mit ihrer Staerke.
 *
 * ⚠ Die Onset-Kurve misst den **Anstieg** der Energie. Beginnt eine Datei
 * direkt mit einem Schlag, gibt es davor nichts, wogegen der Anstieg zaehlen
 * koennte — der allererste Schlag faellt sonst unter den Tisch und das ganze
 * Raster verschiebt sich um einen Schlag. Darum ein Stueck Stille davor.
 */
function anschlaege(pcm: Float32Array, sr: number): { frame: number; staerke: number }[] {
  const vorlauf = HOP * 2;
  const gepolstert = new Float32Array(pcm.length + vorlauf);
  gepolstert.set(pcm, vorlauf);
  const kurve = onsetKurve(gepolstert, sr, HOP);
  let max = 0;
  for (const v of kurve) if (v > max) max = v;
  if (max <= 0) return [];
  const schwelle = 0.25 * max;
  const out: { frame: number; staerke: number }[] = [];
  for (let i = 1; i < kurve.length - 1; i++) {
    // lokales Maximum ueber der Schwelle — sonst zaehlt ein breiter Anstieg mehrfach
    if (kurve[i] >= schwelle && kurve[i] >= kurve[i - 1] && kurve[i] > kurve[i + 1]) {
      // Die Kurve hat nur alle 256 Frames einen Wert — das sind rund 5 der 96
      // Einheiten eines Steps. Ohne Verfeinerung traegt jeder Schlag dieses
      // Rauschen, und ein glattes Stueck ergaebe eine zappelige Vorlage. Die
      // Parabel durch die drei Werte um die Spitze liefert die Zwischenstelle.
      const y0 = kurve[i - 1];
      const y1 = kurve[i];
      const y2 = kurve[i + 1];
      const nenner = y0 - 2 * y1 + y2;
      const fein = nenner !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (y0 - y2)) / nenner)) : 0;
      out.push({ frame: (i + fein) * HOP - vorlauf, staerke: y1 / max });
    }
  }
  return out;
}

/** Abweichung eines Frames vom Raster, in Steps (−0,5 … +0,5). */
function abweichung(frame: number, start: number, stepFrames: number): number {
  const genau = (frame - start) / stepFrames;
  return genau - Math.round(genau);
}

/**
 * Wo beginnt das Raster? Nicht einfach beim ersten Schlag — der kann ein
 * Auftakt sein. Stattdessen jeden der ersten Anschlaege als Anfang durchspielen
 * und den nehmen, bei dem alle uebrigen am besten aufs Raster passen. Bei
 * Gleichstand gewinnt der fruehere, damit das Ergebnis eindeutig bleibt.
 */
function rasterStart(liste: { frame: number; staerke: number }[], stepFrames: number): number {
  if (!liste.length) return 0;
  let bester = liste[0].frame;
  let bestFehler = Infinity;
  for (const kandidat of liste.slice(0, 16)) {
    let fehler = 0;
    for (const a of liste) fehler += Math.abs(abweichung(a.frame, kandidat.frame, stepFrames));
    const mittel = fehler / liste.length;
    // Spuerbar besser muss es sein, nicht nur rechnerisch: die Anschlaege liegen
    // auf einem groben Zeitraster, und dieses Rauschen macht sonst einen
    // beliebigen spaeten Anschlag zum "Sieger". Bei Gleichstand bleibt der
    // fruehere — der Anfang der Vorlage soll am Anfang des Materials liegen.
    if (mittel < bestFehler - 0.01) {
      bestFehler = mittel;
      bester = kandidat.frame;
    }
  }
  return bester;
}

export function grooveAusAudio(pcm: Float32Array, sr: number, opts: GrooveAusLiedOpts = {}): GrooveAusLiedErgebnis {
  const steps = Math.max(1, Math.min(GROOVE_STEPS, Math.round(opts.steps ?? GROOVE_STEPS)));
  const bpm = opts.bpm && opts.bpm > 0 ? opts.bpm : tempoSchaetzen(pcm, sr);
  const stepFrames = (60 / bpm / 4) * sr;
  const liste = anschlaege(pcm, sr);
  const start = rasterStart(liste, stepFrames);

  // je Step alle Treffer sammeln (ueber alle Wiederholungen des Musters)
  const versatzSumme = new Float64Array(steps);
  const staerkeSumme = new Float64Array(steps);
  const treffer = new Int32Array(steps);
  const fenster = stepFrames / 2;
  void fenster;
  for (const a of liste) {
    const stepGenau = (a.frame - start) / stepFrames;
    const step = Math.round(stepGenau);
    const versatz = stepGenau - step; // −0.5 … +0.5 Steps
    // Eine Vorlage wiederholt sich — Anschlaege VOR dem gewaehlten Anfang
    // gehoeren ans Ende des Musters, nicht in den Papierkorb. Sonst haengt das
    // Ergebnis davon ab, wo die Messung zufaellig eingestiegen ist.
    const i = ((step % steps) + steps) % steps;
    versatzSumme[i] += versatz;
    staerkeSumme[i] += a.staerke;
    treffer[i]++;
  }

  const grooveSteps: GrooveStep[] = [];
  let belegte = 0;
  for (let i = 0; i < GROOVE_STEPS; i++) {
    if (i >= steps || treffer[i] === 0) {
      // Kein Anschlag: Standardwerte, damit dieser Step nichts veraendert
      grooveSteps.push({ trigger: 0, velocity: 0x60, gate: 0x60 });
      continue;
    }
    belegte++;
    const mittel = versatzSumme[i] / treffer[i];
    const staerke = staerkeSumme[i] / treffer[i];
    grooveSteps.push({
      trigger: Math.max(-TRIGGER_MAX, Math.min(TRIGGER_MAX, Math.round(mittel * EINHEITEN_PRO_STEP))),
      // Anschlagstaerke aus der Onset-Hoehe; 0x60 bleibt der neutrale Mittelwert
      velocity: Math.max(1, Math.min(VELOCITY_MAX, Math.round(60 + staerke * 67))),
      gate: GATE_MAX,
    });
  }

  return {
    bpm,
    groove: {
      name: (opts.name ?? `Groove ${Math.round(bpm)}`).slice(0, 15),
      laenge: steps,
      steps: grooveSteps,
    },
    belegteSteps: belegte,
  };
}

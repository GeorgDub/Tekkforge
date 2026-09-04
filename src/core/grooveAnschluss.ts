/**
 * grooveAnschluss — das Timing des Lieds in die erzeugten Patterns bringen.
 *
 * `grooveAusLied` misst seit langem, wie weit die Schlaege eines Stuecks neben
 * dem Raster liegen, und `e2Groove` kann daraus eine Vorlage bauen. Nur rief
 * der Generator beides nie auf: jedes erzeugte Set lief schnurgerade, egal
 * wie das Original schwang. Hier ist der Anschluss.
 *
 * Zwei Wege, weil das Geraet zwei Mechanismen hat:
 *
 * 1. **Swing je Pattern** (−50…+50 %, Byte 0x24, gerätebestaetigt): der
 *    mittlere Versatz der ungeraden 16tel. Steht in der Pattern-Datei selbst,
 *    braucht nichts am Geraet und wirkt sofort auf alle Parts.
 * 2. **Groove-Vorlage** (320-Byte-Block, Hacktribe-RAM oder Firmware): traegt
 *    das ganze gemessene Muster je Step. Sie liegt dem Set als Datei bei und
 *    kann ueber die Werkbank ins Geraet — wirkt erst, wenn ein Part darauf
 *    zeigt (grooveType/grooveDepth).
 *
 * Der Swing ist der Teil, der immer greift; die Vorlage der, der genauer ist.
 */
import { grooveAusAudio } from "./grooveAusLied";
import { TRIGGER_MAX, type Groove } from "./e2Groove";
import type { E2PatternInput } from "./electribePatternBuilder";

/** Ein Step sind 96 Einheiten (±48 = halber Step); 48 Einheiten sind 50 % Swing. */
const EINHEITEN_PRO_STEP = 2 * TRIGGER_MAX;
/** Unter dieser Staerke ist es Messrauschen, kein Swing — dann bleibt es gerade. */
export const SWING_MINDESTENS = 3;
export const SWING_MAX = 50;

/** Gemessen wird ueber einen Takt; laengere Muster mitteln sich nur weg. */
const GROOVE_STEPS = 16;

const neutral = (s: Groove["steps"][number]): boolean => s.trigger === 0 && s.velocity === 0x60 && s.gate === 0x60;

/**
 * Swing in Prozent aus einer Vorlage: mittlerer Versatz der ungeraden Steps
 * (das sind die Offbeats), ein Viertel Step spaeter = 25 %. Ohne mindestens
 * zwei belegte ungerade Steps gibt es nichts zu mitteln — dann 0.
 */
export function swingAusGroove(g: Groove): number {
  const ungerade = g.steps.slice(0, g.laenge).filter((s, i) => i % 2 === 1 && !neutral(s));
  if (ungerade.length < 2) return 0;
  const mittel = ungerade.reduce((a, s) => a + s.trigger, 0) / ungerade.length;
  const prozent = Math.round((mittel / EINHEITEN_PRO_STEP) * 100);
  if (Math.abs(prozent) < SWING_MINDESTENS) return 0;
  return Math.max(-SWING_MAX, Math.min(SWING_MAX, prozent));
}

export interface LiedGroove {
  groove: Groove;
  swing: number;
  belegteSteps: number;
}

/** Vorlage und Swing eines Lieds bei bekanntem Tempo — am besten auf dem Drums-Stem. */
export function grooveFuerLied(pcm: Float32Array, sr: number, bpm: number, name: string): LiedGroove {
  const r = grooveAusAudio(pcm, sr, { bpm, steps: GROOVE_STEPS, name: name.slice(0, 15) });
  return { groove: r.groove, swing: swingAusGroove(r.groove), belegteSteps: r.belegteSteps };
}

/** Denselben Swing auf alle Patterns legen (0 laesst die Patterns unveraendert). */
export function mitSwing(patterns: E2PatternInput[], swing: number): E2PatternInput[] {
  const s = Math.round(Math.max(-SWING_MAX, Math.min(SWING_MAX, swing)));
  if (!s) return patterns;
  return patterns.map((p) => ({ ...p, swing: s }));
}

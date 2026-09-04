/**
 * kettenVariation — eine Pattern-Kette darf nicht wie ein Loop klingen.
 *
 * Nutzerbefund: „monoton“. Nachgemessen stimmte es — alle Patterns einer
 * Aufbau-Kette trugen dieselben Steps, nur die Mutes wuchsen. Der Drop war
 * dann viermal exakt derselbe Takt, die VRS-Patterns dahinter ebenso.
 *
 * Hier bekommt jedes Pattern k (ausser dem Drop) eine eigene Handschrift:
 *
 * - **Velocity-Streuung** auf den Schlagzeug- und Bass-Parts 0–8, aus einem
 *   festen Zufallsgeber (Seed startwert + k) — reproduzierbar, jedes Pattern
 *   anders.
 * - **Hat-Figur** (Part 4) rotiert bei ungeradem k um zwei Steps und wechselt
 *   die Akzente 82/70 — die Hi-Hat ist das, was man ueber vier Takte am
 *   deutlichsten als „immer gleich“ hoert.
 * - **Ghost-Kick** (Vel 70, Gate 8) auf Step 58 bei ungeradem k ≥ 1: ein
 *   leiser Vorschlag vor dem letzten Takt-Ende, nicht auf 60/62, wo Kick 2
 *   und Perc 2 schon sitzen.
 * - **Snare-Fill** im letzten Takt bei k % 4 === 3 — dieselbe Definition wie
 *   im Editor und im Aufbau (`fillSchlaege`).
 *
 * Parts 12–15 (Melodie, Vocals) bleiben unangetastet — Melodien werden nicht
 * zerstueckelt. Der Drop bleibt byteweise, wie er war: er ist der Anker.
 */
import type { E2PatternInput, E2PartInput, E2StepInput } from "./electribePatternBuilder";
import { fillSchlaege, zufall } from "./patternVarianten";

export interface KettenVariationOptionen {
  /** Startwert des Zufallsgebers (Vorgabe 7). */
  startwert?: number;
  /** Groesste Velocity-Abweichung (Vorgabe 10). */
  streuung?: number;
  /** Index des Drop-Patterns — bleibt unveraendert (Vorgabe: keins). */
  drop?: number;
}

const HAT_PART = 4;
const KICK_PART = 0;
const SNARE_PART = 2;
const GHOST_STEP = 58;
const HAT_AKZENTE = [82, 70];
/** Ab hier bleibt alles, wie es ist: Melodie und Vocals. */
const ERSTER_SCHLEIFEN_PART = 12;

const kopie = (p: E2PartInput): E2PartInput => ({ ...p, steps: p.steps.map((s) => ({ ...s })) });

function streue(part: E2PartInput, wuerfel: () => number, streuung: number): void {
  for (const s of part.steps) {
    // Der Wuerfel laeuft auch fuer leere Steps, damit das Muster nicht von
    // der Belegung abhaengt (wie in patternVarianten.menschlich).
    const ab = Math.round((wuerfel() * 2 - 1) * streuung);
    if (!s.active) continue;
    s.velocity = Math.min(127, Math.max(1, (s.velocity ?? 96) + ab));
  }
}

function hatRotieren(part: E2PartInput): void {
  const n = part.steps.length;
  const alt = part.steps;
  const neu: E2StepInput[] = alt.map((_, i) => ({ ...alt[(i - 2 + n) % n] }));
  let nr = 0;
  for (const s of neu) if (s.active) s.velocity = HAT_AKZENTE[nr++ % HAT_AKZENTE.length];
  part.steps = neu;
}

function ghostKick(part: E2PartInput): void {
  if (part.steps.length <= GHOST_STEP || part.steps[GHOST_STEP].active) return;
  const vorlage = part.steps.find((s) => s.active);
  part.steps[GHOST_STEP] = { active: true, notes: vorlage?.notes ?? [60], velocity: 70, gate: 8 };
}

function snareFill(part: E2PartInput): void {
  const vorlage = part.steps.find((s) => s.active);
  for (const schlag of fillSchlaege(part.steps.length)) {
    part.steps[schlag.index] = { active: true, notes: vorlage?.notes ?? [60], velocity: schlag.velocity, gate: schlag.gate };
  }
}

/** Ein einzelnes Pattern mit der Handschrift k (0 = unveraendert bis auf die Streuung). */
export function variierePattern(pattern: E2PatternInput, k: number, opts: KettenVariationOptionen = {}): E2PatternInput {
  const streuung = opts.streuung ?? 10;
  const wuerfel = zufall((opts.startwert ?? 7) + k * 7919);
  const parts = pattern.parts.map((p, idx) => {
    if (idx >= ERSTER_SCHLEIFEN_PART) return p;
    const q = kopie(p);
    if (idx <= 8 && streuung > 0) streue(q, wuerfel, streuung);
    if (idx === HAT_PART && k % 2 === 1) hatRotieren(q);
    if (idx === KICK_PART && k % 2 === 1 && k >= 1) ghostKick(q);
    if (idx === SNARE_PART && k % 4 === 3) snareFill(q);
    return q;
  });
  return { ...pattern, parts };
}

/** Die ganze Kette: Pattern k bekommt Handschrift k, der Drop bleibt. */
export function variiereKette(patterns: E2PatternInput[], opts: KettenVariationOptionen = {}): E2PatternInput[] {
  return patterns.map((p, k) => (k === opts.drop ? p : variierePattern(p, k, opts)));
}

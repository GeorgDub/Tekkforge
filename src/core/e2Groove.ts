/**
 * e2Groove — Groove-Vorlagen des Geraets (320-Byte-Bloecke im RAM, 96 Plaetze).
 *
 * Eine Vorlage legt je Step drei Dinge fest: den **Zeitversatz** (halber Step
 * nach vorn oder hinten), die **Anschlagstaerke** und die **Tonlaenge**. Genau
 * damit entsteht Swing oder ein eigenes Timing-Gefuehl, statt aus den
 * mitgelieferten Vorlagen zu waehlen.
 *
 * Layout (Quelle: bangcorrupt/hacktribe-editor, **AGPL-3.0**,
 * `extra/e2_groove_template.py` — das Werkzeug des Hacktribe-Autors selbst,
 * inklusive der Wertebereiche in seinen Settern):
 *
 * | Offset | Inhalt |
 * |---|---|
 * | 0x000 | "GVST" |
 * | 0x010 | Name, 15 Zeichen ASCII |
 * | 0x022 | Laenge in Steps (Standard 0x40 = 64), danach 0xFF |
 * | 0x030 | 64 Steps a 4 Byte: Versatz, Velocity, Gate, 0xFF |
 * | 0x13C | "GVED" |
 *
 * ⚠ **Zwei Quellen, zwei Step-Adressen.** Die Fassung von 13HansSeppaufpepp12
 * (`e2_formats.py`) legt die Steps auf **0x24**, das Werkzeug des Autors auf
 * **0x30**. Wir folgen dem Autor — sein Skript sendet Vorlagen wirklich ans
 * Geraet, die Fork-Struktur ist eine Nacherklaerung. Zur Sicherheit prueft
 * `erkenneStepBasis` das 0xFF-Muster jedes vierten Bytes und meldet, wenn eine
 * gelesene Vorlage anders liegt, statt still an der falschen Stelle zu schreiben.
 */

export const GROOVE_SIZE = 0x140;
export const GROOVE_STEPS = 0x40;
/** Beginn der Step-Tabelle (siehe Quellen-Hinweis oben). */
export const GROOVE_STEP_BASIS = 0x30;
const STEP_STRIDE = 4;
const NAME_OFF = 0x10;
const NAME_LEN = 0x0f;
const LAENGE_OFF = 0x22;

/** Groesster Zeitversatz: ±0x30 entspricht einem halben Step. */
export const TRIGGER_MAX = 0x30;
/** Groesste Tonlaenge (0x60 = Tie), wie im Editor des Geraets. */
export const GATE_MAX = 0x60;
export const VELOCITY_MAX = 0x7f;

export interface GrooveStep {
  /** Zeitversatz −48..+48 (negativ = frueher) */
  trigger: number;
  velocity: number;
  gate: number;
}

export interface Groove {
  name: string;
  /** Schleifenlaenge in Steps, 1..64 */
  laenge: number;
  steps: GrooveStep[];
}

const klemme = (v: number, min: number, max: number): number => Math.max(min, Math.min(max, Math.round(v) || 0));

/**
 * Sucht den Beginn der Step-Tabelle am 0xFF-Muster jedes vierten Bytes.
 * Gibt null zurueck, wenn nirgends 64 Steps am Stueck passen.
 */
export function erkenneStepBasis(bytes: Uint8Array): number | null {
  for (const basis of [GROOVE_STEP_BASIS, 0x24]) {
    let treffer = 0;
    for (let i = 0; i < GROOVE_STEPS; i++) {
      const o = basis + i * STEP_STRIDE + 3;
      if (o < bytes.length && bytes[o] === 0xff) treffer++;
    }
    if (treffer === GROOVE_STEPS) return basis;
  }
  return null;
}

export function decodeGroove(bytes: Uint8Array): Groove {
  const b = bytes;
  let name = "";
  for (let i = 0; i < NAME_LEN; i++) {
    const c = b[NAME_OFF + i];
    if (!c) break;
    name += String.fromCharCode(c);
  }
  const steps: GrooveStep[] = [];
  for (let i = 0; i < GROOVE_STEPS; i++) {
    const o = GROOVE_STEP_BASIS + i * STEP_STRIDE;
    const roh = b[o] ?? 0;
    steps.push({
      // Der Versatz steht als Zweierkomplement im Byte
      trigger: roh >= 0x80 ? roh - 0x100 : roh,
      velocity: b[o + 1] ?? 0,
      gate: b[o + 2] ?? 0,
    });
  }
  return {
    name: name.replace(/[^\x20-\x7e]/g, "").trimEnd(),
    laenge: klemme(b[LAENGE_OFF] ?? GROOVE_STEPS, 1, GROOVE_STEPS),
    steps,
  };
}

/**
 * Vorlage zurueck in 320 Bytes. `basis` ist der gelesene Block: alles, wofuer
 * es hier kein Feld gibt, bleibt daraus erhalten.
 */
export function encodeGroove(g: Groove, basis?: Uint8Array): Uint8Array {
  const b = new Uint8Array(GROOVE_SIZE);
  b.set((basis ?? initGrooveBytes()).subarray(0, GROOVE_SIZE));
  const name = g.name.replace(/[^\x20-\x7e]/g, "").slice(0, NAME_LEN);
  for (let i = 0; i < NAME_LEN; i++) b[NAME_OFF + i] = i < name.length ? name.charCodeAt(i) : 0;
  b[LAENGE_OFF] = klemme(g.laenge, 1, GROOVE_STEPS);
  for (let i = 0; i < GROOVE_STEPS; i++) {
    const s = g.steps[i];
    if (!s) continue;
    const o = GROOVE_STEP_BASIS + i * STEP_STRIDE;
    const t = klemme(s.trigger, -TRIGGER_MAX, TRIGGER_MAX);
    b[o] = t < 0 ? 0x100 + t : t;
    b[o + 1] = klemme(s.velocity, 0, VELOCITY_MAX);
    b[o + 2] = klemme(s.gate, 0, GATE_MAX);
    b[o + 3] = 0xff;
  }
  return b;
}

/** Leere Vorlage: kein Versatz, Velocity und Gate auf 0x60, 64 Steps. */
export function initGrooveBytes(): Uint8Array {
  const b = new Uint8Array(GROOVE_SIZE);
  b.set([0x47, 0x56, 0x53, 0x54]); // "GVST"
  const name = "Init Groove";
  for (let i = 0; i < NAME_LEN; i++) b[NAME_OFF + i] = i < name.length ? name.charCodeAt(i) : 0;
  b[LAENGE_OFF] = GROOVE_STEPS;
  b[LAENGE_OFF + 1] = 0xff;
  for (let i = 0; i < GROOVE_STEPS; i++) {
    const o = GROOVE_STEP_BASIS + i * STEP_STRIDE;
    b[o] = 0x00;
    b[o + 1] = 0x60;
    b[o + 2] = 0x60;
    b[o + 3] = 0xff;
  }
  b.set([0x47, 0x56, 0x45, 0x44], GROOVE_SIZE - 4); // "GVED"
  return b;
}

/**
 * Swing: jeden zweiten Step um `staerke` nach hinten schieben (0 = gerade).
 * Das ist der haeufigste Grund, ueberhaupt eine eigene Vorlage zu bauen.
 */
export function setzeSwing(g: Groove, staerke: number): void {
  const s = klemme(staerke, 0, TRIGGER_MAX);
  g.steps.forEach((step, i) => {
    step.trigger = i % 2 === 1 ? s : 0;
  });
}

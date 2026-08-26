/**
 * patternVarianten — aus einem Pattern eine Abwandlung bauen.
 *
 * Gedacht fuer die Aufbau-Ketten: dieselbe Figur einmal duenn als Intro,
 * einmal mit Wirbel vor dem Drop, einmal im doppelten Tempo als Steigerung.
 * Von Hand ist das Klickarbeit, und beim Nachbauen schleichen sich Fehler ein.
 *
 * Grundsaetze:
 *
 * - Das Original wird NIE angefasst. Zurueck kommt immer ein neues Pattern,
 *   gebaut mit `clonePattern`, damit auch `rawBody` eine eigene Kopie ist —
 *   sonst teilten Original und Variante denselben Puffer.
 * - Die Kette wird nicht mitgenommen. Eine Variante, die auf dasselbe
 *   Folge-Pattern zeigt wie ihr Original, bildet einen Ast, den die Kette
 *   nie besucht. Das Einfaedeln entscheidet der Aufrufer.
 * - Zeitliches Verschieben einzelner Steps gibt es hier nicht: Das Geraet
 *   kennt kein Mikro-Timing im Pattern, das steckt in der Groove-Vorlage
 *   (siehe e2Groove.ts). "Menschlich" heisst hier deshalb ausschliesslich
 *   Anschlagstaerke.
 */

import {
  clonePattern,
  createStep,
  EDITOR_GATE_MAX,
  EDITOR_MAX_STEPS,
  type EditorPattern,
  type EditorStep,
} from "./editorModel";

export type VariantenArt = "fill" | "halb" | "doppelt" | "duenn" | "rueckwaerts" | "menschlich";

export interface VariantenInfo {
  /** Beschriftung fuer Knopf/Menue. */
  titel: string;
  /** Was passiert — eine Zeile, fuer den Nutzer. */
  hinweis: string;
  /** Kuerzel, das an den Pattern-Namen gehaengt wird. */
  kuerzel: string;
}

export const VARIANTEN: Record<VariantenArt, VariantenInfo> = {
  fill: {
    titel: "Fill",
    hinweis: "Wirbel auf der Snare im letzten Viertel, mit ansteigendem Anschlag — der Übergang in den Drop.",
    kuerzel: "FILL",
  },
  halb: {
    titel: "Halbes Tempo",
    hinweis: "Alles doppelt so lang: die Steps rücken auseinander, die Pattern-Länge verdoppelt sich.",
    kuerzel: "HALB",
  },
  doppelt: {
    titel: "Doppeltes Tempo",
    hinweis:
      "Alles doppelt so schnell und einmal wiederholt. Steps zwischen dem Raster fallen dabei weg — nur jeder zweite Zwischenschritt passt in die halbe Länge.",
    kuerzel: "DOPP",
  },
  duenn: {
    titel: "Ausdünnen",
    hinweis: "Nur noch das Viertel-Raster; Parts, die dabei leer werden, werden stummgeschaltet. Gut als Intro.",
    kuerzel: "DUENN",
  },
  rueckwaerts: {
    titel: "Rückwärts",
    hinweis: "Die genutzte Länge wird umgedreht, Anschlag/Ton/Länge wandern mit.",
    kuerzel: "REV",
  },
  menschlich: {
    titel: "Menschlicher Anschlag",
    hinweis:
      "Streut die Anschlagstärke, damit es weniger nach Maschine klingt. Die Positionen bleiben — Mikro-Timing steckt in der Groove-Vorlage, nicht im Pattern.",
    kuerzel: "HUM",
  },
};

export interface VariantenOptionen {
  /** Nur "menschlich": maximale Abweichung der Anschlagstaerke. */
  streuung?: number;
  /** Nur "menschlich": Startwert des Zufallsgebers, damit es reproduzierbar ist. */
  startwert?: number;
  /** Nur "duenn": Raster, das erhalten bleibt (Vorgabe 4 = Viertel). */
  raster?: number;
  /** Nur "fill": Part fuer den Wirbel (Vorgabe 2 = Snare im festen Layout). */
  fillPart?: number;
}

/**
 * Das Namensfeld im Pattern ist 16 Byte lang (ELECTRIBE_REAL_NAME_OFFSET,
 * ASCII, NUL-gefuellt). Wer laenger benennt, verliert den Rest beim Export —
 * still. Also hier schon kuerzen, damit im Editor steht, was auch ankommt.
 */
const NAME_MAX = 16;

/** Ein Schlag des Fill-Wirbels: wohin, wie fest, wie lang. */
export interface FillSchlag {
  index: number;
  velocity: number;
  gate: number;
}

/** Anschlag am Anfang des Wirbels — die Hoehe, auf der der gedimmte Aufbau laeuft. */
const FILL_VON = 90;
/** Kurze Toene, sonst verschmiert der Wirbel zu einem Rauschen. */
const FILL_GATE = 10;

/**
 * Der Fill-Wirbel — EINE Definition fuer den Editor und den Generator.
 *
 * Beide bauten ihn vorher getrennt und mit verschiedenen Werten: der Generator
 * in Achteln ab 90, der Editor in Sechzehnteln ab 70. Damit verbesserte jede
 * Aenderung nur eine Haelfte. Vereinheitlicht auf Sechzehntel — der Uebergang
 * in den Drop soll druecken — und auf den Anschlag-Startwert des Generators,
 * weil der Wirbel dort an den gedimmten Aufbau anschliesst statt danebenzu-
 * springen.
 *
 * Belegt wird das letzte Viertel der genutzten Laenge: bei 64 Steps der letzte
 * Takt, bei 16 Steps das letzte Viertel.
 */
export function fillSchlaege(stepLength: number): FillSchlag[] {
  const ab = stepLength - Math.floor(stepLength / 4);
  const anzahl = stepLength - ab;
  // Die Rampe ist am ENDE verankert, nicht am Anfang: der letzte Schlag liegt
  // immer auf 127, weil er den Drop anschiebt. Damit stimmt auch der Grenzfall
  // eines einzelnen Schlags von selbst, ohne Sonderbehandlung.
  return Array.from({ length: anzahl }, (_, k) => ({
    index: ab + k,
    velocity: Math.max(1, Math.round(127 - ((127 - FILL_VON) * (anzahl - 1 - k)) / Math.max(1, anzahl - 1))),
    gate: FILL_GATE,
  }));
}

export function variantenName(quelle: string, art: VariantenArt): string {
  const kuerzel = VARIANTEN[art].kuerzel;
  const platz = NAME_MAX - kuerzel.length - 1;
  const stamm = quelle.slice(0, Math.max(1, platz)).trimEnd();
  return `${stamm} ${kuerzel}`.slice(0, NAME_MAX);
}

export function baueVariante(quelle: EditorPattern, art: VariantenArt, opts: VariantenOptionen = {}): EditorPattern {
  const v = clonePattern(quelle);
  v.name = variantenName(quelle.name, art);
  // Die Kette gehoert dem Original; der Aufrufer faedelt die Variante ein.
  delete v.chainTo;
  delete v.chainRepeat;

  switch (art) {
    case "rueckwaerts":
      rueckwaerts(v);
      break;
    case "halb":
      halb(v);
      break;
    case "doppelt":
      doppelt(v);
      break;
    case "duenn":
      duenn(v, opts.raster ?? 4);
      break;
    case "menschlich":
      menschlich(v, opts.streuung ?? 14, opts.startwert ?? 1);
      break;
    case "fill":
      fill(v, opts.fillPart ?? 2);
      break;
  }
  return v;
}

/**
 * Zieht die Ketten-Verweise mit, nachdem an `index` ein Pattern eingeschoben
 * wurde. `chainTo` ist der 1-basierte Listenplatz, also verschiebt jeder
 * Einschub in der Mitte stumm jede Kette, die dahinter zeigt — das Geraet
 * spielt danach ein anderes Pattern als gemeint, ohne dass irgendetwas
 * meckert. Ans Ende anzuhaengen ist harmlos; dann tut diese Funktion nichts.
 */
export function kettenNachEinschub(patterns: readonly EditorPattern[], index: number): void {
  const abNummer = index + 1;
  for (const p of patterns) {
    if (p.chainTo === undefined || p.chainTo < abNummer) continue;
    p.chainTo += 1;
  }
}

// ─── die einzelnen Abwandlungen ──────────────────────────────────────────────

function leererStep(): EditorStep {
  return createStep();
}

/** Setzt die genutzten Steps eines Parts neu; der Rest wird geleert. */
function schreibeSteps(steps: EditorStep[], neu: EditorStep[]): void {
  for (let i = 0; i < EDITOR_MAX_STEPS; i++) steps[i] = neu[i] ?? leererStep();
}

function rueckwaerts(p: EditorPattern): void {
  const n = p.stepLength;
  for (const part of p.parts) {
    const neu: EditorStep[] = [];
    for (let i = 0; i < n; i++) neu[i] = { ...part.steps[n - 1 - i] };
    schreibeSteps(part.steps, neu);
  }
}

function halb(p: EditorPattern): void {
  if (p.stepLength === 64)
    throw new Error(
      "Halbes Tempo braucht die doppelte Länge — bei 64 Steps ist das Maximum des Geräts erreicht. Erst kürzen oder das Pattern teilen.",
    );
  const alt = p.stepLength;
  for (const part of p.parts) {
    const neu: EditorStep[] = [];
    for (let i = 0; i < alt; i++) {
      const s = { ...part.steps[i] };
      // Die Toene sollen genauso lang klingen wie vorher, und Gate zaehlt
      // relativ zum Step — bei doppeltem Abstand also doppelter Wert.
      s.gate = Math.min(EDITOR_GATE_MAX, s.gate * 2);
      neu[i * 2] = s;
      neu[i * 2 + 1] = leererStep();
    }
    schreibeSteps(part.steps, neu);
  }
  p.stepLength = (alt * 2) as 32 | 64;
}

function doppelt(p: EditorPattern): void {
  const n = p.stepLength;
  const halbeLaenge = Math.floor(n / 2);
  for (const part of p.parts) {
    const neu: EditorStep[] = [];
    for (let i = 0; i < halbeLaenge; i++) {
      const s = { ...part.steps[i * 2] };
      s.gate = Math.max(1, Math.floor(s.gate / 2));
      neu[i] = s;
      neu[halbeLaenge + i] = { ...s };
    }
    schreibeSteps(part.steps, neu);
  }
}

function duenn(p: EditorPattern, raster: number): void {
  const n = p.stepLength;
  for (const part of p.parts) {
    let hatteWas = false;
    let hatNoch = false;
    for (let i = 0; i < n; i++) {
      if (!part.steps[i].on) continue;
      hatteWas = true;
      if (i % raster === 0) hatNoch = true;
      else part.steps[i] = leererStep();
    }
    // Ein Part, dem das Ausduennen alles genommen hat, wird stummgeschaltet:
    // Beim Aufbau wird von unten nach oben entmutet, und ein Part, der klingt
    // wie nichts, aber nicht gemutet ist, bringt diese Reihenfolge
    // durcheinander. Parts, die vorher schon leer waren, bleiben unberuehrt.
    if (hatteWas && !hatNoch) part.muted = true;
  }
}

/**
 * Kleiner, fest verdrahteter Zufallsgeber (LCG). Bewusst nicht Math.random:
 * Zweimal dieselbe Variante soll zweimal dasselbe ergeben, sonst laesst sich
 * ein Ergebnis weder pruefen noch wiederholen.
 */
function zufall(startwert: number): () => number {
  let z = (startwert >>> 0) || 1;
  return () => {
    z = (z * 1664525 + 1013904223) >>> 0;
    return z / 4294967296;
  };
}

function menschlich(p: EditorPattern, streuung: number, startwert: number): void {
  const wuerfel = zufall(startwert);
  const n = p.stepLength;
  for (const part of p.parts) {
    for (let i = 0; i < n; i++) {
      const s = part.steps[i];
      // Der Wuerfel laeuft auch fuer abgeschaltete Steps weiter, damit das
      // Ergebnis nicht davon abhaengt, welche Steps gerade gesetzt sind.
      const ab = Math.round((wuerfel() * 2 - 1) * streuung);
      if (!s.on) continue;
      s.velocity = Math.min(127, Math.max(1, s.velocity + ab));
    }
  }
}

function fill(p: EditorPattern, partIndex: number): void {
  const part = p.parts[partIndex];
  if (!part) return;
  for (const schlag of fillSchlaege(p.stepLength)) {
    const alt = part.steps[schlag.index];
    const s = leererStep();
    s.on = true;
    s.velocity = schlag.velocity;
    s.gate = schlag.gate;
    // Den Ton des Parts behalten: was dort schon lag, sonst den vom ersten Step.
    s.note = alt.on ? alt.note : part.steps[0].note;
    part.steps[schlag.index] = s;
  }
  // Ein stummer Fill-Part waere sinnlos.
  part.muted = false;
}

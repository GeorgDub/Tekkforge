/**
 * songModus — aus einer Abfolge von Patterns einen ganzen Track machen.
 *
 * Das Geraet kann Ketten: jedes Pattern traegt ein Folge-Pattern und eine Zahl
 * von Durchgaengen. Damit laesst sich ein Arrangement bauen — Intro, Aufbau,
 * Drop, Break, Drop, Outro —, ohne live umzuschalten.
 *
 * ⚠ **Ein Pattern hat nur EIN Folgefeld.** Kommt dasselbe Pattern im Song
 * zweimal mit verschiedenen Nachfolgern vor (A B A C), laesst sich das nicht
 * mit einem Slot ausdruecken: A muesste gleichzeitig auf B und auf C zeigen.
 * Dann entsteht eine Kopie auf einem eigenen Slot. Der Planer sagt, wie oft
 * das passiert ist — sonst wundert man sich ueber Slots, die man nie angelegt
 * hat.
 *
 * Geplant wird **von hinten nach vorn**: das Ziel eines Schrittes ist der Slot
 * des naechsten, und der steht erst fest, wenn der naechste platziert ist.
 */
import { clonePattern, type EditorPattern } from "./editorModel";

/** Ein Abschnitt des Songs: welches Pattern, wie oft. */
export interface SongSchritt {
  /** Index im Pattern-Vorrat des Projekts. */
  pattern: number;
  wiederholungen: number;
}

export interface SongErgebnis {
  /** Neue Pattern-Liste — Reihenfolge = Slot-Reihenfolge (Slot = Index + 1). */
  patterns: EditorPattern[];
  /** Wie viele Kopien noetig waren, weil ein Pattern mehrfach vorkommt. */
  kopien: number;
  hinweise: string[];
}

/** Das Geraet fasst 250 Patterns; mehr Slots gibt es nicht. */
const SLOT_MAX = 250;
/** Durchgaenge sind 16-bittig, das Geraet zeigt bis 64. */
const REPEAT_MAX = 64;

const klemme = (v: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(v) || min));

export function planeSong(vorrat: readonly EditorPattern[], schritte: readonly SongSchritt[]): SongErgebnis {
  const hinweise: string[] = [];
  const patterns: EditorPattern[] = vorrat.map((p) => ({ ...p, chainTo: 0, chainRepeat: 1 }));
  if (!schritte.length) {
    hinweise.push("Der Song ist leer — es wurde keine Kette gesetzt.");
    return { patterns, kopien: 0, hinweise };
  }

  // 1) Unbekannte Nummern raus, direkt aufeinanderfolgende Gleiche zusammenfassen
  const sauber: SongSchritt[] = [];
  for (const s of schritte) {
    if (!vorrat[s.pattern]) {
      hinweise.push(`Pattern ${s.pattern} gibt es nicht — Schritt übersprungen.`);
      continue;
    }
    const letzter = sauber[sauber.length - 1];
    if (letzter && letzter.pattern === s.pattern) {
      letzter.wiederholungen += Math.max(1, Math.round(s.wiederholungen) || 1);
    } else {
      sauber.push({ pattern: s.pattern, wiederholungen: Math.max(1, Math.round(s.wiederholungen) || 1) });
    }
  }
  if (!sauber.length) {
    hinweise.push("Kein gültiger Schritt übrig.");
    return { patterns, kopien: 0, hinweise };
  }

  // 2) Slots vergeben — VORWAERTS, damit das Original den ERSTEN Auftritt
  // bekommt und Kopien die spaeteren. Andersherum stuende der Song-Anfang auf
  // einem Slot namens "A 2", waehrend "A" mittendrin auftaucht.
  const vergeben = new Set<number>();
  const slotJeSchritt: number[] = [];
  let kopien = 0;
  for (let i = 0; i < sauber.length; i++) {
    const original = sauber[i].pattern;
    if (!vergeben.has(original)) {
      vergeben.add(original);
      slotJeSchritt.push(original);
      continue;
    }
    if (patterns.length >= SLOT_MAX) {
      hinweise.push(`Ab Schritt ${i + 1} passt nichts mehr: mehr als ${SLOT_MAX} Slots wären nötig, der Song wurde gekürzt.`);
      sauber.length = i;
      break;
    }
    const kopie = clonePattern(patterns[original]);
    kopie.name = `${kopie.name} ${kopien + 2}`.slice(0, 16); // "NAME 2", "NAME 3", …
    patterns.push(kopie);
    slotJeSchritt.push(patterns.length - 1);
    kopien++;
  }

  // 3) Kette verdrahten: jeder Schritt zeigt auf den Slot des naechsten
  slotJeSchritt.forEach((index, i) => {
    const naechster = slotJeSchritt[i + 1];
    patterns[index].chainTo = naechster === undefined ? 0 : naechster + 1;
    patterns[index].chainRepeat = klemme(sauber[i].wiederholungen, 1, REPEAT_MAX);
  });

  if (kopien) {
    hinweise.push(
      `${kopien} Kopie(n) angelegt: ein Pattern kann nur EIN Folge-Pattern tragen, und im Song kommt es mehrfach mit unterschiedlichen Nachfolgern vor.`,
    );
  }
  if (patterns.length > SLOT_MAX) {
    patterns.length = SLOT_MAX;
    hinweise.push(`Auf ${SLOT_MAX} Patterns gekürzt — mehr passen nicht in eine Bank.`);
  }
  return { patterns, kopien, hinweise };
}

/** Lesbare Zusammenfassung der Kette, z. B. für die Statuszeile. */
export function songText(patterns: readonly EditorPattern[], startSlot = 1): string {
  const teile: string[] = [];
  const gesehen = new Set<number>();
  // Start ist das erste Pattern mit Kette, das von keinem anderen angesprungen wird
  const ziele = new Set(patterns.map((p) => p.chainTo ?? 0).filter((z) => z > 0));
  let i = patterns.findIndex((p, k) => (p.chainTo ?? 0) > 0 && !ziele.has(k + 1));
  if (i < 0) return "";
  while (i >= 0 && i < patterns.length && !gesehen.has(i)) {
    gesehen.add(i);
    const p = patterns[i];
    teile.push(`${p.name}${(p.chainRepeat ?? 1) > 1 ? `×${p.chainRepeat}` : ""}`);
    const naechster = (p.chainTo ?? 0) - 1;
    if (naechster < 0) break;
    i = naechster;
  }
  void startSlot;
  return teile.join(" → ");
}

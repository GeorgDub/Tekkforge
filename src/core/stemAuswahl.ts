/**
 * stemAuswahl — welche Stems aus einem Lied geholt werden sollen.
 *
 * Bis jetzt lief die Trennung immer gleich: Melodie, Vocals und Drums, Bass
 * fest in der Melodie mit drin. Wer nur die Vocals wollte, bekam trotzdem
 * alles und musste hinterher aussortieren.
 *
 * Die Auswahl ist mehr als Bequemlichkeit — sie entscheidet, was ueberhaupt im
 * Sample-RAM landet. Ein vocal-lastiges Lied fuellt die 24 MB mit Vocals; wer
 * die Drums lieber aus tekk4 nimmt, gewinnt den Platz fuer mehr Vocalspur.
 */

export type StemTeil = "melo" | "vox" | "drums" | "bass";

export const ALLE_TEILE: readonly StemTeil[] = ["melo", "vox", "drums", "bass"];

export interface StemAuswahl {
  melo: boolean;
  vox: boolean;
  drums: boolean;
  bass: boolean;
}

/** Vorgabe: wie bisher — Melodie, Vocals, Drums; Bass steckt in der Melodie. */
export const STEM_VORGABE: StemAuswahl = { melo: true, vox: true, drums: true, bass: false };

export const TEIL_NAME: Record<StemTeil, string> = {
  melo: "Melodie",
  vox: "Vocals",
  drums: "Drums",
  bass: "Bass",
};

/** Auswahl → Liste fuer die Anfrage an stems.py. Reihenfolge ist stabil. */
export function teileAus(auswahl: StemAuswahl): StemTeil[] {
  return ALLE_TEILE.filter((t) => auswahl[t]);
}

export interface AuswahlPruefung {
  /** Kann so losgelaufen werden? */
  ok: boolean;
  /** Was der Nutzer wissen sollte, bevor er startet. */
  hinweise: string[];
}

/**
 * Prueft eine Auswahl auf Faelle, die spaeter zu einem unbrauchbaren Set fuehren.
 *
 * Das ist keine Bevormundung: jeder dieser Faelle ist am Geraet schon
 * aufgetreten und kostet einen kompletten Durchlauf, wenn er erst hinterher
 * auffaellt.
 */
export function pruefeAuswahl(auswahl: StemAuswahl, opts: { tekkDrums?: boolean } = {}): AuswahlPruefung {
  const hinweise: string[] = [];
  const teile = teileAus(auswahl);
  if (!teile.length) {
    return { ok: false, hinweise: ["Nichts ausgewählt — mindestens ein Teil muss angehakt sein."] };
  }
  if (!auswahl.melo) {
    hinweise.push("Ohne Melodie fehlt dem Set das, woran man das Lied erkennt.");
  }
  if (!auswahl.drums && !opts.tekkDrums) {
    hinweise.push("Ohne Drums und ohne tekk4-Kit hat der Drop kein Schlagzeug.");
  }
  if (!auswahl.vox) {
    hinweise.push("Ohne Vocals kann die Vocalspur nicht über die Kette verteilt werden.");
  }
  if (auswahl.bass) {
    hinweise.push("Bass fällt getrennt heraus und wird aus der Melodie herausgenommen.");
  }
  return { ok: true, hinweise };
}

/** Kurzer Satz fuer die Statuszeile: was geholt wird. */
export function auswahlText(auswahl: StemAuswahl): string {
  const teile = teileAus(auswahl);
  if (!teile.length) return "nichts ausgewählt";
  return teile.map((t) => TEIL_NAME[t]).join(" + ");
}

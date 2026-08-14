/**
 * e2StepNote.ts — Notenkodierung in den Step-Records des Electribe 2.
 *
 * Das Gerät speichert eine Note NICHT als rohe MIDI-Nummer, sondern um eins
 * verschoben: `Byte = MIDI + 1`. Die 0 bleibt dadurch als „kein Ton" frei —
 * genau der Grund, warum die Verschiebung existiert.
 *
 *     Byte 0        kein Ton
 *     Byte 1..128   MIDI 0..127  (C-1 … G9)
 *
 * ## Beleg (am Gerät gemessen, 2026-08-14)
 *
 * Im Step-Editor wurden auf Part 1 / Step 1 vier Noten gesetzt und der
 * Pattern-Speicher direkt ausgelesen:
 *
 *     Anzeige   MIDI   Byte
 *     G  9      127    128
 *     F# 9      126    127
 *     E  9      124    125
 *     C -1        0      1
 *     F -1        5      6
 *
 * Zwei unabhängige Belege stecken darin:
 *
 * 1. **Byte 128 kann keine rohe MIDI-Note sein.** MIDI endet bei 127. Dass
 *    dieser Wert überhaupt auftritt, beweist eine Verschiebung — unabhängig
 *    davon, welche.
 * 2. **Die Abstände stimmen exakt.** G9→F#9 ist ein Halbton (128→127), F#9→E9
 *    sind zwei (127→125). Die Skala ist also chromatisch mit Schrittweite 1,
 *    und G9 als höchste Note landet genau auf 128. Damit ist die Verschiebung
 *    auf +1 festgenagelt, nicht bloß auf „irgendeine".
 *
 * ## Vorhergesagt, dann gemessen
 *
 * Anschliessend wurden elf weitere Noten am Geraet gesetzt — ein
 * zusammenhaengender Lauf `C-1 D-1 E-1 F-1 G-1 A-1 B-1 C0 D#0` sowie `G#4` und
 * `G#8`, also ueber zwei Oktavgrenzen hinweg und einmal quer durch die Mitte
 * des Bereichs. Alle elf Bytes wurden vorher aus dieser Kodierung berechnet und
 * trafen zu:
 *
 *     1  3  5  6  8  10  12  13  16  69  117
 *
 * Damit ist die Verschiebung nicht mehr nur an den Raendern belegt, sondern
 * ueber den ganzen Bereich — und jede einzelne dieser elf Vorhersagen haette
 * scheitern koennen.
 *
 * ## C4 liegt auf 61 — durch eine Nicht-Aenderung belegt
 *
 * Auf einen Step mit dem Notenbyte 61 wurden am Geraet zwei Noten gelegt, `C4`
 * und `F-1`. Im ganzen Pattern bewegte sich nur ein Byte: der zweite Notenplatz
 * bekam die 6 (= F-1). Fuer `C4` entstand kein Eintrag — die Note war bereits
 * vorhanden, naemlich als die 61 auf dem ersten Platz.
 *
 * Das belegt zweierlei. Erstens ist 61 tatsaechlich C4, unabhaengig von der
 * Haeufigkeitsrechnung weiter unten. Zweitens verhalten sich die vier Plaetze
 * wie eine Menge: eine schon vorhandene Note wird nicht ein zweites Mal
 * abgelegt.
 *
 * Ein Messpunkt, der aus einer ausbleibenden Aenderung besteht, ist selten so
 * eindeutig — hier ist er es, weil im uebrigen Pattern nachweislich gar nichts
 * passierte.
 *
 * ## Gegenprobe an der Factory-Bank
 *
 * Über alle 250 Patterns von `e2s-2016.e2sallpat` ist **61** mit Abstand der
 * häufigste Notenwert (35 872 Vorkommen; der nächste liegt bei 1 635). Unter
 * dieser Kodierung ist das MIDI 60 = C4 — die Originaltonhöhe, also genau der
 * Wert, den ein Drum-Part im Normalfall trägt. Läse man roh, wäre der mit
 * Abstand häufigste Wert der Bank C#4, was als Vorgabe keinen Sinn ergibt.
 *
 * ## Was das vorher kostete
 *
 * Bis hierher schrieben Export und Pattern-Builder die MIDI-Nummer unverändert
 * ins Byte. Jedes so erzeugte Pattern klang am Gerät einen Halbton zu tief, und
 * die Vorgabe „C4" landete auf B3. Beim Import fehlte die Gegenrechnung
 * entsprechend.
 *
 * ⚠ Die Golden-Fixtures in `examples/golden/` und die zugehörigen Erwartungen
 * enthielten dieselbe Annahme („0x3C = C4"). Sie haben den Fehler nicht
 * aufgedeckt, weil sie ihn teilten — ein bestandener Test sagt eben nur, dass
 * Code und Test übereinstimmen. Die Gerätemessung ist hier der Primärbeleg,
 * die Fixtures sind es nicht.
 */

/** Byte-Wert für einen leeren Notenplatz. */
export const E2_STEP_NOTE_EMPTY = 0;

/** Verschiebung zwischen MIDI-Nummer und gespeichertem Byte. */
export const E2_STEP_NOTE_BIAS = 1;

/** Höchstes gültiges Notenbyte (MIDI 127 = G9). */
export const E2_STEP_NOTE_MAX_BYTE = 128;

/**
 * MIDI-Nummer → Step-Byte. `null`/`undefined` und Werte außerhalb 0..127
 * ergeben einen leeren Notenplatz.
 */
export function midiNoteToE2StepByte(note: number | null | undefined): number {
  if (typeof note !== "number" || !Number.isFinite(note)) return E2_STEP_NOTE_EMPTY;
  const n = Math.round(note);
  if (n < 0 || n > 127) return E2_STEP_NOTE_EMPTY;
  return n + E2_STEP_NOTE_BIAS;
}

/**
 * Step-Byte → MIDI-Nummer. 0 bedeutet „kein Ton" und wird als `null`
 * zurückgegeben; alles andere wird auf 0..127 begrenzt.
 *
 * Der frühere Lesepfad begrenzte auf `<= 127` und machte aus 128 eine 127 —
 * damit ging ausgerechnet die höchste Note (G9) verloren, also der Wert, an
 * dem die Verschiebung überhaupt sichtbar wurde.
 */
export function e2StepByteToMidiNote(byte: number): number | null {
  if (!Number.isFinite(byte) || byte <= E2_STEP_NOTE_EMPTY) return null;
  const n = Math.round(byte) - E2_STEP_NOTE_BIAS;
  return Math.max(0, Math.min(127, n));
}

/** Anzahl Notenplätze je Step-Record (Bytes +4..+7). */
export const E2_STEP_NOTE_SLOTS = 4;

/**
 * Bringt die Noten eines Steps in die Form, die ins Record geschrieben wird:
 * höchstens vier, ohne Dubletten, in Eingabereihenfolge.
 *
 * Die Reihenfolge bleibt erhalten und wird NICHT sortiert — am Gerät standen
 * die Noten stets so in den Plätzen, wie sie eingegeben wurden (`G9 F#9 E9 C-1`
 * ebenso wie `C-1 D-1 E-1 F-1`).
 *
 * Dubletten fallen weg, weil das Gerät die vier Plätze wie eine Menge behandelt:
 * eine bereits vorhandene Note legte es kein zweites Mal ab. Ohne diesen Schritt
 * schriebe TekkForge Records, wie das Gerät sie nie erzeugt.
 */
export function resolveStepNotes(
  notes: readonly number[] | null | undefined,
  fallback?: number | null,
): number[] {
  const roh =
    Array.isArray(notes) && notes.length > 0
      ? notes
      : typeof fallback === "number"
        ? [fallback]
        : [];
  const out: number[] = [];
  for (const n of roh) {
    if (typeof n !== "number" || !Number.isFinite(n)) continue;
    const v = Math.round(n);
    if (v < 0 || v > 127) continue;
    if (out.includes(v)) continue;
    out.push(v);
    if (out.length === E2_STEP_NOTE_SLOTS) break;
  }
  return out;
}

/** Liest die bis zu vier Notenplätze eines Records als MIDI-Nummern. */
export function readStepNotes(bytes: readonly number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < E2_STEP_NOTE_SLOTS; i++) {
    const midi = e2StepByteToMidiNote(bytes[i] ?? 0);
    if (midi !== null) out.push(midi);
  }
  return out;
}

/**
 * klangWahl — welche Samples nebeneinander in ein Pattern duerfen.
 *
 * Bisher entschied das ein Zaehler: `rot(pool, i)` nahm der Reihe nach, was
 * gerade dran war. Das verteilt gleichmaessig und weiss nichts. Wenn der
 * Snare-Topf eine Snare enthaelt, die klanglich eine zweite Kick ist, landet
 * sie irgendwann in einem Pattern neben der Kick — und dort verdeckt eine die
 * andere. Am Geraet hoert man das als „matschig" oder „die Snare geht unter";
 * am Bildschirm ist nichts zu sehen, denn beide Samples sind fuer sich in
 * Ordnung.
 *
 * Gemessen wird das mit `konflikt()`: dem gemeinsamen Anteil zweier
 * Bandenergie-Verteilungen. An den 43 Beispiel-Samples in `examples/e2s/korg3`
 * ergibt das ein klares Bild —
 *
 * | Paarung      | kleinster | mittlerer | groesster |
 * |--------------|-----------|-----------|-----------|
 * | Kick ↔ Kick  | 0,25      | **0,61**  | 0,90      |
 * | Hat ↔ Hat    | 0,07      | 0,34      | 0,71      |
 * | Kick ↔ Hat   | 0,00      | **0,12**  | 0,47      |
 * | Kick ↔ Ton   | 0,00      | 0,16      | 0,55      |
 * | Snare ↔ Hat  | 0,27      | 0,36      | 0,46      |
 *
 * — zwei Klaenge derselben Art liegen typisch bei 0,6, zwei verschiedener bei
 * 0,15. Die Grenze von 0,55 greift darum fast nie: nur dann, wenn ein Topf
 * etwas anbietet, das seiner Rolle nach dazugehoert und seinem Klang nach die
 * Stelle eines anderen einnimmt. Genau dieser Fall soll wegfallen, alles
 * andere soll bleiben wie es war.
 *
 * **Wichtig: gefiltert wird, nicht ausgewaehlt.** Der Zaehler bleibt. Wuerde
 * hier stattdessen „der beste Partner" gewaehlt, bekaeme jedes Pattern
 * dieselbe Snare — die Abwechslung ueber eine ganze Bank ist genauso wichtig
 * wie die Vertraeglichkeit im einzelnen Pattern. Der Zaehler laeuft also
 * weiter, nur eben durch einen kleineren Topf.
 */

import { maxKonflikt, type Klangprofil } from "./klangProfil";
import { tonartenPassen, type TonartInfo } from "./keyAnalyse";

/**
 * Ab hier stehen sich zwei Klaenge im Weg.
 *
 * 0,55 liegt zwischen dem Mittel gleichartiger Paare (0,61) und dem Groessten
 * der verschiedenartigen (0,55 bei Kick ↔ Ton). Wer die Zahl aendert, sollte
 * die Tabelle oben nachrechnen und nicht dem Gefuehl folgen.
 */
export const KONFLIKT_GRENZE = 0.55;

/** Alles, was ein Profil tragen kann — Pool-Samples wie Projekt-Samples. */
export interface KlangTraeger {
  klang?: Klangprofil;
  tonart?: TonartInfo;
}

/**
 * Aus einem Topf das herausnehmen, was den schon gesetzten Klaengen im Weg steht.
 *
 * Drei Faelle, und alle drei muessen stimmen:
 *
 * 1. **Nichts ist gemessen** (altes Projekt, Samples aus einer alten Bank):
 *    der ganze Topf kommt unveraendert zurueck. Ohne Wissen nicht filtern —
 *    eine erfundene Auswahl waere schlechter als die alte Reihum-Auswahl.
 * 2. **Etwas passt**: nur das kommt zurueck, in der urspruenglichen
 *    Reihenfolge. Der Zaehler laeuft weiter und findet weiter Abwechslung.
 * 3. **Nichts passt** (ein Topf aus lauter Kicks, wenn schon eine Kick steht):
 *    das obere Drittel nach Vertraeglichkeit. Ein stiller Part waere die
 *    schlechtere Antwort als der am wenigsten schlimme Partner.
 */
export function vertraeglich<T extends KlangTraeger>(
  topf: readonly T[],
  gesetzt: readonly (Klangprofil | undefined)[],
  grenze = KONFLIKT_GRENZE,
): T[] {
  const bezug = gesetzt.filter((g): g is Klangprofil => !!g?.baender?.length);
  if (!topf.length || !bezug.length) return [...topf];
  // Ein Sample ohne Profil kann keinen Konflikt haben (`konflikt` gibt dann 0)
  // und faellt darum nie heraus — auch das ist „ohne Wissen nicht filtern".
  const bewertet = topf.map((t) => ({ t, k: maxKonflikt(t.klang, bezug) }));
  const ok = bewertet.filter((b) => b.k <= grenze);
  if (ok.length) return ok.map((b) => b.t);
  const sortiert = bewertet.slice().sort((a, b) => a.k - b.k);
  return sortiert.slice(0, Math.max(1, Math.ceil(sortiert.length / 3))).map((b) => b.t);
}

/**
 * Aus einem Topf das nehmen, was zur Tonart des Bezugs passt.
 *
 * Der zweite Weg, ein Pattern unbrauchbar zu machen: Melodie in a-Moll, Stab
 * in fis-Dur. Der Frequenzkonflikt faellt hier nicht auf — beide sitzen in
 * ganz verschiedenen Baendern und ergaenzen sich sogar —, gehoert wird es
 * trotzdem sofort.
 *
 * Gefiltert wird nur, wenn beide Seiten eine SICHERE Tonart haben (siehe
 * `TONART_SICHER`) und danach noch etwas uebrig bleibt. Bei Tekk-Material ist
 * das eher die Ausnahme als die Regel; das ist Absicht, denn eine falsch
 * erkannte Tonart wuerde genau die passenden Samples aussortieren.
 */
export function harmonisch<T extends KlangTraeger>(topf: readonly T[], bezug?: TonartInfo): T[] {
  if (!topf.length || !bezug) return [...topf];
  const passend = topf.filter((t) => tonartenPassen(bezug, t.tonart));
  return passend.length ? passend : [...topf];
}

/**
 * Ein Waehler, der sich merkt, was schon liegt.
 *
 * Die Reihenfolge der Aufrufe ist die Reihenfolge des Vorrangs: was zuerst
 * genommen wird, engt die spaeteren ein. Darum kommt in `themaFuer` erst die
 * Melodie (die ist vorgegeben), dann die Kick (der Anker), dann der Bass (der
 * teilt sich den Keller mit der Kick), und erst danach das Schlagzeug.
 */
export function klangWaehler(vorbelegt: readonly (Klangprofil | undefined)[] = [], tonart?: TonartInfo) {
  const gesetzt: Klangprofil[] = vorbelegt.filter((g): g is Klangprofil => !!g?.baender?.length);
  return {
    /** Der Topf, gefiltert auf das, was zum bisher Gesetzten passt. */
    topf<T extends KlangTraeger>(alle: readonly T[]): T[] {
      return vertraeglich(alle, gesetzt);
    },
    /**
     * Wie `topf`, zusaetzlich auf vertraegliche Tonarten eingeschraenkt.
     *
     * Nur fuer die tonalen Lagen — Bass und Stab. Ein Schlagzeug hat keine
     * Tonart, die man verfehlen koennte.
     */
    tonalerTopf<T extends KlangTraeger>(alle: readonly T[]): T[] {
      return vertraeglich(harmonisch(alle, tonart), gesetzt);
    },
    /** Ein gewaehltes Sample als gesetzt vermerken. */
    merke(s?: KlangTraeger): void {
      if (s?.klang?.baender?.length) gesetzt.push(s.klang);
    },
    /** Wie viele Klaenge schon stehen — fuer Hinweistexte. */
    get anzahl(): number {
      return gesetzt.length;
    },
  };
}

/**
 * Wie dicht die Melodie ist, entscheidet ueber die Kick-Figur.
 *
 * Der Gedanke ist der aelteste der Tontechnik und steht so auch im
 * Nutzerbefund zur Dichte („ueberladen und anstrengend zu hoeren"): zwei
 * Stimmen, die gleichzeitig viel tun, ergeben nicht doppelt so viel, sondern
 * Brei. Ist in der Melodie viel los, haelt sich die Kick an die Viertel und
 * laesst ihr den Platz. Ist die Melodie eine gehaltene Flaeche, darf die Kick
 * die Bewegung liefern.
 *
 * Die Grenzen sind an den Melo-Loops der Beispielbank gemessen, so wie sie
 * NACH dem Bankbau in den Slots liegen (1,5 bis 10,5 Anschlaege je Takt):
 * unter 4 passiert fast nichts, ab 10 ist die Melodie selbst rhythmisch.
 *
 * **„roll" kommt hier absichtlich nicht vor**, obwohl es die bewegteste Figur
 * waere. In `patternGen` schaltet eine rollende Kick zusaetzlich die Snare im
 * vierten Takt durch (`a.kick === "roll" && takt(s) === 3`) — das ist der
 * Uebergang IN den Drop, nicht der Drop selbst. Als Dauerfigur gewaehlt,
 * rollt auch der Drop, und der Aufbau davor verliert seine Wirkung. „roll"
 * bleibt darum dem ausdruecklichen Wunsch und dem Aufbau vorbehalten.
 */
export type DichteFigur = "vier" | "hart" | "galopp";

export function figurAusDichte(dichte: number): DichteFigur {
  if (!Number.isFinite(dichte) || dichte <= 0) return "vier";
  if (dichte < 4) return "galopp";
  if (dichte < 10) return "hart";
  return "vier";
}

/** Ein Satz fuer die Begruendung: was gemessen wurde und was daraus folgte. */
export function dichteText(dichte: number): string {
  const figur = figurAusDichte(dichte);
  const wie = dichte < 4 ? "ruhig" : dichte < 10 ? "mittel" : "dicht";
  return `Melodie ${wie} (${dichte.toFixed(1)} Anschläge/Takt) → Kick ${figur}`;
}

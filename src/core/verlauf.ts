/**
 * verlauf — Rueckgaengig und Wiederherstellen, unabhaengig davon, was
 * verwaltet wird.
 *
 * Bewusst kein Aufzeichnen einzelner Aktionen ("Step gesetzt", "Pattern
 * geloescht"), sondern **Staende**: vor jeder Aenderung wird der bisherige
 * Zustand gemerkt. Das ist etwas grober, dafuer kann keine Aktion vergessen
 * werden, die jemand spaeter hinzufuegt — genau der Fehler, der sich in
 * aktionsbasierten Verlaeufen einschleicht.
 *
 * Die Tiefe ist begrenzt, damit der Speicher nicht mitwaechst.
 */
export class Verlauf<T> {
  private zurueckStapel: T[] = [];
  private vorStapel: T[] = [];

  constructor(private readonly maxTiefe = 30) {}

  /** Den Stand VOR einer Aenderung merken. Verwirft den Vorwaerts-Weg. */
  merke(stand: T): void {
    this.zurueckStapel.push(stand);
    if (this.zurueckStapel.length > this.maxTiefe) this.zurueckStapel.shift();
    // Wer nach einem Rueckschritt etwas Neues tut, verlaesst den alten Pfad —
    // ihn stehen zu lassen wuerde spaeter in einen fremden Zustand springen.
    this.vorStapel.length = 0;
  }

  get kannZurueck(): boolean {
    return this.zurueckStapel.length > 0;
  }

  get kannVor(): boolean {
    return this.vorStapel.length > 0;
  }

  /** Anzahl der gemerkten Rueckschritte. */
  get tiefe(): number {
    return this.zurueckStapel.length;
  }

  /** Einen Schritt zurueck; `aktuell` wandert auf den Vorwaerts-Stapel. */
  zurueck(aktuell: T): T | null {
    const stand = this.zurueckStapel.pop();
    if (stand === undefined) return null;
    this.vorStapel.push(aktuell);
    return stand;
  }

  /** Einen Schritt vor; `aktuell` wandert zurueck auf den Rueckwaerts-Stapel. */
  vor(aktuell: T): T | null {
    const stand = this.vorStapel.pop();
    if (stand === undefined) return null;
    this.zurueckStapel.push(aktuell);
    return stand;
  }

  leeren(): void {
    this.zurueckStapel.length = 0;
    this.vorStapel.length = 0;
  }
}

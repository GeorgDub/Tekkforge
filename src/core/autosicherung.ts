/**
 * autosicherung — stiller Notfall-Stand des Editor-Projekts.
 *
 * Es gibt zwar die Warnung beim Schliessen, aber gegen einen Absturz oder einen
 * Stromausfall hilft die nicht: dann ist alles seit dem letzten Speichern weg.
 * Diese Sicherung legt den Projektstand in kurzen Abstaenden beiseite und wird
 * beim regulaeren Speichern wieder geloescht — liegt beim naechsten Start noch
 * einer da, ist die Sitzung davor nicht sauber zu Ende gegangen.
 *
 * Die eigentliche Ablage steckt hinter `AutosaveAblage` (in der App die
 * Electron-Bruecke nach userData), damit die Zeitsteuerung ohne Dateisystem
 * geprueft werden kann.
 */

export interface AutosaveStand {
  /** Projekt als JSON, so wie `serializeProject` es liefert. */
  text: string;
  /** Zeitpunkt der Ablage (ms seit Epoch). */
  wann: number;
}

export interface AutosaveAblage {
  schreiben(text: string): Promise<unknown>;
  lesen(): Promise<AutosaveStand | null>;
  loeschen(): Promise<unknown>;
}

export interface AutosicherungOptionen {
  /** Wartezeit nach der letzten Aenderung, bevor geschrieben wird. */
  abstandMs?: number;
  planen?: (fn: () => void, ms: number) => unknown;
  abbrechen?: (handle: unknown) => void;
  /** Einzeiler fuer die Statuszeile; wird nur bei Stoerungen gerufen. */
  melden?: (text: string) => void;
}

const ABSTAND_VORGABE = 60_000;

export class Autosicherung {
  private readonly abstandMs: number;
  private readonly planen: (fn: () => void, ms: number) => unknown;
  private readonly abbrechen: (handle: unknown) => void;
  private readonly melden?: (text: string) => void;

  /** Es liegt eine Aenderung an, die noch nicht auf der Platte ist. */
  private offen = false;
  /** Ein Schreibvorgang laeuft gerade. */
  private laeuft: Promise<void> | null = null;
  private termin: unknown = null;
  /** Verhindert, dass dieselbe Stoerung bei jedem Durchgang neu gemeldet wird. */
  private gestoert = false;
  private aus = false;
  private pausiert = false;

  constructor(
    private readonly ablage: AutosaveAblage,
    private readonly standGeber: () => string,
    opts: AutosicherungOptionen = {},
  ) {
    this.abstandMs = opts.abstandMs ?? ABSTAND_VORGABE;
    this.planen = opts.planen ?? ((fn, ms) => setTimeout(fn, ms));
    this.abbrechen = opts.abbrechen ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
    this.melden = opts.melden;
  }

  /**
   * Nach jeder Aenderung am Projekt rufen. Sammelt: es wird fruehestens nach
   * `abstandMs` geschrieben, und zwar der dann aktuelle Stand — nicht der von
   * jetzt. Tippen im Namensfeld loest so einen Schreibvorgang aus, nicht zehn.
   */
  angestossen(): void {
    if (this.aus || this.pausiert) return;
    this.offen = true;
    if (this.termin !== null) return;
    this.termin = this.planen(() => {
      this.termin = null;
      void this.schreibeWennNoetig();
    }, this.abstandMs);
  }

  /** Sofort ablegen, ohne auf den Termin zu warten (z. B. vor dem Schliessen). */
  async jetztSchreiben(): Promise<void> {
    this.terminLoeschen();
    await this.schreibeWennNoetig();
  }

  /**
   * Das Projekt wurde regulaer gespeichert oder verworfen — der Notfall-Stand
   * hat sich damit erledigt und wird geloescht. Sonst fragt der naechste Start
   * nach einer Wiederherstellung, die niemand mehr braucht.
   */
  async erledigt(): Promise<void> {
    this.terminLoeschen();
    this.offen = false;
    // Die Entscheidung ist gefallen — ab hier wird wieder normal gesichert.
    this.pausiert = false;
    await this.ruhe();
    try {
      await this.ablage.loeschen();
    } catch {
      /* Ein nicht geloeschter Notfall-Stand ist harmlos — nur laestig. */
    }
  }

  /** Liegengebliebener Stand aus einer abgebrochenen Sitzung, sonst null. */
  async liegengebliebenerStand(): Promise<AutosaveStand | null> {
    try {
      const stand = await this.ablage.lesen();
      return stand && stand.text ? stand : null;
    } catch {
      return null;
    }
  }

  /** Wartet, bis kein Schreibvorgang mehr laeuft (fuer Tests und fuers Beenden). */
  async ruhe(): Promise<void> {
    while (this.laeuft) await this.laeuft;
  }

  /**
   * Vorlaeufig nichts mehr ablegen. Gedacht fuer die Rettungsleiste: solange
   * dort ein alter Stand zur Wahl steht, darf das frische (womoeglich leere)
   * Projekt ihn nicht ueberschreiben. Sonst ist bei einem zweiten Absturz
   * genau die Arbeit weg, die zu retten war.
   */
  anhalten(): void {
    this.pausiert = true;
    this.terminLoeschen();
  }

  fortsetzen(): void {
    this.pausiert = false;
  }

  /** Schaltet die Sicherung ab (z. B. wenn die Bruecke fehlt). */
  stillegen(): void {
    this.aus = true;
    this.terminLoeschen();
    this.offen = false;
  }

  private terminLoeschen(): void {
    if (this.termin === null) return;
    this.abbrechen(this.termin);
    this.termin = null;
  }

  private async schreibeWennNoetig(): Promise<void> {
    if (this.aus || this.pausiert || !this.offen) return;
    // Laeuft schon einer, wird nichts parallel geschrieben: `offen` bleibt
    // stehen, der wartende Aufruf zieht den neueren Stand danach nach.
    if (this.laeuft) {
      await this.laeuft;
      if (!this.offen) return;
    }
    const lauf = this.schreibe();
    this.laeuft = lauf;
    try {
      await lauf;
    } finally {
      if (this.laeuft === lauf) this.laeuft = null;
    }
  }

  private async schreibe(): Promise<void> {
    const text = this.standGeber();
    this.offen = false;
    try {
      await this.ablage.schreiben(text);
      this.gestoert = false;
    } catch (err) {
      // Der Stand bleibt offen, damit der naechste Durchgang es erneut versucht.
      this.offen = true;
      if (!this.gestoert) {
        this.gestoert = true;
        this.melden?.(
          `Notfall-Sicherung fehlgeschlagen: ${err instanceof Error ? err.message : String(err)} — bitte von Hand speichern.`,
        );
      }
    }
  }
}

/**
 * Text fuer die Rettungsleiste beim Start. Bewusst KEIN `confirm()`: der
 * Treiber beantwortet native Dialoge standardmaessig mit "abweisen", und ein
 * versehentliches Escape wuerde den geretteten Stand wegwerfen. Die Leiste
 * bleibt stehen, bis der Nutzer sich entscheidet.
 */
export function wiederherstellungsFrage(stand: AutosaveStand, jetzt: number): string {
  const d = new Date(stand.wann);
  const uhr = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return `Die letzte Sitzung wurde nicht sauber beendet — es liegt ein automatisch gesicherter Stand von ${uhr} Uhr (${abstandText(jetzt - stand.wann)}).`;
}

function abstandText(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "gerade eben";
  if (min === 1) return "vor 1 Minute";
  if (min < 60) return `vor ${min} Minuten`;
  const std = Math.round(min / 60);
  return std === 1 ? "vor 1 Stunde" : `vor ${std} Stunden`;
}

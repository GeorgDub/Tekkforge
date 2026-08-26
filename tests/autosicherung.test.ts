import { describe, it, expect, vi } from "vitest";
import { Autosicherung, wiederherstellungsFrage, type AutosaveAblage } from "../src/core/autosicherung";

/** Ablage im Arbeitsspeicher; zaehlt die Zugriffe mit. */
function ablageAttrappe(): AutosaveAblage & {
  geschrieben: string[];
  geloescht: number;
  stand: { text: string; wann: number } | null;
  fehlerBeimSchreiben: boolean;
} {
  const a = {
    geschrieben: [] as string[],
    geloescht: 0,
    stand: null as { text: string; wann: number } | null,
    fehlerBeimSchreiben: false,
    async schreiben(text: string) {
      if (a.fehlerBeimSchreiben) throw new Error("Platte voll");
      a.geschrieben.push(text);
    },
    async lesen() {
      return a.stand;
    },
    async loeschen() {
      a.geloescht++;
    },
  };
  return a;
}

/** Zeitgeber von Hand: `ablaufen()` loest den anstehenden Termin aus. */
function zeitgeber() {
  let offen: (() => void) | null = null;
  return {
    planen: (fn: () => void) => {
      offen = fn;
      return 1;
    },
    abbrechen: () => {
      offen = null;
    },
    get anstehend() {
      return offen !== null;
    },
    ablaufen() {
      const fn = offen;
      offen = null;
      fn?.();
    },
  };
}

describe("Autosicherung", () => {
  it("schreibt nicht sofort, sondern erst wenn der Abstand um ist", async () => {
    const ablage = ablageAttrappe();
    const zeit = zeitgeber();
    const s = new Autosicherung(ablage, () => "STAND", { planen: zeit.planen, abbrechen: zeit.abbrechen });

    s.angestossen();
    expect(ablage.geschrieben).toEqual([]);
    zeit.ablaufen();
    await s.ruhe();
    expect(ablage.geschrieben).toEqual(["STAND"]);
  });

  it("fasst viele Änderungen zu einem Schreibvorgang zusammen", async () => {
    const ablage = ablageAttrappe();
    const zeit = zeitgeber();
    let n = 0;
    const s = new Autosicherung(ablage, () => `STAND ${n}`, { planen: zeit.planen, abbrechen: zeit.abbrechen });

    for (let i = 0; i < 20; i++) {
      n = i;
      s.angestossen();
    }
    zeit.ablaufen();
    await s.ruhe();
    // Genau einmal, und zwar der letzte Stand — nicht zwanzigmal.
    expect(ablage.geschrieben).toEqual(["STAND 19"]);
  });

  it("schreibt ohne Änderung gar nichts", async () => {
    const ablage = ablageAttrappe();
    const zeit = zeitgeber();
    const s = new Autosicherung(ablage, () => "STAND", { planen: zeit.planen, abbrechen: zeit.abbrechen });

    await s.jetztSchreiben();
    expect(ablage.geschrieben).toEqual([]);
    expect(zeit.anstehend).toBe(false);
  });

  it("startet keinen zweiten Schreibvorgang, während einer läuft", async () => {
    const ablage = ablageAttrappe();
    const zeit = zeitgeber();
    // Nur der ERSTE Schreibvorgang haengt; sonst blockierte auch der zweite
    // und der Test liefe ins Zeitlimit, statt etwas zu zeigen.
    let freigeben: () => void = () => {};
    const tor = new Promise<void>((r) => (freigeben = r));
    let erster = true;
    const gebremst: AutosaveAblage = {
      ...ablage,
      schreiben: async (text) => {
        if (erster) {
          erster = false;
          await tor;
        }
        await ablage.schreiben(text);
      },
    };
    let n = 1;
    const s = new Autosicherung(gebremst, () => `STAND ${n}`, { planen: zeit.planen, abbrechen: zeit.abbrechen });

    s.angestossen();
    zeit.ablaufen(); // Schreibvorgang 1 haengt jetzt
    n = 2;
    s.angestossen(); // Aenderung waehrend des Schreibens
    zeit.ablaufen();
    expect(ablage.geschrieben).toEqual([]); // noch nichts durch

    freigeben();
    await s.ruhe();
    // Der zweite Stand wird nachgezogen — die Änderung geht nicht verloren.
    expect(ablage.geschrieben).toEqual(["STAND 1", "STAND 2"]);
  });

  it("räumt beim regulären Speichern auf und verwirft einen anstehenden Termin", async () => {
    const ablage = ablageAttrappe();
    const zeit = zeitgeber();
    const s = new Autosicherung(ablage, () => "STAND", { planen: zeit.planen, abbrechen: zeit.abbrechen });

    s.angestossen();
    expect(zeit.anstehend).toBe(true);
    await s.erledigt();
    expect(ablage.geloescht).toBe(1);
    expect(zeit.anstehend).toBe(false);
    // Und danach wird auch nichts nachgeschoben.
    zeit.ablaufen();
    await s.ruhe();
    expect(ablage.geschrieben).toEqual([]);
  });

  it("ein Schreibfehler legt die Bearbeitung nicht lahm und meldet einmal", async () => {
    const ablage = ablageAttrappe();
    ablage.fehlerBeimSchreiben = true;
    const zeit = zeitgeber();
    const melden = vi.fn();
    const s = new Autosicherung(ablage, () => "STAND", { planen: zeit.planen, abbrechen: zeit.abbrechen, melden });

    s.angestossen();
    zeit.ablaufen();
    await s.ruhe(); // darf nicht werfen
    expect(melden).toHaveBeenCalledTimes(1);
    expect(String(melden.mock.calls[0][0])).toMatch(/Notfall/i);

    // Zweiter Fehlschlag meldet nicht erneut — sonst steht der Nutzer im Meldungsregen.
    s.angestossen();
    zeit.ablaufen();
    await s.ruhe();
    expect(melden).toHaveBeenCalledTimes(1);

    // Sobald es wieder geht, gilt die nächste Störung wieder als neu.
    ablage.fehlerBeimSchreiben = false;
    s.angestossen();
    zeit.ablaufen();
    await s.ruhe();
    ablage.fehlerBeimSchreiben = true;
    s.angestossen();
    zeit.ablaufen();
    await s.ruhe();
    expect(melden).toHaveBeenCalledTimes(2);
  });

  it("jetztSchreiben zieht einen anstehenden Termin vor", async () => {
    const ablage = ablageAttrappe();
    const zeit = zeitgeber();
    const s = new Autosicherung(ablage, () => "STAND", { planen: zeit.planen, abbrechen: zeit.abbrechen });

    s.angestossen();
    await s.jetztSchreiben();
    expect(ablage.geschrieben).toEqual(["STAND"]);
    expect(zeit.anstehend).toBe(false);
  });

  it("findet einen liegengebliebenen Stand", async () => {
    const ablage = ablageAttrappe();
    ablage.stand = { text: '{"version":1}', wann: 1_000 };
    const s = new Autosicherung(ablage, () => "STAND", { planen: () => 0, abbrechen: () => {} });
    expect(await s.liegengebliebenerStand()).toEqual({ text: '{"version":1}', wann: 1_000 });
  });

  it("meldet keinen Stand, wenn keiner da ist", async () => {
    const ablage = ablageAttrappe();
    const s = new Autosicherung(ablage, () => "STAND", { planen: () => 0, abbrechen: () => {} });
    expect(await s.liegengebliebenerStand()).toBeNull();
  });

  it("überlebt eine kaputte Ablage beim Lesen", async () => {
    const kaputt: AutosaveAblage = {
      schreiben: async () => {},
      lesen: async () => {
        throw new Error("kein Zugriff");
      },
      loeschen: async () => {},
    };
    const s = new Autosicherung(kaputt, () => "STAND", { planen: () => 0, abbrechen: () => {} });
    expect(await s.liegengebliebenerStand()).toBeNull();
  });
});

describe("wiederherstellungsFrage", () => {
  it("nennt Uhrzeit und Abstand", () => {
    const wann = new Date(2026, 7, 24, 14, 32).getTime();
    const text = wiederherstellungsFrage({ text: "", wann }, wann + 3 * 60_000);
    expect(text).toContain("14:32");
    expect(text).toMatch(/3 Minuten/);
  });

  it("sagt bei frischen Ständen 'gerade eben'", () => {
    const wann = new Date(2026, 7, 24, 9, 5).getTime();
    const text = wiederherstellungsFrage({ text: "", wann }, wann + 20_000);
    expect(text).toContain("09:05");
    expect(text).toMatch(/gerade eben/i);
  });

  it("rechnet lange Abstände in Stunden um", () => {
    const wann = new Date(2026, 7, 24, 9, 5).getTime();
    const text = wiederherstellungsFrage({ text: "", wann }, wann + 5 * 3_600_000);
    expect(text).toMatch(/5 Stunden/);
  });
});

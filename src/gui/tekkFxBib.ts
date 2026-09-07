/**
 * tekkFxBib — die Ablage der FX-/Groove-Bibliothek (fxBibliothek.ts).
 *
 * Desktop-App: eine Datei `userData/fx-bibliothek.json` ueber die Bruecke in
 * preload.cjs. Browser: localStorage. Beides faellt auf einen Sitzungsspeicher
 * zurueck, wenn nichts davon geht — die Oberflaeche sagt dann, wo der Stand
 * liegt (bzw. dass er den Neustart nicht ueberlebt).
 */

export interface TekkFxBibBruecke {
  available: boolean;
  lesen(): Promise<string | null>;
  schreiben(text: string): Promise<{ pfad: string; bytes: number }>;
  ordner(): Promise<string>;
}

export interface FxBibAblage {
  /** Wo der Stand liegt — fuer die Anzeige. */
  wo: "datei" | "browser" | "sitzung";
  lesen(): Promise<string | null>;
  schreiben(text: string): Promise<void>;
  /** Ordner im Explorer zeigen (nur Desktop). */
  ordner?(): Promise<string>;
}

const LOCAL_KEY = "tekkforge.fxBibliothek";

function bruecke(): TekkFxBibBruecke | undefined {
  const w = globalThis as unknown as { tekkFxBib?: TekkFxBibBruecke };
  return w.tekkFxBib?.available ? w.tekkFxBib : undefined;
}

function localStorageDa(): Storage | null {
  try {
    const ls = (globalThis as unknown as { localStorage?: Storage }).localStorage;
    if (!ls || typeof ls.getItem !== "function") return null;
    return ls;
  } catch {
    return null;
  }
}

let sitzung: string | null = null;

export function fxBibAblage(): FxBibAblage {
  const b = bruecke();
  if (b) {
    return {
      wo: "datei",
      lesen: () => b.lesen(),
      schreiben: async (text) => {
        await b.schreiben(text);
      },
      ordner: () => b.ordner(),
    };
  }
  const ls = localStorageDa();
  if (ls) {
    return {
      wo: "browser",
      lesen: async () => {
        try {
          return ls.getItem(LOCAL_KEY);
        } catch {
          return null;
        }
      },
      schreiben: async (text) => {
        try {
          ls.setItem(LOCAL_KEY, text);
        } catch {
          sitzung = text; // Speicher voll oder gesperrt — wenigstens fuer die Sitzung
        }
      },
    };
  }
  return {
    wo: "sitzung",
    lesen: async () => sitzung,
    schreiben: async (text) => {
      sitzung = text;
    },
  };
}

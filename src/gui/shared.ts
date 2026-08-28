/** shared.ts — kleine DOM-Helper für die TekkForge-GUI. */

export const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} fehlt`);
  return el as T;
};

export function download(data: Uint8Array | string, filename: string, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

/**
 * Eingabe- und Auswahlfenster — Ersatz fuer `window.prompt()`.
 *
 * Electron kennt `prompt()` schlicht nicht: der Aufruf wirft
 * „prompt() is not supported" und reisst die ganze Aktion mit. In der App war
 * das an vier Stellen eingebaut und damit ueberall tot, wo es zaehlt — am
 * sichtbarsten beim Kopieren auf die SD-Karte, sobald mehr als ein
 * Wechselmedium steckt: der Kopiervorgang brach ab und meldete nichts.
 *
 * Deshalb ein eigenes Fenster im Dokument. Es laeuft im Browser wie in der
 * Huelle, kommt ohne Brueckenaufruf aus, und Enter/Escape tun das Erwartete.
 */
function fensterBauen(titel: string, inhalt: (box: HTMLDivElement) => HTMLElement, fertig: (ok: boolean) => void): void {
  const huelle = document.createElement("div");
  huelle.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:9999";
  const box = document.createElement("div");
  box.style.cssText =
    "background:var(--card,#17171f);border:1px solid var(--border,#2c2c38);border-radius:10px;padding:16px;min-width:320px;max-width:min(560px,90vw);box-shadow:0 8px 40px rgba(0,0,0,.5)";
  const h = document.createElement("div");
  h.textContent = titel;
  h.style.cssText = "font-weight:600;margin-bottom:10px";
  box.appendChild(h);
  box.appendChild(inhalt(box));
  huelle.appendChild(box);
  document.body.appendChild(huelle);
  const schliesse = (ok: boolean): void => {
    document.removeEventListener("keydown", taste);
    huelle.remove();
    fertig(ok);
  };
  const taste = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape") schliesse(false);
    else if (ev.key === "Enter") schliesse(true);
  };
  document.addEventListener("keydown", taste);
  huelle.addEventListener("click", (ev) => {
    if (ev.target === huelle) schliesse(false);
  });
  (box.querySelector("[data-ok]") as HTMLElement | null)?.addEventListener("click", () => schliesse(true));
  (box.querySelector("[data-weg]") as HTMLElement | null)?.addEventListener("click", () => schliesse(false));
  (box.querySelector("input,select") as HTMLElement | null)?.focus();
}

/** Freitext abfragen; null bei Abbruch. */
export function frageText(titel: string, vorgabe = ""): Promise<string | null> {
  return new Promise((auf) => {
    let feld: HTMLInputElement;
    fensterBauen(
      titel,
      () => {
        const rahmen = document.createElement("div");
        feld = document.createElement("input");
        feld.type = "text";
        feld.value = vorgabe;
        feld.style.cssText = "width:100%;margin-bottom:12px";
        const knoepfe = document.createElement("div");
        knoepfe.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
        knoepfe.innerHTML = `<button data-weg class="ghost">Abbrechen</button><button data-ok class="primary">OK</button>`;
        rahmen.appendChild(feld);
        rahmen.appendChild(knoepfe);
        return rahmen;
      },
      (ok) => auf(ok ? feld.value : null),
    );
  });
}

/** Eine aus mehreren Moeglichkeiten waehlen; null bei Abbruch. */
export function frageAuswahl(titel: string, optionen: readonly string[], vorgabe = 0): Promise<number | null> {
  return new Promise((auf) => {
    let feld: HTMLSelectElement;
    fensterBauen(
      titel,
      () => {
        const rahmen = document.createElement("div");
        feld = document.createElement("select");
        feld.style.cssText = "width:100%;margin-bottom:12px";
        optionen.forEach((o, i) => {
          const opt = document.createElement("option");
          opt.value = String(i);
          opt.textContent = o;
          if (i === vorgabe) opt.selected = true;
          feld.appendChild(opt);
        });
        const knoepfe = document.createElement("div");
        knoepfe.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
        knoepfe.innerHTML = `<button data-weg class="ghost">Abbrechen</button><button data-ok class="primary">OK</button>`;
        rahmen.appendChild(feld);
        rahmen.appendChild(knoepfe);
        return rahmen;
      },
      (ok) => auf(ok ? Number(feld.value) : null),
    );
  });
}

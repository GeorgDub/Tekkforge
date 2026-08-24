/**
 * theme.ts — wendet die Farb-Presets aus core/themes auf die Seite an
 * und merkt sich die Wahl in localStorage.
 */

import { cssVars, themeFinden, themeWahlLesen, themeWahlSchreiben, type ThemeWahl } from "../core/themes";

const KEY = "tekkforge.theme";

let wahl: ThemeWahl = themeWahlLesen(null);

function lesen(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

function schreiben(w: ThemeWahl): void {
  try {
    localStorage.setItem(KEY, themeWahlSchreiben(w));
  } catch {
    // kein Speicher (z. B. file://) — Wahl gilt nur fuer die Sitzung
  }
}

function anwenden(): void {
  const vars = cssVars(themeFinden(wahl.name).palette, wahl.akzent);
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
}

export function initTheme(): void {
  wahl = themeWahlLesen(lesen());
  anwenden();
}

export function aktuelleWahl(): ThemeWahl {
  return { ...wahl };
}

export function themeSetzen(name: string, akzent?: string): void {
  wahl = { name: themeFinden(name).name, ...(akzent ? { akzent } : {}) };
  schreiben(wahl);
  anwenden();
}

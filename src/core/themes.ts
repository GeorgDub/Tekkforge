/**
 * themes.ts — Farb-Presets fuer die Oberflaeche.
 *
 * Reine Daten + Logik (testbar ohne DOM): Paletten, Fallbacks und die
 * Persistenz-Codierung. Das Anwenden auf document.documentElement macht
 * gui/theme.ts.
 */

export interface ThemePalette {
  bg: string;
  panel: string;
  elevated: string;
  border: string;
  text: string;
  muted: string;
  dim: string;
  accent: string;
  accent2: string;
  success: string;
  danger: string;
}

export interface ThemePreset {
  name: string;
  titel: string;
  palette: ThemePalette;
}

export const THEME_STANDARD = "tekkforge";

export const THEMES: ThemePreset[] = [
  {
    name: "tekkforge",
    titel: "TekkForge",
    palette: {
      bg: "#101014", panel: "#18181f", elevated: "#22222c", border: "#2e2e3a",
      text: "#e8e8f0", muted: "#9a9aac", dim: "#62627a",
      accent: "#ff6a00", accent2: "#00c8ff", success: "#3ddc84", danger: "#ff4d5e",
    },
  },
  {
    name: "dark-studio",
    titel: "Dark Studio",
    palette: {
      bg: "#05070f", panel: "#0a101e", elevated: "#111a30", border: "#1c2947",
      text: "#e6ecff", muted: "#8b9bc0", dim: "#55648c",
      accent: "#2f7bff", accent2: "#58c7ff", success: "#2fd48a", danger: "#ff4d6d",
    },
  },
  {
    name: "midnight",
    titel: "Midnight",
    palette: {
      bg: "#07060d", panel: "#0e0c1a", elevated: "#171230", border: "#251d4a",
      text: "#ece8ff", muted: "#9d94c4", dim: "#645b8f",
      accent: "#7c5cff", accent2: "#b18cff", success: "#3ddc97", danger: "#ff4d6d",
    },
  },
  {
    name: "deep-ocean",
    titel: "Deep Ocean",
    palette: {
      bg: "#041014", panel: "#07181f", elevated: "#0b232e", border: "#143543",
      text: "#e2f4fa", muted: "#84aab8", dim: "#4f7280",
      accent: "#00b4d8", accent2: "#48e5c2", success: "#3ddc84", danger: "#ff5d5d",
    },
  },
  {
    name: "neon-pulse",
    titel: "Neon Pulse",
    palette: {
      bg: "#050505", panel: "#0c0d0c", elevated: "#141614", border: "#233026",
      text: "#e8ffe8", muted: "#8fb89a", dim: "#567a60",
      accent: "#39ff88", accent2: "#00e5ff", success: "#39ff88", danger: "#ff3d6e",
    },
  },
  {
    name: "carbon",
    titel: "Carbon",
    palette: {
      bg: "#111213", panel: "#191b1d", elevated: "#232629", border: "#33373b",
      text: "#e9eaeb", muted: "#a0a5aa", dim: "#6b7176",
      accent: "#e0a34a", accent2: "#7fb8d8", success: "#57c785", danger: "#e35d6a",
    },
  },
];

/** Preset nach Namen; unbekannt/leer faellt auf den Standard zurueck. */
export function themeFinden(name: string | null | undefined): ThemePreset {
  return THEMES.find((t) => t.name === name) ?? THEMES.find((t) => t.name === THEME_STANDARD)!;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Palette als CSS-Variablen-Map; eine gueltige eigene Akzentfarbe gewinnt. */
export function cssVars(p: ThemePalette, akzent?: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const [k, v] of Object.entries(p)) vars[`--${k}`] = v;
  if (akzent && HEX.test(akzent)) vars["--accent"] = akzent;
  return vars;
}

export interface ThemeWahl {
  name: string;
  akzent?: string;
}

/** Gespeicherte Wahl lesen — Muell oder Altbestand faellt auf den Standard zurueck. */
export function themeWahlLesen(raw: string | null): ThemeWahl {
  if (raw) {
    try {
      const o = JSON.parse(raw) as unknown;
      if (o && typeof o === "object" && typeof (o as ThemeWahl).name === "string") {
        const w = o as ThemeWahl;
        return {
          name: themeFinden(w.name).name === w.name ? w.name : THEME_STANDARD,
          ...(typeof w.akzent === "string" && HEX.test(w.akzent) ? { akzent: w.akzent } : {}),
        };
      }
    } catch {
      // kaputter Speicher — Standard
    }
  }
  return { name: THEME_STANDARD };
}

export function themeWahlSchreiben(w: ThemeWahl): string {
  return JSON.stringify(w);
}

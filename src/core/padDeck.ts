/**
 * padDeck.ts — Modell des Pad-Decks: ein frei wählbares Raster (1–8 × 1–8)
 * auf mehreren Seiten; jedes Pad trägt eine Aktionsliste, die beim Drücken
 * der Reihe nach ausgeführt wird (Patternwechsel, Pattern-Kopie mit
 * Änderungen, Regler-CCs, Mutes, Transport, Morph).
 *
 * Reine Daten + Logik ohne DOM/MIDI, damit Raster, Serialisierung, das
 * Anwenden von Änderungen auf ein Pattern und die Morph-Mathematik testbar
 * sind. Die Ausführung (MIDI senden, SysEx holen) lebt in gui/paddeck.ts.
 *
 * Entscheidungen (Nutzer 2026-08-22): eigener Tab, Raster frei 1–8 je Achse,
 * 4 Seiten, Aktionsliste statt Skripttext, Morph in Takten (Sekunden als
 * Option), Pattern-Kopie nur in den Edit-Buffer, Speicherung im Projekt plus
 * JSON-Export, Auslösung per Tastatur und MIDI-Learn, Farbe/Label je Pad,
 * Quantisierung „sofort" oder „nächster Takt" je Pad.
 */

import { clonePattern, type EditorPattern } from "./editorModel";

export const PAD_DECK_VERSION = 1;
export const PAD_MAX_ACHSE = 8;
export const PAD_SEITEN = 4;

export type Quantisierung = "sofort" | "takt";

export interface PadMidiTrigger {
  art: "note" | "cc";
  /** 0-basierter Kanal. */
  kanal: number;
  nummer: number;
}

/** Änderung an einem Part der Pattern-Kopie. key = Part-Parameter
 *  (cutoff, resonance, ifxOn, …) oder "volume" | "pan" | "muted". */
export interface PartAenderung {
  part: number | "alle";
  key: string;
  wert: number;
}

export type PadAktion =
  | { art: "pattern"; idx: number }
  | { art: "patternKopie"; idx: number; aenderungen: PartAenderung[]; bpm?: number }
  | { art: "cc"; part: number | "global"; key: string; wert: number }
  | { art: "mutes"; parts: number[]; muted: boolean }
  | { art: "transport"; was: "play" | "stop" | "panic" }
  | { art: "morph"; ziele: { part: number; key: string; nach: number }[]; dauer: number; einheit: "takte" | "sekunden" };

export interface Pad {
  label: string;
  /** CSS-Farbe. */
  farbe: string;
  quantisierung: Quantisierung;
  /** Tastaturkürzel (ein Zeichen), optional. */
  taste?: string;
  midi?: PadMidiTrigger;
  aktionen: PadAktion[];
}

export interface PadSeite {
  name: string;
  /** Länge = cols × rows; null = leeres Pad. */
  pads: (Pad | null)[];
}

export interface PadDeck {
  version: typeof PAD_DECK_VERSION;
  cols: number;
  rows: number;
  aktiveSeite: number;
  seiten: PadSeite[];
}

export const PAD_FARBEN = ["#ff6a00", "#2b8cff", "#2ecc71", "#e84393", "#f1c40f", "#9b59b6", "#1abc9c", "#95a5a6"];

/** Standard-Tasten je Pad-Index: Ziffernreihe, dann q–p, a–l, y–m (36 Stück). */
export const STANDARD_TASTEN = "1234567890qwertzuiopasdfghjklyxcvbnm".split("");

export function standardTaste(padIdx: number): string | undefined {
  return STANDARD_TASTEN[padIdx];
}

function klemmAchse(n: number): number {
  return Math.max(1, Math.min(PAD_MAX_ACHSE, Math.round(n) || 1));
}

export function neuesPad(label = "", farbe = PAD_FARBEN[0]): Pad {
  return { label, farbe, quantisierung: "sofort", aktionen: [] };
}

export function neuesDeck(cols = 4, rows = 4, seiten = PAD_SEITEN): PadDeck {
  cols = klemmAchse(cols);
  rows = klemmAchse(rows);
  return {
    version: PAD_DECK_VERSION,
    cols,
    rows,
    aktiveSeite: 0,
    seiten: Array.from({ length: seiten }, (_, i) => ({ name: `Seite ${i + 1}`, pads: Array(cols * rows).fill(null) })),
  };
}

export function padIndex(deck: PadDeck, col: number, row: number): number {
  return row * deck.cols + col;
}

/** Raster ändern; Pads bleiben an ihrer (Spalte, Zeile), was nicht mehr passt, fällt weg. */
export function deckGroesseAendern(deck: PadDeck, cols: number, rows: number): PadDeck {
  cols = klemmAchse(cols);
  rows = klemmAchse(rows);
  const seiten = deck.seiten.map((s) => {
    const pads: (Pad | null)[] = Array(cols * rows).fill(null);
    for (let r = 0; r < Math.min(rows, deck.rows); r++)
      for (let c = 0; c < Math.min(cols, deck.cols); c++) pads[r * cols + c] = s.pads[r * deck.cols + c] ?? null;
    return { name: s.name, pads };
  });
  return { ...deck, cols, rows, seiten };
}

// ─── Serialisierung ──────────────────────────────────────────────────────────

export function serialisiereDeck(deck: PadDeck): string {
  return JSON.stringify({ app: "tekkforge-paddeck", ...deck }, null, 1);
}

const AKTIONS_ARTEN = new Set(["pattern", "patternKopie", "cc", "mutes", "transport", "morph"]);

function pruefeAktion(a: unknown): PadAktion | null {
  if (!a || typeof a !== "object") return null;
  const x = a as Record<string, unknown>;
  if (!AKTIONS_ARTEN.has(String(x.art))) return null;
  switch (x.art) {
    case "pattern":
      return Number.isInteger(x.idx) && (x.idx as number) >= 0 && (x.idx as number) <= 249 ? { art: "pattern", idx: x.idx as number } : null;
    case "patternKopie":
      if (!Number.isInteger(x.idx) || !Array.isArray(x.aenderungen)) return null;
      return {
        art: "patternKopie",
        idx: x.idx as number,
        aenderungen: (x.aenderungen as unknown[])
          .filter((ae): ae is PartAenderung => !!ae && typeof ae === "object" && typeof (ae as PartAenderung).key === "string" && Number.isFinite((ae as PartAenderung).wert))
          .map((ae) => ({ part: ae.part === "alle" ? "alle" : Math.max(0, Math.min(15, Number(ae.part) || 0)), key: ae.key, wert: ae.wert })),
        ...(Number.isFinite(x.bpm) ? { bpm: x.bpm as number } : {}),
      };
    case "cc":
      return typeof x.key === "string" && Number.isFinite(x.wert)
        ? { art: "cc", part: x.part === "global" ? "global" : Math.max(0, Math.min(15, Number(x.part) || 0)), key: x.key, wert: x.wert as number }
        : null;
    case "mutes":
      return Array.isArray(x.parts) ? { art: "mutes", parts: (x.parts as unknown[]).map(Number).filter((n) => n >= 0 && n <= 15), muted: !!x.muted } : null;
    case "transport":
      return x.was === "play" || x.was === "stop" || x.was === "panic" ? { art: "transport", was: x.was } : null;
    case "morph":
      if (!Array.isArray(x.ziele) || !Number.isFinite(x.dauer)) return null;
      return {
        art: "morph",
        ziele: (x.ziele as unknown[])
          .filter((z): z is { part: number; key: string; nach: number } => !!z && typeof z === "object" && typeof (z as { key: unknown }).key === "string")
          .map((z) => ({ part: Math.max(0, Math.min(15, Number(z.part) || 0)), key: z.key, nach: Number(z.nach) || 0 })),
        dauer: Math.max(0.1, x.dauer as number),
        einheit: x.einheit === "sekunden" ? "sekunden" : "takte",
      };
  }
  return null;
}

function pruefePad(p: unknown): Pad | null {
  if (!p || typeof p !== "object") return null;
  const x = p as Record<string, unknown>;
  const pad = neuesPad(typeof x.label === "string" ? x.label.slice(0, 24) : "", typeof x.farbe === "string" ? x.farbe : PAD_FARBEN[0]);
  pad.quantisierung = x.quantisierung === "takt" ? "takt" : "sofort";
  if (typeof x.taste === "string" && x.taste.length === 1) pad.taste = x.taste.toLowerCase();
  const m = x.midi as Record<string, unknown> | undefined;
  if (m && (m.art === "note" || m.art === "cc") && Number.isInteger(m.kanal) && Number.isInteger(m.nummer)) {
    pad.midi = { art: m.art, kanal: Math.max(0, Math.min(15, m.kanal as number)), nummer: Math.max(0, Math.min(127, m.nummer as number)) };
  }
  pad.aktionen = Array.isArray(x.aktionen) ? (x.aktionen as unknown[]).map(pruefeAktion).filter((a): a is PadAktion => a !== null) : [];
  return pad;
}

/** Parst ein Deck (aus JSON-Text oder bereits geparstem Objekt); wirft bei Unbrauchbarem. */
export function deserialisiereDeck(quelle: string | unknown): PadDeck {
  let doc: unknown;
  if (typeof quelle === "string") {
    try {
      doc = JSON.parse(quelle);
    } catch {
      throw new Error("Kein gültiges Pad-Deck (JSON-Fehler)");
    }
  } else doc = quelle;
  if (!doc || typeof doc !== "object") throw new Error("Kein gültiges Pad-Deck");
  const d = doc as Record<string, unknown>;
  if (!Array.isArray(d.seiten) || !Number.isFinite(d.cols) || !Number.isFinite(d.rows)) throw new Error("Kein gültiges Pad-Deck (Raster fehlt)");
  const deck = neuesDeck(d.cols as number, d.rows as number, Math.max(1, Math.min(16, d.seiten.length || PAD_SEITEN)));
  (d.seiten as unknown[]).forEach((s, i) => {
    const seite = s as Record<string, unknown>;
    if (typeof seite?.name === "string") deck.seiten[i].name = seite.name.slice(0, 24);
    const pads = Array.isArray(seite?.pads) ? (seite.pads as unknown[]) : [];
    for (let k = 0; k < deck.cols * deck.rows; k++) deck.seiten[i].pads[k] = pruefePad(pads[k]);
  });
  deck.aktiveSeite = Math.max(0, Math.min(deck.seiten.length - 1, Number(d.aktiveSeite) || 0));
  return deck;
}

// ─── Anwenden ────────────────────────────────────────────────────────────────

/** Pattern-Kopie mit Änderungen (flüchtig; das Original bleibt unberührt). */
export function wendeAenderungenAn(pattern: EditorPattern, aenderungen: PartAenderung[], bpm?: number): EditorPattern {
  const kopie = clonePattern(pattern);
  if (bpm !== undefined && Number.isFinite(bpm)) kopie.bpm = Math.max(20, Math.min(300, bpm));
  for (const ae of aenderungen) {
    const ziele = ae.part === "alle" ? kopie.parts : [kopie.parts[ae.part]].filter(Boolean);
    for (const part of ziele) {
      if (ae.key === "volume") part.volume = Math.max(0, Math.min(127, Math.round(ae.wert)));
      else if (ae.key === "pan") part.pan = Math.max(0, Math.min(127, Math.round(ae.wert)));
      else if (ae.key === "muted") part.muted = ae.wert !== 0;
      else part.params = { ...(part.params ?? {}), [ae.key]: Math.round(ae.wert) };
    }
  }
  return kopie;
}

/** Zwischenwerte eines Morphs: `schritte` Werte von `von` (exklusiv) bis `nach` (inklusiv). */
export function morphWerte(von: number, nach: number, schritte: number): number[] {
  const n = Math.max(1, Math.round(schritte));
  return Array.from({ length: n }, (_, i) => Math.round(von + ((nach - von) * (i + 1)) / n));
}

/** Morph-Dauer in Millisekunden. */
export function morphDauerMs(dauer: number, einheit: "takte" | "sekunden", bpm: number): number {
  return einheit === "sekunden" ? dauer * 1000 : (dauer * 4 * 60000) / Math.max(20, bpm);
}

/** Millisekunden bis zum nächsten Taktanfang, gemessen ab Transport-Start. */
export function msBisNaechsterTakt(msSeitStart: number, bpm: number): number {
  const takt = (4 * 60000) / Math.max(20, bpm);
  const rest = msSeitStart % takt;
  return rest < 1 ? 0 : takt - rest;
}

/** Aktion in einer Zeile beschreiben (Pad-Tooltip, Aktionsliste). */
export function beschreibeAktion(a: PadAktion, patternName?: (idx: number) => string | undefined): string {
  const name = (idx: number) => {
    const n = patternName?.(idx);
    return `Pattern ${idx + 1}${n ? ` „${n}"` : ""}`;
  };
  switch (a.art) {
    case "pattern":
      return `→ ${name(a.idx)}`;
    case "patternKopie":
      return `${name(a.idx)} als Kopie${a.bpm ? ` @${a.bpm}` : ""}: ${a.aenderungen.map((x) => `${x.part === "alle" ? "alle" : `P${x.part + 1}`}.${x.key}=${x.wert}`).join(", ") || "unverändert"}`;
    case "cc":
      return `CC ${a.key}=${a.wert} (${a.part === "global" ? "global" : `Part ${a.part + 1}`})`;
    case "mutes":
      return `Parts ${a.parts.map((p) => p + 1).join(",")} ${a.muted ? "stumm" : "an"}`;
    case "transport":
      return a.was === "play" ? "▶ Play" : a.was === "stop" ? "■ Stop" : "⛔ Panic";
    case "morph":
      return `Morph ${a.ziele.map((z) => `P${z.part + 1}.${z.key}→${z.nach}`).join(", ")} über ${a.dauer} ${a.einheit === "takte" ? "Takte" : "s"}`;
  }
}

// ─── Beispiel-Deck ───────────────────────────────────────────────────────────

/**
 * Start-Deck für ein Projekt mit Blöcken (MEGA3/DROGEN: Blöcke à 30 bzw. 15
 * Patterns): Seite 1 springt an Blockanfänge, Seite 2 Filter-/IFX-Varianten
 * von Pattern 1, Seite 3 Transport + Mutes, Seite 4 Morphs.
 */
export function beispielDeck(patternAnzahl: number, blockGroesse = 30): PadDeck {
  const deck = neuesDeck(4, 4);
  const n = Math.max(1, patternAnzahl);
  deck.seiten[0].name = "Blöcke";
  for (let i = 0; i < 16; i++) {
    const idx = i * blockGroesse;
    if (idx >= n) break;
    deck.seiten[0].pads[i] = { ...neuesPad(`→ ${idx + 1}`, PAD_FARBEN[i % PAD_FARBEN.length]), taste: standardTaste(i), aktionen: [{ art: "pattern", idx }] };
  }
  deck.seiten[1].name = "Varianten";
  const varianten: [string, PartAenderung[]][] = [
    ["Cutoff 40", [{ part: "alle", key: "cutoff", wert: 40 }]],
    ["Cutoff 90", [{ part: "alle", key: "cutoff", wert: 90 }]],
    ["Reso hoch", [{ part: "alle", key: "resonance", wert: 100 }]],
    ["IFX an", [{ part: "alle", key: "ifxOn", wert: 1 }]],
    ["IFX aus", [{ part: "alle", key: "ifxOn", wert: 0 }]],
    ["Kick solo", Array.from({ length: 15 }, (_, p) => ({ part: p + 1, key: "muted", wert: 1 }))],
    ["Ohne Kick", [{ part: 0, key: "muted", wert: 1 }]],
    ["Pitch +12", [{ part: "alle", key: "oscPitch", wert: 12 }]],
  ];
  varianten.forEach(([label, aenderungen], i) => {
    deck.seiten[1].pads[i] = { ...neuesPad(label, PAD_FARBEN[(i + 2) % PAD_FARBEN.length]), taste: standardTaste(i), aktionen: [{ art: "patternKopie", idx: 0, aenderungen }] };
  });
  deck.seiten[2].name = "Transport";
  deck.seiten[2].pads[0] = { ...neuesPad("▶ Play", "#2ecc71"), taste: "1", aktionen: [{ art: "transport", was: "play" }] };
  deck.seiten[2].pads[1] = { ...neuesPad("■ Stop", "#e74c3c"), taste: "2", aktionen: [{ art: "transport", was: "stop" }] };
  deck.seiten[2].pads[2] = { ...neuesPad("⛔ Panic", "#95a5a6"), taste: "3", aktionen: [{ art: "transport", was: "panic" }] };
  deck.seiten[2].pads[4] = { ...neuesPad("Drums stumm", "#9b59b6"), taste: "q", aktionen: [{ art: "mutes", parts: [0, 1, 2, 3, 4, 5, 6, 7], muted: true }] };
  deck.seiten[2].pads[5] = { ...neuesPad("Drums an", "#9b59b6"), taste: "w", aktionen: [{ art: "mutes", parts: [0, 1, 2, 3, 4, 5, 6, 7], muted: false }] };
  deck.seiten[2].pads[6] = { ...neuesPad("MFX an", "#1abc9c"), taste: "e", aktionen: [{ art: "cc", part: "global", key: "mfxOn", wert: 127 }] };
  deck.seiten[2].pads[7] = { ...neuesPad("MFX aus", "#1abc9c"), taste: "r", aktionen: [{ art: "cc", part: "global", key: "mfxOn", wert: 0 }] };
  deck.seiten[3].name = "Morphs";
  deck.seiten[3].pads[0] = { ...neuesPad("Filter zu 4T", "#2b8cff"), taste: "1", aktionen: [{ art: "morph", ziele: Array.from({ length: 16 }, (_, p) => ({ part: p, key: "cutoff", nach: 20 })), dauer: 4, einheit: "takte" }] };
  deck.seiten[3].pads[1] = { ...neuesPad("Filter auf 4T", "#2b8cff"), taste: "2", aktionen: [{ art: "morph", ziele: Array.from({ length: 16 }, (_, p) => ({ part: p, key: "cutoff", nach: 127 })), dauer: 4, einheit: "takte" }] };
  deck.seiten[3].pads[2] = { ...neuesPad("Reso rauf 8T", "#e84393"), taste: "3", aktionen: [{ art: "morph", ziele: Array.from({ length: 16 }, (_, p) => ({ part: p, key: "resonance", nach: 110 })), dauer: 8, einheit: "takte" }] };
  return deck;
}

/**
 * e2ModTypen — die Namen der Modulations- und Filtertypen, so wie sie in der
 * Firmware stehen (Befund 2026-09-03, Hacktribe-Abbild):
 *
 * - **Modulationstypen**: eine Tabelle mit 88 Bytes je Eintrag (Name + Kurven-
 *   und Bereichsdaten), Stock bei RAM 0xC00D81F0 mit 72 Eintraegen — 12
 *   Quellen × 6 Ziele —, Hacktribe verlegt sie nach 0xC01A0000 und haengt 24
 *   Sinus-Typen an (SinUp, SinDwn, SinUpB, SinDwnB × 6 Ziele) = 96. Der
 *   Part traegt den Typ 0-basiert (`modType`, Part-Offset 0x10); das Geraet
 *   zeigt ihn 1-basiert.
 * - **Filtertypen**: 16 Namen bei Datei 0xA6E4F (lang) / 0xA714B (kurz):
 *   electribe / MS20 / MG / P5 / OB / Acid als LPF, HPF, BPF. `filterType`
 *   (Part-Offset 0x0C) ist 0-basiert.
 */

/** Quellen in Tabellenreihenfolge; „B“ = BPM-synchron. */
export const MOD_QUELLEN_STOCK = ["EG+", "EG+ BPM", "EG-", "EG- BPM", "LFOTri", "LFOTriB", "SawUpB", "SawDwnB", "SquUpB", "SquDwnB", "S&HBPM", "Random"] as const;
/** Hacktribes Anhang (Typ 72…95). */
export const MOD_QUELLEN_HACKTRIBE = ["SinUp", "SinDwn", "SinUpB", "SinDwnB"] as const;
export const MOD_ZIELE = ["Filter", "Pitch", "OSC", "Level", "Pan", "IFX"] as const;

/** Alle 96 Namen, Index = gespeicherter Typ (0-basiert). 0…71 Stock, 72…95 nur Hacktribe. */
export const MOD_TYPEN: readonly string[] = [...MOD_QUELLEN_STOCK, ...MOD_QUELLEN_HACKTRIBE].flatMap((q) => MOD_ZIELE.map((z) => `${q} ${z}`));
export const MOD_TYPEN_STOCK_ANZAHL = MOD_QUELLEN_STOCK.length * MOD_ZIELE.length; // 72

export const FILTER_TYPEN: readonly string[] = [
  "electribe LPF",
  "MS20 LPF",
  "MG LPF",
  "P5 LPF",
  "OB LPF",
  "Acid LPF",
  "electribe HPF",
  "MS20 HPF",
  "P5 HPF",
  "OB HPF",
  "Acid HPF",
  "electribe BPF",
  "MS20 BPF",
  "P5 BPF",
  "OB BPF",
  "Acid BPF",
];

/** Name eines gespeicherten Typs, mit Anzeigenummer (1-basiert) davor; unbekannt → nur die Nummer. */
export function modTypName(gespeichert: number): string {
  const n = MOD_TYPEN[gespeichert];
  return n ? `${gespeichert + 1} · ${n}${gespeichert >= MOD_TYPEN_STOCK_ANZAHL ? " (Hacktribe)" : ""}` : `${gespeichert + 1}`;
}

export function filterTypName(gespeichert: number): string {
  const n = FILTER_TYPEN[gespeichert];
  return n ? `${gespeichert + 1} · ${n}` : `${gespeichert + 1}`;
}

/**
 * firmwareAblage — der lokale Firmware-Ordner des Nutzers, eingeordnet.
 *
 * Korg-Firmware liegt nie in TekkForge. Der Nutzer legt die offiziellen
 * Abbilder (Synth und Sampler v2.02) und `hacktribe-2.patch` in einen Ordner
 * (`userData/firmware` in der Desktop-App), die Werkbank liest ihn ein und
 * ordnet jede Datei am SHA-256 ein: Rolle bekannt (Hash stimmt), oder
 * „eigene“ (gueltige SYSTEM.VSB mit anderem Hash — eine TekkForge-/Hacktribe-
 * Fassung), oder „beschaedigt“ (Kopf sagt Stock v2.02, aber der Hash weicht
 * ab: ein Bit gekippt, ein halber Download). Die Rollen speisen die Basis-
 * Auswahl: „Sampler (Stock)“, „Sampler + Hacktribe“, „Synth (Stock)“.
 *
 * Reine Einordnung — Dateisystem und Hash kommen vom Aufrufer.
 */
import { erkenneKarte, HACKTRIBE_SHA256, SAMPLER_STOCK_SHA256, SYNTH_STOCK_SHA256, karteLabel, type KartenBefund, type KartenId } from "./firmwareKarte";
import { HACKTRIBE_PATCH_SHA256, liesBsdiffKopf } from "./bspatch";

export type AblageRolle = "synth-stock" | "sampler-stock" | "hacktribe" | "hacktribe-patch" | "eigene" | "beschaedigt" | "fremd";

export interface AblageDatei {
  name: string;
  groesse: number;
  sha256: string;
  rolle: AblageRolle;
  hinweis: string;
  /** Bei gueltigen Abbildern: die erkannte Karte. */
  befund?: KartenBefund;
}

export const ROLLEN_LABEL: Record<AblageRolle, string> = {
  "synth-stock": "Synth v2.02 (offiziell)",
  "sampler-stock": "Sampler v2.02 (offiziell)",
  hacktribe: "Hacktribe (unverändert)",
  "hacktribe-patch": "hacktribe-2.patch",
  eigene: "eigene/modifizierte Firmware",
  beschaedigt: "beschädigt",
  fremd: "keine electribe-Datei",
};

const BEKANNT: Record<string, AblageRolle> = {
  [SYNTH_STOCK_SHA256]: "synth-stock",
  [SAMPLER_STOCK_SHA256]: "sampler-stock",
  [HACKTRIBE_SHA256]: "hacktribe",
  [HACKTRIBE_PATCH_SHA256]: "hacktribe-patch",
};

/** Eine Datei einordnen. `bytes` darf fehlen, wenn der Hash schon eine Rolle trifft. */
export function ordneDateiEin(name: string, sha256: string, bytes?: Uint8Array): AblageDatei {
  const groesse = bytes?.length ?? 0;
  const bekannt = BEKANNT[sha256.toLowerCase()];
  if (bekannt) return { name, groesse, sha256, rolle: bekannt, hinweis: `${ROLLEN_LABEL[bekannt]} — Hash stimmt` };
  if (!bytes) return { name, groesse, sha256, rolle: "fremd", hinweis: "unbekannter Hash, Inhalt nicht gelesen" };
  if (/\.patch$/i.test(name) || (bytes.length >= 8 && String.fromCharCode(...bytes.subarray(0, 8)) === "BSDIFF40")) {
    try {
      const k = liesBsdiffKopf(bytes);
      return { name, groesse, sha256, rolle: "beschaedigt", hinweis: `bsdiff-Patch für ${k.neueGroesse} Bytes, aber nicht hacktribe-2.patch (Hash weicht ab) — nicht verwendbar` };
    } catch (e) {
      return { name, groesse, sha256, rolle: "fremd", hinweis: e instanceof Error ? e.message : String(e) };
    }
  }
  const e = erkenneKarte(bytes);
  if (!e.ok) return { name, groesse, sha256, rolle: "fremd", hinweis: e.reason };
  // Ein Abbild, das wie unveraendertes Stock aussieht (Kopf 2.02, keine
  // Hacktribe-Baenke), aber nicht den Stock-Hash traegt: beschaedigt oder
  // veraendert — als Stock-Basis jedenfalls unbrauchbar.
  if (!e.hacktribe && bytes[0x2a] === 2 && bytes[0x2b] === 2) {
    const soll = e.karte.id === "synth-stock" ? SYNTH_STOCK_SHA256 : SAMPLER_STOCK_SHA256;
    return {
      name,
      groesse,
      sha256,
      rolle: "beschaedigt",
      hinweis: `sieht aus wie ${e.karte.label}, aber SHA-256 ${sha256.slice(0, 12)}… statt ${soll.slice(0, 12)}… — beschädigt oder verändert; als Stock-Basis unbrauchbar (als „eigene Firmware“ analysierbar)`,
      befund: e,
    };
  }
  return { name, groesse, sha256, rolle: "eigene", hinweis: `${karteLabel(e)} — eigene/modifizierte Fassung (Hash ${sha256.slice(0, 12)}…)`, befund: e };
}

export interface AblageStand {
  dateien: AblageDatei[];
  synthStock?: AblageDatei;
  samplerStock?: AblageDatei;
  hacktribe?: AblageDatei;
  patch?: AblageDatei;
  eigene: AblageDatei[];
  /** Was fuer die drei Basis-Wahlen fehlt. */
  fehlend: string[];
  zeilen: string[];
}

export type BasisWahl = "sampler-stock" | "hacktribe" | "synth-stock" | "eigene";

export const BASIS_WAHL_LABEL: Record<BasisWahl, string> = {
  "sampler-stock": "Sampler — offizielle Firmware v2.02",
  hacktribe: "Sampler + Hacktribe (aus Stock + Patch erzeugt)",
  "synth-stock": "Synth — offizielle Firmware v2.02",
  eigene: "eigene/modifizierte Firmware aus der Ablage oder Datei",
};

export function ablageStand(dateien: readonly AblageDatei[]): AblageStand {
  const erste = (r: AblageRolle) => dateien.find((d) => d.rolle === r);
  const st: AblageStand = {
    dateien: [...dateien],
    synthStock: erste("synth-stock"),
    samplerStock: erste("sampler-stock"),
    hacktribe: erste("hacktribe"),
    patch: erste("hacktribe-patch"),
    eigene: dateien.filter((d) => d.rolle === "eigene" || d.rolle === "beschaedigt"),
    fehlend: [],
    zeilen: [],
  };
  if (!st.synthStock) st.fehlend.push("Synth v2.02 (electribe_system_v202.zip → SYSTEM.VSB)");
  if (!st.samplerStock) st.fehlend.push("Sampler v2.02 (electribe_sampler_system_v202.zip → SYSTEM.VSB)");
  if (!st.hacktribe && !st.patch) st.fehlend.push("hacktribe-2.patch (bangcorrupt/hacktribe) — oder eine fertige Hacktribe-SYSTEM.VSB");
  for (const d of dateien) st.zeilen.push(`${d.rolle === "beschaedigt" || d.rolle === "fremd" ? "✗" : "✓"} ${d.name}: ${d.hinweis}`);
  return st;
}

/** Welche Basis-Wahlen der Stand hergibt. */
export function basisMoeglich(st: AblageStand, wahl: BasisWahl): { ok: true } | { ok: false; grund: string } {
  switch (wahl) {
    case "sampler-stock":
      return st.samplerStock ? { ok: true } : { ok: false, grund: "Sampler v2.02 fehlt in der Ablage" };
    case "synth-stock":
      return st.synthStock ? { ok: true } : { ok: false, grund: "Synth v2.02 fehlt in der Ablage" };
    case "hacktribe":
      if (st.hacktribe) return { ok: true };
      if (st.samplerStock && st.patch) return { ok: true };
      return { ok: false, grund: st.samplerStock ? "hacktribe-2.patch fehlt (oder eine fertige Hacktribe-SYSTEM.VSB)" : "Sampler v2.02 und hacktribe-2.patch fehlen" };
    case "eigene":
      return { ok: true };
  }
}

export function kartenIdFuerWahl(wahl: BasisWahl): KartenId | null {
  return wahl === "eigene" ? null : wahl;
}

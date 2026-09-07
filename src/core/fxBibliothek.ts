/**
 * fxBibliothek — die Bibliothek aller Effekt-Presets und Groove-Vorlagen:
 * die mitgelieferten Sets (fest in der App), dazu alles, was der Nutzer
 * dazuladet (Einzeldateien, Sammlungen, Sicherungen, Firmware-Abbilder) oder
 * aus dem Editor uebernimmt. Mit Favoriten, und so abgelegt, dass sie den
 * Neustart ueberlebt (Ablage: gui/tekkFxBib.ts).
 *
 * Nutzerwunsch 2026-09-06: „eine IFX-, MFX- und Groove-Library, wo alle
 * vorhandenen gelistet werden, komplett exportierbar, nach dem Neustart
 * wieder da, Presets importierbar, Favoriten, und daraus neue Preset-Dateien
 * erzeugen — welche auswaehlen, exportieren, fuers Flashen benutzen.“
 *
 * Aufbau: Die eingebauten Eintraege werden NICHT abgelegt, sondern bei jedem
 * Start aus den gebuendelten Sammlungen gelesen — so bringt ein Update neue
 * Sets mit, ohne dass jemand die Ablage anfasst. Abgelegt werden nur die
 * eigenen Eintraege, die Favoriten-Kennungen und die Kennungen ausgeblendeter
 * Eingebauter. Eintraege sind unveraenderlich; jede Operation liefert einen
 * neuen Stand.
 *
 * Kennungen: eingebaut `eb:<Datei>:<Index>` (stabil, solange die Sammlung
 * ihre Reihenfolge behaelt), eigene `ei:<Zeit>-<Zaehler>`.
 */
import { leseSammlung, baueSammlung, nummerierePlaetze, PLATZ_MAX, type SammlungsArt, type SammlungsEintrag } from "./sammlung";
import { FX_PRESET_SIZE } from "./e2FxPreset";
import { GROOVE_SIZE } from "./e2Groove";
import { bytesToBase64, base64ToBytes } from "./wavCodec";
import { EINGEBAUTE_SAMMLUNGEN } from "./fxBibliothekEingebaut";
import { algorithmusVon, nameVon, istLeer, alsSammlung, zustandAusSicherung, zustandAusFirmware } from "./presetManager";
import { leseSicherung } from "./geraetSicherung";

export type BibArt = SammlungsArt;

export interface BibliotheksEintrag {
  id: string;
  art: BibArt;
  name: string;
  bytes: Uint8Array;
  /** Woher: Set-Name, Dateiname, „Editor“, „Pattern 3 Part 2“ … */
  woher: string;
  favorit: boolean;
  /** Ablagezeitpunkt (ms seit Epoch); bei Eingebauten 0. */
  wann: number;
  eingebaut: boolean;
}

/** Was abgelegt wird — ohne die Eingebauten. */
export interface BibliotheksStand {
  version: 1;
  eigene: { id: string; art: BibArt; name: string; bytes: Uint8Array; woher: string; wann: number }[];
  favoriten: string[];
  ausgeblendet: string[];
}

export const BIBLIOTHEK_VERSION = 1;

export function leererStand(): BibliotheksStand {
  return { version: 1, eigene: [], favoriten: [], ausgeblendet: [] };
}

export function groesseFuer(art: BibArt): number {
  return art === "groove" ? GROOVE_SIZE : FX_PRESET_SIZE;
}

// ─── Eingebaute ──────────────────────────────────────────────────────────────

let eingebautCache: BibliotheksEintrag[] | null = null;

/** Die mitgelieferten Eintraege — einmal gelesen, dann aus dem Cache (Kopien der Bytes). */
export function eingebauteEintraege(): BibliotheksEintrag[] {
  if (!eingebautCache) {
    const out: BibliotheksEintrag[] = [];
    for (const s of EINGEBAUTE_SAMMLUNGEN) {
      let eintraege: SammlungsEintrag[];
      try {
        eintraege = leseSammlung(s.text).eintraege;
      } catch {
        continue; // eine kaputte Sammlung nimmt nicht die ganze Bibliothek mit
      }
      eintraege.forEach((e, i) => {
        out.push({ id: `eb:${s.datei}:${i}`, art: e.art, name: e.name, bytes: e.bytes, woher: s.set, favorit: false, wann: 0, eingebaut: true });
      });
    }
    eingebautCache = out;
  }
  return eingebautCache.map((e) => ({ ...e, bytes: e.bytes.slice() }));
}

// ─── Stand ablegen und lesen ─────────────────────────────────────────────────

export function serialisiereStand(st: BibliotheksStand): string {
  return JSON.stringify(
    {
      version: BIBLIOTHEK_VERSION,
      eigene: st.eigene.map((e) => ({ id: e.id, art: e.art, name: e.name, woher: e.woher, wann: e.wann, daten: bytesToBase64(e.bytes) })),
      favoriten: st.favoriten,
      ausgeblendet: st.ausgeblendet,
    },
    null,
    1,
  );
}

/** Tolerant: Unbrauchbare Eintraege fallen weg, statt dass die Bibliothek leer bleibt. */
export function leseStand(text: string | null | undefined): BibliotheksStand {
  const st = leererStand();
  if (!text) return st;
  let roh: unknown;
  try {
    roh = JSON.parse(text);
  } catch {
    return st;
  }
  const x = (typeof roh === "object" && roh ? roh : {}) as Record<string, unknown>;
  if (Array.isArray(x.eigene)) {
    for (const e of x.eigene) {
      const o = (typeof e === "object" && e ? e : {}) as Record<string, unknown>;
      const art = o.art;
      if (art !== "ifx" && art !== "mfx" && art !== "groove") continue;
      if (typeof o.daten !== "string" || typeof o.id !== "string") continue;
      let bytes: Uint8Array;
      try {
        bytes = base64ToBytes(o.daten);
      } catch {
        continue;
      }
      if (bytes.length !== groesseFuer(art)) continue;
      st.eigene.push({
        id: o.id,
        art,
        name: String(o.name ?? nameVon(bytes, art) ?? "").slice(0, 15),
        bytes,
        woher: String(o.woher ?? ""),
        wann: Number.isFinite(o.wann) ? (o.wann as number) : 0,
      });
    }
  }
  const ids = (l: unknown): string[] => (Array.isArray(l) ? l.filter((s): s is string => typeof s === "string") : []);
  st.favoriten = ids(x.favoriten);
  st.ausgeblendet = ids(x.ausgeblendet);
  return st;
}

// ─── Zusammensetzen ──────────────────────────────────────────────────────────

/** Eigene zuerst (neueste oben), dann die Eingebauten ohne die ausgeblendeten; Favoriten markiert. */
export function bibliotheksEintraege(st: BibliotheksStand): BibliotheksEintrag[] {
  const fav = new Set(st.favoriten);
  const weg = new Set(st.ausgeblendet);
  const eigene: BibliotheksEintrag[] = [...st.eigene]
    .sort((a, b) => b.wann - a.wann)
    .map((e) => ({ ...e, bytes: e.bytes.slice(), favorit: fav.has(e.id), eingebaut: false }));
  const eingebaut = eingebauteEintraege()
    .filter((e) => !weg.has(e.id))
    .map((e) => ({ ...e, favorit: fav.has(e.id) }));
  return [...eigene, ...eingebaut];
}

export interface BibFilter {
  art?: BibArt | "alle";
  suche?: string;
  nurFavoriten?: boolean;
}

export function filtereEintraege(eintraege: readonly BibliotheksEintrag[], f: BibFilter): BibliotheksEintrag[] {
  const suche = (f.suche ?? "").trim().toLowerCase();
  return eintraege.filter((e) => {
    if (f.art && f.art !== "alle" && e.art !== f.art) return false;
    if (f.nurFavoriten && !e.favorit) return false;
    if (suche && !`${e.name} ${algorithmusVon(e.bytes, e.art)} ${e.woher}`.toLowerCase().includes(suche)) return false;
    return true;
  });
}

// ─── Aendern ─────────────────────────────────────────────────────────────────

let zaehler = 0;
export function neueId(jetzt = Date.now()): string {
  zaehler = (zaehler + 1) % 100000;
  return `ei:${jetzt.toString(36)}-${zaehler.toString(36)}`;
}

const gleich = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

export interface NeuerEintrag {
  art: BibArt;
  name?: string;
  bytes: Uint8Array;
  woher: string;
}

/**
 * Einen Eintrag aufnehmen. Gibt es denselben Block (Art + Bytes) schon —
 * eingebaut oder eigen —, kommt kein zweiter dazu; zurueck kommt dann die
 * vorhandene Kennung. So bleibt ein zweimal geladenes Set einmal da.
 */
export function fuegeHinzu(st: BibliotheksStand, neu: NeuerEintrag, jetzt = Date.now()): { stand: BibliotheksStand; id: string; vorhanden: boolean } {
  if (neu.bytes.length !== groesseFuer(neu.art)) throw new Error(`${neu.bytes.length} Bytes — ein ${neu.art.toUpperCase()}-Block hat ${groesseFuer(neu.art)}`);
  if (istLeer(neu.bytes, neu.art)) throw new Error("Ein leerer Block gehört nicht in die Bibliothek");
  const alle = bibliotheksEintraege({ ...st, ausgeblendet: [] });
  const da = alle.find((e) => e.art === neu.art && gleich(e.bytes, neu.bytes));
  if (da) {
    // Ein ausgeblendeter Eingebauter wird durch erneutes Laden wieder sichtbar.
    const ausgeblendet = st.ausgeblendet.filter((id) => id !== da.id);
    return { stand: { ...st, ausgeblendet }, id: da.id, vorhanden: true };
  }
  const id = neueId(jetzt);
  const name = (neu.name ?? nameVon(neu.bytes, neu.art) ?? "").slice(0, 15) || `${neu.art.toUpperCase()}-Eintrag`;
  return {
    stand: { ...st, eigene: [...st.eigene, { id, art: neu.art, name, bytes: neu.bytes.slice(), woher: neu.woher, wann: jetzt }] },
    id,
    vorhanden: false,
  };
}

/** Eigene Eintraege verschwinden, Eingebaute werden nur ausgeblendet (ein Update bringt sie nicht zurueck, „Eingebaute zeigen“ schon). */
export function entferne(st: BibliotheksStand, id: string): BibliotheksStand {
  const favoriten = st.favoriten.filter((f) => f !== id);
  if (id.startsWith("eb:")) return { ...st, favoriten, ausgeblendet: st.ausgeblendet.includes(id) ? st.ausgeblendet : [...st.ausgeblendet, id] };
  return { ...st, favoriten, eigene: st.eigene.filter((e) => e.id !== id) };
}

export function setzeFavorit(st: BibliotheksStand, id: string, an: boolean): BibliotheksStand {
  const ohne = st.favoriten.filter((f) => f !== id);
  return { ...st, favoriten: an ? [...ohne, id] : ohne };
}

export function umbenenne(st: BibliotheksStand, id: string, name: string): BibliotheksStand {
  return { ...st, eigene: st.eigene.map((e) => (e.id === id ? { ...e, name: name.slice(0, 15) } : e)) };
}

/** Alle ausgeblendeten Eingebauten wieder zeigen. */
export function zeigeEingebaute(st: BibliotheksStand): BibliotheksStand {
  return { ...st, ausgeblendet: [] };
}

/** Alle eigenen Eintraege weg (Favoriten der Eingebauten bleiben). */
export function leereEigene(st: BibliotheksStand): BibliotheksStand {
  const eigeneIds = new Set(st.eigene.map((e) => e.id));
  return { ...st, eigene: [], favoriten: st.favoriten.filter((f) => !eigeneIds.has(f)) };
}

// ─── Dateien lesen ───────────────────────────────────────────────────────────

/** Art einer Einzeldatei an der Endung: .mfx Master, .e2gv/.gv Groove, sonst Insert. */
export function artAusDateiname(name: string): BibArt {
  return /\.mfx$/i.test(name) ? "mfx" : /\.(e2gv|gv)$/i.test(name) ? "groove" : "ifx";
}

/**
 * Aus einer Datei alles herausholen, was in die Bibliothek gehoert:
 * Sammlung (.tfsam/.json) und Bauplan (.tfbau) ueber ihre Eintraege,
 * Sicherung (.tfbak) und Firmware (.VSB) ueber die belegten Plaetze,
 * alles andere als Einzelblock nach Endung. Wirft mit Begruendung.
 */
export function eintraegeAusDatei(dateiname: string, bytes: Uint8Array): NeuerEintrag[] {
  const text = () => new TextDecoder().decode(bytes);
  if (/\.(tfsam|tfbau|json)$/i.test(dateiname)) {
    const s = leseSammlung(text());
    return s.eintraege.map((e) => ({ art: e.art, name: e.name, bytes: e.bytes, woher: s.titel || dateiname }));
  }
  if (/\.tfbak$/i.test(dateiname)) {
    const z = zustandAusSicherung(leseSicherung(text()));
    return alsSammlung(z).map((e) => ({ art: e.art, name: e.name, bytes: e.bytes, woher: `${dateiname} Platz ${e.platz}` }));
  }
  if (/\.vsb$/i.test(dateiname)) {
    const z = zustandAusFirmware(bytes);
    return alsSammlung(z).map((e) => ({ art: e.art, name: e.name, bytes: e.bytes, woher: `${dateiname} Platz ${e.platz}` }));
  }
  const art = artAusDateiname(dateiname);
  if (bytes.length !== groesseFuer(art)) throw new Error(`${dateiname}: ${bytes.length} Bytes — ein ${art.toUpperCase()}-Block hat ${groesseFuer(art)}`);
  return [{ art, name: nameVon(bytes, art) || dateiname.replace(/\.[^.]+$/, "").slice(0, 15), bytes, woher: dateiname }];
}

// ─── Herausgeben ─────────────────────────────────────────────────────────────

/** Die ganze Bibliothek (oder ein Teil) als Sammlung ohne Plaetze — zum Weitergeben und Wiederladen. */
export function alsSammlungsText(eintraege: readonly BibliotheksEintrag[], titel: string, autor = ""): string {
  return baueSammlung(
    eintraege.map((e) => ({ art: e.art, name: e.name, bytes: e.bytes })),
    { titel, autor },
  );
}

export interface StartPlaetze {
  ifx?: number;
  mfx?: number;
  groove?: number;
}

export interface PlatzErgebnis {
  eintraege: SammlungsEintrag[];
  /** Eintraege, fuer die hinter der Art-Grenze kein Platz mehr war. */
  ohnePlatz: SammlungsEintrag[];
}

/**
 * Eine Auswahl mit Ziel-Plaetzen versehen — je Art fortlaufend ab dem
 * Startplatz (Vorgabe 1). Was hinter die Art-Grenze fiele (IFX 96, MFX 32,
 * Groove 96), bleibt ohne Platz und wird gemeldet, statt still auf Platz 1
 * umzubrechen. Das Ergebnis passt in eine Sammlung mit Plaetzen (.tfsam), in
 * einen Bauplan (.tfbau) und direkt in `baueFirmware`.
 */
export function auswahlMitPlaetzen(eintraege: readonly BibliotheksEintrag[], start: StartPlaetze = {}): PlatzErgebnis {
  const out: SammlungsEintrag[] = [];
  const ohnePlatz: SammlungsEintrag[] = [];
  for (const art of ["ifx", "mfx", "groove"] as const) {
    const meine = eintraege.filter((e) => e.art === art).map((e) => ({ art: e.art, name: e.name, bytes: e.bytes }));
    if (!meine.length) continue;
    const s = start[art];
    const von = s !== undefined && Number.isFinite(s) ? Math.max(1, Math.round(s)) : 1;
    const n = nummerierePlaetze(meine, von, "auf");
    for (const e of n.eintraege) (e.platz !== undefined ? out : ohnePlatz).push(e);
  }
  return { eintraege: out, ohnePlatz };
}

/** Wie viele Plaetze je Art frei bleiben muessten — fuer die Rueckfrage vor dem Flashen. */
export function platzBedarf(eintraege: readonly BibliotheksEintrag[]): Record<BibArt, number> {
  const out: Record<BibArt, number> = { ifx: 0, mfx: 0, groove: 0 };
  for (const e of eintraege) out[e.art]++;
  return out;
}

export { PLATZ_MAX };

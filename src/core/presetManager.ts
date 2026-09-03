/**
 * presetManager — die ganze Effekt-Preset-Bank als Liste, und die Groove-Bank
 * gleich mit.
 *
 * 96 Insert-, 32 Master- und 96 Groove-Plaetze, Plaetze wie am Geraet ab 1.
 * Ein leerer Preset-Platz ist ein Init-Block ohne Namen, ein leerer
 * Groove-Platz lauter 0xFF — so sehen die unbelegten Plaetze auf dem Geraet
 * aus (Sicherung 2026-09-01, Firmware 2026-09-02). Der Zustand kommt aus drei
 * gleichwertigen Quellen (Geraet, Sicherung, Firmware) und wird hier nur
 * umgebaut: verschieben, tauschen, umbenennen, loeschen, einfuegen.
 * Geschrieben wird spaeter nur, was sich gegen die Basis unterscheidet
 * (`unterschiede`) — einmal fluechtig ins RAM, einmal dauerhaft in die
 * Firmware (`firmwareBau`).
 *
 * Alle Operationen liefern einen neuen Zustand; die Eingabe bleibt stehen.
 * Das ist die einfachste Art, „Zuruecknehmen" richtig zu haben: die Basis
 * ist immer noch da.
 */
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes, FX_PRESET_SIZE } from "./e2FxPreset";
import { decodeGroove, encodeGroove, GROOVE_SIZE } from "./e2Groove";
import { E2_RAM_MAP, addressForSlot, IFX_PRESET_WRITE_MAX, MFX_PRESET_WRITE_MAX } from "./hacktribeRam";
import { IFX_ZAEHLER, leseZaehlerStand, istPresetPlatzLeer } from "./ifxErweiterung";
import { dateiOffset, pruefeFirmware, istGroovePlatzLeer, leseGrooveStand } from "./firmwareBau";
import type { Sicherung } from "./geraetSicherung";
import type { SammlungsEintrag } from "./sammlung";

export type ManagerArt = "ifx" | "mfx" | "groove";
export const MANAGER_ARTEN: readonly ManagerArt[] = ["ifx", "mfx", "groove"];

/** Schreibbare Plaetze je Art — IFX 0..95, MFX 0..31, Groove 0..95 (siehe hacktribeRam). */
export const IFX_PLAETZE = IFX_PRESET_WRITE_MAX + 1;
export const MFX_PLAETZE = MFX_PRESET_WRITE_MAX + 1;
export const GROOVE_PLAETZE = E2_RAM_MAP.find((e) => e.key === "groove")!.count;

export interface ManagerZustand {
  ifx: Uint8Array[];
  mfx: Uint8Array[];
  groove: Uint8Array[];
  /** Max-IFX-Index laut Zaehler (0-basiert), -1 = unbekannt. */
  ifxMaxIndex: number;
  /** Max-Groove-Index laut Zaehler (0-basiert), -1 = unbekannt. */
  grooveMaxIndex: number;
}

export const anzahlPlaetze = (art: ManagerArt): number => (art === "ifx" ? IFX_PLAETZE : art === "mfx" ? MFX_PLAETZE : GROOVE_PLAETZE);
export const blockGroesse = (art: ManagerArt): number => (art === "groove" ? GROOVE_SIZE : FX_PRESET_SIZE);
const mapKey = (art: ManagerArt): string => (art === "groove" ? "groove" : art === "mfx" ? "mfxPreset" : "ifxPreset");

/** Ein leerer Platz, wie ihn das Geraet haelt: Init-Werte ohne Namen bzw. lauter 0xFF beim Groove. */
export function leererBlock(art: ManagerArt): Uint8Array {
  if (art === "groove") return new Uint8Array(GROOVE_SIZE).fill(0xff);
  const p = decodeFxPreset(initFxPresetBytes(), art === "mfx");
  p.name = "";
  return encodeFxPreset(p);
}

export const istLeer = (bytes: Uint8Array, art: ManagerArt = "ifx"): boolean =>
  art === "groove" ? istGroovePlatzLeer(bytes) : istPresetPlatzLeer(bytes);

export function nameVon(bytes: Uint8Array, art: ManagerArt = "ifx"): string {
  if (art === "groove") {
    if (istGroovePlatzLeer(bytes)) return "";
    try {
      return decodeGroove(bytes).name;
    } catch {
      return "";
    }
  }
  let t = "";
  for (let i = 1; i < 16 && bytes[i]; i++) t += String.fromCharCode(bytes[i]);
  return t;
}

export function algorithmusVon(bytes: Uint8Array, art: ManagerArt): string {
  if (art === "groove") {
    if (istGroovePlatzLeer(bytes)) return "";
    try {
      return `${decodeGroove(bytes).laenge} Steps`;
    } catch {
      return "?";
    }
  }
  const p = decodeFxPreset(bytes, art === "mfx");
  if (art === "mfx") return p.mfx.algorithmus || "—";
  const zweiter = p.ifx2.device ? ` + ${p.ifx2.algorithmus}` : "";
  return (p.ifx1.algorithmus || (p.ifx1.device === 0 ? "Thru" : "?")) + zweiter;
}

export function zustandAusBloecken(
  ifx: readonly Uint8Array[],
  mfx: readonly Uint8Array[],
  ifxMaxIndex: number,
  groove: readonly Uint8Array[] = Array.from({ length: GROOVE_PLAETZE }, () => leererBlock("groove")),
  grooveMaxIndex = -1,
): ManagerZustand {
  if (ifx.length !== IFX_PLAETZE) throw new Error(`${ifx.length} IFX-Bloecke, ${IFX_PLAETZE} erwartet`);
  if (mfx.length !== MFX_PLAETZE) throw new Error(`${mfx.length} MFX-Bloecke, ${MFX_PLAETZE} erwartet`);
  if (groove.length !== GROOVE_PLAETZE) throw new Error(`${groove.length} Groove-Bloecke, ${GROOVE_PLAETZE} erwartet`);
  for (const b of [...ifx, ...mfx]) if (b.length !== FX_PRESET_SIZE) throw new Error(`Block mit ${b.length} statt ${FX_PRESET_SIZE} Bytes`);
  for (const b of groove) if (b.length !== GROOVE_SIZE) throw new Error(`Groove-Block mit ${b.length} statt ${GROOVE_SIZE} Bytes`);
  return { ifx: ifx.map((b) => b.slice()), mfx: mfx.map((b) => b.slice()), groove: groove.map((b) => b.slice()), ifxMaxIndex, grooveMaxIndex };
}

/** Aus zusammenhaengenden Bankdumps (wie sie Sicherung und Geraet liefern). */
export function zustandAusBaenken(
  ifxBank: Uint8Array,
  mfxBank: Uint8Array,
  ifxMaxIndex: number,
  grooveBank?: Uint8Array,
  grooveMaxIndex = -1,
): ManagerZustand {
  const teile = (bank: Uint8Array, n: number, groesse: number): Uint8Array[] => {
    if (bank.length < n * groesse) throw new Error(`Bank zu kurz: ${bank.length} Bytes fuer ${n} Plaetze`);
    return Array.from({ length: n }, (_, i) => bank.subarray(i * groesse, (i + 1) * groesse));
  };
  return zustandAusBloecken(
    teile(ifxBank, IFX_PLAETZE, FX_PRESET_SIZE),
    teile(mfxBank, MFX_PLAETZE, FX_PRESET_SIZE),
    ifxMaxIndex,
    grooveBank ? teile(grooveBank, GROOVE_PLAETZE, GROOVE_SIZE) : undefined,
    grooveMaxIndex,
  );
}

export function zustandAusSicherung(s: Sicherung): ManagerZustand {
  const block = (key: string): Uint8Array | undefined => s.bloecke.find((x) => x.key === key)?.bytes;
  const ifx = block("ifxPreset");
  const mfx = block("mfxPreset");
  if (!ifx || !mfx) throw new Error("Die Sicherung hat keine Preset-Bereiche");
  const max = block("maxIfxIndex")?.[0] ?? -1;
  const gAnzahl = block("grooveMaxIndex")?.[0];
  return zustandAusBaenken(ifx, mfx, max, block("groove"), gAnzahl !== undefined ? gAnzahl - 1 : -1);
}

export function zustandAusFirmware(fw: Uint8Array): ManagerZustand {
  const pr = pruefeFirmware(fw);
  if (!pr.ok) throw new Error(pr.reason);
  const map = (key: string) => E2_RAM_MAP.find((e) => e.key === key)!;
  const bank = (key: string, n: number, groesse: number): Uint8Array[] =>
    Array.from({ length: n }, (_, i) => {
      const off = dateiOffset(addressForSlot(map(key), i));
      return fw.subarray(off, off + groesse);
    });
  const stand = leseZaehlerStand(IFX_ZAEHLER.map((z) => ({ addr: z.addr, wert: fw[dateiOffset(z.addr)] })));
  const gv = leseGrooveStand(fw);
  return zustandAusBloecken(
    bank("ifxPreset", IFX_PLAETZE, FX_PRESET_SIZE),
    bank("mfxPreset", MFX_PLAETZE, FX_PRESET_SIZE),
    stand.ok ? stand.maxIndex : -1,
    bank("groove", GROOVE_PLAETZE, GROOVE_SIZE),
    gv.ok ? gv.maxIndex : -1,
  );
}

// ─── Operationen ─────────────────────────────────────────────────────────────

function pruefePlatz(art: ManagerArt, platz: number): void {
  if (!Number.isInteger(platz) || platz < 1 || platz > anzahlPlaetze(art)) {
    throw new Error(`Platz ${platz} gibt es nicht — ${art.toUpperCase()} zählt 1..${anzahlPlaetze(art)}`);
  }
}

function kopie(z: ManagerZustand): ManagerZustand {
  return {
    ifx: z.ifx.map((b) => b.slice()),
    mfx: z.mfx.map((b) => b.slice()),
    groove: z.groove.map((b) => b.slice()),
    ifxMaxIndex: z.ifxMaxIndex,
    grooveMaxIndex: z.grooveMaxIndex,
  };
}

/** Einen Block ueber die Unterlage des Platzes legen — byte-treu, unbekannte Bytes bleiben. */
function ueberlage(art: ManagerArt, bytes: Uint8Array, unterlage: Uint8Array): Uint8Array {
  if (bytes.length !== blockGroesse(art)) throw new Error(`${bytes.length} statt ${blockGroesse(art)} Bytes`);
  if (art === "groove") {
    // Ein leerer Block bleibt leer — durch den Kodierer gedreht wuerde aus
    // 0xFF ein namenloser Phantom-Groove mit Rahmen.
    if (istGroovePlatzLeer(bytes)) return leererBlock("groove");
    return encodeGroove(decodeGroove(bytes), istGroovePlatzLeer(unterlage) ? undefined : unterlage);
  }
  return encodeFxPreset(decodeFxPreset(bytes, art === "mfx"), unterlage);
}

export function umbenennen(z: ManagerZustand, art: ManagerArt, platz: number, name: string): ManagerZustand {
  pruefePlatz(art, platz);
  const n = kopie(z);
  const alt = n[art][platz - 1];
  if (art === "groove") {
    if (istGroovePlatzLeer(alt)) throw new Error(`Platz ${platz} ist leer — da gibt es nichts umzubenennen`);
    const g = decodeGroove(alt);
    g.name = name.slice(0, 15);
    n[art][platz - 1] = encodeGroove(g, alt);
    return n;
  }
  const p = decodeFxPreset(alt, art === "mfx");
  p.name = name.slice(0, 15);
  n[art][platz - 1] = encodeFxPreset(p, alt);
  return n;
}

export function verschieben(z: ManagerZustand, art: ManagerArt, von: number, nach: number): ManagerZustand {
  pruefePlatz(art, von);
  pruefePlatz(art, nach);
  const n = kopie(z);
  const [block] = n[art].splice(von - 1, 1);
  n[art].splice(nach - 1, 0, block);
  return n;
}

export function tauschen(z: ManagerZustand, art: ManagerArt, a: number, b: number): ManagerZustand {
  pruefePlatz(art, a);
  pruefePlatz(art, b);
  const n = kopie(z);
  [n[art][a - 1], n[art][b - 1]] = [n[art][b - 1], n[art][a - 1]];
  return n;
}

/** Herausnehmen, der Rest rueckt auf, hinten kommt ein leerer Block — Listen-Semantik wie das Menue. */
export function loeschen(z: ManagerZustand, art: ManagerArt, platz: number): ManagerZustand {
  pruefePlatz(art, platz);
  const n = kopie(z);
  n[art].splice(platz - 1, 1);
  n[art].push(leererBlock(art));
  return n;
}

/** Den Platz leeren, ohne dass etwas rueckt — hinterlaesst eine Luecke. */
export function leeren(z: ManagerZustand, art: ManagerArt, platz: number): ManagerZustand {
  pruefePlatz(art, platz);
  const n = kopie(z);
  n[art][platz - 1] = leererBlock(art);
  return n;
}

export function ersetzen(z: ManagerZustand, art: ManagerArt, platz: number, bytes: Uint8Array): ManagerZustand {
  pruefePlatz(art, platz);
  const n = kopie(z);
  n[art][platz - 1] = ueberlage(art, bytes, n[art][platz - 1]);
  return n;
}

/** Einfuegen rueckt den Rest nach hinten; ein belegter Block darf dabei nicht herausfallen. */
export function einfuegen(z: ManagerZustand, art: ManagerArt, platz: number, bytes: Uint8Array): ManagerZustand {
  pruefePlatz(art, platz);
  if (bytes.length !== blockGroesse(art)) throw new Error(`${bytes.length} statt ${blockGroesse(art)} Bytes`);
  const n = kopie(z);
  const letzter = n[art][n[art].length - 1];
  if (!istLeer(letzter, art)) {
    throw new Error(`${art.toUpperCase()} ist voll — Platz ${anzahlPlaetze(art)} („${nameVon(letzter, art)}“) ist belegt und fiele heraus`);
  }
  n[art].pop();
  n[art].splice(platz - 1, 0, ueberlage(art, bytes, leererBlock(art)));
  return n;
}

// ─── Auswertung ──────────────────────────────────────────────────────────────

/** Hoechster belegter Platz (Geraete-Zaehlung), 0 wenn keiner. */
export function hoechsterBelegter(z: ManagerZustand, art: ManagerArt): number {
  for (let i = z[art].length - 1; i >= 0; i--) if (!istLeer(z[art][i], art)) return i + 1;
  return 0;
}

/** Leere Plaetze vor dem hoechsten belegten — die zeigte das Menue namenlos. */
export function luecken(z: ManagerZustand, art: ManagerArt): number[] {
  const bis = hoechsterBelegter(z, art);
  const out: number[] = [];
  for (let i = 0; i < bis; i++) if (istLeer(z[art][i], art)) out.push(i + 1);
  return out;
}

const gleich = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Alle Plaetze, deren Bytes sich gegen die Basis unterscheiden — fertig zum Verteilen oder Einbrennen. */
export function unterschiede(z: ManagerZustand, basis: ManagerZustand): SammlungsEintrag[] {
  const out: SammlungsEintrag[] = [];
  for (const art of MANAGER_ARTEN) {
    z[art].forEach((bytes, i) => {
      if (!gleich(bytes, basis[art][i])) out.push({ art, platz: i + 1, name: nameVon(bytes, art), bytes: bytes.slice() });
    });
  }
  return out;
}

/** Alle belegten Plaetze als Sammlung mit Platz. */
export function alsSammlung(z: ManagerZustand): SammlungsEintrag[] {
  const out: SammlungsEintrag[] = [];
  for (const art of MANAGER_ARTEN) {
    z[art].forEach((bytes, i) => {
      if (!istLeer(bytes, art)) out.push({ art, platz: i + 1, name: nameVon(bytes, art), bytes: bytes.slice() });
    });
  }
  return out;
}

/**
 * Doppelte Inhalte einer Art: Platz → die anderen Plaetze mit byteweise
 * demselben Block (leere Plaetze zaehlen nicht). Ein Preset zweimal in der
 * Bank ist selten Absicht — meistens ein vergessener Vergleichs-Platz.
 */
export function doppelte(z: ManagerZustand, art: ManagerArt): Map<number, number[]> {
  const gruppen = new Map<string, number[]>();
  z[art].forEach((bytes, i) => {
    if (istLeer(bytes, art)) return;
    let key = "";
    for (let k = 0; k < bytes.length; k++) key += String.fromCharCode(bytes[k]);
    const l = gruppen.get(key) ?? [];
    l.push(i + 1);
    gruppen.set(key, l);
  });
  const out = new Map<number, number[]>();
  for (const plaetze of gruppen.values()) {
    if (plaetze.length < 2) continue;
    for (const p of plaetze) out.set(p, plaetze.filter((q) => q !== p));
  }
  return out;
}

/** Fuer die GUI: die RAM-Karte je Art. */
export function ramMapFuer(art: ManagerArt) {
  return E2_RAM_MAP.find((e) => e.key === mapKey(art))!;
}

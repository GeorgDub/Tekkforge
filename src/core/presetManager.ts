/**
 * presetManager — die ganze Effekt-Preset-Bank als Liste.
 *
 * 96 Insert- und 32 Master-Plaetze, jeder ein 524-Byte-Block, Plaetze wie am
 * Geraet ab 1. Ein leerer Platz ist ein Init-Block ohne Namen — so sehen die
 * unbelegten Plaetze auf dem Geraet aus (Sicherung 2026-09-01). Der Zustand
 * kommt aus drei gleichwertigen Quellen (Geraet, Sicherung, Firmware) und
 * wird hier nur umgebaut: verschieben, tauschen, umbenennen, loeschen,
 * einfuegen. Geschrieben wird spaeter nur, was sich gegen die Basis
 * unterscheidet (`unterschiede`) — einmal fluechtig ins RAM, einmal dauerhaft
 * in die Firmware (`firmwareBau`).
 *
 * Alle Operationen liefern einen neuen Zustand; die Eingabe bleibt stehen.
 * Das ist die einfachste Art, „Zuruecknehmen" richtig zu haben: die Basis
 * ist immer noch da.
 */
import { decodeFxPreset, encodeFxPreset, initFxPresetBytes, FX_PRESET_SIZE } from "./e2FxPreset";
import { E2_RAM_MAP, addressForSlot, IFX_PRESET_WRITE_MAX, MFX_PRESET_WRITE_MAX } from "./hacktribeRam";
import { IFX_ZAEHLER, leseZaehlerStand, istPresetPlatzLeer } from "./ifxErweiterung";
import { dateiOffset, pruefeFirmware } from "./firmwareBau";
import type { Sicherung } from "./geraetSicherung";
import type { SammlungsEintrag } from "./sammlung";

export type ManagerArt = "ifx" | "mfx";

/** Schreibbare Plaetze je Art — IFX 0..95, MFX 0..31 (siehe hacktribeRam). */
export const IFX_PLAETZE = IFX_PRESET_WRITE_MAX + 1;
export const MFX_PLAETZE = MFX_PRESET_WRITE_MAX + 1;

export interface ManagerZustand {
  ifx: Uint8Array[];
  mfx: Uint8Array[];
  /** Max-IFX-Index laut Zaehler (0-basiert), -1 = unbekannt. */
  ifxMaxIndex: number;
}

const anzahl = (art: ManagerArt): number => (art === "ifx" ? IFX_PLAETZE : MFX_PLAETZE);

/** Ein leerer Platz, wie ihn das Geraet haelt: Init-Werte, aber kein Name. */
export function leererBlock(art: ManagerArt): Uint8Array {
  const p = decodeFxPreset(initFxPresetBytes(), art === "mfx");
  p.name = "";
  return encodeFxPreset(p);
}

export const istLeer = (bytes: Uint8Array): boolean => istPresetPlatzLeer(bytes);

export function nameVon(bytes: Uint8Array): string {
  let t = "";
  for (let i = 1; i < 16 && bytes[i]; i++) t += String.fromCharCode(bytes[i]);
  return t;
}

export function algorithmusVon(bytes: Uint8Array, art: ManagerArt): string {
  const p = decodeFxPreset(bytes, art === "mfx");
  if (art === "mfx") return p.mfx.algorithmus || "—";
  const zweiter = p.ifx2.device ? ` + ${p.ifx2.algorithmus}` : "";
  return (p.ifx1.algorithmus || (p.ifx1.device === 0 ? "Thru" : "?")) + zweiter;
}

export function zustandAusBloecken(ifx: readonly Uint8Array[], mfx: readonly Uint8Array[], ifxMaxIndex: number): ManagerZustand {
  if (ifx.length !== IFX_PLAETZE) throw new Error(`${ifx.length} IFX-Bloecke, ${IFX_PLAETZE} erwartet`);
  if (mfx.length !== MFX_PLAETZE) throw new Error(`${mfx.length} MFX-Bloecke, ${MFX_PLAETZE} erwartet`);
  for (const b of [...ifx, ...mfx]) if (b.length !== FX_PRESET_SIZE) throw new Error(`Block mit ${b.length} statt ${FX_PRESET_SIZE} Bytes`);
  return { ifx: ifx.map((b) => b.slice()), mfx: mfx.map((b) => b.slice()), ifxMaxIndex };
}

/** Aus zwei zusammenhaengenden Bankdumps (wie sie Sicherung und Geraet liefern). */
export function zustandAusBaenken(ifxBank: Uint8Array, mfxBank: Uint8Array, ifxMaxIndex: number): ManagerZustand {
  const teile = (bank: Uint8Array, n: number): Uint8Array[] => {
    if (bank.length < n * FX_PRESET_SIZE) throw new Error(`Bank zu kurz: ${bank.length} Bytes fuer ${n} Plaetze`);
    return Array.from({ length: n }, (_, i) => bank.subarray(i * FX_PRESET_SIZE, (i + 1) * FX_PRESET_SIZE));
  };
  return zustandAusBloecken(teile(ifxBank, IFX_PLAETZE), teile(mfxBank, MFX_PLAETZE), ifxMaxIndex);
}

export function zustandAusSicherung(s: Sicherung): ManagerZustand {
  const block = (key: string): Uint8Array => {
    const b = s.bloecke.find((x) => x.key === key);
    if (!b) throw new Error(`Die Sicherung hat keinen Bereich „${key}“`);
    return b.bytes;
  };
  const max = s.bloecke.find((x) => x.key === "maxIfxIndex")?.bytes[0] ?? -1;
  return zustandAusBaenken(block("ifxPreset"), block("mfxPreset"), max);
}

export function zustandAusFirmware(fw: Uint8Array): ManagerZustand {
  const pr = pruefeFirmware(fw);
  if (!pr.ok) throw new Error(pr.reason);
  const map = (key: string) => E2_RAM_MAP.find((e) => e.key === key)!;
  const bank = (key: string, n: number): Uint8Array[] =>
    Array.from({ length: n }, (_, i) => {
      const off = dateiOffset(addressForSlot(map(key), i));
      return fw.subarray(off, off + FX_PRESET_SIZE);
    });
  const stand = leseZaehlerStand(IFX_ZAEHLER.map((z) => ({ addr: z.addr, wert: fw[dateiOffset(z.addr)] })));
  return zustandAusBloecken(bank("ifxPreset", IFX_PLAETZE), bank("mfxPreset", MFX_PLAETZE), stand.ok ? stand.maxIndex : -1);
}

// ─── Operationen ─────────────────────────────────────────────────────────────

function pruefePlatz(art: ManagerArt, platz: number): void {
  if (!Number.isInteger(platz) || platz < 1 || platz > anzahl(art)) {
    throw new Error(`Platz ${platz} gibt es nicht — ${art.toUpperCase()} zählt 1..${anzahl(art)}`);
  }
}

function kopie(z: ManagerZustand): ManagerZustand {
  return { ifx: z.ifx.map((b) => b.slice()), mfx: z.mfx.map((b) => b.slice()), ifxMaxIndex: z.ifxMaxIndex };
}

export function umbenennen(z: ManagerZustand, art: ManagerArt, platz: number, name: string): ManagerZustand {
  pruefePlatz(art, platz);
  const n = kopie(z);
  const alt = n[art][platz - 1];
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
  if (bytes.length !== FX_PRESET_SIZE) throw new Error(`${bytes.length} statt ${FX_PRESET_SIZE} Bytes`);
  const n = kopie(z);
  // Unbekannte Bytes des Platzes bleiben als Unterlage — wie beim Schreiben aufs Geraet.
  n[art][platz - 1] = encodeFxPreset(decodeFxPreset(bytes, art === "mfx"), n[art][platz - 1]);
  return n;
}

/** Einfuegen rueckt den Rest nach hinten; ein belegter Block darf dabei nicht herausfallen. */
export function einfuegen(z: ManagerZustand, art: ManagerArt, platz: number, bytes: Uint8Array): ManagerZustand {
  pruefePlatz(art, platz);
  if (bytes.length !== FX_PRESET_SIZE) throw new Error(`${bytes.length} statt ${FX_PRESET_SIZE} Bytes`);
  const n = kopie(z);
  const letzter = n[art][n[art].length - 1];
  if (!istLeer(letzter)) {
    throw new Error(`${art.toUpperCase()} ist voll — Platz ${anzahl(art)} („${nameVon(letzter)}“) ist belegt und fiele heraus`);
  }
  n[art].pop();
  n[art].splice(platz - 1, 0, encodeFxPreset(decodeFxPreset(bytes, art === "mfx"), leererBlock(art)));
  return n;
}

// ─── Auswertung ──────────────────────────────────────────────────────────────

/** Hoechster belegter Platz (Geraete-Zaehlung), 0 wenn keiner. */
export function hoechsterBelegter(z: ManagerZustand, art: ManagerArt): number {
  for (let i = z[art].length - 1; i >= 0; i--) if (!istLeer(z[art][i])) return i + 1;
  return 0;
}

/** Leere Plaetze vor dem hoechsten belegten — die zeigte das Menue namenlos. */
export function luecken(z: ManagerZustand, art: ManagerArt): number[] {
  const bis = hoechsterBelegter(z, art);
  const out: number[] = [];
  for (let i = 0; i < bis; i++) if (istLeer(z[art][i])) out.push(i + 1);
  return out;
}

const gleich = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** Alle Plaetze, deren Bytes sich gegen die Basis unterscheiden — fertig zum Verteilen oder Einbrennen. */
export function unterschiede(z: ManagerZustand, basis: ManagerZustand): SammlungsEintrag[] {
  const out: SammlungsEintrag[] = [];
  for (const art of ["ifx", "mfx"] as const) {
    z[art].forEach((bytes, i) => {
      if (!gleich(bytes, basis[art][i])) out.push({ art, platz: i + 1, name: nameVon(bytes), bytes: bytes.slice() });
    });
  }
  return out;
}

/** Alle belegten Plaetze als Sammlung mit Platz. */
export function alsSammlung(z: ManagerZustand): SammlungsEintrag[] {
  const out: SammlungsEintrag[] = [];
  for (const art of ["ifx", "mfx"] as const) {
    z[art].forEach((bytes, i) => {
      if (!istLeer(bytes)) out.push({ art, platz: i + 1, name: nameVon(bytes), bytes: bytes.slice() });
    });
  }
  return out;
}

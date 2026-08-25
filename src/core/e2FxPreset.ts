/**
 * e2FxPreset — der 524-Byte-Block eines FX-Presets im Geraete-RAM: lesen,
 * aendern, zurueckschreiben.
 *
 * Am Geraet waehlt man ein *Preset* mit eigenem Namen („Bit Crusher"), nicht
 * einen Algorithmus. Ein Preset verpackt: bis zu zwei Insert-Effekte plus einen
 * Master-Effekt (je Algorithmus, Ein-/Ausgangspegel und Parameterwerte), zehn
 * Zuordnungen fuer die X/Y-Flaeche und den FX-Knopf, sowie den Namen fuers Menue.
 *
 * Layout (Quelle: bangcorrupt/hacktribe-editor, **AGPL-3.0**,
 * `utils/ht_fx_preset_format.py`; Groove-Struktur zusaetzlich in der Fassung
 * von 13HansSeppaufpepp12. Herkunft und Lizenzfolgen siehe NOTICE):
 *
 * | Offset | Inhalt |
 * |---|---|
 * | 0x001 | Name, 15 Zeichen ASCII, mit Nullen aufgefuellt |
 * | 0x012 | Zuordnungen: 10 Stueck a 28 Byte |
 * | 0x12A | IFX 1: Algorithmus, Ausgangspegel, (2 unbekannt), Kettenplatz, Eingangspegel |
 * | 0x135 | IFX-1-Parameter, je 2 Byte (Wert, Fueller) |
 * | 0x174 | IFX 2 — gleicher Aufbau, Parameter ab 0x17F |
 * | 0x1BE | MFX — gleicher Aufbau, Parameter ab 0x1C9 |
 * | 0x209 | zwei Pegelbytes (0x7F 0x7F), dann ein Fuellbyte |
 *
 * **Unbekannte Bytes bleiben unangetastet.** `encodeFxPreset` schreibt in eine
 * Kopie des gelesenen Blocks; alles, wofuer es hier kein Feld gibt, ueberlebt
 * damit unveraendert. Ohne diese Regel wuerde ein Rueckschreiben stillschweigend
 * Felder plaetten, die wir noch nicht verstanden haben.
 */
import { IFX_TYPES, MFX_TYPES, type FxTypeDef } from "./e2FxParams";

export const FX_PRESET_SIZE = 0x20c;

const NAME_OFF = 0x01;
const NAME_LEN = 0x0f;
const MAP_OFF = 0x12;
const MAP_SLOTS = 10;
const MAP_STRIDE = 28;

/** Kopfdaten und Parameterbeginn je Kettenstufe. */
const STUFEN = {
  ifx1: { kopf: 0x12a, params: 0x135, ende: 0x174 },
  ifx2: { kopf: 0x174, params: 0x17f, ende: 0x1be },
  mfx: { kopf: 0x1be, params: 0x1c9, ende: 0x209 },
} as const;

/**
 * Quellen einer Zuordnung — im Preset-Block anders kodiert als beim
 * NRPN-Senden (dort 0x01–0x0A). Zwei Strukturen, keine konkurrierenden
 * Deutungen; wer sie verwechselt, bricht das Senden.
 */
export const FX_QUELLEN: readonly { wert: number; name: string }[] = [
  { wert: 0x00, name: "— keine —" },
  // Bezeichnungen nach dem Hacktribe-Wiki (MIDI.md, „FX Map source controls"):
  // beim Master-Effekt ist es die X/Y-Flaeche, beim Insert-Effekt der IFX-Regler.
  { wert: 0x41, name: "FX On / XY beruehrt" },
  { wert: 0x42, name: "MFX X / IFX Edit" },
  { wert: 0x43, name: "MFX Y" },
  { wert: 0x44, name: "MFX X oben / IFX Edit oben" },
  { wert: 0x45, name: "MFX X unten (invertiert)" },
  { wert: 0x46, name: "MFX Y oben" },
  { wert: 0x47, name: "MFX Y unten (invertiert)" },
  { wert: 0x48, name: "Taste Part" },
  { wert: 0x49, name: "Taste global" },
  { wert: 0x4a, name: "Play/Start (setzt Maximum)" },
];

/** Ziel einer Zuordnung: welche Stufe der Kette bzw. welcher Pegel. */
export const FX_KETTEN: readonly { wert: number; name: string }[] = [
  { wert: 0x00, name: "IFX 1" },
  { wert: 0x01, name: "IFX 2" },
  { wert: 0x02, name: "MFX" },
  { wert: 0x07, name: "Eingangspegel" },
  { wert: 0x0a, name: "Ausgangspegel" },
];

/**
 * Nur hinter diesen Insert-Algorithmen erlaubt das Geraet einen ZWEITEN
 * Insert-Effekt (Regel aus ht_fx_preset_format.py): Thru, Cheap Comp, Punch,
 * EQ 2-Band, Filter, Acid Driver, Mute.
 */
export const IFX2_FAEHIG: readonly number[] = [0x00, 0x03, 0x04, 0x06, 0x0a, 0x10, 0x27];

export function ifx2Moeglich(ifx1Device: number): boolean {
  return IFX2_FAEHIG.includes(ifx1Device);
}

export interface FxStufe {
  device: number;
  /** Anzeigename des Algorithmus ("" bei unbekannter Kennung) */
  algorithmus: string;
  preLevel: number;
  postLevel: number;
  /** Kettenplatz (0/1/2), wie im Block hinterlegt */
  slotIndex: number;
  params: number[];
  paramNamen: string[];
}

export interface FxZuordnung {
  quelle: number;
  quelleName: string;
  kette: number;
  ketteName: string;
  zielParam: number;
  min: number;
  max: number;
}

export interface FxPreset {
  name: string;
  istMfx: boolean;
  controlMap: FxZuordnung[];
  ifx1: FxStufe;
  ifx2: FxStufe;
  mfx: FxStufe;
}

const nameVon = (liste: readonly { wert: number; name: string }[], wert: number): string =>
  liste.find((e) => e.wert === wert)?.name ?? `0x${wert.toString(16)}`;

function defFuer(device: number, isMfx: boolean): FxTypeDef | undefined {
  return (isMfx ? MFX_TYPES : IFX_TYPES)[device];
}

function leseStufe(b: Uint8Array, stufe: keyof typeof STUFEN, isMfx: boolean): FxStufe {
  const { kopf, params } = STUFEN[stufe];
  const device = b[kopf] ?? 0;
  const def = defFuer(device, isMfx);
  const namen = def?.params ?? [];
  return {
    device,
    algorithmus: def?.name ?? "",
    postLevel: b[kopf + 1] ?? 0,
    slotIndex: b[kopf + 4] ?? 0,
    preLevel: b[kopf + 5] ?? 0,
    params: namen.map((_, k) => b[params + 2 * k] ?? 0),
    paramNamen: [...namen],
  };
}

/** ASCII-Text aus einem Feld, bis zur ersten Null. */
function leseName(b: Uint8Array): string {
  let s = "";
  for (let i = 0; i < NAME_LEN; i++) {
    const c = b[NAME_OFF + i];
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s.replace(/[^\x20-\x7e]/g, "").trimEnd();
}

/**
 * 524-Byte-Block auslesen. `istMfx` waehlt die Algorithmentabelle fuer die
 * MFX-Stufe (die Insert-Stufen nutzen immer die IFX-Tabelle).
 */
export function decodeFxPreset(bytes: Uint8Array, istMfx = false): FxPreset {
  const b = bytes.length >= FX_PRESET_SIZE ? bytes : new Uint8Array(FX_PRESET_SIZE).fill(0).map((_, i) => bytes[i] ?? 0);
  const controlMap: FxZuordnung[] = [];
  for (let i = 0; i < MAP_SLOTS; i++) {
    const o = MAP_OFF + i * MAP_STRIDE;
    const quelle = b[o] ?? 0;
    const kette = b[o + 1] ?? 0;
    controlMap.push({
      quelle,
      quelleName: nameVon(FX_QUELLEN, quelle),
      kette,
      ketteName: nameVon(FX_KETTEN, kette),
      zielParam: b[o + 2] ?? 0,
      min: b[o + 4] ?? 0,
      max: b[o + 6] ?? 0,
    });
  }
  return {
    name: leseName(b),
    istMfx,
    controlMap,
    ifx1: leseStufe(b, "ifx1", false),
    ifx2: leseStufe(b, "ifx2", false),
    mfx: leseStufe(b, "mfx", true),
  };
}

function schreibeStufe(b: Uint8Array, stufe: keyof typeof STUFEN, s: FxStufe, isMfx: boolean): void {
  const { kopf, params, ende } = STUFEN[stufe];
  b[kopf] = s.device & 0xff;
  b[kopf + 1] = s.postLevel & 0xff;
  b[kopf + 4] = s.slotIndex & 0xff;
  b[kopf + 5] = s.preLevel & 0xff;
  // Parameterzahl richtet sich nach dem GEWAEHLTEN Algorithmus, nicht nach der
  // Liste im Objekt — sonst bleiben beim Wechsel Werte des alten Effekts stehen
  const namen = defFuer(s.device, isMfx)?.params ?? [];
  for (let k = 0; k < namen.length; k++) {
    const off = params + 2 * k;
    if (off >= ende) break;
    b[off] = Math.round(s.params[k] ?? 0) & 0xff;
  }
}

/**
 * Preset zurueck in 524 Bytes. `basis` ist der gelesene Block: alles, wofuer es
 * hier kein Feld gibt, wird daraus uebernommen. Ohne Basis entsteht ein
 * Leer-Block.
 */
export function encodeFxPreset(p: FxPreset, basis?: Uint8Array): Uint8Array {
  const b = new Uint8Array(FX_PRESET_SIZE);
  if (basis) b.set(basis.subarray(0, FX_PRESET_SIZE));
  else b.set(initFxPresetBytes());
  // Name: ASCII, 15 Zeichen, Rest genullt
  const name = p.name.replace(/[^\x20-\x7e]/g, "").slice(0, NAME_LEN);
  for (let i = 0; i < NAME_LEN; i++) b[NAME_OFF + i] = i < name.length ? name.charCodeAt(i) : 0;
  for (let i = 0; i < MAP_SLOTS; i++) {
    const o = MAP_OFF + i * MAP_STRIDE;
    const z = p.controlMap[i];
    if (!z) continue;
    b[o] = z.quelle & 0xff;
    b[o + 1] = z.kette & 0xff;
    b[o + 2] = z.zielParam & 0xff;
    b[o + 4] = z.min & 0xff;
    b[o + 6] = z.max & 0xff;
  }
  schreibeStufe(b, "ifx1", p.ifx1, false);
  schreibeStufe(b, "ifx2", p.ifx2, false);
  schreibeStufe(b, "mfx", p.mfx, true);
  return b;
}

/** Leeres Preset: alles Thru, keine Zuordnungen, Pegel wie im Editor-Standard. */
export function initFxPresetBytes(): Uint8Array {
  const b = new Uint8Array(FX_PRESET_SIZE);
  const name = "Init FX";
  for (let i = 0; i < NAME_LEN; i++) b[NAME_OFF + i] = i < name.length ? name.charCodeAt(i) : 0;
  for (const [i, stufe] of (["ifx1", "ifx2", "mfx"] as const).entries()) {
    const { kopf } = STUFEN[stufe];
    b[kopf] = 0x00; // Thru
    b[kopf + 1] = 0x40; // Ausgangspegel
    b[kopf + 2] = 0x3f;
    b[kopf + 3] = 0x40;
    b[kopf + 4] = i; // Kettenplatz
    b[kopf + 5] = 0x7f; // Eingangspegel
  }
  b[0x209] = 0x7f;
  b[0x20a] = 0x7f;
  return b;
}

/**
 * firmwareBau — Presets dauerhaft machen: eine Sammlung in die
 * Hacktribe-Firmware (SYSTEM.VSB) einbrennen.
 *
 * Alles, was TekkForge per RAM-Write aufs Geraet schreibt, ist nach dem
 * Ausschalten weg. Dauerhaft wird es nur im Firmware-Abbild, und das ist
 * einfacher als es klingt: die SYSTEM.VSB ist ein 0x100-Byte-Header plus ein
 * 1:1-Abbild des DDR2 ab 0xC0000000. Belegt am 2026-09-02 an der gepatchten
 * Hacktribe-Datei gegen die Geraetesicherung — die IFX-Bank (RAM 0xC00A80F0)
 * liegt bei Datei-Offset 0xA81F0, die MFX-Bank bei 0xB5030, alle dreizehn
 * Zaehler stehen dort mit 48/49, und Slot 46–99 sind Datei wie RAM byteweise
 * gleich. Eine Pruefsumme ueber den Payload gibt es nicht: hacktribes Patcher
 * schreibt das bsdiff-Ergebnis unveraendert, der Synth-Header-Trick aendert
 * zwei Bytes ohne Nachrechnen.
 *
 *     Datei-Offset = RAM-Adresse − 0xC0000000 + 0x100
 *
 * Das Modul tut genau das, was der RAM-Weg tut, nur in der Datei: jeden
 * Eintrag mit Platz byte-treu ueber die Unterlage des Platzes legen, dann die
 * IFX-Zaehler auf den hoechsten belegten Platz ziehen — mit derselben
 * Luecken- und Stimmigkeitspruefung wie `ifxErweiterung`. Alles ausserhalb
 * dieser Stellen bleibt unangetastet; der Test zaehlt fremde Bytes.
 *
 * Nicht dabei: die vier Groove-Zaehler (`add_groove`). Groove-Vorlagen werden
 * geschrieben, aber hinter dem Werkszaehler bleiben sie unsichtbar.
 *
 * Installation: als `SYSTEM.VSB` nach `KORG/electribe sampler/System/` auf
 * die SD-Karte, dann die Update-Funktion des Geraets. Zurueck geht es mit der
 * unveraenderten Hacktribe-Datei auf demselben Weg.
 *
 * ⚠ Am Geraet noch nicht abgenommen (Stand 2026-09-02).
 */
import { DDR2_BASE, E2_RAM_MAP, addressForSlot, IFX_PRESET_WRITE_MAX, MFX_PRESET_WRITE_MAX } from "./hacktribeRam";
import { IFX_ZAEHLER, leseZaehlerStand, istPresetPlatzLeer, planeIfxErweiterung, type ZaehlerWert } from "./ifxErweiterung";
import { decodeFxPreset, encodeFxPreset, FX_PRESET_SIZE } from "./e2FxPreset";
import { decodeGroove, encodeGroove, GROOVE_SIZE } from "./e2Groove";
import { planeVerteilung, type SammlungsEintrag, type SammlungsArt } from "./sammlung";

/** Der KORG-Header vor dem RAM-Abbild. */
export const VSB_HEADER = 0x100;
/** 2 MiB Payload plus Header — jede andere Groesse ist keine E2-Firmware. */
export const VSB_GROESSE = 0x200000 + VSB_HEADER;
/** hacktribe/hash/hacked-SYSTEM.VSB.sha — die unveraenderte Hacktribe-Firmware. */
export const HACKTRIBE_SHA256 = "7cb4825c184a7e3fa92224304be22a788c96c4b748c277e63a496baa9faae7ee";
/** Ebenfalls aus dem hacktribe-Repo: die Stock-Firmware 2.02, aus der Hacktribe entsteht. */
export const STOCK_SHA256 = "1d0f0689d5a12c8a8bde9f821f2a59adc5f6cd6012ddb201ebb192b72468a646";

export function dateiOffset(ramAddr: number): number {
  return ramAddr - DDR2_BASE + VSB_HEADER;
}

/**
 * Die vier Groove-Zaehler aus hacktribe `add_groove` — zwei auf den
 * Max-Index, zwei auf Max-Index + 1 (0xC007BB88 ist die Read-Quelle). In der
 * gepatchten Firmware stehen sie auf 61/62 bei 62 Werks-Vorlagen.
 */
export const GROOVE_ZAEHLER: readonly { addr: number; plusEins: boolean }[] = [
  { addr: 0xc0049da4, plusEins: false },
  { addr: 0xc007bb90, plusEins: false },
  { addr: 0xc007bb88, plusEins: true },
  { addr: 0xc007bb94, plusEins: true },
];

/**
 * Das Init-Pattern: der Pattern-Block (0x3C00 Bytes, "PTST" … "PTED"), den
 * das Geraet fuer ein neues Pattern nimmt. Datei-Offset aus hacktribe
 * `e2-init-pat.py` (Payload 0xCFF58 + Header), am Abbild belegt: dort steht
 * "PTST". Eine `.e2spat` ist genau dieser Block hinter einem 0x100-Header.
 */
export const INIT_PATTERN_OFFSET = 0xd0058;
export const INIT_PATTERN_GROESSE = 0x3c00;
/** Eine `.e2spat` ist 0x4100 Bytes: 0x100 Header, 0x3C00 Block bis "PTED", 0x400 Nullen. */
export const E2SPAT_GROESSE = 0x4100;

/** Der Startbildschirm: 1024 Bytes 1-Bit, 128 × 64 (hacktribe `ht_splash_screen.py`, Payload 0xF9854). */
export const SPLASH_OFFSET = 0xf9954;
export const SPLASH_GROESSE = 1024;

export type FirmwarePruefung = { ok: true } | { ok: false; reason: string };

/** Groesse, Magic, Geraetekennung — der Hash wird davon getrennt geprueft (siehe Aufrufer). */
export function pruefeFirmware(bytes: Uint8Array): FirmwarePruefung {
  if (bytes.length !== VSB_GROESSE) {
    return { ok: false, reason: `${bytes.length} Bytes — eine E2-Firmware hat ${VSB_GROESSE}` };
  }
  const ascii = (von: number, bis: number): string => String.fromCharCode(...bytes.subarray(von, bis));
  if (ascii(0, 16) !== "KORG SYSTEM FILE") return { ok: false, reason: "Kein KORG-SYSTEM-FILE-Header" };
  if (ascii(0x10, 0x13) !== "E2S" || bytes[0x13] !== 0) {
    return { ok: false, reason: "Geraetekennung ist nicht E2S (Sampler) — nur die Sampler-Firmware kennt diese Adressen" };
  }
  return { ok: true };
}

export interface FirmwareBauBericht {
  geschrieben: { art: SammlungsArt; platz: number; name: string; offset: number }[];
  ifxMaxVorher: number;
  ifxMaxNachher: number;
  zaehler: ZaehlerWert[];
  grooveMaxVorher: number;
  grooveMaxNachher: number;
  grooveZaehler: ZaehlerWert[];
}

/** Eine Groove-Vorlage ist belegt, wenn ihr Rahmen steht — leere Plaetze sind lauter 0xFF. */
export function istGroovePlatzLeer(bytes: Uint8Array): boolean {
  return bytes.length < 4 || !(bytes[0] === 0x47 && bytes[1] === 0x56 && bytes[2] === 0x53 && bytes[3] === 0x54); // "GVST"
}

/** Groove-Zaehler aus dem Abbild lesen — stimmig nur, wenn beide Paare zusammenpassen. */
export function leseGrooveStand(fw: Uint8Array): { ok: true; maxIndex: number } | { ok: false; reason: string } {
  const werte = GROOVE_ZAEHLER.map((z) => ({ ...z, wert: fw[dateiOffset(z.addr)] }));
  const max = werte[0].wert;
  for (const w of werte) {
    const soll = w.plusEins ? max + 1 : max;
    if (w.wert !== soll) {
      return { ok: false, reason: `Groove-Zähler widersprechen sich: 0x${w.addr.toString(16).toUpperCase()} steht auf ${w.wert}, nach Max-Index ${max} müsste dort ${soll} stehen` };
    }
  }
  return { ok: true, maxIndex: max };
}

export type FirmwareBauErgebnis = { ok: true; bytes: Uint8Array; bericht: FirmwareBauBericht } | { ok: false; reason: string };

const mapFuer = (art: SammlungsArt) => E2_RAM_MAP.find((e) => e.key === (art === "groove" ? "groove" : art === "mfx" ? "mfxPreset" : "ifxPreset"))!;
const schreibMax = (art: SammlungsArt): number => (art === "groove" ? mapFuer("groove").count - 1 : art === "mfx" ? MFX_PRESET_WRITE_MAX : IFX_PRESET_WRITE_MAX);

/**
 * Baut aus `basis` (unveraendert zurueckgegeben) ein neues Abbild mit den
 * Eintraegen der Sammlung. Jeder Eintrag braucht einen Platz; doppelte
 * Plaetze, Luecken hinter dem Zaehler und ein unstimmiger Zaehlersatz
 * liefern einen Grund statt einer halben Datei.
 */
export function baueFirmware(basis: Uint8Array, eintraege: readonly SammlungsEintrag[]): FirmwareBauErgebnis {
  const pruefung = pruefeFirmware(basis);
  if (!pruefung.ok) return pruefung;
  const plan = planeVerteilung(eintraege);
  if (plan.doppelt.length) {
    return { ok: false, reason: `Doppelt vergeben: ${plan.doppelt.map((d) => `Platz ${d.platz} (${d.art.toUpperCase()})`).join(", ")}` };
  }
  if (plan.uebersprungen.length) {
    return { ok: false, reason: `${plan.uebersprungen.length} Eintrag/Einträge ohne Platz — in eine Firmware gehört nur, was einen Platz hat` };
  }
  if (!plan.schritte.length) return { ok: false, reason: "Die Sammlung ist leer" };

  const out = basis.slice();
  const bericht: FirmwareBauBericht = {
    geschrieben: [],
    ifxMaxVorher: -1,
    ifxMaxNachher: -1,
    zaehler: [],
    grooveMaxVorher: -1,
    grooveMaxNachher: -1,
    grooveZaehler: [],
  };

  for (const { eintrag } of plan.schritte) {
    const platz = eintrag.platz!;
    if (platz - 1 > schreibMax(eintrag.art)) {
      return { ok: false, reason: `„${eintrag.name}“: Platz ${platz} liegt über der Schreibgrenze (${eintrag.art.toUpperCase()} bis ${schreibMax(eintrag.art) + 1})` };
    }
    const offset = dateiOffset(addressForSlot(mapFuer(eintrag.art), platz - 1));
    const len = eintrag.art === "groove" ? GROOVE_SIZE : FX_PRESET_SIZE;
    const unterlage = out.subarray(offset, offset + len);
    // Unterlage nur, wenn dort schon etwas steht: ein leerer Groove-Platz ist
    // lauter 0xFF und traegt weder Rahmen noch Step-Tabelle — darueber gelegt
    // fehlte dem Block das "GVST".
    const bytes =
      eintrag.art === "groove"
        ? encodeGroove(decodeGroove(eintrag.bytes), istGroovePlatzLeer(unterlage) ? undefined : unterlage)
        : encodeFxPreset(decodeFxPreset(eintrag.bytes, eintrag.art === "mfx"), unterlage);
    if (bytes.length !== len) return { ok: false, reason: `„${eintrag.name}“: ${bytes.length} statt ${len} Bytes` };
    out.set(bytes, offset);
    bericht.geschrieben.push({ art: eintrag.art, platz, name: eintrag.name, offset });
  }

  // IFX-Zaehler: lesen, pruefen, nur bei Bedarf nachziehen.
  const gelesen: ZaehlerWert[] = IFX_ZAEHLER.map((z) => ({ addr: z.addr, wert: out[dateiOffset(z.addr)] }));
  const stand = leseZaehlerStand(gelesen);
  if (!stand.ok) return { ok: false, reason: `IFX-Zähler in der Firmware: ${stand.reason}` };
  bericht.ifxMaxVorher = stand.maxIndex;
  bericht.ifxMaxNachher = stand.maxIndex;
  const ifxMap = mapFuer("ifx");
  const hoechster = Math.max(-1, ...bericht.geschrieben.filter((g) => g.art === "ifx").map((g) => g.platz - 1));
  if (hoechster > stand.maxIndex) {
    const erweiterung = planeIfxErweiterung(stand.maxIndex, hoechster, (slot) => {
      const off = dateiOffset(addressForSlot(ifxMap, slot));
      return istPresetPlatzLeer(out.subarray(off, off + FX_PRESET_SIZE));
    });
    if (!erweiterung.ok) return { ok: false, reason: erweiterung.reason };
    for (const w of erweiterung.schreiben) out[dateiOffset(w.addr)] = w.wert;
    bericht.zaehler = erweiterung.schreiben;
    bericht.ifxMaxNachher = hoechster;
  }

  // Groove-Zaehler: dieselbe Regel — lueckenlos bis zum hoechsten belegten Platz.
  const grooveStand = leseGrooveStand(out);
  if (!grooveStand.ok) return { ok: false, reason: grooveStand.reason };
  bericht.grooveMaxVorher = grooveStand.maxIndex;
  bericht.grooveMaxNachher = grooveStand.maxIndex;
  const grooveMap = mapFuer("groove");
  const hoechsterGroove = Math.max(-1, ...bericht.geschrieben.filter((g) => g.art === "groove").map((g) => g.platz - 1));
  if (hoechsterGroove > grooveStand.maxIndex) {
    const luecken: number[] = [];
    for (let slot = grooveStand.maxIndex + 1; slot <= hoechsterGroove; slot++) {
      const off = dateiOffset(addressForSlot(grooveMap, slot));
      if (istGroovePlatzLeer(out.subarray(off, off + GROOVE_SIZE))) luecken.push(slot + 1);
    }
    if (luecken.length) {
      return { ok: false, reason: `Groove-Bereich hat Lücken hinter dem Zähler: Platz ${luecken.join(", ")} leer — erst dort eine Vorlage ablegen` };
    }
    bericht.grooveZaehler = GROOVE_ZAEHLER.map((z) => ({ addr: z.addr, wert: z.plusEins ? hoechsterGroove + 1 : hoechsterGroove }));
    for (const w of bericht.grooveZaehler) out[dateiOffset(w.addr)] = w.wert;
    bericht.grooveMaxNachher = hoechsterGroove;
  }
  return { ok: true, bytes: out, bericht };
}

// ─── Basis-Pruefung ──────────────────────────────────────────────────────────

export interface BasisBefund {
  ok: boolean;
  reason?: string;
  /** IFX-Max-Index laut Zaehler, Groove-Max-Index, Name des Init-Patterns. */
  ifxMaxIndex: number;
  grooveMaxIndex: number;
  initPatternName: string;
}

/**
 * Taugt die Datei als Basis? Header, stimmige IFX- und Groove-Zaehler und ein
 * "PTST" an der Init-Pattern-Stelle — das haelt auch eine schon von TekkForge
 * gepatchte Firmware, die naechste Runde baut dann darauf auf. Den
 * Hacktribe-Hash prueft der Aufrufer getrennt, wenn er ihn verlangen will.
 */
export function pruefeBasis(fw: Uint8Array): BasisBefund {
  const leer = { ifxMaxIndex: -1, grooveMaxIndex: -1, initPatternName: "" };
  const pr = pruefeFirmware(fw);
  if (!pr.ok) return { ok: false, reason: pr.reason, ...leer };
  const ifx = leseZaehlerStand(IFX_ZAEHLER.map((z) => ({ addr: z.addr, wert: fw[dateiOffset(z.addr)] })));
  if (!ifx.ok) return { ok: false, reason: `IFX-Zähler: ${ifx.reason}`, ...leer };
  const gv = leseGrooveStand(fw);
  if (!gv.ok) return { ok: false, reason: gv.reason, ...leer, ifxMaxIndex: ifx.maxIndex };
  const magic = String.fromCharCode(...fw.subarray(INIT_PATTERN_OFFSET, INIT_PATTERN_OFFSET + 4));
  if (magic !== "PTST") return { ok: false, reason: `An der Init-Pattern-Stelle steht „${magic}“ statt „PTST“`, ...leer, ifxMaxIndex: ifx.maxIndex, grooveMaxIndex: gv.maxIndex };
  let name = "";
  for (let i = 0; i < 16; i++) {
    const c = fw[INIT_PATTERN_OFFSET + 0x10 + i];
    if (!c) break;
    name += String.fromCharCode(c);
  }
  return { ok: true, ifxMaxIndex: ifx.maxIndex, grooveMaxIndex: gv.maxIndex, initPatternName: name.trim() };
}

// ─── Init-Pattern und Startbildschirm ────────────────────────────────────────

/** Das Init-Pattern als vollstaendige `.e2spat` (KORG-Header + Block), ladbar wie jede Pattern-Datei. */
export function liesInitPattern(fw: Uint8Array): Uint8Array {
  const pr = pruefeFirmware(fw);
  if (!pr.ok) throw new Error(pr.reason);
  const out = new Uint8Array(E2SPAT_GROESSE);
  out.fill(0xff, 0x24, 0x100);
  out.set(new TextEncoder().encode("KORG"), 0);
  out.set(new TextEncoder().encode("e2sampler"), 0x10);
  out[0x20] = 1; // version u32 LE = 1
  out.set(fw.subarray(INIT_PATTERN_OFFSET, INIT_PATTERN_OFFSET + INIT_PATTERN_GROESSE), 0x100);
  return out;
}

/** Eine `.e2spat` (oder ihr nackter Block) als Init-Pattern einbrennen — liefert ein neues Abbild. */
export function setzeInitPattern(fw: Uint8Array, pattern: Uint8Array): Uint8Array {
  const pr = pruefeFirmware(fw);
  if (!pr.ok) throw new Error(pr.reason);
  let block: Uint8Array;
  if (pattern.length === E2SPAT_GROESSE) block = pattern.subarray(0x100, 0x100 + INIT_PATTERN_GROESSE);
  else if (pattern.length === INIT_PATTERN_GROESSE) block = pattern;
  else throw new Error(`${pattern.length} Bytes — eine .e2spat hat ${E2SPAT_GROESSE}, der Block ${INIT_PATTERN_GROESSE}`);
  const magic = String.fromCharCode(...block.subarray(0, 4));
  if (magic !== "PTST") throw new Error(`Kein Pattern-Block (erwartet „PTST“, gefunden „${magic}“)`);
  const out = fw.slice();
  out.set(block, INIT_PATTERN_OFFSET);
  return out;
}

export function liesSplash(fw: Uint8Array): Uint8Array {
  const pr = pruefeFirmware(fw);
  if (!pr.ok) throw new Error(pr.reason);
  return fw.slice(SPLASH_OFFSET, SPLASH_OFFSET + SPLASH_GROESSE);
}

export function setzeSplash(fw: Uint8Array, splash: Uint8Array): Uint8Array {
  const pr = pruefeFirmware(fw);
  if (!pr.ok) throw new Error(pr.reason);
  if (splash.length !== SPLASH_GROESSE) throw new Error(`${splash.length} Bytes — der Startbildschirm hat ${SPLASH_GROESSE}`);
  const out = fw.slice();
  out.set(splash, SPLASH_OFFSET);
  return out;
}

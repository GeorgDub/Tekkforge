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
 * Dazu, nach demselben Muster: die vier Groove-Zaehler (`add_groove`), das
 * Init-Pattern, der Startbildschirm und der Init-Global-Block — alle Stellen
 * aus der RAM-Karte abgeleitet, damit es nur eine Quelle gibt. Und
 * `firmwareAusSicherung`, das eine ganze Geraetesicherung in die Basis legt.
 *
 * Installation: als `SYSTEM.VSB` nach `KORG/electribe sampler/System/` auf
 * die SD-Karte, dann die Update-Funktion des Geraets. Zurueck geht es mit der
 * unveraenderten Hacktribe-Datei auf demselben Weg.
 *
 * ✔ Preset-Weg am Geraet abgenommen (2026-09-02, Plaetze 50–96). Grooves,
 * Init-Pattern, Startbild und Init-Global sind am Geraet noch offen.
 */
import { E2_RAM_MAP, addressForSlot, IFX_PRESET_WRITE_MAX, MFX_PRESET_WRITE_MAX } from "./hacktribeRam";
import { IFX_ZAEHLER, istPresetPlatzLeer, planeIfxErweiterung, zaehlerSchreibliste, type ZaehlerWert } from "./ifxErweiterung";
import {
  KARTE_HACKTRIBE,
  GROOVE_ZAEHLER,
  HACKTRIBE_SHA256,
  SAMPLER_STOCK_SHA256,
  VSB_HEADER,
  dateiOffset,
  erkenneKarte,
  grooveOffset,
  leseZaehler,
  presetOffset,
  presetBlockMitName,
  type FirmwareKarte,
} from "./firmwareKarte";
import { decodeFxPreset, encodeFxPreset, FX_PRESET_SIZE } from "./e2FxPreset";
import { decodeGroove, encodeGroove, GROOVE_SIZE } from "./e2Groove";
import { planeVerteilung, type SammlungsEintrag, type SammlungsArt } from "./sammlung";

/** Der KORG-Header vor dem RAM-Abbild. */
export { VSB_HEADER, dateiOffset, GROOVE_ZAEHLER, HACKTRIBE_SHA256 };
/** 2 MiB Payload plus Header — jede andere Groesse ist keine E2-Firmware. */
export const VSB_GROESSE = 0x200000 + VSB_HEADER;
/** Ebenfalls aus dem hacktribe-Repo: die Stock-Firmware 2.02, aus der Hacktribe entsteht. */
export const STOCK_SHA256 = SAMPLER_STOCK_SHA256;

/**
 * Seit v0.7 kennt jede Funktion hier eine Karte (`firmwareKarte.ts`):
 * Hacktribe (Vorgabe — alles wie bisher, byte-genau), Sampler-Stock,
 * Synth-Stock. Wer keine Karte uebergibt, bekommt die Hacktribe-Lage; wer
 * eine fremde Datei hat, laesst sie mit `erkenneKarte` bestimmen und reicht
 * die Karte durch. Die festen Offsets unten bleiben als Hacktribe-Konstanten
 * fuer die bestehenden Aufrufer und Tests.
 */

/**
 * Das Init-Pattern: der Pattern-Block (0x3C00 Bytes, "PTST" … "PTED"), den
 * das Geraet fuer ein neues Pattern nimmt. Datei-Offset aus hacktribe
 * `e2-init-pat.py` (Payload 0xCFF58 + Header), am Abbild belegt: dort steht
 * "PTST". Eine `.e2spat` ist genau dieser Block hinter einem 0x100-Header.
 */
export const INIT_PATTERN_OFFSET = dateiOffset(E2_RAM_MAP.find((e) => e.key === "initPattern")!.base); // 0xD0058
export const INIT_PATTERN_GROESSE = 0x3c00;
/** Eine `.e2spat` ist 0x4100 Bytes: 0x100 Header, 0x3C00 Block bis "PTED", 0x400 Nullen. */
export const E2SPAT_GROESSE = 0x4100;

/** Der Startbildschirm: 1024 Bytes 1-Bit, 128 × 64 (hacktribe `ht_splash_screen.py`, Payload 0xF9854). */
export const SPLASH_OFFSET = dateiOffset(E2_RAM_MAP.find((e) => e.key === "splash")!.base); // 0xF9954
export const SPLASH_GROESSE = 1024;

/**
 * Der Init-Global-Block: 256 Bytes „GLST" … „GLED", direkt vor dem
 * Init-Pattern (am Abbild gefunden, 2026-09-03: GLST bei 0xCFF58, GLED bei
 * 0xD0054). Dasselbe Format wie der Global-Dump (`e2sysex.decodeGlobalDump`) —
 * MIDI-Kanal, Clock-Quelle, Chain Mode, Filter, Kontrast … als Werksstand.
 * ⚠ Ob das Geraet diesen Block beim Werksreset nimmt oder als laufenden
 * Global-Stand, ist am Geraet noch nicht geprueft.
 */
export const INIT_GLOBAL_OFFSET = dateiOffset(E2_RAM_MAP.find((e) => e.key === "initGlobal")!.base); // 0xCFF58
export const INIT_GLOBAL_GROESSE = 0x100;

export type FirmwarePruefung = { ok: true } | { ok: false; reason: string };

/**
 * Groesse, Magic, Geraetekennung — der Hash wird davon getrennt geprueft
 * (siehe Aufrufer). Mit der Hacktribe-Karte (Vorgabe) gilt das bisherige
 * E2S-Gate am Kopf; mit einer anderen Karte zaehlt das PAYLOAD-Layout
 * (`erkenneKarte`), damit auch ein umgekoepftes Abbild durchkommt.
 */
export function pruefeFirmware(bytes: Uint8Array, karte: FirmwareKarte = KARTE_HACKTRIBE): FirmwarePruefung {
  if (bytes.length !== VSB_GROESSE) {
    return { ok: false, reason: `${bytes.length} Bytes — eine E2-Firmware hat ${VSB_GROESSE}` };
  }
  const ascii = (von: number, bis: number): string => String.fromCharCode(...bytes.subarray(von, bis));
  if (ascii(0, 16) !== "KORG SYSTEM FILE") return { ok: false, reason: "Kein KORG-SYSTEM-FILE-Header" };
  if (karte.id === "hacktribe") {
    if (ascii(0x10, 0x13) !== "E2S" || bytes[0x13] !== 0) {
      return { ok: false, reason: "Geraetekennung ist nicht E2S (Sampler) — nur die Sampler-Firmware kennt diese Adressen" };
    }
    return { ok: true };
  }
  const e = erkenneKarte(bytes);
  if (!e.ok) return { ok: false, reason: e.reason };
  if (e.karte.id !== karte.id) return { ok: false, reason: `Das Abbild ist „${e.karte.label}“, die Karte verlangt „${karte.label}“` };
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

/** Streng: ein UNBESCHRIEBENER Groove-Platz, wie das Geraet ihn haelt — lauter 0xFF, nichts anderes. */
export function istGrooveBlockUnbeschrieben(bytes: Uint8Array): boolean {
  return bytes.length === GROOVE_SIZE && bytes.every((b) => b === 0xff);
}

/** So sieht ein leerer Groove-Platz auf dem Geraet aus. */
export function leererGrooveBlock(): Uint8Array {
  return new Uint8Array(GROOVE_SIZE).fill(0xff);
}

/** Groove-Zaehler aus dem Abbild lesen — stimmig nur, wenn beide Paare zusammenpassen. */
export function leseGrooveStand(fw: Uint8Array, karte: FirmwareKarte = KARTE_HACKTRIBE): { ok: true; maxIndex: number } | { ok: false; reason: string } {
  if (!karte.grooveZaehler) return { ok: false, reason: `${karte.label} hat keine Groove-Bank` };
  const r = leseZaehler(fw, karte.grooveZaehler);
  return r.ok ? r : { ok: false, reason: `Groove-${r.reason}` };
}

export type FirmwareBauErgebnis = { ok: true; bytes: Uint8Array; bericht: FirmwareBauBericht } | { ok: false; reason: string };

const mapFuer = (art: SammlungsArt) => E2_RAM_MAP.find((e) => e.key === (art === "groove" ? "groove" : art === "mfx" ? "mfxPreset" : "ifxPreset"))!;
const schreibMax = (art: SammlungsArt, karte: FirmwareKarte): number =>
  art === "groove" ? (karte.grooveBank?.count ?? 0) - 1 : art === "mfx" ? karte.mfxSchreibMax : karte.ifxSchreibMax;
/** Datei-Offset eines Platzes (0-basiert) in dieser Karte — null, wenn es ihn nicht gibt. */
const platzOffset = (karte: FirmwareKarte, fw: Uint8Array, art: SammlungsArt, slot: number): number | null =>
  art === "groove" ? grooveOffset(karte, slot) : presetOffset(karte, fw, art, slot);

/**
 * Baut aus `basis` (unveraendert zurueckgegeben) ein neues Abbild mit den
 * Eintraegen der Sammlung. Jeder Eintrag braucht einen Platz; doppelte
 * Plaetze, Luecken hinter dem Zaehler und ein unstimmiger Zaehlersatz
 * liefern einen Grund statt einer halben Datei.
 */
export function baueFirmware(basis: Uint8Array, eintraege: readonly SammlungsEintrag[], karte: FirmwareKarte = KARTE_HACKTRIBE): FirmwareBauErgebnis {
  const pruefung = pruefeFirmware(basis, karte);
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
    if (eintrag.art === "groove" && !karte.grooveBank) {
      return { ok: false, reason: `„${eintrag.name}“: ${karte.label} hat keine Groove-Bank — Grooves gehen nur in die Hacktribe-Firmware` };
    }
    if (platz - 1 > schreibMax(eintrag.art, karte)) {
      return { ok: false, reason: `„${eintrag.name}“: Platz ${platz} liegt über der Schreibgrenze (${eintrag.art.toUpperCase()} bis ${schreibMax(eintrag.art, karte) + 1})` };
    }
    const offset = platzOffset(karte, out, eintrag.art, platz - 1);
    if (offset === null) return { ok: false, reason: `„${eintrag.name}“: Platz ${platz} (${eintrag.art.toUpperCase()}) hat in ${karte.label} keinen Block` };
    const len = eintrag.art === "groove" ? GROOVE_SIZE : FX_PRESET_SIZE;
    const unterlage = out.subarray(offset, offset + len);
    // Stock-Karten: der Zeiger wird nicht blind geglaubt — dort, wo er hinfuehrt,
    // muss ein Preset-Block mit Namen liegen (so haelt Stock alle 38/32). Ein
    // verbogener Zeiger wuerde sonst 524 Bytes auf Code legen.
    if (eintrag.art !== "groove" && !(eintrag.art === "ifx" ? karte.ifxBank : karte.mfxBank) && !presetBlockMitName(unterlage)) {
      return { ok: false, reason: `„${eintrag.name}“: der Zeiger für ${eintrag.art.toUpperCase()}-Platz ${platz} führt auf keinen Preset-Block (0x${offset.toString(16).toUpperCase()}) — Abbild verändert? Nichts geschrieben.` };
    }
    // Unterlage nur, wenn dort schon etwas steht: ein leerer Groove-Platz ist
    // lauter 0xFF und traegt weder Rahmen noch Step-Tabelle — darueber gelegt
    // fehlte dem Block das "GVST". Und ein LEERER Eintrag (geloeschter Platz aus
    // dem Manager) wird als 0xFF-Block geschrieben, nicht durch den Groove-
    // Kodierer gedreht — der macht aus 0xFF sonst einen namenlosen Phantom-Groove.
    let bytes: Uint8Array;
    if (eintrag.art === "groove") {
      bytes = istGroovePlatzLeer(eintrag.bytes)
        ? leererGrooveBlock()
        : encodeGroove(decodeGroove(eintrag.bytes), istGroovePlatzLeer(unterlage) ? undefined : unterlage);
    } else {
      bytes = encodeFxPreset(decodeFxPreset(eintrag.bytes, eintrag.art === "mfx"), unterlage);
    }
    if (bytes.length !== len) return { ok: false, reason: `„${eintrag.name}“: ${bytes.length} statt ${len} Bytes` };
    out.set(bytes, offset);
    bericht.geschrieben.push({ art: eintrag.art, platz, name: eintrag.name, offset });
  }

  // IFX-Zaehler: lesen, pruefen, nur bei Bedarf nachziehen. Bei einer Karte
  // ohne erweiterbares Menue (Stock: 38 feste Plaetze ueber Zeiger) bleiben
  // die Zaehler unangetastet — dort wird nur ersetzt, nie angehaengt.
  const stand = leseZaehler(out, karte.ifxZaehler);
  if (!stand.ok) return { ok: false, reason: `IFX-Zähler in der Firmware: ${stand.reason}` };
  bericht.ifxMaxVorher = stand.maxIndex;
  bericht.ifxMaxNachher = stand.maxIndex;
  // Das Menue folgt der BANK, nicht den geschriebenen Eintraegen: Zaehler auf
  // den hoechsten belegten Platz im Abbild — nach oben mit Lueckenpruefung,
  // nach unten, wenn das oberste Preset geleert wurde (sonst bliebe ein
  // namenloser Eintrag im Menue). Angefasst wird nur, was der Bau beruehrt hat.
  const hoechsterBelegtImAbbild = (art: SammlungsArt, bis: number): number => {
    const len = art === "groove" ? GROOVE_SIZE : FX_PRESET_SIZE;
    for (let slot = bis; slot >= 0; slot--) {
      const off = platzOffset(karte, out, art, slot);
      if (off === null) continue;
      const block = out.subarray(off, off + len);
      if (art === "groove" ? !istGroovePlatzLeer(block) : !istPresetPlatzLeer(block)) return slot;
    }
    return -1;
  };
  const beruehrt = (art: SammlungsArt): boolean => bericht.geschrieben.some((g) => g.art === art);
  if (karte.ifxErweiterbar) {
    const hoechster = beruehrt("ifx") ? hoechsterBelegtImAbbild("ifx", karte.ifxSchreibMax) : stand.maxIndex;
    if (hoechster > stand.maxIndex) {
      const erweiterung = planeIfxErweiterung(stand.maxIndex, hoechster, (slot) => {
        const off = platzOffset(karte, out, "ifx", slot);
        return off === null || istPresetPlatzLeer(out.subarray(off, off + FX_PRESET_SIZE));
      });
      if (!erweiterung.ok) return { ok: false, reason: erweiterung.reason };
      for (const w of erweiterung.schreiben) out[dateiOffset(w.addr)] = w.wert;
      bericht.zaehler = erweiterung.schreiben;
      bericht.ifxMaxNachher = hoechster;
    } else if (hoechster >= 0 && hoechster < stand.maxIndex) {
      bericht.zaehler = zaehlerSchreibliste(hoechster);
      for (const w of bericht.zaehler) out[dateiOffset(w.addr)] = w.wert;
      bericht.ifxMaxNachher = hoechster;
    }
  }

  // Groove-Zaehler: dieselbe Regel — lueckenlos bis zum hoechsten belegten Platz.
  if (karte.grooveBank && karte.grooveZaehler) {
    const grooveStand = leseGrooveStand(out, karte);
    if (!grooveStand.ok) return { ok: false, reason: grooveStand.reason };
    bericht.grooveMaxVorher = grooveStand.maxIndex;
    bericht.grooveMaxNachher = grooveStand.maxIndex;
    const grooveZaehler = karte.grooveZaehler;
    const hoechsterGroove = beruehrt("groove") ? hoechsterBelegtImAbbild("groove", karte.grooveBank.count - 1) : grooveStand.maxIndex;
    if (hoechsterGroove >= 0 && hoechsterGroove < grooveStand.maxIndex) {
      bericht.grooveZaehler = grooveZaehler.map((z) => ({ addr: z.addr, wert: z.plusEins ? hoechsterGroove + 1 : hoechsterGroove }));
      for (const w of bericht.grooveZaehler) out[dateiOffset(w.addr)] = w.wert;
      bericht.grooveMaxNachher = hoechsterGroove;
    } else if (hoechsterGroove > grooveStand.maxIndex) {
      const luecken: number[] = [];
      for (let slot = grooveStand.maxIndex + 1; slot <= hoechsterGroove; slot++) {
        const off = grooveOffset(karte, slot)!;
        if (istGroovePlatzLeer(out.subarray(off, off + GROOVE_SIZE))) luecken.push(slot + 1);
      }
      if (luecken.length) {
        return { ok: false, reason: `Groove-Bereich hat Lücken hinter dem Zähler: Platz ${luecken.join(", ")} leer — erst dort eine Vorlage ablegen` };
      }
      bericht.grooveZaehler = grooveZaehler.map((z) => ({ addr: z.addr, wert: z.plusEins ? hoechsterGroove + 1 : hoechsterGroove }));
      for (const w of bericht.grooveZaehler) out[dateiOffset(w.addr)] = w.wert;
      bericht.grooveMaxNachher = hoechsterGroove;
    }
  }
  return { ok: true, bytes: out, bericht };
}

// ─── Basis-Pruefung ──────────────────────────────────────────────────────────

export interface BasisBefund {
  ok: boolean;
  reason?: string;
  /** IFX-Max-Index laut Zaehler, Groove-Max-Index (-1 ohne Groove-Bank), Name des Init-Patterns. */
  ifxMaxIndex: number;
  grooveMaxIndex: number;
  initPatternName: string;
  /** Die Karte, mit der geprueft wurde. */
  karte: FirmwareKarte;
}

/**
 * Taugt die Datei als Basis? Header, stimmige IFX- und Groove-Zaehler und ein
 * "PTST" an der Init-Pattern-Stelle — das haelt auch eine schon von TekkForge
 * gepatchte Firmware, die naechste Runde baut dann darauf auf. Den
 * Hacktribe-Hash prueft der Aufrufer getrennt, wenn er ihn verlangen will.
 */
export function pruefeBasis(fw: Uint8Array, karte: FirmwareKarte = KARTE_HACKTRIBE): BasisBefund {
  const leer = { ifxMaxIndex: -1, grooveMaxIndex: -1, initPatternName: "", karte };
  const pr = pruefeFirmware(fw, karte);
  if (!pr.ok) return { ok: false, reason: pr.reason, ...leer };
  const ifx = leseZaehler(fw, karte.ifxZaehler);
  if (!ifx.ok) return { ok: false, reason: `IFX-Zähler: ${ifx.reason}`, ...leer };
  let grooveMaxIndex = -1;
  if (karte.grooveZaehler) {
    const gv = leseGrooveStand(fw, karte);
    if (!gv.ok) return { ok: false, reason: gv.reason, ...leer, ifxMaxIndex: ifx.maxIndex };
    grooveMaxIndex = gv.maxIndex;
  }
  const initOff = dateiOffset(karte.initPattern);
  const magic = String.fromCharCode(...fw.subarray(initOff, initOff + 4));
  if (magic !== "PTST") return { ok: false, reason: `An der Init-Pattern-Stelle steht „${magic}“ statt „PTST“`, ...leer, ifxMaxIndex: ifx.maxIndex, grooveMaxIndex };
  let name = "";
  for (let i = 0; i < 16; i++) {
    const c = fw[initOff + 0x10 + i];
    if (!c) break;
    name += String.fromCharCode(c);
  }
  return { ok: true, ifxMaxIndex: ifx.maxIndex, grooveMaxIndex, initPatternName: name.trim(), karte };
}

// ─── Init-Pattern und Startbildschirm ────────────────────────────────────────

/** Das Init-Pattern als vollstaendige `.e2spat` (KORG-Header + Block), ladbar wie jede Pattern-Datei. */
export function liesInitPattern(fw: Uint8Array, karte: FirmwareKarte = KARTE_HACKTRIBE): Uint8Array {
  const pr = pruefeFirmware(fw, karte);
  if (!pr.ok) throw new Error(pr.reason);
  const off = dateiOffset(karte.initPattern);
  return patternAlsDatei(fw.subarray(off, off + INIT_PATTERN_GROESSE), karte);
}

/** Einen nackten 0x3C00-Block als `.e2spat`/`.e2pat` verpacken (KORG-Kopf, Kennung der Karte, Version 1). */
export function patternAlsDatei(block: Uint8Array, karte: FirmwareKarte = KARTE_HACKTRIBE): Uint8Array {
  const out = new Uint8Array(E2SPAT_GROESSE);
  out.fill(0xff, 0x24, 0x100);
  out.set(new TextEncoder().encode("KORG"), 0);
  out.set(new TextEncoder().encode(karte.patternKennung), 0x10);
  out[0x20] = 1; // version u32 LE = 1
  out.set(block.subarray(0, INIT_PATTERN_GROESSE), 0x100);
  return out;
}

/** Eine `.e2spat` (oder ihr nackter Block) als Init-Pattern einbrennen — liefert ein neues Abbild. */
export function setzeInitPattern(fw: Uint8Array, pattern: Uint8Array, karte: FirmwareKarte = KARTE_HACKTRIBE): Uint8Array {
  const pr = pruefeFirmware(fw, karte);
  if (!pr.ok) throw new Error(pr.reason);
  let block: Uint8Array;
  if (pattern.length === E2SPAT_GROESSE) block = pattern.subarray(0x100, 0x100 + INIT_PATTERN_GROESSE);
  else if (pattern.length === INIT_PATTERN_GROESSE) block = pattern;
  else throw new Error(`${pattern.length} Bytes — eine .e2spat hat ${E2SPAT_GROESSE}, der Block ${INIT_PATTERN_GROESSE}`);
  const magic = String.fromCharCode(...block.subarray(0, 4));
  if (magic !== "PTST") throw new Error(`Kein Pattern-Block (erwartet „PTST“, gefunden „${magic}“)`);
  const out = fw.slice();
  out.set(block, dateiOffset(karte.initPattern));
  return out;
}

const splashOffset = (karte: FirmwareKarte): number => {
  if (karte.splash === undefined) throw new Error(`${karte.label}: die Lage des Startbilds ist nicht bekannt`);
  return dateiOffset(karte.splash);
};

export function liesSplash(fw: Uint8Array, karte: FirmwareKarte = KARTE_HACKTRIBE): Uint8Array {
  const pr = pruefeFirmware(fw, karte);
  if (!pr.ok) throw new Error(pr.reason);
  const off = splashOffset(karte);
  return fw.slice(off, off + SPLASH_GROESSE);
}

export function setzeSplash(fw: Uint8Array, splash: Uint8Array, karte: FirmwareKarte = KARTE_HACKTRIBE): Uint8Array {
  const pr = pruefeFirmware(fw, karte);
  if (!pr.ok) throw new Error(pr.reason);
  if (splash.length !== SPLASH_GROESSE) throw new Error(`${splash.length} Bytes — der Startbildschirm hat ${SPLASH_GROESSE}`);
  const out = fw.slice();
  out.set(splash, splashOffset(karte));
  return out;
}

const istGlobalBlock = (b: Uint8Array): boolean =>
  b.length === INIT_GLOBAL_GROESSE &&
  String.fromCharCode(...b.subarray(0, 4)) === "GLST" &&
  String.fromCharCode(...b.subarray(0xfc, 0x100)) === "GLED";

export function liesInitGlobal(fw: Uint8Array, karte: FirmwareKarte = KARTE_HACKTRIBE): Uint8Array {
  const pr = pruefeFirmware(fw, karte);
  if (!pr.ok) throw new Error(pr.reason);
  const off = dateiOffset(karte.initGlobal);
  return fw.slice(off, off + INIT_GLOBAL_GROESSE);
}

/** Einen Global-Block (256 B, GLST … GLED — wie der Global-Dump des Geraets) als Werksstand einbrennen. */
export function setzeInitGlobal(fw: Uint8Array, block: Uint8Array, karte: FirmwareKarte = KARTE_HACKTRIBE): Uint8Array {
  const pr = pruefeFirmware(fw, karte);
  if (!pr.ok) throw new Error(pr.reason);
  if (!istGlobalBlock(block)) throw new Error(`Kein Global-Block (${block.length} Bytes, erwartet ${INIT_GLOBAL_GROESSE} mit „GLST“ … „GLED“)`);
  const out = fw.slice();
  out.set(block, dateiOffset(karte.initGlobal));
  return out;
}

// ─── Den ganzen Geraetestand einbrennen ──────────────────────────────────────

export interface SicherungsBauBericht {
  /** Welche Bereiche der Sicherung uebernommen wurden, mit Byte-Zahl. */
  bereiche: { key: string; bytes: number }[];
  /** Was der Sicherung fehlte und deshalb aus der Basis bleibt. */
  fehlend: string[];
  ifxMaxIndex: number;
  grooveMaxIndex: number;
}

/**
 * Alles, was eine Geraetesicherung an Dateninhalt traegt, in die Basis legen:
 * die IFX- und MFX-Baenke (schreibbare Plaetze), die Groove-Bank, das
 * Init-Pattern, der Startbildschirm — und die Zaehler so, wie sie das Geraet
 * hatte (IFX: alle dreizehn aus dem einen Max-Index abgeleitet; Groove: alle
 * vier aus der Anzahl). Das ist der Weg, den Stand, den man sich im RAM
 * zusammengebaut und gehoert hat, als Ganzes dauerhaft zu machen.
 *
 * Keine Lueckenpruefung: die Sicherung ist der Stand, den das Geraet gezeigt
 * hat, und genau der soll wiederkommen. Aeltere Sicherungen ohne Groove-
 * Zaehler, Init-Pattern oder Startbild lassen diese Teile in der Basis stehen
 * und melden es im Bericht.
 */
export function firmwareAusSicherung(
  basis: Uint8Array,
  bloecke: readonly { key: string; bytes: Uint8Array }[],
  karte: FirmwareKarte = KARTE_HACKTRIBE,
): { ok: true; bytes: Uint8Array; bericht: SicherungsBauBericht } | { ok: false; reason: string } {
  if (karte.id !== "hacktribe") return { ok: false, reason: `Eine Gerätesicherung trägt die Hacktribe-Bänke — sie passt nicht in „${karte.label}“` };
  const pr = pruefeFirmware(basis, karte);
  if (!pr.ok) return pr;
  const block = (key: string): Uint8Array | undefined => bloecke.find((b) => b.key === key)?.bytes;
  const out = basis.slice();
  const bericht: SicherungsBauBericht = { bereiche: [], fehlend: [], ifxMaxIndex: -1, grooveMaxIndex: -1 };

  const bank = (key: string, mapKey: string, plaetze: number, groesse: number): boolean => {
    const b = block(key);
    const map = E2_RAM_MAP.find((e) => e.key === mapKey)!;
    if (!b || b.length < plaetze * groesse) {
      bericht.fehlend.push(key);
      return false;
    }
    for (let i = 0; i < plaetze; i++) out.set(b.subarray(i * groesse, (i + 1) * groesse), dateiOffset(addressForSlot(map, i)));
    bericht.bereiche.push({ key, bytes: plaetze * groesse });
    return true;
  };
  const ifxDa = bank("ifxPreset", "ifxPreset", IFX_PRESET_WRITE_MAX + 1, FX_PRESET_SIZE);
  bank("mfxPreset", "mfxPreset", MFX_PRESET_WRITE_MAX + 1, FX_PRESET_SIZE);
  const grooveDa = bank("groove", "groove", mapFuer("groove").count, GROOVE_SIZE);

  // IFX-Zaehler: aus dem einen gesicherten Max-Index alle dreizehn ableiten.
  const max = block("maxIfxIndex");
  if (ifxDa && max && max.length >= 1) {
    const m = max[0];
    if (m > IFX_PRESET_WRITE_MAX) return { ok: false, reason: `Max-IFX-Index ${m} in der Sicherung liegt über der Schreibgrenze` };
    for (const z of IFX_ZAEHLER) out[dateiOffset(z.addr)] = z.plusEins ? m + 1 : m;
    bericht.ifxMaxIndex = m;
    bericht.bereiche.push({ key: "ifxZaehler", bytes: IFX_ZAEHLER.length });
  } else if (ifxDa) bericht.fehlend.push("maxIfxIndex");

  // Groove-Zaehler: aus der gesicherten Anzahl (Read-Quelle traegt Max + 1).
  const gAnzahl = block("grooveMaxIndex");
  if (grooveDa && gAnzahl && gAnzahl.length >= 1) {
    const m = gAnzahl[0] - 1;
    if (m < 0 || m >= mapFuer("groove").count) return { ok: false, reason: `Groove-Anzahl ${gAnzahl[0]} in der Sicherung ist unbrauchbar` };
    for (const z of GROOVE_ZAEHLER) out[dateiOffset(z.addr)] = z.plusEins ? m + 1 : m;
    bericht.grooveMaxIndex = m;
    bericht.bereiche.push({ key: "grooveZaehler", bytes: GROOVE_ZAEHLER.length });
  } else if (grooveDa) bericht.fehlend.push("grooveMaxIndex");

  const init = block("initPattern");
  if (init && init.length >= INIT_PATTERN_GROESSE && String.fromCharCode(...init.subarray(0, 4)) === "PTST") {
    out.set(init.subarray(0, INIT_PATTERN_GROESSE), INIT_PATTERN_OFFSET);
    bericht.bereiche.push({ key: "initPattern", bytes: INIT_PATTERN_GROESSE });
  } else bericht.fehlend.push("initPattern");

  const splash = block("splash");
  if (splash && splash.length >= SPLASH_GROESSE) {
    out.set(splash.subarray(0, SPLASH_GROESSE), SPLASH_OFFSET);
    bericht.bereiche.push({ key: "splash", bytes: SPLASH_GROESSE });
  } else bericht.fehlend.push("splash");

  const global = block("initGlobal");
  if (global && istGlobalBlock(global.subarray(0, INIT_GLOBAL_GROESSE))) {
    out.set(global.subarray(0, INIT_GLOBAL_GROESSE), INIT_GLOBAL_OFFSET);
    bericht.bereiche.push({ key: "initGlobal", bytes: INIT_GLOBAL_GROESSE });
  } else bericht.fehlend.push("initGlobal");

  if (!bericht.bereiche.length) return { ok: false, reason: "Die Sicherung enthält keinen der Bereiche, die in die Firmware gehören" };
  return { ok: true, bytes: out, bericht };
}

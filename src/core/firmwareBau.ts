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
  const bericht: FirmwareBauBericht = { geschrieben: [], ifxMaxVorher: -1, ifxMaxNachher: -1, zaehler: [] };

  for (const { eintrag } of plan.schritte) {
    const platz = eintrag.platz!;
    if (platz - 1 > schreibMax(eintrag.art)) {
      return { ok: false, reason: `„${eintrag.name}“: Platz ${platz} liegt über der Schreibgrenze (${eintrag.art.toUpperCase()} bis ${schreibMax(eintrag.art) + 1})` };
    }
    const offset = dateiOffset(addressForSlot(mapFuer(eintrag.art), platz - 1));
    const len = eintrag.art === "groove" ? GROOVE_SIZE : FX_PRESET_SIZE;
    const unterlage = out.subarray(offset, offset + len);
    const bytes =
      eintrag.art === "groove"
        ? encodeGroove(decodeGroove(eintrag.bytes), unterlage)
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
  return { ok: true, bytes: out, bericht };
}

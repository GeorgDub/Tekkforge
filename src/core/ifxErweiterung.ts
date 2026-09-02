/**
 * ifxErweiterung — das IFX-Menue der Hacktribe-Firmware um neue Plaetze
 * erweitern.
 *
 * Die Firmware haelt 100 Preset-Bloecke im RAM vor, zeigt im Menue aber nur
 * so viele, wie ein Satz von Zaehlern erlaubt. Auf dem Testgeraet stehen sie
 * auf 48 (Max-Index, 0-basiert) bzw. 49 (Anzahl): Plaetze 1–49 im Menue,
 * 50–100 leer und unsichtbar (Sicherung vom 2026-09-01: Slot 49–99 sind
 * Init-Bloecke ohne Namen, nur die Pegel-Bytes ab +0x12B stehen — byteweise
 * identisch mit der gepatchten SYSTEM.VSB an Datei-Offset RAM − 0xC0000000
 * + 0x100; Hacktribe hat die Stock-Zeigertabellen dort weggeraeumt). Ein Preset in einen leeren Platz zu schreiben ist harmlos, aber
 * wirkungslos — bis die Zaehler nachgezogen sind.
 *
 * Woher die Zaehler kommen: hacktribe `e2sysex.py`, `add_ifx` (Zeile 337 ff.).
 * Es liest die Anzahl aus 0xC003EFDC, schreibt das Preset dorthin, und setzt
 * dann dreizehn Einzel-Bytes — sechs auf den neuen Max-Index, sieben auf
 * Max-Index + 1. Omnitribes Reverse-Doku (`addressmap_e2s_v202.csv`) hat die
 * Zellen im Firmware-Abbild byte-genau wiedergefunden: 0xC003EFDC ist das
 * Immediate einer `mov r0,#imm`-Anweisung (der „Anzahl"-Getter, Stock 38,
 * Hacktribe 49), die uebrigen sind Spiegel fuer Menue und gespeicherte
 * Parameter. Es ist also selbstmodifizierender Code im RAM — genau das, was
 * hacktribes „More IFX" seit Jahren macht.
 *
 * Was das NICHT ist: dauerhaft. Alle Zellen liegen im RAM; nach dem
 * Ausschalten zaehlt das Menue wieder bis 49, und die Presets in den neuen
 * Plaetzen sind ebenfalls weg. Dauerhaft ginge nur ueber ein gepatchtes
 * Firmware-Abbild (dort liegt die Anzahl bei Datei-Offset 0x3F0DC) — das ist
 * ein anderes Werkzeug.
 *
 * MFX laesst sich so NICHT erweitern: die 32 Master-Plaetze sind alle belegt,
 * und ihr Zaehler (0xC003EFE4, fest 0x20) ist in Stock- wie
 * Hacktribe-Firmware identisch — es gibt keinen freien Platz, den ein Zaehler
 * sichtbar machen koennte.
 *
 * Die Regel dieses Moduls: **alle dreizehn oder keinen.** Vor dem Schreiben
 * werden alle Zellen gelesen und auf Stimmigkeit geprueft; ein Satz, der
 * schon halb hochgezaehlt ist, wird gemeldet, nicht „repariert". Und der neue
 * Bereich muss lueckenlos belegt sein — das Menue zeigte sonst namenlose
 * Leerplaetze.
 *
 * ⚠ Am Geraet noch nicht abgenommen (Stand 2026-09-02). Der erste Test ist:
 * Preset auf Platz 50 verteilen, Menue erweitern, am Geraet Platz 50 waehlen.
 */
import { IFX_PRESET_WRITE_MAX } from "./hacktribeRam";

export interface IfxZaehler {
  addr: number;
  /** true: die Zelle traegt Max-Index + 1 (Anzahl), sonst den Max-Index selbst. */
  plusEins: boolean;
}

/** Die Adresse, aus der hacktribe `add_ifx` die Anzahl liest — der Getter. */
export const IFX_ANZAHL_ADDR = 0xc003efdc;

/** Reihenfolge wie in `add_ifx` — wer vergleicht, findet sie so wieder. */
export const IFX_ZAEHLER: readonly IfxZaehler[] = [
  { addr: 0xc003efdc, plusEins: true },
  { addr: 0xc0048f80, plusEins: false },
  { addr: 0xc0049ef0, plusEins: false },
  { addr: 0xc004a1f8, plusEins: false },
  { addr: 0xc009814c, plusEins: false },
  { addr: 0xc0098150, plusEins: true },
  { addr: 0xc0098188, plusEins: false },
  { addr: 0xc0098194, plusEins: true },
  { addr: 0xc00980e8, plusEins: false },
  { addr: 0xc00980ec, plusEins: true },
  { addr: 0xc009809c, plusEins: true },
  { addr: 0xc009811c, plusEins: true },
  { addr: 0xc0098138, plusEins: true },
];

export interface ZaehlerWert {
  addr: number;
  wert: number;
}

const hex = (a: number): string => `0x${a.toString(16).toUpperCase()}`;

/** Die dreizehn Schreibungen fuer einen neuen Max-Index (0-basiert). */
export function zaehlerSchreibliste(maxIndex: number): ZaehlerWert[] {
  return IFX_ZAEHLER.map((z) => ({ addr: z.addr, wert: z.plusEins ? maxIndex + 1 : maxIndex }));
}

export type ZaehlerStand = { ok: true; maxIndex: number } | { ok: false; reason: string };

/**
 * Aus den gelesenen Zellen den Max-Index ableiten — nur, wenn alle dreizehn
 * dasselbe sagen. Ein widerspruechlicher Satz ist der Zustand, den der
 * Modul-Kopf befuerchtet; den darf man nicht durch Schreiben „bereinigen".
 */
export function leseZaehlerStand(gelesen: readonly ZaehlerWert[]): ZaehlerStand {
  const map = new Map(gelesen.map((g) => [g.addr, g.wert]));
  if (map.size !== IFX_ZAEHLER.length || gelesen.length !== IFX_ZAEHLER.length) {
    return { ok: false, reason: `${gelesen.length} Zellen gelesen, ${IFX_ZAEHLER.length} erwartet` };
  }
  for (const z of IFX_ZAEHLER) if (!map.has(z.addr)) return { ok: false, reason: `Zelle ${hex(z.addr)} fehlt` };
  const maxIndex = map.get(IFX_ZAEHLER[1].addr)!;
  for (const z of IFX_ZAEHLER) {
    const soll = z.plusEins ? maxIndex + 1 : maxIndex;
    const ist = map.get(z.addr)!;
    if (ist !== soll) {
      return {
        ok: false,
        reason: `Zähler widersprechen sich: ${hex(z.addr)} steht auf ${ist}, nach Max-Index ${maxIndex} müsste dort ${soll} stehen`,
      };
    }
  }
  return { ok: true, maxIndex };
}

/**
 * Ein Platz ohne Namen ist fuers Menue leer — auf dem Geraet sind unbelegte
 * Plaetze Init-Bloecke ohne Namen. Geprueft wird das Namensbyte, nicht der Algorithmus:
 * ein Thru-Preset mit Namen ist ein (wenn auch langweiliges) Preset.
 */
export function istPresetPlatzLeer(bytes: Uint8Array): boolean {
  return bytes.length < 2 || bytes[1] === 0;
}

export type Erweiterungsplan =
  | { ok: true; schreiben: ZaehlerWert[]; neuePlaetze: number[] }
  | { ok: false; reason: string };

/**
 * Plant die Erweiterung von `aktuellerMax` auf `zielMax` (beide 0-basierte
 * Slot-Indizes). `istLeer(slot)` muss fuer jeden Slot des neuen Bereichs den
 * gelesenen Inhalt beurteilen — eine Luecke stoppt den Plan, weil das Menue
 * sie als namenlosen Eintrag zeigte. Meldungen zaehlen wie das Geraet (ab 1).
 */
export function planeIfxErweiterung(
  aktuellerMax: number,
  zielMax: number,
  istLeer: (slot: number) => boolean,
): Erweiterungsplan {
  if (!Number.isInteger(zielMax) || zielMax < 0) return { ok: false, reason: "Ziel ist kein gültiger Platz" };
  if (zielMax > IFX_PRESET_WRITE_MAX) {
    return { ok: false, reason: `Platz ${zielMax + 1} liegt über der Schreibgrenze (Platz ${IFX_PRESET_WRITE_MAX + 1})` };
  }
  if (zielMax <= aktuellerMax) {
    return { ok: false, reason: `Platz ${zielMax + 1} ist schon im Menü (es reicht bis Platz ${aktuellerMax + 1})` };
  }
  const neuePlaetze: number[] = [];
  const luecken: number[] = [];
  for (let slot = aktuellerMax + 1; slot <= zielMax; slot++) {
    neuePlaetze.push(slot);
    if (istLeer(slot)) luecken.push(slot + 1);
  }
  if (luecken.length) {
    return {
      ok: false,
      reason: `Nicht erweitert — im neuen Bereich ${luecken.length === 1 ? "ist" : "sind"} Platz ${luecken.join(", ")} leer; erst dort ein Preset ablegen`,
    };
  }
  return { ok: true, schreiben: zaehlerSchreibliste(zielMax), neuePlaetze };
}

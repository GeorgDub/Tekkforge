/**
 * globalFlash — die Global-Einstellungen, wie sie im seriellen Flash des Geräts liegen.
 *
 * Zwei 0x100-Blöcke „GLST … GLED“ (dasselbe Format wie der Global-Dump 0x51 und der Block
 * bei 0x100 einer .e2sallpat):
 *   0x230000  Selektor 0x23 — der gespeicherte Global-Block (WritePersistentProjectFlashImage
 *             0xC002A128); das ist der Block, den auch die Pattern-Bank des Geräts trägt.
 *   0x630000  Selektor 0x63 — die Werks-Vorgabe; CommandTask-Handler 0x11 (Werksreset) kopiert
 *             sie nach 0x23 und entpackt daneben den SQEZ-Strom (0x640000, Selektor 0x64) in
 *             die Pattern-Region 0x24.
 * Quelle: electribe2-re storage-and-updates.md; am Gerätedump 2026-09-16 belegt (beide Blöcke
 * vorhanden, drei Bytes verschieden; SQEZ-Kopf nennt 0x3E8000 = 250 × 0x4000 entpackte Bytes).
 *
 * Die Feldbedeutungen stammen aus e2sysex.ts (dort am Gerät gemessen, 2026-08-14).
 */
import {
  E2_GLOBAL_SIZE,
  E2_GLOBAL_METRONOME_OFF,
  E2_GLOBAL_SYNC_POLARITY_OFF,
  E2_GLOBAL_SYNC_UNIT_OFF,
  E2_GLOBAL_PTN_CHANGE_LOCK_OFF,
  E2_GLOBAL_AUDIO_IN_THRU_OFF,
  E2_GLOBAL_VELOCITY_CURVE_OFF,
  E2_GLOBAL_KNOB_MODE_OFF,
  E2_GLOBAL_TRIGGER_MODE_OFF,
  E2_GLOBAL_LCD_CONTRAST_OFF,
  E2_GLOBAL_CHAIN_MODE_OFF,
  E2_GLOBAL_BATTERY_TYPE_OFF,
  E2_GLOBAL_AUTO_POWER_OFF_OFF,
  E2_GLOBAL_TEMPO_LOCK_OFF,
  E2_GLOBAL_POWER_SAVE_OFF,
  E2_GLOBAL_TOUCH_SCALE_RANGE_OFF,
  E2_GLOBAL_CLOCK_SOURCE_OFF,
  E2_GLOBAL_MIDI_CHANNEL_OFF,
  E2_GLOBAL_MIDI_SEND_FILTER_OFF,
  E2_GLOBAL_MIDI_RECEIVE_FILTER_OFF,
} from "./e2sysex";

export const GLOBAL_FLASH = { gespeichert: 0x230000, werk: 0x630000, groesse: E2_GLOBAL_SIZE, sqez: 0x640000 } as const;

const liste = (namen: string[]) => (v: number): string => namen[v] ?? `? (${v})`;
const anAus = liste(["off", "on"]);

export interface GlobalFeld {
  name: string;
  off: number;
  anzeige: (v: number) => string;
}

/** Die am Gerät gemessenen Felder des Global-Blocks (Offsets aus e2sysex.ts). */
export const GLOBAL_FELDER: readonly GlobalFeld[] = [
  { name: "Metronom", off: E2_GLOBAL_METRONOME_OFF, anzeige: liste(["off", "rec 0", "rec 1", "rec 2", "on"]) },
  { name: "Sync-Polarität", off: E2_GLOBAL_SYNC_POLARITY_OFF, anzeige: liste(["hi", "lo"]) },
  { name: "Sync-Einheit", off: E2_GLOBAL_SYNC_UNIT_OFF, anzeige: liste(["1 step", "2 steps"]) },
  { name: "Pattern Change Lock", off: E2_GLOBAL_PTN_CHANGE_LOCK_OFF, anzeige: anAus },
  { name: "Audio In Thru", off: E2_GLOBAL_AUDIO_IN_THRU_OFF, anzeige: anAus },
  { name: "Velocity-Kurve", off: E2_GLOBAL_VELOCITY_CURVE_OFF, anzeige: liste(["heavy", "medium", "light", "const96"]) },
  { name: "Knob-Modus", off: E2_GLOBAL_KNOB_MODE_OFF, anzeige: liste(["jump", "catch", "value scale"]) },
  { name: "Trigger-Modus", off: E2_GLOBAL_TRIGGER_MODE_OFF, anzeige: liste(["normal", "seq 1st", "seq play"]) },
  { name: "LCD-Kontrast", off: E2_GLOBAL_LCD_CONTRAST_OFF, anzeige: (v) => `${v - 17}` },
  { name: "Chain Mode", off: E2_GLOBAL_CHAIN_MODE_OFF, anzeige: anAus },
  { name: "Batterietyp", off: E2_GLOBAL_BATTERY_TYPE_OFF, anzeige: liste(["Ni-MH", "Alkali"]) },
  { name: "Auto Power Off", off: E2_GLOBAL_AUTO_POWER_OFF_OFF, anzeige: liste(["disable", "4 hours"]) },
  { name: "Tempo Lock", off: E2_GLOBAL_TEMPO_LOCK_OFF, anzeige: anAus },
  { name: "Power Save", off: E2_GLOBAL_POWER_SAVE_OFF, anzeige: liste(["disable", "auto", "enable"]) },
  { name: "Touch-Scale-Umfang", off: E2_GLOBAL_TOUCH_SCALE_RANGE_OFF, anzeige: (v) => `${v} oct` },
  { name: "Clock-Quelle", off: E2_GLOBAL_CLOCK_SOURCE_OFF, anzeige: liste(["internal", "auto", "external usb", "external midi", "external sync"]) },
  { name: "MIDI-Kanal", off: E2_GLOBAL_MIDI_CHANNEL_OFF, anzeige: (v) => `${v + 1}` },
  { name: "MIDI Send Filter", off: E2_GLOBAL_MIDI_SEND_FILTER_OFF, anzeige: liste(["off", "short", "short+program"]) },
  { name: "MIDI Receive Filter", off: E2_GLOBAL_MIDI_RECEIVE_FILTER_OFF, anzeige: liste(["off", "short", "short+program"]) },
];

const ascii = (b: Uint8Array, off: number, n: number): string => {
  let s = "";
  for (let i = 0; i < n && off + i < b.length; i++) s += String.fromCharCode(b[off + i]);
  return s;
};

export interface GlobalBefund {
  ok: boolean;
  grund?: string;
  felder: { name: string; off: number; wert: number; anzeige: string }[];
}

/** Einen 0x100-Block „GLST…GLED“ in benannte Felder zerlegen. */
export function dekodiereGlobal(block: Uint8Array): GlobalBefund {
  if (block.length < E2_GLOBAL_SIZE) return { ok: false, grund: `nur ${block.length} von ${E2_GLOBAL_SIZE} Bytes`, felder: [] };
  if (ascii(block, 0, 4) !== "GLST") return { ok: false, grund: "kein GLST-Magic", felder: [] };
  const felder = GLOBAL_FELDER.map((f) => ({ name: f.name, off: f.off, wert: block[f.off], anzeige: f.anzeige(block[f.off]) }));
  return { ok: ascii(block, 0xfc, 4) === "GLED", grund: ascii(block, 0xfc, 4) === "GLED" ? undefined : "Endmarke GLED fehlt", felder };
}

export interface GlobalUnterschied {
  off: number;
  name: string | null;
  a: number;
  b: number;
  anzeigeA: string;
  anzeigeB: string;
}

/** Byteweiser Vergleich zweier Global-Blöcke; bekannte Felder werden benannt. */
export function vergleicheGlobal(a: Uint8Array, b: Uint8Array): GlobalUnterschied[] {
  const out: GlobalUnterschied[] = [];
  for (let off = 0; off < E2_GLOBAL_SIZE; off++) {
    if (a[off] === b[off]) continue;
    const f = GLOBAL_FELDER.find((x) => x.off === off);
    out.push({ off, name: f?.name ?? null, a: a[off], b: b[off], anzeigeA: f ? f.anzeige(a[off]) : `0x${a[off].toString(16).toUpperCase().padStart(2, "0")}`, anzeigeB: f ? f.anzeige(b[off]) : `0x${b[off].toString(16).toUpperCase().padStart(2, "0")}` });
  }
  return out;
}

/** Kurzzeile: die wichtigsten Felder eines Blocks. */
export function globalKurz(block: Uint8Array): string {
  const g = dekodiereGlobal(block);
  if (!g.felder.length) return g.grund ?? "unlesbar";
  const wahl = ["MIDI-Kanal", "Clock-Quelle", "Chain Mode", "Knob-Modus", "Trigger-Modus", "Batterietyp", "Auto Power Off", "Audio In Thru"];
  return wahl.map((n) => g.felder.find((f) => f.name === n)).filter((f): f is NonNullable<typeof f> => !!f).map((f) => `${f.name} ${f.anzeige}`).join(", ") + (g.ok ? "" : ` (${g.grund})`);
}

/** Alle Felder, eine Zeile je Feld. */
export function globalText(block: Uint8Array, titel: string): string[] {
  const g = dekodiereGlobal(block);
  if (!g.felder.length) return [`${titel}: ${g.grund}`];
  const z = [`${titel}${g.ok ? "" : ` (${g.grund})`}`];
  for (const f of g.felder) z.push(`  +0x${f.off.toString(16).toUpperCase().padStart(2, "0")}  ${f.name.padEnd(20)} ${f.anzeige} (${f.wert})`);
  return z;
}

export interface SqezKopf {
  ok: boolean;
  version: number;
  kennung: number;
  entpackt: number;
}

/** Kopf des SQEZ-Stroms: „SQEZ“, u16 Version, u16 Kennung, u32 entpackte Größe (LE). */
export function liesSqezKopf(bytes: Uint8Array, off = 0): SqezKopf {
  const ok = ascii(bytes, off, 4) === "SQEZ";
  const u16 = (o: number) => bytes[off + o] | (bytes[off + o + 1] << 8);
  const u32 = (o: number) => (bytes[off + o] | (bytes[off + o + 1] << 8) | (bytes[off + o + 2] << 16) | (bytes[off + o + 3] << 24)) >>> 0;
  return { ok, version: ok ? u16(4) : 0, kennung: ok ? u16(6) : 0, entpackt: ok ? u32(8) : 0 };
}

export interface GlobalImFlash {
  gespeichert: Uint8Array | null;
  werk: Uint8Array | null;
  sqez: SqezKopf | null;
}

/** Die beiden Global-Blöcke und der SQEZ-Kopf aus einem 16-MiB-Dump (null, wo nichts steht). */
export function globalAusDump(dump: Uint8Array): GlobalImFlash {
  const nimm = (off: number): Uint8Array | null => {
    if (dump.length < off + E2_GLOBAL_SIZE) return null;
    const b = dump.slice(off, off + E2_GLOBAL_SIZE);
    return ascii(b, 0, 4) === "GLST" ? b : null;
  };
  const sq = dump.length >= GLOBAL_FLASH.sqez + 12 ? liesSqezKopf(dump, GLOBAL_FLASH.sqez) : null;
  return { gespeichert: nimm(GLOBAL_FLASH.gespeichert), werk: nimm(GLOBAL_FLASH.werk), sqez: sq && sq.ok ? sq : null };
}

/** Vergleich des gespeicherten Blocks mit dem laufenden (SysEx 0x51). */
export function globalLiveZeile(gespeichert: Uint8Array, live: Uint8Array | null): string {
  if (!live) return "Laufender Global-Block (SysEx 0x51): keine Antwort";
  const u = vergleicheGlobal(gespeichert, live);
  if (!u.length) return "Laufender Global-Block (SysEx 0x51): identisch mit dem gespeicherten — nichts Ungespeichertes";
  return `Laufender Global-Block (SysEx 0x51) weicht vom gespeicherten in ${u.length} Byte(s) ab: ${u.map((d) => `${d.name ?? `+0x${d.off.toString(16).toUpperCase()}`} gespeichert ${d.anzeigeA} → live ${d.anzeigeB}`).join("; ")}`;
}

/** Berichtzeilen zu Global und SQEZ, wie sie der Dump-Bericht und der Geräte-Knopf zeigen. */
export function globalBerichtZeilen(g: GlobalImFlash, ausfuehrlich = false): string[] {
  const z: string[] = [];
  if (g.gespeichert) {
    z.push(`Global gespeichert (0x230000): ${globalKurz(g.gespeichert)}`);
    if (ausfuehrlich) z.push(...globalText(g.gespeichert, "Alle Felder (gespeichert):").slice(1));
  } else z.push("Global gespeichert (0x230000): kein GLST-Block");
  if (g.werk) {
    if (g.gespeichert) {
      const u = vergleicheGlobal(g.gespeichert, g.werk);
      z.push(u.length ? `Werks-Global (0x630000) weicht in ${u.length} Byte(s) ab: ${u.map((d) => `${d.name ?? `+0x${d.off.toString(16).toUpperCase()}`} ${d.anzeigeB} → ${d.anzeigeA}`).join("; ")}` : "Werks-Global (0x630000): identisch mit dem gespeicherten Block");
    } else z.push(`Werks-Global (0x630000): ${globalKurz(g.werk)}`);
  } else z.push("Werks-Global (0x630000): kein GLST-Block");
  if (g.sqez) z.push(`SQEZ-Strom (0x640000): Werks-Pattern-Bank komprimiert, Version ${g.sqez.version}, entpackt 0x${g.sqez.entpackt.toString(16).toUpperCase()} Bytes${g.sqez.entpackt === 250 * 0x4000 ? " = 250 × 0x4000 (Werksreset füllt damit die Pattern-Region)" : ""}`);
  return z;
}

/**
 * bootloaderSd — einen SD-Ordner für den Custom-Bootloader (vanasoft23/freetribe, Sampler-Umbau
 * 2026-09-17) vorbereiten: Dateien einordnen (was der Bootloader-Datei-Browser womit macht), das
 * Nicht-Dazugehörige aussortieren, und eine LIESMICH schreiben, die die Menüpunkte erklärt.
 *
 * Bootloader-Menü (ui/file_browser.c + ui_controller.c):
 *   Boot from flash      — die im Flash installierte Firmware starten
 *   Install bootloader   — den laufenden Bootloader nach Flash 0 schreiben (öffnet sich dann bei jedem Start)
 *   Dump flash to SD     — 16 MiB Flash als FLASHDMP.BIN sichern
 *   <Datei>              — KORG .VSB: SYSTEM → „Boot" (flüchtig, DDR) oder „Flash"; BOOT/PCM/USER/SLICE → „Flash";
 *                          rohes 2-MiB-.bin → Boot
 * Nichts hier schreibt auf die SD-Karte oder ins Gerät; es wird nur ein Ordner am PC angelegt.
 */
import { liesVsbKopf, VSB_KOPF, type VsbArt } from "./vsbKopf";

export type SdRolle = "sbl" | "bootsektor" | "system" | "boot" | "pcm" | "user" | "slice" | "roh" | "syx" | "unbekannt";

export interface SdEintrag {
  name: string;
  bytes: Uint8Array;
  rolle: SdRolle;
  /** Gehört die Datei auf die SD (der Bootloader kann damit etwas anfangen)? */
  aufSd: boolean;
  /** Was der Bootloader im Menü damit tut. */
  menue: string;
  hinweis: string;
  identitaet?: "Sampler" | "Synth" | "?";
}

export interface SdPaket {
  ordner: string;
  dateien: SdEintrag[];
  liesmich: string;
  warnungen: string[];
}

const SBL_GROESSE = 131022;
const BOOTSEKTOR_GROESSE = 0x20000;
const FIRMWARE_ROH = 0x200000;
/** Zeichen, die das 128-px-Display im Datei-Browser etwa zeigt (DISP_NAME_MAX). */
export const DISPLAY_NAME_MAX = 24;

const identName = (id: number): SdEintrag["identitaet"] => (id === 0x000124 ? "Sampler" : id === 0x000123 ? "Synth" : "?");

/** Eine Datei einordnen. */
export function ordneBootloaderDatei(name: string, bytes: Uint8Array): SdEintrag {
  const base = { name, bytes };
  const kopf = new TextDecoder("latin1").decode(bytes.subarray(0, 16));
  if (bytes.length >= VSB_KOPF && kopf === "KORG SYSTEM FILE") {
    const k = liesVsbKopf(bytes);
    const art = (["SYSTEM", "BOOT", "PCM", "USER", "SLICE"] as VsbArt[]).find((a) => k.name.startsWith(a === "SLICE" ? "SLIC" : a));
    const id = identName(k.identitaet);
    switch (art) {
      case "SYSTEM":
        return { ...base, rolle: "system", aufSd: true, identitaet: id, menue: "Datei anwählen → „Boot“ (flüchtig aus dem DDR) oder „Flash“ (→ 0x020000, 2 MiB)",
          hinweis: "Zum Testen immer erst „Boot“: nach Aus/Ein ist der Flash-Stand wieder da." };
      case "BOOT":
        return { ...base, rolle: "boot", aufSd: true, identitaet: id, menue: "Datei anwählen → „Flash“ (→ Boot-Sektor, Flash 0, 128 KiB)",
          hinweis: (/vom-Geraet/i.test(name) ? "RÜCKWEG zum Werks-Bootloader. " : "") + "EIN-SCHUSS: ein falscher Boot-Sektor heißt JTAG. Nur flashen, wenn du weißt, warum." };
      case "PCM":
        return { ...base, rolle: "pcm", aufSd: true, identitaet: id, menue: "Datei anwählen → „Flash“ (→ 0x800000, 8 MiB, etwa 2 Minuten)",
          hinweis: "Klangdaten. Netzteil dran, nicht unterbrechen." };
      case "USER":
        return { ...base, rolle: "user", aufSd: true, identitaet: id, menue: "Datei anwählen → „Flash“ (→ 0x220000, bis 0x490000)",
          hinweis: "Enthält Global, Patterns, Songs UND den Gerätestempel — überschreibt den Nutzerstand." };
      case "SLICE":
        return { ...base, rolle: "slice", aufSd: true, identitaet: id, menue: "Datei anwählen → „Flash“ (→ 0x750000, bis 0x90000)",
          hinweis: "Slice-Metadaten." };
      default:
        return { ...base, rolle: "unbekannt", aufSd: false, identitaet: id, menue: "—",
          hinweis: `KORG-Datei mit unbekanntem Namen „${k.name}“ — der Bootloader lehnt sie ab.` };
    }
  }
  if (bytes.length >= 4 && bytes[0] === 0x54 && bytes[1] === 0x49 && bytes[2] === 0x50 && bytes[3] === 0x41) {
    return { ...base, rolle: "bootsektor", aufSd: false, menue: "—",
      hinweis: `Boot-Sektor (AIS „TIPA“, ${bytes.length === BOOTSEKTOR_GROESSE ? "128 KiB" : bytes.length + " B"}). Gehört NICHT in den Browser — als BOOT.VSB verpacken (Werkbank) oder den Bootloader per SysEx starten.` };
  }
  if (/\.syx$/i.test(name)) {
    return { ...base, rolle: "syx", aufSd: false, menue: "—",
      hinweis: "SysEx-Datei (z. B. Omnitribe-Modul-Bündel): aus TekkForge per „SysEx-Datei senden“ an die LAUFENDE Firmware schicken, nicht über den Bootloader." };
  }
  if (bytes.length === SBL_GROESSE) {
    return { ...base, rolle: "sbl", aufSd: false, menue: "—",
      hinweis: "Rohe bootloader.bin (SBL, 131022 B): bleibt am PC für „▶ Über SysEx starten“. Auf der SD kann der Bootloader damit nichts anfangen (kein 2-MiB-Image)." };
  }
  if (bytes.length === FIRMWARE_ROH) {
    return { ...base, rolle: "roh", aufSd: true, menue: "Datei anwählen → „Boot“ (rohes 2-MiB-Firmware-Image, flüchtig)",
      hinweis: "Ohne KORG-Kopf: nur booten, nicht flashen." };
  }
  return { ...base, rolle: "unbekannt", aufSd: false, menue: "—", hinweis: `Weder KORG-.VSB noch 2-MiB-Image (${bytes.length} B) — der Bootloader lehnt sie ab.` };
}

export interface SdOpts {
  stempel?: string;
  md5?: (b: Uint8Array) => string;
  /** Womit der Bootloader gestartet wird (für die LIESMICH). */
  bootloaderName?: string;
}

/** Ordner + LIESMICH aus einer Dateiauswahl bauen. Schreibt nichts. */
export function baueBootloaderSd(dateien: { name: string; bytes: Uint8Array }[], opts: SdOpts = {}): SdPaket {
  const stempel = opts.stempel ?? new Date().toISOString().slice(0, 10);
  const ordner = `Bootloader-SD-${stempel}`;
  const eintraege = dateien.map((d) => ordneBootloaderDatei(d.name, d.bytes));
  const warnungen: string[] = [];
  const gesehen = new Set<string>();
  for (const e of eintraege) {
    const key = e.name.toLowerCase();
    if (gesehen.has(key)) warnungen.push(`Doppelter Dateiname „${e.name}“ — auf der SD kann nur einer liegen.`);
    gesehen.add(key);
    if (e.aufSd && e.name.length > DISPLAY_NAME_MAX) warnungen.push(`„${e.name}“ ist länger als ${DISPLAY_NAME_MAX} Zeichen — das Display schneidet den Namen ab; kürzer benennen.`);
    if (!e.aufSd) warnungen.push(`„${e.name}“ kommt NICHT auf die SD: ${e.hinweis}`);
    if (e.identitaet === "Synth") warnungen.push(`„${e.name}“ trägt die SYNTH-Identität — auf dem Sampler nur bewusst (Crossgrade) verwenden.`);
  }
  const aufSd = eintraege.filter((e) => e.aufSd);
  const nichtSd = eintraege.filter((e) => !e.aufSd);
  const md5 = opts.md5;

  const z: string[] = [];
  z.push(`# Bootloader-SD — ${stempel}`, "");
  z.push("Dieser Ordner ist die Vorlage für die SD-Karte des Custom-Bootloaders (vanasoft23/freetribe, Sampler-Umbau 2026-09-17).",
    "**Alle Dateien außer dieser LIESMICH ins Wurzelverzeichnis der SD kopieren.** Der Bootloader zeigt das Wurzelverzeichnis in seinem Datei-Browser.", "");
  z.push("## So kommst du in den Bootloader", "");
  z.push(`1. Gerät läuft normal (Hacktribe). In TekkForge: Firmware-Werkbank → „▶ Über SysEx starten“ → ${opts.bootloaderName ?? "bootloader.bin"} wählen, JA tippen.`,
    "2. Das Display zeigt das Bootloader-Menü; USB meldet sich als e2fb:1802 (SD als Laufwerk, GDB über CDC). Nichts davon ist geflasht — Aus/Ein bringt die normale Firmware zurück.",
    "3. Wer den Bootloader dauerhaft will: Menü „Install bootloader“ (schreibt Flash 0). Erst nach erfolgreichem flüchtigen Test.", "");
  z.push("## Die Menüpunkte", "");
  z.push("| Eintrag | Tut |", "|---|---|",
    "| Boot from flash | die im Flash installierte Firmware starten (der normale Weg) |",
    "| Install bootloader | den laufenden Bootloader nach Flash 0 schreiben — öffnet sich dann bei jedem Start |",
    "| Dump flash to SD | 16 MiB Flash als `FLASHDMP.BIN` sichern |",
    "| `SYSTEM….VSB` | **Boot** = flüchtig aus dem DDR starten · **Flash** = nach 0x020000 schreiben |",
    "| `BOOT/PCM/USER/SLICE….VSB` | **Flash** in die jeweilige Region (Dialog zeigt Adresse, Größe, Identität) |",
    "| rohes 2-MiB-`.bin` | Boot (flüchtig) |", "");
  z.push("## Dateien in diesem Ordner", "");
  z.push(`| Datei | Rolle | Identität | Größe | Im Menü |${md5 ? " MD5 |" : ""}`, `|---|---|---|---|---|${md5 ? "---|" : ""}`);
  for (const e of aufSd) {
    z.push(`| \`${e.name}\` | ${e.rolle.toUpperCase()} | ${e.identitaet ?? "—"} | ${e.bytes.length} B | ${e.menue} |${md5 ? ` \`${md5(e.bytes)}\` |` : ""}`);
  }
  if (aufSd.length === 0) z.push("| — | keine Datei, die der Bootloader annimmt | | | |");
  z.push("");
  for (const e of aufSd) z.push(`- **${e.name}:** ${e.hinweis}`);
  z.push("");
  if (nichtSd.length) {
    z.push("## Nicht kopiert (gehört nicht auf die SD)", "");
    for (const e of nichtSd) z.push(`- **${e.name}** — ${e.hinweis}`);
    z.push("");
  }
  z.push("## Regeln", "");
  z.push("- **Boot ist flüchtig.** Aus/Ein stellt den Flash-Stand wieder her. Zum Testen immer erst Boot.",
    "- **Flash schreibt wirklich.** Netzteil anschließen (der Bootloader hat kein Batterie-Tor), nicht unterbrechen.",
    "- **BOOT.VSB ist Ein-Schuss.** Ein falscher Boot-Sektor macht das Gerät nur noch per JTAG erreichbar.",
    "- **Identität:** Dateien mit Synth-Identität auf dem Sampler nur bewusst (Crossgrade).",
    "- **Rückweg:** die `BOOT-vom-Geraet-….VSB` (Werks-Boot-Sektor) und die Flash-Sicherungen vom 16.09. liegen in `Downloads\\TekkForge\\Firmware`.", "");
  if (warnungen.length) {
    z.push("## Warnungen", "");
    for (const w of warnungen) z.push(`- ⚠ ${w}`);
    z.push("");
  }
  z.push("Erzeugt von TekkForge. Diese Datei hat nichts auf die SD geschrieben und nichts am Gerät verändert.");
  return { ordner, dateien: eintraege, liesmich: z.join("\n") + "\n", warnungen };
}

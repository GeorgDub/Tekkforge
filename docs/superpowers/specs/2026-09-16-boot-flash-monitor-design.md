# Boot-Sektor, Flash-Karte und Geräte-Monitor — Design (2026-09-16, Nachtschicht)

Auftrag: das Wissen aus vanasoft23s Bootloader, electribe2-re und dem Ghidra-Archiv
(`docs/2026-09-16-vanasoft-bootloader-boot-vsb.md`, Omnitribe
`docs/reverse/vanasoft23_bootloader_e2re_2026-09-16.md`) in TekkForge-Funktionen umsetzen und
am angeschlossenen Gerät prüfen. Freigabe: die Anweisung „die Nacht lang selbstständig ohne
Rückfragen“ vom 2026-09-16. Alles, was Flash schreibt, bleibt außen vor — die App baut und prüft
Dateien und liest RAM; flashen tut nur das Gerät über sein eigenes SD-Update.

## 1. Was gebaut wird

### 1.1 `core/vsbKopf.ts` — der VSB-Kopf, wie die Firmware ihn prüft
Bisher kennt die App den Kopf nur für SYSTEM.VSB (crossgrade.ts, firmwareFreigabe.ts). Neu:
ein Modell für alle fünf Update-Dateien (SYSTEM, BOOT, PCM, USER, SLICE) nach den
Dekompilaten `ValidateVsbResourceHeaderMagic`, `ValidateVsbResourceHeaderType`,
`GetVsbPayloadLength`, `GetVsbHeaderProductIdentity`, `IsCpuResourceRevisionAtLeast` und den
fünf `Load*VsbToSerialFlash`.

- `liesVsbKopf(bytes)` → `{ magicOk, kuerzel, name, revision:[maj,min], identitaet, laenge, art }`.
- `pruefeVsbKopf(bytes, laufend)` → Liste von Prüfungen (ok/rot) mit dem Grund, den die
  Firmware nennen würde: Magic; Identität (Modus 0 = nur 0x24, Modus 1 = 0x23|0x24, jeweils
  bezogen auf die laufende Firmware-Variante); Name (SYSTEM 6, BOOT 4, PCM 3, USER 4, SLIC 4);
  Länge (SYSTEM genau 0x200000, BOOT genau 0x20000, PCM genau 0x800000, USER ≤ 0x490000,
  SLICE ≤ 0x90000 — Klemmung gemeldet); Revision ≥ Mindestwert nur beim produktbewussten
  SYSTEM-Installer (Sampler 2.2, Synth 1.17).
- `baueVsbKopf(vorlage, { name, laenge, identitaet })` — Kopf aus einer Vorlage, Felder gesetzt.
- Konstanten: Selektor-Karte (0, 2, 0x22, 0x23, 0x24, 0x63, 0x64, 0x6B, 0x75, 0x80) mit
  Offset = Selektor << 16, Spannen der fünf Regionen.

### 1.2 `core/bootSektor.ts` — Boot-Sektor bauen, lesen, prüfen
Port von `scripts/make_bootsect.py`: AIS-Kopf (40 B), SBL (131022 B), AIS-Schwanz (8 B),
16-Bit-Wortsumme (2 B). `baueBootSektor(sbl)`, `liesBootSektor(bytes)` (AIS-Kommandos,
Ladeadresse, Einsprung, Prüfsumme, SBL-Bytes), `baueBootVsb(bootSektor, vorlageKopf,
identitaet)`. Beides gegen die Python-Fassung golden-getestet (gleiche Bytes für denselben
Eingang; die lokale `bootloader.bin` ist AGPL und liegt nicht im Repo — der Test überspringt
sich ohne sie, ein synthetischer SBL-Block prüft die Struktur immer).

### 1.3 `core/flashKarte.ts` — 16-MiB-Flash-Dump lesen
`liesFlashDump(bytes)` (genau 16 MiB): Boot-Sektor (über bootSektor), SYSTEM-Nutzlast ab
0x20000 (SHA-256 → Firmware-Karte über `erkenneKarte` mit synthetischem Kopf), USER-Identität
bei 0x220004 (`elec2USR`/`ele2sUSR`), Main-Versionsrecord bei 0x21FFF0 (+4/+5/+6), PCM-Kopf
bei 0x800000 (`KORG`, `elec2PCM`/`X11100PC`), Regionen-Tabelle mit Größen. `schneideRegion`
liefert SYSTEM/PCM/USER als VSB (mit gebautem Kopf) oder roh — der Weg, aus einem
Bootloader-Dump wieder Update-Dateien zu machen.

### 1.4 `core/e2Symbole.ts` — benannte Adressen aus dem Ghidra-Export
Kuratierte, kleine Tabelle (kein 900-KB-Import): Stimmen-Slots (`0xC06914EC` Maske,
`0xC06916A0` 24 × 0x48 mit owner_voice +4, dsp_slot +0x14, oscillator_id +0x3A), Slot-Nebenfelder
(Notenzustand `0xC0691486`, Release-Flags `0xC069143B`, Prioritätsreihenfolge `0xC069146B`,
Generation `0xC0691484`), Sample-Laufzeittabelle (`0xC036AD88`, 999 × 0x45C: +4 Länge, +0x0B
Ladezustand, +0x10 Rate), Osz-Laufzeitkatalog (`0xC047B08C`, 999 × 32), Shared-Control-Zeiger
(`0xC0691324` → +0x24 Batterietyp, +0x25 Auto-Power-Off, +0x29 Power-Save), Batterie-Client-
Zeigerzelle (`0xC003A858` → Zeiger → +0x320 Rohwert, +0x328 Stufe 0–4, +0x318 Schwellen),
Sequencer-Tore (`0xC068FC6C` Records aktiv, `0xC068FC80` Countdown, `0xC069009C` Overrun).
Dazu Dekoder: `dekodiereStimmen(maske, slots)`, `dekodiereBatterie(stufe, roh, typ)`,
`dekodiereSampleStand(records)`. Alle Adressen gelten für Sampler-Layout (Stock, Hacktribe,
TekkForge-Builds — Hacktribe patcht in-place); Synth-Layout wird als „nicht kartiert“ gemeldet.

### 1.5 GUI
- **Firmware-Werkbank → neuer Abschnitt „Boot-Sektor & Flash-Dump“** (`index.html`,
  `gui/firmwareWerkbank.ts`): (a) `bootloader.bin` laden → Boot-Sektor bauen → Datei sichern
  und/oder als `BOOT.VSB` (Kopfvorlage = geladene Basis oder Standard-Sampler-Kopf) sichern;
  (b) beliebige `.VSB` laden → Kopfprüfung als Tabelle (grün/rot) für Sampler- und Synth-
  Updater; (c) 16-MiB-Dump laden → Karte anzeigen, Regionen als Datei sichern. Kein SD-Pfad,
  nur „Datei sichern“ — und der Warntext aus dem Doku-Digest (Ein-Schuss, JTAG-Rückweg,
  Handoff-Patch nur für Synth-Image).
- **RAM-Panel → „Geräte-Monitor“** (`gui/editor.ts`): Struktur-Dropdown bekommt die
  kuratierten Symbole; ein Knopf „Stimmen & Sample-Stand“ liest Maske + 24 Slots + Batterie
  und zeigt eine Tabelle (Slot, Part, Oszillator-Nummer/-Name, Note, Zustand) plus Batterie-
  Stufe mit dem Hinweis „SD-Update erlaubt ab Stufe 2“. Nur Lesen; kein Auto-Refresh
  (RAM-Lesen bei laufendem Sequencer liefert stumm falsche Daten — siehe Skill-Notiz), stattdessen
  ein bewusster Klick; der Text sagt, wann die Lesung gilt.

## 2. Test-Strategie
- Vitest, offline: Kopfregeln (jeder Ablehnungsgrund einmal), Boot-Sektor-Rundlauf
  (bauen → lesen → gleiche SBL-Bytes), Python-Gleichheit (wenn `bootloader.bin` lokal liegt),
  Flash-Dump aus synthetischen Regionen, Symbol-Dekoder mit Byte-Fixtures aus dem Ghidra-Export.
- Gerät (Hacktribe-Sampler am USB, nachts verfügbar): über `run-tekkforge`-Treiber
  `ram-open` → Monitor lesen bei gestopptem Sequencer (Maske 0), dann Start senden, kurz
  warten, Stop senden, Monitor lesen — erwartete Beobachtung: nach dem Stop noch Slots mit
  Release-Flag, Generation gestiegen; Batterie-Stufe plausibel (Netzteil → Listener-State).
  Ergebnis in `README.md` unter „Erprobungsstand“ und in den Memories.

## 3. Nicht in dieser Nacht
Flash-Schreiben aus der App (0x55/0x56 bleiben ohne Bauer), Bootloader-Neubau (Toolchain
fehlt), Synth-Layout-Symbole, Auto-Refresh des Monitors.

# 2026-09-16 — vanasoft23-Bootloader, BOOT.VSB-Weg und Ghidra-Archiv

Kurzfassung für TekkForge. Die vollständige Auswertung (Bootloader-Aufbau, Firmware-Architektur,
Flash-Karte, Ghidra-Export) steht in Omnitribe:
`G:\IdeaProjects\Omnitribe\docs\reverse\vanasoft23_bootloader_e2re_2026-09-16.md`.

## Was neu ist
- **Fertiger Custom-Bootloader** (vanasoft23/freetribe, Branch `bootloader-mess`): Menü auf dem
  Display (Boot from flash / Install bootloader / Dump flash to SD / Datei), USB `e2fb:1802` mit
  DFU (alt 3 = Firmware in den DDR laden und starten, ohne Flash), GDB-Stub über USB-CDC, SD-Karte
  als USB-Laufwerk. Vorgebautes Image: `G:\Downloads\TekkForge\Firmware\vanasoft-bootloader\bootloader.bin`
  (131022 Bytes, lädt nach 0x80000000 — das ist bangcorrupts „128-KiB-bootloader.bin“).
- **BOOT.VSB ist ein echter Update-Weg**: die Sampler-/Hacktribe-Firmware nimmt im SOFTWARE-UPDATE
  eine `KORG/hacktribe/System/BOOT.VSB` (Kopf: Name `BOOT`, Identität `00 01 24`, Länge `0x20000`
  LE bei +0x3C) auch **ohne** SYSTEM.VSB an und schreibt die 128 KiB nach Flash-Offset 0. Keine
  Signaturprüfung. Belegt per Dekompilat (`LoadBootVsbToSerialFlash` 0xC002F5A8,
  `ProcessVsbUpdateSequence` 0xC003A738, Status 0x17 = Datei fehlt → weiter).
- **Korrektur**: die SD-Karte hängt an **MMCSD0** (0x01C40000, PSC0, AINTC 16, Pinmux-Register 10 =
  0x88222222, Card-Detect GP4[1] aktiv low), nicht an MMCSD1.
- **Plattform-ID-Tor bestätigt**: vanasoft patcht dieselbe Stelle (0xC0025E4C, `BEQ→B`) wie wir
  (Literal 0x123→0x124 @ Dateioffset 0x25F64) — beide booten die Synth-Firmware auf Sampler-Hardware
  und beide haben das PCM.VSB-Problem.

- **Pattern-Bank im Flash = e2sallpat ohne Kopf:** 0x230000 (Selektor 0x23, GLST-Block 0x10000) +
  0x240000 (Selektor 0x24, 250 × 0x4000 PTST) — TekkForge schneidet daraus die `.e2sallpat`
  (`patternBankAusDump`) oder liest sie direkt vom Gerät (`liesPatternBankVomGeraet`, 4 MiB in 25 s); am Gerät belegt (250 Records, byte-gleich mit dem Dump, Import in die App gelingt).

- **Regionen einzeln vom Gerät:** `liesRegionVomGeraet(lesen, art, kopf)` liest nur SYSTEM/PCM/USER/SLICE/BOOT
  (Selektor << 16, Länge laut REGION_SPANNE) und verpackt sie per `verpackeRegion`; am Gerät belegt
  (SYSTEM 13 s, PCM 50 s, SLICE 4 s, Nutzlast = Dump).

- **Global im Flash:** 0x230000 = gespeicherter Global-Block (GLST…GLED, 0x100), 0x630000 = Werks-Global,
  0x640000 = SQEZ (Kopf: u16 Version 9, u16 2, u32 entpackt 0x3E8000 = 250 × 0x4000 → komprimierte
  Werks-Pattern-Bank für den Werksreset, Handler 0x11). `core/globalFlash.ts`, am Gerät belegt.
  USER-Region 0x220000: nur der 16-Byte-Stempel, Rest 0xFF.

- **SQEZ nachgebaut** (`core/sqez.ts`, Omnitribe `tools/formats/sqez.py`): Kopf „SQEZ“ | u32 Stromlänge | u32
  entpackt | u16 CRC-16/ARC | Bitstrom ab +0x0E (MSB zuerst). Blöcke: u16 Symbolzahl, 19er-Längentabelle
  (5-Bit-Zähler, 3-Bit-Längen, „111“+Einsen = 7+, 2-Bit-Nullenlauf nach den ersten drei), Literal/Längen-
  Längen (9-Bit-Zähler, Symbole 0/1/2 = Nullenläufe 1 / 3+4 Bit / 20+9 Bit, 3..18 = Länge 1..16, Wurzel
  12 Bit), Distanztabelle (14 Symbole, 4-Bit-Zähler, Wurzel 8 Bit). Literal < 0x100, Länge = Symbol − 0xFD,
  Distanz d → 0 bzw. (d−1) Extra-Bits + 2^(d−1), Quelle = Pos − 1 − Distanz (8-KiB-Fenster). Am Gerät: CRC
  stimmt, 243/250 Records = Flash. → `core/werksbank.ts`: Werks-Pattern-Bank als .e2sallpat, vom Gerät in 1,4 s.

- **Slice-Records (0x750000, 0x444):** = ESLI ab +0x58 (nicht +0x50 wie electribe2-re schreibt): 64 × {start, length,
  attack, amplitude} LE32, 64 Steps (0xFF = leer), u8 Schritte, u8 Beat, u8 aktive Slices, 1 Byte Rest. Record i
  ↔ Sample i+1 (mutmaßlich). Gerät: 0–402 und 420 beschrieben, 32 mit Slices. `core/sliceFlash.ts`.

## Werkzeug
`python scripts/make_bootsect.py build|vsb|check|extract …` — baut aus `bootloader.bin` den
Boot-Sektor (AIS-Kopf + SBL + Jump + 16-Bit-Wortsumme, exakt wie `install_sbl_to_flash()`), verpackt
ihn mit dem Kopf einer vorhandenen SYSTEM.VSB als BOOT.VSB und prüft beides. Gebaut und rundgeprüft:
`Firmware\vanasoft-bootloader\bootsect-vanasoft-2026-09-16.bin` und
`Firmware\vanasoft-bootloader\BOOT-vanasoft-2026-09-16.VSB`. **Nicht auf die Karte gelegt.**

## Warnungen
1. **Handoff-Patch**: `handoff_factory_firmware()` schreibt `0xEA` nach `0xC0025E4F`. Das ist nur für
   das blaue Synth-Image richtig. In unserem MOD132-/Sampler-Build liegt dort das `ldmfd sp!,{r4,pc}`
   von `DisableMidiClockPulseGeneration` → Absturz beim Sequencer-Stop. Vor „Boot from flash“ mit
   Sampler-Firmware muss der Patch raus (Neubau) — oder man testet nur mit Synth-Crossgrade-Images.
2. **Boot-Sektor-Schreiben ist ein Ein-Schuss-Weg**: Fehler = nur noch JTAG (J9, CH347). Zuerst
   flüchtig testen (SysEx `execute_freetribe.py` über TRS-MIDI oder JTAG-Load), dann installieren.
3. Batterien ≥ Stufe 2 oder Netzteil, sonst bricht das Update ab (Status 0x1A).
4. „Datei von SD booten“ ist im Bootloader-Stand `3a0581f` noch kaputt (Typerkennung auskommentiert);
   „Boot from flash“, „Install“, „Dump“, DFU alt 0/3, GDB laufen laut Code.

## Ghidra
Archiv `G:\Downloads\TekkForge\E2_2026_09_16.gar` → Projekt `G:\Downloads\TekkForge\vanasoft\ghidra\E2.gpr`.
Braucht die Sprache `ARM:LE:32:AM1802` (in `ghidra_12.1_PUBLIC\Ghidra\Processors\ARM\data\languages\ARM.ldefs`
nachgetragen). Headless-Export mit `ExportE2.java` (Kopie im Omnitribe-Vendor-Ordner).

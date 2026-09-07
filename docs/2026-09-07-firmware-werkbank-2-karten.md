# Firmware-Werkbank 2.0 — Karten für Synth und Sampler, Ablage, Analyse, Freigabe

Stand 2026-09-07. Ergänzt `2026-09-06-e2synth-firmware-auf-sampler.md` (Crossgrade)
um alles, was die Werkbank braucht, um **Synth- oder Sampler-Firmware mit
Hacktribe und eigenen Bausteinen zu bauen**, eine **modifizierte Firmware zu
analysieren** und das Ergebnis **für ein Zielgerät freizugeben**.

## 1. Befunde am offiziellen Synth-Abbild v2.02 (`41fc5f1c…`)

Alle Offsets sind Datei-Offsets (RAM = Datei − 0x100 + 0xC0000000). Gefunden mit
Byte-Probes gegen das Sampler-Abbild (`1d0f0689…`) und Hacktribe (`7cb4825c…`),
gegengeprüft in `tests/firmware-karte.test.ts` (läuft gegen die echten Dateien,
wenn `TEKKFORGE_FIRMWARE_DIR` bzw. `../omnitribe/vendor/firmware` sie hat).

| Struktur | Sampler (Stock/Hacktribe) | Synth | Beleg |
|---|---|---|---|
| Init-Pattern „PTST“…„PTED“ (0x3C00) | `0xD0058` | `0xBA9B0` | Rahmen + Name „Init Pattern“ an beiden Stellen |
| Init-Global „GLST“…„GLED“ (0x100) | `0xCFF58` | `0xBA8B0` | Rahmen |
| MFX-Bank (32 × 0x20C) | `0xB5030` (Hacktribe) | `0x9FA28` (Stufenköpfe 32/32 gleich) | Fingerabdruck der drei Stufen |
| IFX-Zeigertabelle (38 × LE32) | `0xAE094` (RAM `0xC00ADF94`) | `0x98A8C` (RAM `0xC009898C`) | Zeiger → Blöcke mit `00 "Punch"` … `"Slicer"` |
| MFX-Zeigertabelle (32 × LE32) | `0xAF490` (RAM `0xC00AF390`) | `0x99E88` (RAM `0xC0099D88`) | Zeiger → Blöcke mit `02 "Mod Delay"` … `"Auto Pan"` |
| IFX-Anzahl-Getter `mov r0,#38` | `0x3F0DC` | `0x39CFC` | Wert 0x26 in beiden Stock-Abbildern, 0x31 (49) in Hacktribe |
| IFX-Spiegelzellen (Max-Index 37 / Anzahl 38) | 12 weitere (siehe `ifxErweiterung.ts`) | `0x43240`, `0x4410C`, `0x85844`, `0x85848`(+1), `0x85880`, `0x8588C`(+1), `0x857E0`, `0x857E4`(+1), `0x85794`(+1), `0x85814`(+1), `0x85830`(+1) | Befehlskontext (`cmp #0x25`, `movle #0x26`, `ldrb`+`cmp`) — die Zelle zu `0xC004A1F8` **fehlt** |
| Oszillator-Tabelle (32 B je Eintrag) | `0xD9BB0`, 421 (Hacktribe 274 belegt) | `0xC14E8`, **84** Einträge (SAW, BOOST-SAW, PULSE, TRIANGLE, SINE, DUAL-SAW …) | ASCII-Namen; direkt dahinter beginnt die Mod-Tabelle |
| Modulations-Tabelle (0x58 je Eintrag, 72) | `0xD82F0` (Hacktribe verlegt nach `0x1A0100`) | `0xC1F68` | „EG+ Filter“ … „Random IFX“ |
| BF523-DSP-Kette (LDR, Signatur 0xAD) | ab `0xF9F10`, 157 Blöcke | ab `0xDFC80`, 154 Blöcke | Kette gültig bis Endblock; erster Block Flags 0x5001 → 0xFFA00000 |
| Startbild (1024 B) | `0xF9954` | **nicht gefunden** | Profil-/Zeiger-Scans liefern nur Rauschen |
| Groove-Bank | `0x143C00` nur Hacktribe („GVST“), Stock 0xFF | keine | — |

Zwei Erkenntnisse, die die Werkbank prägen:

1. **Stock hält Presets über Zeigertabellen, nicht als Bank.** Jeder Zeiger
   zeigt auf einen 0x20C-Block im selben Format wie Hacktribes Bank-Slots — mit
   Name ab +1. Die 38 gezeigten IFX-Blöcke des Samplers sind byte-gleich mit
   Hacktribes Slots 0–37; Hacktribe fädelt sie nur auf. Damit kann die Werkbank
   Stock-Presets (Synth wie Sampler) **ersetzen** — Name inklusive — ohne Code
   anzufassen. Das frühere „Stock-Namen bei +0x7D“ war ein Irrtum: die Blöcke
   an den Hacktribe-Bankadressen sind in Stock etwas anderes.
2. **Die Bauart steht im Payload, nicht im Kopf.** `erkenneKarte` schaut nach
   „PTST“/„GLST“ an der Sampler- oder der Synth-Stelle und nach Hacktribe-Bänken
   (Name in IFX-Slot 0, „GVST“ in Groove 0). Ein umgeköpftes Abbild wird als
   „Synth-Stock, umgeköpft auf Sampler“ erkannt.

## 2. Was daraus wurde (TekkForge v0.7.0)

| Modul | Aufgabe |
|---|---|
| `core/firmwareKarte.ts` | drei Karten, Erkennung, Platz-Auflösung (Bank oder Zeiger), Zähler lesen |
| `core/bunzip2.ts`, `core/bspatch.ts` | bzip2-Dekoder (Port von seek-bzip, MIT) und BSDIFF40-Anwendung; `hacktribeAusStock` mit drei Hash-Prüfungen |
| `core/firmwareAblage.ts` | Ordner-Dateien am SHA-256 einordnen: Synth-Stock, Sampler-Stock, Hacktribe, Patch, eigene, beschädigt, fremd; Basis-Wahlen |
| `core/firmwareAnalyse.ts` | Inhalt aufschlüsseln; Erweiterungen gegen eine Referenz (platzweise/blockweise/Läufe); Übertragbarkeit je Zielkarte; Übernahme mit Drei-Wege-Regel und Nachprüfung |
| `core/firmwareFreigabe.ts` | Zielgerät + laufende Firmware → Kopf, SD-Pfad, Prüfliste (hart/weich), Warnungen, Rückweg |
| `core/firmwareBau.ts` | alle Setzer/Leser mit Karte (Vorgabe Hacktribe, byte-identisch zu v0.6) |
| `gui/firmwareWerkbank.ts`, `gui/tekkFirmware.ts`, `electron/main.cjs` (`firmware:*`) | Ablage-Ordner `userData/firmware`, Basis-Wahl, „Hacktribe erzeugen“, Analyse-Liste mit Auswahl, Ziel-Auswahl, Freigabe vor dem Ablegen |

Regeln, die nie gebrochen werden:

- Keine Korg-Firmware im Repo oder in der App; die Ablage ist der Ordner des Nutzers.
- Hacktribe entsteht nur mit passenden Hashes für Stock, Patch **und** Ergebnis.
- Presets in beide Richtungen; Grooves/Osz/Mod nur nach Hacktribe; Startbild nur
  bei bekannter Lage; DSP/Code nur in dieselbe Bauart und nur auf Stellen, die
  noch die Referenz-Bytes tragen.
- Nach jeder Übernahme: Karte noch erkannt, Zähler stimmig, DSP-Kette gültig — sonst verworfen.
- Der Kopf folgt der **laufenden Firmware**, nicht der Hardware (strikter `family_check`).
- Eine rote harte Prüfung in der Freigabe → keine Datei.

## 3. Offen

1. **Startbild im Synth**: Lage unbekannt (kein Baustein, keine Übernahme).
2. **Dreizehnte IFX-Zelle im Synth** (`0xC004A1F8`-Analog): nicht gefunden; das
   Synth-IFX-Menü bleibt bei 38 (ersetzen statt anhängen).
3. **Am Gerät**: Synth-Crossgrade, Stock-Preset-Ersatz und Init-Pattern über die
   Variantengrenze sind am Abbild belegt, am Gerät nicht abgenommen. Werks-
   `SYSTEM.VSB` der laufenden Firmware als Rückweg auf der SD behalten.
4. Synth-`PCM.VSB`: Größe, Kopf, Update-Weg — unverändert offen (siehe Crossgrade-Doku).

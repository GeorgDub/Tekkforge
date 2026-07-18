# SOFTWARE-BRIEFING: „TekkForge" — Pattern-Editor & Converter für Korg Electribe 2

Version 1.0 · Erstellt 2026-07-18 · Auftraggeber: Georg · Zielplattform: Windows 11 (primär), Linux/macOS (sekundär)

---

## 1. Vision & Zweck

Desktop-Anwendung mit GUI, die den kompletten Pattern-Workflow für die Electribe 2 Sampler (inkl. Hacktribe) am PC abbildet:
Pattern **erstellen, öffnen, bearbeiten, validieren** und als fertige **`.e2spat`/`.e2pat`-Dateien** exportieren — inklusive **Sample-Zuweisung** aus der eigenen Library und **ESX-1-Import** (Konvertierung alter ESX-Pattern in das E2-Format).

Referenz-Implementierung der Kernlogik existiert bereits als Python-Skripte (`make_e2spat.py`, `wire_samples.py`, `sort_parts.py`) — diese bilden den Grundstock der Domain-Library und sind produktiv verifiziert (Byte-identischer Round-Trip mit bangcorrupt/hacktribe-Tooling).

## 2. Zielnutzer & Kernszenarien

**Persona:** Hardware-orientierte Tekk-/Hardtekk-Produzenten, die Pattern lieber am PC vorbereiten (Melodien, Gates, Velocity, IFX-Setups) und live an der E2 zocken.

Kernszenarien (User Stories):
1. *Als Producer* baue ich ein 4-Takt-Pattern im Grid (16 Parts × 64 Steps) mit Noten, Velocity und Gate pro Step und exportiere es als `.e2spat` auf die SD-Karte.
2. *Als Producer* lade ich meine `e2sSample.all` (oder die Sample-Manager-Liste), sehe alle Slots mit Namen/Nummern und weise Parts per Dropdown Samples zu.
3. *Als Producer* öffne ich ein vorhandenes `.e2spat` (auch vom Gerät exportiert), ändere Kleinigkeiten und speichere zurück.
4. *Als Umsteiger* lade ich ein ESX-1-Backup (`.esx`-All-File), sehe die enthaltenen Pattern, konvertiere ausgewählte in E2-Pattern und bearbeite sie vor dem Export.
5. *Als Live-Act* wende ich ein festes Part-Layout-Template an (Kick=1, Snare=3, Bass=9/10, Lead=11, Stabs=12–14, Pad=15, FX=16), damit jedes Pattern gleich „gegriffen" wird.

## 3. Funktionsumfang

### 3.1 MVP (Meilenstein 1)
- **Pattern-Grid-Editor:** 16 Parts × bis 64 Steps; Step-Toggle, pro Step: Note (mit Klaviatur-Popup oder Zahlenfeld, Anzeige als Notenname), Velocity (1–127), Gate (0–96, 96=Tie); Takt-Navigation 1–4; Kopieren/Einfügen von Takten und Parts.
- **Pattern-Globals:** Name (18 ASCII), Tempo (20.0–300.0, ×10-Kodierung), Länge 1–4 Takte, Beat (16/32/8T/16T), Key (12), Scale (35 Einträge, Liste aus elecmidi/tables.h), Swing.
- **Part-Panel:** Osc/Sample (u16), Osc-Edit, Filter-Typ/Cutoff/Reso/EG-Int, Mod Typ/Speed/Depth, Amp Attack/Decay/Level/Pan, Amp-EG an/aus, MFX-Send, Groove Typ/Depth, IFX an/Typ/Edit, Pitch, Glide, Last Step, Voice Assign, Motion-Seq-Modus, Scale-Modus, Priority, Pad-Velocity.
- **Datei-I/O:** `.e2spat` öffnen/speichern (0x100-Header + 0x4000-Datenblock, 'PTST'/'PTED'-Validierung); Neu-aus-Template (Init).
- **Sample-Zuweisung:** Parser für `e2sSample.all` (Slot-Nummern + Namen, Format dokumentiert in untergeekDE/electribe2-docs); Dropdown pro Part mit Suche; Anzeige „Slot fehlt" wenn Pattern auf nicht vorhandene Nummer zeigt.
- **Validierung beim Export:** Magic-Bytes, Größe exakt 0x4100, Notenbereich, Namen-Charset; Warnungen (z. B. Part mit Steps aber Osc=0).

### 3.2 V1 (Meilenstein 2)
- **`.e2sallpat`-Support:** komplette 250er-Bank öffnen, Pattern-Browser, einzelne Pattern extrahieren/ersetzen/umsortieren, Bank speichern (Format: 0x10100-Header + 250 × 0x4000; Merge-Logik siehe hacktribe/e2_merge_patterns.py und e2all2pat.py/e2pat2all.py).
- **Synth-Variante `.e2pat`:** identisches Layout, Header-String `electribe` statt `e2sampler` (Umschaltung beim Export; Konvertierung Sampler↔Synth per Header-Tausch + Osc-Mapping-Warnung).
- **Layout-Templates:** das feste Part-Layout als anwendbares Template (Re-Sort ganzer Part-Blöcke, Logik aus sort_parts.py); eigene Templates definierbar.
- **Motion-Sequenzen:** Datenstruktur ist bekannt (24 Slots: Part[24] + Destination[24] + 64 Werte je Slot ab Daten-Offset 0x100); **Destination-Codes sind noch nicht verlässlich dokumentiert** → V1 liefert Anzeige/Kopieren/Löschen vorhandener Motions; Editieren erst nach Code-Mapping (eigene Reverse-Engineering-Task, s. Risiken).
- **Audio-Vorschau:** Steps mit zugewiesenen Samples im Grid anhören (WAV-Wiedergabe, grobes Pattern-Preview mit Tempo; kein Anspruch auf E2-Klangidentität — IFX/Filter werden nicht emuliert, das wird dem Nutzer klar angezeigt).
- **SysEx-Transfer (optional):** Pattern direkt per USB-MIDI ans Gerät senden (Referenz: hacktribe e2sysex.py / e2pat2syx.py; elecmidi als C-Referenz für Current-Pattern-Dump).

### 3.3 V2 (Meilenstein 3)
- **ESX-Import-Modul** (Details §5).
- Pattern-Set-/Chain-Editor (chainTo/chainRepeat, Belegungsplan-Ansicht).
- Groove-Template-Verwaltung (Import/Export kompatibel zu Hacktribe-Groove-Dateien).
- Batch-Operationen (Transponieren, Tempo-Anpassung über Auswahl, Sample-Renumbering nach Library-Umbau — Logik aus e2_update_pat_samples.py).

## 4. Dateiformat-Spezifikation (verifiziert, bindend für die Implementierung)

### 4.1 `.e2spat` (Einzel-Pattern, 0x4100 Bytes)
- 0x000–0x0FF Datei-Header: 'KORG' + Typ-String @0x10 (`e2sampler\0` bzw. `electribe\0`), Version @0x20 (01 00 00 00), Rest 0xFF.
- 0x100 Datenblock (0x4000):

| Offset (im Datenblock) | Feld |
|---|---|
| 0x000 | 'PTST' |
| 0x010 | Name[18] ASCII |
| 0x022 | Tempo u16 LE (BPM×10) |
| 0x024 | Swing (s8) |
| 0x025 | Länge (0–3 = 1–4 Takte) |
| 0x026 | Beat (0=16, 1=32, 2=8T, 3=16T) |
| 0x027 | Key (0=C … 11=B) |
| 0x028 | Scale (Index, Liste aus tables.h) |
| 0x029 | ChordSet · 0x02A PlayLevel |
| 0x02C | TouchScale[16] · 0x03C MasterFX[8] (+1=Typ) · 0x044/45 Alternate 13-14/15-16 |
| 0x100 | MotionSeq: Part[24] + Dest[24] + 24×64 Werte |
| 0x800 | Part[16] à 0x330 (s. u.) |
| 0x3B00 | ChainTo · 0x3B02 ChainRepeat |
| 0x3BFC | 'PTED' · danach Padding bis 0x4000 |

**Part (0x330):** Header 0x30: lastStep, mute, voiceAssign, motionSeqMode, padVelocity, scaleMode, priority @0x06, **osc u16 LE @0x08**, oscEdit @0x0B, filterType/cutoff/reso/egInt @0x0C–0x0F, modType/Speed/Depth @0x10–0x12, egAttack/egDecay @0x14/0x15, ampLevel/Pan @0x18/0x19, ampEgOn @0x1A, mfxSend @0x1B, grooveType/Depth @0x1C/0x1D, ifxOn/Typ/Edit @0x20–0x22, oscPitch @0x24, oscGlide @0x25. Danach **Step[64] à 12 Bytes:** on, gate(0–96, 96=Tie), velocity, trigger, note[4] (MIDI, C4=60=Originaltonhöhe des Samples), reserved[4].

### 4.2 `.e2sallpat` / `.e2allpat`
0x10100-Header + 250 Slots à 0x4000 (Datenblöcke ohne Einzeldatei-Header). Slot n @ 0x10100 + n×0x4000.

### 4.3 Referenzen
bangcorrupt/hacktribe (scripts, GPL beachten), rafamj/elecmidi (Struct + Wertetabellen), untergeekDE/electribe2-docs (e2sSample.all), maks/elfer (Dart-Editor als UI-Referenz). Korg-Forum-Thread t=95368 („Xanadu") als Ursprungsquelle der Format-Doku.

## 5. ESX-Import-Modul (V2)

**Ziel:** ESX-1-„All"-Backups (SmartMedia/SD-Abbild, `.esx`) laden → Pattern-Liste anzeigen → ausgewählte Pattern nach E2 konvertieren → im Editor öffnen → als `.e2spat`/Bank exportieren.

**Mapping-Konzept (ESX → E2):**
| ESX | E2 | Anmerkung |
|---|---|---|
| 9 Drum-Parts | Parts gem. Layout-Template (Kick=1, Snare=3 …) | 1:1 Trigger/Velocity |
| 2 Keyboard-Parts | Parts 9/11 (Bass/Lead) mit Noten | Notennummern übernehmen |
| Stretch-/Slice-Parts | Sample-Part + Hinweis | Timestretch nicht abbildbar → Warnung |
| 128 Steps | 64 Steps | Pattern >64 Steps auf 2 E2-Pattern splitten (automatisch, benannt „…_A/_B") |
| 3 FX-Prozessoren | 1 IFX/Part + MFX | Best-Effort-Mapping-Tabelle, Rest als Report |
| Sample-Referenzen | Slot-Remapping-Dialog | ESX-Samples optional als WAV extrahieren und in Ziel-Library übernehmen |

**Wichtiger Projektstand:** Ein früher diskutierter ESX→E2-Converter ist in den vorliegenden Unterlagen **nicht auffindbar** — falls vorhandener Code existiert (Georg prüft), wird er als Basis integriert; andernfalls ist das ESX-Binärformat als eigene Reverse-Engineering-Task einzuplanen (Aufwandstreiber Nr. 1 des Moduls; existierende Open-Source-ESX-Tools zuerst evaluieren, bevor selbst dekodiert wird).

## 6. Architektur & Technologie

**Empfehlung: Python 3.12 + PySide6 (Qt)** — Begründung: Kernlogik existiert bereits in Python; schnellste Time-to-MVP; Qt liefert Grid-Widgets, native File-Dialoge, Cross-Platform.

Schichten:
1. **core/** — reine Domain-Library ohne GUI: `e2pat.py` (Parser/Serializer, dataclasses je Struct), `library.py` (e2sSample.all), `templates.py` (Layouts), `validate.py`, später `esx.py`, `sysex.py`. 100 % unit-testbar.
2. **app/** — PySide6: MVVM (Models binden an core-Objekte), Undo/Redo-Stack (QUndoStack) für jede Editier-Operation.
3. **io/** — Datei-Watcher SD-Karte (optional), Backup-Automatik: vor jedem Überschreiben Kopie nach `backups/<timestamp>/`.

Packaging: PyInstaller-Onefile für Windows; Settings als JSON im Userprofil.
**Lizenz-Hinweis:** Hacktribe-Scripts sind GPL — bei Code-Übernahme (statt Neuimplementierung nach Format-Doku) wird das Projekt GPL-pflichtig. Entscheidung vor M1: Cleanroom nach §4 (empfohlen, Doku reicht aus) oder GPL akzeptieren.

## 7. GUI-Entwurf (Screens)

1. **Start:** Zuletzt geöffnet, Neu (aus Template), Öffnen, Bank öffnen, ESX importieren (V2).
2. **Editor (Hauptscreen):** links Part-Liste (16, Farbcode nach Instrument-Kategorie, Mute/Solo fürs Preview), Mitte Step-Grid (Takt-Tabs 1–4, Zoom), rechts Kontext-Panel (Pattern-Globals ↔ Part-Parameter je Auswahl), unten Transport (Preview-Play, Tempo), Statusleiste (Validierung live).
3. **Sample-Browser:** Slot-Tabelle (Nr., Name, Länge, Loop-Flag), Zuweisen per Doppelklick auf selektierten Part, Fehlende-Slots-Report.
4. **Bank-Manager (V1):** 250-Slot-Raster, Drag&Drop-Umsortierung, Import/Export einzelner Slots.
5. **ESX-Import-Wizard (V2):** Datei → Pattern-Auswahl → Mapping-Report (was verlustfrei, was Best-Effort, was verworfen) → Ergebnis in Editor.

UX-Prinzipien: alles tastaturbedienbar (Step-Eingabe wie Tracker: Pfeile + Enter, Notennamen tippbar), destruktive Aktionen nur mit Backup, Deutsch als Erstsprache der UI (i18n-fähig).

## 8. Teststrategie

- **Golden-File-Tests:** Round-Trip Öffnen→Speichern muss byte-identisch sein (Referenz: die 18 vorhandenen Pattern + Geräte-Exporte).
- **Kompatibilitätstest:** Output durch hacktribe-Scripts (e2seqrot -r 0) laufen lassen → Identität.
- **Property-Tests:** Zufalls-Pattern serialisieren/parsen (Hypothesis).
- **Hardware-Abnahme je Release:** definierte Checkliste am echten Gerät (Import, Play, Write, Re-Export, Diff).

## 9. Risiken & offene Punkte

| Risiko | Einstufung | Mitigation |
|---|---|---|
| Motion-Destination-Codes undokumentiert | mittel | eigenes Mapping am Gerät erheben (Motion aufnehmen → exportieren → diffen); bis dahin Feature read-only |
| ESX-Format-Tiefe | hoch (nur V2) | vorhandenen Converter-Code beischaffen; sonst Open-Source-Evaluierung vor Eigenbau |
| Hacktribe-Revisionen (IFX-/Osc-Listen) | niedrig | Listen als editierbare JSON-Ressourcen, Profil „Stock" vs. „Hacktribe" |
| Geräte-Akzeptanz einzelner Header-Varianten | niedrig | Golden Files vom Gerät als einzige Wahrheit |

## 10. Meilensteinplan & Aufwand (grob)

| Meilenstein | Inhalt | Schätzung (Einzelentwickler) |
|---|---|---|
| M0 | core/e2pat.py aus vorhandenen Skripten refaktorieren + Tests | 1–2 Wochen |
| M1 (MVP) | Editor-GUI, e2spat-I/O, Sample-Zuweisung, Validierung | 4–6 Wochen |
| M2 (V1) | Bank-Support, Templates, Motion read-only, Preview, SysEx optional | 4–6 Wochen |
| M3 (V2) | ESX-Import-Wizard | 3–8 Wochen (stark abhängig von Format-Lage) |

**Definition of Done (MVP):** Ein am PC gebautes Pattern wird auf der E2 importiert, klingt wie im Editor angelegt (Steps/Noten/Parameter), und ein am Gerät geändertes Pattern lässt sich öffnen, editieren und ohne Datenverlust zurückschreiben.

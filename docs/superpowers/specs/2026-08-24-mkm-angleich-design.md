# TekkForge ↔ Modern Korg Manager: Optik-Angleich + fehlende Funktionen

Datum: 2026-08-24 · Status: vom Nutzer freigegeben („mach alle sachen nacheinander autonom",
Ergänzung: SoundCloud-Import, wenn nicht zu aufwendig)

## Quelle der Anforderungen

Reverse-Analyse von **Modern Korg Manager v2.1** (Tauri/Rust + WebView2, `kozywav/ModernKorgManager`)
per CDP-Durchklick am 2026-08-24. Screenshots im Session-Scratchpad (`mkm-*.png`).
MKMs Module: Korg Assistent (Dashboard + lokaler Hilfe-Chat), Sample Bank Workshop,
Audio/MIDI zu Korg (5-Schritt-Wizard mit Piano Roll), Stems & BPM Fit (Engine dort nicht
installiert — bei uns läuft sie), Einstellungen mit Theme Studio, YouTube zu WAV,
BPM Analyzer (Tempo/Tonart/Camelot), GitHub-Update-Check.

**Nicht übernommen** (TekkForge hat Besseres oder MKM nur Fassade): Stem-Splitter-UI
(unsere Demucs-Pipeline läuft), KI-Generator (gibt es dort nicht), Geräte-RAM/Pad-Deck.
**Bewusst ausgelassen:** Audio→MIDI-Transkription (eigenes Großprojekt, später),
Hilfe-Chat-Assistent (unser Generator-Tab hat schon Claude-Anbindung).

## Reihenfolge (jedes Paket einzeln committen, Tests grün, App-Probe per Treiber)

### Paket 1 — Optik: Dashboard, Icon-Leiste, Statuszeile, Themes

- **Shell-Umbau in `index.html` + `src/gui/main.ts`:** schmale Icon-Leiste links
  (Start, Editor, Converter, Panel, Pad-Deck, Generator, Einstellungen), Kopfzeile
  bleibt schlank; unten eine Statuszeile (aktives Modul, MIDI-Status, Meldungen).
  Bestehende Tab-Knopf-IDs (`tabEditor` …) bleiben erhalten — Treiber/Abläufe brechen nicht.
- **Neuer Start-Tab (`src/gui/start.ts`, View `viewStart`):** Willkommens-Karte,
  Statuskacheln (Patterns im Projekt, Samples im Pool, Sample-RAM-MB, MIDI-Status),
  Schnellzugriff-Knöpfe in die Module, „Letzte Dateien" (localStorage, max 8 Einträge),
  Geräte-Karte (Electribe 2 Sampler / Firmware-Modus).
- **Themes (`src/gui/theme.ts` + Einstellungs-Tab `viewSettings`):** Paletten als
  CSS-Variablen-Presets — `TekkForge` (heutiger Look, Standard), `Dark Studio`,
  `Midnight`, `Deep Ocean`, `Neon Pulse`, `Carbon`. Wahl in localStorage; Vorschau-Kacheln.
  Kein Theme-Editor (YAGNI), nur Presets + Akzentfarbe frei wählbar.
- Tests: Theme-Store (Preset anwenden/persistieren), Letzte-Dateien-Rotation.

### Paket 2 — Sample-Bibliothek + Auto-Backup

- **Bibliotheks-Ansicht im Editor-Pool ausbauen (`src/gui/editor.ts` + `src/core/samplePool`-Logik):**
  Filter Alle/Factory(1–500)/User(501+), Textsuche, Kategorie-Spalte, +12-dB-Flag je Sample
  (aus .all-Metadaten, falls vorhanden), **Speicherbalken** gegen das ~24-MB-Sample-RAM
  (mono-Sekunden-Budget aus `esxToE2sBank`-Wissen).
- **Auto-Backup (`src/core/backup.ts` + Electron-Bridge):** vor jedem Überschreiben
  einer .all/.e2sallpat im Projektordner Kopie nach `TekkForge/backups/<name>-<lfd>.bak`,
  Rotation: 20 behalten. Backup-Manager-Karte (Liste, wiederherstellen, Ordner öffnen)
  im Einstellungs-Tab. Nur aktiv, wenn Dateisystem-Bridge da (Electron).
- Tests: Rotationslogik, Filterlogik, RAM-Balken-Rechnung (reine Funktionen).

### Paket 3 — MIDI-Import + Piano Roll

- **`src/core/midiImport.ts`:** SMF-Parser (Format 0/1: Header, Tempo-Map, Noten je Track,
  Program/Kanal), Abbildung auf E2-Pattern: Spur→Part-Zuordnung, Quantisierung auf 16tel
  (Länge 16/32/64, Triolen raus), Velocity/Gate übernehmen, bis 4 Töne je Step (Akkord-Slots
  wie im Editor), Drum-Kanal 10 → Drum-Parts.
- **Wizard-Ansicht `viewMidi` (`src/gui/midiImport.ts`):** Schritt 1 Datei(en) laden →
  Schritt 2 Track-Mapping-Tabelle (Spur, Noten, Kanal → Ziel-Part/aus) → Schritt 3
  **Piano Roll** (Canvas: Noten sehen, verschieben, löschen, Vorhören über den
  vorhandenen Preview-Player) → Schritt 4 Quantisierung/BPM → Übergabe in den Editor
  (bestehender `loadProject`-Handoff).
- Tests: SMF-Parsing (Fixture-Bytes), Quantisierung, Mapping-Regeln.

### Paket 4 — YouTube/SoundCloud zu WAV + BPM/Tonart

- **`electron/main.cjs` + `scripts/`-Probe:** yt-dlp + ffmpeg erkennen (wie Python-Probe);
  IPC `urlImport(url)` → yt-dlp lädt Audio (YouTube **und SoundCloud** — gleiche Engine),
  ffmpeg wandelt nach 44,1-kHz-WAV in einen Temp-Ordner, Pfad zurück an die GUI.
- **GUI:** im Generator-Tab bei „Lied analysieren" ein URL-Feld + „Von URL holen";
  Ergebnis-WAV läuft danach durch die bestehende Lied-Pipeline. Zusätzlich im
  Editor-Pool „Sample von URL".
- **`src/core/keyAnalyse.ts`:** Tonart-Erkennung (Chromagramm + Krumhansl-Profile) →
  „A-Moll / 8A"-Camelot-Angabe; angezeigt in der Lied-Analyse und im Scan.
- Tests: Camelot-Zuordnung, Tonart auf synthetischen Akkorden, URL-Weichen (yt-dlp fehlt →
  klare Meldung, Knopf aus).

## Fehlerbilder

- Ohne Electron-Bridge (reiner Browser): Backup, URL-Import aus; Knöpfe mit Grund-Tooltip.
- yt-dlp/ffmpeg fehlen: Probe meldet es, URL-Feld deaktiviert mit Meldung.
- SMF kaputt: Fehlermeldung mit Byte-Position, kein halb geladener Zustand.

## Teststrategie

Kern rein in vitest (Parser, Rotation, Tonart, Quantisierung — keine DOM-Abhängigkeit);
GUI-Abnahme je Paket über `run-tekkforge`-Treiber mit Screenshots; `pnpm check` + volle
Suite vor jedem Commit.

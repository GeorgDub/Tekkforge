# TekkForge

**Electribe 2 Pattern-Editor & KORG ESX-1 Converter** — eigenständige Desktop-App,
gebaut auf dem hardware-verifizierten Format-Kern von Synthstudio (v3.271+).

Zwei Werkzeuge in einer App (Tab-Umschaltung):

1. **Pattern-Editor** — E2-Sampler-Patterns von Grund auf am PC bauen (ohne ESX-Datei):
   16-Part-Grid × 16/32/64 Steps, Noten/Velocity/Gate pro Step, eigene WAV-Samples
   importieren und den Parts zuweisen, vorhören, exportieren als `.e2spat` (Einzel-Pattern)
   oder `.e2sallpat` + `.all` (Bank + Sample-Bank).
2. **ESX-Converter** — ein ESX-1-All-Backup (`.esx`) in importfertige E2-Dateien wandeln.

Alles läuft **lokal** — Desktop-App (Electron), Browser (Single-File-HTML) oder CLI (Node).
Keine Datei verlässt den Rechner.

## Ausgabe-Dateien

| Datei | Inhalt |
|---|---|
| `<name>.e2spat` | Einzel-Pattern (16 640 Bytes) — direkt am Gerät ladbar |
| `<name>.e2sallpat` | Pattern-Bank, 250 Slots (4 161 792 Bytes) |
| `<name>-samples.all` | Sample-Bank (`e2sSample.all`-Format), User-Samples ab Nr. 501 |
| `<name>-mapping.md` | (Converter) Report: Geräte-Nr. ↔ Name ↔ ESX-Index + Anleitung |
| `*.tekkforge` | Projekt-Datei des Editors (Patterns + eingebettete Samples, JSON) |

## Schnellstart

```bash
pnpm install
pnpm desktop        # baut die GUI und startet die Electron-Desktop-App
```

Weitere Modi:

```bash
pnpm build          # baut CLI (dist/cli.mjs) + GUI (dist/index.html)
pnpm dev            # GUI im Browser-Dev-Server (Vite)
pnpm dist:win       # Windows-Installer (NSIS) + Portable nach release/
```

Die gebaute `dist/index.html` ist selbsttragend (kein Server) und lässt sich auch einfach
im Browser doppelklicken.

## Pattern-Editor — Workflow

1. **Samples laden:** WAVs in den Sample-Pool (rechts) ziehen — werden auf Mono/44.1 kHz
   konvertiert und ab Nr. 501 durchnummeriert.
2. **Pattern bauen:** BPM/Name/Länge oben setzen. Im Grid pro Part ein Sample im Dropdown
   wählen. **Klick** auf eine Step-Zelle = an/aus. **Rechtsklick** = Note (Klaviatur-Popup),
   Velocity, Gate (96 = Tie).
3. **Vorhören:** ▶-Button spielt das Pattern (Web Audio; kein Filter/IFX — grobes Preview).
4. **Exportieren:** *Pattern → .e2spat* für ein einzelnes Pattern, oder
   *Bank → .e2sallpat + .all* für alle Patterns + Sample-Bank.
5. **Projekt** speichern/öffnen (`.tekkforge`) behält Patterns **und** Samples.

## ESX-Converter — CLI

```bash
node dist/cli.mjs convert BOTTROP.ESX -o out/
node dist/cli.mjs inspect BOTTROP.ESX          # Pattern-/Sample-Liste
node dist/cli.mjs inspect out/BOTTROP.e2sallpat
```

Optionen für `convert`: `-o/--out <dir>`, `--base <n>` (erste Sample-Nr., Default 501),
`--cap <sek>` (Sample-RAM-Deckel mono, Default 260), `--only <regex>` (Pattern-Filter).

## Import am Gerät

1. Dateien auf die SD-Karte (`KORG/…`).
2. Zuerst die `.all`-**Sample-Bank** importieren (User-Samples ab 501).
3. Dann die `.e2sallpat`-**Pattern-Bank** (oder ein `.e2spat`) — die Parts zeigen bereits
   auf die richtigen Sample-Nummern.

Überschreitet die Sample-Menge das Sample-RAM (~270 s mono), warnt die App und lässt
überzählige Samples weg — so schlägt der Geräte-Import nicht fehl.

## Step-Record-Layout (verifiziert)

TekkForge korrigiert das aus Synthstudio übernommene Step-Encoding. Byte-Histogramme über
KORG-Factory-Files (BodyTalk1, Advi$ory1, e2s-2016-Bank) und hardware-getestete
Hardtekk-Patterns ergaben das echte 12-Byte-Layout:

| Byte | Bedeutung |
|---|---|
| 0 | Trigger (0/1) |
| 1 | Gate 0–96 (96 = Tie), 0xFF = Factory-Tie-Sentinel |
| 2 | Velocity 0–127 (Default 0x60 = 96) |
| 3 | Flag (0/1) |
| 4 | Note (MIDI, 0x3C = C4 = Originaltonhöhe des Samples) |

Die frühere Annahme („Byte 1 = Velocity, Byte 2 = konstant 0x60") war falsch — dadurch
gingen Melodien verloren und Velocity/Gate landeten im falschen Byte. Details in
`src/core/electribeImport.ts`.

## Entwicklung

```bash
pnpm check          # TypeScript
pnpm test           # Vitest (171 Tests: Golden-File + Round-Trip + Editor)
```

Tests gegen große Dateien werden übersprungen, wenn die Fixtures fehlen:

- `E:/esx/BOTTROP.ESX` — reales ESX-1-Backup (End-to-End-Konvertierung)
- `examples/e2s/` — hardware-akzeptierte Golden Files (Round-Trip)
- `examples/golden/` — Factory-/Hardtekk-`.e2spat` (Step-Layout-Verifikation)

## Architektur

```
src/core/   reine Domain-Library (kein DOM, kein Node) — isomorph
  editorModel.ts           Pattern-Editor-Datenmodell + Export + Projekt-Serialisierung
  wavCodec.ts              WAV-Parser (8/16/24/32-int, 32/64-float) + 16-bit-Encoder
  esxParser.ts             ESX-1 All-Backup Parser (Big-Endian)
  esxToE2sBank.ts          Converter ESX → .e2sallpat + .all
  e2sBankBuilder.ts        e2sSample.all Writer (esli-Container, OSC_0index, UFix)
  e2sBankReader.ts         e2sSample.all Parser
  electribePatternBuilder.ts  .e2spat/.e2sallpat Pattern-Serializer (PTST/PTED)
  electribeImport.ts       .e2sallpat Parser + Format-Konstanten (Step-Layout)
  e2sExport.ts             250-Slot-Bank-Assembly (Template-Overlay, byte-exakt)
  audioProcessor.ts        Resampling + Float→i16 (defensive Sanitization)
  bankDetect.ts            Format-Erkennung (.esx vs .all)
src/gui/    Browser/Electron-UI (Vanilla TS → Vite Single-File-Bundle)
  editor.ts    Pattern-Grid, Sample-Pool, Popover, Export
  preview.ts   Web-Audio-Vorhör-Player (Lookahead-Scheduler)
  converter.ts ESX-Converter-Tab
src/cli.ts     Node-CLI (esbuild-Bundle → dist/cli.mjs)
electron/      Electron-Shell (contextIsolation, sandbox, CSP — kein Node im Renderer)
tests/         Vitest — portierte Synthstudio-Tests + Editor-/WAV-/Golden-Tests
```

Format-Referenzen: Korg-Forum t=95368, bangcorrupt/hacktribe, rafamj/elecmidi,
untergeekDE/electribe2-docs. Byte-Offsets hardware-verifiziert (siehe Kommentare in `src/core/`).

## Roadmap (aus dem TekkForge-Briefing)

- **M1:** ESX→E2-Konvertierung mit Pattern-Auswahl, CLI + GUI ✅
- **M2:** Pattern-Grid-Editor (16×64, Noten/Velocity/Gate), Sample-Pool, `.e2spat`-Export,
  Desktop-App, Vorhören ✅
- **M3:** Bank-Manager (umsortieren/ersetzen), Layout-Templates, Motion read-only,
  SysEx-Transfer, Hardware-Abnahme am Gerät
```

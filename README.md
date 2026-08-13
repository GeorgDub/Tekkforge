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

## Sample-Nummerierung (geräteverifiziert)

Zwei Regeln, die sich nur am Gerät bzw. über die Selbstkonsistenz echter Dateien
belegen lassen — TekkForge hat beide bis 0.2.x verletzt und dadurch Bänke gebaut,
die am Gerät um eins verschoben klangen. Beide Fehler waren unsichtbar, weil ein
Versatz von *eins* immer ein plausibles Sample liefert, nur eben das falsche.

**1. In der `.all` IST der Tabellen-Index die Geräte-Nummer.**

Die Offset-Tabelle steht bei `0x0010` und hat **1020** LE32-Einträge (nicht 250 ab
`0x07E0` — das sah nur so aus, weil das erste Werks-Sample bei Nr. 500 liegt und
`0x0010 + 500*4 == 0x07E0` ergibt). Jedes Sample trägt seine Nummer ein zweites Mal
im `korg/esli`-Chunk als `OSC_0index`, und beide müssen übereinstimmen:

```
Tabellen-Index == esli.OSC_0index == Anzeige am Gerät
```

Belegt über 47 reale Bänke; `parseE2sBank` prüft es bei jedem Einlesen selbst und
meldet einen konstanten Versatz als `slotNumbering.kind === "constant-shift"`.

**2. Die Pattern-Referenz liegt um eins darunter.**

Am Gerät gemessen (dreifach unabhängig): Parts, die 584/586/588 referenzieren,
spielen die Samples, die in der Bank auf 585/587/589 liegen.

```
Bank-Slot (OSC_0index) == Pattern-Referenz + 1
```

Umgesetzt in `e2PatternRefToBankNumber` / `bankNumberToE2PatternRef` — nie als
nacktes `± 1` an der Fundstelle.

Prüfen lässt sich eine gebaute Bank mit Omnitribes Geometrie-Check
(`tools/formats/e2s_geometry_check.py`); erwartet wird `Versatz: OK`.

## NRPN / Live-FX (Hacktribe, experimentell)

Neben dem SysEx-Pattern-Transfer versteht die Hacktribe-Firmware **NRPN** —
damit lassen sich einzelne FX-Parameter, das Bedienfeld und Motion-Steps live
steuern, waehrend das Geraet spielt.

Im Part-Popover zeigt TekkForge zum eingestellten `ifxType` den **Effektnamen und
seine Parameterliste** (statt nur nackter Indizes) und kann einen Parameter per
NRPN ans Geraet schicken.

⚠ **Nur mit Hacktribe-Firmware.** Ein Stock-Geraet hat keine NRPN-Schicht und
ignoriert die Nachrichten stillschweigend. Der Sendeweg ist in TekkForge **nicht
am Geraet erprobt** — die Byte-Kodierung folgt den Messungen aus dem
Omnitribe-Pruefprotokoll, ein Hardware-Abnahmelauf steht aus.

Eine Falle, die im Code dokumentiert ist: fuer dieselben Bedienelemente gibt es
**zwei** Kodierungen — `0x01`–`0x0A` beim NRPN-Senden (Live-RAM-Map) und
`0x41`–`0x4A` im Preset-Blob der Flash-Presets. Beide sind am Geraet belegt; es
sind zwei verschiedene Strukturen, keine konkurrierenden Deutungen. Wer nur die
Preset-Doku liest, "korrigiert" `FX_SOURCE_CONTROL` auf `0x4x` und bricht damit
das Senden.

Nicht uebernommen: die NRPN-Flaeche der **OmniTribe**-Firmware
(`nrpn_map.json`, ~126 Eintraege) und deren eigenes SysEx-Protokoll OTP
(`F0 7D …`). Beides gilt fuer eine Firmware, mit der TekkForge nicht spricht.

### RAM-Zugriff (Peek/Poke) — Lesepfad angebunden

Hacktribe hat **kein** eigenes FX- oder Groove-SysEx; der Editor schreibt
typisierte Bytes an feste Adressen im AM1808-Adressraum. `hacktribeRam.ts`
bildet diese Kommandos ab (`0x52` lesen, `0x53`/`0x54` schreiben) samt
Adresskarte fuer IFX-/MFX-Presets, FX-Edit-Buffer und Groove-Templates.

Angebunden ist bislang nur das **Lesen**: nach einem NRPN-Send liest „Pruefen"
den FX-Edit-Buffer aus dem Geraet zurueck und vergleicht den Wert. Damit wird
aus „gesendet" ein pruefbares „angekommen" — MIDI quittiert von sich aus nichts.

Drei Leitlinien setzt das Modul durch:

1. **Nur DDR2** (`0xC0000000`–`0xCFFFFFFF`). Der On-Chip-RAM ab `0x80000000`
   ist Boot-Loader-Gebiet; `validateRamRange` lehnt alles andere hart ab.
2. **Kein Flash, kein Execute.** Fuer `0x55`/`0x56`/`0x57` gibt es absichtlich
   keine Bauer. Flash ueberlebt den Power-Cycle — ein Fehler dort ist nicht
   mehr durch Aus- und Einschalten zu beheben; bei RAM schon.
3. **Chunking** mit eigener Adress-Setzung pro Haeppchen. `buildRamWriteFrames`
   gibt Adresse und Daten nur paarweise heraus, damit die zweistufige
   Reihenfolge nicht vertauscht werden kann.

Das RAM-Panel im MIDI-Bereich (zugeklappt, rot umrandet) kann **lesen und
schreiben**. Der Schreibweg ist bewusst nicht abkuerzbar:

```
Vorher-Lesen  ->  Bestaetigen  ->  paarweise schreiben  ->  Zuruecklesen  ->  Vergleich
```

- **Ohne erfolgreiche Vorher-Lesung wird nicht geschrieben.** Kein Schnappschuss
  heisst kein Rueckweg — das ist ein harter Abbruch, keine wegklickbare Warnung.
- **Zwei Klicks.** „Schreiben vorbereiten" prueft nur und sichert den Vorher-Stand
  und sagt, wie viele Bytes sich aendern wuerden; erst „Wirklich schreiben"
  sendet. Kein modaler Dialog, der die App blockieren koennte.
- **Laenge muss exakt passen.** Weicht die Hex-Eingabe von der gelesenen Laenge
  ab, wird abgelehnt — sonst landet ein zu kurzer Block an einer gueltigen
  Adresse, und das faellt erst nach dem Schreiben auf.
- **Jeder Write wird zurueckgelesen und verglichen.** Ein Write ohne
  Rueckleseprobe ist ein Write, von dem man nichts weiss.
- **„Zurueckschreiben"** stellt den Vorher-Stand wieder her — ueber denselben
  Pfad inklusive Rueckleseprobe. Der Knopf traegt seine Zieladresse im Text und
  bleibt auch stehen, wenn danach Adresse oder Struktur geaendert werden: er ist
  der Rueckweg und soll nicht durch ein Antippen verschwinden. Der Schnappschuss
  gilt nur fuer den zuletzt vorbereiteten Write und liegt im Speicher — nach dem
  Schliessen der App ist er weg. Wer an Presets herumprobiert, liest sie vorher
  aus und sichert sie.
- Struktur-Auswahl und Adressfeld koennen nicht auseinanderlaufen: eine
  Handeingabe der Adresse setzt die Struktur auf „frei" zurueck.

⚠ **Das Geraet darf waehrend des Schreibens nicht spielen** — RAM-Writes koennen
mit der Wiedergabe kollidieren, und TekkForge kann das nicht pruefen.

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

## Lizenz

**GPL-3.0-or-later** — siehe [LICENSE](LICENSE).

`src/core/e2sysex.ts` ist eine Portierung des SysEx-Protokolls aus
[bangcorrupt/hacktribe](https://github.com/bangcorrupt/hacktribe) (GPL-3.0); die
`.all`-Struktur ist gegen [Oe2sSLE](https://github.com/JonathanTaquet/Oe2sSLE)
(GPL-2.0+) verifiziert. Herkunft und Umfang stehen in [NOTICE](NOTICE).

KORG, Electribe und ESX-1 sind Marken der KORG Inc. Dieses Projekt steht in
keiner Verbindung zu KORG.

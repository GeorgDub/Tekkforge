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

Zwei Regeln, die sich nur am Gerät belegen lassen — TekkForge hat beide mehrfach
falsch geraten und dadurch Bänke gebaut, die am Gerät verschoben erschienen.
Beide Fehler sind unsichtbar, solange man nur eine Seite betrachtet: ein kleiner
Versatz liefert immer ein plausibles Sample, nur eben das falsche — oder einen
leeren ersten Platz.

**1. Die Anzeige am Gerät ist das Nummernfeld (`esli.OSC_0index`) PLUS EINS —
der Tabellenindex ist für die Anzeige irrelevant.**

Die Offset-Tabelle steht bei `0x0010` und hat **1020** LE32-Einträge (nicht 250 ab
`0x07E0` — das sah nur so aus, weil `0x0010 + 500*4 == 0x07E0` ergibt). Am Gerät
abgelesen mit der ENTKOPPELTEN Minimalbank `SLOTNUM2.all` (2026-08-15), bei der
Index und Nummernfeld absichtlich auseinanderlaufen:

```
Index 499, OSC 551  →  Anzeige 552
Index 549, OSC 502  →  Anzeige 503        Anzeige == OSC_0index + 1
Index 520, OSC 520  →  Anzeige 521
```

Die erste Messreihe (`SLOTNUM.all`, 2026-08-14) hatte OSC = Index + 1 gekoppelt
und ließ deshalb zwei Deutungen zu; entschieden haben die entkoppelte Probe und
die **vom Gerät selbst geschriebene** `e2sSample.all`, die ihre User-Samples auf
Index == OSC == 500.. legt. Das ist zugleich die Geräte-Konvention beim Bauen:

```
Tabellen-Index == esli.OSC_0index == Anzeige − 1
```

Ein Sample, das als **501** erscheinen soll, trägt also in BEIDEN Feldern
**500**. Umgesetzt in `displayNumberToOsc` / `oscToDisplayNumber` /
`displayNumberToSlotIndex`; `parseE2sBank` prüft die Konvention bei jedem
Einlesen selbst und meldet Abweichungen als
`slotNumbering.kind === "constant-shift"`. (Damit erklärt sich auch die zuvor
rätselhafte `luknkicks.all`: OSC 501.. → erscheint ab 502.)

**2. Die Pattern-Referenz liegt um eins unter der Anzeige.**

Am Gerät gemessen: das SLOTNUM-Set — der Part mit Referenz 500 spielt das
Sample mit OSC 500, das als 501 erscheint; eine Bank ohne OSC 500 lässt
denselben Part leer.

```
Anzeige am Gerät == Pattern-Referenz + 1      (Referenz == OSC_0index)
```

Umgesetzt in `e2PatternRefToBankNumber` / `bankNumberToE2PatternRef` — nie als
nacktes `± 1` an der Fundstelle.

Prüfen lässt sich eine gebaute Bank mit Omnitribes Geometrie-Check
(`tools/formats/e2s_geometry_check.py`): er vergleicht Tabellen-Index gegen
`OSC_0index`, und da TekkForge der Geräte-Konvention Index == OSC folgt, wird
`Versatz: OK` erwartet.

## Firmware-Modus: Stock oder Hacktribe

TekkForge läuft mit der **Stock-KORG-Firmware** und mit **Hacktribe** — im
MIDI-Panel steht die Auswahl „Firmware am Gerät" (gemerkt in `localStorage`,
Default **Stock**). „🧪 Firmware erkennen" schickt eine harmlose 4-Byte-RAM-
Leseanfrage (CMD 0x52): Antwort = Hacktribe, Timeout = Stock (am Gerät geprüft
2026-08-22). Ein belegter MIDI-Port sieht wie Stock aus — der Statustext sagt
das dazu.

| Funktion | Stock | Hacktribe |
|---|---|---|
| Pattern → Edit-Buffer / Slot (SysEx, ACK-Prüfung), Pattern ← Gerät, Global | ✅ | ✅ |
| E2S-Panel: Regler-CCs in beide Richtungen, Auto-Sync, Program Change, Alternate | ✅ | ✅ |
| Panel-Live-Mute | per Edit-Buffer-Übertragung (~1 s) | sofort per NRPN |
| IFX-Parameter live senden (Part-Popup) | ausgeblendet | ✅ (NRPN) |
| Geräte-RAM lesen/schreiben, „FX-Puffer lesen" | ausgeblendet | ✅ |

Logik in `src/core/firmwareMode.ts` (`featureAvailable`, `featureHint`,
`firmwareFromProbe`), Tests in `tests/firmware-mode.test.ts`.

### Pattern vorbereiten, während ein anderes läuft

Zwei SysEx-Wege, beide am Gerät bei **laufendem Sequencer** geprüft (2026-08-22):

- **Slot ← Gerät holen** (0x1C → 0x4C mit Slot-Nummer): liest einen Slot aus dem
  internen Speicher ins Projekt — Vorschau oder Bearbeiten von Pattern 50,
  während 10 spielt. Das spielende Pattern bleibt unberührt. Bei laufendem
  Gerät geht etwa jede vierte Antwort verloren, darum bis zu drei Anläufe.
- **Pattern → Slot…** schreibt jetzt **direkt** (0x4C mit Slot-Nummer, „save to
  Internal Memory" laut KORG) — nicht mehr über Edit-Buffer + 0x11. Das
  laufende Pattern wird nicht ersetzt; der Slot ist fertig, wenn man per
  Program Change hinwechselt.
- **Edit-Buffer ← Gerät** (0x10) holt weiterhin das, was gerade spielt — bei
  laufendem Sequencer unzuverlässig (Auto-Sync wartet deshalb auf den Stopp).

Kein „kurz wechseln, dumpen, zurück" nötig.

### Pad-Deck (Tab)

Frei konfigurierbares Pad-Raster (1–8 × 1–8, 4 Seiten); jedes Pad führt eine
**Aktionsliste** aus (`src/core/padDeck.ts`, Tests `tests/pad-deck.test.ts`,
GUI `src/gui/paddeck.ts`):

| Aktion | Was passiert |
|---|---|
| Pattern wechseln | Program Change (s. o.; greift bei laufendem Sequencer am Taktende) |
| Pattern-Kopie mit Änderungen | Slot per 0x1C vom Gerät holen (Fallback: Projekt), Part-Parameter/Volume/Pan/Mute/BPM ändern, als 0x40 in den Edit-Buffer — flüchtig, kein Slot wird überschrieben |
| Regler-CC | Part-Regler (Cutoff, Reso, …), IFX On, MFX Send, Master-FX X/Y/On |
| Mutes | Parts stumm/an (Hacktribe: NRPN sofort, Stock: Übertragung) |
| Transport | Play (Clock + Start), Stop, Panic |
| Morph | gewählte Regler über N Takte (tempo-synchron) oder Sekunden auf Zielwerte fahren, Fortschrittsbalken im Pad |

Je Pad: Label, Farbe, Tastaturkürzel (Standard 1–0, q–p, a–l, y–m), MIDI-Learn
(Note oder CC vom Controller), Quantisierung „sofort" oder „nächster Takt"
(Basis: Panel-Transport + Pattern-Tempo). Das aktive Pattern wird im Pad
hervorgehoben. Das Deck liegt im Projekt (`.tekkforge`) und lässt sich als
JSON exportieren/importieren; „Beispiel-Deck" baut aus den Projekt-Patterns
ein Start-Deck (Blockanfänge, Filter-/IFX-Varianten, Transport/Mutes, Morphs).
✔ Am Gerät geprüft 2026-08-22: Pattern-Pad, Kopie-Pad (Pattern 1 per 0x1C,
Cutoff 40 → Edit-Buffer), Morph über 4 Takte.

**Controller-Eingang:** Im Pad-Deck lässt sich ein zweiter MIDI-Eingang wählen
(z. B. Akai MIDImix). Der läuft als eigener Port im Electron-Worker
(`openIn2`), seine Nachrichten werden mit `quelle: "controller"` markiert und
gehen **nur** ans Pad-Deck (Learn/Trigger) — nicht in SysEx-Parser,
Regler-Spiegel oder Program-Change-Dekoder. Auswahl wird in `localStorage`
gemerkt und nur wiederhergestellt, wenn der Port noch existiert. ✔ Geprüft
2026-08-22 mit MIDImix: Learn („Note 3 Kanal 1") und Trigger (→ Pattern 1).

### Fernbedienung im E2S-Panel (Stock-MIDI)

`src/core/e2Remote.ts` (Tests `tests/e2-remote.test.ts`) — alles über normale
MIDI-Nachrichten, also mit Stock **und** Hacktribe:

| Bedienung im Panel | Weg zum Gerät |
|---|---|
| LED-Buttons IFX On / MFX Send | CC 104 / 105 auf dem Part-Kanal **+** Edit-Buffer-Übertragung |
| LED-Buttons Amp EG, LPF/HPF/BPF (gleiches Band nochmal = Filter aus) | Edit-Buffer-Übertragung (kein CC bekannt) |
| Auswahlregler Sample (Pool), Mod-Typ, IFX-Typ — ziehen | Edit-Buffer-Übertragung |
| Value-Regler und Pad-Modus **Pattern Set** (Takt 1–4 = Seiten, Pads = Patterns 1–64) | Bank Select + Program Change — **0-basiert, Bank im LSB** (Pattern N → CC0 0, CC32 (N−1) div 128, Program (N−1) mod 128); **nur bei laufendem Sequencer** |
| Pad-Modus **Trigger** (Part anspielen), **Keyboard** (Pads chromatisch ab C3 auf dem aktiven Part) | Note On/Off auf dem Part-Kanal |
| Pad-Modus **Part Erase** | löscht alle Steps, Live per Übertragung |
| Transport ▶ / ■ | ▶ = **MIDI-Clock** (0xF8, 24 ppqn, im Pattern-Tempo, drift-korrigiert im Electron-Worker) + Start; ■ = Stop + Clock aus. Schalter „MIDI-Clock" in der Toolbar. Das Gerät folgt nur bei Global „Clock Mode" **Auto/Ext** — bei Internal ignoriert es Start/Stop (gemessen). ✔ **Am Gerät bestätigt 2026-08-22:** mit Clock Mode „Auto" nimmt die E2S Play/Stop/Clock aus TekkForge an |
| **Master Fx**-Button, **X/Y-Pad** | CC 106 (On/Off), CC 102/103 (X/Y) auf dem Global-Kanal |
| **⛔ Panic** | All Sound Off (CC 120) + All Notes Off (CC 123) auf allen 16 Kanälen — Klasse A, unabhängig vom Receive-Filter |

**Gemessen 2026-08-22** (E2 Sampler v2.2, Kanal 1, Receive-Filter Off, Display
abgelesen): Program 100 → Pattern **101**, Program 1 → **2**, Program 2 → **3**;
Bank MSB 0 + LSB 1 + Program 0 → **129**; CC0 0 + CC32 1 + Program 5 → **134**.
Das Gerät zählt also 0-basiert — KORGs MIDI-Implementation („Pattern 001 =
Program 1") stimmt hier nicht. Bank im MSB wird ignoriert, und **CC0 (MSB 0)
muss vorangehen**: CC32 1 + Program 5 ohne CC0 → Pattern 6 (Bank ignoriert).
Synthstudios `e2sPatternOut.ts` lässt CC0 bewusst weg — damit sind dort die
Patterns 129–250 nicht erreichbar. **Bei gestopptem Sequencer ignoriert das Gerät
Program Change vollständig** (mehrfach gemessen, Display und Edit-Buffer
unverändert); der Wechsel greift nur während der Wiedergabe am Taktende. Der
Statustext im Panel sagt das. Empfangene Program Changes werden mit derselben
Konvention dekodiert (Bank-LSB aus CC 32).
✔ **Ablauf aus dem Panel am Gerät abgenommen (2026-08-22, Clock Mode Auto):**
▶ → Pattern-Set-Pad → ■ → Auto-Sync liefert das gewählte Pattern
(Pattern 49 → „Dr T2 VOX 3", Pattern 2 → „Dr T1 AUF 1").

## NRPN / Live-FX (Hacktribe, experimentell)

Neben dem SysEx-Pattern-Transfer versteht die Hacktribe-Firmware **NRPN** —
damit lassen sich einzelne FX-Parameter, das Bedienfeld und Motion-Steps live
steuern, waehrend das Geraet spielt.

Im Part-Popover zeigt TekkForge zum eingestellten `ifxType` den **Effektnamen und
seine Parameterliste** (statt nur nackter Indizes) und kann einen Parameter per
NRPN ans Geraet schicken.

⚠ **Nur mit Hacktribe-Firmware.** Ein Stock-Geraet hat keine NRPN-Schicht und
ignoriert die Nachrichten stillschweigend.

**Am Geraet belegt (2026-08-14).** `bit_depth` und `sample_freq` eines
Decimators auf Part 3 per NRPN veraendert — die Klangaenderung war hoerbar, in
drei aufeinanderfolgenden Zyklen reproduzierbar. Damit sind Kodierung,
MIDI-Kanal, Empfang und die Slot-Rechnung bestaetigt: gesendet wurde auf
FX-Slot 4, geaendert hat sich **Part 3** — genau `(3-1)*2`. Ein Off-by-one
haette Part 2 oder 4 getroffen, und die trugen andere Effekte.

☠ **Der FX-Puffer taugt NICHT als Gegenprobe.** `FX_EDIT_BUFFER_BASE`
(`0xC03478A8`) spiegelt Live-Aenderungen nicht — nach einem NRPN-Send blieben
alle 3746 Bytes unveraendert, und nach einem Knopfdreh **am Geraet selbst**
ebenfalls. Der Bereich zeigt offenbar den Stand beim Pattern-Laden. Ein
Vergleich dagegen meldet immer „Abweichung" und laesst einen funktionierenden
Sendeweg kaputt aussehen — genau dieser Fehlschluss ist hier passiert und hat
mehrere Messungen gekostet. Ein NRPN-Send ist derzeit **nur akustisch**
pruefbar.

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
- **Getaktet, nicht geflutet.** Pro Haeppchen `0x53` (Adresse) -> Pause ->
  `0x54` (Daten) -> **auf das ACK `0x21` des Geraets warten** -> Pause. Ohne
  das ACK zeigt die Electribe bei jedem Versuch „Midi error", der am Geraet
  mit Exit quittiert werden muss — und solange der Dialog steht, verarbeitet
  sie kein SysEx mehr.
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

### Erprobungsstand — am Geraet belegt

Lesen **und** Schreiben sind gegen echte Hardware nachgewiesen (2026-08-13,
E2 Sampler mit Hacktribe). Der Abnahmelauf an IFX-Preset-Slot 40:

```
vorher:            00 4C 50 20 44 72 69 76 65   "LP Drive"
Byte 1: 4C -> 4D
SCHREIBEN: OK  524 Bytes geschrieben und zurueckgelesen — identisch
danach:            00 4D 50 20 44 72 69 76 65   "MP Drive"
UNDO:      OK  524 Bytes geschrieben und zurueckgelesen — identisch
wiederhergestellt: 00 4C 50 20 44 72 69 76 65   "LP Drive"
```

**Die Ursache, an der es vorher scheiterte, ist eine Lehre wert.** Der Write
lief protokollkonform durch, das Geraet bestaetigte mit ACK `0x21` — und der
Speicher aenderte sich nicht. Grund: die Antwort auf die **Adress-Setzung
(`0x53`) wurde nicht abgeholt**. Das Warten nach dem Datenframe fing dann das
verspaetete Adress-ACK ein und meldete Erfolg, waehrend der Datenframe
unquittiert blieb. Im MIDI-Mitschnitt sieht beides identisch aus — ein ACK
nach dem Datenframe —, weshalb das lange unsichtbar war. Die Urquelle
(hacktribe `e2sysex.py`) holt die Antwort mit dem Kommentar „Ignore response
for now" ab: Inhalt egal, aber sie muss vom Draht.

Drei Fehlschlaege vorher, alle mit derselben Ursache: IFX-Preset 0 (aktiv),
Live-FX-Puffer, IFX-Preset 40 — Zieladresse und Aktivzustand waren nie das
Problem.

**Erprobungsstand Lesen.** Der **Lesepfad ist am Geraet belegt**: an einem Electribe 2
Sampler mit Hacktribe liefert `0xC00A80F0` / 524 B das IFX-Preset „Punch", und
die Kette Struktur-Auswahl -> Adresse -> Lesen -> Hex-Dump -> Vorher-Lesung ->
Vergleich laeuft durch (die Vorbereitung meldet bei unveraenderter Eingabe
korrekt „identisch, ein Write aendert nichts"). Der **Schreibvorgang selbst ist
nicht erprobt** — er wurde bewusst nicht ausgeloest. Die Rueckleseprobe ist das,
was ihn beim ersten echten Versuch belegt oder widerlegt.

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

## Sample-Ordner → Bank + Pattern-Set

Aus einem beliebigen flachen Sample-Ordner (One-Shots, Loops, Vocals, ganze
Tracks, Stems) entsteht in drei Schritten ein Paar `<name>.all` + `<NAME>.e2sallpat`:

```bash
python scripts/prep-folder.py "<ordner>" examples/e2s/<name> --prefix Xx --bpm 180 [--overrides o.json]
npx tsx scripts/make-folder-bank.mjs examples/e2s/<name> examples/e2s/<name>.all 501        # oder 601 --tekk-drums
npx tsx scripts/make-folder-set.mjs examples/e2s/<name>/bank-<name>.json examples/e2s/<NAME>.e2sallpat --bpm 180 --prefix Xx [--konzept k.json]
npx tsx scripts/check-folder-sets.mjs    # Referenzen/Mutes/Chains aller Paare
```

`prep-folder.py` ordnet jede Datei per Name/Länge/Pegel einer Rolle zu (kick,
snare, clap, hat, perc, ton, bass, fx, vox, melo, track), bringt Loops per
Varispeed auf ganze Takte und lässt sie **ganz** (bis 8 Takte; länger → genau
zwei Hälften A/B), zerlegt Vocal-Sammlungen an Pausen und holt aus ganzen Tracks
per Demucs 8-Takt-Fenster (DROP/BREAK/VAR; MELO = bass+other, VOX = vocals).
8-Takter laufen am Gerät über das Alternate-Paar: Part 13 triggert, Part 14
schweigt, so läuft das Sample zwei Pattern-Durchläufe durch; Hälften B spielen
in der zweiten Hälfte des Arrangement-Blocks.
`make-folder-set.mjs` baut daraus 250 Patterns: je Thema (Melodie × Kick-
Familie × Vocal-Loop/zweite Melodie) ein gechainter Arrangement-Block, dahinter
KICKPARADE-Patterns (16 Kicks, jeder Beat ein anderer) und ALLES je Thema.
Parts ohne Steps sind gemutet, Percs/Stabs/FX wandern je Pattern durch die Pools.

Gebaute Sets (2026-08-22), Quelle `G:\Samples Numondo\Sampler USE`:

| Set | Quelle | BPM | Inhalt |
|---|---|---|---|
| `korg3` / `KORG3` | Korg/Samples v3 | 180 | 16 Kicks (RoBBaFFerT …), 7 Melos (bgg, HyPer 8 Takte), GZUZ-Vocal als Vers |
| `korg2` / `KORG2` | Korg/Samples v2 | 180 | LuZz-Kicks, MeTaLLiC-Hats, 5 Melos (varispeed auf 4 Takte), tekk4-Drums ab 501 |
| `korg1` / `KORG1` | Korg/Samples | 180 | 40 Kicks in 12 Familien („Kick-Battle"), 8 Snares, 5 Bässe, HaWk/bush als Melo |
| `heiko` / `HEIKO` | Korg Sampler TOP/Project1 DJHeiko | 180 | 10 Songs à ME + SP (8-Takt-Loops) als Melo/Melo2, tekk4-Drums |
| `project5` / `PROJECT5` | Korg Sampler TOP/Project5 | 180 | 203 Samples: 56 Kicks/18 Familien, 80 Tons/Percs, Hardtekk-Vocal-Shots, 5 Synth-Loops |
| `durchgetekkt` / `DURCHGETEKKT` | DURCHGETEKKTSAMPLEEEEPROJEKT | 165 | 26 Kick-Varianten, dhrc/Intro/melo 2 als Melo, Vocal-Phrasen |
| `rauschgift` / `RAUSCHGIFT` | Korg/Rauschgift (Stems 88 BPM) | 176 | 4 × 8-Takt-Fenster des Other-Stems, 4 Vocal-Loops, Sweeps als Riser |
| `tommi` / `TOMMI` | Korg/Tommi (Tracks 1/4/5, 95 BPM) | 190 | je Track DROP/BREAK/VAR (Demucs bass+other), WhatsApp-Vocals 4 Loops; Track 2 ist leer |
| `neulee` / `NEULEE` | neulee (16 Horror-Sprachsamples, mp3) | 180 | 34 Sprach-Shots an Pausen, Takt-Chunks als Vers, Chor-Drone als Melo; tekk4-Drums |
| `melopack` / `MELOPACK` | MeLo_PacK_2 (905 Dateien, 5,4 h) | 180 | **Volume 1 von 25**: 34 taktgenaue Melodien (je Namensfamilie die beste), 17 Themen à Melo + Melo2; weitere mit `--select --volume N` |
| `melopack2` / `MELOPACK2` | MeLo_PacK_2, Volume 2 | 180 | 35 Melodien (Rangplätze 35–69), 18 Themen à Melo + Melo2 |
| `melopack3` / `MELOPACK3` | MeLo_PacK_2, Volume 3 | 180 | 37 Melodien, 19 Themen à Melo + Melo2 |
| `melopack4` / `MELOPACK4` | MeLo_PacK_2, Volume 4 | 180 | 33 Dateien (30 Melo-Paare), 15 Themen × 16 |
| `melopack5` / `MELOPACK5` | MeLo_PacK_2, Volume 5 | 180 | 34 Dateien (28 Melo-Paare + Bass), 14 Themen × 17 |

Nicht verwertbar: fünf Hat-Dateien in Project5 (kein gültiges WAV), `katze.wav`/`sp.wav` (still).
Ordner, die das Sample-RAM sprengen (MeLo_PacK_2), nimmt `prep-folder.py --select` in
Budget-Scheiben: Rangliste nach Taktgenauigkeit, Pegel und „melo" im Namen, je Namensfamilie
zuerst das beste Stück; `--volume N` baut die N-te Scheibe.

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

# TekkForge

**Electribe 2 Pattern-Editor & KORG ESX-1 Converter** — eigenständige Desktop-App,
gebaut auf dem hardware-verifizierten Format-Kern von Synthstudio (v3.271+).

Werkzeuge in einer App (Icon-Leiste links, Start-Dashboard mit Statuskacheln,
Themes unter „Einstellungen"):

1. **Pattern-Editor** — E2-Sampler-Patterns von Grund auf am PC bauen (ohne ESX-Datei):
   16-Part-Grid × 16/32/64 Steps, Noten/Velocity/Gate pro Step, eigene WAV-Samples
   importieren und den Parts zuweisen, vorhören, exportieren als `.e2spat` (Einzel-Pattern)
   oder `.e2sallpat` + `.all` (Bank + Sample-Bank). Der Sample-Pool ist eine kleine
   Bibliothek: Filter Alle/Factory/User, Suche, +12-dB-Flag, Speicherbalken (~24 MB).
2. **ESX-Converter** — ein ESX-1-All-Backup (`.esx`) in importfertige E2-Dateien wandeln.
3. **MIDI zu Korg** — SMF-Dateien (.mid/.kar/.rmi) ODER Audio laden (Audio wird
   einstimmig zu Noten transkribiert), Spuren den Parts zuordnen, Noten im Piano
   Roll sichten/abwaehlen/verschieben, als 4-Takt-Patterns in den Editor uebernehmen.
4. **Generator** — Bank + Patterns aus einem Sample-Ordner oder direkt aus einem Lied
   (Demucs-Stems, Drum-Schnitt, Tonart/Camelot-Anzeige); Lieder auch per
   YouTube-/SoundCloud-Link holen (braucht `pip install yt-dlp imageio-ffmpeg`).
   Mit Demucs deckt die Aufbau-Kette die **ganze Vocalspur** ab: alle hoerbaren
   8-Takt-Abschnitte werden getrennt, die Vocal-Paare wandern ueber die Kette
   (AUF → DROP → VRS-Patterns), der Drop kickt hoerbar haerter als der Aufbau.

Dazu: Hilfe-Chat-Assistent auf dem Start-Tab (nutzt den API-Key aus den
Einstellungen) und GitHub-Update-Check unter „Einstellungen → Über TekkForge".

Beim Speichern auf Platte/SD sichert die App den alten Stand automatisch nach
`backups/` (20 Staende je Datei; Manager unter „Einstellungen").

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
| `*.e2fxp` / `*.e2gv` | Einzelnes FX-Preset (524 B) bzw. Groove-Vorlage (320 B), roher RAM-Block |
| `*.tfsam` | Sammlung mehrerer Presets/Grooves in einer Datei (JSON + Base64), optional mit Ziel-Platz je Eintrag |
| `*.tfbau` | Bauplan fuer die Firmware-Werkbank: Presets/Grooves mit Platz, Init-Pattern, Startbild, Init-Global, Basis-Hash |

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
5. **Generator** (Tab): Sample-Verzeichnis wählen (Unterordner werden mitgescannt; nur
   `TekkForge/` und versteckte Ordner bleiben draußen) → Scan zeigt Rollen, Tempo-Vorschlag und
   RAM-Bedarf → „Bank bauen" (`.all` speichern, per SD laden) → Jam-Pattern, Mini-Set (6
   gechainte Patterns) oder Pro Melo erzeugen → „→ Datei" oder „→ Editor". Melodien bleiben
   ganz; Melos, die das Taktraster verfehlen, werden über ihr Eigentempo per Varispeed aufs
   Bank-Tempo gezogen, und ihre Waveform steuert die Steps (Stab auf den stärksten Melo-Onsets,
   Bass weicht Melo-Bass aus). Die Beschreibung steuert Kick/Bass/Stab per Schlüsselwort.
   **Aufbau-Kette** (Checkbox, Standard an): alle Patterns tragen dieselben vollen Steps,
   entmutet wird stufenweise — Melo+Snare → Hats → Clap/Perc → Bass/Stab → Vers/Shots →
   DROP mit Kick (je Stufe 2 Durchgänge, per Chain verbunden). Spielweise am Gerät ist
   Mute/Unmute: jedes Part lässt sich in jedem Pattern von Hand dazuholen.
   In der Desktop-App außerdem: „Projekt speichern" legt `<Verzeichnis>/TekkForge/<name>.all`
   + `projekt.json` an, „auf SD kopieren" schreibt nach `<SD>6\`, „als geladen markieren"
   merkt sich die Bank (überlebt Neustarts) und gibt „→ Gerät ab Slot N" frei — Patterns gehen
   dann per 0x4C-Slot-Dump ans Gerät, ohne das laufende Pattern zu stören.
   **KI (Premium):** Mit Anthropic-API-Key (Feld im Tab, gespeichert in den App-Einstellungen,
   nie im Projekt) übersetzt Claude (`claude-opus-5`, Server-Fallback) die Beschreibung in das
   Rezept-JSON; die Antwort läuft durch dieselbe Prüfung wie der Regel-Planer, bei Fehler oder
   Timeout (25 s) greift der Regel-Planer mit Hinweis. Pro Melo holt in einem Aufruf eine
   Rezept-Liste (je Melodie eines, Timeout 5 min); fehlende Melodien füllt der Regel-Planer auf.
   Modell-ID in der KI-Zeile wählbar (`claude-opus-5` Standard, Sonnet 5, Opus 4.8, Haiku 4.5 oder frei).
   **Lied analysieren:** Audiodatei wählen → Tempo messen (oder eintragen), Half-/Double-Time in
   die Tekk-Oktave, drei 8-Takt-Fenster DROP / BREAK / VAR als je ein Melodie-Sample; mit Python +
   Demucs („Stems per Demucs", `scripts/stems.py`) als bass+other plus Vocals als Vox-Loop, sonst
   Vollmix. Aus dem Drums-Stem des lautesten Fensters werden Kick/Snare/Hat-One-Shots
   geschnitten (abschaltbar per „eigene Drums statt Lied-Drums" — dann tekk4/Ordner-Drums).
   Die Fenster lassen sich vor dem Bankbau vorhören (▶/■). **„Alles aus dem Lied"** macht den
   ganzen Weg in einem Klick: Analysieren → Stems → Drums schneiden → Bank bauen → Patterns
   erzeugen — das Lied ist der einzige Input.

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
| Panel-Live-Mute | per Edit-Buffer-Übertragung (~1 s) | per NRPN — ⚠ **am Gerät unbestätigt**, siehe Hinweis unten |
| IFX-Parameter live senden (Part-Popup) | ausgeblendet | ✅ (NRPN) |
| Geräte-RAM lesen/schreiben, „FX-Puffer lesen" | ausgeblendet | ✅ |

Logik in `src/core/firmwareMode.ts` (`featureAvailable`, `featureHint`,
`firmwareFromProbe`), Tests in `tests/firmware-mode.test.ts`.

### Geräte-Spiegel und NRPN-Werkbank (Panel-Tab)

Hacktribe **meldet jeden Griff am Gerät** als NRPN — welcher Pad-Modus aktiv
ist, welches Bedienelement bewegt wurde, wohin. `src/core/nrpnEmpfang.ts` liest
diesen Strom (Tests `tests/nrpn-empfang.test.ts`) und der Panel-Tab zeigt ihn
als Liste: `Ch5 Panel · Keyboard · Shift — gedrückt`.

Der Leser ist **zustandsbehaftet**, und das ist kein Detail: Nach der ersten
vollständigen Folge schickt das Gerät bei weiteren Änderungen desselben
Elements **nur noch den Wert** (CC 0x26). Wer jede Nachricht für sich liest,
verliert ab der zweiten den Bezug. Der Stand liegt je Kanal vor, weil der Kanal
den aktiven Part trägt.

⚠ Die Meldungen kommen nur, wenn am Gerät die versteckte Einstellung
„NRPN-Ausgabe" aktiv ist — deren Byte-Index hat der Hacktribe-Autor nirgends
veröffentlicht. Dafür gibt es die **NRPN-Werkbank** daneben: beliebige
Nachricht senden (Kategorie / LSB / DATA-MSB / Wert) und in der Spiegelung
sehen, ob etwas passiert. Voreingestellt ist die einzige dokumentierte
Einstellung — Global `0/44/1` = MIDI-Thru an (Diskussion #189). Nach einer
Global-Änderung am Gerät **Write** drücken, sonst ist sie nach dem Ausschalten
weg; beim Suchen also bewusst *nicht* drücken.

⚠ **Offene Frage zum Panel-NRPN.** Das Hacktribe-Wiki (`MIDI.md`) sagt:
„Physical controls **send** NRPN messages, **reception of controls is not
implemented yet**. Only FX editing is currently implemented for received NRPN."
Demnach würde das Gerät unsere Panel-Nachrichten (Mute/Solo/Trigger) gar nicht
annehmen — der Live-Mute-Weg wäre wirkungslos. Das Januar-2025-Update hat
Empfang für Global- und Sequenz-Parameter ergänzt, das Wiki könnte also
veraltet sein. **Am Gerät zu prüfen**; bis dahin gilt der Edit-Buffer-Weg als
der belegte. Umgekehrt ist der Sende-Weg des Geräts interessant: es meldet
jeden Knopfdruck als NRPN, wenn die versteckte Einstellung „NRPN-Ausgabe"
aktiv ist.

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

### Beispiel-Presets zum Ausprobieren

`examples/fx-presets/` enthaelt 216 fertig eingestellte FX-Presets als rohe
524-B-Bloecke, plus zwoelf `.tfsam`-Sammlungen, die sie gruppenweise laden — in
sechs Sets:

| Set | Art | Inhalt |
|---|---|---|
| **Starter** | Insert (`.e2fxp`) | Tekk-Werkzeug: Zerre, Bitcrusher, Ringmodulator, Delay |
| **Starter** | Master (`.mfx`) | die Summe: Kompressor, EQ, Zerre, Filter, Delays |
| **Farben** | Insert (`.e2fxp`) | formen statt zerlegen: Kompression, EQ, Exciter, Chorus |
| **Raum & Bewegung** | Master (`.mfx`) | Hall, Wah, Modulation, Looper |
| **Bewegung** | Insert (`.e2fxp`) | alles im Takt: LFO-Ringmod, Rechteck-Tremolo, die drei Level-Mod-Spielarten der Werks-Presets, synchrone Flanger/Phaser, Roller |
| **Tekk-Modulation** | Master (`.mfx`) | kein Hall: Wobble-Filter, LFO auf der Zerre, Slicer, LFO-Wah, LFO-Bitcrusher, wobbelnde Delays, Grain im Takt |

Je zwoelf Basis-Presets, dazu **zwei Variationen pro Basis** (`01a-…`/`01b-…`
zu `01-…`): derselbe Algorithmus, in eine Richtung verschoben — zum
Vergleichen am Geraet. Zusammen decken die sechs Sets **alle 20 Insert- und 24
der 25 Master-Algorithmen** ab. Die beiden Bewegungs-Sets stuetzen sich auf die
dekodierten **Werks-Presets des Geraets** (Level-Mod-Quellen 3/4/0, Sync-Noten
6–8, Play/Start als LFO-Reset) statt auf Vermutungen; drei neue Sonden darin
fragen nach der LFO-Wellenform-Tabelle und dem `mod_src` von Wah und Decimator.

Sieben Paare sind zugleich **Sonden**: zwei Dateien, die sich in einem Byte
unterscheiden, klaeren am Ohr, was in den Format-Unterlagen offen ist. Die
Hoerabnahme lief am 2026-09-01 am Geraet; die Ergebnisse — 36 ist bei allen
EQs neutral, `off_duration` ist woertlich die Aus-Phase, Mute laesst sich per
`fader` nicht oeffnen, die Kettenfolge ist deutlich hoerbar, und das
Geraetemenue zaehlt Plaetze ab 1 (das Platz-Feld im Panel zaehlt seitdem
genauso) — stehen in
[`examples/fx-presets/README.md`](examples/fx-presets/README.md) und als
Kommentare in `e2FxParams.ts`. Offen blieb nur die Benennung der drei
`output_select`-Stellungen (hoerbar verschieden, aber unbenannt).

Alle mit Namen fuers Geraetemenue; die jeweils nicht genutzte Haelfte der Kette
steht auf Thru, damit ein Schreiben die andere nicht mit umstellt. Die
Master-Dateien heissen `.mfx`, weil `ausDatei()` auf diese Endung die Art —
und damit die Zieladresse — selbst umstellt.

Damit laesst sich der Schreibpfad pruefen, ohne vorher etwas vom Geraet gelesen
zu haben. Erzeugt von `scripts/make-fx-presets.mjs`; Listen, Bedienung und die
Frage, welcher Platz ueberhaupt im Menue auftaucht, stehen in
[`examples/fx-presets/README.md`](examples/fx-presets/README.md).

Der Weg Datei → Geraet war bis dahin zu: Laden loescht den Vorher-Stand (der
Schreib-Knopf bleibt verborgen), und die Lesung, die ihn herstellt, holte auch
gleich das Preset des Platzes in den Editor — die Datei war damit wieder weg.
Die Lesung laesst einen geladenen Stand jetzt stehen und liefert nur noch
Adresse, Vorher-Stand und die unbekannten Bytes des Platzes als Unterlage.

Eine ganze Sammlung laesst sich am Stueck **verteilen**: je Eintrag ein
Ziel-Platz (zaehlt wie das Geraetemenue ab 1, leer = uebersprungen), ein
Klick schreibt alle nacheinander — pro Platz erst lesen, dann schreiben mit
Rueckleseprobe, der erste Fehler stoppt die Reihe, doppelte Plaetze derselben
Art starten gar nicht. Die Vorher-Staende lassen sich am Stueck
zurueckschreiben, und die Zuweisung wird in der `.tfsam` mitgespeichert.
Die Plaetze muss niemand einzeln tippen: Startplatz eintragen (oder den
ersten Eintrag setzen) und **▲ aufsteigend** / **▼ absteigend** vergibt sie
in Listen-Reihenfolge, je Art als eigene Reihe, ohne hinter der Art-Grenze
umzubrechen (`nummerierePlaetze` in `core/sammlung.ts`).

**Leere Plaetze und das Menue.** Das Geraetemenue zeigt nur so viele
Insert-Presets, wie 13 Zaehler der Hacktribe-Firmware erlauben (Testgeraet:
49; die Plaetze 50–100 sind im RAM da, aber leer und unsichtbar). Der Haken
**„IFX-Menue danach bis zum hoechsten Platz erweitern“** zieht sie nach dem
Verteilen nach — derselbe Weg wie hacktribes `add_ifx`, nur mit Netz: alle 13
lesen und auf Stimmigkeit pruefen, den neuen Bereich auf Luecken pruefen,
dann alle 13 schreiben mit Rueckleseprobe, und bei einem Abbruch die schon
gesetzten sofort zurueck. „Alle zurueckschreiben“ nimmt auch die Zaehler
zurueck. Das gilt bis zum Ausschalten — dauerhaft ginge nur ueber ein
gepatchtes Firmware-Abbild. Master-Presets lassen sich so nicht erweitern:
alle 32 Plaetze sind belegt, ihr Zaehler ist fest. Modul `core/ifxErweiterung.ts`;
⚠ am Geraet noch nicht abgenommen (Stand 2026-09-02).

**Dauerhaft: in die Firmware einbrennen.** Die Hacktribe-`SYSTEM.VSB` ist ein
0x100-Byte-Header plus ein 1:1-Abbild des RAM (Datei-Offset = RAM-Adresse −
0xC0000000 + 0x100; an der gepatchten Datei gegen die Geraetesicherung
byteweise belegt, keine Pruefsumme ueber den Payload). `core/firmwareBau.ts`
legt eine Sammlung genauso in die Datei wie der RAM-Weg ins Geraet — Presets
byte-treu ueber die Unterlage des Platzes, dann die 13 IFX-Zaehler bis zum
hoechsten belegten Platz, mit Luecken- und Stimmigkeitspruefung; der Test
zaehlt, dass ausserhalb dieser Stellen kein Byte kippt. Das Skript dazu:

```
npx tsx scripts/make-firmware.mjs --basis <Hacktribe-SYSTEM.VSB> --sammlung <.tfsam> --ziel <out.VSB> [--ab 50]
```

Die Basis muss die unveraenderte Hacktribe-Firmware sein (SHA-256 aus
`hacktribe/hash`). Installieren: als `SYSTEM.VSB` nach
`KORG/electribe sampler/System/` auf die SD-Karte, dann die Update-Funktion
des Geraets; zurueck geht es mit der unveraenderten Datei auf demselben Weg.
Erster Bau am 2026-09-02: `IFX-Alle` ab Platz 50 → Platz 50–96 belegt, Menue
bis 96. ✔ **Am Geraet abgenommen (2026-09-02):** die Datei per Update
installiert, die neuen Plaetze sind im Menue — damit sind Abbild-Layout,
Zaehler-Zellen und Schreibweg ins Flash belegt.

### Tekk-Groove-Vorlagen

`examples/grooves/` enthaelt 18 Groove-Vorlagen als `.e2gv` plus die
Sammlung `TekkForge-Grooves-Tekk.tfsam` fuer die Bibliothek des Managers:
gerade Grundbetonung, Push und Drag auf den Achteln, Achtel- und
Sechzehntel-Swing in zwei Staerken, Hat-Ghosts, Kick-Punch, Gate-Chop, Stomp,
Rampen, Rush und Laid Back, dazu „Hardtekk 64" (vier Takte mit eingebautem
Fill) und „Breaker 32" (Bruch alle zwei Takte). Die Werte sind an den 62
Werksvorlagen der Hacktribe-Firmware kalibriert; Step 1 bleibt ueberall an Ort
und Stelle. Erzeugt von `scripts/make-grooves.mjs`, geprueft von
`tests/grooves-beispiele.test.ts`; Liste und Bedienung in
[`examples/grooves/README.md`](examples/grooves/README.md). ⚠ Noch nicht
gehoert.

### Preset-Manager — die ganze Bank als Liste

Unter dem FX-Preset-Bereich liegt der **Preset-Manager**: alle 96 Insert-
und 32 Master-Plaetze als zwei Listen, gezaehlt wie das Geraetemenue ab 1,
mit Name und Algorithmus. Geladen wird ein vollstaendiger Stand aus einer von
drei gleichwertigen Quellen — **vom Geraet** (96 + 32 Lesungen plus die 13
Zaehler), aus einer **Sicherung** (`.tfbak`) oder aus einer **Firmware**
(`.VSB`). Dieser Stand ist die Basis; alles, was man danach umbaut, wird
gegen sie verglichen und farbig markiert.

Beide Listen zeigen **immer alle Plaetze**, leere als „— leer —" — auch
bevor etwas geladen ist. Ein **Suchfeld** filtert alle drei Listen nach Name
oder Algorithmus, und Plaetze mit byteweise gleichem Inhalt tragen ein „≡" mit
den anderen Platznummern — ein Preset zweimal in der Bank ist meist ein
vergessener Vergleichs-Platz. Je Zeile: ▲ ▼ verschieben, ⇄ tauschen, ✏
umbenennen, ✎ im Editor oeffnen (Parameter und Zuordnungen aendern, dann „Aus
Editor uebernehmen…"), ⬇ als Datei sichern, ✕ loeschen (die folgenden Plaetze
ruecken auf, hinten wird ein Platz frei — Listen-Semantik wie das Menue). Dazu
„+ Datei einfuegen…" (Einzelpreset auf den ersten leeren Platz, Sammlung an
ihre Plaetze) und „Als Sammlung sichern…" (alle belegten Plaetze mit
Platznummer als `.tfsam`).

Die dritte Spalte sind die **Groove-Vorlagen** (96 Plaetze, `.e2gv`): dieselben
Wege wie bei den Presets — laden vom Geraet (96 Lesungen a 320 B plus die
Groove-Anzahl), aus Sicherung oder Firmware, verschieben, tauschen,
umbenennen, loeschen, in den Groove-Editor oeffnen und zurueck, als Datei
sichern. Fluechtig geschrieben werden auch hier nur die Unterschiede, danach
die vier Groove-Zaehler bis zum hoechsten belegten Platz
(`grooveMenueErweitern`, nach demselben Muster wie beim IFX-Menue: lesen,
Stimmigkeit, Lueckenpruefung ueber den „GVST"-Rahmen, schreiben, bei Abbruch
zurueck). Ein leerer Groove-Platz ist lauter 0xFF; der Schreibweg legt dort
den ganzen Block ab statt ueber eine Unterlage, die es nicht gibt.

Links daneben die **Bibliothek**: Presets, Grooves und Sammlungen laden
(mehrere auf einmal, Filter IFX/MFX/Grooves), aus dem Editor uebernehmen —
und dann **ziehen und auf einen Platz fallen lassen**. Leerer Platz: das Preset kommt einfach
hinein. Belegter Platz: TekkForge fragt **Ersetzen, davor einfuegen oder
danach einfuegen**; Einfuegen rueckt den Rest nach hinten und faellt durch,
wenn hinten ein belegter Platz herausfiele. Ein IFX-Preset laesst sich nur auf
die IFX-Liste ziehen, ein MFX-Preset nur auf die MFX-Liste. Ohne Ziehen geht
es ueber den →-Knopf am Eintrag (fragt nach dem Platz).

Geschrieben wird nur, was sich gegen die Basis unterscheidet:
- **⚠ Fluechtig schreiben (RAM)** — derselbe geprüfte Weg wie beim Verteilen
  einer Sammlung (`verteileEintraege`: je Platz lesen, schreiben,
  Rueckleseprobe). Danach folgen die Menue-Zaehler der **Bank**: bis zum
  hoechsten belegten Platz nach oben (Lueckenpruefung), und nach unten, wenn
  das oberste Preset geloescht wurde — sonst bliebe ein namenloser Eintrag im
  Geraetemenue. Massgeblich ist der hoechste *belegte* Platz, nicht der
  hoechste *geaenderte*: wer nur Platz 10 umbenennt, waehrend 50–60 belegt
  sind, bekommt 50–60 trotzdem ins Menue. Gilt bis zum Ausschalten; „Alle
  zurueckschreiben" im FX-Preset-Bereich nimmt es zurueck.
- **🔥 Firmware patchen…** — fragt nach der unveraenderten Hacktribe-
  `SYSTEM.VSB`, prueft den Hash, brennt die Unterschiede **zur Datei** ein
  (`baueFirmware`) und legt das Ergebnis unter `Firmware/` ab.

Kern: `core/presetManager.ts` (reine Operationen, jede liefert einen neuen
Zustand), Panel: `gui/presetManager.ts`. Entwurf in
`docs/superpowers/specs/2026-09-02-preset-manager-design.md`. ⚠ Beide
Schreibwege am Geraet noch nicht abgenommen (Stand 2026-09-02).

### Firmware-Werkbank — Presets, Grooves, Init-Pattern, Startbild

Unter dem Preset-Manager liegt die **Firmware-Werkbank**. Sie laedt eine
`SYSTEM.VSB` als Basis — Hacktribe oder eine fruehere TekkForge-Fassung, die
Pruefung verlangt Header, stimmige IFX- und Groove-Zaehler und ein
Init-Pattern an seiner Stelle (`pruefeBasis`) — und brennt darauf ein, was
angehakt ist:

| Baustein | Woher | Wo im Abbild |
|---|---|---|
| Presets | Preset-Manager, Unterschiede **zur Datei** | IFX `0xA81F0`, MFX `0xB5030`, 13 IFX-Zaehler |
| Groove-Vorlagen | `.tfsam` mit Plaetzen | `0x143C00`, Stride 0x140, 4 Groove-Zaehler (`0xC0049DA4`, `0xC007BB90`, `0xC007BB88`+1, `0xC007BB94`+1) |
| Init-Pattern | aktuelles Pattern des Editors oder eine `.e2spat` | `0xD0058`, 0x3C00 Bytes („PTST" … „PTED"; die Datei ist dieser Block hinter 0x100 Header plus 0x400 Nullen) |
| Startbild | Pixel-Editor 128 × 64 | `0xF9954`, 1024 Bytes 1-Bit |
| Init-Global | Global-Block vom Geraet (RAM `0xC00CFE58`) oder 256-Byte-Datei | `0xCFF58`, 256 Bytes „GLST" … „GLED", direkt vor dem Init-Pattern — dasselbe Format wie der Global-Dump (MIDI-Kanal, Clock-Quelle, Chain Mode, Filter, Kontrast). ⚠ Ob das Geraet ihn beim Werksreset nimmt oder als laufenden Stand, ist noch offen. |

Alle Stellen stammen aus hacktribes Skripten (`e2-init-pat.py`,
`ht_splash_screen.py`, `add_groove`) und sind am Abbild gegengeprueft: das
Init-Pattern beginnt dort mit „PTST", der Startbildschirm dekodiert zum
Hacktribe-Logo. Die **Bit-Belegung des Startbilds** (`core/splash.ts`) ist mit
Einzel-Bit-Sonden am Python-Decoder abgeleitet: acht Baender zu acht Zeilen,
ein Byte je Spalte, Bit 7 oben. Die **Polaritaet hat das Geraet entschieden**
(2026-09-03): ein im Editor weiss-auf-schwarz gesetzter Schriftzug kam am
Geraet schwarz-auf-weiss — Bitwert 1 ist also *dunkel*, 0 hell, und
hacktribes `get_image` zeigt das Bild als Negativ. Seitdem zeigt der
Pixel-Editor, was das Geraet zeigt: was man schwarz malt, bleibt am Geraet
dunkel; wer helle Schrift auf dunklem Grund will, malt hell auf dunkel
(„Invertieren"). Damit ist der Startbild-Weg **am Geraet abgenommen**. Der
echte Splash geht byte-genau hin und zurueck (Fixture
`tests/fixtures/splash-hacktribe.json`, dort als Negativ hinterlegt).

Der **Pixel-Editor**: linke Maustaste malt, rechte radiert; „Bild laden…"
passt ein beliebiges Bild seitenverhaeltnis-treu ein und schwellt es nach
Helligkeit (Regler, Invertieren), „aus Firmware" holt das Bild der Basis als
Ausgang, „⬇ PBM" sichert es als 1-Bit-Datei. Dazu **Text schreiben**: eine
eingebaute 5 × 7-Pixelschrift (`core/pixelSchrift.ts` — Grossbuchstaben,
Ziffern, Satzzeichen; Umlaute werden zu AE/OE/UE) setzt ein Wort zentriert
in eine waehlbare Zeile, in Punktgroesse 1×, 2× oder 3× (7, 14 oder 21 Pixel
hoch), ueber das, was schon da ist. Unbekannte Zeichen werden zum Kaestchen,
damit nichts still verschwindet. Das Skript kann dasselbe:

```
npx tsx scripts/make-firmware.mjs --basis <SYSTEM.VSB> --ziel <out.VSB> [--sammlung <.tfsam> --ab 50] [--init-pattern <.e2spat>] [--splash <128x64.pbm>]
```

Geprueft am 2026-09-02 an der echten Hacktribe-Datei: Init-Pattern gegen
`CHORDTEST.e2spat` getauscht (99 Bytes Unterschied, nur im Pattern-Block), das
Original-Startbild als PBM wieder eingebrannt — byte-identisch. ⚠ Am Geraet
sind Init-Pattern, Startbild und Groove-Zaehler noch nicht abgenommen; der
Preset-Weg ist es.

**Den ganzen Geraetestand einbrennen.** Die Komplettsicherung („Geraet
sichern…" im FX-Preset-Bereich) erfasst seit dem 2026-09-03 auch
Groove-Zaehler, Init-Pattern und Startbild — die RAM-Karte ist die einzige
Quelle der Sicherung, und diese drei Bereiche stehen jetzt darin. Die
Werkbank kann so eine `.tfbak` als Ganzes in die Basis legen
(`firmwareAusSicherung`): beide Preset-Baenke, die Groove-Bank, alle Zaehler
aus den gesicherten Werten abgeleitet, Init-Pattern und Startbild. Was man
sich am Geraet im RAM zusammengebaut und gehoert hat, wird damit in einem
Schritt dauerhaft. Aeltere Sicherungen ohne die neuen Bereiche lassen diese
Teile in der Basis stehen; der Bericht nennt sie.

**Bauplan.** „Bauplan sichern…" schreibt die angehakten Bausteine als
`.tfbau` (`core/bauplan.ts`): Presets und Grooves mit Plaetzen, Init-Pattern,
Startbild, Init-Global und den Hash der Basis, auf der er entstand. „Bauplan
laden…" legt alles zurueck — Presets in den Manager (oder in die Bibliothek,
wenn kein Stand geladen ist), den Rest in die Werkbank, Haken gesetzt — und
warnt, wenn die Basis eine andere ist. So wandert ein Umbau auf die naechste
Hacktribe-Fassung oder zu jemand anderem, ohne eine 2-MB-Firmware zu
verschicken. Nach jedem Bau steht ausserdem die **Gegenprobe** im Bericht:
der Vergleich Basis ↔ Ergebnis, Bereich fuer Bereich.

**Zwei Firmwares vergleichen.** „Mit Datei vergleichen…" haelt die Basis
gegen eine zweite `SYSTEM.VSB` (`core/firmwareVergleich.ts`): je Bereich, mit
Platznummern und Namen — IFX/MFX/Groove-Plaetze links ↔ rechts, Zaehler
zusammengefasst („IFX-Anzahl 49 → 96, 7 Zellen"), Init-Pattern-Name,
Startbild als Pixelzahl, und alles ausserhalb der bekannten Bereiche als
Byte-Laeufe mit Offsets. So sieht man, was ein Bau veraendert hat (Hacktribe
gegen den 96er-Bau: genau 47 Plaetze und die Zaehler, sonst nichts), und was
eine fremde Firmware anders macht (Stock gegen Hacktribe: 33 066 Bytes in 185
Laeufen ausserhalb — der eigentliche Patch). Stock-Presets erscheinen dabei
als „leer", weil die Serien-Firmware die Namen an anderer Stelle im Block
haelt (+0x7D statt +0x01, Omnitribes Befund); das ist eine bekannte Grenze,
kein Fehler.

### DSP-Patches — der Klang selbst (experimentell)

Die Klangerzeugung der Electribe laeuft nicht auf dem ARM, sondern auf einem
**ADSP-BF523**. Sein Programm liegt als ADI-LDR-Bootstrom **in der
SYSTEM.VSB**: 157 Bloecke ab Datei-Offset `0xF9F10` (113 fuer das SDRAM, 44
fuer das L1, Ende `0x13C0B0`), jeder mit 16-Byte-Kopf und XOR-Pruefziffer,
die nur den Kopf abdeckt — die Nutzdaten tragen keine Pruefsumme. Omnitribe
hat am Geraet gezeigt, dass gleichlange Aenderungen darin flashbar und
hoerbar sind (ein genullter Block toetete die Sample-Wiedergabe, Stock stellte
sie wieder her). `core/dspPatch.ts` liest diese Kette, prueft jeden Kopf und
wendet Patches an: gleiche Laenge, ganz innerhalb eines Datenblocks, bei
bekannter DSP-Adresse muessen die alten Bytes genau dort stehen (sonst genau
einmal in der Kette vorkommen), danach wird die Kette erneut gelesen. Kein
Kopf wird je angefasst.

In der Werkbank steht dafuer der Abschnitt **DSP-Patches**: das Register
(`core/dspPatchRegister.ts`, erzeugt aus Omnitribes `src/firmware/patches/`
mit `scripts/import-dsp-patches.mjs`) mit elf Patches — Halbcosinus-
Wellentabelle im L1 (`0xFF803BD8`, 129 × int16: halbe/viertel Amplitude,
Dreieck, Null), zwei Kurven im Sample-Pfad (`0x9400` 8 × int16,
`0x99F8` 14 × float 0,02…1,00: halbieren, umkehren, alles Maximum/Minimum)
und eine Vollausschlag-Konstante im L1-Code (`0xFFA00810`). Jeder Eintrag
traegt seinen ehrlichen Stand: **Hoerprobe offen** (niemand hat es gehoert),
**nur Nachweis** (Diskriminator, kein Klang) — „am Geraet gehoert" hat noch
keiner. Die Liste zeigt ausserdem, ob ein Patch in der geladenen Basis
schon drin ist oder nicht zu ihr passt. „Eigene Patch-Datei…" nimmt eine
JSON-Liste `{vaddr, old, new}` (Omnitribes Form) oder ein Objekt mit
`edits`; der Bauplan nimmt DSP-Patches mit alten und neuen Bytes mit, und
der Firmware-Vergleich meldet Aenderungen im DSP-Abbild je Block statt als
fremde Bytes. Alles ist am echten Abbild geprueft (jeder Register-Patch
findet seine Stelle, die Kette bleibt gueltig, kein Byte ausserhalb aendert
sich) — **am Geraet gehoert ist noch keiner**.

**Was damit NICHT geht, ehrlich gesagt.** Die Werks-Samples des Samplers
liegen nicht in der Firmware, sondern im Sample-Flash; hacktribes
`synth-pcm-dump` liest nur die Synth-PCM aus dem RAM (`0xC3000000`) und
schreibt nichts zurueck — **Samples tauschen** ist auf diesem Weg nicht
moeglich, und ein anderer ist nicht bekannt. Hacktribes erweiterte Filter
sind kein DSP-Umbau, sondern Menue-Eintraege, die vorhandene DSP-Programme
freischalten. Was an **Filtern und Modulation** in der Engine steckt, ist
ueber die Tabellen oben nur zu *verbiegen* (Kurven, Wellentabelle), nicht
neu zu bauen: Bloecke verlaengern oder Code umschreiben geht nicht, ohne den
ganzen Bootstrom zu verstehen. Der naechste ehrliche Schritt ist die
Hoerprobe: Patch anhaken, bauen, installieren, hoeren — und den Befund im
Register eintragen.

**Der einzige offene Weg zu eigenen „Werks"-Samples** ist der Sample-Import
selbst: ob das Geraet beim „Sample Import All" auch die Plaetze 1–499
nimmt, steht nirgends. `examples/e2s/WERKSPLATZ.all`
(`scripts/make-werksplatz-probe.mjs`) fragt es mit drei Toenen auf den
Anzeigeplaetzen 1, 250 und 499 („TF WERK 001" A, „TF WERK 250" C#, „TF WERK
499" E). Zeigt Platz 1 danach den Namen und spielt den A-Ton, sind die
Werksplaetze beschreibbar — dann baut die Sample-Pipeline auch dorthin.
⚠ Der Import ersetzt den User-Bereich 501–999; vorher exportieren, und
KORGs Factory-Sample-Datei fuer den Rueckweg bereithalten.

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

Der neue Weg ohne Python (Kern des kommenden Generator-Tabs, nur WAV):

```bash
npx tsx scripts/generator-cli.mjs "<ordner>" --modus jam|miniset|promelo [--bpm 180] [--melo "Name"] [--beschreibung "hart, arp"] [--tekk-drums] [--out <ordner>]
```

Schreibt `<ordner>/TekkForge/<name>.all` + `projekt.json` und das Pattern als
`.e2spat` (Jam: ein Pattern, alle Lagen, Arrangement per Part-Mute am Gerät) bzw.
`.e2sallpat` (Mini-Set: 6 Patterns Intro → Aufbau → Drop → Break → Drop 2 → Outro
gechaint; Pro Melo: ein Jam-Pattern je Melodie). Melodien bleiben ganz (bis 8 Takte
ein Sample, 8-Takter über Alternate 13/14 mit schweigendem Part 14). Module:
`src/core/{tempoAnalyse,sampleScan,bankPlan,rezept,patternGen}.ts`, Spec
`docs/superpowers/specs/2026-08-22-generator-design.md`.

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
| `melopack6` / `MELOPACK6` | MeLo_PacK_2, Volume 6 | 180 | 35 Dateien (33 Melos + 2 FX), 16 Themen × 15 |
| `melopack7` / `MELOPACK7` | MeLo_PacK_2, Volume 7 | 180 | 36 Dateien (35 Melos, GZUZ-Vocal als Shot), 18 Themen × 13 |

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

Die hacktribe-nahen Module (`e2sysex.ts`, `hacktribeNrpn.ts`, `hacktribeRam.ts`,
`e2FxParams.ts`, `e2FxPreset.ts`, `e2Groove.ts`) sind aus
[bangcorrupt/hacktribe(-editor)](https://github.com/bangcorrupt/hacktribe)
portiert — **AGPL-3.0**, geprüft am 2026-08-25; sie tragen deshalb zusätzlich
AGPL-Pflichten. Die `.all`-Struktur ist gegen
[Oe2sSLE](https://github.com/JonathanTaquet/Oe2sSLE) (GPL-2.0+) verifiziert.
Herkunft, Umfang und Lizenzfolgen stehen in [NOTICE](NOTICE).

KORG, Electribe und ESX-1 sind Marken der KORG Inc. Dieses Projekt steht in
keiner Verbindung zu KORG.

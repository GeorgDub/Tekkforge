---
name: run-tekkforge
description: Build, run, screenshot and drive the TekkForge Electron desktop app (Electribe 2 pattern editor / ESX converter). Use when asked to start or launch the app, take a screenshot of it, click through its UI, drive the MIDI or device-RAM panel, or check a change in the real app rather than in tests.
---

TekkForge ist eine Electron-Desktop-App (Vanilla-TS-UI, kein Framework). Für
Agenten wird sie über den Treiber `.claude/skills/run-tekkforge/driver.mjs`
gefahren — **Batch-Modus**, ein Aufruf pro Ablauf.

Alle Pfade sind relativ zur Repo-Wurzel (`G:\IdeaProjects\TekkForge`).

Entwickelt und geprüft unter **Windows 11** mit pnpm 10 / Node 24. Kein xvfb,
kein tmux (gibt es hier nicht) — der Batch-Modus ersetzt beides.

## Setup

```bash
pnpm install
pnpm build:gui      # erzeugt dist/index.html — der Treiber bricht sonst ab
```

`playwright-core` ist devDependency; `pnpm install` reicht. Es wird **kein**
Browser heruntergeladen — der Treiber startet das Electron-Binary des Projekts.

## Run (Agenten-Pfad)

Ein Aufruf, Kommandos mit `;` getrennt, sequenziell abgearbeitet:

```bash
node .claude/skills/run-tekkforge/driver.mjs --run "launch; ss start"
```

Screenshots landen in `.tekkforge-shots/` (via `SCREENSHOT_DIR` umstellbar).

Zum Herumprobieren gibt es auch einen REPL — ohne `--run` starten.

### Kommandos

| Kommando | Wirkung |
|---|---|
| `launch` | App starten, auf die fertige UI warten |
| `midi-on` | „MIDI aktivieren" klicken, auf `#midiControls` warten |
| `ram-open` | `midi-on` + MIDI- und RAM-Panel aufklappen |
| `ss [name]` | Screenshot → `.tekkforge-shots/<name>.png` |
| `click <sel>` | Klick über DOM (nicht über Koordinaten) |
| `set <sel>=<wert>` | Wert setzen + `input`/`change` feuern |
| `wait <sel>` | auf Element warten (15 s) |
| `wait-text <sel> <regex>` | warten, bis der Text passt (20 s) — für Geräteantworten |
| `ms <n>` | n Millisekunden warten |
| `eval <js>` | im Renderer auswerten, JSON ausgeben |
| `text [sel]` | `innerText` ausgeben |
| `dialogs` | aufgetretene native Dialoge auflisten |
| `dialogs accept\|dismiss` | umschalten, wie Dialoge beantwortet werden (Vorgabe `dismiss`) |
| `errors` | Renderer-Fehler seit dem Start |
| `quit` | schließen (passiert im Batch automatisch) |

### Beispiel — Editor ohne Gerät

```bash
node .claude/skills/run-tekkforge/driver.mjs --run "launch; ss editor; set #gName=TEST; click #patAdd; eval Array.from(document.querySelectorAll('#patList li')).map(li=>li.textContent)"
```

Liefert `["1. TEST","2. PATTERN 2"]`.

### Beispiel — Geräte-RAM lesen (**braucht angeschlossene Hardware**)

Electribe 2 Sampler mit Hacktribe-Firmware am USB:

```bash
node .claude/skills/run-tekkforge/driver.mjs --run "launch; ram-open; set #ramStruct=ifxPreset; click #ramRead; wait-text #ramStatus Bytes.gelesen; text #ramDump"
```

Am 2026-08-13 zweimal erfolgreich gefahren: `0xC00A80F0` / 524 B lieferte das
IFX-Preset „Punch" (`C00A80F0  00 50 75 6E 63 68 …`).

⚠ **Ein vorhandener MIDI-Port heißt nicht, dass das Gerät antwortet.** Später
in derselben Sitzung meldete `#midiStatus` unverändert
„verbunden — Ausgang: electribe2 sampler", während dieselbe Leseanfrage
reproduzierbar in den Timeout lief. Aufgeklärt: der KORG-Treiber ist
Single-Client, und parallel lief ein anderes Programm am selben Port. Siehe
Troubleshooting — das ist der erste Verdacht, nicht die Firmware. Der
Fehlerpfad selbst verhält sich sauber: klare Meldung, kein Hänger, Exit 0.

Alle **geräteunabhängigen** Kommandos oben sind dagegen jederzeit reproduzierbar.

### Geräte-Schreibtest (Abnahme) — **braucht Hardware**

```bash
node .claude/skills/run-tekkforge/driver.mjs --script .claude/skills/run-tekkforge/write-test.txt
```

Schreibt ein Byte nach IFX-Preset-Slot 40, liest zurück, stellt per Undo wieder
her. Am 2026-08-13 bestanden:

```
vorher:            00 4C 50 20 44 72 69 76 65   "LP Drive"
Byte 1: 4C -> 4D
SCHREIBEN: ✓ 524 Bytes geschrieben und zurückgelesen — identisch
danach:            00 4D 50 20 44 72 69 76 65   "MP Drive"
UNDO:      ✓ 524 Bytes geschrieben und zurückgelesen — identisch
wiederhergestellt: 00 4C 50 20 44 72 69 76 65   "LP Drive"
```

☠ **So liest man das Ergebnis richtig — sonst hält man einen wirkungslosen
Write für bestanden:**

| Zeile | Bedeutung |
|---|---|
| `spielende Noten` | **muss 0 sein.** Sonst erst Stop am Gerät, dann neu. |
| `SCHREIBEN: ✓` allein | **beweist nichts.** 523 der 524 Bytes wurden unverändert zurückgeschrieben — ein Write, der gar nichts tut, meldet hier genauso „identisch". |
| `danach` ≠ `vorher` | **das ist der eigentliche Nachweis.** Nur wenn sich das geänderte Byte im Rücklesen zeigt, hat der Write gewirkt. |
| `UNDO: ✓` | Gerät steht wieder auf dem Ausgangszustand. Immer mitlaufen lassen. |

## Run (Mensch)

```bash
pnpm desktop        # baut die GUI und öffnet ein Fenster; Fenster schließen zum Beenden
```

## Test / Check

```bash
pnpm test           # vitest — 288 passed, 5 skipped
pnpm check          # tsc --noEmit
```

## Datei in ein Datei-Feld legen

Der Import-Knopf oeffnet einen nativen Dialog, den Playwright nicht bedienen
kann, und `input.files` laesst sich aus JS nicht setzen. Dafuer gibt es `files`:

```bash
node .claude/skills/run-tekkforge/driver.mjs --run   "launch; files #importFile examples/e2s/CHORDTEST.e2spat; ms 1500; eval document.querySelectorAll('#patList li').length"
```

Der Pfad ist relativ zum Projektverzeichnis. Fehlt die Datei, bricht das
Kommando ab, statt still nichts zu tun.

## Gotchas

- **`#midiEnable` ist da, aber unsichtbar.** Es liegt im zugeklappten
  `<details id="midiPanel">`, und ein geschlossenes `<details>` versteckt
  seinen Inhalt. `waitForSelector` braucht `state: "attached"` — auf `visible`
  zu warten läuft in den Timeout, obwohl die App längst bereit ist.

- **`app.close()` hängt, sobald im Editor etwas geändert wurde.**
  `editor.ts` registriert einen `beforeunload`-Handler, der bei ungespeicherten
  Änderungen den „Seite verlassen?"-Dialog auslöst. Der blockiert das Schließen,
  und ein abgewiesener Dialog heißt hier gerade *nicht* schließen. Der Treiber
  ruft deshalb erst `BrowserWindow.destroy()` im Hauptprozess — das umgeht
  `beforeunload`. Symptom ohne diesen Kniff: alle Kommandos laufen durch, dann
  Timeout beim Beenden.

- **Native Dialoge killen den Treiber, nicht nur den Befehl.** Die App nutzt
  `alert()`/`confirm()` (Sample entfernen, Slot überschreiben, MIDI-Fehler).
  Ohne registrierten `page.on("dialog")` stirbt Playwright hart mit
  `Page.handleJavaScriptDialog`. Der Treiber registriert ihn vor dem ersten
  Klick. Vorgabe ist **abweisen**, weil die `confirm()`s an zerstörenden
  Aktionen hängen — wer eine davon auslösen will, schaltet vorher
  `dialogs accept`, sonst passiert stillschweigend nichts.

- **☠ Ein ACK vom Gerät heißt „Nachricht angekommen", NICHT „geschrieben".**
  Der RAM-Write lief über drei Messungen hinweg protokollkonform durch, das
  Gerät bestätigte jedes Häppchen mit `0x21` — und der Speicher änderte sich
  nicht. Ursache: die Antwort auf die **Adress-Setzung (`0x53`) wurde nicht
  abgeholt**. Das Warten nach dem Datenframe fing dann das *verspätete*
  Adress-ACK ein und meldete Erfolg, während der Datenframe unquittiert blieb.

  Im MIDI-Mitschnitt sieht beides identisch aus — ein ACK nach dem Datenframe.
  Deshalb überlebte der Fehler auch das byte-genaue Nachrechnen der Frames.

  Die Urquelle macht es richtig, und ihr Kommentar führt in die Irre:
  `hacktribe/e2sysex.py` `write_cpu_ram` liest nach `0x53` mit *„Ignore
  response for now"*. Das heißt **Inhalt egal, aber sie muss vom Draht** — nicht
  „die Zeile ist bedeutungslos". Genau so hatte ich sie beim ersten
  Quellenvergleich gelesen.

  Wer am Schreibpfad etwas ändert: erst `write-test.txt` laufen lassen und auf
  `danach` ≠ `vorher` schauen, nicht auf den Haken.

- **Nie schreiben, während das Gerät spielt.** Der Treiber zeigt es an
  (`spielende Noten`), prüft es aber nicht selbst — das muss das Skript oder
  der Mensch tun. RAM-Writes können mit der Wiedergabe kollidieren.

- **`<details>` per `el.open = true` aufklappen**, nicht per Klick aufs
  `<summary>` — der Klick trifft je nach Layout daneben.

- **Klicks über `page.evaluate(el => el.click())`**, nicht `locator.click()`.
  DOM-Klick funktioniert auch auf verborgenen Elementen (siehe `#midiEnable`)
  und umgeht die Koordinatenrechnerei.

- **Das MIDI- und das RAM-Panel gibt es ohne MIDI-Brücke gar nicht.**
  `setupRamPanel()` läuft nur, wenn `window.tekkMidi.available` stimmt — im
  reinen Browser (`pnpm dev`) fehlt das Panel komplett. Nur über Electron
  testen.

- **Piping in den REPL braucht `sleep`s, der Batch-Modus nicht.** Eine Pipe
  wartet nicht auf den Prompt; darum `--run`, das jedes `await` abwartet.

## Troubleshooting

- **`dist/index.html fehlt`** → `pnpm build:gui`. Der Treiber prüft das vorab
  und bricht mit dieser Meldung ab, statt in einen Timeout zu laufen.
- **`Timeout 30000ms exceeded … locator('#midiEnable') to be visible`** → auf
  `state: "attached"` warten (siehe Gotchas). Tritt auf, wenn jemand den
  Treiber „aufräumt".
- **`#midiControls bleibt versteckt`** → keine MIDI-Brücke. Läuft die App
  wirklich unter Electron und nicht im Browser?
- **Treiber läuft in den Timeout, nachdem alle Kommandos durch sind** →
  `beforeunload`-Falle, siehe Gotchas.

- **☠ Nach einem RAM-Write antwortet das Gerät auf nichts mehr → auf den
  Geräte-Bildschirm schauen.** Zeigt er „Midi error", steht dort ein Dialog,
  der mit **Exit** quittiert werden muss; solange er steht, verarbeitet das
  Gerät kein SysEx, und jede folgende Leseanfrage läuft in den Timeout. Der
  Host sieht davon nichts — die Meldung existiert nur am Gerät.

  Ausgelöst wurde das dadurch, dass die Write-Frames ohne Pause und ohne
  Warten auf das ACK (`0x21`) rausgingen. Der Ablauf muss pro Häppchen
  `0x53` → Pause → `0x54` → **ACK abwarten** → Pause sein. Ein halb
  angekommener Write hinterlässt ein zerschossenes Preset (real passiert:
  IFX-Slot 0, Name weg, Nachbarslots intakt).

  **Rettung:** der Bereich liegt im RAM. Gerät aus und wieder ein lädt aus dem
  Flash nach. Deshalb gibt es für Flash bewusst keine Schreib-Builder.
- **Geräte-Kommandos melden „keine Antwort", obwohl `#midiStatus` „verbunden"
  sagt → zuerst an einen belegten Port denken, nicht an die Firmware.**
  Der KORG-USB-Treiber ist unter Windows **Single-Client**: hält ein anderes
  Programm den Port (Synthstudio, ein Omnitribe-Werkzeug, eine DAW, eine
  ältere TekkForge-Instanz), öffnet TekkForge ihn klaglos und empfängt
  trotzdem nichts. Der Fall ist stumm und sieht aus wie ein totes Gerät.

  So unterscheidet man es in zwei Schritten:

  ```bash
  node .claude/skills/run-tekkforge/driver.mjs --run "launch; ram-open; click #midiSearch; ms 4000; eval document.getElementById('midiMonitor').textContent.slice(0,200)"
  ```

  `#midiSearch` schickt den **Standard**-KORG-Suchbefehl (`f0 42 50 00 00 f7`),
  den auch eine Serien-Firmware beantwortet. Im Monitor steht dann:

  - nur `▶ OUT …`, kein `◀ IN` → es kommt gar nichts an. Port belegt (häufigst),
    falscher Port, oder SysEx im Global-Menü des Geräts aus. **Keine
    Hacktribe-Frage.**
  - `◀ IN …` kommt, aber `0x52` (RAM) bleibt stumm → jetzt ist es eine
    Firmware-Frage: RAM-Lesen kennt nur Hacktribe, nicht die Serien-Firmware.

  Für Abläufe ohne Gerät ist beides irrelevant — die laufen immer.
- **Ausgabe erscheint erst am Ende / wirkt hängend** → nicht durch `tail`
  pipen; der Batch-Modus schreibt fortlaufend, `tail` puffert bis Prozessende.

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
reproduzierbar in den Timeout lief. Der Ablauf ist also nicht deterministisch —
er hängt am Zustand des Geräts (an? Hacktribe? nicht in einem Menü, das SysEx
ignoriert?). Der Fehlerpfad selbst verhält sich sauber: klare Meldung,
kein Hänger, Exit-Code 0.

Alle **geräteunabhängigen** Kommandos oben sind dagegen jederzeit reproduzierbar.

## Run (Mensch)

```bash
pnpm desktop        # baut die GUI und öffnet ein Fenster; Fenster schließen zum Beenden
```

## Test / Check

```bash
pnpm test           # vitest — 288 passed, 5 skipped
pnpm check          # tsc --noEmit
```

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
- **Geräte-Kommandos melden „keine Antwort"**, obwohl `#midiStatus`
  „verbunden" sagt → der Port existiert, das Gerät antwortet trotzdem nicht.
  Beobachtet: dieselbe Leseanfrage lief erst zweimal durch und danach
  reproduzierbar in den Timeout, ohne dass sich am Port etwas änderte. Prüfen:
  Gerät an? Hacktribe statt Stock-Firmware? (RAM-Lesen `0x52` kennt nur
  Hacktribe.) Nicht in einem Menü, das SysEx ignoriert? Für Abläufe, die nicht
  vom Gerät abhängen, ist das irrelevant — die laufen immer.
- **Ausgabe erscheint erst am Ende / wirkt hängend** → nicht durch `tail`
  pipen; der Batch-Modus schreibt fortlaufend, `tail` puffert bis Prozessende.

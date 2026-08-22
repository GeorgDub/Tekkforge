# Generator — KI-gestützter Pattern-Generator als fünfter Tab

Stand 2026-08-22, Konzept mit dem Nutzer abgestimmt (Entscheidungen: B/C/A,
„volle Bank raus"). Ergänzt TekkForge um das, was bisher nur die Skripte
`prep-folder.py` / `make-folder-bank.mjs` / `make-folder-set.mjs` konnten —
aber bedienbar, ohne 250er-Ketten und ohne zerstückelte Melodien.

## Ziel

Aus einem Sample-Verzeichnis (oder einem Lied plus Samples) entstehen in der
App wenige, brauchbare Patterns für die Electribe 2 Sampler: ein
**Jam-Pattern** zum Live-Spielen, ein **Mini-Set** (4–8 gechainte Patterns)
oder **Pro Melo** (ein Jam-Pattern je Melodie). Die Samples landen einmal als
`.all` auf der SD-Karte; die Patterns gehen danach live per SysEx in Slots.
Eine Freitext-Beschreibung wird per Claude in ein Arrangement-Rezept
übersetzt (Premium); ohne API-Key baut ein Regel-Planer das Rezept.

Nicht Ziel: volle 250er-Bänke (bleiben den Skripten vorbehalten), Sample-
Upload per MIDI (kann das Gerät nicht), eigene Lizenzverwaltung.

## Entscheidungen

| Frage | Entscheidung |
|---|---|
| Was ist „KI"? | Regel-Engine + Audio-Analyse in TS; Claude übersetzt nur die Beschreibung in ein Rezept-JSON, schreibt nie Bytes (B). |
| Audio-Analyse | Kern in TypeScript; Stem-Trennung (Demucs) optional über externes Python, sonst Vollmix (C). |
| Ausgabeformen | Jam-Pattern (Standard), Mini-Set, Pro Melo. Volle Bank entfällt. |
| Bank ↔ Gerät | Eine Bank je Sample-Verzeichnis; Projekt merkt sich den Lade-Status; „→ Gerät" nur, wenn das Projekt als geladen markiert ist (A). |
| Premium | Beschreibung/KI-Wahl nur mit API-Key; alles andere frei. Kein Lizenzsystem. |
| Melodien | Bleiben ganz (≤ 8 Takte ein Sample, länger → zwei Hälften); 8-Takter über Alternate 13/14 mit schweigendem Part 14 (siehe Memory `melos-nicht-zerstueckeln`). |

## Bedienung (Tab „Generator")

Linke Spalte Eingaben, rechte Spalte Ergebnis.

**Quelle**
- „Sample-Verzeichnis wählen" → Scan (Rollen, Tempo-Vorschlag, RAM-Bedarf).
  Zu viel Material → Volume-Auswahl (Rangliste wie `--select`).
- „Lied analysieren" → Audiodatei + optional Sample-Verzeichnis. Ergebnis sind
  8-Takt-Fenster (DROP/BREAK/VAR) als Melo/Vox-Samples im Projekt.
- Anzeige: Rollen-Zähler (Kicks/Snares/Hats/Melos …), Tempo-Vorschlag, MB.
- Knöpfe: „Bank bauen" (schreibt `.all` + `projekt.json`), „auf SD kopieren",
  „als geladen markieren".

**Was bauen**
- Modus: Jam-Pattern | Mini-Set (4–8) | Pro Melo.
- Tempo: Feld, vorbelegt mit dem Vorschlag.
- Melodie: Liste mit Vorhören (bestehende `preview.ts`), oder „KI wählt".
- Beschreibung: Freitext; ohne API-Key ausgegraut mit Hinweis.
- „Generieren".

**Ergebnis**
- Liste der Patterns (Name, Takte, belegte Parts).
- Je Pattern: „→ Editor", „→ Gerät Slot N" (gesperrt mit Grund, wenn Bank
  nicht als geladen markiert), „→ Datei" (`.e2spat`; Mini-Set/Pro Melo als
  `.e2sallpat` mit leeren Rest-Slots).
- „Warum so?": Begründung aus dem Rezept (Regel-Planer oder Claude).

## Projekt

Ordner `<Verzeichnis>/TekkForge/` mit
- `<name>.all` — Sample-Bank (tekk4-Drums 501–535, wenn das Verzeichnis keine
  brauchbaren Drums hat; eigene Samples ab 601, sonst ab 501),
- `projekt.json` — Name, Tempo-Vorschlag, Samples (Nummer, Name, Rolle,
  Familie, Takte, Sekunden, Quelle), Volume-Info, Status
  (`gebaut` | `exportiert` | `geladen`), Zeitstempel der Bank.

Ein Pattern trägt die Projekt-Kennung (Name + Bank-Zeitstempel). „→ Gerät" ist
nur frei, wenn diese Kennung dem als geladen markierten Projekt entspricht.

## Kern-Module (`src/core/`, reines TypeScript, ohne DOM)

| Modul | Aufgabe | Abhängigkeiten |
|---|---|---|
| `sampleScan.ts` | Dateiliste → dekodierte Mono-Puffer (Dekodierung liefert der Aufrufer: Web Audio im Renderer, wavCodec in Tests), Dubletten (Hash + Korrelation), Rollen per Name/Länge/Pegel, Familien | `wavCodec` |
| `tempoAnalyse.ts` | Takt-Autokorrelation 80–200 BPM, Takt-Passung einer Datei, Tempo-Vorschlag fürs Verzeichnis (Mehrheit der taktgenauen Loops) | — |
| `bankPlan.ts` | Budget/Volumes, Loops ganz bzw. zwei Hälften, Varispeed (`audioProcessor` Resampler), Trim/Normalisieren/Fades, Slots → `buildE2sBank` | `e2sBankBuilder`, `e2sPatternSampleLink` |
| `rezept.ts` | Rezept-Typen + Schema-Prüfung + **Regel-Planer** (Thema aus Pools, Abschnitte je Modus) | — |
| `patternGen.ts` | Rezept → `E2PatternInput[]`; Figuren-Bibliothek (Kick vier/hart/roll/galopp, Bass off/roll/acht, Stab ruhig/stab/arp/frage/phrase, Shots, Loop-Trigger nach Taktzahl); Mute-Regel für Parts ohne Steps | `electribePatternBuilder`, `e2sExport` |
| `kiPlaner.ts` | Projekt-Zusammenfassung + Beschreibung → Prompt; Antwort-JSON → `rezept.pruefe()`; Fallback Regel-Planer | `rezept` |
| `liedAnalyse.ts` | Tempo, Downbeat, Fensterwahl DROP/BREAK/VAR; Stems über Bridge | `tempoAnalyse` |

Die Skripte `prep-folder.py` (Python) bleiben als CLI-Weg für Massenbau; die
Heuristiken werden nach TS portiert und mit den vorhandenen Manifesten als
Fixtures gleichgehalten.

## Rezept

```jsonc
{
  "modus": "jam" | "miniset" | "promelo",
  "bpm": 180,
  "begruendung": "ein, zwei Sätze",
  "thema": {
    "melo": "HyPer MeLo",          // Name aus projekt.json
    "vers": "GZUZ GHETTO KI",      // Vocal-Loop oder zweite Melodie, optional
    "kickFamilie": "robbaffert kick",
    "snare": "…", "clap": "…", "hats": ["…", "…"], "percs": ["…", "…"],
    "bass": "…", "stab": "…", "shots": ["…", "…"], "riser": "…"
  },
  "abschnitte": [                  // Jam: genau einer; Mini-Set: 4–8
    { "name": "INTRO", "wiederholungen": 2, "intensitaet": 1, "kick": "vier", "lagen": ["melo"] },
    { "name": "DROP",  "wiederholungen": 2, "intensitaet": 5, "kick": "hart", "lagen": ["melo", "bass", "stab", "vers", "shot"] }
  ],
  "figuren": { "bass": "off" | "roll" | "acht", "stab": "ruhig" | "stab" | "arp" | "frage", "hatsOffbeat": true }
}
```

Prüfung: jeder Name muss im Projekt existieren, Rollen müssen passen (Kick-
Familie nur aus Kicks), Intensität 1–5, 1–8 Abschnitte, Tempo 60–300. Was
durchfällt, ersetzt der Regel-Planer feldweise und vermerkt es in der
Begründung. *Pro Melo* = Liste von Rezepten (eines je Melodie), ein Aufruf.

**Jam-Logik:** ein Abschnitt, alle gewählten Lagen aktiv, Part-Lautstärken so
gestaffelt, dass Muten am Gerät das Arrangement ergibt; Parts ohne Steps
gemutet. **Mini-Set:** Abschnitte gechaint (`chainTo`, `chainRepeat`), letzter
ohne Kette. **Pro Melo:** ein Jam-Pattern je Melodie, Kick-Familie rotierend.

## KI-Aufruf

- Modell: aktuelles Sonnet, ein Aufruf je Generierung, JSON-Antwort erzwungen
  (Tool-Use mit dem Rezept-Schema). Eingabe ≈ 5–15 k Token.
- Prompt enthält: Rollen-Pools mit Namen, Takten, Sekunden, Pegel; Tempo-
  Vorschlag; Modus; Beschreibung; die Figuren-Bibliothek als Wortliste.
- Läuft im Electron-Main-Prozess (`fetch`), Key aus den App-Einstellungen in
  `userData` (nie im Projekt, nie im Repo). Renderer ruft per IPC
  `generator:rezept`.
- Fehler/Timeout (20 s) → Regel-Planer, Hinweis im Ergebnis.

## Lied-Analyse

- TS: Tempo (Autokorrelation), Half-/Double-Time zum Zieltempo, Varispeed,
  Downbeat-Phase über Bassenergie, 8-Takt-Fenster: DROP (lautestes), BREAK
  (leisestes in der Mitte), VAR (harmonisch am weitesten vom DROP, höchstens
  12 dB leiser).
- Stems: `scripts/stems.py` (Demucs htdemucs) als Kindprozess, wenn ein
  Python mit Demucs gefunden wird (Einstellung „Python-Pfad", Probe beim
  Start). MELO = bass + other, VOX = vocals (nur wenn > −32 dB, sonst in MELO).
  Ohne Python: Vollmix als MELO, sichtbar vermerkt.
- Ergebnis wird ein Projekt wie jedes andere (eigene Bank).

## Gerät

„→ Gerät" nutzt den bestehenden Weg „Pattern → Slot" (0x4C mit Slot-Nummer,
am Gerät bei laufendem Sequencer geprüft). Slot-Wahl wie im Panel; Vorgabe
ist der zuletzt benutzte Generator-Slot + 1. Gesperrt mit sichtbarem Grund,
wenn das Projekt nicht als geladen markiert ist oder kein Gerät antwortet.

## Fehler

| Fall | Verhalten |
|---|---|
| Verzeichnis > Sample-RAM | Rangliste, Volumes zur Auswahl |
| Kein Kick/Hat im Verzeichnis | tekk4-Drums ab 501 automatisch dazu |
| Datei unlesbar / still | übersprungen, in der Scan-Liste vermerkt |
| Kein Python/Demucs | Lied als Vollmix, Hinweis |
| KI-Fehler, kein Key | Regel-Planer, Hinweis |
| Bank nicht geladen | „→ Gerät" gesperrt, Datei-Export bleibt |

## Tests (Vitest)

- Rollen-Heuristik gegen die zehn vorhandenen Manifeste (`examples/e2s/*/manifest.json`) als Fixtures.
- Tempo auf bekannten Loops (180er-Korg-Material, Tommi 95/190).
- `rezept.pruefe()` mit gültigen und kaputten Antworten (unbekannter Name, falsche Rolle, 0 Abschnitte).
- Golden: gleiches Rezept → gleiche Pattern-Bytes; Mute-Regel; Alternate-Regel für > 4 Takte.
- Bank über `parseE2sBank` rücklesen (Nummern, Namen, Slices); Geometrie wie `check-folder-sets.mjs`.
- KI gemockt (IPC-Stub).

## Reihenfolge

1. Kern: `sampleScan`, `tempoAnalyse`, `bankPlan`, `rezept` (Regel-Planer), `patternGen` — Jam/Mini-Set/Pro Melo aus einem Verzeichnis, mit Tests.
2. Tab „Generator": Scan, Bank bauen, Generieren, „→ Datei", „→ Editor".
3. Gerät: Projekt-Status, SD-Kopie, „→ Gerät" über den Slot-Weg.
4. KI: Einstellungen (Key), IPC, `kiPlaner`, Beschreibung aktiv.
5. Lied-Analyse mit optionaler Demucs-Bridge.

Nach 1 und 2 ist der Generator benutzbar; 3–5 ergänzen.

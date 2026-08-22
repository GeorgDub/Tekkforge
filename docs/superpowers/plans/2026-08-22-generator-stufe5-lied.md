# Generator Stufe 5 — Lied-Analyse — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ein ganzes Lied (wav/mp3/m4a) wird im Generator-Tab zu 8-Takt-Fenstern (DROP/BREAK/VAR) im Bank-Tempo, die als Melodie-Samples ins Projekt wandern — zusammen mit einem optionalen Sample-Verzeichnis. Mit Python + Demucs werden aus den Fenstern Stems (MELO = bass + other, VOX = vocals), ohne Python der Vollmix.

**Architecture:** `src/core/dsp.ts` (radix-2-FFT, Bandenergien) und `src/core/liedAnalyse.ts` (Tempo via `tempoSchaetzen`, Half-/Double-Time, Varispeed, Downbeat-Phase über Bassenergie, Fensterwahl nach Pegel und Klangfarben-Abstand) sind rein und getestet. Die Demucs-Bridge ist ein kleines Python-Skript `scripts/stems.py` (JSON rein: wav-Pfad + Fenster; Stems als wav raus), gestartet vom Main-Prozess (`lied:pythonStatus`, `lied:stems`) mit Temp-Dateien unter `userData/tmp`. Der Tab bekommt in Karte 1 „Lied analysieren"; die Fenster werden `ScanEintrag`e (Rolle melo/vox, Gruppe `melo:<lied> DROP`) und laufen durch den vorhandenen Bankbau.

**Tech Stack:** TypeScript, Vitest, Electron `child_process.spawn`, Python 3 + demucs 4 (vorhanden: `python -c "import demucs"`).

**Spec:** `docs/superpowers/specs/2026-08-22-generator-design.md` (Abschnitt „Lied-Analyse")

## Global Constraints

- Fenster = 8 Takte beim Bank-Tempo, **ein** Sample je Fenster (keine Hälften) — am Gerät über Alternate 13/14 mit schweigendem 14 (Stufe 1-Regel).
- Auswahl: DROP = lautestes Fenster; BREAK = leisestes hörbares in der Mitte (20–85 %); VAR = hörbar, höchstens 12 dB leiser als DROP, größter Klangfarben-Abstand zu DROP; INTRO = erstes hörbare (nur bei ≥ 4 Fenstern). Hörbar = RMS > −35 dB nach Peak-Normalisierung.
- Python wird nie automatisch installiert; ohne Python oder Demucs → Vollmix, sichtbar vermerkt.
- Temp-Dateien nur unter `app.getPath("userData")/tmp`, nach dem Lauf gelöscht.
- `pnpm check && pnpm test` grün.

---

## Dateiplan

| Datei | Verantwortung |
|---|---|
| `src/core/dsp.ts` | `fft(re, im)` radix-2 in place, `bandEnergien(pcm, sr, baender)` (log-Bänder 60 Hz–10 kHz) |
| `src/core/liedAnalyse.ts` | `analysiereLied(pcm, sr, opts)` → `{ bpm, k, rate, fenster: [{ label, startSek, pcm }] }` |
| `tests/generator-lied.test.ts` | synthetische Spur: 3 Abschnitte mit verschiedenen Pegeln/Klangfarben |
| `scripts/stems.py` | Demucs auf Fenstern: `python scripts/stems.py <anfrage.json>` → schreibt `<id>-melo.wav`/`<id>-vox.wav` |
| `electron/main.cjs`, `electron/preload.cjs` | `window.tekkLied`: `pythonStatus()`, `stems(anfrage)` |
| `src/gui/generator.ts` | „Lied analysieren" (Datei + BPM-Feld + Demucs-Häkchen), Fenster → Scan-Einträge |

---

### Task 1: dsp + liedAnalyse (rein)

**Interfaces:**
- `fft(re: Float32Array, im: Float32Array): void` — Länge Zweierpotenz.
- `bandEnergien(pcm: Float32Array, sr: number, baender = 24): Float32Array` — mittlere log-Energie je Band über Frames von 2048, normiert (Summe 1).
- `interface LiedFenster { label: "DROP" | "BREAK" | "VAR" | "INTRO" | `PART${number}`; startSek: number; pcm: Float32Array; pegelDb: number }`
- `analysiereLied(pcm: Float32Array, sr: number, opts: { zielBpm: number; bpmHinweis?: number; fensterTakte?: 8; anzahl?: 3 }): { bpm: number; k: number; rate: number; offsetSek: number; fenster: LiedFenster[] }` — `sr` muss 44 100 sein (Aufrufer resamplet).
- Downbeat-Phase: Beats ab 0 im Takt-Raster; Phase p ∈ {0..3} mit maximaler Summe der Bassenergie (Bandenergien < 150 Hz) an den Beat-Positionen; Offset = p · Beat.

- [ ] Test: synthetische 60-s-Spur bei 95 BPM (Klick-Kicks + Sinus-„Pad", Abschnitt A leise 200 Hz, B laut 400 Hz + Rauschen, C mittel 800 Hz) → `bpm` ≈ 95, `k` = 2 bei zielBpm 190, `rate` ≈ 1, 3 Fenster à `8 · 240/190 · 44100` Frames, DROP liegt im lauten Abschnitt, BREAK im leisen, VAR ≠ DROP, alle `pegelDb` > −35.
- [ ] Implementieren; `fft` gegen naive DFT auf 64 Punkten testen (Abweichung < 1e-3).
- [ ] Commit `feat(generator): dsp + liedAnalyse — Tempo, Downbeat, Fensterwahl`.

### Task 2: Demucs-Bridge

- [ ] `scripts/stems.py`: liest `{ "wav": "<pfad>", "fenster": [{ "id": "DROP", "startSek": 30.2, "sekunden": 10.1 }], "ziel": "<ordner>" }`, lädt nur die Fenster (librosa, mono 44,1 k), Demucs htdemucs (Code aus `prep-folder.py::demucs_stems`), schreibt `<ziel>/<id>-melo.wav` (bass+other, + vocals wenn < −32 dB) und `<ziel>/<id>-vox.wav` (nur wenn > −32 dB); gibt JSON `{ "fenster": [{ "id", "melo": "<pfad>", "vox": "<pfad>|null" }] }` auf stdout aus. Python-Pfad aus Settings `pythonPfad` (Standard `python`).
- [ ] `main.cjs`: `lied:pythonStatus` → `{ python: string|null, demucs: boolean, meldung }` (spawn `python -c "import demucs, sys; print(demucs.__version__ if hasattr(demucs,'__version__') else 'ok')"`, Timeout 20 s); `lied:stems` → schreibt Vollmix-Fenster als wav nach `userData/tmp/<zeit>/`, ruft `stems.py`, liest die Stems als Byte-Arrays zurück, löscht Temp. Timeout 10 min, Fortschritt per `lied:fortschritt`-Event (stderr-Zeilen).
- [ ] `preload.cjs`: `tekkLied` mit beiden Funktionen + `onFortschritt(cb)`.
- [ ] Probe per Treiber: `eval window.tekkLied.pythonStatus().then(JSON.stringify)` → `demucs: true`.
- [ ] Commit `feat(generator): Demucs-Bridge (stems.py, lied:*)`.

### Task 3: GUI „Lied analysieren"

- [ ] Karte 1: zweite Quelle „Lied analysieren": `<input type="file" accept="audio/*">`, Feld „Lied-BPM (leer = messen)", Häkchen „Stems per Demucs (Python gefunden · v4)" — nur aktiv, wenn `pythonStatus.demucs`. Ablauf: dekodieren (`dekodiere`) → `analysiereLied` mit `zielBpm` = Tempo-Feld (Standard: 180 oder Vorschlag des Verzeichnisses) → ohne Demucs: Fenster als `ScanEintrag` (Rolle `melo`, Datei `<lied> DROP.wav`, Gruppe wird in `planeBank` zu `melo:<familie>` — Familie = `lied drop` usw.) an `z.eintraege` anhängen; mit Demucs: Fenster-PCM über `tekkLied.stems` → melo- und vox-Einträge. Danach normale Zusammenfassung + Bank bauen.
- [ ] Fortschrittszeile „Demucs: Fenster 2/3 …". Fehler → Vollmix mit Hinweis.
- [ ] Abnahme per Treiber mit `G:\Samples Numondo\Sampler USE\Korg\Tommi\Tommi Schore - Track 5.wav` (136 s, 95 BPM): Tempo 190, 3 Fenster, Bank baut, Jam-Pattern mit Melo „Track 5 DROP"; dann dasselbe mit Demucs (dauert ~1–2 min).
- [ ] Commit `feat(generator): Lied analysieren — Fenster, optional Demucs-Stems`.

### Task 4: README + Memory, Commit.

## Self-Review
- Spec „Lied-Analyse": TS-Analyse ✔ (Task 1), Stems über Python mit Probe beim Start ✔ (Task 2; Probe bei Tab-Init statt App-Start — gleichwertig), MELO = bass+other, VOX nur > −32 dB ✔, ohne Python Vollmix mit Hinweis ✔, Ergebnis = normales Projekt ✔ (Task 3).
- Typen: `LiedFenster`, `analysiereLied` (Task 1) in Task 3; `tekkLied` (Task 2) in Task 3.

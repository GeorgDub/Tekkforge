# Pattern, Stems, Samples — Verbesserungsplan (2026-09-04)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die fünf vom Nutzer freigegebenen Verbesserungsblöcke in der Reihenfolge 1→5 bauen: Groove/Variation/Motion im Generator, Rate nach Rolloff + einheitliches Budget, Loop-Punkte und Slices im Generator-Weg, Bassline aus dem Bass-Stem als Noten, Beat-Tracking/Hook-Erkennung/Time-Stretch.

**Architecture:** Jeder Block ist ein reines Kernmodul unter `src/core` mit Vitest-Tests, angeschlossen an die bestehenden Wege (`patternGen.baueAufbau`, `liedZuSet`, `bankPlan.planeBank`, `generatorSession.erzeuge`). Nichts davon braucht das Gerät zum Testen; was nur das Ohr entscheiden kann, bekommt ein Testpattern nach den Testpattern-Konventionen (volle 64 Steps, IFX an, Parts ohne Steps gemutet) und einen Eintrag in README + PDF.

**Tech Stack:** TypeScript, Vitest, vorhandene DSP-Helfer (`dsp.ts`, `klangProfil.ts`, `tempoAnalyse.ts`, `keyAnalyse.ts`), Python-Brücke (py-cuda) nur für Time-Stretch.

**Spec:** Gespräch vom 2026-09-04 (Vorschlagsliste, vom Nutzer mit „bau das genau so“ freigegeben).

## Global Constraints

- Melodien und Vocals (Parts 12–15) werden nie zerstückelt oder ausgedünnt (Nutzerfeedback).
- Der Drop bleibt der Anker: Drop-Steps unverändert, Variation nur in AUF-Stufen ≥ 1 und VRS-Patterns.
- Sample-RAM 24 MB, `ramBytesFuer` ist die einzige Wahrheit für Bytes.
- Pattern-Format: `swing` −50…+50 als i8 @0x24 (gerätebestätigt), Motion 8 Slots je Pattern, ParamID 4 = Osc Edit (gerätebestätigt), ParamID 5 = Filter Cutoff (aus der Werksbank abgeleitet: 45 Slots, 31 Rampen 0…106), ParamID 2 = Pitch (vermutet: Werte 43…65 um 64), ParamID 16 = MFX-Edit (global, Rampen), ParamID 17 = IFX an/aus (binär).
- Jede neue Funktion: README-Abschnitt + PDF im selben Commit.

---

## Block 1 — Generator: Groove, Ketten-Variation, Motion

### Task 1: Groove aus dem Lied anschließen

**Files:**
- Create: `src/core/grooveAnschluss.ts`
- Modify: `src/core/liedZuSet.ts` (nach `analyse`, vor `planeBank`), `src/core/generatorSession.ts` (Erzeugt.groove), `src/core/patternGen.ts` (swing durchreichen)
- Test: `tests/groove-anschluss.test.ts`

**Interfaces:**
- Produces: `swingAusGroove(g: Groove): number` — mittlerer Versatz der ungeraden Steps in Prozent (−50…50), gerundet; 0 bei < 2 belegten ungeraden Steps.
- Produces: `grooveFuerLied(pcm: Float32Array, sr: number, bpm: number, name: string): { groove: Groove; swing: number; belegteSteps: number }` — ruft `grooveAusAudio` mit `steps: 16`.
- Produces: `mitSwing(patterns: E2PatternInput[], swing: number): E2PatternInput[]`.
- `LiedSet.groove?: Groove`, `LiedSet.swing: number`; `LiedZuSetOptionen.groove?: boolean` (Vorgabe an).

Steps: Test (synthetischer Klick-Track mit 12 % spätem Offbeat → swing ≈ 12, Groove-Steps ungerade trigger > 0) → rot → Implementierung → grün → in `liedZuSet` auf dem Drums-Stem (sonst Vollmix) rechnen und auf alle Patterns legen → Test in `lied-zu-set.test.ts` (Patterns tragen `swing`) → Commit.

### Task 2: Ketten-Variation

**Files:**
- Create: `src/core/kettenVariation.ts`
- Modify: `src/core/patternGen.ts` (`baueAufbau` ruft `variiereKette`)
- Test: `tests/ketten-variation.test.ts`

**Interfaces:**
- Produces: `variiereKette(patterns: E2PatternInput[], opts?: { startwert?: number; streuung?: number; drop?: number }): E2PatternInput[]` — Pattern k (k ≠ drop): Velocity-Streuung ±streuung (Vorgabe 10) auf Parts 0–8 per LCG (`zufall` aus patternVarianten, Seed startwert+k); k ungerade: Hat-Figur (Part 4) rotiert um 2 Steps und bekommt Akzentwechsel 82/70; k ≥ 1 und k ungerade: Ghost-Kick (Vel 70, Gate 8) auf Step 58; k % 4 === 3: Snare-Fill (`fillSchlaege`) im letzten Takt. Parts 12–15 unverändert. Drop-Index unverändert.

Steps: Test (fünf Patterns: Drop bleibt byteweise gleich, Melo-Parts überall gleich, Pattern 1 hat andere Kick-Velocities als Pattern 0, Pattern 3 hat Fill, reproduzierbar) → rot → Implementierung → grün → `baueAufbau`: AUF-Stufen ≥ 1 und VRS variieren, Drop nicht → bestehende Generator-Tests grün → Commit.

### Task 3: Motion-Sequenzen

**Files:**
- Create: `src/core/motionGen.ts`
- Modify: `src/core/patternGen.ts` (`baueAufbau` setzt `motionSlots`), `scripts/make-mottest.mjs` (Testpattern), `examples/e2s/MOTTEST.e2spat`
- Test: `tests/motion-gen.test.ts`

**Interfaces:**
- Produces: `MOTION_PARAM = { oscEdit: 4, cutoff: 5, pitch: 2, mfxEdit: 16, ifxOn: 17 }` mit Beleg-Kommentar je Eintrag.
- Produces: `rampe(von: number, bis: number, n = 64): number[]`, `fall(ab: number, von: number, bis: number, n = 64): number[]` (bis Step `ab` konstant `von`, danach linear auf `bis`).
- Produces: `aufbauMotion(stufe: number, anzahl: number, ziele: number[]): E2MotionSlot[]` — Cutoff-Rampe je Stufe (Stufe i deckt Anteil i/anzahl…(i+1)/anzahl der Strecke 30→127 ab) auf den Melo-Parts 12/13.
- Produces: `dropMotion(): E2MotionSlot[]` — MFX-Edit (global) Rampe 0→80 über 64 Steps, Pitch-Fall auf Part 0 ab Step 56 von 64 auf 40.

Steps: Test (Slot-Zahl ≤ 8, Werte 0…127, Stufe 0 beginnt bei 30, letzte Stufe endet bei 127, Drop hat 2 Slots) → rot → Implementierung → grün → `baueAufbau` anschließen → MOTTEST.e2spat (Part 1 Kick vier-auf-Boden, Slot Cutoff Rampe, Slot Pitch-Fall, Slot MFX) → Commit.

### Task 4: README + PDF Block 1

Abschnitt „Groove, Variation und Motion im Generator (2026-09-04)“ mit den Belegen der ParamIDs und dem Hinweis, was das Ohr prüfen muss (MOTTEST). PDF neu bauen. Commit.

## Block 2 — Rate nach Rolloff, einheitliches Budget

### Task 5: Rate nach Rolloff

**Files:**
- Create: `src/core/rateWahl.ts`
- Modify: `src/core/bankPlan.ts` (`bereiteAuf`: Rate je Slot statt nur `sparsameVocals`), `src/core/klangProfil.ts` (falls `rolloff` fehlt: Feld `rolloffHz`)
- Test: `tests/rate-wahl.test.ts`

**Interfaces:**
- Produces: `rateFuer(pcm: Float32Array, sr: number, rolle: Rolle, opts?: { grenzeHz?: number; sparsameVocals?: boolean }): 44100 | 22050` — 22050, wenn Rolloff (95 % Energie) < grenzeHz (Vorgabe 9000) ODER (rolle === "vox" && sparsameVocals). Nie für Hats/Snare/Clap (Rolloff liegt dort ohnehin hoch, Regel greift nicht).
- `ProjektSample.sampleRate` wird gesetzt; `PlanOptionen.rateNachRolloff?: boolean` (Vorgabe an).

Steps: Test (Sinus 200 Hz → 22050, weißes Rauschen → 44100, Vox mit sparsameVocals → 22050) → rot → Implementierung → grün → bankPlan → `generator-bank.test.ts` grün → Commit.

### Task 6: Budget vereinheitlichen

**Files:**
- Modify: `src/core/generatorSession.ts` (`zusammenfassung` über `ramBytesFuer`), `src/core/sampleRam.ts` (`ratenFaktor` benutzen oder entfernen), `src/core/bankPlan.ts` (Budget-Wächter: wenn Summe > RAM_BUDGET_BYTES, Vocals und dann FX auf 22050, danach abschneiden mit Warnung)
- Test: `tests/sample-ram.test.ts`, `tests/generator-session.test.ts`

Steps: Test (Zusammenfassung zählt 22050-Slot halb; Budget-Wächter halbiert zuerst Vocals) → rot → Implementierung → grün → Commit. README-Abschnitt + PDF.

## Block 3 — Loop-Punkte und Slices im Generator-Weg

### Task 7: Loop-Punkte

**Files:**
- Create: `src/core/loopPunkte.ts`
- Modify: `src/core/bankPlan.ts` (Loops: `loopStartBytes`/`loopEndBytes` auf Taktgrenzen), `src/core/e2sBankBuilder.ts` (Felder durchreichen, falls noch nicht)
- Test: `tests/loop-punkte.test.ts`

**Interfaces:**
- Produces: `loopPunkte(frames: number, takte: number, sampleRate: number, bpm: number): { start: number; ende: number }` in Frames, Ende auf die letzte volle Taktgrenze; `nulldurchgang(pcm, frame, fenster = 64)` zieht beide Punkte auf den nächsten Nulldurchgang.

Steps: Test → rot → Implementierung → grün → bankPlan setzt Punkte für alle Loops (`pruefeLoop` muss sie annehmen) → Commit.

### Task 8: Slices im Generator-Weg

**Files:**
- Modify: `src/core/bankPlan.ts` (64 Slice-Marker je Loop wie `make-folder-bank.mjs`: 16tel über die Taktzahl), `src/core/e2sBankBuilder.ts`
- Test: `tests/generator-bank.test.ts` (Slices vorhanden, Marker monoton, letzter < Länge)

Steps: Test → rot → Implementierung → grün → README + PDF → Commit.

## Block 4 — Bassline aus dem Bass-Stem

### Task 9: Grundton je Takt

**Files:**
- Create: `src/core/grundton.ts`
- Test: `tests/grundton.test.ts`

**Interfaces:**
- Produces: `grundtonYin(pcm: Float32Array, sr: number, fMin = 30, fMax = 300): { hz: number; sicherheit: number } | null`
- Produces: `bassNoten(pcm: Float32Array, sr: number, bpm: number, takte: number, raster = 4): (number | null)[]` — MIDI-Note je Viertel (raster Noten je Takt), null bei Stille/unsicher.

Steps: Test (Sinus 55 Hz → 33; Wechsel 55/82,4 Hz → 33/40; Stille → null) → rot → Implementierung → grün → Commit.

### Task 10: Bass-Steps aus Noten

**Files:**
- Modify: `src/core/liedZuSet.ts` (Bass-Stem in `StemErgebnis.bass?`, `bassNoten` je Fenster → `ProjektSample.bassLinie?: (number|null)[]`), `src/core/patternGen.ts` (Part 8: wenn `bassLinie` da, Steps aus Noten statt `BASS`-Figur; Note = Grundton, Oktave so, dass 36…59), `src/core/bankPlan.ts` (Feld durchreichen), `scripts/stems.py` (bass immer mitliefern, wenn > −45 dB)
- Test: `tests/bass-linie.test.ts`

Steps: Test (Rezept mit bassLinie → Part-8-Steps tragen die Noten auf den Vierteln, Rest der Figur bleibt) → rot → Implementierung → grün → README + PDF → Commit.

## Block 5 — Beat-Tracking, Hook, Time-Stretch

### Task 11: Beat-Raster

**Files:**
- Create: `src/core/beatRaster.ts`
- Modify: `src/core/liedAnalyse.ts` (Fensterschnitt auf Beat-Raster statt Phase über 4 Beats)
- Test: `tests/beat-raster.test.ts`

**Interfaces:**
- Produces: `beatRaster(pcm: Float32Array, sr: number, bpm: number): { beats: number[]; downbeats: number[]; drift: number }` — dynamische Programmierung über die Onset-Kurve (Ellis-Verfahren), Downbeats über Bassenergie je 4 Beats.

### Task 12: Hook-Erkennung

**Files:**
- Create: `src/core/hookSuche.ts`
- Modify: `src/core/liedAnalyse.ts` (Fenster „HOOK“ = 8-Takt-Fenster mit höchster Selbstähnlichkeit), `src/core/patternGen.ts` (Drop nimmt HOOK, wenn vorhanden)
- Test: `tests/hook-suche.test.ts`

**Interfaces:**
- Produces: `hookFenster(pcm: Float32Array, sr: number, bpm: number, takteJeFenster = 8): { start: number; wiederholungen: number }` — Chroma je Takt, Ähnlichkeitsmatrix, Fenster mit den meisten Nahezu-Wiederholungen.

### Task 13: Time-Stretch

**Files:**
- Create: `scripts/time-stretch.py` (librosa/rubberband in py-cuda, Rückfall auf librosa.effects.time_stretch), `src/core/timeStretch.ts` (Brücke wie `tekkTranskription`)
- Modify: `src/core/bankPlan.ts` (Loops außerhalb ±23 % Varispeed: dehnen statt One-Shot), `electron/main.cjs` (Brücke)
- Test: `tests/time-stretch.test.ts` (Brücke mit Stub)

### Task 14: README + PDF Block 5, Abschlussbericht, Gedächtnis

---

## Selbstprüfung

- Spec-Abdeckung: Groove ✓ (T1), Variation ✓ (T2), Motion ✓ (T3), Rate/Rolloff ✓ (T5), Budget ✓ (T6), Loop-Punkte ✓ (T7), Slices ✓ (T8), Bassline ✓ (T9/T10), Beat-Tracking ✓ (T11), Hook ✓ (T12), Time-Stretch ✓ (T13). Akkorde/Tonart, Drums aus dem Material, Drop-Metrik, Vocal-Aufbereitung, Modellwahl: nicht in der freigegebenen Reihenfolge 1–5 enthalten, bleiben Folgearbeit.
- Typen: `Groove` aus e2Groove, `E2PatternInput`/`E2MotionSlot` aus electribePatternBuilder, `ProjektSample` aus bankPlan.

## Stand 2026-09-04 abends

Alle 14 Aufgaben umgesetzt und committet (Block 1 9f89c68, Block 2 8de8dab,
Block 3 39c5774/7e81941, Block 4 f12bd86, Block 5 dieser Commit). Abweichung
vom Plan: Time-Stretch als WSOLA in TypeScript (`core/timeStretch.ts`) statt
Python-Bruecke — laeuft im Browser wie in der CLI und ist testbar; der
Stretch-Pfad greift, sobald das Eigentempo der Schleife jenseits ±23 % liegt
(vorher haette die Taktzahl-Rundung fast jede Schleife „eingepasst“).
Hoerprobe am Geraet offen — Liste im README je Abschnitt und in MOTTEST.

# Generator Stufe 4 — Claude-Rezept — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Die Freitext-Beschreibung wird per Claude in ein Rezept-JSON übersetzt (Jam und Mini-Set), das `pruefeRezept` absichert; ohne Key, bei Fehler oder Timeout läuft der Regel-Planer mit Hinweis. API-Key liegt in den App-Einstellungen (`userData/settings.json`), der Aufruf läuft im Main-Prozess über das offizielle SDK.

**Architecture:** `src/core/kiPlaner.ts` (rein, getestet) baut System-/User-Prompt und das JSON-Schema aus dem Projekt und macht aus der Antwort ein geprüftes Rezept. `electron/main.cjs` bekommt IPC `ki:key` (get/set/clear) und `ki:rezept` (Prompt-Teile rein, JSON-Text raus) mit `@anthropic-ai/sdk` (`messages.create`, `output_config.format = json_schema`, `fallbacks: "default"`, Timeout 25 s). `generator.ts` zeigt das Key-Feld, ruft bei vorhandenem Key die Brücke und sonst die Regeln; `generatorSession.erzeuge()` bekommt ein optionales fertiges Rezept.

**Tech Stack:** `@anthropic-ai/sdk` 0.120 (CommonJS im Main), Modell `claude-opus-5` (Skill-Vorgabe; in den Einstellungen änderbar), Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-generator-design.md` (Abschnitte „Rezept", „KI-Aufruf", „Premium")

## Global Constraints

- Claude sieht nie Audio und schreibt nie Bytes — nur Rezept-JSON; alles läuft durch `pruefeRezept`.
- Key nur in `userData/settings.json`, nie im Projekt, nie im Repo, nie im Renderer-Log.
- Modell-ID exakt `claude-opus-5` (Skill: kein Datumssuffix); Server-Fallback `fallbacks: "default"` mit Beta `server-side-fallback-2026-07-01`.
- Ein Aufruf je Generierung; Timeout 25 s; `max_tokens` 4096 (Rezept ist klein).
- Pro Melo bleibt Regel-Planer (ein Rezept je Melodie wäre ein langer Aufruf — bewusst ausgelassen, im UI gesagt).

---

## Dateiplan

| Datei | Verantwortung |
|---|---|
| `src/core/kiPlaner.ts` | `REZEPT_SCHEMA`, `projektZusammenfassung()`, `promptFuer()`, `antwortZuRezept()` |
| `tests/generator-ki.test.ts` | Tests dazu (kein Netz) |
| `src/core/generatorSession.ts` | `erzeuge()` akzeptiert `rezept?: Rezept` |
| `electron/main.cjs`, `electron/preload.cjs` | `window.tekkKi`: `keyStatus()`, `keySetzen(key)`, `keyLoeschen()`, `rezept({system, user, schema, modell})` |
| `src/gui/tekkKi.ts` | typisierter Zugriff |
| `src/gui/generator.ts` | Key-Feld, KI-Aufruf, Fallback-Hinweis |

---

### Task 1: kiPlaner — Prompt, Schema, Antwort

**Interfaces:**
- `REZEPT_SCHEMA: object` — JSON-Schema (object, additionalProperties false, required: modus, bpm, begruendung, thema, abschnitte, figuren; thema.* Strings; abschnitte 1–8 mit name/wiederholungen/intensitaet/kick/lagen; figuren bass/stab/hatsOffbeat).
- `projektZusammenfassung(p: Projekt): string` — kompakte Zeilen je Rolle: Name · Takte · Sekunden · dB; Kick-Familien mit ihren Kicks; Tempo-Vorschlag.
- `promptFuer(p: Projekt, wunsch: { modus: "jam" | "miniset"; bpm: number; beschreibung: string; melo?: string }): { system: string; user: string }`
- `antwortZuRezept(text: string, p: Projekt): { rezept: Rezept; korrekturen: string[] }` — JSON.parse (wirft nie; bei Parse-Fehler Regel-Rezept + Korrektur „Antwort kein JSON").

- [ ] Test schreiben (`tests/generator-ki.test.ts`): Schema hat `required` mit allen sechs Feldern; Zusammenfassung nennt jede Melodie und jede Kick-Familie; Prompt enthält Beschreibung, Modus, BPM und die Figuren-Wortliste; `antwortZuRezept` mit gültigem JSON → 0 Korrekturen; mit Quatsch-JSON → Korrekturen > 0; mit „kein JSON" → Regel-Rezept + Korrektur.
- [ ] Implementieren, Test grün, Commit `feat(generator): kiPlaner — Prompt, Schema, Antwort → Rezept`.

### Task 2: Main/Preload — Key-Speicher und Aufruf

- [ ] `main.cjs`: `settingsPfad()` = `path.join(app.getPath("userData"), "settings.json")`; `leseSettings()`/`schreibeSettings()`; IPC `ki:keyStatus` → `{ gesetzt: boolean, modell }`, `ki:keySetzen` (string, trim, leer = löschen), `ki:rezept` → `new Anthropic({ apiKey, timeout: 25_000, maxRetries: 1 })`, `client.beta.messages.create({ model, max_tokens: 4096, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", system, messages: [{ role: "user", content: user }], output_config: { format: { type: "json_schema", schema } } })`; Antwort: `stop_reason === "refusal"` → Fehler „abgelehnt"; sonst Text-Block zurück. Fehlerklassen per `instanceof Anthropic.AuthenticationError` / `RateLimitError` / `APIError` in deutsche Meldungen.
- [ ] `preload.cjs`: `tekkKi` mit den vier Funktionen.
- [ ] `src/gui/tekkKi.ts`: Interface + `tekkKi()`.
- [ ] `pnpm check && pnpm build:gui`; Treiber: `eval window.tekkKi.keyStatus().then(JSON.stringify)` → `{"gesetzt":false,…}`. Commit.

### Task 3: GUI

- [ ] Karte 2: Zeile „KI (Premium)": Passwortfeld + „Key speichern" + Status („Key gesetzt · claude-opus-5" / „kein Key — Regel-Planer"), „Key löschen". Beschreibungs-Placeholder anpassen.
- [ ] `generieren()`: bei Key und Modus jam/miniset → `promptFuer` → `tekkKi().rezept(...)` → `antwortZuRezept` → `erzeuge(projekt, {..., rezept})`; Korrekturen und KI-Status in `warumSo`/Hinweise; bei Fehler `alert`-frei: Hinweis „KI nicht erreichbar (…) — Regel-Planer" und Regel-Rezept. Knopf während des Aufrufs gesperrt („KI denkt …").
- [ ] Abnahme per Treiber ohne Key (Regelpfad unverändert) und — wenn der Nutzer den Key einträgt — ein echter Aufruf am Bildschirm. Commit.

### Task 4: README + Memory, Commit.

## Self-Review
- Spec „KI-Aufruf": Main-Prozess, Key in userData, Timeout, Fallback Regel-Planer ✔; „Rezept": Schema-Prüfung ✔; Modell: Spec sagte „aktuelles Sonnet", Skill verlangt `claude-opus-5` als Standard → Opus 5, in den Einstellungen änderbar (im Bericht erwähnt).

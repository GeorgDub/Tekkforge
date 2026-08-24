# Generator: Unterordner, Aufbau-Kette, Melo-Sync, Lied-Pipeline (2026-08-24)

Vier Erweiterungen des Generator-Tabs (Nutzerwunsch vom 2026-08-24). Rückfragen
blieben unbeantwortet; umgesetzt sind die jeweils empfohlenen Varianten.

## 1 · Unterverzeichnisse scannen

Bisher filtert `gui/generator.ts#scanneOrdner` alles unterhalb der obersten
Ebene weg. Neu: alle Ebenen werden gescannt. Die Entscheidung wandert als
`dateiRelevant(relPfad, name)` nach `core/generatorSession.ts`:

- übersprungen werden Dateien unter einem `TekkForge/`-Segment (eigener
  Ausgabeordner mit .all/projekt.json) und unter versteckten Ordnern (`.xyz/`),
- sonst entscheidet wie bisher `dateiArt(name)`.

## 2 · Aufbau-Kette (Mute/Unmute-Spielweise)

Neue Checkbox „Aufbau-Kette" im Karten-Block „Was bauen" (Default: an).
Wirkt auf alle Modi; statt der bisherigen Abschnitts-Patterns entsteht je
Rezept eine Kette:

| Stufe | neu entmutete Parts (0-basiert) | chainRepeat |
|---|---|---|
| AUF1 | Melo 12/13 + Snare 2 | 2 |
| AUF2 | + Hats 4/5 | 2 |
| AUF3 | + Clap 3 + Perc 6/7 | 2 |
| AUF4 | + Bass 8 + Stab 9 | 2 |
| AUF5 | + Vers 14/15 + Shots/Riser 10/11 | 2 |
| DROP | + Kicks 0/1 — alles an | 4, kein chainTo |

- **Alle 16 Parts haben in allen Patterns dieselben vollen Steps** (Figuren des
  Drop-Abschnitts, Intensität 5); nur `muted` unterscheidet sich. Manuelles
  Entmuten am Gerät spielt also jederzeit das volle Pattern.
- Stufen ohne einziges neues Part mit Sample entfallen; Parts ohne Sample
  bleiben in jeder Stufe gemutet.
- `chainTo` zeigt je Pattern auf den Folgeslot; Pro Melo bekommt je Melodie
  eine eigene Kette hintereinander.
- Umsetzung: `patternGen.baueAufbau(rezept, projekt, opts)`; `parts()` erhält
  `stepsImmer`, damit gemutete Parts ihre Steps behalten.

## 3 · Melo-Sync und Melo-Raster

**Varispeed-Fallback:** `bankPlan.bereiteAuf` schickte Melos mit > 12 %
Takt-Abweichung als One-Shot in die Bank — die liefen asynchron. Neu: erst
das Eigentempo messen (`tempoSchaetzen`), Faktor k ∈ {0.5, 1, 2} zum
Bank-Tempo wählen und varispeeden, wenn die nötige Rate in [0.8, 1.3] liegt;
sonst wie bisher One-Shot.

**Melo-Raster:** neues Modul `core/meloRaster.ts` — aus dem (taktgenauen)
Melo-Loop wird je 16tel-Step die Onset-Stärke und der Bassanteil über die
ersten 4 Takte gemessen (`raster.onset[64]`, `raster.bass[64]`, auf 0..1
normiert, 2 Nachkommastellen, gespeichert am `ProjektSample`).
`patternGen` nutzt das Raster, wenn das Thema-Melo eines hat:

- Stab: Hits auf den bis zu 6 stärksten Melo-Onsets statt fester Figur,
- Bass: Offbeat-Hits entfallen auf Steps, wo der Melo-Bassanteil hoch ist.

Kick bleibt bewusst 4-on-the-floor (Tekk-Gesetz).

## 4 · Lied als einziger Input

- `scripts/stems.py`: schreibt je Fenster zusätzlich `<id>-drums.wav`
  (normalisiert); `electron/main.cjs` reicht die Bytes als `drums` durch,
  `tekkLied.ts` typisiert sie.
- Neues Modul `core/drumSchnitt.ts`: schneidet aus dem Drums-Stem One-Shots —
  Onset-Erkennung (Peak-Picking auf `onsetKurve`, Mindestabstand 60 ms),
  Segmentierung bis zum nächsten Onset (max. 0,4 s), Klassifikation über
  Bassanteil/Länge (Kick / Snare / Hat), Dubletten per Korrelation raus,
  Auswahl: bis 2 Kicks, 2 Snares, 2 Hats (nach RMS).
- GUI: Checkbox „eigene Drums statt Lied-Drums" (Default: aus → Lied-Drums
  werden geschnitten und ersetzen die tekk-Empfehlung). Neuer Knopf
  **„Alles aus dem Lied"**: Analysieren → Stems → Schneiden → Bank bauen →
  Generieren (mit Aufbau-Kette, falls aktiv) in einem Ablauf; die
  Einzelschritte bleiben bedienbar.

## Tests

- `generator-session.test.ts`: `dateiRelevant` (TekkForge-, versteckte Ordner).
- `generator-pattern.test.ts`: Aufbau-Kette — Steps in allen Patterns gesetzt,
  Mutes wachsen monoton, Kick erst im Drop, Chain-Felder, Slot-Grenzen.
- `generator-bank.test.ts`: Off-Grid-Melo wird Loop mit Takten (Varispeed).
- `generator-melo-raster.test.ts`: synthetische Melo → Onsets auf den
  richtigen Steps; Stab/Bass-Ableitung deterministisch.
- `generator-drumschnitt.test.ts`: synthetischer Drums-Stem (Sinus-Kicks,
  Rausch-Hats) → richtige Rollenzahl.

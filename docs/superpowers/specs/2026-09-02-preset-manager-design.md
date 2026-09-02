# Preset-Manager — Entwurf (2026-09-02)

## Zweck

Alle Effekt-Presets des Geräts (96 IFX-Plätze, 32 MFX-Plätze) als eine
Übersicht mit Platznummern, in der man verschieben, umbenennen, tauschen,
löschen, ersetzen und neue einfügen kann — und das Ergebnis dann entweder
**flüchtig** aufs Gerät schreibt (RAM, zum Hören) oder **dauerhaft** in die
Hacktribe-Firmware einbrennt (`core/firmwareBau.ts`).

## Quellen

Der Manager lädt einen vollständigen Bankstand aus drei gleichwertigen
Quellen, alle liefern dieselben Bytes:

| Quelle | Woher | Was |
|---|---|---|
| Gerät | 96 + 32 Lesungen à 524 B + 13 Zähler | Stand im RAM |
| Sicherung (`.tfbak`) | `geraetSicherung` | Blöcke `ifxPreset`, `mfxPreset`, `maxIfxIndex` |
| Firmware (`.VSB`) | `firmwareBau.dateiOffset` | dieselben Bereiche im Abbild |

Der geladene Stand ist die **Basis**. Alles, was der Nutzer ändert, wird gegen
die Basis verglichen; geschrieben wird nur, was sich unterscheidet.

## Modell (`core/presetManager.ts`, rein)

```
ManagerZustand { ifx: Uint8Array[96]; mfx: Uint8Array[32]; ifxMaxIndex: number }
```

Jeder Platz hält einen 524-Byte-Block. „Leer“ = Namensbyte 0 (so sieht ein
unbelegter Platz auf dem Gerät aus: Init-Block ohne Namen). Operationen
liefern einen neuen Zustand, die Eingabe bleibt unangetastet:

- `umbenennen(art, platz, name)` — 15 Zeichen, byte-treu über `encodeFxPreset`
- `verschieben(art, von, nach)` — herausnehmen, einfügen, Rest rückt
- `tauschen(art, a, b)`
- `loeschen(art, platz)` — Rest rückt auf, hinten ein leerer Block (Listen-Semantik wie das Gerätemenü)
- `leeren(art, platz)` — Block bleibt, Inhalt wird Init ohne Namen (erzeugt eine Lücke)
- `ersetzen(art, platz, bytes)` / `einfuegen(art, platz, bytes)` — einfügen rückt den Rest nach hinten; fällt hinten ein **belegter** Block heraus, ist das ein Fehler
- `unterschiede(zustand, basis)` → `SammlungsEintrag[]` mit Platz (für RAM-Schreiben und Firmware-Bau)
- `alsSammlung(zustand, nurBelegt)` → Export
- `hoechsterBelegter(art)` und `luecken(art)` — für die Zählerlogik

Plätze zählen wie das Gerät, ab 1. Die Art-Grenzen: IFX 1–96, MFX 1–32.

## Panel (`gui/presetManager.ts`, im FX-Preset-Bereich)

- Quellenzeile: **Vom Gerät lesen**, **Sicherung laden…**, **Firmware laden…**
- Zwei Tabellen (IFX, MFX): Platz · Name · Algorithmus · Knöpfe
  ▲ ▼ (verschieben), ⇄ (tauschen, fragt nach Platz), ✎ (in den Editor),
  ✏ (umbenennen), ⬇ (als Datei), ✕ (löschen). Geänderte Zeilen sind markiert.
- **+ Datei einfügen…** (`.e2fxp`/`.mfx`/`.tfsam` — Sammlung füllt ab dem
  ersten leeren Platz), **Aus Editor übernehmen** (in den gewählten Platz).
- **Als Sammlung sichern…** (`.tfsam` mit Plätzen).
- **⚠ Flüchtig schreiben (RAM)** — nur die Unterschiede zur Basis, danach
  bei Bedarf die 13 IFX-Zähler über `ifxMenueErweitern` (Lückenprüfung); der
  bestehende „Alle zurückschreiben“-Weg nimmt alles zurück.
- **Firmware patchen…** — fragt nach der Hacktribe-`SYSTEM.VSB`, prüft den
  Hash, baut mit `baueFirmware` aus den Unterschieden **zur Firmware-Datei**
  (nicht zur Basis — die Datei ist die Wahrheit für den Flash) und legt das
  Ergebnis ab. Nur MFX/IFX; Grooves nicht.

## Fehler und Grenzen

- Ohne Basis kein Schreiben: erst laden.
- Eine Lücke im IFX-Bereich hinter dem Werkszähler stoppt die Zählererweiterung
  (Meldung nennt die Plätze); die Presets selbst werden trotzdem geschrieben.
- Firmware nur mit Sampler-Header und passendem Hash; Ausnahme-Schalter gibt
  es im Panel nicht (das Skript hat `--basis-egal`).
- MFX: 32 Plätze, keine Erweiterung; Löschen rückt auf und hinterlässt hinten
  einen leeren Block — das Gerätemenü zeigt ihn namenlos.

## Tests

- Kern: jede Operation, Randfälle (Grenzen, Einfügen mit vollem Ende,
  Unterschiede nach Verschieben, Round-Trip über Sammlung).
- Panel: laden aus Sicherung, verschieben, löschen, flüchtig schreiben nur der
  Unterschiede, Firmware-Bau aus dem Zustand (Stub-DOM wie `fx-preset-panel.test.ts`).

# Tekk-Groove-Vorlagen

18 Groove-Vorlagen für die Electribe 2 mit Hacktribe-Firmware — je eine
`.e2gv` (320-Byte-Block, wie das Gerät ihn hält) und eine Sammlung
`TekkForge-Grooves-Tekk.tfsam`, die alle auf einmal in die **Bibliothek des
Preset-Managers** lädt. Von dort auf einen Groove-Platz ziehen, flüchtig
schreiben oder in die Firmware einbrennen.

Eine Vorlage legt je Step drei Dinge fest: den **Zeitversatz** (−48..+48,
±48 = halber Step, negativ = früher), die **Anschlagstärke** (0..127) und die
**Tonlänge** (0..96, 96 = ganz). Sie wird einem Part zugewiesen und
wiederholt sich mit ihrer Länge.

## Woher die Zahlen kommen

Aus den 62 Werksvorlagen der Hacktribe-Firmware (Sicherung vom 2026-09-01,
dekodiert): Grundanschlag um 96, Akzente 120–127, Ghosts 30–60; Versatz
meist ±4..±22, „Rushbeat“ schiebt alles um −44; Gate fast immer 96. Tekk ist
gerade und treibend — deshalb hier wenig Versatz, klare Akzente auf den
Vierteln, Ghosts auf den Sechzehnteln, und ein paar Vorlagen, die den Puls
bewusst kippen. **Step 1 bleibt in jeder Vorlage an Ort und Stelle**, der
Puls hängt an ihm.

## Die Vorlagen

| Datei | Name im Menü | Steps | Was sie tut |
|---|---|---|---|
| `01-tekk-straight` | Tekk Straight | 16 | gerade; Viertel 127, Achtel 118, Sechzehntel 96 — die Grundvorlage |
| `02-tekk-push` | Tekk Push | 16 | Achtel-Offbeats −10 (früher) — treibt |
| `03-tekk-drag` | Tekk Drag | 16 | Achtel-Offbeats +10 (später) — schwerer Schritt |
| `04-swing-8-light` | Swing 8 Light | 16 | Achtel +12, Sechzehntel leiser |
| `05-swing-8-hard` | Swing 8 Hard | 16 | Achtel +24, Sechzehntel leiser |
| `06-swing-16` | Swing 16 | 16 | jeder zweite Sechzehntel +10 und leiser — für Hats |
| `07-shuffle-16` | Shuffle 16 | 16 | Sechzehntel +20 und deutlich leiser (64) |
| `08-hat-ghost` | Hat Ghost | 16 | Viertel 127, Achtel 100, Sechzehntel 48 und halb so lang |
| `09-kick-punch` | Kick Punch | 16 | für Kicks auf allen Sechzehnteln: Viertel voll, Rest 60 und kurz |
| `10-gate-chop` | Gate Chop | 16 | Tonlänge wechselt 96/24 — zerhackt lange Samples |
| `11-stomp` | Stomp | 16 | Viertel ganz und 127, alles andere Gate 20 |
| `12-ramp-up-4` | Ramp Up 4 | 16 | Anschlag je Vierergruppe 70 → 85 → 100 → 127 |
| `13-ramp-down-4` | Ramp Down 4 | 16 | 127 → 105 → 85 → 70 |
| `14-rush` | Rush | 16 | alles außer den Vierteln −20 — wie das Werks-„Rushbeat“, nur mit festem Puls |
| `15-laid-back` | Laid Back | 16 | alles außer den Vierteln +14 |
| `16-bounce` | Bounce | 16 | Sechzehntel +8 und 60, Achtel 100, Viertel 127 |
| `17-hardtekk-64` | Hardtekk 64 | 64 | drei gerade Takte, im vierten steigt der Anschlag über die letzten vier Steps auf 127 bei kürzer werdenden Gates — der eingebaute Fill |
| `18-breaker-32` | Breaker 32 | 32 | Takt 1 gerade, Takt 2 Achtel −12 und Sechzehntel als Ghosts — der Bruch alle zwei Takte |

## Laden und aufs Gerät

Im Preset-Manager: **Bibliothek → + Laden…** → `TekkForge-Grooves-Tekk.tfsam`
(oder einzelne `.e2gv`). Dann auf einen Groove-Platz ziehen — leerer Platz:
einfach rein; belegter Platz: Ersetzen, davor oder danach einfügen. **Flüchtig
schreiben** legt sie ins RAM und zieht die vier Groove-Zähler nach; die
**Firmware-Werkbank** brennt sie dauerhaft ein. Am Gerät den Part auf die
Vorlage stellen und hören.

⚠ Gehört hat das hier noch niemand. Was am Gerät anders wirkt als der Name
verspricht, gehört gemeldet und korrigiert.

## Neu erzeugen

```
npx tsx scripts/make-grooves.mjs [zielordner]
```

`tests/grooves-beispiele.test.ts` prüft jede Datei: 320 Byte, Rahmen
GVST…GVED, Step-Tabelle bei 0x30, Name, Länge 1..64, alle Werte in den
Bereichen des Geräts, Step 1 ohne Versatz, kein Duplikat, und dass die
Sammlung genau die Dateien trägt.

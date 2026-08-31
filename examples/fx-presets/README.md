# Beispiel-IFX-Presets

Zwölf fertig eingestellte Insert-Effekt-Presets für die Electribe 2 mit
Hacktribe-Firmware — je eine `.e2fxp`-Datei (roher 524-Byte-Block, dasselbe
Format wie die `.ifx`-Dateien des hacktribe-Editors) plus
`TekkForge-IFX-Starter.tfsam`, das alle zwölf auf einmal in die Sammlung lädt.

Gedacht sind sie zum **Ausprobieren des Schreibpfads**: bis hierhin konnte der
Preset-Editor nur weiterreichen, was vorher vom Gerät kam. Diese Dateien gibt
es ohne Gerät — mit Namen fürs Gerätemenü, gesetzten Parametern und einer
Zuordnung auf den IFX-Regler, damit beim Drehen auch etwas passiert.

## Was drin ist

| Datei | Name im Menü | IFX 1 | IFX 2 | IFX-Regler zieht |
|---|---|---|---|---|
| `01-tekk-drive.e2fxp` | Tekk Drive | Distortion | — | `gain` 40 → 127 |
| `02-bit-tekk.e2fxp` | Bit Tekk | Decimator | — | `sample_freq` 8 → 90 |
| `03-kick-press.e2fxp` | Kick Press | MKP2 Comp | — | `sensitivity` 60 → 127 |
| `04-ring-tekk.e2fxp` | Ring Tekk | Ring Mod | — | `osc_freq` 10 → 120 |
| `05-echo-sync.e2fxp` | Echo Sync | Short Delay | — | `fb_depth` 0 → 110 |
| `06-flange-jet.e2fxp` | Flange Jet | Flanger | — | `manual` 0 → 127 |
| `07-phase-sweep.e2fxp` | Phase Sweep | Phaser | — | `manual` 0 → 127 |
| `08-gate-chop.e2fxp` | Gate Chop | Tremolo | — | `mod_int` 0 → 127 |
| `09-kick-eq.e2fxp` | Kick EQ | EQ 4-Band | — | `b1_gain` 36 → 56 |
| `10-acid-filter.e2fxp` | Acid Filter | Acid Driver | Filter | `frequency` 10 → 127 **und** `drive` 30 → 127 |
| `11-punch-filter.e2fxp` | Punch Filter | Punch | Filter | `frequency` 5 → 127 |
| `12-comp-drive.e2fxp` | Comp Drive | Cheap Comp | Acid Driver | `drive` 20 → 127 |

Der Master-Effekt steht in allen zwölf auf **Thru**. Diese Dateien gehören in
IFX-Plätze; stünde dort ein MFX-Algorithmus, würde ein Schreiben den
Master-Effekt mit umstellen.

`10-acid-filter` hat als einziges **zwei** Zuordnungen auf denselben Regler —
ein Zug öffnet das Filter und dreht gleichzeitig die Zerre auf.

## Laden und aufs Gerät schreiben

Im FX-Preset-Bereich, mit verbundenem Gerät:

1. Art auf **Insert-Effekt** stellen.
2. **Datei laden** → eine `.e2fxp` wählen. (Oder **Sammlung laden** →
   `TekkForge-IFX-Starter.tfsam`, dann in der Liste auf „bearbeiten“.)
3. Ziel-Platz eintragen und **Lesen** drücken. Das holt den Vorher-Stand für
   das Zurückschreiben; der geladene Stand bleibt dabei im Editor stehen.
4. **Schreiben**. Am Gerät den Part auf den Platz stellen und den IFX-Regler
   drehen.

**Welcher Platz.** TekkForge zählt die `add_ifx`-Limitzähler bewusst *nicht*
hoch (13 verstreute Bytes; ein halb hochgezählter Satz hinterlässt eine
inkonsistente Firmware). Ein Preset in einem bisher **leeren** Platz taucht
deshalb im Gerätemenü nicht auf. Also über einen **belegten** Platz schreiben —
`Max-IFX-Index` (`0xC0048F80`) sagt, bis wohin belegt ist; auf dem Testgerät
war das 48, also Plätze 0–48. Der abgenommene Schreiblauf im Haupt-README lief
auf Platz 40.

**Zurück kommt man immer.** Die Presets liegen im RAM: **Undo** schreibt den
gelesenen Vorher-Stand zurück, und ein Aus-und-Wieder-Ein stellt ohnehin alles
her. ⚠ Das Gerät darf während des Schreibens **nicht spielen**.

Dieselben Dateien lassen sich auch in Synthstudio laden (E2s-Preset-Panel,
„.bin importieren“ — die Art wird an der Größe erkannt) und mit
`omnitribe/tools/hwtest/ifx_preset.py` gegen das Gerät vergleichen.

## Woher die Werte kommen — und woher nicht

Jedes Preset startet auf den **werkseitigen Defaults** seines Algorithmus,
bit-genau aus hacktribe-editor `utils/ht_fx_ram_format.py`. Nur benannte
Parameter weichen davon ab.

Was das **nicht** ist: eine Vermessung. Semantische Bereiche und Einheiten der
Parameter sind in hacktribe nicht hinterlegt (dort als TODO markiert) — bekannt
ist nur 0..127. Die Abweichungen folgen dem Parameternamen und der Richtung,
die er nahelegt: `gain` hoch heißt mehr Zerre, `bit_depth` runter heißt mehr
Krümel, 36 ist bei allen EQ-Bändern der neutrale Werkswert. Wo die Bedeutung
einer Zahl unbekannt ist — `lfo_sync_note`, `output_select`, `mask_type` —
steht der Werkswert. Geraten wird nicht.

Gehört hat das hier niemand. Genau dafür sind es Testdateien: was am Gerät
anders klingt als der Name verspricht, gehört gemeldet und korrigiert.

## Zwei Inserts

Ein zweiter Insert ist nur bei „leichten“ Algorithmen erlaubt (Thru, Cheap
Comp, Punch, EQ 2-Band, Filter, Acid Driver, Mute). Die beiden
Schwesterprojekte lesen die Regel verschieden — Synthstudio prüft sie gegen
IFX 2, TekkForges `ifx2Moeglich` gegen IFX 1. Solange das nicht am Gerät
entschieden ist, nehmen die drei zweistufigen Presets **beide** Slots aus
dieser Liste; damit sind sie nach jeder der beiden Lesarten gültig.

## Neu erzeugen

```
npx tsx scripts/make-fx-presets.mjs [zielordner]
```

Die Definitionen stehen im Kopf des Skripts. `tests/fx-presets-beispiele.test.ts`
prüft jede erzeugte Datei: Größe, Name, bekannter Algorithmus, MFX auf Thru,
Zwei-Insert-Regel, und dass jede Zuordnung auf einen Parameter zeigt, den es
beim gewählten Algorithmus **gibt** — ein Zeiger ins Leere bliebe sonst bis
zum Gerät unsichtbar und sähe dort wie ein Übertragungsfehler aus.

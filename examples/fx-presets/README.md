# Beispiel-Presets für Insert- und Master-Effekte

Vierundzwanzig fertig eingestellte FX-Presets für die Electribe 2 mit
Hacktribe-Firmware — je eine Datei mit dem rohen 524-Byte-Block, plus zwei
Sammlungen, die alle auf einmal laden:

| Art | Endung | Ziel im RAM | Plätze | Sammlung |
|---|---|---|---|---|
| Insert-Effekt (12×) | `.e2fxp` | `0xC00A80F0` | 0–95 | `TekkForge-IFX-Starter.tfsam` |
| Master-Effekt (12×) | `.mfx` | `0xC00B4F30` | 0–31 | `TekkForge-MFX-Starter.tfsam` |

Gedacht sind sie zum **Ausprobieren des Schreibpfads**: bis hierhin konnte der
Preset-Editor nur weiterreichen, was vorher vom Gerät kam. Diese Dateien gibt
es ohne Gerät — mit Namen fürs Gerätemenü, gesetzten Parametern und
Zuordnungen auf die Bedienelemente, damit beim Drehen bzw. Wischen auch etwas
passiert.

Die Master-Dateien heißen `.mfx` (wie die des hacktribe-Editors), weil
`ausDatei()` auf diese Endung die Art selbst umstellt. Ein Master-Preset in
einen Insert-Platz geschrieben täte schlicht nichts — und das sähe aus wie ein
Fehler der Übertragung.

## Insert-Effekte — der IFX-Regler pro Part

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

`10-acid-filter` hat als einziges **zwei** Zuordnungen auf denselben Regler —
ein Zug öffnet das Filter und dreht gleichzeitig die Zerre auf.

## Master-Effekte — die X/Y-Fläche

| Datei | Name im Menü | Algorithmus | X-Achse | Y-Achse |
|---|---|---|---|---|
| `m01-master-glue.mfx` | Master Glue | MKP2 Comp | `sensitivity` 30 → 127 | `attack` 0 → 127 |
| `m02-master-limit.mfx` | Master Limit | Limiter | `threshold` 8 → 64 | `tube_sat` 0 → 127 |
| `m03-master-eq.mfx` | Master EQ | EQ 4-Band | `b1_gain` 24 → 52 | `b4_gain` 24 → 52 |
| `m04-filter-drop.mfx` | Filter Drop | Multimode Filter | `frequency` 5 → 127 | `resonance` 0 → 127 |
| `m05-master-drive.mfx` | Master Drive | Distortion | `gain` 30 → 127 | `post_eq3_gain` 20 → 52 |
| `m06-tube-warm.mfx` | Tube Warm | Tube Pre | `tube1_sat` 40 → 127 | `tube2_sat` 40 → 127 |
| `m07-room-wide.mfx` | Room Wide | Room Reverb | `dry_wet` 0 → 127 | `time` 10 → 100 |
| `m08-tape-echo.mfx` | Tape Echo | Tape Echo | `feedback` 0 → 115 | `dry_wet` 0 → 127 |
| `m09-mod-delay.mfx` | Mod Delay | Mod Delay | `fb_depth` 0 → 115 | `dry_wet` 0 → 127 |
| `m10-grain-stutter.mfx` | Grain Stutter | Grain Shifter | `dry_wet` 0 → 127 | `off_lfo_freq` 5 → 127 |
| `m11-vinyl-stop.mfx` | Vinyl Stop | Vinyl Break | `delta_pitch` 0 → 127 | `scratch` 0 → 127 |
| `m12-master-crush.mfx` | Master Crush | Decimator | `sample_freq` 6 → 90 | `bit_depth` 2 → 16 |

`m11-vinyl-stop` hat zusätzlich eine dritte Zuordnung: **Berühren** der Fläche
(Quelle `0x41`) setzt `pad_on` auf 1 — das ist der Auslöser des Plattenstopps.

Die nicht genutzte Seite steht überall auf Thru: in den Insert-Presets der
Master, in den Master-Presets beide Inserts. Ein Preset soll beim Schreiben
nicht die andere Hälfte der Kette mit umstellen.

## Laden und aufs Gerät schreiben

Im FX-Preset-Bereich, mit verbundenem Gerät:

1. **Datei laden** → eine `.e2fxp` oder `.mfx` wählen. Bei `.mfx` springt die
   Art selbst auf Master-Effekt; bei `.e2fxp` vorher auf **Insert-Effekt**
   stellen. (Oder **Sammlung laden** → eine der beiden `.tfsam`, dann in der
   Liste auf „bearbeiten“ — dort trägt jeder Eintrag seine Art selbst.)
2. Ziel-Platz eintragen und **Lesen** drücken. Das holt den Vorher-Stand für
   das Zurückschreiben; der geladene Stand bleibt dabei im Editor stehen.
3. **Schreiben**. Am Gerät den Part auf den Platz stellen und drehen (Insert)
   bzw. über die X/Y-Fläche wischen (Master).

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

Wo selbst die *Richtung* offen ist, entscheidet nicht das Skript, sondern die
Hand. Wie viel Hall über der Summe richtig ist, weiß hier niemand: `dry_wet`
von `m07-room-wide` bleibt deshalb auf dem Werkswert und liegt stattdessen auf
der X-Achse. Wer wischt, hört in einer Sekunde, was keine Vermutung leisten
kann. Dasselbe bei den beiden Delays.

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
prüft jede erzeugte Datei: Größe, Name, bekannter Algorithmus aus dem richtigen
Nummernkreis, die jeweils andere Hälfte der Kette auf Thru, die Zwei-Insert-Regel,
und dass jede Zuordnung auf einen Parameter zeigt, den es bei diesem Algorithmus
**gibt** — ein Zeiger ins Leere bliebe sonst bis zum Gerät unsichtbar und sähe
dort wie ein Übertragungsfehler aus.

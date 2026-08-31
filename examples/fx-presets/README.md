# Beispiel-Presets für Insert- und Master-Effekte

Zweiundsiebzig fertig eingestellte FX-Presets für die Electribe 2 mit
Hacktribe-Firmware — je eine Datei mit dem rohen 524-Byte-Block, plus vier
Sammlungen, die sie gruppenweise auf einmal laden:

| Art | Endung | Ziel im RAM | Plätze | Sammlungen |
|---|---|---|---|---|
| Insert-Effekt | `.e2fxp` | `0xC00A80F0` | 0–95 | `TekkForge-IFX-Starter.tfsam` (12) · `TekkForge-IFX-Variationen.tfsam` (24) |
| Master-Effekt | `.mfx` | `0xC00B4F30` | 0–31 | `TekkForge-MFX-Starter.tfsam` (12) · `TekkForge-MFX-Variationen.tfsam` (24) |

Zu jedem der 24 Basis-Presets gibt es **zwei Variationen** (`01a-…`, `01b-…`
zu `01-…`): derselbe Algorithmus, in genau eine Richtung verschoben. Nur so
ist der Vergleich einer — wer drei Dateien nacheinander in denselben Platz
schreibt und dieselbe Sequenz laufen lässt, hört den Unterschied und sonst
nichts.

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

## Variationen — je zwei pro Basis

Zum Vergleichen: gleicher Algorithmus, ein Aspekt verschoben. Steht in der
Spalte „Regler/X“ etwas, liegt bei dieser Variation ein **anderes Ziel** unter
dem Bedienelement als bei der Basis.

### Insert

| Basis | a | b | Was sich unterscheidet |
|---|---|---|---|
| Tekk Drive | Tekk Drive Warm | Tekk Drive Fuzz | Zerrgrad 55 / 100 / 127, Ausgangspegel gegenläufig |
| Bit Tekk | Bit Tekk Rate | Bit Tekk Bits | nur Rate ↓ bzw. nur Auflösung ↓ (b: Regler zieht `bit_depth`) |
| Kick Press | Kick Press Slow | Kick Press Slam | Attack 90 / 10 / 0 (a: Regler zieht `attack`) |
| Ring Tekk | Ring Tekk Low | Ring Tekk High | `osc_freq` 14 / 48 / 100 |
| Echo Sync | Echo Sync Slap | Echo Sync Dub | Rückkopplung 0 / 70 / 110 (a: Regler zieht `wet_level`) |
| Flange Jet | Flange Jet Slow | Flange Jet Fast | LFO-Rate 1 / 4 / 30 |
| Phase Sweep | Phase Auto | Phase Wide | a: LFO fährt selbst, Regler auf Resonanz · b: anderer Typ |
| Gate Chop | Gate Chop Half | Gate Chop Free | halbe Tiefe · ohne Tempo-Kopplung (b: Regler zieht `lfo_speed`) |
| Kick EQ | Kick EQ Boost | Kick EQ Scoop | alle Bänder ≥ 36 · tiefe Kuhle (b: Regler zieht `b2_gain`) |
| Acid Filter | Acid Filter Alt | Acid Filter Hot | `output_select` = 1 · Zerre + Resonanz am Anschlag |
| Punch Filter | Punch Filt Alt2 | Punch Filt Open | `output_select` = 2 · weit offen, wenig Resonanz |
| Comp Drive | Comp Drive Soft | Comp Drive Max | beide Stufen zurück bzw. am Anschlag |

### Master

| Basis | a | b | Was sich unterscheidet |
|---|---|---|---|
| Master Glue | Glue Soft | Glue Slam | Ansprache 55 / 90 / 127, Attack gegenläufig |
| Master Limit | Limit Clean | Limit Max | Schwelle 50 / 28 / 8, Röhre 0 / 70 / 127 |
| Master EQ | EQ Tilt Dark | EQ Tilt Bright | Kippe nach unten bzw. nach oben |
| Filter Drop | Filter Drop HP | Filter Drop BP | Hochpass bzw. Bandpass statt Tiefpass |
| Master Drive | Drive Warm | Drive Fuzz | Zerrgrad 50 / 95 / 127 |
| Tube Warm | Tube Warm Lo | Tube Warm Hot | beide Röhren zurück bzw. am Anschlag |
| Room Wide | Room Short | Room Long | Länge 18 / 45 / 100, Dämpfung gegenläufig |
| Tape Echo | Tape Echo Clean | Tape Echo Wash | Rückkopplung 55 / 95 / 118, Sättigung mit |
| Mod Delay | Mod Delay Dry | Mod Delay Wide | Modulation 0 / 50 / 110 |
| Grain Stutter | Grain Fine | Grain Rough | `off_duration` 12 / 42 / 90 |
| Vinyl Stop | Vinyl Slow | Vinyl Scratch | träger Auslauf · Kratzen statt Stoppen (b: X/Y auf `scratch`) |
| Master Crush | Crush Rate | Crush Bits | nur Rate ↓ bzw. nur Auflösung ↓ (b: X/Y getauscht) |

### Fünf davon sind Sonden

Manche Paare beantworten nebenbei eine Frage, die in den Format-Unterlagen
offen ist — zwei Dateien, die sich in **einem** Byte unterscheiden, klären am
Ohr, was keine Tabelle hergibt:

| Sonde | Frage |
|---|---|
| `Kick EQ Boost` ↔ `Kick EQ Scoop` | Ist 36 wirklich neutral, und heißt höher lauter? |
| `EQ Tilt Dark` ↔ `EQ Tilt Bright` | dasselbe für den Master-EQ |
| `Acid Filter Alt` (1), `Punch Filt Alt2` (2), Basis (0) | Was macht `output_select` beim Filter? |
| `Grain Fine` ↔ `Grain Rough` | Was tut `off_duration`? |
| `Bit Tekk Rate` ↔ `Bit Tekk Bits` | Welche der beiden Achsen macht den Crush-Klang aus? |

Was dabei herauskommt, gehört zurück in die Tabellen (`e2FxParams.ts`) — und
in dieses README.

Die nicht genutzte Seite steht überall auf Thru: in den Insert-Presets der
Master, in den Master-Presets beide Inserts. Ein Preset soll beim Schreiben
nicht die andere Hälfte der Kette mit umstellen.

## Laden und aufs Gerät schreiben

Im FX-Preset-Bereich, mit verbundenem Gerät:

1. **Datei laden** → eine `.e2fxp` oder `.mfx` wählen. Bei `.mfx` springt die
   Art selbst auf Master-Effekt; bei `.e2fxp` vorher auf **Insert-Effekt**
   stellen. (Oder **Sammlung laden** → eine der vier `.tfsam`, dann in der
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

**Zum Vergleichen** lohnt ein fester Ablauf: eine Sequenz laufen lassen, die
drei Fassungen (Basis, `a`, `b`) nacheinander in **denselben** Platz schreiben
und den Part nicht umstellen. So ist der Unterschied wirklich das Preset und
nicht der Kontext. Auf drei getrennte Plätze geschrieben geht es schneller,
aber dann wechselt beim Umschalten mehr als nur die Werte.

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

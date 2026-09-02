# Beispiel-Presets für Insert- und Master-Effekte

144 fertig eingestellte FX-Presets für die Electribe 2 mit Hacktribe-Firmware
— je eine Datei mit dem rohen 524-Byte-Block, dazu acht Sammlungen, die sie
gruppenweise auf einmal laden.

| Set | Art | Endung | Ziel im RAM | Plätze | Sammlungen |
|---|---|---|---|---|---|
| **Starter** — Tekk-Werkzeug | Insert | `.e2fxp` | `0xC00A80F0` | 0–95 | `IFX-Starter` (12) · `IFX-Variationen` (24) |
| **Starter** — Summe | Master | `.mfx` | `0xC00B4F30` | 0–31 | `MFX-Starter` (12) · `MFX-Variationen` (24) |
| **Farben** — Formen statt Zerlegen | Insert | `.e2fxp` | `0xC00A80F0` | 0–95 | `IFX-Farben` (12) · `IFX-Farben-Variationen` (24) |
| **Raum & Bewegung** | Master | `.mfx` | `0xC00B4F30` | 0–31 | `MFX-Raum` (12) · `MFX-Raum-Variationen` (24) |

Zusammen decken die vier Sets **alle 20 Insert-Algorithmen und 24 der 25
Master-Algorithmen** der Hacktribe-Firmware ab. Übrig bleibt nur der
Master-`Mute` — ein gespeichertes Preset, das nichts tut, ist keins.

Zu jedem der 48 Basis-Presets gibt es **zwei Variationen** (`01a-…`, `01b-…`
zu `01-…`): derselbe Algorithmus, in genau eine Richtung verschoben. Nur so
ist der Vergleich einer — wer drei Dateien nacheinander in denselben Platz
schreibt und dieselbe Sequenz laufen lässt, hört den Unterschied und sonst
nichts.

Mehr Presets als Plätze: 72 Insert-Presets auf 96 Plätze (davon im Menü nur
die belegten, siehe unten), 72 Master-Presets auf 32. Das ist Absicht — es
soll ausgewählt werden, nicht alles gleichzeitig draufpassen.

---

## Set „Starter“ — Insert

Der IFX-Regler des Parts liegt auf dem, was den Klang trägt.

| Datei | Name im Menü | IFX 1 | IFX 2 | IFX-Regler zieht |
|---|---|---|---|---|
| `01-tekk-drive` | Tekk Drive | Distortion | — | `gain` 40 → 127 |
| `02-bit-tekk` | Bit Tekk | Decimator | — | `sample_freq` 8 → 90 |
| `03-kick-press` | Kick Press | MKP2 Comp | — | `sensitivity` 60 → 127 |
| `04-ring-tekk` | Ring Tekk | Ring Mod | — | `osc_freq` 10 → 120 |
| `05-echo-sync` | Echo Sync | Short Delay | — | `fb_depth` 0 → 110 |
| `06-flange-jet` | Flange Jet | Flanger | — | `manual` 0 → 127 |
| `07-phase-sweep` | Phase Sweep | Phaser | — | `manual` 0 → 127 |
| `08-gate-chop` | Gate Chop | Tremolo | — | `mod_int` 0 → 127 |
| `09-kick-eq` | Kick EQ | EQ 4-Band | — | `b1_gain` 36 → 56 |
| `10-acid-filter` | Acid Filter | Acid Driver | Filter | `frequency` 10 → 127 **und** `drive` 30 → 127 |
| `11-punch-filter` | Punch Filter | Punch | Filter | `frequency` 5 → 127 |
| `12-comp-drive` | Comp Drive | Cheap Comp | Acid Driver | `drive` 20 → 127 |

### Variationen

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

---

## Set „Starter“ — Master

X- und Y-Achse der Fläche sind belegt.

| Datei | Name im Menü | Algorithmus | X-Achse | Y-Achse |
|---|---|---|---|---|
| `m01-master-glue` | Master Glue | MKP2 Comp | `sensitivity` 30 → 127 | `attack` 0 → 127 |
| `m02-master-limit` | Master Limit | Limiter | `threshold` 8 → 64 | `tube_sat` 0 → 127 |
| `m03-master-eq` | Master EQ | EQ 4-Band | `b1_gain` 24 → 52 | `b4_gain` 24 → 52 |
| `m04-filter-drop` | Filter Drop | Multimode Filter | `frequency` 5 → 127 | `resonance` 0 → 127 |
| `m05-master-drive` | Master Drive | Distortion | `gain` 30 → 127 | `post_eq3_gain` 20 → 52 |
| `m06-tube-warm` | Tube Warm | Tube Pre | `tube1_sat` 40 → 127 | `tube2_sat` 40 → 127 |
| `m07-room-wide` | Room Wide | Room Reverb | `dry_wet` 0 → 127 | `time` 10 → 100 |
| `m08-tape-echo` | Tape Echo | Tape Echo | `feedback` 0 → 115 | `dry_wet` 0 → 127 |
| `m09-mod-delay` | Mod Delay | Mod Delay | `fb_depth` 0 → 115 | `dry_wet` 0 → 127 |
| `m10-grain-stutter` | Grain Stutter | Grain Shifter | `dry_wet` 0 → 127 | `off_lfo_freq` 5 → 127 |
| `m11-vinyl-stop` | Vinyl Stop | Vinyl Break | `delta_pitch` 0 → 127 | `scratch` 0 → 127 |
| `m12-master-crush` | Master Crush | Decimator | `sample_freq` 6 → 90 | `bit_depth` 2 → 16 |

`m11-vinyl-stop` hat eine dritte Zuordnung: **Berühren** der Fläche (Quelle
`0x41`) setzt `pad_on` — den Auslöser des Plattenstopps.

### Variationen

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

---

## Set „Farben“ — Insert

Das Starter-Set zerlegt: Zerre, Bitcrusher, Ringmodulator. Dieses formt:
Kompression, EQ, Anwärmung, Breite. Es benutzt ausschließlich Algorithmen,
die im Starter-Set nicht vorkommen, plus fünf noch ungenutzte
Zweier-Kombinationen aus der Leicht-Whitelist.

| Datei | Name im Menü | IFX 1 | IFX 2 | IFX-Regler zieht |
|---|---|---|---|---|
| `13-sr1-squeeze` | SR1 Squeeze | SR1 Comp | — | `threshold` 8 → 64 |
| `14-peak-guard` | Peak Guard | Limiter | — | `threshold` 10 → 80 |
| `15-two-band` | Two Band | EQ 2-Band | — | `b1_gain` 24 → 56 |
| `16-air-excite` | Air Excite | Exciter | — | `blend` 0 → 127 |
| `17-wide-chorus` | Wide Chorus | Chorus | — | `mod_int` 0 → 127 |
| `18-level-pump` | Level Pump | Level Mod | — | `level_mod_int` 0 → 127 |
| `19-cut-fader` | Cut Fader | Mute | — | `fader` 0 → 127 |
| `20-eq-filter` | EQ Filter | EQ 2-Band | Filter | `frequency` 10 → 127 |
| `21-punch-drive` | Punch Drive | Punch | Acid Driver | `drive` 20 → 127 |
| `22-comp-filter` | Comp Filter | Cheap Comp | Filter | `frequency` 5 → 127 |
| `23-filter-drive` | Filter Drive | Filter | Acid Driver | `frequency` 10 → 127 **und** `drive` 30 → 127 |
| `24-eq-drive` | EQ Drive | EQ 2-Band | Acid Driver | `drive` 20 → 127 |

**`23-filter-drive` ist Absicht:** dieselben Werte und dieselben Zuordnungen
wie `10-acid-filter`, nur die beiden Inserts vertauscht — erst Filter, dann
Zerre statt umgekehrt. Zwei Presets, die sich in nichts als der Kettenfolge
unterscheiden. Was das ausmacht, hört man: am Gerät (2026-09-01) war
Filter→Zerre deutlich aggressiver.

### Variationen

| Basis | a | b | Was sich unterscheidet |
|---|---|---|---|
| SR1 Squeeze | SR1 Squeeze Lo | SR1 Squeeze Hi | Schwelle 60 / 24 / 10, Verhältnis 6 / 20 / 40 |
| Peak Guard | Peak Guard Soft | Peak Guard Wall | Schwelle 60 / 30 / 8, Freigabe gegenläufig |
| Two Band | Two Band Smile | Two Band Mid | beide Bänder hoch bzw. beide runter |
| Air Excite | Air Excite Soft | Air Excite Max | Anteil 40 / 90 / 127 |
| Wide Chorus | Chorus Narrow | Chorus Deep | Tiefe + Spreizung 40/20 · 90/110 · 127/127 |
| Level Pump | Level Pump Soft | Level Pump Hard | Tiefe 60 / 127 / 127, Sättigung 10 / 40 / 100 |
| Cut Fader | Cut Fader Half | Cut Fader Full | `fader` 0 / 64 / 127 |
| EQ Filter | EQ Filter Dark | EQ Filter Brite | Höhen und Filterlage gegenläufig |
| Punch Drive | Punch Drive Lo | Punch Drive Hi | Zerre 40 / 80 / 127 |
| Comp Filter | Comp Filter Lo | Comp Filter Hi | Kompression + Filterlage zusammen |
| Filter Drive | Filter Drive Lo | Filter Drive Hi | Resonanz 60 / 100 / 120, Zerre 45 / 90 / 127 |
| EQ Drive | EQ Drive Clean | EQ Drive Fat | Bassanhebung vor der Zerre 40 / 50 / 58 |

---

## Set „Raum & Bewegung“ — Master

Das Starter-Set arbeitet an der Summe (Kompressor, EQ, Zerre, Filter). Dieses
stellt sie in einen Raum und bringt sie in Bewegung.

| Datei | Name im Menü | Algorithmus | X-Achse | Y-Achse |
|---|---|---|---|---|
| `m13-sr1-bus` | SR1 Bus | SR1 Comp | `threshold` 10 → 70 | `ratio` 2 → 40 |
| `m14-auto-wah` | Auto Wah | Wah | `manual` 0 → 127 | `mod_int` 0 → 127 |
| `m15-chorus-wide` | Chorus Wide | Chorus | `mod_int` 0 → 127 | `lfo_speed` 2 → 80 |
| `m16-flanger-sweep` | Flanger Sweep | Flanger | `manual` 0 → 127 | `feedback` 0 → 127 |
| `m17-phaser-slow` | Phaser Slow | Phaser | `manual` 0 → 127 | `resonance` 0 → 127 |
| `m18-tremolo-sync` | Tremolo Sync | Tremolo | `mod_int` 0 → 127 | `lfo_shape` 0 → 127 |
| `m19-pump-master` | Pump Master | Level Mod | `level_mod_int` 0 → 127 | `saturation` 0 → 127 |
| `m20-hall-big` | Hall Big | Hall Reverb | `dry_wet` 0 → 127 | `time` 5 → 127 |
| `m21-hall-smooth` | Smooth Hall | Smooth Hall | `dry_wet` 0 → 127 | `time` 5 → 127 |
| `m22-plate-wet` | Plate Wet | Wet Plate Reverb | `dry_wet` 0 → 127 | `time` 5 → 127 |
| `m23-plate-dry` | Plate Dry | Dry Plate Reverb | `dry_wet` 0 → 127 | `time` 5 → 127 |
| `m24-loop-freeze` | Loop Freeze | KPQ Looper | `loop_length` 1 → 127 | `step` 0 → 127 |

`m24-loop-freeze` hat wie „Vinyl Stop“ eine dritte Zuordnung auf das
**Berühren** der Fläche: das schaltet `loopswitch`, also den Einfrier-Moment.

### Der Hall-Vergleich

`m20`–`m23` sind vier **Algorithmen auf identischen Werten** — alle neun
Parameter ausdrücklich gleich gesetzt. Das bricht bewusst mit der sonstigen
Regel „auf Werkswerten aufsetzen“: die vier haben je eigene Werksdefaults
(Länge 38/38/31/31, Dämpfung 92/78/106/61 …), und wer sie unangetastet
nebeneinander stellt, hört die Werkseinstellung statt des Algorithmus. Ein
Vergleich, der zwei Dinge zugleich ändert, ist keiner.

Die Variationen halten den Vergleich durch: `… Short` und `… Long` sind für
alle vier dieselben drei Längenstufen. Nacheinander in denselben Platz
geschrieben beantworten die zwölf Dateien die Frage, die kein Datenblatt
beantwortet — welcher der vier Hall-Algorithmen wofür taugt.

### Variationen

| Basis | a | b | Was sich unterscheidet |
|---|---|---|---|
| SR1 Bus | SR1 Bus Gentle | SR1 Bus Crush | Schwelle 60 / 30 / 10, Verhältnis 6 / 16 / 40 |
| Auto Wah | Wah Manual | Wah Auto Fast | ganz ohne Automatik bzw. schneller LFO |
| Chorus Wide | Chorus Subtle | Chorus Extreme | Anteil 45 / 90 / 127, Tiefe mit |
| Flanger Sweep | Flanger Slow | Flanger Metal | LFO-Rate 1 / 6 / 20 · Rückkopplung am Anschlag |
| Phaser Slow | Phaser Fast | Phaser Type0 | LFO-Rate 4 / 20 · anderer Typ |
| Tremolo Sync | Tremolo Soft | Tremolo Chop | Tiefe 55 / 110 / 127, Flanke mit |
| Pump Master | Pump Soft | Pump Hard | Tiefe 60 / 127, Sättigung 5 / 40 / 110 |
| Hall Big | Hall Big Short | Hall Big Long | Länge 20 / 60 / 115 |
| Smooth Hall | Smooth Short | Smooth Long | dieselben drei Stufen |
| Plate Wet | Plate Wet Short | Plate Wet Long | dieselben drei Stufen |
| Plate Dry | Plate Dry Short | Plate Dry Long | dieselben drei Stufen |
| Loop Freeze | Loop Short | Loop Pitch | kurze Schleife · höher gestimmt |

---

## Sieben Paare sind zugleich Sonden

Manche Paare beantworten nebenbei eine Frage, die in den Format-Unterlagen
offen ist — zwei Dateien, die sich in **einem** Byte unterscheiden, klären am
Ohr, was keine Tabelle hergibt:

| Sonde | Frage |
|---|---|
| `Kick EQ Boost` ↔ `Kick EQ Scoop` | Ist 36 wirklich neutral, und heißt höher lauter? |
| `EQ Tilt Dark` ↔ `EQ Tilt Bright` | dasselbe für den Master-EQ |
| `Two Band Smile` ↔ `Two Band Mid` | dasselbe für den 2-Band-EQ |
| `Acid Filter Alt` (1), `Punch Filt Alt2` (2), Basis (0) | Was macht `output_select` beim Filter? |
| `Cut Fader` (0), `Half` (64), `Full` (127) | Ist `fader` beim Mute ein Pegel oder eine Dämpfung? |
| `Grain Fine` ↔ `Grain Rough` | Was tut `off_duration`? |
| `Bit Tekk Rate` ↔ `Bit Tekk Bits` | Welche der beiden Achsen macht den Crush-Klang aus? |

Dazu die zwei Vergleiche, die keine Byte-Sonden sind, aber dieselbe Rolle
spielen: `10-acid-filter` ↔ `23-filter-drive` (macht die Kettenfolge einen
Unterschied?) und der Hall-Vergleich `m20`–`m23`.

### Die Antworten (am Gerät gehört, 2026-09-01)

| Sonde | Befund |
|---|---|
| EQ-Neutralwert | **36 ist neutral, höher = lauter** — bei allen drei EQs (4-Band-Insert, 2-Band-Insert, Master): Boost lauter/voller, Scoop hohl, Smile fett an den Rändern, die Master-Kippe dumpf bzw. spitz. |
| `output_select` (Filter) | Wirkt hörbar: 0/1/2 klingen klar verschieden. **Welcher Wert welcher Ausgang ist, ist noch unbenannt** — der Hörer konnte die Charaktere nicht zuordnen; ein Sweep-Mitschnitt steht aus. |
| `fader` (Mute) | **Weder Pegel noch Dämpfung**: alle drei Fassungen (0/64/127) sind still, auch der Regler bringt an keiner Stellung Ton — erst Part-IFX Off gibt das Signal frei. Mute macht schlicht zu; Verdacht Blendzeit, ungeklärt. Damit ist ein gespeichertes „Cut Fader“-Preset so nutzlos wie der Master-Mute — ob es aus dem Set fliegt, ist offen. |
| `off_duration` (Grain Shifter) | Wörtlich die Länge der **Aus-Phase** zwischen den Schnipseln: hoch = löchriger, mehr Stottern — nicht gröbere Schnipsel. |
| Decimator-Achsen | `bit_depth` runter = rauschig-kratziger. ⚠ Am unteren Anschlag wird das Signal zum **Vollpegel-Rechteck** — Dynamik weg, mit Level ist nichts mehr zu regeln. Die Rate-Seite ist noch nicht getrennt beschrieben. |
| Kettenfolge (`10` ↔ `23`) | **Ja, deutlich**: Filter→Zerre ist klar aggressiver als Zerre→Filter. |
| Hall-Vergleich (`m20`–`m23`) | Hall Reverb klingt am größten; **Wet und Dry Plate sind auf identischen Werten kaum auseinanderzuhalten**. |

Die Parameter-Befunde stehen auch als Kommentare in `e2FxParams.ts`.

---

## Laden und aufs Gerät schreiben

Im FX-Preset-Bereich, mit verbundenem Gerät:

1. **Datei laden** → eine `.e2fxp` oder `.mfx` wählen. Bei `.mfx` springt die
   Art selbst auf Master-Effekt; bei `.e2fxp` vorher auf **Insert-Effekt**
   stellen. (Oder **Sammlung laden** → eine der acht `.tfsam`, dann in der
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

⚠ **Das Gerätemenü zählt ab 1** — bei Insert- wie Master-Presets (am Gerät
gesehen, 2026-09-01; dieselbe Verschiebung wie beim Program Change). Das
Platz-Feld im Effekt-Preset-Panel zählt seitdem genauso: dort steht die
Nummer, die auch das Gerät zeigt. Nur RAM-nahe Angaben (Max-IFX-Index,
RAM-Panel-Slots) bleiben 0-basiert — „belegt bis Index 48“ heißt im Menü
also Platz 1–49.

**Zurück kommt man immer.** Die Presets liegen im RAM: **Undo** schreibt den
gelesenen Vorher-Stand zurück, und ein Aus-und-Wieder-Ein stellt ohnehin alles
her. ⚠ Das Gerät darf während des Schreibens **nicht spielen**.

**Zum Vergleichen** lohnt ein fester Ablauf: eine Sequenz laufen lassen, die
Fassungen nacheinander in **denselben** Platz schreiben und den Part nicht
umstellen. So ist der Unterschied wirklich das Preset und nicht der Kontext.
Auf getrennte Plätze geschrieben geht es schneller, aber dann wechselt beim
Umschalten mehr als nur die Werte.

**Eine ganze Sammlung verteilen.** Statt Datei für Datei: **Sammlung laden**
(`.tfsam`), in der Liste je Eintrag den Ziel-Platz eintragen (zählt wie das
Gerätemenü, ab 1; leer = wird übersprungen) und **„⚠ Alle auf das Gerät
schreiben“**. Je Eintrag läuft derselbe Weg wie beim Einzel-Schreiben — erst
lesen, dann schreiben mit Rückleseprobe; der erste Fehler stoppt die Reihe,
und doppelt vergebene Plätze derselben Art werden gar nicht erst angefangen.
**„↶ Alle zurückschreiben“** stellt die gelesenen Vorher-Stände wieder her,
letzter zuerst. Die Zuweisung wird mit **„Sammlung sichern…“** in der `.tfsam`
mitgespeichert (Feld `platz`, 1-basiert) und ist beim nächsten Laden wieder da.
Am Gerät abgenommen (2026-09-02): das Starter-Set in einem Lauf verteilt,
alle zwölf Presets unter ihren Namen im Gerätemenü.

Dieselben Dateien lassen sich auch in Synthstudio laden (E2s-Preset-Panel,
„.bin importieren“ — die Art wird an der Größe erkannt) und mit
`omnitribe/tools/hwtest/ifx_preset.py` gegen das Gerät vergleichen.

---

## Woher die Werte kommen — und woher nicht

Jedes Preset startet auf den **werkseitigen Defaults** seines Algorithmus,
bit-genau aus hacktribe-editor `utils/ht_fx_ram_format.py`. Nur benannte
Parameter weichen davon ab. Die eine bewusste Ausnahme ist der Hall-Vergleich
(siehe oben), und sie steht dort begründet.

Was das **nicht** ist: eine Vermessung. Semantische Bereiche und Einheiten der
Parameter sind in hacktribe nicht hinterlegt (dort als TODO markiert) — bekannt
ist nur 0..127. Die Abweichungen folgen dem Parameternamen und der Richtung,
die er nahelegt: `gain` hoch heißt mehr Zerre, `bit_depth` runter heißt mehr
Krümel, 36 ist bei allen EQ-Bändern der neutrale Werkswert. Wo die Bedeutung
einer Zahl unbekannt ist — `lfo_sync_note`, `mask_type`, `loop_type` — steht
der Werkswert. Geraten wird nicht.

Wo selbst die *Richtung* offen ist, entscheidet nicht das Skript, sondern die
Hand. Wie viel Hall über der Summe richtig ist, weiß hier niemand: `dry_wet`
von `m07-room-wide` bleibt deshalb auf dem Werkswert und liegt stattdessen auf
der X-Achse. Wer wischt, hört in einer Sekunde, was keine Vermutung leisten
kann. Dasselbe bei den beiden Delays und beim `fader` von `Cut Fader`.

Gehört hat das hier niemand. Genau dafür sind es Testdateien: was am Gerät
anders klingt als der Name verspricht, gehört gemeldet und korrigiert.

## Zwei Inserts

Ein zweiter Insert ist nur bei „leichten“ Algorithmen erlaubt (Thru, Cheap
Comp, Punch, EQ 2-Band, Filter, Acid Driver, Mute). Die beiden
Schwesterprojekte lesen die Regel verschieden — Synthstudio prüft sie gegen
IFX 2, TekkForges `ifx2Moeglich` gegen IFX 1. Solange das nicht am Gerät
entschieden ist, nehmen alle zweistufigen Presets **beide** Slots aus dieser
Liste; damit sind sie nach jeder der beiden Lesarten gültig. Das ist auch der
Grund, warum sich die beiden Insert-Sets vier Algorithmen teilen: die
Whitelist ist klein, und nur aus ihr lassen sich Ketten bauen.

## Neu erzeugen

```
npx tsx scripts/make-fx-presets.mjs [zielordner]
```

Die Definitionen stehen im Kopf des Skripts. `tests/fx-presets-beispiele.test.ts`
prüft jede erzeugte Datei: Größe, Name, bekannter Algorithmus aus dem richtigen
Nummernkreis, die jeweils andere Hälfte der Kette auf Thru, die
Zwei-Insert-Regel, und dass jede Zuordnung auf einen Parameter zeigt, den es
bei diesem Algorithmus **gibt** — ein Zeiger ins Leere bliebe sonst bis zum
Gerät unsichtbar und sähe dort wie ein Übertragungsfehler aus. Für Variationen
zusätzlich: gleicher Algorithmus wie die Basis und ein echter Unterschied zu
ihr. Für den Hall-Vergleich: vier Algorithmen, identische Werte.

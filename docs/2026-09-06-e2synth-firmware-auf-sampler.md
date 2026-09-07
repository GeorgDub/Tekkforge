# E2-Synth-Firmware auf dem E2 Sampler — Stand der Recherche (2026-09-06)

Frage: Die Hardware von electribe 2 (Synth, „E2“) und electribe 2 sampler
(„E2S“) ist identisch, nur die Firmware unterscheidet sich. Wie bekommt man
die Synth-Firmware auf einen Sampler — geht das über Hacktribe schon, oder
muss es per Reverse Engineering gebaut werden?

Quellen: Omnitribe-Repo (`docs/reverse/*`, `docs/firmware/*`, `agents/INDEX.js`,
`tools/reverse/vsb_parser.py`, `tools/sim/preflash_validator.py`),
Hacktribe (README, Wiki how-to / FAQ / Features, `scripts/e2-firmware-patch.py`,
`scripts/e2-header.py`), untergeek.de „Free-for-all filters and VPM“.
Aufgeteilt in **belegte Fakten**, **Schlüsse** und **Offenes**.

---

## 1. Belegte Fakten

### 1.1 Was Hacktribe ist — und was nicht

- Hacktribe ist die **Sampler-Firmware 2.02 mit Synth-Bausteinen**, nicht die
  Synth-Firmware auf dem Sampler. Basis: Werks-`SYSTEM.VSB` des Samplers
  (SHA-256 `1d0f0689…2468a646`), Patch `patch/hacktribe-2.patch` per bsdiff.
  Hacktribe-README: „based on sampler firmware version 2.02“; Wiki: „Apply
  patch to Electribe 2 Sampler firmware version 2.02 only. Once patched,
  firmware runs on either device.“
- Der Patch ist ein **gleich langer Overlay** (beide Dateien 2 097 408 Bytes):
  64 306 Bytes unterscheiden sich, davon 26 053 im ARM-Teil, **0 im
  BF523-DSP-Abbild**, 38 253 in vorher leeren `0xFF`-Zonen; der Dateikopf
  (0x000–0x100) ist unangetastet. Omnitribe:
  `docs/reverse/hacktribe_q_delta_v202.md`.
- Das heißt: Hacktribe fährt die **Oszillatoren des Synths über den
  unveränderten Sampler-DSP-Code** — es ändert Namen-/Parametertabellen,
  Zeiger und Grenzen im ARM-Teil (Omnitribe:
  `hacktribe_q_port_triage_v202.md`, Zeile 33: „copying strings ≠ porting
  the voices“).
- Bekannte Unterschiede Hacktribe ↔ echter Synth (dokumentiert):
  - **PCM-Wellenformen des Synths fehlen** — die liegen in `PCM.VSB`, nicht in
    `SYSTEM.VSB`; Hacktribe „cannot provide the BlueTribe's original factory
    sample set“ (untergeek). Auf einem Synth installiert „verliert“ Hacktribe
    dessen Synth-/PCM-Instrumente.
  - IFX 38 → 49, Grooves 24 → 61 (Omnitribe `docs/firmware/ht_port_grooves_ifx_v202.md`).
  - Filter: in Omnitribe als **DEFER** geführt — „no byte-pinned filter
    routine“ (`hacktribe_q_port_triage_v202.md`, Zeile 37).
  - Polyphonie je Variante: **nirgends** dokumentiert.
  - Sample-/OSC-Plätze verschieben sich nach dem Patch; Patterns müssen
    nachgezogen werden (`hacktribe_ram_and_formats.md`, Zeilen 174–175).

### 1.2 Der Dateikopf von `SYSTEM.VSB` — die einzige Sperre

Aus einer echten Datei im Omnitribe-Repo (`vendor/bf523_build/phase3_patched.vsb`):

```
000000  4b 4f 52 47 20 53 59 53 54 45 4d 20 46 49 4c 45  |KORG SYSTEM FILE|
000010  45 32 53 00 00 00 00 00 00 00 00 00 00 00 00 00  |E2S.............|
000020  53 59 53 54 45 4d 00 00 00 01 02 02 00 01 24 ff  |SYSTEM........$.|
000030  00 00 00 00 00 00 20 00 00 00 00 00 00 00 20 00  |...... ....... .|
000040  02 00 ff ff …  (0x42–0xFF: 0xFF)
```

| Offset | Inhalt | Bedeutung |
|---|---|---|
| `0x00` | `KORG SYSTEM FILE` | Magic |
| `0x10` | `E2S\0` (Sampler) / `E2\0\0` (Synth) | Variante |
| **`0x12`** | **`0x53` 'S' = Sampler, `0x00` = Synth** | Kennbyte 1 |
| `0x20` | `SYSTEM\0\0` | Dateityp |
| `0x2A–0x2B` | `02 02` | Version 2.02 |
| **`0x2E`** | **`0x24` '$' = Sampler, `0x23` '#' = Synth** | Kennbyte 2 |
| `0x34`, `0x3C` | `00 00 20 00` | Nutzlastgröße 2 MiB |
| `0x100` | 2 MiB Nutzlast (ARM-Programm, AM1808) | |

- **Nur zwei Bytes unterscheiden Synth- und Sampler-Datei** — `0x12` und
  `0x2E`. Hacktribes `e2-header.py FILE [synth|sampler]` ändert genau diese
  beiden, sonst nichts.
- **Es gibt keine Prüfsumme über die Nutzlast.** Omnitribe
  `bf523_phase3_findings.md` §1A: kein CRC32, keine Byte-/Wortsumme, kein
  XOR im Kopf; die einzige Integritätsprüfung auf Container-Ebene sind Magic
  und Kennbytes. (Nur die eingebetteten Blackfin-LDR-Blöcke tragen ADIs
  HDRCHK über ihre 16 Kopfbytes.)
- Der Update-Dialog des Geräts meldet **„Invalid File“ bei falscher
  Device-ID im Kopf** (Hacktribe-FAQ wörtlich; Omnitribe
  `hacktribe_ram_and_formats.md`, Zeile 144). Die Strings `SOFTWARE UPDATE`,
  `Invalid File`, ` Now Version : `, `Next Version : ` liegen in beiden
  Firmwares (`docs/reverse/strings_e2s.txt` / `strings_e2synth.txt`).
- SD-Pfade: Sampler `KORG/electribe sampler/System/SYSTEM.VSB`, Synth
  `KORG/electribe/System/SYSTEM.VSB`. Beide Firmwares enthalten **beide**
  Pfad-Strings.
- untergeek: „Early firmware versions allowed simple crossgrading, but Korg
  added verification checks in v2.02 to prevent this, requiring hex editing
  workarounds.“

### 1.3 Was die Hardware und die Nutzlast angeht

- Hardware identisch (untergeek: „absolutely identical – apart from the
  colour scheme and the built-in samples“). Drei Chips: TI AM1802 (ARM,
  führt `SYSTEM.VSB` aus), ADSP-BF523 (Audio), Cortex-M3 (Panel). Flash:
  exakt 2 097 408 Bytes für `SYSTEM.VSB`.
- Die Sample-/PCM-Inhalte liegen in **getrennten Dateien**: Sampler
  `/BOOT.VSB`, `/SYSTEM.VSB`, `/USER.VSB`, `/PCM.VSB`, **`/SLICE.VSB`**;
  Synth dieselben **ohne `SLICE.VSB`** (String-Tabellen beider Firmwares).
- Die Nutzlasten sind zu **61,2 % verschieden** (474 Regionen); die größte
  Fremdregion (579 424 Bytes ab Datei-Offset `0x000165A0`) hält Omnitribe
  für OSC-Tabellen bzw. PCM-Drum-Daten und markiert sie „NICHT portieren,
  da Hardware-spezifisch“ (`vsb_format.md`, Zeilen 57–77, 130).

### 1.4 Dokumentierte Umbau-Schritte (Hacktribe)

```
git clone --recursive https://github.com/bangcorrupt/hacktribe.git
pip install argparse bsdiff4
python scripts/e2-firmware-patch.py          # -e: Kopf auf Synth stellen
# oder von Hand:
sha256sum -c hash/SYSTEM.VSB.sha
bspatch SYSTEM.VSB hacked-SYSTEM.VSB patch/hacktribe-2.patch
python scripts/e2-header.py SYSTEM.VSB synth   # nur Kennbytes 0x12/0x2E
```

- `e2-firmware-patch.py -e` schreibt `[0x12]=0x00`, `[0x2E]=0x23` und prüft
  die Gesamtgröße `0x200100`.
- Weitere Skripte: `e2-init-pat.py` (Init-Pattern bei Body-Offset `0xCFF58`,
  `0x3C00` Bytes), `e2-backup-bootloader.py`, `e2pat_convert.py`
  (Pattern Synth ↔ Sampler: Bytes `0x10..0x1F` des `.e2spat`-Kopfs).
- Der Hacktribe-Patch selbst ist **nicht quelloffen**; Omnitribe enthält
  keinen seiner Bytes.
- Für die Richtung **Synth-Firmware → Sampler-Gerät** gibt es **keine
  veröffentlichten Byte-Patches** jenseits der zwei Kennbytes.

### 1.5 Omnitribe zum Thema

- Omnitribes Ziel ist genau das Gegenteil des Crossgrades: **Synth-Routinen
  einzeln in die Sampler-Basis portieren** (`docs/reverse/port_strategy.md`:
  `direct_patch` / `adapt_patch` / `freetribe` / `skip`;
  `tools/reverse/address_diff.py`).
- Die Donor-Adresskarten (`addressmap_e2synth_osc.csv`,
  `addressmap_e2synth_filter.csv`) sind **Pläne ohne Adressen** — alle
  `address`/`size_bytes`/`e2s_target_addr`-Spalten leer;
  `addressmap_e2s_v202.csv` hat keine Datenzeilen.
- Was wirklich fertig ist: Grooves 24 → 61 und IFX 38 → 49 als Byte-Patches
  auf die Stock-Basis (`ht_port_grooves_ifx_v202.md`, „OFFLINE-PROVEN, NOT
  YET FLASHED“) — Hacktribe-Funktionen zurück in Stock, keine Synth-Ports.

---

## 2. Schlüsse

1. **Die Sperre ist ein Zwei-Byte-Vergleich im Updater der laufenden
   Firmware, nicht im Bootloader.** Kein CRC; `e2-header.py` ändert nur zwei
   Bytes und das reicht in der Gegenrichtung; der „Invalid File“-String liegt
   in `SYSTEM.VSB` selbst; Hacktribe-FAQ: „no need to edit the file header if
   hacktribe or the sampler firmware is currently installed“ — die
   **installierte** Firmware bestimmt, welche Kennung erwartet wird.
2. **Der Weg, die Synth-Firmware auf den Sampler zu bekommen, ist damit
   bekannt:** Werks-`SYSTEM.VSB` des Synths (v2.02) nehmen,
   `python scripts/e2-header.py SYSTEM.VSB sampler` (setzt `[0x12]=0x53`,
   `[0x2E]=0x24`), nach `KORG/electribe sampler/System/SYSTEM.VSB` auf die
   SD, am Gerät DATA UTILITY → System Update. Das ist das exakte Spiegelbild
   des dokumentierten Synth-Weges. **Niemand dokumentiert, es in dieser
   Richtung getan zu haben.**
3. **Der wahrscheinliche Haken ist nicht der Kopf, sondern der PCM-Inhalt.**
   Die Synth-Wellenformen liegen in `PCM.VSB` (nicht Teil des Updates); ein
   Sampler hat Sampler-PCM plus `SLICE.VSB`. Die Synth-Firmware würde ihre
   Slot-Nummern in fremde PCM-Daten auflösen. Das ist genau das Spiegelbild
   des belegten Symptoms beim Synth mit Hacktribe („loses its synths and PCM
   instruments“). Erwartung: Gerät bootet und der Sequencer läuft, die
   Synth-Oszillatoren aber klingen falsch oder stumm, weil die
   Wellenformtabellen der Synth-PCM fehlen — bis jemand `PCM.VSB` des Synths
   mit überträgt (Größe, Update-Weg und Kopfprüfung dafür: unbekannt).
4. **Hacktribe existiert, weil der bloße Crossgrade nicht taugt.** untergeek
   beschreibt, dass bangcorrupt erst den Bootloader analysierte und dann den
   Sampler patchte — das wäre sinnlos, wenn zwei Kopfbytes am Synth-Abbild
   einen funktionierenden Synth auf Sampler-Hardware ergäben.
5. **Reverse-Engineering-Alternative (Omnitribe-Weg):** Synth-Oszillator- und
   Filter-Routinen einzeln in die Hacktribe/Sampler-Basis heben. Stand: die
   Adresskarten sind leer, der DSP-Teil ist bei Hacktribe unangetastet — das
   ist Arbeit von Monaten, nicht von einem Patch.

---

## 3. Offenes / Widersprüche

1. `bf523_phase3_findings.md` (Zeile 35) nennt für den Synth `0x12 = 0x52
   'R'`; `hacktribe_ram_and_formats.md` und `e2-header.py` sagen `0x00`;
   `strings_e2synth.txt` zeigt `KORG SYSTEM FILEE2` mit NUL bei `0x12`. **`0x00`
   ist richtig, `0x52` ein Erratum.**
2. `vsb_format.md` (Zeile 24) beschreibt `0x2F` ff. als 208 Byte Null-Padding;
   tatsächlich sind `0x20–0x41` strukturiert (Typ, Version, Größen) und
   `0x42–0xFF` sind `0xFF`.
3. Hacktribe-Wiki (how-to) sagt für die Installation am Synth
   `e2-header.py … sampler`, FAQ und Skript sagen `synth` — FAQ/Skript sind
   konsistent, die how-to-Zeile ist ein Tippfehler.
4. **Was der Updater genau vergleicht** (`0x12` allein, `0x2E` allein, beide,
   dazu `SYSTEM`-Tag, Versionsbytes, Downgrade-Sperre?), ist nirgends
   disassembliert; `addressmap_e2s_v202.csv` hat keine Zeile dazu.
5. Bedeutung von `0x2E` (Produktindex? Prüfsumme?) ist unbelegt; die Werte
   `0x23`/`0x24` sind fortlaufend, was für einen Index spricht.
6. Polyphonie je Variante: keine Zahl belegt.
7. **Kein dokumentierter Versuch, Stock-Synth-Firmware auf E2S-Hardware zu
   fahren.** Zur Vorsicht: Omnitribe BUG-003 beschreibt einen Flash, den das
   Gerät mit „OK“ quittierte, ohne dass der neue Code ankam; und die
   Wiederherstellung (BUG-005) ist nur über das Korg-Menü mit passender
   Werks-VSB auf der SD belegt — SHIFT+PLAY beim Einschalten bootet in der
   Praxis nur Stock. **Vor jedem Versuch die passende Werks-`SYSTEM.VSB` des
   Samplers auf der SD-Karte behalten.**

---

## 4. Empfehlung

| Ziel | Weg | Aufwand | Risiko |
|---|---|---|---|
| Synth-Firmware pur auf dem Sampler | Synth-`SYSTEM.VSB` v2.02, `e2-header.py … sampler`, Update am Gerät | Minuten | Kopf akzeptiert (belegt); Klang der Synth-Oszillatoren ohne Synth-`PCM.VSB` **unbelegt, vermutlich defekt**; Rückweg über Werks-VSB |
| Synth-Oszillatoren mit Sampler-Funktionen | Hacktribe (vorhanden) | fertig | bekannte Lücken: PCM-Wellenformen, Filter |
| Echter Synth-Klang auf der Sampler-Basis | Omnitribe-Portierung (Routinen einzeln) | Monate | Adresskarten noch leer |

Nächster belegbarer Schritt, wenn der Versuch gewagt wird: Synth-`SYSTEM.VSB`
mit Sampler-Kopf flashen, dann am Gerät prüfen (a) bootet es, (b) zeigt die
Sample-Liste die Synth-Namen (SAW, PULSE, …), (c) klingen sie. Dazu die
`PCM.VSB`-Frage klären: Größe und Kopf der Synth-`PCM.VSB`, ob das
Update-Menü sie annimmt, und ob die Sampler-`PCM.VSB` beim Rückflash wieder
hergestellt werden muss.


---

## Nachtrag (2026-09-07): Weg gefunden, Werkzeug gebaut

Die offene Frage aus §3.7 („kein dokumentierter Versuch") ist beantwortet.
Am v2.02-Abbild disassembliert (Omnitribe
`docs/reverse/e2synth_auf_e2s_crossgrade_v202.md`,
`tools/reverse/crossgrade_probe.py` + `find_update_check.py`):

- Die echte Ladebasis des ARM-Payloads ist `Datei-Offset + 0xBFFFFF00`
  (Datei 0x100 → DDR2 0xC0000000).
- Der SYSTEM.VSB-Validator des Samplers (`0xC0030860`) prüft: Magic (16 Byte),
  `family_check` und den „SYSTEM"-Tag. Der `family_check` (`0xC00367E8`) wird
  vom SYSTEM-Pfad **strikt** aufgerufen (Flag 0 → Zweig `0xC0036824`:
  `subs r3,#0x24`) und akzeptiert nur Device-ID low `0x24` (Sampler). Eine
  Synth-Datei (`0x23`) fällt als „Invalid File". Das ist die Geräte-Sperre.
- Setzt man Kopf-Byte `0x2E` auf `0x24` (Device-ID 0x0123→0x0124), nimmt der
  Sampler die Datei an. Byte `0x12` (E2/E2S-Suffix) wird vom SYSTEM-Validator
  nicht geprüft, wird aber mitgesetzt, damit die Datei einer echten
  Sampler-Datei gleicht.
- Der Payload-Diff zeigt: die Synth-Klangerzeugung (Oszillatoren, VPM, Filter)
  steckt in den Payload-Regionen 0x00–0x13 und reist beim Crossgrade mit.
  PCM bleibt die geräteeigene (Sampler-`PCM.VSB`).

**Werkzeug:** `tools/crossgrade/e2_crossgrade.py` in Omnitribe (Python-CLI) und
`src/core/crossgrade.ts` hier in TekkForge, in der Firmware-Werkbank unter
„🎛 Synth-Firmware für den Sampler vorbereiten (Crossgrade)". Beide ändern nur
die zwei Kopf-Bytes, prüfen streng und legen die fertige `SYSTEM.VSB` ab; der
Rückweg (Sampler→Synth) geht spiegelbildlich.

Status: **am Abbild bewiesen, am Gerät noch nicht abgenommen.** Vor jedem Flash
die Werks-`SYSTEM.VSB` als Rückweg auf der SD behalten.

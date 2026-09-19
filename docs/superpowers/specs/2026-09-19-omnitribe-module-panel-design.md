# Omnitribe-Modul-Panel (TekkForge) — Design-Spec

Datum: 2026-09-19
Status: Entwurf zur Review

## Ziel
Ein eigener, voll-konfigurierbarer Tab in der TekkForge-Electron-App, um Omnitribe-Module
(Chord/Arp u.a.) auf der KORG Electribe 2 per SysEx zur Laufzeit zu **laden, entladen,
konfigurieren und stummzuschalten** — ohne CLI-Skripte. Löst den Workflow-Schmerz, dass eine
Firmware mit fest aktiven Modulen (U4-Autoconfig) das normale Spielen/Sequencing stört: Module
kommen nur auf Zuruf, jederzeit abschaltbar.

## Kontext / Vorhandenes (nicht neu bauen)
- `src/core/otp.ts` (1317 Z.) spricht das OTP-Protokoll bereits: 7-of-8, `buildFrame`,
  Modul-Loader `buildModuleUpload`/`buildModuleChunk`/`buildModuleCommit`/`buildModuleUnplace`,
  NRPN via `buildModuleCallback`, Event-Routing/Periodik `buildIrqInstall`/`buildIrqConfig`/
  `buildIrqStatus`, ACK-Parser `parseModuleAck` (SUB 0x05/0x03), Telemetrie-Parser.
- `src/gui/otpPanel.ts` = bestehendes eingebettetes OTP-Panel (Loader-Stufe 1) im Editor-Tab.
- `src/gui/midi.ts`: `MidiIO`, `requestSysex(io, frame, match, timeoutMs)` und `waitSysex(...)`
  (Request/Response mit Timeout) existieren.
- Tab-Muster: Rail-Knopf in `index.html`, leere `<section id="viewX">`, Eintrag in `TABS` +
  `Tab`-Union in `src/gui/main.ts`, `initX()`-Aufruf beim Boot; `panelBridge.midi` teilt die
  MidiIO-Instanz.
- **Referenzwahrheit** für Modul-IDs/NRPN/Periodik: die erprobten `scripts/*.mjs`
  (`multi-module.mjs`, `chord-solo.mjs`, `prov-probe.mjs`, `peek.mjs`). Deren Logik wird
  gehoben, nicht dupliziert.

## Architektur
Neuer Tab **"Omnitribe"**. Neues Renderer-Modul `src/gui/omniPanel.ts` baut sein DOM in
`viewOmni` und bekommt (wie otpPanel) einen Hooks-Block `{ sysexSenden, sysexAnfrage, warten }`
= dünne Wrapper um `midi.sendAsync` / `requestSysex` / `waitSysex`, plus einen `moduleBytes(id)`-
Hook (siehe Modul-Bytes). Alle Frames kommen aus `core/otp.ts`.

## Modul-Register (Daten in `core/otp.ts`)
Ein `OMNI_MODULES`-Array: `{ id, name, msb, tested, params: ParamDef[] }`.
`ParamDef = { pid, label, kind: "enum"|"range"|"toggle"|"part", min?, max?, options?, perPart? }`.

- **Chord (id 9, msb 0x1e), tested:true**
  - 0x00 Typ (enum), 0x01 Stagger (range), 0x02 Root-Override (range; >127 = gespielte Note),
    0x03 Enabled je Part (toggle, perPart).
- **Arp (id 1, msb 0x16), tested:true**
  - 0x00 Modus (enum), 0x01 Rate (enum 1/4..1/16T), 0x02 Oktaven (range 1..4),
    0x03 Gate% (range), 0x04 Latch (toggle, perPart), 0x05 Ziel-Part (part, perPart),
    0x06 Enabled je Part (toggle, perPart), 0x07 Mute-Input (toggle, perPart),
    0x08+ Velocity-Pattern (range[]).
- **Weitere bekannte Module (tested:false, Badge „noch nicht getestet"):** aus
  `OTP_MODULE_REAL_HEADERS` — spectral_morph (19), sd_stream (20), audio_input_routing (21),
  audio_test (30). Anzeigbar/ladbar, aber sichtbar als ungetestet markiert; Param-Defs minimal
  (nur was belegt ist), bis wir sie ausbauen.

## Modul-Bytes: gebündelt
Die kompilierten `.bin` werden **in TekkForge gebündelt** (Verzeichnis `assets/omni-modules/`,
z.B. `chord.bin`, `arpeggiator.bin`, ...). Der Renderer kann keine Dateien lesen → ein
Main-Prozess-fs-Handler (bzw. Vite-`?url`/Base64-Import beim Build) liefert die Bytes.
Empfehlung: **Base64-Bundle** `src/core/omniModuleBins.ts` (aus den `.bin` generiert), damit
die single-file-Vite-App autark bleibt. Ein kleines Build-Skript `scripts/bundle-omni-modules.mjs`
erzeugt diese Datei aus `G:\IdeaProjects\Omnitribe\build\modules_abs\*.bin`; bei Modul-Änderungen
neu ausführen. Fehlt ein Modul im Bundle → Zeile zeigt „kein Build".

## UI-Layout (`viewOmni`)
- Kopf: **[Preset laden]** (Chord P1 + Arp P3→4, das validierte Setup) · **[Alles aus]** ·
  Periodik-/Verbindungsstatus.
- Modul-Liste: je Modul eine Karte — Name (+ „ungetestet"-Badge), id, Platziert-LED,
  **[Laden]/[Entladen]**, **Part-Wahl** (Eingangs-Part), **Enable-Toggle**.
- Parameter (aufklappbar je platziertem Modul): Widgets aus den ParamDefs, live per NRPN;
  perPart-Parameter mit Part-Auswahl.
- Status-Leiste: Poller (~1 s) zeigt egress / Ring-Treffer (inj_hits) / placed_mask / held_n via
  Peek + Telemetrie; abschaltbar (kein Dauer-Traffic, wenn nicht gebraucht).

## Datenfluss
- **Laden:** `buildModuleUpload(id, bytes)` (Chunks) → `waitSysex` je Chunk-ACK →
  `buildModuleCommit(id)` → ACK 0x0c/0x00. Danach ggf. `buildIrqInstall/Config` (Periodik),
  wenn ein taktgetriebenes Modul (Arp) geladen ist.
- **Konfig:** `buildModuleCallback(id, cbIndex=1=on_nrpn, [msb, lsb=(part<<4)|pid, valLo, valHi])`.
- **Enable/Mute:** dieselbe NRPN (Chord pid 0x03 / Arp pid 0x06) — sofortiges Stummschalten
  ohne Entladen.
- **Aus (global):** `buildModuleUnplace("alle")`.
- **Status:** neuer `buildPeek(addr,len)` (0x52) + `parsePeek`; Telemetrie via vorhandenem
  `buildTelemetryRequest`/`parseTelemetryReport` bzw. CMD 0x04 SUB 0x0A.

## Neu/zu ergänzen in `core/otp.ts`
1. `OMNI_MODULES`-Register + Param-Maps (s.o.).
2. `buildPeek(addr,len)` + `parsePeek(raw)` (aus `scripts/peek.mjs` gehoben; 7-of-8, ≤64 B).
3. **Verifizieren**, dass `buildModuleCallback` und `buildIrqInstall/Config` byte-genau das
   erzeugen, was `multi-module.mjs`/`chord-solo.mjs` senden (Chord id 9, Arp id 1, cb-Index 1,
   Periodik IRQ 21 mit Payloads `[21,0,0,0,21,1]` / Config `[0,0,0,21,1]`). Bei Abweichung
   otp.ts angleichen (Skripte sind die geräteverifizierte Wahrheit).

## An/Aus — zwei Ebenen (bewusst)
- **Enable-Toggle je Modul/Part** (NRPN, sofort, bleibt geladen): schnelles Mute, u.a. gegen
  „Arp arpt Sequencer-Noten".
- **[Alles aus]** = unplace all (voller Stopp; erneutes Laden ~0,5 s).

## Fehlerbehandlung
- Kein Gerät/Port: Panel zeigt „nicht verbunden", Buttons deaktiviert.
- Chunk/Commit-ACK != ok: Fehlerstatus je Modulzeile (Status-Code aus `OTP_MODULE_STATUS`).
- Peek/Telemetrie-Timeout: Status-Leiste zeigt „—", kein Absturz.
- Fehlendes Modul-Bundle: Zeile „kein Build", Laden deaktiviert.

## Tests
- `tests/omni-otp.test.ts` (neu): `buildPeek`/`parsePeek` Round-Trip; Param-Frame-Bytes für
  Chord/Arp gegen fixe Erwartungswerte (die exakt den Skript-Bytes entsprechen).
- `tests/omni-panel.test.ts` (neu, analog `otp-panel.test.ts`): `initOmni` baut DOM, Buttons
  rufen die richtigen Builder, Zustand exponiert.
- Gerätetest manuell (Preset laden, Enable-Toggle, Entladen, Status-Poller).

## Nicht in v1 (YAGNI)
- Hardware-Geste (2-Pad-Kombo) zum An/Aus — separat, später.
- Firmware-seitiger Bypass-Flag — v1 nutzt Enable-NRPN + unplace.
- Persistenz/Presets über das eine „Preset laden" hinaus.

## Offen/Risiken
- Byte-Gleichheit otp.ts ↔ Skripte muss verifiziert werden (s. Punkt 3).
- Bundle-Aktualität: `.bin` müssen bei Modul-Änderungen neu gebündelt werden (Build-Skript +
  Hinweis in der README/CLAUDE.md).

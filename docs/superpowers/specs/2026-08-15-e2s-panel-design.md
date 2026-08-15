# E2S-Panel — Hardware-Lookalike-Oberfläche (Stufe 1)

Stand 2026-08-15, vom Nutzer freigegeben („bau"). Vorlage: Foto der roten
electribe sampler (`omnitribe-hwtest-kit/korg.png`).

## Ziel

Dritter Tab „E2S Panel" in der TekkForge-Electron-App, der aussieht wie das
echte Gerät (Beschriftungen identisch: Sample/Filter/Modulation/Amp EG/
Insert Fx, Pitch/Glide, LPF/HPF/BPF, MFX Send, Amp EG, IFX On, Part Mute,
Trigger, Sequencer, …) und zwei Modi hat:

- **Live**: „Sync" holt bei gestopptem Sequencer den kompletten Edit-Buffer
  (0x10-Dump → `editorPatternFromBody` liefert Steps, Mutes und alle 20
  gerätebestätigten Part-Parameter). Danach führt die UI: Pad-Klick im
  Part-Mute-Modus schaltet Mute per Hacktribe-NRPN (`buildPanelControl`,
  experimentell — am Gerät zu verifizieren) und aktualisiert die LED.
- **Prepare**: arbeitet auf dem aktuellen Editor-Pattern (gleiche
  Projektdaten wie der Editor-Tab). Steps können im Sequencer-Pad-Modus
  gesetzt werden. Übertragen: „Anhören" = Edit-Buffer-Dump (0x40, klingt
  sofort, überschreibt nichts), „Auf Slot schreiben" = bestehender
  `writePatternToSlot` (0x40 + 0x11 mit ACK-Prüfung).

## Aufbau

- `src/core/panelState.ts` — reine Logik (getestet): LED-Zustände je Part
  (Mute, Amp EG, MFX Send, IFX On, Filterband aus `filterType`),
  Step-Zustände je Takt, Display-Infos. Filterband nach gemessener
  Struktur: 0 = off, 1–6 = LPF, 7–11 = HPF, 12–16 = BPF.
- `src/gui/panel.ts` — DOM-Aufbau des Panels + Verkabelung. Pads haben zwei
  Modi (wie am Gerät): **Part Mute** = Pads sind die 16 Parts mit
  Mute-LEDs, **Sequencer** = Pads sind die 16 Steps des aktiven Parts im
  gewählten Takt (Buttons 1–4 = Taktwahl). Klick auf Step nur im
  Prepare-Modus wirksam. Reglerwerte des aktiven Parts werden ANGEZEIGT
  (Stufe 2 macht sie drehbar).
- `editor.ts` exportiert eine `panelBridge` (MIDI-Instanz, midiOpts,
  Projekt/Pattern-Zugriff, writePatternToSlot) — der KORG-Port ist
  Single-Client, es darf nur EINE MidiIO existieren.
- `index.html`: Tab-Knopf + `<section id="viewPanel">` + Panel-CSS;
  `src/gui/main.ts`: `switchTab("panel")`.

## Grenzen (gemessen, nicht verhandelbar)

- Kein Rückkanal: Reglerdrehen am Gerät sieht die UI erst beim nächsten
  Sync. Empfangs-Versuch (sendet die E2S CC/NRPN?) ist ein separater
  gemeinsamer Test am Gerät — falls ja, folgt ein Empfangs-Dekoder.
- Sync nur bei gestopptem Sequencer (laufend = still beschädigte Dumps).
- NRPN-Panel-Befehle sind am Gerät noch unbestätigt — Stufe-1-Abnahme
  enthält genau diesen Test.

## Stufe 2 (nicht Teil dieser Umsetzung)

Regler drehbar (IFX/FX live per NRPN, Rest per automatischem
Edit-Buffer-Resend), Live-Step-Toggle, Empfangs-Dekoder je nach Testergebnis.

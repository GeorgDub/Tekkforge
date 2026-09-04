/**
 * main.ts — TekkForge GUI-Einstieg: Icon-Leiste, Tab-Umschaltung, Statuszeile
 * und Init aller Module.
 * Läuft identisch im Browser (Single-File-HTML) und in der Electron-Shell.
 */

import { $ } from "./shared";
import { initTheme } from "./theme";
import { initStart, startWirdSichtbar } from "./start";
import { initSettings, settingsWirdSichtbar } from "./settings";
import { initEditor, loadProject, panelBridge, editorWirdSichtbar, appendPatterns, istProjektLeer } from "./editor";
import { initConverter } from "./converter";
import { initPanel, panelWirdSichtbar } from "./panel";
import { initPadDeck, padDeckWirdSichtbar } from "./paddeck";
import { initGenerator, generatorWirdSichtbar } from "./generator";
import { initMidiImport, midiImportWirdSichtbar, midiImportLadeLied } from "./midiImport";
import { initSampleManager, sampleManagerWirdSichtbar } from "./sampleManager";
import { initPatternBibliothek, bibliothekWirdSichtbar } from "./patternBibliothek";
import { initStemWerkbank, stemWerkbankWirdSichtbar, ladeAlsSpuren, stemWerkbankVerlassen } from "./stemWerkbank";
import type { EditorProject } from "../core/editorModel";
import { ramBytesFuer } from "../core/sampleRam";

type Tab = "start" | "editor" | "converter" | "panel" | "paddeck" | "generator" | "midi" | "bank" | "bib" | "stems" | "settings";

const TABS: Record<Tab, { view: string; knopf: string; titel: string; sichtbar?: () => void }> = {
  start: { view: "viewStart", knopf: "tabStart", titel: "Start", sichtbar: startWirdSichtbar },
  editor: { view: "viewEditor", knopf: "tabEditor", titel: "Pattern-Editor", sichtbar: editorWirdSichtbar },
  converter: { view: "viewConverter", knopf: "tabConverter", titel: "ESX-Converter" },
  // Panel und Pad-Deck zeigen Editor-Daten — beim Umschalten frisch rendern.
  panel: { view: "viewPanel", knopf: "tabPanel", titel: "E2S Panel", sichtbar: panelWirdSichtbar },
  paddeck: { view: "viewPadDeck", knopf: "tabPadDeck", titel: "Pad-Deck", sichtbar: padDeckWirdSichtbar },
  generator: { view: "viewGenerator", knopf: "tabGenerator", titel: "Generator", sichtbar: generatorWirdSichtbar },
  midi: { view: "viewMidi", knopf: "tabMidi", titel: "MIDI zu Korg", sichtbar: midiImportWirdSichtbar },
  bank: { view: "viewBank", knopf: "tabBank", titel: "Sample-Manager", sichtbar: sampleManagerWirdSichtbar },
  bib: { view: "viewBib", knopf: "tabBib", titel: "Pattern-Bibliothek", sichtbar: bibliothekWirdSichtbar },
  stems: { view: "viewStems", knopf: "tabStems", titel: "Stem-Werkbank", sichtbar: stemWerkbankWirdSichtbar },
  settings: { view: "viewSettings", knopf: "tabSettings", titel: "Einstellungen", sichtbar: settingsWirdSichtbar },
};

let aktiverTab: Tab = "start";

function switchTab(tab: Tab): void {
  // Die Werkbank spielt weiter, wenn man sie nur verlaesst — Ton aus einem
  // Tab, den man nicht mehr sieht, ist ein Geist, den niemand sucht.
  if (aktiverTab === "stems" && tab !== "stems") stemWerkbankVerlassen();
  aktiverTab = tab;
  for (const [name, t] of Object.entries(TABS) as [Tab, (typeof TABS)[Tab]][]) {
    $(t.view).classList.toggle("hidden", name !== tab);
    $(t.knopf).classList.toggle("active", name === tab);
  }
  $("statusModul").textContent = TABS[tab].titel;
  statusAktualisieren();
  TABS[tab].sichtbar?.();
}

/** Welcher Tab ist offen? (Pad-Deck-Tastatur soll nur dort greifen.) */
export function aktuellerTab(): Tab {
  return aktiverTab;
}

/** Sample-RAM-Belegung des Pools in MB (16-Bit-Mono bei 44,1 kHz, wie im Gerät). */
function poolRamMb(): number {
  let bytes = 0;
  for (const s of panelBridge.project.samples) bytes += ramBytesFuer(s);
  return bytes / (1024 * 1024);
}

function statusAktualisieren(): void {
  const bereit = panelBridge.midi.ready;
  $("statusMidi").textContent = bereit ? "MIDI verbunden" : "MIDI aus";
  $("statusDot").classList.toggle("an", bereit);
}

initTheme();

for (const [name, t] of Object.entries(TABS) as [Tab, (typeof TABS)[Tab]][]) {
  $(t.knopf).addEventListener("click", () => switchTab(name));
}

initEditor();
initSampleManager();
initPatternBibliothek();
initStemWerkbank();
initPanel();
initPadDeck(() => aktiverTab === "paddeck");
// Converter-Handoff: konvertiertes ESX-Ergebnis in den Editor laden + Tab wechseln.
initConverter((project: EditorProject) => {
  if (loadProject(project)) {
    switchTab("editor");
    alert(
      `In den Editor geladen: ${project.patterns.length} Pattern(s), ${project.samples.length} Sample(s).`,
    );
  }
});
// Generator-Handoff: erzeugte Patterns + Bank in den Editor laden + Tab wechseln.
initGenerator(
  (project: EditorProject) => {
    if (loadProject(project)) {
      switchTab("editor");
      alert(`Generator → Editor: ${project.patterns.length} Pattern(s), ${project.samples.length} Sample(s).`);
    }
  },
  // Zweiter Weg aus dem Generator: dasselbe Lied von Hand zerlegen, statt es
  // dort noch einmal auszuwaehlen.
  (dateien: File[]) => {
    switchTab("stems");
    void ladeAlsSpuren(dateien);
  },
  // Dritter Weg: die transkribierte Melodie als MIDI in den Wizard „MIDI zu Korg“.
  (lied, name, wechseln) => {
    midiImportLadeLied(lied, name, `${lied.spuren[0]?.noten.length ?? 0} Noten aus dem Generator (Drop-Fenster, 16tel-Raster) — im Piano Roll pruefen, Parts zuordnen, in den Editor.`);
    if (wechseln) switchTab("midi");
  },
);
// MIDI-Import-Handoff: gebaute Patterns in den Editor laden + Tab wechseln.
// Ein leerer Editor wird ersetzt; ein Editor mit Inhalt bekommt die Patterns
// ANGEHAENGT (Nutzerbefund 2026-09-04: ein zweiter MIDI-Import in dieselbe
// Sitzung war vorher nicht moeglich, weil jede Uebergabe alles ersetzte).
initMidiImport((project: EditorProject) => {
  if (istProjektLeer()) {
    if (!loadProject(project)) return;
    switchTab("editor");
    alert(`MIDI → Editor: ${project.patterns.length} Pattern(s) — jetzt Samples zuordnen.`);
    return;
  }
  const n = appendPatterns(project);
  switchTab("editor");
  alert(`MIDI → Editor: ${n} Pattern(s) hinten angehängt — die vorhandenen bleiben. Mit ⧉ / ⇩ lassen sich Parts zwischen Patterns kopieren.`);
});
initStart({
  oeffne: (tab) => switchTab(tab as Tab),
  daten: () => ({
    patterns: panelBridge.project.patterns.length,
    samples: panelBridge.project.samples.length,
    ramMb: poolRamMb(),
    midiBereit: panelBridge.midi.ready,
    firmware: panelBridge.firmware === "hacktribe" ? "Hacktribe" : "Stock (KORG)",
  }),
});
initSettings();
statusAktualisieren();
setInterval(statusAktualisieren, 5000);
switchTab("start");

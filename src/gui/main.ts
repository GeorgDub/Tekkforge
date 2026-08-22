/**
 * main.ts — TekkForge GUI-Einstieg: Tab-Umschaltung + Init aller Module.
 * Läuft identisch im Browser (Single-File-HTML) und in der Electron-Shell.
 */

import { $ } from "./shared";
import { initEditor, loadProject } from "./editor";
import { initConverter } from "./converter";
import { initPanel, panelWirdSichtbar } from "./panel";
import { initPadDeck, padDeckWirdSichtbar } from "./paddeck";
import type { EditorProject } from "../core/editorModel";

type Tab = "editor" | "converter" | "panel" | "paddeck";

const TABS: Record<Tab, { view: string; knopf: string; sichtbar?: () => void }> = {
  editor: { view: "viewEditor", knopf: "tabEditor" },
  converter: { view: "viewConverter", knopf: "tabConverter" },
  // Panel und Pad-Deck zeigen Editor-Daten — beim Umschalten frisch rendern.
  panel: { view: "viewPanel", knopf: "tabPanel", sichtbar: panelWirdSichtbar },
  paddeck: { view: "viewPadDeck", knopf: "tabPadDeck", sichtbar: padDeckWirdSichtbar },
};

let aktiverTab: Tab = "editor";

function switchTab(tab: Tab): void {
  aktiverTab = tab;
  for (const [name, t] of Object.entries(TABS) as [Tab, (typeof TABS)[Tab]][]) {
    $(t.view).classList.toggle("hidden", name !== tab);
    $(t.knopf).classList.toggle("active", name === tab);
  }
  TABS[tab].sichtbar?.();
}

/** Welcher Tab ist offen? (Pad-Deck-Tastatur soll nur dort greifen.) */
export function aktuellerTab(): Tab {
  return aktiverTab;
}

for (const [name, t] of Object.entries(TABS) as [Tab, (typeof TABS)[Tab]][]) {
  $(t.knopf).addEventListener("click", () => switchTab(name));
}

initEditor();
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

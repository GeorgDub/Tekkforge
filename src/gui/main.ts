/**
 * main.ts — TekkForge GUI-Einstieg: Tab-Umschaltung + Init beider Module.
 * Läuft identisch im Browser (Single-File-HTML) und in der Electron-Shell.
 */

import { $ } from "./shared";
import { initEditor, loadProject } from "./editor";
import { initConverter } from "./converter";
import type { EditorProject } from "../core/editorModel";

function switchTab(tab: "editor" | "converter"): void {
  $("viewEditor").classList.toggle("hidden", tab !== "editor");
  $("viewConverter").classList.toggle("hidden", tab !== "converter");
  $("tabEditor").classList.toggle("active", tab === "editor");
  $("tabConverter").classList.toggle("active", tab === "converter");
}

$("tabEditor").addEventListener("click", () => switchTab("editor"));
$("tabConverter").addEventListener("click", () => switchTab("converter"));

initEditor();
// Converter-Handoff: konvertiertes ESX-Ergebnis in den Editor laden + Tab wechseln.
initConverter((project: EditorProject) => {
  if (loadProject(project)) {
    switchTab("editor");
    alert(
      `In den Editor geladen: ${project.patterns.length} Pattern(s), ${project.samples.length} Sample(s).`,
    );
  }
});

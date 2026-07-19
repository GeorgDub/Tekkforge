/**
 * main.ts — TekkForge GUI-Einstieg: Tab-Umschaltung + Init beider Module.
 * Läuft identisch im Browser (Single-File-HTML) und in der Electron-Shell.
 */

import { $ } from "./shared";
import { initEditor } from "./editor";
import { initConverter } from "./converter";

function switchTab(tab: "editor" | "converter"): void {
  $("viewEditor").classList.toggle("hidden", tab !== "editor");
  $("viewConverter").classList.toggle("hidden", tab !== "converter");
  $("tabEditor").classList.toggle("active", tab === "editor");
  $("tabConverter").classList.toggle("active", tab === "converter");
}

$("tabEditor").addEventListener("click", () => switchTab("editor"));
$("tabConverter").addEventListener("click", () => switchTab("converter"));

initEditor();
initConverter();

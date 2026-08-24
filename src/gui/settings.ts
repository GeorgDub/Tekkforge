/**
 * settings.ts — Tab „Einstellungen": Theme-Studio (Presets + Akzentfarbe)
 * und App-Infos. Der Backup-Manager kommt mit Paket 2 dazu.
 */

import { $ } from "./shared";
import { THEMES } from "../core/themes";
import { aktuelleWahl, themeSetzen } from "./theme";
import { version } from "../../package.json";

function render(): void {
  const wahl = aktuelleWahl();
  const host = $("viewSettings");
  host.innerHTML = `
    <div class="card">
      <h2>Design &amp; Theme</h2>
      <p class="sub" style="margin-top:0">Nur Farben wechseln — Aufbau und Bedienung bleiben gleich.</p>
      <div class="themeKacheln">
        ${THEMES.map(
          (t) => `
          <button class="themeKachel ${t.name === wahl.name ? "sel" : ""}" data-theme="${t.name}" title="${t.titel}">
            <span class="themeVorschau" style="background:${t.palette.bg}">
              <span style="background:${t.palette.panel};border:1px solid ${t.palette.border}">
                <i style="background:${t.palette.accent}"></i><i style="background:${t.palette.accent2}"></i>
              </span>
            </span>
            <span class="themeTitel">${t.titel}</span>
          </button>`,
        ).join("")}
      </div>
      <div class="zeileEinst">
        <label for="setAkzent">Eigene Akzentfarbe</label>
        <input id="setAkzent" type="color" value="${wahl.akzent ?? THEMES.find((t) => t.name === wahl.name)?.palette.accent ?? "#ff6a00"}" />
        <button id="setAkzentReset" class="ghost">Preset-Akzent</button>
      </div>
    </div>
    <div class="card" id="setBackupKarte">
      <h2>Backups</h2>
      <p class="sub" style="margin:0">Auto-Backup beim Überschreiben von Banks — kommt im nächsten Schritt (Paket 2).</p>
    </div>
    <div class="card">
      <h2>Über TekkForge</h2>
      <p class="sub" style="margin:0">
        TekkForge v${version} · Electribe-2-Sampler-Werkzeug — alles lokal, keine Datei verlässt den Rechner.<br />
        Step-Layout verifiziert gegen KORG-Factory-Files + hardwaregetestete Patterns.
      </p>
    </div>`;
  for (const b of host.querySelectorAll<HTMLButtonElement>("[data-theme]")) {
    b.addEventListener("click", () => {
      themeSetzen(b.dataset.theme!, aktuelleWahl().akzent);
      render();
    });
  }
  $("setAkzent").addEventListener("change", () => {
    themeSetzen(aktuelleWahl().name, ($("setAkzent") as HTMLInputElement).value);
    render();
  });
  $("setAkzentReset").addEventListener("click", () => {
    themeSetzen(aktuelleWahl().name);
    render();
  });
}

export function initSettings(): void {
  render();
}

export function settingsWirdSichtbar(): void {
  render();
}

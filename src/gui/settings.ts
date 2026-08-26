/**
 * settings.ts — Tab „Einstellungen": Theme-Studio (Presets + Akzentfarbe)
 * und App-Infos. Der Backup-Manager kommt mit Paket 2 dazu.
 */

import { $ } from "./shared";
import { THEMES } from "../core/themes";
import { aktuelleWahl, themeSetzen } from "./theme";
import { tekkFs } from "./tekkFs";
import { vergleicheVersionen } from "../core/updateCheck";
import { version } from "../../package.json";

interface TekkUpdate {
  available: boolean;
  pruefen(): Promise<{ tag: string | null; url: string; datei?: { name: string; url: string; groesse: number } | null }>;
  oeffnen(url: string): Promise<void>;
  laden?(url: string, name: string): Promise<{ pfad: string; bytes: number }>;
  onFortschritt?(cb: (d: { geladen: number; gesamt: number }) => void): () => void;
}

function tekkUpdate(): TekkUpdate | undefined {
  const w = globalThis as unknown as { tekkUpdate?: TekkUpdate };
  return w.tekkUpdate?.available ? w.tekkUpdate : undefined;
}

let updateMeldung = "";
let updateUrl = "";
let updateDatei: { name: string; url: string; groesse: number } | null = null;
let updateLaeuft = false;

/** Installer holen — der Nutzer startet ihn selbst, wir legen ihn nur bereit. */
async function updateHerunterladen(): Promise<void> {
  const up = tekkUpdate();
  if (!up?.laden || !updateDatei || updateLaeuft) return;
  updateLaeuft = true;
  const abmelden = up.onFortschritt?.((d) => {
    const mb = (n: number) => (n / 1024 / 1024).toFixed(0);
    updateMeldung = d.gesamt
      ? `Lade ${updateDatei!.name} … ${mb(d.geladen)} von ${mb(d.gesamt)} MB`
      : `Lade ${updateDatei!.name} … ${mb(d.geladen)} MB`;
    const el = document.getElementById("setUpdateInfo");
    if (el) el.textContent = updateMeldung;
  });
  render();
  try {
    const r = await up.laden(updateDatei.url, updateDatei.name);
    updateMeldung = `Geladen nach ${r.pfad} — der Ordner ist offen. Zum Aktualisieren die Datei selbst starten und TekkForge vorher schließen.`;
  } catch (e) {
    updateMeldung = "Download fehlgeschlagen: " + (e instanceof Error ? e.message : String(e));
  } finally {
    abmelden?.();
    updateLaeuft = false;
  }
  render();
}

async function updatePruefen(): Promise<void> {
  const up = tekkUpdate();
  if (!up) return;
  updateMeldung = "Frage GitHub …";
  updateUrl = "";
  render();
  try {
    const res = await up.pruefen();
    if (!res.tag) {
      updateMeldung = "Noch kein Release veroeffentlicht — du laeufst auf dem Arbeitsstand.";
    } else {
      const lage = vergleicheVersionen(version, res.tag);
      updateMeldung =
        lage === "neuer"
          ? `Version ${res.tag} ist verfuegbar (installiert: v${version}).`
          : `v${version} ist aktuell (letztes Release: ${res.tag}).`;
      if (lage === "neuer") {
        updateUrl = res.url;
        updateDatei = res.datei ?? null;
        if (updateDatei) {
          updateMeldung += ` Installer: ${updateDatei.name} (${Math.round(updateDatei.groesse / 1024 / 1024)} MB).`;
        }
      }
    }
  } catch (e) {
    updateMeldung = "Update-Check fehlgeschlagen: " + (e instanceof Error ? e.message : String(e));
  }
  render();
}

interface BackupZeile {
  name: string;
  original: string;
  wann: number;
  bytes: number;
}

let backupOrdner = "";
let backupListe: BackupZeile[] | null = null;
let backupMeldung = "";

function backupOrdnerVorschlag(): string {
  try {
    return localStorage.getItem("tekkforge.letzterOrdner") ?? "";
  } catch {
    return "";
  }
}

async function backupsLaden(): Promise<void> {
  const fsb = tekkFs();
  if (!fsb?.backups || !backupOrdner) return;
  try {
    backupListe = await fsb.backups(backupOrdner);
    backupMeldung = backupListe.length ? "" : "Keine Backups in diesem Ordner.";
  } catch (e) {
    backupListe = null;
    backupMeldung = "Backups nicht lesbar: " + (e instanceof Error ? e.message : String(e));
  }
  render();
}

async function backupZurueck(name: string): Promise<void> {
  const fsb = tekkFs();
  if (!fsb?.backupZurueck || !backupOrdner) return;
  if (!confirm(`"${name}" wiederherstellen? Der aktuelle Stand wird vorher gesichert.`)) return;
  try {
    const res = await fsb.backupZurueck(backupOrdner, name);
    backupMeldung = `${res.original} wiederhergestellt.`;
  } catch (e) {
    backupMeldung = "Wiederherstellen fehlgeschlagen: " + (e instanceof Error ? e.message : String(e));
  }
  await backupsLaden();
}

function render(): void {
  const wahl = aktuelleWahl();
  if (!backupOrdner) backupOrdner = backupOrdnerVorschlag();
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
      ${
        tekkFs()?.backups
          ? `
      <p class="sub" style="margin-top:0">
        Beim Überschreiben einer Datei über „Projekt speichern" oder „auf SD kopieren"
        landet der alte Stand automatisch in <code>backups/</code> (20 werden behalten).
      </p>
      <div class="zeileEinst">
        <label for="setBackupOrdner">Ordner</label>
        <input id="setBackupOrdner" type="text" value="${escapeAttr(backupOrdner)}" placeholder="z. B. G:\\Samples\\TekkForge" style="flex:1;min-width:220px" />
        <button id="setBackupLaden" class="ghost">Backups anzeigen</button>
        <button id="setBackupOeffnen" class="ghost">Ordner öffnen</button>
      </div>
      ${backupMeldung ? `<div class="sub">${escapeAttr(backupMeldung)}</div>` : ""}
      ${
        backupListe?.length
          ? `<div class="startListe" style="margin-top:6px">${backupListe
              .map(
                (b) =>
                  `<div><span class="rolle">${escapeAttr(b.original)}</span><span style="flex:1">${escapeAttr(b.name)}</span><span class="startWann">${new Date(b.wann).toLocaleString("de-DE")} · ${(b.bytes / 1024 / 1024).toFixed(1)} MB</span><button class="ghost" data-backup="${escapeAttr(b.name)}" style="padding:2px 8px;font-size:11px">↶ zurück</button></div>`,
              )
              .join("")}</div>`
          : ""
      }`
          : `<p class="sub" style="margin:0">Auto-Backup läuft nur in der Desktop-App (Dateisystem-Brücke fehlt hier).</p>`
      }
    </div>
    <div class="card">
      <h2>Über TekkForge</h2>
      <p class="sub" style="margin:0 0 8px">
        TekkForge v${version} · Electribe-2-Sampler-Werkzeug — alles lokal, keine Datei verlässt den Rechner.<br />
        Step-Layout verifiziert gegen KORG-Factory-Files + hardwaregetestete Patterns.
      </p>
      ${
        tekkUpdate()
          ? `<div class="zeileEinst">
              <button id="setUpdate" class="ghost" ${updateLaeuft ? "disabled" : ""}>Nach Updates suchen</button>
              ${updateDatei && tekkUpdate()?.laden ? `<button id="setUpdateLaden" class="primary" ${updateLaeuft ? "disabled" : ""}>⇩ Installer laden</button>` : ""}
              ${updateUrl ? `<button id="setUpdateAuf" class="ghost">Release öffnen</button>` : ""}
              ${updateMeldung ? `<span class="sub" id="setUpdateInfo" style="margin:0">${escapeAttr(updateMeldung)}</span>` : ""}
            </div>`
          : ""
      }
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
  document.getElementById("setBackupOrdner")?.addEventListener("change", () => {
    backupOrdner = ($("setBackupOrdner") as HTMLInputElement).value.trim();
    backupListe = null;
  });
  document.getElementById("setBackupLaden")?.addEventListener("click", () => void backupsLaden());
  document.getElementById("setBackupOeffnen")?.addEventListener("click", () => {
    if (backupOrdner) void tekkFs()?.ordnerOeffnen?.(backupOrdner);
  });
  for (const b of host.querySelectorAll<HTMLButtonElement>("[data-backup]")) {
    b.addEventListener("click", () => void backupZurueck(b.dataset.backup!));
  }
  document.getElementById("setUpdate")?.addEventListener("click", () => void updatePruefen());
  document.getElementById("setUpdateLaden")?.addEventListener("click", () => void updateHerunterladen());
  document.getElementById("setUpdateAuf")?.addEventListener("click", () => {
    if (updateUrl) void tekkUpdate()?.oeffnen(updateUrl);
  });
}

function escapeAttr(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function initSettings(): void {
  render();
}

export function settingsWirdSichtbar(): void {
  render();
}

/**
 * preload.cjs — sichere Bridge für native MIDI (Main-Prozess ↔ Renderer).
 *
 * Web MIDI hängt in Electron/Chromium auf Windows (MIDI-Dienst blockiert), daher
 * läuft die MIDI-I/O nativ im Main-Prozess (@julusian/midi) und wird hier per
 * contextBridge/IPC exponiert. Sandbox bleibt an — nur diese schmale API ist
 * im Renderer sichtbar.
 */

const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("tekkMidi", {
  available: true,
  /** → { outputs:[{id,name}], inputs:[{id,name}] } */
  list: () => ipcRenderer.invoke("midi:list"),
  /** Öffnet den Ausgang mit Port-Index id. */
  selectOut: (id) => ipcRenderer.invoke("midi:selectOut", id),
  /** Öffnet den Eingang mit Port-Index id (SysEx aktiviert). */
  selectIn: (id) => ipcRenderer.invoke("midi:selectIn", id),
  /** Zweiter Eingang (Controller, z. B. MIDImix); null schließt ihn. Nachrichten kommen mit quelle "controller". */
  selectIn2: (id) => ipcRenderer.invoke("midi:selectIn2", id),
  /** Sendet rohe Bytes (kompletter SysEx-Frame). */
  send: (bytes) => ipcRenderer.invoke("midi:send", bytes),
  /** MIDI-Clock (0xF8, 24 ppqn) im Worker: { action: "start"|"stop"|"bpm", bpm? }. */
  clock: (opts) => ipcRenderer.invoke("midi:clock", opts),
  /** Registriert einen Empfangs-Callback; gibt eine Unsubscribe-Funktion zurück. */
  onMessage: (cb) => {
    const handler = (_e, bytes, quelle) => cb(bytes, quelle || "geraet");
    ipcRenderer.on("midi:message", handler);
    return () => ipcRenderer.removeListener("midi:message", handler);
  },
});

// ── KI-Bruecke fuer den Generator-Tab (Key in userData, Rezept-Aufruf im Main-Prozess) ──
contextBridge.exposeInMainWorld("tekkKi", {
  available: true,
  /** { gesetzt, modell } */
  keyStatus: () => ipcRenderer.invoke("ki:keyStatus"),
  /** Key speichern (leer = loeschen), optional Modell-ID. */
  keySetzen: (key, modell) => ipcRenderer.invoke("ki:keySetzen", key, modell),
  /** { system, user, schema } → { text, modell, tokens }; wirft bei Fehlern mit deutscher Meldung. */
  rezept: (anfrage) => ipcRenderer.invoke("ki:rezept", anfrage),
});

// ── Dateibruecke fuer den Generator-Tab (Projekt auf Platte, SD-Karte, tekk4-Drums) ──
contextBridge.exposeInMainWorld("tekkFs", {
  available: true,
  /** Absoluter Pfad einer per Dialog/Drop gewaehlten Datei ("" wenn unbekannt). */
  pfadVon: (file) => {
    try {
      return webUtils.getPathForFile(file) || "";
    } catch {
      return "";
    }
  },
  /** Dateien in einen Ordner schreiben (Ordner wird angelegt); { ordner, geschrieben[] }. */
  schreibe: (ordner, dateien) =>
    ipcRenderer.invoke("fs:schreibe", ordner, dateien.map((d) => ({ name: d.name, bytes: Array.from(d.bytes) }))),
  /** Wechselmedien (SD-Karten): [{ pfad: "H:", label }]. */
  wechselmedien: () => ipcRenderer.invoke("fs:wechselmedien"),
  /** examples/e2s/tekk4.all aus dem App-Verzeichnis als Byte-Array, sonst null. */
  tekkDrums: () => ipcRenderer.invoke("fs:tekkDrums"),
});

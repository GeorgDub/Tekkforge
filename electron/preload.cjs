/**
 * preload.cjs — sichere Bridge für native MIDI (Main-Prozess ↔ Renderer).
 *
 * Web MIDI hängt in Electron/Chromium auf Windows (MIDI-Dienst blockiert), daher
 * läuft die MIDI-I/O nativ im Main-Prozess (@julusian/midi) und wird hier per
 * contextBridge/IPC exponiert. Sandbox bleibt an — nur diese schmale API ist
 * im Renderer sichtbar.
 */

const { contextBridge, ipcRenderer } = require("electron");

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

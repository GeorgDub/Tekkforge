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
  /** Modell-ID speichern (Key bleibt). */
  modellSetzen: (modell) => ipcRenderer.invoke("ki:modellSetzen", modell),
  /** { system, user, schema, maxTokens?, timeoutMs? } → { text, modell, tokens }; wirft bei Fehlern mit deutscher Meldung. */
  rezept: (anfrage) => ipcRenderer.invoke("ki:rezept", anfrage),
  /** { system, messages, maxTokens?, timeoutMs? } → { text, modell, tokens } — Hilfe-Chat, freier Text. */
  chat: (anfrage) => ipcRenderer.invoke("ki:chat", anfrage),
});

// ── Lied-Bruecke fuer den Generator-Tab (Python/Demucs-Probe, Stems) ──
contextBridge.exposeInMainWorld("tekkLied", {
  available: true,
  /** { python, demucs, version, meldung } */
  pythonStatus: () => ipcRenderer.invoke("lied:pythonStatus"),
  /** { fenster: [{ id, bytes }] } (WAV-Bytes) → { fenster: [{ id, melo, vox|null, voxDb }] } (WAV-Bytes) */
  stems: (anfrage) => ipcRenderer.invoke("lied:stems", anfrage),
  /** Fortschrittszeilen von stems.py (stderr); gibt eine Unsubscribe-Funktion zurueck. */
  onFortschritt: (cb) => {
    const handler = (_e, text) => cb(text);
    ipcRenderer.on("lied:fortschritt", handler);
    return () => ipcRenderer.removeListener("lied:fortschritt", handler);
  },
});

// ── URL-Bruecke (Generator-Tab): YouTube/SoundCloud -> WAV ueber yt-dlp + ffmpeg ──
contextBridge.exposeInMainWorld("tekkUrl", {
  available: true,
  /** { ok, version?, meldung } */
  probe: () => ipcRenderer.invoke("url:probe"),
  /** https-URL (YouTube/SoundCloud) -> { name, bytes } (44,1-kHz-WAV). */
  laden: (url) => ipcRenderer.invoke("url:laden", url),
  onFortschritt: (cb) => {
    const handler = (_e, text) => cb(text);
    ipcRenderer.on("url:fortschritt", handler);
    return () => ipcRenderer.removeListener("url:fortschritt", handler);
  },
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
  /** Auto-Backups eines Ordners: [{ name, original, wann, bytes }] (neueste zuerst). */
  backups: (ordner) => ipcRenderer.invoke("fs:backups", ordner),
  /** Backup zuruecklegen (aktueller Stand wird vorher gesichert): { original }. */
  backupZurueck: (ordner, name) => ipcRenderer.invoke("fs:backupZurueck", ordner, name),
  /** Ordner im Explorer oeffnen. */
  ordnerOeffnen: (ordner) => ipcRenderer.invoke("fs:ordnerOeffnen", ordner),
  /** examples/e2s/tekk4.all aus dem App-Verzeichnis als Byte-Array, sonst null. */
  tekkDrums: () => ipcRenderer.invoke("fs:tekkDrums"),
});

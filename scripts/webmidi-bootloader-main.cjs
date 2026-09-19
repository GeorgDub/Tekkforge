// Minimale Electron-App: laedt webmidi-bootloader.html, erlaubt MIDI-SysEx,
// uebergibt bootloader.bin und startet den execute_freetribe-Ablauf ueber WebMIDI
// (WinRT-MIDI statt WinMM). Log in Datei; beendet nach DONE/FEHLER.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const LOG = "G:/IdeaProjects/TekkForge/.webmidilog.txt";
fs.writeFileSync(LOG, "");
const binPath = process.argv.find((a) => a.endsWith(".bin")) ||
  "G:/Downloads/TekkForge/Firmware/bootloader-flashinstall-2026-09-17/bootloader.bin";

app.commandLine.appendSwitch("enable-features", "MidiManagerWinrt");

app.whenReady().then(async () => {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(perm === "midi" || perm === "midiSysex"));
  ses.setPermissionCheckHandler((_wc, perm) => perm === "midi" || perm === "midiSysex");

  const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true } });
  let done = false;
  win.webContents.on("console-message", (_e, _lvl, msg) => {
    fs.appendFileSync(LOG, msg + "\n");
    if (!done && (msg.startsWith("DONE") || msg.startsWith("FEHLER"))) { done = true; setTimeout(() => app.quit(), 300); }
  });
  await win.loadFile(path.join(__dirname, "webmidi-bootloader.html"));
  const bin = Array.from(fs.readFileSync(binPath));
  await win.webContents.executeJavaScript(`window.startBootloader(${JSON.stringify(bin)})`);
  setTimeout(() => { if (!done) { fs.appendFileSync(LOG, "TIMEOUT (120s)\n"); app.quit(); } }, 120000);
});
app.on("window-all-closed", () => app.quit());

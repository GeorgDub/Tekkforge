/**
 * TekkForge Electron-Shell — minimal und gehärtet:
 * lädt die selbsttragende dist/index.html über ein eigenes, als SICHER
 * registriertes `app://`-Protokoll. Das ist nötig, weil Web MIDI (SysEx) einen
 * secure context verlangt — unter `file://` bleibt requestMIDIAccess() sonst
 * hängen. contextIsolation + sandbox, kein Node-Zugriff im Renderer.
 */

const { app, BrowserWindow, shell, session, protocol, ipcMain } = require("electron");
const fs = require("fs");
const path = require("path");

const APP_SCHEME = "app";
const INDEX_HTML = path.join(__dirname, "..", "dist", "index.html");

// ─── Native MIDI (Main-Prozess) ──────────────────────────────────────────────
// Web MIDI hängt in Electron auf Windows → native @julusian/midi via IPC.
let midiLib = null;
try {
  midiLib = require("@julusian/midi");
} catch (err) {
  console.error("MIDI-Lib nicht ladbar:", err.message);
}
let midiOut = null;
let midiIn = null;

function registerMidiIpc() {
  ipcMain.handle("midi:list", () => {
    if (!midiLib) return { outputs: [], inputs: [] };
    const o = new midiLib.Output();
    const i = new midiLib.Input();
    const outputs = [];
    const inputs = [];
    for (let k = 0; k < o.getPortCount(); k++) outputs.push({ id: String(k), name: o.getPortName(k) });
    for (let k = 0; k < i.getPortCount(); k++) inputs.push({ id: String(k), name: i.getPortName(k) });
    o.closePort();
    i.closePort();
    return { outputs, inputs };
  });

  ipcMain.handle("midi:selectOut", (_e, id) => {
    if (!midiLib) throw new Error("MIDI nicht verfügbar");
    if (midiOut) midiOut.closePort();
    midiOut = new midiLib.Output();
    midiOut.openPort(Number(id));
    return true;
  });

  ipcMain.handle("midi:selectIn", (event, id) => {
    if (!midiLib) throw new Error("MIDI nicht verfügbar");
    if (midiIn) midiIn.closePort();
    midiIn = new midiLib.Input();
    midiIn.ignoreTypes(false, false, false); // SysEx NICHT ignorieren
    midiIn.on("message", (_dt, msg) => {
      const wc = event.sender;
      if (wc && !wc.isDestroyed()) wc.send("midi:message", Array.from(msg));
    });
    midiIn.openPort(Number(id));
    return true;
  });

  ipcMain.handle("midi:send", (_e, bytes) => {
    if (!midiOut) throw new Error("Kein MIDI-Ausgang geöffnet");
    midiOut.sendMessage(Array.isArray(bytes) ? bytes : Array.from(bytes));
    return true;
  });
}

// Muss VOR app-ready registriert werden: eigenes Schema als sicher + standard.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

/** Web-MIDI (inkl. SysEx) für den Pattern-Transfer zum Electribe 2 erlauben. */
function grantMidiPermissions() {
  const ses = session.defaultSession;
  const allowed = new Set(["midi", "midiSysex"]);
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(allowed.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));
}

/** Bedient app://… — die App ist eine einzige selbsttragende HTML-Datei. */
function registerAppProtocol() {
  protocol.handle(APP_SCHEME, () => {
    try {
      const html = fs.readFileSync(INDEX_HTML);
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    } catch (err) {
      return new Response(`TekkForge: dist/index.html fehlt (${err.message}).`, {
        status: 500,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }
  });
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 640,
    backgroundColor: "#101014",
    autoHideMenuBar: true,
    title: "TekkForge",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });

  // Externe Links im System-Browser öffnen, nie im App-Fenster
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("https://")) shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(`${APP_SCHEME}://local/index.html`);
}

app.whenReady().then(() => {
  grantMidiPermissions();
  registerAppProtocol();
  registerMidiIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

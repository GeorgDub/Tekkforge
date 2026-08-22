/**
 * TekkForge Electron-Shell — minimal und gehärtet:
 * lädt die selbsttragende dist/index.html über ein eigenes, als SICHER
 * registriertes `app://`-Protokoll. Das ist nötig, weil Web MIDI (SysEx) einen
 * secure context verlangt — unter `file://` bleibt requestMIDIAccess() sonst
 * hängen. contextIsolation + sandbox, kein Node-Zugriff im Renderer.
 */

const { app, BrowserWindow, shell, session, protocol, ipcMain } = require("electron");
const { Worker } = require("worker_threads");
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const APP_SCHEME = "app";
const INDEX_HTML = path.join(__dirname, "..", "dist", "index.html");

// ─── Native MIDI über Worker-Thread ──────────────────────────────────────────
// Web MIDI hängt in Electron/Windows → native @julusian/midi. openPort() ist
// synchron und kann blockieren (belegter Port) → daher im Worker mit Timeout,
// damit die UI NIE einfriert. Bei Timeout wird der Worker neu gestartet.
let midiWorker = null;
let midiWin = null;
let midiReqId = 0;
const midiPending = new Map();

function startMidiWorker() {
  let w;
  try {
    w = new Worker(path.join(__dirname, "midi-worker.cjs"));
  } catch (err) {
    console.error("MIDI-Worker konnte nicht starten:", err.message);
    midiWorker = null;
    return;
  }
  midiWorker = w;
  w.on("message", (m) => {
    if (m.type === "midi") {
      if (midiWin && !midiWin.isDestroyed()) midiWin.webContents.send("midi:message", m.data, m.quelle || "geraet");
      return;
    }
    if (m.type === "fatal") {
      console.error("MIDI-Worker fatal:", m.error);
      return;
    }
    const p = midiPending.get(m.id);
    if (p) {
      midiPending.delete(m.id);
      m.ok ? p.resolve(m.result) : p.reject(new Error(m.error || "MIDI-Fehler"));
    }
  });
  w.on("error", (err) => console.error("MIDI-Worker error:", err));
  w.on("exit", () => {
    // Nur reagieren, wenn dies noch der AKTUELLE Worker ist. Ein bereits durch
    // restart() ersetzter alter Worker wird ignoriert (sonst würden die
    // Requests/der Zustand des neuen Workers fälschlich abgeräumt).
    if (midiWorker !== w) return;
    midiWorker = null;
    for (const [, p] of midiPending) p.reject(new Error("MIDI-Worker beendet"));
    midiPending.clear();
  });
}

function restartMidiWorker() {
  if (midiWorker) {
    midiWorker.terminate().catch(() => {});
    midiWorker = null;
  }
  for (const [, p] of midiPending) p.reject(new Error("MIDI zurückgesetzt"));
  midiPending.clear();
  startMidiWorker();
}

function midiCall(cmd, payload, timeoutMs) {
  return new Promise((resolve, reject) => {
    if (!midiWorker) {
      reject(new Error("MIDI nicht verfügbar"));
      return;
    }
    const id = ++midiReqId;
    const timer = setTimeout(() => {
      if (midiPending.delete(id)) {
        // Hänger (z.B. belegter Port) → Worker neu starten, UI bleibt frei.
        restartMidiWorker();
        reject(new Error(`MIDI-Timeout (${cmd}) — Port belegt oder Gerät antwortet nicht.`));
      }
    }, timeoutMs);
    midiPending.set(id, {
      resolve: (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    });
    midiWorker.postMessage({ id, cmd, ...payload });
  });
}

// ── Dateibruecke (Generator-Tab): schreibt nur in absolute, vom Nutzer gewaehlte Ordner ──
function registerFsIpc() {
  ipcMain.handle("fs:schreibe", (_e, ordner, dateien) => {
    if (typeof ordner !== "string" || !path.isAbsolute(ordner)) throw new Error("Ordner muss ein absoluter Pfad sein");
    fs.mkdirSync(ordner, { recursive: true });
    const geschrieben = [];
    for (const d of dateien) {
      const name = path.basename(String(d.name));
      const ziel = path.join(ordner, name);
      const bytes = Buffer.from(d.bytes);
      fs.writeFileSync(ziel, bytes);
      if (fs.statSync(ziel).size !== bytes.length) throw new Error(`${name}: Laenge nach dem Schreiben falsch`);
      geschrieben.push(ziel);
    }
    return { ordner, geschrieben };
  });
  ipcMain.handle("fs:wechselmedien", () => {
    const out = [];
    if (process.platform === "win32") {
      try {
        const txt = execFileSync("wmic", ["logicaldisk", "where", "drivetype=2", "get", "deviceid,volumename"], { encoding: "utf8", timeout: 5000 });
        for (const zeile of txt.split(/\r?\n/).slice(1)) {
          const m = zeile.trim().match(/^([A-Z]:)\s*(.*)$/);
          if (m) out.push({ pfad: m[1], label: m[2].trim() || "Wechselmedium" });
        }
      } catch {
        /* Fallback unten */
      }
      if (!out.length) {
        for (const b of "DEFGHIJKLMNOPQRSTUVWXYZ") {
          try {
            if (fs.existsSync(path.join(`${b}:\\`, "KORG"))) out.push({ pfad: `${b}:`, label: "KORG-Karte" });
          } catch {
            /* weiter */
          }
        }
      }
    }
    return out;
  });
  ipcMain.handle("fs:tekkDrums", () => {
    const kandidaten = [path.join(app.getAppPath(), "examples", "e2s", "tekk4.all")];
    if (process.resourcesPath) kandidaten.push(path.join(process.resourcesPath, "examples", "e2s", "tekk4.all"));
    for (const p of kandidaten) {
      try {
        if (fs.existsSync(p)) return Array.from(fs.readFileSync(p));
      } catch {
        /* naechster */
      }
    }
    return null;
  });
}

function registerMidiIpc(win) {
  midiWin = win;
  startMidiWorker();
  ipcMain.handle("midi:list", () => midiCall("list", {}, 3000));
  ipcMain.handle("midi:selectOut", (_e, id) => midiCall("openOut", { port: id }, 2500));
  ipcMain.handle("midi:selectIn", (_e, id) => midiCall("openIn", { port: id }, 2500));
  // Zweiter Eingang fuer einen Controller (Pad-Deck); null/"" schliesst ihn.
  ipcMain.handle("midi:selectIn2", (_e, id) => midiCall("openIn2", { port: id ?? null }, 2500));
  ipcMain.handle("midi:send", (_e, bytes) =>
    midiCall("send", { bytes: Array.isArray(bytes) ? bytes : Array.from(bytes) }, 2500),
  );
  // MIDI-Clock-Generator im Worker: { action: "start"|"stop"|"bpm", bpm? }
  ipcMain.handle("midi:clock", (_e, opts) =>
    midiCall("clock", { action: String(opts?.action ?? "stop"), bpm: Number(opts?.bpm) || undefined }, 2500),
  );
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
  return win;
}

app.whenReady().then(() => {
  grantMidiPermissions();
  registerAppProtocol();
  const win = createWindow();
  registerMidiIpc(win);
  registerFsIpc();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      midiWin = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

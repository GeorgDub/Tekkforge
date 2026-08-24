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
const { backupDateiname, backupInfo, zuLoeschen } = require("./backup.cjs");
const BACKUP_MAX = 20;
const BACKUP_ORDNER = "backups";

/** Vor dem Ueberschreiben: Bestand nach <ordner>/backups/ kopieren und rotieren. */
function backupVorSchreiben(ordner, name) {
  const ziel = path.join(ordner, name);
  if (!fs.existsSync(ziel)) return;
  const ablage = path.join(ordner, BACKUP_ORDNER);
  fs.mkdirSync(ablage, { recursive: true });
  fs.copyFileSync(ziel, path.join(ablage, backupDateiname(name, new Date())));
  for (const weg of zuLoeschen(fs.readdirSync(ablage), name, BACKUP_MAX)) {
    try {
      fs.unlinkSync(path.join(ablage, weg));
    } catch {
      /* Rotation darf das Schreiben nicht verhindern */
    }
  }
}

function registerFsIpc() {
  ipcMain.handle("fs:schreibe", (_e, ordner, dateien) => {
    if (typeof ordner !== "string" || !path.isAbsolute(ordner)) throw new Error("Ordner muss ein absoluter Pfad sein");
    fs.mkdirSync(ordner, { recursive: true });
    const geschrieben = [];
    try {
      for (const d of dateien) {
        const name = path.basename(String(d.name));
        const ziel = path.join(ordner, name);
        const bytes = Buffer.from(d.bytes);
        try {
          backupVorSchreiben(ordner, name);
        } catch (err) {
          console.error("Auto-Backup fehlgeschlagen:", err.message);
        }
        fs.writeFileSync(ziel, bytes);
        if (fs.statSync(ziel).size !== bytes.length) throw new Error(`${name}: Laenge nach dem Schreiben falsch`);
        geschrieben.push(ziel);
      }
    } catch (err) {
      if (err && (err.code === "EROFS" || err.code === "EPERM" || err.code === "EACCES")) {
        throw new Error(`${ordner} ist schreibgeschuetzt — bei einer SD-Karte den LOCK-Schieber pruefen und die Karte neu einstecken`);
      }
      throw err;
    }
    return { ordner, geschrieben };
  });
  ipcMain.handle("fs:wechselmedien", () => {
    const out = [];
    if (process.platform === "win32") {
      // Win32_LogicalDisk DriveType 2 = Wechselmedium (wmic gibt es auf neuen Windows-Builds nicht mehr)
      try {
        const txt = execFileSync(
          "powershell",
          ["-NoProfile", "-Command", "Get-CimInstance Win32_LogicalDisk | Where-Object DriveType -eq 2 | ForEach-Object { $_.DeviceID + '|' + $_.VolumeName }"],
          { encoding: "utf8", timeout: 8000, windowsHide: true },
        );
        for (const zeile of txt.split(/\r?\n/)) {
          const m = zeile.trim().match(/^([A-Z]:)\|(.*)$/);
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
  // Backups eines Ordners auflisten: [{ name, original, wann (ms), bytes }]
  ipcMain.handle("fs:backups", (_e, ordner) => {
    if (typeof ordner !== "string" || !path.isAbsolute(ordner)) throw new Error("Ordner muss ein absoluter Pfad sein");
    const ablage = path.join(ordner, BACKUP_ORDNER);
    if (!fs.existsSync(ablage)) return [];
    const out = [];
    for (const name of fs.readdirSync(ablage)) {
      const info = backupInfo(name);
      if (!info) continue;
      let groesse = 0;
      try {
        groesse = fs.statSync(path.join(ablage, name)).size;
      } catch {
        continue;
      }
      out.push({ name, original: info.original, wann: info.wann.getTime(), bytes: groesse });
    }
    return out.sort((a, b) => b.wann - a.wann);
  });
  // Backup zuruecklegen: aktueller Stand wird vorher selbst gesichert.
  ipcMain.handle("fs:backupZurueck", (_e, ordner, backupName) => {
    if (typeof ordner !== "string" || !path.isAbsolute(ordner)) throw new Error("Ordner muss ein absoluter Pfad sein");
    const name = path.basename(String(backupName));
    const info = backupInfo(name);
    if (!info) throw new Error(`Kein Backup-Dateiname: ${name}`);
    const quelle = path.join(ordner, BACKUP_ORDNER, name);
    if (!fs.existsSync(quelle)) throw new Error(`Backup fehlt: ${name}`);
    backupVorSchreiben(ordner, info.original);
    fs.copyFileSync(quelle, path.join(ordner, info.original));
    return { original: info.original };
  });
  ipcMain.handle("fs:ordnerOeffnen", (_e, ordner) => {
    if (typeof ordner !== "string" || !path.isAbsolute(ordner)) throw new Error("Ordner muss ein absoluter Pfad sein");
    return shell.openPath(ordner);
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

// ── KI-Bruecke (Generator-Tab): API-Key in userData/settings.json, Rezept-Aufruf ueber das offizielle SDK ──
function settingsPfad() {
  return path.join(app.getPath("userData"), "settings.json");
}
function leseSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsPfad(), "utf8"));
  } catch {
    return {};
  }
}
function schreibeSettings(s) {
  fs.mkdirSync(path.dirname(settingsPfad()), { recursive: true });
  fs.writeFileSync(settingsPfad(), JSON.stringify(s, null, 1));
}
const KI_MODELL_STANDARD = "claude-opus-5";

/** Anfang/Ende/Laenge, damit ein Fehl-Paste auffaellt, ohne den Key zu zeigen. */
function keyVorschau(k) {
  return k ? `${k.slice(0, 10)}…${k.slice(-4)} · ${k.length} Zeichen` : "";
}
function keyStatusAus(s) {
  const k = typeof s.anthropicApiKey === "string" ? s.anthropicApiKey : "";
  return { gesetzt: k.length > 10, modell: s.kiModell || KI_MODELL_STANDARD, vorschau: keyVorschau(k) };
}

function registerKiIpc() {
  ipcMain.handle("ki:keyStatus", () => keyStatusAus(leseSettings()));
  ipcMain.handle("ki:keySetzen", (_e, key, modell) => {
    const s = leseSettings();
    const k = String(key || "").trim();
    if (k) {
      if (!/^sk-ant-[\x21-\x7e]{20,}$/.test(k)) {
        throw new Error(`Das sieht nicht wie ein Anthropic-Key aus (erwartet "sk-ant-…", nur ASCII, bekommen ${k.length} Zeichen) — Zwischenablage pruefen`);
      }
      s.anthropicApiKey = k;
    } else {
      delete s.anthropicApiKey;
    }
    if (typeof modell === "string" && modell.trim()) s.kiModell = modell.trim();
    schreibeSettings(s);
    return keyStatusAus(s);
  });
  ipcMain.handle("ki:modellSetzen", (_e, modell) => {
    const s = leseSettings();
    const m = String(modell || "").trim();
    if (!/^[a-z0-9][a-z0-9.-]{3,60}$/i.test(m)) throw new Error(`Keine gueltige Modell-ID: "${m}"`);
    s.kiModell = m;
    schreibeSettings(s);
    return keyStatusAus(s);
  });
  // anfrage: { system, user, schema, maxTokens?, timeoutMs? }
  ipcMain.handle("ki:rezept", async (_e, anfrage) => {
    const s = leseSettings();
    if (!s.anthropicApiKey) throw new Error("Kein API-Key gesetzt");
    const Anthropic = require("@anthropic-ai/sdk").default ?? require("@anthropic-ai/sdk");
    const timeoutMs = Number(anfrage.timeoutMs) > 0 ? Number(anfrage.timeoutMs) : 25_000;
    const client = new Anthropic({ apiKey: s.anthropicApiKey, timeout: timeoutMs, maxRetries: 1 });
    const modell = s.kiModell || KI_MODELL_STANDARD;
    try {
      const antwort = await client.beta.messages.create({
        model: modell,
        max_tokens: Number(anfrage.maxTokens) > 0 ? Number(anfrage.maxTokens) : 4096,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: String(anfrage.system),
        messages: [{ role: "user", content: String(anfrage.user) }],
        output_config: { format: { type: "json_schema", schema: anfrage.schema } },
      });
      if (antwort.stop_reason === "refusal") throw new Error("Anfrage wurde vom Modell abgelehnt");
      const text = (antwort.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
      if (!text) throw new Error("Leere Antwort");
      return { text, modell: antwort.model || modell, tokens: antwort.usage ? antwort.usage.input_tokens + antwort.usage.output_tokens : 0 };
    } catch (err) {
      if (err instanceof Anthropic.AuthenticationError) throw new Error("API-Key ungueltig");
      if (err instanceof Anthropic.RateLimitError) throw new Error("Rate-Limit — spaeter noch einmal");
      if (err instanceof Anthropic.APIError) throw new Error(`API-Fehler ${err.status}: ${err.message}`);
      throw new Error(err && err.message ? err.message : String(err));
    }
  });
}

// ── Lied-Bruecke (Generator-Tab): Python/Demucs-Probe und Stems ueber scripts/stems.py ──
const { spawn } = require("child_process");

function pythonPfad() {
  const s = leseSettings();
  return typeof s.pythonPfad === "string" && s.pythonPfad.trim() ? s.pythonPfad.trim() : "python";
}

function laufen(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    let out = "";
    let err = "";
    let kind;
    try {
      kind = spawn(cmd, args, { windowsHide: true, cwd: opts.cwd });
    } catch (e) {
      reject(e);
      return;
    }
    const timer = setTimeout(() => {
      kind.kill();
      reject(new Error(`Zeitueberschreitung nach ${Math.round(opts.timeoutMs / 1000)} s`));
    }, opts.timeoutMs);
    kind.stdout.on("data", (d) => (out += d.toString("utf8")));
    kind.stderr.on("data", (d) => {
      const t = d.toString("utf8");
      err += t;
      if (opts.onStderr) opts.onStderr(t);
    });
    kind.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    kind.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ out, err });
      else reject(new Error(err.trim().split(/\r?\n/).slice(-3).join(" | ") || `Exit-Code ${code}`));
    });
  });
}

function registerLiedIpc(win) {
  ipcMain.handle("lied:pythonStatus", async () => {
    const py = pythonPfad();
    try {
      const { out } = await laufen(py, ["-c", "import demucs, sys; print(getattr(demucs, '__version__', 'ok'))"], { timeoutMs: 20000 });
      return { python: py, demucs: true, version: out.trim(), meldung: `Python gefunden, Demucs ${out.trim()}` };
    } catch (e) {
      return { python: null, demucs: false, version: "", meldung: `Kein Demucs: ${e.message}` };
    }
  });
  // anfrage: { fenster: [{ id, bytes:number[] (mono 44,1 k float32 als Int16-WAV) }] } → { fenster: [{ id, melo: number[], vox: number[]|null, voxDb }] }
  ipcMain.handle("lied:stems", async (_e, anfrage) => {
    const basis = path.join(app.getPath("userData"), "tmp", `stems-${Date.now()}`);
    fs.mkdirSync(basis, { recursive: true });
    try {
      const liste = anfrage.fenster.map((f) => {
        const wav = path.join(basis, `${String(f.id).replace(/[^A-Za-z0-9_-]/g, "_")}-mix.wav`);
        fs.writeFileSync(wav, Buffer.from(f.bytes));
        return { id: f.id, wav };
      });
      const anfragePfad = path.join(basis, "anfrage.json");
      fs.writeFileSync(anfragePfad, JSON.stringify({ fenster: liste, ziel: basis }));
      // gepackt liegt stems.py als extraResource neben der App (asar kann Python nicht lesen)
      const kandidaten = [path.join(app.getAppPath(), "scripts", "stems.py")];
      if (process.resourcesPath) kandidaten.unshift(path.join(process.resourcesPath, "scripts", "stems.py"));
      const skript = kandidaten.find((k) => fs.existsSync(k)) ?? kandidaten[kandidaten.length - 1];
      const { out } = await laufen(pythonPfad(), [skript, anfragePfad], {
        timeoutMs: 600000,
        cwd: app.getAppPath(),
        onStderr: (t) => {
          if (win && !win.isDestroyed()) win.webContents.send("lied:fortschritt", t.trim());
        },
      });
      const ergebnis = JSON.parse(out.trim().split(/\r?\n/).pop());
      return {
        fenster: ergebnis.fenster.map((f) => ({
          id: f.id,
          melo: Array.from(fs.readFileSync(f.melo)),
          vox: f.vox ? Array.from(fs.readFileSync(f.vox)) : null,
          drums: f.drums ? Array.from(fs.readFileSync(f.drums)) : null,
          voxDb: f.voxDb,
        })),
      };
    } finally {
      try {
        fs.rmSync(basis, { recursive: true, force: true });
      } catch {
        /* Temp bleibt liegen — unkritisch */
      }
    }
  });
}

// ── URL-Bruecke (Generator-Tab): YouTube/SoundCloud -> WAV ueber yt-dlp + imageio-ffmpeg ──
const URL_HOSTS = new Set([
  "youtube.com", "www.youtube.com", "music.youtube.com", "m.youtube.com", "youtu.be",
  "soundcloud.com", "www.soundcloud.com", "m.soundcloud.com", "on.soundcloud.com",
]);

async function ffmpegPfad() {
  try {
    const { out } = await laufen(pythonPfad(), ["-c", "import imageio_ffmpeg,sys;print(imageio_ffmpeg.get_ffmpeg_exe())"], { timeoutMs: 20000 });
    const p = out.trim().split(/\r?\n/).pop();
    return p && fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function registerUrlIpc(win) {
  ipcMain.handle("url:probe", async () => {
    try {
      const { out } = await laufen(pythonPfad(), ["-m", "yt_dlp", "--version"], { timeoutMs: 20000 });
      const version = out.trim();
      const ff = await ffmpegPfad();
      if (!ff) return { ok: false, meldung: `yt-dlp ${version} da, aber kein ffmpeg (pip install imageio-ffmpeg)` };
      return { ok: true, version, meldung: `yt-dlp ${version} + ffmpeg bereit` };
    } catch (e) {
      return { ok: false, meldung: "Kein yt-dlp (pip install yt-dlp): " + e.message };
    }
  });
  ipcMain.handle("url:laden", async (_e, url) => {
    let u;
    try {
      u = new URL(String(url));
    } catch {
      throw new Error("Keine gueltige URL");
    }
    if (u.protocol !== "https:") throw new Error("Nur https-Links");
    if (!URL_HOSTS.has(u.hostname.toLowerCase())) throw new Error("Nur YouTube- und SoundCloud-Links");
    const ff = await ffmpegPfad();
    if (!ff) throw new Error("ffmpeg fehlt (pip install imageio-ffmpeg)");
    const basis = path.join(app.getPath("userData"), "tmp", `url-${Date.now()}`);
    fs.mkdirSync(basis, { recursive: true });
    const melde = (t) => {
      if (win && !win.isDestroyed()) win.webContents.send("url:fortschritt", t);
    };
    try {
      melde("Lade Audio von der URL …");
      await laufen(
        pythonPfad(),
        [
          "-m", "yt_dlp", "--no-playlist", "--newline", "-x", "--audio-format", "wav", "--audio-quality", "0",
          "--postprocessor-args", "ffmpeg:-ar 44100", "--ffmpeg-location", ff, "--write-info-json",
          "-o", path.join(basis, "lied.%(ext)s"), u.toString(),
        ],
        { timeoutMs: 600000, onStderr: (t) => melde(t.trim().split(/\r?\n/).pop() || "") },
      );
      const wav = path.join(basis, "lied.wav");
      if (!fs.existsSync(wav)) throw new Error("Es ist kein WAV entstanden — Link pruefen");
      let titel = "lied";
      try {
        titel = String(JSON.parse(fs.readFileSync(path.join(basis, "lied.info.json"), "utf8")).title || "lied");
      } catch {
        /* Titel bleibt "lied" */
      }
      const name = `${titel.replace(/[^\w\s().-]/g, "").trim().slice(0, 60) || "lied"}.wav`;
      return { name, bytes: fs.readFileSync(wav) };
    } finally {
      try {
        fs.rmSync(basis, { recursive: true, force: true });
      } catch {
        /* Temp bleibt liegen — unkritisch */
      }
    }
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
  registerKiIpc();
  registerLiedIpc(win);
  registerUrlIpc(win);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      midiWin = createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

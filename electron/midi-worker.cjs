/**
 * midi-worker.cjs — MIDI-I/O in einem Worker-Thread.
 *
 * Grund: @julusian/midi.openPort() ist ein SYNCHRONER nativer Aufruf, der
 * blockieren kann (z.B. wenn ein anderer Prozess den Port hält). Im Main-Thread
 * würde das die ganze App einfrieren. Im Worker blockiert höchstens der Worker;
 * der Main-Thread setzt jede Anfrage mit Timeout ab und kann den Worker bei
 * Hänger terminieren + neu starten.
 *
 * Nachrichten (vom Main): { id, cmd:"list"|"openOut"|"openIn"|"send"|"clock", … }
 * Antworten (an Main):    { id, ok, result?, error? }  bzw.  { type:"midi", data }
 */

const { parentPort } = require("worker_threads");

let midi = null;
try {
  midi = require("@julusian/midi");
} catch (err) {
  parentPort.postMessage({ type: "fatal", error: String(err && err.message) });
}

let out = null;
/** Name des offenen Ausgangs — zum Wiederfinden nach einem Geraete-Neustart. */
let outName = null;

/**
 * Den Ausgang anhand seines Namens neu oeffnen. Nach einem Neustart des
 * Geraets (Firmware-Update, USB ab und an) ist das alte WinMM-Handle tot:
 * jedes Senden scheitert mit "error preparing sysex header", obwohl der Port
 * in der Liste steht (gesehen 2026-09-03). Liefert true, wenn ein Port mit
 * demselben Namen wieder offen ist.
 */
function ausgangNeuOeffnen() {
  if (!outName) return false;
  try { if (out) out.closePort(); } catch { /* das alte Handle ist ohnehin tot */ }
  out = null;
  const o = new midi.Output();
  let idx = -1;
  for (let k = 0; k < o.getPortCount(); k++) if (o.getPortName(k) === outName) { idx = k; break; }
  if (idx < 0) return false;
  o.openPort(idx);
  out = o;
  return true;
}
let input = null;
/** Portnummer des offenen Geräte-Eingangs — gebraucht, um ihn nach dem Öffnen des Controller-Eingangs neu zu öffnen (siehe openIn2). */
let inputPort = null;
/** Name des Geraete-Eingangs — zum Wiederfinden nach einem Geraete-Neustart. */
let inputName = null;
/** Zweiter Eingang (Controller, z. B. MIDImix) — Nachrichten werden mit quelle:"controller" markiert. */
let input2 = null;

function oeffneGeraeteEingang(port) {
  input = new midi.Input();
  input.ignoreTypes(false, false, false); // SysEx NICHT ignorieren
  input.on("message", (_dt, m) => parentPort.postMessage({ type: "midi", data: Array.from(m), quelle: "geraet" }));
  inputName = input.getPortName(Number(port));
  input.openPort(Number(port));
  inputPort = Number(port);
}

/** Den Geraete-Eingang anhand seines Namens neu oeffnen — nach einem Neustart ist auch sein Handle tot. */
function eingangNeuOeffnen() {
  if (!inputName) return false;
  try { if (input) input.closePort(); } catch { /* totes Handle */ }
  input = null;
  const i = new midi.Input();
  let idx = -1;
  for (let k = 0; k < i.getPortCount(); k++) if (i.getPortName(k) === inputName) { idx = k; break; }
  i.closePort();
  if (idx < 0) return false;
  oeffneGeraeteEingang(idx);
  return true;
}

// ─── MIDI-Clock-Generator (0xF8, 24 ppqn) ─────────────────────────────────
//
// Läuft im Worker, weil hier der Ausgang liegt und der Main-Thread nichts
// blockieren soll. Drift-korrigiert: jeder Tick wird gegen die Sollzeit
// (hrtime) geplant, nicht gegen den vorigen Timer — sonst läuft die Clock
// mit der Timer-Latenz davon. Jitter einzelner Ticks bleibt (~1 ms); die
// Electribe mittelt das Tempo über mehrere Ticks.
const clock = { timer: null, bpm: 120, naechster: 0n, laeuft: false };

function clockIntervalNs() {
  return BigInt(Math.round((60_000_000_000 / (clock.bpm * 24))));
}

function clockTick() {
  if (!clock.laeuft) return;
  const jetzt = process.hrtime.bigint();
  // Nachholen, falls der Timer spät dran war — aber höchstens ein paar Ticks,
  // sonst flutet ein eingeschlafener Prozess das Gerät.
  let gesendet = 0;
  while (clock.naechster <= jetzt && gesendet < 4) {
    try { if (out) out.sendMessage([0xf8]); } catch { /* Port weg — Clock läuft leer */ }
    clock.naechster += clockIntervalNs();
    gesendet++;
  }
  if (clock.naechster <= jetzt) clock.naechster = jetzt + clockIntervalNs();
  const warteMs = Number(clock.naechster - process.hrtime.bigint()) / 1e6;
  clock.timer = setTimeout(clockTick, Math.max(0, warteMs));
}

function clockStart(bpm) {
  clock.bpm = Math.max(20, Math.min(300, Number(bpm) || 120));
  if (clock.laeuft) return;
  clock.laeuft = true;
  clock.naechster = process.hrtime.bigint();
  clockTick();
}

function clockStop() {
  clock.laeuft = false;
  if (clock.timer) clearTimeout(clock.timer);
  clock.timer = null;
}

parentPort.on("message", (msg) => {
  const { id, cmd } = msg;
  try {
    if (!midi) throw new Error("MIDI-Lib nicht geladen");
    if (cmd === "list") {
      const o = new midi.Output();
      const i = new midi.Input();
      const outputs = [];
      const inputs = [];
      for (let k = 0; k < o.getPortCount(); k++) outputs.push({ id: String(k), name: o.getPortName(k) });
      for (let k = 0; k < i.getPortCount(); k++) inputs.push({ id: String(k), name: i.getPortName(k) });
      o.closePort();
      i.closePort();
      parentPort.postMessage({ id, ok: true, result: { outputs, inputs } });
    } else if (cmd === "openOut") {
      if (out) out.closePort();
      out = new midi.Output();
      // Den NAMEN merken, nicht nur die Nummer: nach einem Neustart des Geraets
      // (Firmware-Update, USB ab und an) kann die Nummer wandern.
      outName = out.getPortName(Number(msg.port));
      out.openPort(Number(msg.port));
      parentPort.postMessage({ id, ok: true });
    } else if (cmd === "openIn") {
      if (input) input.closePort();
      oeffneGeraeteEingang(msg.port);
      parentPort.postMessage({ id, ok: true });
    } else if (cmd === "openIn2") {
      if (input2) input2.closePort();
      input2 = null;
      if (msg.port !== null && msg.port !== undefined && msg.port !== "") {
        // Windows MIDI Services (Win11, WinMM-Schicht): Ein Eingang, der NACH
        // einem bereits offenen Eingang geöffnet wird, kann dauerhaft stumm
        // bleiben — das Öffnen meldet Erfolg, es kommt nur nie eine Nachricht
        // (gemessen 2026-08-30: MIDImix nach electribe geöffnet = 0 Nachrichten,
        // umgekehrte Reihenfolge = beide liefern). Deshalb wird der
        // Geräte-Eingang hier kurz geschlossen, der Controller ZUERST geöffnet
        // und das Gerät danach neu.
        const geraetWarOffen = input !== null;
        if (geraetWarOffen) {
          input.closePort();
          input = null;
        }
        input2 = new midi.Input();
        input2.ignoreTypes(true, true, true); // Controller: kein SysEx/Clock/Sensing noetig
        input2.on("message", (_dt, m) => parentPort.postMessage({ type: "midi", data: Array.from(m), quelle: "controller" }));
        input2.openPort(Number(msg.port));
        if (geraetWarOffen && inputPort !== null) oeffneGeraeteEingang(inputPort);
      }
      parentPort.postMessage({ id, ok: true });
    } else if (cmd === "send") {
      if (!out) throw new Error("Kein MIDI-Ausgang geöffnet");
      try {
        out.sendMessage(msg.bytes);
      } catch (e) {
        // Einmal neu oeffnen und wiederholen — sonst bleibt nach einem
        // Geraete-Neustart jeder Befehl tot, bis der Nutzer "Geraet suchen" drueckt.
        if (!ausgangNeuOeffnen()) {
          throw new Error(`MIDI-Ausgang verloren (${String(e && e.message)}) — Gerät neu suchen`);
        }
        out.sendMessage(msg.bytes);
        // Der Eingang haengt am selben Geraet — sein Handle ist dann genauso tot.
        const eingang = eingangNeuOeffnen();
        parentPort.postMessage({ type: "hinweis", text: `MIDI-Ausgang „${outName}“ neu geöffnet${eingang ? ", Eingang ebenfalls" : ""}` });
      }
      parentPort.postMessage({ id, ok: true });
    } else if (cmd === "clock") {
      // { action: "start"|"stop"|"bpm", bpm? }
      if (msg.action === "start") {
        if (!out) throw new Error("Kein MIDI-Ausgang geöffnet");
        clockStart(msg.bpm);
      } else if (msg.action === "stop") {
        clockStop();
      } else if (msg.action === "bpm") {
        clock.bpm = Math.max(20, Math.min(300, Number(msg.bpm) || clock.bpm));
      } else {
        throw new Error("Unbekannte Clock-Aktion: " + msg.action);
      }
      parentPort.postMessage({ id, ok: true, result: { laeuft: clock.laeuft, bpm: clock.bpm } });
    } else {
      throw new Error("Unbekanntes MIDI-Kommando: " + cmd);
    }
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: String(err && err.message) });
  }
});

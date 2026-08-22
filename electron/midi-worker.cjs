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
let input = null;

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
      out.openPort(Number(msg.port));
      parentPort.postMessage({ id, ok: true });
    } else if (cmd === "openIn") {
      if (input) input.closePort();
      input = new midi.Input();
      input.ignoreTypes(false, false, false); // SysEx NICHT ignorieren
      input.on("message", (_dt, m) => parentPort.postMessage({ type: "midi", data: Array.from(m) }));
      input.openPort(Number(msg.port));
      parentPort.postMessage({ id, ok: true });
    } else if (cmd === "send") {
      if (!out) throw new Error("Kein MIDI-Ausgang geöffnet");
      out.sendMessage(msg.bytes);
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

/**
 * midi-worker.cjs — MIDI-I/O in einem Worker-Thread.
 *
 * Grund: @julusian/midi.openPort() ist ein SYNCHRONER nativer Aufruf, der
 * blockieren kann (z.B. wenn ein anderer Prozess den Port hält). Im Main-Thread
 * würde das die ganze App einfrieren. Im Worker blockiert höchstens der Worker;
 * der Main-Thread setzt jede Anfrage mit Timeout ab und kann den Worker bei
 * Hänger terminieren + neu starten.
 *
 * Nachrichten (vom Main): { id, cmd:"list"|"openOut"|"openIn"|"send", … }
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
    } else {
      throw new Error("Unbekanntes MIDI-Kommando: " + cmd);
    }
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: String(err && err.message) });
  }
});

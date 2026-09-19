// seq-probe.mjs — Stage-1-Auslese der sequenzer-internen Ingress-Sonde (Sprint 187).
//
// Voraussetzung: das Geraet laeuft die Seq-Probe-Firmware
//   SYSTEM_coexist_MOD132_EXEC_ev_seqprobe_sprint187.vsb
// (Coexist-Build mit --seq-probe: zusaetzlich zum OTP-Hook ist der
// sequenzer-interne Parser 0xC0022234 auf einen ZAEHL-/MITSCHNITT-Hook gebogen
// — keine Modulaufrufe, keine Injektion). Diese Sonde beantwortet die offene
// Frage: erreichen die eigenen Noten/Pads/Sequenzer-Events der Korg diesen
// Parser? Wenn ja, koennen wir die Module in Stufe 2 daran haengen.
//
// Der Stub meldet auf CMD 0x04 SUB 0x05:
//   vals[0] = count  (Bytes, die 0xC0022234 erreicht haben)
//   vals[1] = widx   (Schreibindex, frei laufend)
//   vals[2] = magic  (0x53455131 = "SEQ1", sonst Sonde nie gelaufen)
//   vals[3..12] = 10 Woerter je 4 Ring-Bytes (die ersten 40 der 64 Ring-Slots)
//
//   node scripts/seq-probe.mjs            (einmal lesen)
//   node scripts/seq-probe.mjs watch      (alle 700 ms lesen, bis Strg-C)

import midi from "@julusian/midi";

const H = [0xf0, 0x7d, 0x01, 0x02], END = 0xf7;
const xor = (p) => p.reduce((a, b) => a ^ (b & 0x7f), 0) & 0x7f;
const frame = (cmd, sub, p = []) => [...H, cmd, sub, (p.length >> 7) & 0x7f, p.length & 0x7f, ...p, xor(p), END];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hx = (v, n = 8) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(n, "0");
const find = (d, h) => { for (let i = 0; i < d.getPortCount(); i++) if (d.getPortName(i).toLowerCase().includes(h)) return i; return -1; };

// CMD 0x04 Report: SUB 0x7F, Payload [subEcho, n×(hi, b0..b3)] — 7-of-8 kodiert.
function decReport(m) {
  const p = m.slice(8, m.length - 2);
  const vals = [];
  for (let i = 1; i + 4 < p.length; i += 5) {
    const hi = p[i];
    vals.push(((p[i + 1] | ((hi & 1) << 7)) | ((p[i + 2] | (((hi >> 1) & 1) << 7)) << 8) | ((p[i + 3] | (((hi >> 2) & 1) << 7)) << 16) | ((p[i + 4] | (((hi >> 3) & 1) << 7)) << 24)) >>> 0);
  }
  return { sub: p[0], vals };
}

const out = new midi.Output(), inp = new midi.Input();
const oi = find(out, "electribe"), ii = find(inp, "electribe");
if (oi < 0 || ii < 0) { console.error("electribe-Port nicht gefunden — Geraet an und einziger MIDI-Client?"); process.exit(1); }
let rx = []; inp.ignoreTypes(false, true, true); inp.on("message", (_d, m) => rx.push(Array.from(m)));
inp.openPort(ii); out.openPort(oi);

async function cmd04(sub, payload = [], ms = 1500) {
  rx = []; out.sendMessage(frame(0x04, sub, payload)); const t = Date.now();
  while (Date.now() - t < ms) { for (const m of rx) if (m[1] === 0x7d && m[4] === 0x04 && m[5] === 0x7f) return decReport(m); await sleep(8); }
  return null;
}

function classify(b) {
  if (b === 0xf8) return "clock";
  if (b === 0xfa || b === 0xfb || b === 0xfc) return "start/cont/stop";
  if (b === 0xfe) return "active-sense";
  if ((b & 0xf0) === 0x90) return "note-on";
  if ((b & 0xf0) === 0x80) return "note-off";
  if ((b & 0xf0) === 0xb0) return "CC";
  if (b >= 0x80) return "status " + hx(b, 2);
  return "data";
}

async function read() {
  const r = await cmd04(0x06);
  if (!r) { console.log("KEIN REPORT — laeuft die Seq-Probe-Firmware und ist sie der einzige MIDI-Client?"); return null; }
  const [count, widx, magic, ...words] = r.vals;
  const ok = magic === 0x53455131;
  console.log(`magic ${hx(magic)} ${ok ? "(SEQ1 — Sonde lief)" : "(ungueltig — Sonde nie ausgeloest / falsche Firmware)"}`);
  console.log(`count=${count}  widx=${widx}`);
  if (!ok || count === 0) { console.log("=> Bisher KEIN Byte am Parser 0xC0022234. Sequenzer/Pads spielen lassen und erneut lesen."); return r; }
  const bytes = [];
  for (let k = 0; k < Math.min(10, words.length); k++) for (let j = 0; j < 4; j++) bytes.push((words[k] >>> (8 * j)) & 0xff);
  console.log("erste " + bytes.length + " Ring-Bytes:");
  console.log("  " + bytes.map((b) => b.toString(16).padStart(2, "0")).join(" "));
  const kinds = {};
  for (const b of bytes) { const c = classify(b); kinds[c] = (kinds[c] || 0) + 1; }
  console.log("  Arten: " + Object.entries(kinds).map(([k, v]) => `${k}×${v}`).join(", "));
  console.log("  => " + (kinds["note-on"] || kinds["note-off"] ? "NOTEN sind dabei — Stufe 2 (Module daranhaengen) lohnt sich." :
    (kinds["clock"] ? "nur Clock/Realtime — der Sequenzer taktet hier, aber Noten laufen woanders." : "Bytes da, aber keine klaren Noten — Muster ansehen.")));
  return r;
}

(async () => {
  try {
    if (process.argv[2] === "watch") { for (;;) { console.log("── " + new Date().toLocaleTimeString() + " ──"); await read(); await sleep(700); } }
    else await read();
  } finally { out.closePort(); inp.closePort(); }
})();

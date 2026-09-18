// noteon-probe.mjs — Stage-1-Auslese der internen Note-On-Sonde (Sprint 187).
//
// Voraussetzung: das Geraet laeuft SYSTEM_coexist_MOD132_EXEC_ev_noteonprobe_sprint187.vsb
// (Coexist-Build mit --noteon-probe: der interne Voice-Arm-Kern 0xC00913EC ist auf einen
// ZAEHL-/MITSCHNITT-Hook gebogen — keine Modulaufrufe, keine Injektion). Beantwortet:
// erreichen die eigenen Noten der Korg (Step-Sequenzer, Pads) den internen Ausloesepunkt?
//
// Der Stub meldet auf CMD 0x04 SUB 0x07:
//   vals[0] = count  (Anzahl Note-On-Ereignisse seit Boot)
//   vals[1] = widx   (Ring-Schreibindex, +2 je Note-On)
//   vals[2] = magic  (0x4E4F4E31 = "NON1", sonst Sonde nie ausgeloest)
//   vals[3..12] = 10 Woerter je 4 Ring-Bytes = die letzten (Note,Velocity)-Paare
//
//   node scripts/noteon-probe.mjs          (einmal)
//   node scripts/noteon-probe.mjs watch     (fortlaufend)
import midi from "@julusian/midi";
const H = [0xf0, 0x7d, 0x01, 0x02], END = 0xf7;
const xor = (p) => p.reduce((a, b) => a ^ (b & 0x7f), 0) & 0x7f;
const frame = (cmd, sub, p = []) => [...H, cmd, sub, (p.length >> 7) & 0x7f, p.length & 0x7f, ...p, xor(p), END];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hx = (v, n = 8) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(n, "0");
const find = (d, h) => { for (let i = 0; i < d.getPortCount(); i++) if (d.getPortName(i).toLowerCase().includes(h)) return i; return -1; };
function decReport(m) {
  const p = m.slice(8, m.length - 2), vals = [];
  for (let i = 1; i + 4 < p.length; i += 5) { const hi = p[i]; vals.push(((p[i + 1] | ((hi & 1) << 7)) | ((p[i + 2] | (((hi >> 1) & 1) << 7)) << 8) | ((p[i + 3] | (((hi >> 2) & 1) << 7)) << 16) | ((p[i + 4] | (((hi >> 3) & 1) << 7)) << 24)) >>> 0); }
  return { sub: p[0], vals };
}
const out = new midi.Output(), inp = new midi.Input();
const oi = find(out, "electribe"), ii = find(inp, "electribe");
if (oi < 0 || ii < 0) { console.error("electribe-Port nicht gefunden"); process.exit(1); }
let rx = []; inp.ignoreTypes(false, true, true); inp.on("message", (_d, m) => rx.push(Array.from(m)));
inp.openPort(ii); out.openPort(oi);
async function cmd04(sub, ms = 1500) { rx = []; out.sendMessage(frame(0x04, sub)); const t = Date.now(); while (Date.now() - t < ms) { for (const m of rx) if (m[1] === 0x7d && m[4] === 0x04 && m[5] === 0x7f) return decReport(m); await sleep(8); } return null; }
const NOTE = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const nn = (n) => NOTE[n % 12] + (Math.floor(n / 12) - 1);
async function read() {
  const r = await cmd04(0x07);
  if (!r) { console.log("KEIN REPORT — laeuft die Note-On-Probe-Firmware und ist sie der einzige MIDI-Client?"); return null; }
  const [count, widx, magic, ...words] = r.vals;
  const ok = magic === 0x4e4f4e31;
  console.log(`magic ${hx(magic)} ${ok ? "(NON1 — Sonde lief)" : "(ungueltig — Sonde nie ausgeloest / falsche Firmware)"}`);
  console.log(`count=${count} Note-On-Ereignisse,  widx=${widx}`);
  if (!ok || count === 0) { console.log("=> Bisher KEINE Note am Voice-Arm-Kern 0xC00913EC. Sequenzer starten / Pads druecken, dann erneut lesen."); return r; }
  const bytes = [];
  for (let k = 0; k < Math.min(10, words.length); k++) for (let j = 0; j < 4; j++) bytes.push((words[k] >>> (8 * j)) & 0xff);
  const pairs = [];
  for (let i = 0; i + 1 < bytes.length; i += 2) pairs.push(`${nn(bytes[i])}(${bytes[i]})/v${bytes[i + 1]}`);
  console.log("  (Note/Velocity)-Paare im Ring: " + pairs.join("  "));
  console.log("  => Noten kommen am internen Ausloesepunkt an. Stufe 2 (on_note_on/off der Module dort einklinken, mit Egress-Sperrflag) ist dran.");
  return r;
}
(async () => { try { if (process.argv[2] === "watch") { for (;;) { console.log("── " + new Date().toLocaleTimeString() + " ──"); await read(); await sleep(700); } } else await read(); } finally { out.closePort(); inp.closePort(); } })();

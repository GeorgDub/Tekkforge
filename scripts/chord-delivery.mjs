// chord-delivery.mjs — Stufe-2a Zustellungs-Test: platziert den Chord-Player und liest
// seinen Zustand, um zu belegen, dass on_note_on von den GERAETE-EIGENEN Noten (Sequenzer/
// Pads) ankommt — OHNE OTP-Callbacks. Voraussetzung: Firmware ...noteondispatch_sprint187.
//
//   node scripts/chord-delivery.mjs place   → unplace all, Chord (id 9) hochladen+commit,
//                                              alle 16 Parts aktivieren (Maj, root=played).
//   node scripts/chord-delivery.mjs read    → g_state lesen: enabled[], held_n[], held_notes[].
//
// ChordState-Layout (chord.c): enabled@0, chord_type@16, stagger@32, root_override@48,
// user_chords@64, pending@96 (128*8=1024), audio_tick_count@1120, held_notes[16][8]@1124,
// held_n[16]@1252. Modul-Slot 0xC2000000+id*0x10000; g_state = *(slot+0x24).
import midi from "@julusian/midi"; import fs from "node:fs";
const H = [0xf0, 0x7d, 0x01, 0x02], END = 0xf7;
const xor = (p) => p.reduce((a, b) => a ^ (b & 0x7f), 0) & 0x7f;
const fr = (cmd, sub, p = []) => [...H, cmd, sub, (p.length >> 7) & 0x7f, p.length & 0x7f, ...p, xor(p), END];
const enc7 = (d) => { const o = []; for (let i = 0; i < d.length; i += 7) { let k = 0; const e = Math.min(i + 7, d.length); for (let j = i; j < e; j++) if (d[j] & 0x80) k |= 1 << (j - i); o.push(k & 0x7f); for (let j = i; j < e; j++) o.push(d[j] & 0x7f); } return o; };
const dec7 = (d) => { const o = []; for (let i = 0; i < d.length;) { const k = d[i++]; for (let j = 0; j < 7 && i < d.length; j++) o.push(d[i++] | ((k >> j) & 1 ? 0x80 : 0)); } return o; };
const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const chunkFrame = (id, off, raw) => fr(0x05, 0x02, [id & 0x7f, (off >> 14) & 0x7f, (off >> 7) & 0x7f, off & 0x7f, ...enc7(raw)]);
const cb = (id, cbi, args) => fr(0x05, 0x05, [id & 0x7f, cbi & 0x7f, ...enc7(args)]);
const nrpn = (id, msb, lsb, val) => cb(id, 1, [msb, lsb, val & 0xff, (val >> 8) & 0xff]);
const peekFrame = (a, l) => [...H, 0x52, ...enc7([...le32(a), ...le32(l)]), END];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hx = (v) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(8, "0");
const find = (d, h) => { for (let i = 0; i < d.getPortCount(); i++) if (d.getPortName(i).toLowerCase().includes(h)) return i; return -1; };
const out = new midi.Output(), inp = new midi.Input();
if (find(out, "electribe") < 0 || find(inp, "electribe") < 0) { console.error("electribe-Port nicht gefunden"); process.exit(1); }
out.openPort(find(out, "electribe")); inp.openPort(find(inp, "electribe"));
let rx = []; inp.ignoreTypes(false, true, true); inp.on("message", (_d, m) => rx.push(Array.from(m)));
async function ack(f, ms = 1200) { rx = []; out.sendMessage(f); const t = Date.now(); const a = []; const seen = new Set(); while (Date.now() - t < ms) { for (let k = 0; k < rx.length; k++) { const m = rx[k]; if (!seen.has(k) && m[1] === 0x7d && m[4] === 0x05 && m[5] === 0x03) { seen.add(k); a.push({ status: m[8], id: m[9], x: m[10] }); } } await sleep(6); } return a; }
async function peek(addr, len, ms = 900) { rx = []; out.sendMessage(peekFrame(addr, len)); const t = Date.now(); while (Date.now() - t < ms) { for (const m of rx) if (m[1] === 0x7d && m[4] === 0x52) return dec7(m.slice(5, m.length - 1)).slice(0, len); await sleep(8); } return null; }
const rd32 = async (a) => { const b = await peek(a, 4); return b ? (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0 : null; };
const ID = 9, SLOT = (0xC2000000 + ID * 0x10000) >>> 0;

async function place() {
  await ack(fr(0x05, 0x07, [0x7f]));            // unplace all
  const bin = Array.from(fs.readFileSync("G:/IdeaProjects/Omnitribe/build/modules_abs/chord.bin"));
  const id = bin[6] | (bin[7] << 8);
  for (let o = 0; o < bin.length; o += 180) { const a = await ack(chunkFrame(id, o, bin.slice(o, o + 180))); if (!a.length || a[0].status !== 0) { console.log("chunk fail @" + o); return; } }
  const c = await ack(fr(0x05, 0x04, [id]));
  console.log(`chord (id ${id}) commit: ${c.map(x => "0x" + x.status.toString(16).padStart(2, "0")).join("→")} ${c.some(x => x.status === 0x0c) ? "✓ init lief" : "✗"}`);
  for (let part = 0; part < 16; part++) {   // NRPN-Callbacks quittieren nicht -> fire-and-forget
    out.sendMessage(nrpn(id, 0x1e, (part << 4) | 0x00, 0));   await sleep(15);  // chord_type = Maj
    out.sendMessage(nrpn(id, 0x1e, (part << 4) | 0x02, 200)); await sleep(15);  // root_override>127 -> gespielte Note
    out.sendMessage(nrpn(id, 0x1e, (part << 4) | 0x01, 0));   await sleep(15);  // stagger 0
    out.sendMessage(nrpn(id, 0x1e, (part << 4) | 0x03, 1));   await sleep(15);  // enabled
  }
  const en = await peek((await rd32(SLOT + 0x24)) + 0, 16);
  console.log("enabled[0..15] nach Konfig:", en ? en.join(" ") : "—");
  console.log("→ Chord platziert und auf allen 16 Parts aktiv (Maj, root=gespielte Note, kein Stagger).");
  console.log("→ Jetzt am Geraet Sequenzer/Pads spielen, dann:  node scripts/chord-delivery.mjs read");
}
async function read() {
  const g = await rd32(SLOT + 0x24);
  if (!g || g < 0xC2000000 || g >= 0xC2200000) { console.log(`g_state-Zeiger @${hx(SLOT + 0x24)} = ${g === null ? "—" : hx(g)} — Modul platziert? (erst 'place')`); return; }
  console.log(`g_state @${hx(g)}`);
  const en = await peek(g + 0, 16);
  const hn = await peek(g + 1252, 16);
  console.log("enabled[0..15]:", en ? en.join(" ") : "—");
  console.log("held_n[0..15] :", hn ? hn.join(" ") : "—");
  if (!hn) { console.log("keine Antwort"); return; }
  const active = [];
  for (let p = 0; p < 16; p++) if (hn[p] > 0) active.push(p);
  if (!active.length) { console.log("=> held_n ueberall 0 — bisher KEINE Note im Chord angekommen. Laenger spielen und erneut lesen (Part-Ableitung evtl. anders)."); return; }
  for (const p of active) {
    const notes = await peek(g + 1124 + p * 8, 8);
    console.log(`  Part ${p + 1}: held_n=${hn[p]}, held_notes=[${notes ? notes.slice(0, hn[p]).join(",") : "?"}]`);
  }
  console.log("=> on_note_on IST vom geraeteinternen Note-On-Pfad im Chord-Modul angekommen. Zustellung bewiesen — Stufe 2b (Note-Off + hoerbare Injektion) ist dran.");
}
(async () => { try { const op = process.argv[2] || "read"; if (op === "place") await place(); else await read(); } finally { out.closePort(); inp.closePort(); } })();

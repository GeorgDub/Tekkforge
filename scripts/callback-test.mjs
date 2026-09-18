// Live-Callback-Test (Sprint 185, 2026-09-18). Laedt ein absolut gelinktes Modul,
// committet (init), liest dessen g_state, feuert dann Callbacks per OTP CMD 0x05
// SUB 0x05 und difft g_state davor/danach — so wird die Wirkung eines Callbacks
// am Gerät sichtbar. Setzt den EXEC-Coexist-Build mit Callback-Handler voraus.
//
// Aufruf:  node scripts/callback-test.mjs <modul>
//   <modul> = arpeggiator | modmatrix | chord   (Default arpeggiator)
import midi from "@julusian/midi"; import fs from "node:fs";
const H = [0xf0, 0x7d, 0x01, 0x02], END = 0xf7;
const enc7 = (d) => { const o = []; for (let i = 0; i < d.length; i += 7) { let k = 0; const e = Math.min(i + 7, d.length); for (let j = i; j < e; j++) if (d[j] & 0x80) k |= 1 << (j - i); o.push(k & 0x7f); for (let j = i; j < e; j++) o.push(d[j] & 0x7f); } return o; };
const dec7 = (d) => { const o = []; let i = 0; while (i < d.length) { const k = d[i++]; for (let j = 0; j < 7 && i < d.length; j++) { let b = d[i++] & 0x7f; if (k & (1 << j)) b |= 0x80; o.push(b); } } return o; };
const xor = (p) => { let c = 0; for (const b of p) c ^= b; return c & 0x7f; };
const frame = (cmd, sub, p) => [...H, cmd, sub, (p.length >> 7) & 0x7f, p.length & 0x7f, ...p, xor(p), END];
const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const peek = (a, l) => [...H, 0x52, ...enc7([...le32(a), ...le32(l)]), END];
const chunkFrame = (id, off, raw) => frame(0x05, 0x02, [id & 0x7f, (off >> 14) & 0x7f, (off >> 7) & 0x7f, off & 0x7f, ...enc7(raw)]);
const commitFrame = (id) => frame(0x05, 0x04, [id & 0x7f]);
const cbFrame = (id, cb, args) => frame(0x05, 0x05, [id & 0x7f, cb & 0x7f, ...enc7(args)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (d, h) => { for (let i = 0; i < d.getPortCount(); i++) if (d.getPortName(i).toLowerCase().includes(h)) return i; return -1; };
const hex = (d) => d.map((b) => b.toString(16).padStart(2, "0")).join(" ");
const ABS = "G:/IdeaProjects/Omnitribe/build/modules_abs";

// cb-Index: 1=on_nrpn 2=on_clock_tick 3=on_audio_tick 4=on_note_on 5=on_note_off
const MODULES = {
  arpeggiator: { bin: `${ABS}/arpeggiator.bin`, gstate: 0xC20109CC, len: 60,
    seq: [
      { cb: 4, args: [0, 60, 100], name: "on_note_on(ch0, note60, vel100)" },
      { cb: 2, args: le32(6), name: "on_clock_tick(6)" },
    ],
    deute: (b) => `n_held/active_note/last_trigger_tick sollten sich gesetzt haben; step_index -1(ff)->0` },
  modmatrix: { bin: `${ABS}/modmatrix.bin`, gstate: 0xC2000358, len: 64,
    seq: [
      { cb: 4, args: [0, 64, 100], name: "on_note_on(ch0, note64, vel100)" },
      { cb: 3, args: le32(1), name: "on_audio_tick(1)" },
    ],
    deute: (b) => `envelope/velocity-Snapshot bei Note-On; on_audio_tick rechnet LFO-Phasen` },
  chord: { bin: `${ABS}/chord.bin`, gstate: 0xC20903B0, len: 64,
    seq: [
      { cb: 1, args: [0x1e, 0x00, 2, 0], name: "on_nrpn(msb0x1E,lsb0x00,val2) = chord_type[0]=2" },
      { cb: 1, args: [0x1e, 0x01, 50, 0], name: "on_nrpn(msb0x1E,lsb0x01,val50) = stagger_ms[0]=50" },
    ],
    deute: (b) => `chord_type[0] @+16 sollte 0x02, stagger_ms[0] @+32 sollte 0x32(50) sein` },
};

const name = process.argv[2] || "arpeggiator";
const M = MODULES[name];
if (!M) { console.error("unbekanntes Modul:", name, "— waehle:", Object.keys(MODULES).join(" ")); process.exit(1); }

const out = new midi.Output(), inp = new midi.Input();
const oi = find(out, "electribe"), ii = find(inp, "electribe");
if (oi < 0 || ii < 0) { console.error("electribe-Port nicht gefunden"); process.exit(1); }
let rx = []; inp.ignoreTypes(false, true, true); inp.on("message", (_d, m) => rx.push(Array.from(m)));
inp.openPort(ii); out.openPort(oi);
async function acks(f, ms = 2500) { rx = []; out.sendMessage(f); const t = Date.now(); const a = []; const seen = new Set(); while (Date.now() - t < ms) { for (let k = 0; k < rx.length; k++) { const m = rx[k]; if (!seen.has(k) && m[1] === 0x7d && m[4] === 0x05 && m[5] === 0x03) { seen.add(k); a.push({ status: m[8], id: m[9], x: m[10] }); } } await sleep(8); } return a; }
async function rd(a, l) { rx = []; out.sendMessage(peek(a, l)); const t = Date.now(); while (Date.now() - t < 700) { for (const m of rx) if (m[1] === 0x7d && m[4] === 0x52) return dec7(m.slice(5, m.length - 1)).slice(0, l); await sleep(8); } return null; }
const ackStr = (a) => a.map((x) => "0x" + x.status.toString(16).padStart(2, "0")).join("→") || "(kein ACK)";

(async () => {
  const bin = Array.from(fs.readFileSync(M.bin));
  const id = bin[6] | (bin[7] << 8);
  console.log(`=== ${name} (id ${id}) — Live-Callback-Test ===`);
  console.log("Upload + Commit (init)...");
  for (let off = 0; off < bin.length; off += 180) { const a = await acks(chunkFrame(id, off, bin.slice(off, off + 180)), 1200); if (!a.length || a[0].status !== 0) { console.log(`  Chunk @${off} FEHLER ${ackStr(a)}`); out.closePort(); inp.closePort(); return; } }
  const ci = await acks(commitFrame(id));
  console.log(`  Commit ACKs: ${ackStr(ci)} ${ci.some((x) => x.status === 0x0c) && ci.some((x) => x.status === 0) ? "(init lief+kehrte zurueck ✓)" : ""}`);

  const before = await rd(M.gstate, M.len);
  console.log(`\ng_state @0x${M.gstate.toString(16).toUpperCase()} VOR Callbacks:\n  ${before ? hex(before) : "(nicht lesbar)"}`);

  for (const step of M.seq) {
    const a = await acks(cbFrame(id, step.cb, step.args));
    console.log(`\n${step.name}  ->  ACKs ${ackStr(a)} ${a.some((x) => x.status === 0x0c) && a.some((x) => x.status === 0) ? "✓" : "⚠"}`);
  }

  const after = await rd(M.gstate, M.len);
  console.log(`\ng_state @0x${M.gstate.toString(16).toUpperCase()} NACH Callbacks:\n  ${after ? hex(after) : "(nicht lesbar)"}`);

  if (before && after) {
    const diff = [];
    for (let i = 0; i < Math.min(before.length, after.length); i++) if (before[i] !== after[i]) diff.push(`+${i}: 0x${before[i].toString(16).padStart(2, "0")}->0x${after[i].toString(16).padStart(2, "0")}`);
    console.log(`\nGeaenderte Bytes (${diff.length}): ${diff.join("  ") || "KEINE — Callback ohne sichtbare Wirkung"}`);
    console.log(`Deutung: ${M.deute(after)}`);
    console.log(diff.length ? "\n=== ✓ CALLBACK WIRKT: g_state hat sich durch den Aufruf geaendert ===" : "\n=== ⚠ keine g_state-Aenderung (Callback lief laut ACK, aber ohne sichtbaren Effekt in diesem Fenster) ===");
  }
  out.closePort(); inp.closePort();
})();

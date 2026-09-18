// Sprint 186 — Event-Routing am Gerät, stufenweise (Entwurf: Omnitribe
// docs/superpowers/specs/2026-09-18-modul-event-routing-design.md). Setzt den
// EXEC-Coexist-Build mit Event-Routing voraus.
//
//   node scripts/event-routing-test.mjs status
//   node scripts/event-routing-test.mjs peek <irq>
//   node scripts/event-routing-test.mjs install <irq> [divAudio] [divClock] [src 0|1]   (nur zaehlen: 0 0 0)
//   node scripts/event-routing-test.mjs rate <irq>          (install ohne Teiler, 5 s messen)
//   node scripts/event-routing-test.mjs config <divAudio> <divClock> <src>
//   node scripts/event-routing-test.mjs restore
//   node scripts/event-routing-test.mjs drain
//   node scripts/event-routing-test.mjs load <modul>        (abs .bin hochladen + commit)
//   node scripts/event-routing-test.mjs note <ch> <note> <vel> [ms]   (echte MIDI-Note ans Geraet)
//   node scripts/event-routing-test.mjs arp-demo <divClock> [sekunden]   (Note halten, Drain-Schleife)
//   node scripts/event-routing-test.mjs chord-demo [typ] [sekunden]      (Part 1 Akkord, Note halten, Release pruefen)
import midi from "@julusian/midi"; import fs from "node:fs";
const H = [0xf0, 0x7d, 0x01, 0x02], END = 0xf7;
const enc7 = (d) => { const o = []; for (let i = 0; i < d.length; i += 7) { let k = 0; const e = Math.min(i + 7, d.length); for (let j = i; j < e; j++) if (d[j] & 0x80) k |= 1 << (j - i); o.push(k & 0x7f); for (let j = i; j < e; j++) o.push(d[j] & 0x7f); } return o; };
const xor = (p) => { let c = 0; for (const b of p) c ^= b; return c & 0x7f; };
const frame = (cmd, sub, p) => [...H, cmd, sub, (p.length >> 7) & 0x7f, p.length & 0x7f, ...p, xor(p), END];
const chunkFrame = (id, off, raw) => frame(0x05, 0x02, [id & 0x7f, (off >> 14) & 0x7f, (off >> 7) & 0x7f, off & 0x7f, ...enc7(raw)]);
const commitFrame = (id) => frame(0x05, 0x04, [id & 0x7f]);
const hi7 = (v) => (v >> 7) & 0x7f, lo7 = (v) => v & 0x7f;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (d, h) => { for (let i = 0; i < d.getPortCount(); i++) if (d.getPortName(i).toLowerCase().includes(h)) return i; return -1; };
const hx = (v) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(8, "0");
const ABS = "G:/IdeaProjects/Omnitribe/build/modules_abs";

const out = new midi.Output(), inp = new midi.Input();
const oi = find(out, "electribe"), ii = find(inp, "electribe");
if (oi < 0 || ii < 0) { console.error("electribe-Port nicht gefunden"); process.exit(1); }
let rx = []; inp.ignoreTypes(false, true, true); inp.on("message", (_d, m) => rx.push(Array.from(m)));
inp.openPort(ii); out.openPort(oi);

// CMD 0x04 Report: SUB 0x7F, Payload [subEcho, n×(hi, b0..b3)]
function decReport(m) {
  const p = m.slice(8, m.length - 2); const vals = [];
  for (let i = 1; i + 4 < p.length + 1 && i + 4 <= p.length; i += 5) {
    const h = p[i]; vals.push(((p[i + 1] | ((h & 1) << 7)) | ((p[i + 2] | ((h & 2) << 6)) << 8) | ((p[i + 3] | ((h & 4) << 5)) << 16) | ((p[i + 4] | ((h & 8) << 4)) << 24)) >>> 0);
  }
  return { sub: p[0], vals };
}
async function cmd04(sub, payload = [], ms = 1500) {
  rx = []; out.sendMessage(frame(0x04, sub, payload)); const t = Date.now();
  while (Date.now() - t < ms) { for (const m of rx) if (m[1] === 0x7d && m[4] === 0x04 && m[5] === 0x7f) return decReport(m); await sleep(8); }
  return null;
}
async function ack05(f, ms = 1500) { rx = []; out.sendMessage(f); const t = Date.now(); const a = []; const seen = new Set(); while (Date.now() - t < ms) { for (let k = 0; k < rx.length; k++) { const m = rx[k]; if (!seen.has(k) && m[1] === 0x7d && m[4] === 0x05 && m[5] === 0x03) { seen.add(k); a.push({ status: m[8], id: m[9], x: m[10] }); } } await sleep(8); } return a; }

const STATUS_NAMES = ["installed", "irq", "orig", "ticks", "audio_ticks", "clock_ticks", "ev_note_on", "ev_nrpn", "egress_frames", "egress_dropped", "egress_refused", "ev_clock_midi", "ticks_skipped"];
async function status(print = true) {
  const r = await cmd04(0x04);
  if (!r) { if (print) console.log("status: KEIN REPORT"); return null; }
  const o = {}; STATUS_NAMES.forEach((n, i) => (o[n] = r.vals[i]));
  if (print) console.log(STATUS_NAMES.map((n) => `${n}=${n === "orig" ? hx(o[n]) : o[n]}`).join("  "));
  return o;
}
async function load(name) {
  const bin = Array.from(fs.readFileSync(`${ABS}/${name}.bin`)); const id = bin[6] | (bin[7] << 8);
  for (let off = 0; off < bin.length; off += 180) { const a = await ack05(chunkFrame(id, off, bin.slice(off, off + 180)), 1200); if (!a.length || a[0].status !== 0) { console.log(`Chunk @${off} FEHLER`); return false; } }
  const c = await ack05(commitFrame(id));
  const ok = c.some((x) => x.status === 0x0c) && c.some((x) => x.status === 0);
  console.log(`${name} (id ${id}): Commit ${c.map((x) => "0x" + x.status.toString(16).padStart(2, "0")).join("→")} ${ok ? "✓ init lief" : "✗"}`);
  return ok;
}
async function drain() { const a = await ack05(frame(0x05, 0x06, [])); return a.length ? a[0].x : null; }

const [, , op, ...args] = process.argv;
(async () => {
  try {
    if (op === "status") await status();
    else if (op === "peek") { const irq = +args[0]; const r = await cmd04(0x01, [irq & 0x7f]); console.log(r ? `table[${r.vals[0]}] = ${hx(r.vals[1])}` : "KEIN REPORT"); }
    else if (op === "install") {
      const irq = +args[0], dA = +(args[1] || 0), dC = +(args[2] || 0), src = +(args[3] || 0);
      const r = await cmd04(0x02, [irq & 0x7f, hi7(dA), lo7(dA), hi7(dC), lo7(dC), src & 1]);
      if (!r) console.log("install: KEIN REPORT (Geraet haengt?)");
      else if (r.vals.length === 1) console.log(`install abgelehnt: Status 0x${r.vals[0].toString(16)}`);
      else console.log(`installiert: irq ${r.vals[0]}, orig ${hx(r.vals[1])} -> wrapper ${hx(r.vals[2])}`);
      await sleep(300); await status();
    }
    else if (op === "rate") {
      const irq = +args[0];
      const r = await cmd04(0x02, [irq & 0x7f, 0, 0, 0, 0, 0]);
      if (!r || r.vals.length === 1) { console.log("install fehlgeschlagen/abgelehnt:", r ? r.vals : "kein Report"); }
      const s0 = await status(false); const t0 = Date.now(); await sleep(5000); const s1 = await status(false);
      if (s0 && s1) { const dt = (Date.now() - t0) / 1000; const rate = (s1.ticks - s0.ticks) / dt; console.log(`ticks ${s0.ticks} -> ${s1.ticks} in ${dt.toFixed(2)} s  =>  ${rate.toFixed(1)} Hz`); console.log(`Teiler-Vorschlag: div_audio=${Math.round(rate / 172)} (~172 Hz), div_clock=${Math.round(rate / 48)} (48/s = 24 PPQN @120 BPM)`); }
      else console.log("Status nicht lesbar — Geraet reagiert nicht mehr? Aus/Ein.");
    }
    else if (op === "config") { const dA = +args[0], dC = +args[1], src = +(args[2] || 0); const r = await cmd04(0x05, [hi7(dA), lo7(dA), hi7(dC), lo7(dC), src & 1]); console.log(r ? `config: div_audio=${r.vals[0]} div_clock=${r.vals[1]} src=${r.vals[2]}` : "KEIN REPORT"); }
    else if (op === "restore") { const r = await cmd04(0x03); console.log(r ? (r.vals.length === 1 ? `restore: Status 0x${r.vals[0].toString(16)}` : `restore: table[${r.vals[0]}] = ${hx(r.vals[1])}`) : "KEIN REPORT"); }
    else if (op === "unplace") { const id = args[0] === undefined || args[0] === "all" ? 0x7f : +args[0]; const a = await ack05(frame(0x05, 0x07, [id & 0x7f])); console.log(a.length ? `unplace ${id === 0x7f ? "alle" : id}: Status 0x${a[0].status.toString(16).padStart(2, "0")}, placed_mask(low7)=0x${a[0].x.toString(16)}` : "KEIN ACK"); }
    else if (op === "drain") { const n = await drain(); console.log(n === null ? "KEIN ACK" : `drain ok, egress_frames(low7)=${n}`); await status(); }
    else if (op === "load") { await load(args[0]); await status(); }
    else if (op === "note") {
      const ch = +args[0], note = +args[1], vel = +(args[2] || 100), ms = +(args[3] || 500);
      out.sendMessage([0x90 | ch, note, vel]); await sleep(ms); out.sendMessage([0x80 | ch, note, 0]);
      console.log(`Note ${note} auf ch${ch} gespielt (${ms} ms)`); await status();
    }
    else if (op === "arp-demo") {
      const dC = +args[0], secs = +(args[1] || 8);
      if (!(await load("arpeggiator"))) return;
      const cfg = await cmd04(0x05, [0, 0, hi7(dC), lo7(dC), 1]); console.log("config:", cfg ? cfg.vals : "?");
      const s0 = await status();
      console.log(`Note 60 halten auf ch0, ${secs} s Drain-Schleife (alle 20 ms) — der Arp sollte hoerbar laufen...`);
      out.sendMessage([0x90, 60, 100]);
      const tEnd = Date.now() + secs * 1000; let n = 0;
      while (Date.now() < tEnd) { out.sendMessage(frame(0x05, 0x06, [])); n++; await sleep(20); }
      out.sendMessage([0x80, 60, 0]);
      await sleep(200); rx = [];
      const s1 = await status();
      if (s0 && s1) console.log(`\nclock_ticks +${s1.clock_ticks - s0.clock_ticks}, egress_frames +${s1.egress_frames - s0.egress_frames} (injizierte Noten), refused +${s1.egress_refused - s0.egress_refused}, dropped +${s1.egress_dropped - s0.egress_dropped}`);
    }
    else if (op === "chord-demo") {
      // Review 2026-09-18b: chord bekam on_note_off (vorher hingen alle Akkordnoten) und
      // triggert den gespielten Grundton nicht mehr doppelt. Erwartung: Note 60 auf ch0 ->
      // zwei Zusatznoten (Maj: 64, 67) klingen, alle enden beim Loslassen; egress_frames +4.
      const type = +(args[0] || 0), secs = +(args[1] || 3);
      if (!(await load("chord"))) return;
      const nrpn = (msb, lsb, val) => { out.sendMessage([0xb0, 99, msb]); out.sendMessage([0xb0, 98, lsb]); out.sendMessage([0xb0, 6, (val >> 7) & 0x7f]); out.sendMessage([0xb0, 38, val & 0x7f]); };
      nrpn(0x1E, 0x03, 1); await sleep(30); nrpn(0x1E, 0x00, type); await sleep(100);   // Part 0: enabled, Typ
      const s0 = await status();
      console.log(`chord Part 1 Typ ${type}: Note 60 ${secs} s halten — Akkord hoerbar, danach alles still...`);
      out.sendMessage([0x90, 60, 100]);
      const tEnd = Date.now() + secs * 1000;
      while (Date.now() < tEnd) { out.sendMessage(frame(0x05, 0x06, [])); await sleep(20); }
      out.sendMessage([0x80, 60, 0]);
      for (let i = 0; i < 10; i++) { out.sendMessage(frame(0x05, 0x06, [])); await sleep(20); }
      rx = [];
      const s1 = await status();
      if (s0 && s1) console.log(`\nev_nrpn +${s1.ev_nrpn - s0.ev_nrpn} (erwartet 2), ev_note_on +${s1.ev_note_on - s0.ev_note_on}, egress_frames +${s1.egress_frames - s0.egress_frames} (erwartet 4: 2 On + 2 Off), refused +${s1.egress_refused - s0.egress_refused}, dropped +${s1.egress_dropped - s0.egress_dropped}`);
    }
    else if (op === "modmatrix-lfo") {
      // Slot 0 von Part 0: Source LFO1_SIN (1) → Target FILTER_CUTOFF (4), Depth 100.
      // NRPN per plain CC 99/98/6/38 auf ch0 — der Ingress-Parser routet MSB 0x13/0x14/0x15
      // an modmatrix.on_nrpn (MSB ≥ 0x07, Hacktribe ignoriert diese MSBs). Danach treibt
      // der Audio-Tick den LFO; SET_MOD → CC 74 → Cutoff wobbelt hoerbar.
      const secs = +(args[0] || 10);
      if (!(await load("modmatrix"))) return;
      const nrpn = (msb, lsb, val) => { out.sendMessage([0xb0, 99, msb]); out.sendMessage([0xb0, 98, lsb]); out.sendMessage([0xb0, 6, (val >> 7) & 0x7f]); out.sendMessage([0xb0, 38, val & 0x7f]); };
      nrpn(0x13, 0, 1); await sleep(30); nrpn(0x14, 0, 4); await sleep(30); nrpn(0x15, 0, 100); await sleep(100);
      const s0 = await status();
      console.log(`modmatrix Slot 0: LFO1_SIN → CUTOFF, Depth 100. ${secs} s Drain-Schleife — Cutoff auf Part 1 sollte hoerbar wobbeln...`);
      const tEnd = Date.now() + secs * 1000;
      while (Date.now() < tEnd) { out.sendMessage(frame(0x05, 0x06, [])); await sleep(20); }
      await sleep(200); rx = [];
      const s1 = await status();
      if (s0 && s1) console.log(`\nev_nrpn +${s1.ev_nrpn - s0.ev_nrpn} (erwartet 3), audio_ticks +${s1.audio_ticks - s0.audio_ticks}, egress_frames +${s1.egress_frames - s0.egress_frames} (CC-74-Injektionen)`);
    }
    else console.log("Befehle: status | peek | install | rate | config | restore | drain | load | unplace [id|all] | note | arp-demo | chord-demo | modmatrix-lfo");
  } finally { out.closePort(); inp.closePort(); }
})();

// inject-live.mjs — Stufe 2b(2): HÖRBARE Injektion, gestuftes Scharfschalten.
// Voraussetzung: SYSTEM_coexist_MOD132_EXEC_injectlive_sprint188.vsb geflasht.
// Der Chord-Player baut auf einer gespielten Note einen Dur-Akkord und der Stub
// speist die Zusatznoten in die Firmware ein -> aus EINER Note wird ein Dreiklang.
// Schleifenschutz: Identitaets-Ring (injizierte Noten kommen async zurueck und
// werden am noteon_dispatch verworfen) + Raten-Begrenzer als Fangnetz.
//
//   node scripts/inject-live.mjs place1 [part]   Chord auf GENAU EINEM Part (Default 0)
//   node scripts/inject-live.mjs guard           Schleifenschutz-Telemetrie (CMD 0x04 SUB 0x0A)
//   node scripts/inject-live.mjs off             alle Module entfernen (Injektion aus)
//
// ARMING (Berater): EIN Part, Finger am Netzschalter. Nach der ERSTEN Einzelnote
// 'guard' lesen: egress_frames == Zusatznoten (Maj = 2), rate_tripped == 0,
// inj_wr klein. Springt egress_frames/inj_wr hoch oder rate_tripped != 0 ->
// Ring greift nicht -> Netzschalter, NICHT weiterspielen.
import midi from "@julusian/midi"; import fs from "node:fs";
const H = [0xf0, 0x7d, 0x01, 0x02], END = 0xf7;
const xor = (p) => p.reduce((a, b) => a ^ (b & 0x7f), 0) & 0x7f;
const fr = (cmd, sub, p = []) => [...H, cmd, sub, (p.length >> 7) & 0x7f, p.length & 0x7f, ...p, xor(p), END];
const enc7 = (d) => { const o = []; for (let i = 0; i < d.length; i += 7) { let k = 0; const e = Math.min(i + 7, d.length); for (let j = i; j < e; j++) if (d[j] & 0x80) k |= 1 << (j - i); o.push(k & 0x7f); for (let j = i; j < e; j++) o.push(d[j] & 0x7f); } return o; };
const cb = (id, cbi, args) => fr(0x05, 0x05, [id & 0x7f, cbi & 0x7f, ...enc7(args)]);
const nrpn = (id, msb, lsb, val) => cb(id, 1, [msb, lsb, val & 0xff, (val >> 8) & 0xff]);
const chunkFrame = (id, off, raw) => fr(0x05, 0x02, [id & 0x7f, (off >> 14) & 0x7f, (off >> 7) & 0x7f, off & 0x7f, ...enc7(raw)]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (d, h) => { for (let i = 0; i < d.getPortCount(); i++) if (d.getPortName(i).toLowerCase().includes(h)) return i; return -1; };
const out = new midi.Output(), inp = new midi.Input();
if (find(out, "electribe") < 0 || find(inp, "electribe") < 0) { console.error("electribe-Port nicht gefunden"); process.exit(1); }
out.openPort(find(out, "electribe")); inp.openPort(find(inp, "electribe"));
let rx = []; inp.ignoreTypes(false, true, true); inp.on("message", (_d, m) => rx.push(Array.from(m)));
function decReport(m) { const p = m.slice(8, m.length - 2), v = []; for (let i = 1; i + 4 < p.length; i += 5) { const hi = p[i]; v.push(((p[i + 1] | ((hi & 1) << 7)) | ((p[i + 2] | (((hi >> 1) & 1) << 7)) << 8) | ((p[i + 3] | (((hi >> 2) & 1) << 7)) << 16) | ((p[i + 4] | (((hi >> 3) & 1) << 7)) << 24)) >>> 0); } return { sub: p[0], vals: v }; }
async function ack(f, ms = 1200) { rx = []; out.sendMessage(f); const t = Date.now(); const a = []; const seen = new Set(); while (Date.now() - t < ms) { for (let k = 0; k < rx.length; k++) { const m = rx[k]; if (!seen.has(k) && m[1] === 0x7d && m[4] === 0x05 && m[5] === 0x03) { seen.add(k); a.push({ status: m[8], id: m[9], x: m[10] }); } } await sleep(6); } return a; }
async function cmd04(sub, payload = [], ms = 1500) { rx = []; out.sendMessage(fr(0x04, sub, payload)); const t = Date.now(); while (Date.now() - t < ms) { for (const m of rx) if (m[1] === 0x7d && m[4] === 0x04 && m[5] === 0x7f) return decReport(m); await sleep(8); } return null; }

async function place1(part) {
  await ack(fr(0x05, 0x07, [0x7f]));   // unplace all
  const bin = Array.from(fs.readFileSync("G:/IdeaProjects/Omnitribe/build/modules_abs/chord.bin"));
  const id = bin[6] | (bin[7] << 8);
  for (let o = 0; o < bin.length; o += 180) { const a = await ack(chunkFrame(id, o, bin.slice(o, o + 180))); if (!a.length || a[0].status !== 0) { console.log("chunk fail @" + o); return; } }
  const c = await ack(fr(0x05, 0x04, [id]));
  console.log(`chord (id ${id}) commit: ${c.some(x => x.status === 0x0c) ? "✓ init lief" : "✗ " + c.map(x => x.status).join("→")}`);
  // NUR den einen Part aktivieren (gestuftes Scharfschalten).
  out.sendMessage(nrpn(id, 0x1e, (part << 4) | 0x00, 0));   await sleep(15);  // chord_type = Maj
  out.sendMessage(nrpn(id, 0x1e, (part << 4) | 0x02, 200)); await sleep(15);  // root_override>127 -> gespielte Note
  out.sendMessage(nrpn(id, 0x1e, (part << 4) | 0x01, 0));   await sleep(15);  // stagger 0
  out.sendMessage(nrpn(id, 0x1e, (part << 4) | 0x03, 1));   await sleep(15);  // enabled
  console.log(`→ Chord NUR auf Part ${part + 1} aktiv (Maj, root=gespielte Note).`);
  console.log(`→ ARMING: Finger am Netzschalter. Spiel GENAU EINE Note auf Part ${part + 1} (erwartet: Dreiklang statt Einzelton).`);
  console.log(`→ Dann sofort:  node scripts/inject-live.mjs guard`);
}
async function guard() {
  const r = await cmd04(0x0a);
  if (!r) { console.log("KEIN REPORT — laeuft die injectlive-Firmware und ist sie einziger MIDI-Client?"); return; }
  const [frames, refused, dropped, tripped, rate, wr, ticks, noteon] = r.vals;
  console.log(`egress_frames=${frames} (zugestellte Injektionen)  refused=${refused}  dropped=${dropped}`);
  console.log(`inj_wr=${wr} (injizierte Noten gesamt)  rate_count=${rate}  rate_tripped=${tripped}  ticks=${ticks}  note_on=${noteon}`);
  if (tripped > 0) { console.log("⚠ RATEN-BEGRENZER SCHLUG AN — Ring greift nicht, Runaway-Verdacht. NETZSCHALTER, nicht weiterspielen."); return; }
  console.log(tripped === 0 ? "✓ kein Runaway. Bei einer Einzelnote/Maj: egress_frames≈2, inj_wr≈2. Passt das, ist die hoerbare Injektion bewiesen." : "");
}
(async () => {
  try {
    const op = process.argv[2] || "guard";
    if (op === "place1") await place1(Math.max(0, Math.min(15, +(process.argv[3] ?? 0))));
    else if (op === "off") { await ack(fr(0x05, 0x07, [0x7f])); console.log("alle Module entfernt — Injektion aus."); }
    else await guard();
  } finally { out.closePort(); inp.closePort(); }
})();

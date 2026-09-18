// synctest.mjs — VORTEST: misst, ob eine per otp_inject_msg eingespeiste Note-On
// den Voice-Arm-Kern 0xC00913EC SYNCHRON (noch im byte_handler-Aufruf) oder
// ASYNCHRON (spaeter, im Audio-Task) erreicht. Das entscheidet den Schleifen-
// schutz fuer die hoerbare Injektion (Stufe 2b(2)):
//   delta==1 -> SYNCHRON  -> Quell-Zaehler injecting++/-- um den Drain reicht.
//   delta==0 -> ASYNCHRON -> Identitaets-Ring (Note/Part + Tick) noetig.
//
// Voraussetzung: Geraet laeuft SYSTEM_coexist_MOD132_EXEC_synctest_sprint188.vsb
// (Note-On-Sonde aktiv + Injektion scharf + Synctest-Instrumentierung; KEIN Modul,
// KEIN Auto-Drain -> keine Schleife moeglich, es wird genau EINE Note ausgeloest).
//
// Der Stub meldet auf CMD 0x04 SUB 0x08 (injizieren+messen):
//   vals[0]=ok(1/0)  vals[1]=pre  vals[2]=post  vals[3]=delta  vals[4]=calls  vals[5]=magic
//
//   node scripts/synctest.mjs                 (1x, ch0 note60 vel100)
//   node scripts/synctest.mjs 0 60 100 8      (ch note vel wiederholungen)
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
async function cmd04(sub, payload = [], ms = 1500) { rx = []; out.sendMessage(frame(0x04, sub, payload)); const t = Date.now(); while (Date.now() - t < ms) { for (const m of rx) if (m[1] === 0x7d && m[4] === 0x04 && m[5] === 0x7f) return decReport(m); await sleep(8); } return null; }
(async () => {
  try {
    const ch = (+(process.argv[2] ?? 0)) & 0x0f, note = (+(process.argv[3] ?? 60)) & 0x7f, vel = (+(process.argv[4] ?? 100)) & 0x7f;
    const reps = Math.max(1, +(process.argv[5] ?? 1));
    console.log(`VORTEST: injiziere Note-On ch${ch} note${note} vel${vel}, ${reps}x`);
    let sync = 0, async_ = 0, refused = 0;
    for (let i = 0; i < reps; i++) {
      const r = await cmd04(0x08, [ch, note, vel]);
      if (!r) { console.log(`  #${i + 1}: KEIN REPORT — laeuft die Synctest-Firmware und ist sie einziger MIDI-Client?`); break; }
      const [ok, pre, post, delta, calls, magic] = r.vals;
      const okmagic = magic === 0x49535931;
      if (!okmagic) { console.log(`  #${i + 1}: magic ${hx(magic)} — falsche Firmware (erwartet ISY1)`); break; }
      if (ok !== 1) { refused++; console.log(`  #${i + 1}: ok=0 (Injektion abgelehnt) pre=${pre} post=${post}`); }
      else { if (delta === 1) sync++; else if (delta === 0) async_++; console.log(`  #${i + 1}: ok=1 pre=${pre} post=${post} delta=${delta} (${delta === 1 ? "SYNC" : delta === 0 ? "ASYNC" : "?"})  calls=${calls}`); }
      await sleep(180);
    }
    console.log(`\n=> SYNC=${sync}  ASYNC=${async_}  abgelehnt=${refused}`);
    if (sync > 0 && async_ === 0) console.log("=> SYNCHRON: die injizierte Note erreicht 0xC00913EC im selben Aufruf. Schleifenschutz = Quell-Zaehler (injecting++/--) um den Drain genuegt.");
    else if (async_ > 0 && sync === 0) console.log("=> ASYNCHRON: die Note wird eingereiht und laeuft spaeter. Schleifenschutz braucht einen Identitaets-Ring (Note/Part + Tick), kein reiner Zaehler.");
    else if (sync && async_) console.log("=> GEMISCHT — genauer ansehen (evtl. IRQ-Fenster oder Voice-Steal). Mehr Wiederholungen.");
    else console.log("=> Keine erfolgreiche Injektion gemessen. Hat Part " + (ch + 1) + " ein Sample/Voice? Anderen Kanal probieren.");
  } finally { out.closePort(); inp.closePort(); }
})();

// Alle absolut gelinkten Module nacheinander laden + committen (init) und die
// Commit-ACK-Folge je Modul tabellarisch ausgeben. 0x0C→0x00 = init() erreicht
// und zurueckgekehrt. Setzt den EXEC-Coexist-Build voraus.
//   node scripts/all-modules-run.mjs            (alle *.bin in build/modules_abs)
//   node scripts/all-modules-run.mjs granular wavetable   (Auswahl)
import midi from "@julusian/midi"; import fs from "node:fs"; import path from "node:path";
const H = [0xf0, 0x7d, 0x01, 0x02], END = 0xf7;
const enc7 = (d) => { const o = []; for (let i = 0; i < d.length; i += 7) { let k = 0; const e = Math.min(i + 7, d.length); for (let j = i; j < e; j++) if (d[j] & 0x80) k |= 1 << (j - i); o.push(k & 0x7f); for (let j = i; j < e; j++) o.push(d[j] & 0x7f); } return o; };
const xor = (p) => { let c = 0; for (const b of p) c ^= b; return c & 0x7f; };
const frame = (cmd, sub, p) => [...H, cmd, sub, (p.length >> 7) & 0x7f, p.length & 0x7f, ...p, xor(p), END];
const chunkFrame = (id, off, raw) => frame(0x05, 0x02, [id & 0x7f, (off >> 14) & 0x7f, (off >> 7) & 0x7f, off & 0x7f, ...enc7(raw)]);
const commitFrame = (id) => frame(0x05, 0x04, [id & 0x7f]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (d, h) => { for (let i = 0; i < d.getPortCount(); i++) if (d.getPortName(i).toLowerCase().includes(h)) return i; return -1; };
const ABS = "G:/IdeaProjects/Omnitribe/build/modules_abs";

const wanted = process.argv.slice(2);
let bins = fs.readdirSync(ABS).filter((f) => f.endsWith(".bin")).sort();
if (wanted.length) bins = bins.filter((f) => wanted.includes(f.replace(/\.bin$/, "")));

const out = new midi.Output(), inp = new midi.Input();
const oi = find(out, "electribe"), ii = find(inp, "electribe");
if (oi < 0 || ii < 0) { console.error("electribe-Port nicht gefunden"); process.exit(1); }
let rx = []; inp.ignoreTypes(false, true, true); inp.on("message", (_d, m) => rx.push(Array.from(m)));
inp.openPort(ii); out.openPort(oi);
async function acks(f, ms) { rx = []; out.sendMessage(f); const t = Date.now(); const a = []; const seen = new Set(); while (Date.now() - t < ms) { for (let k = 0; k < rx.length; k++) { const m = rx[k]; if (!seen.has(k) && m[1] === 0x7d && m[4] === 0x05 && m[5] === 0x03) { seen.add(k); a.push(m[8]); } } await sleep(8); } return a; }
const ackStr = (a) => a.map((s) => "0x" + s.toString(16).padStart(2, "0")).join("→") || "KEIN ACK";

(async () => {
  console.log(`${"Modul".padEnd(20)} ${"id".padStart(3)} ${"Bytes".padStart(6)}  Chunks  Commit-ACKs        Ergebnis`);
  console.log("-".repeat(78));
  let ok = 0, fail = 0;
  for (const f of bins) {
    const bin = Array.from(fs.readFileSync(path.join(ABS, f)));
    const id = bin[6] | (bin[7] << 8);
    const name = f.replace(/\.bin$/, "");
    let chunksOk = true;
    for (let off = 0; off < bin.length; off += 180) {
      const a = await acks(chunkFrame(id, off, bin.slice(off, off + 180)), 1200);
      if (!a.length || a[0] !== 0) { chunksOk = false; break; }
    }
    if (!chunksOk) { console.log(`${name.padEnd(20)} ${String(id).padStart(3)} ${String(bin.length).padStart(6)}  FEHLER  -                  ✗ Upload`); fail++; continue; }
    const c = await acks(commitFrame(id), 2500);
    const ran = c.includes(0x0c) && c.includes(0x00);
    const verdict = ran ? "✓ init lief + zurueck" : c.length === 0 ? "✗ HAENGER (kein ACK)" : c.includes(0x0c) ? "✗ in init gehangen" : `✗ Status ${ackStr(c)}`;
    console.log(`${name.padEnd(20)} ${String(id).padStart(3)} ${String(bin.length).padStart(6)}  ok      ${ackStr(c).padEnd(18)} ${verdict}`);
    ran ? ok++ : fail++;
    if (c.length === 0) { console.log("  -> Geraet haengt vermutlich; Abbruch. Aus/Ein noetig."); break; }
  }
  console.log("-".repeat(78));
  console.log(`${ok} Module liefen, ${fail} Fehler.`);
  out.closePort(); inp.closePort();
})();

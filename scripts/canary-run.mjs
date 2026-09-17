// Kanarien-Modul (id 31) hochladen, committen, Postfach lesen — der
// Modul-Ausfuehrungs-Test vom 2026-09-18 (Sprint 185).
//
// Laedt das ABSOLUT gelinkte canary.bin (build_modules_absolute.py) chunk-weise
// (0x05/0x02) und committet (0x05/0x04). Unter dem SICHEREN Build passiert beim
// Commit nichts (Postfach bleibt leer). Unter dem EXEC-Build (#error entfernt)
// ruft der Commit canary_init(), das zwei Magics ins Postfach schreibt.
//
// Bisektion an den Commit-ACKs (0x05/0x03 [status,id,mask]):
//   kein ACK              -> vor/bei Cache-Sync gestorben
//   nur 0x0C              -> in init() gehangen
//   0x0C dann 0x00        -> init() kehrte zurueck  (Postfach pruefen)
//   Endstatus 0x0D        -> Modul war nicht ABS_LINKED (falscher Build)
//
// Aufruf:  node scripts/canary-run.mjs [pfad/zu/canary.bin]
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (d, h) => { for (let i = 0; i < d.getPortCount(); i++) if (d.getPortName(i).toLowerCase().includes(h)) return i; return -1; };
const rd32 = (d, o) => (d[o] | (d[o + 1] << 8) | (d[o + 2] << 16) | (d[o + 3] << 24)) >>> 0;
const hx = (v) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(8, "0");

const DDR_BASE = 0xC2000000, SLOT = 0x10000, RAW = 180, MAILBOX_OFF = 0x8000;
const MAGIC_A = 0xCA11AB1E, MAGIC_B = 0x900DB007;
const BIN = process.argv[2] || "G:/IdeaProjects/Omnitribe/build/modules_abs/canary.bin";

const out = new midi.Output(), inp = new midi.Input();
const oi = find(out, "electribe"), ii = find(inp, "electribe");
if (oi < 0 || ii < 0) { console.error("electribe-Port nicht gefunden"); process.exit(1); }
let rx = []; inp.ignoreTypes(false, true, true); inp.on("message", (_d, m) => rx.push(Array.from(m)));
inp.openPort(ii); out.openPort(oi);

// Ein ACK (0x05/0x03) einsammeln.
async function ack(f, ms = 1500) { rx = []; out.sendMessage(f); const t = Date.now(); while (Date.now() - t < ms) { for (const m of rx) if (m[1] === 0x7d && m[4] === 0x05 && m[5] === 0x03) return { status: m[8], id: m[9], mask: m[10] }; await sleep(8); } return null; }
// ALLE ACKs in einem Fenster einsammeln (Commit kann unter EXEC zwei senden).
async function ackAll(f, ms = 3000) { rx = []; out.sendMessage(f); const t = Date.now(); const acks = []; const seen = new Set(); while (Date.now() - t < ms) { for (let k = 0; k < rx.length; k++) { const m = rx[k]; if (!seen.has(k) && m[1] === 0x7d && m[4] === 0x05 && m[5] === 0x03) { seen.add(k); acks.push({ status: m[8], id: m[9], mask: m[10] }); } } await sleep(8); } return acks; }
async function rd(a, l) { rx = []; out.sendMessage(peek(a, l)); const t = Date.now(); while (Date.now() - t < 700) { for (const m of rx) if (m[1] === 0x7d && m[4] === 0x52) return dec7(m.slice(5, m.length - 1)).slice(0, l); await sleep(8); } return null; }

(async () => {
  const bin = Array.from(fs.readFileSync(BIN));
  const id = bin[6] | (bin[7] << 8);
  const slot = (DDR_BASE + id * SLOT) >>> 0;
  const mailbox = (slot + MAILBOX_OFF) >>> 0;
  const flags = rd32(bin, 32);
  console.log(`Kanarie: ${BIN}`);
  console.log(`  id=${id}, ${bin.length} B, flags=${hx(flags)} ${(flags & 0x10) ? "(ABS_LINKED ✓)" : "(NICHT ABS_LINKED ✗ — falscher Build!)"}`);
  console.log(`  Slot 0x${slot.toString(16).toUpperCase()}, Postfach 0x${mailbox.toString(16).toUpperCase()}`);

  // Postfach vorher loeschen? Nur lesen — wir wollen sehen, ob der Commit es fuellt.
  const pre = await rd(mailbox, 8);
  console.log(`  Postfach vorher: ${pre ? hx(rd32(pre, 0)) + " " + hx(rd32(pre, 4)) : "(nicht lesbar)"}`);

  console.log("=== Chunks senden ===");
  let ok = true;
  for (let off = 0; off < bin.length; off += RAW) {
    const a = await ack(chunkFrame(id, off, bin.slice(off, off + RAW)));
    if (!a || a.status !== 0x00) { console.log(`  Chunk @${off}: ${a ? "Status 0x" + a.status.toString(16) : "KEIN ACK"} ✗`); ok = false; break; }
  }
  if (!ok) { console.log("Upload fehlgeschlagen."); out.closePort(); inp.closePort(); return; }
  console.log("  alle Chunks 0x00 quittiert ✓");

  console.log("=== Commit (ACKs beobachten) ===");
  const acks = await ackAll(commitFrame(id));
  if (acks.length === 0) {
    console.log("  KEIN ACK — vor/bei Cache-Sync gestorben (CP15-Privileg? Placement?). Reboot noetig.");
  } else {
    for (const a of acks) console.log(`  ACK: Status 0x${a.status.toString(16).padStart(2, "0")} id=${a.id} mask=0x${a.mask.toString(16)}`);
    const codes = acks.map((a) => a.status);
    if (codes.includes(0x0C) && codes.includes(0x00)) console.log("  -> 0x0C dann 0x00: init() kehrte zurueck ✓ (Postfach pruefen)");
    else if (codes.includes(0x0C)) console.log("  -> nur 0x0C: in init() gehangen (Entry/Stack). Reboot noetig.");
    else if (codes.includes(0x0D)) console.log("  -> 0x0D: Modul war nicht ABS_LINKED (falscher Build).");
    else if (codes.includes(0x00)) console.log("  -> nur 0x00 (kein 0x0C): SICHERER Build, nichts ausgefuehrt (erwartet ohne EXEC).");
  }

  console.log("=== Postfach nach Commit (0x52) ===");
  const mb = await rd(mailbox, 8);
  if (!mb) { console.log("  Postfach nicht lesbar"); }
  else {
    const a = rd32(mb, 0), b = rd32(mb, 4);
    console.log(`  [0x8000] = ${hx(a)} ${a === MAGIC_A ? "= MAGIC_A ✓ (init erreicht)" : ""}`);
    console.log(`  [0x8004] = ${hx(b)} ${b === MAGIC_B ? "= MAGIC_B ✓ (init durchgelaufen)" : ""}`);
    if (a === MAGIC_A && b === MAGIC_B) console.log("\n=== ✓✓ MODUL LIEF: canary_init() erreicht UND zurueckgekehrt ===");
    else if (a === MAGIC_A) console.log("\n=== ⚠ init erreicht, aber MAGIC_B fehlt (nicht durchgelaufen) ===");
    else console.log("\n=== Postfach leer/anders — init hat (noch) nicht geschrieben (sicherer Build oder Haenger) ===");
  }
  out.closePort(); inp.closePort();
})();

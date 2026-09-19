// Bootloader flüchtig starten (execute_freetribe), Node + @julusian/midi.
// Sendet Pivot -> Magic -> 512 Häppchen bootloader.bin -> Execute an 0x80000000.
// syxEnc + Frame-Aufbau WÖRTLICH aus src/core/e2Sysex.ts / bootloaderStart.ts.
// --dry-run zeigt nur die Frames (kein MIDI). Ohne Flag: echter Ablauf.
import midi from "@julusian/midi";
import fs from "node:fs";

const START = 0xf0, KORG = 0x42, END = 0xf7, PID_SAMPLER = 0x24;
const PIVOT = 0x58, DATA = 0x54, EXEC = 0x57, MAGIC = 0x64;
const MAGIC_BODY = [0x01, 0x23, 0x45, 0x67];
const MAGIC_REPLY = [0x76, 0x54, 0x32, 0x10];
const ACK = 0x21, CHUNK = 256, OC_RAM_START = 0x80000000;

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const binPath = args.find((a) => a.endsWith(".bin")) ||
  "G:/Downloads/TekkForge/Firmware/bootloader-flashinstall-2026-09-17/bootloader.bin";
const portHint = (args.find((a) => a.startsWith("--port=")) || "--port=electribe").split("=")[1];

function head(ch = 0, id = PID_SAMPLER) { return [START, KORG, 0x30 | ch, 0x00, 0x01, id]; }
function frame(msgId, body = []) { return Uint8Array.from([...head(), msgId & 0x7f, ...body, END]); }

// syxEnc WÖRTLICH aus e2Sysex.ts
function syxEnc(byt) {
  const lng = byt.length; const out = []; let tmp = []; let b = 0; let cnt = 7; let lim = 0;
  for (let i = 0; i < lng; i++) {
    const e = byt[i];
    if (lng < 7) lim = 7 - lng;
    const a = e & 0x7f;
    b |= (e & 0x80) >> cnt;
    tmp.push(a);
    cnt -= 1;
    if (cnt === lim) {
      out.push(b);
      for (const t of tmp) out.push(t);
      tmp = []; b = 0; cnt = 7;
      if (lng - i < 7) lim = 7 - (lng - i) + 1;
    }
  }
  if (tmp.length > 0) { out.push(b); for (const t of tmp) out.push(t); }
  return Uint8Array.from(out);
}

function buildPivot() { return frame(PIVOT, syxEnc(new Uint8Array(8))); }
function buildMagic() { return frame(MAGIC, MAGIC_BODY); }
function buildDataChunk(c) { return frame(DATA, syxEnc(c)); }
function buildExecute(addr = OC_RAM_START) {
  const b = new Uint8Array(8); new DataView(b.buffer).setUint32(0, addr >>> 0, true);
  return frame(EXEC, syxEnc(b));
}
function inHaeppchen(image, chunk = CHUNK) {
  const out = [];
  for (let off = 0; off < image.length; off += chunk) {
    const teil = new Uint8Array(chunk);
    teil.set(image.subarray(off, Math.min(off + chunk, image.length)), 0);
    out.push(teil);
  }
  return out;
}
const hex = (a) => Array.from(a).map((b) => b.toString(16).padStart(2, "0")).join(" ");
const contains = (buf, seq) => {
  for (let i = 0; i + seq.length <= buf.length; i++) {
    let ok = true;
    for (let j = 0; j < seq.length; j++) if (buf[i + j] !== seq[j]) { ok = false; break; }
    if (ok) return true;
  }
  return false;
};

const image = new Uint8Array(fs.readFileSync(binPath));
const chunks = inHaeppchen(image);
console.log(`bootloader.bin: ${image.length} B -> ${chunks.length} Häppchen à ${CHUNK} B`);
console.log(`Pivot : ${hex(buildPivot())}`);
console.log(`Magic : ${hex(buildMagic())}  (erwartet Antwort ${hex(MAGIC_REPLY)})`);
console.log(`Chunk0: ${hex(buildDataChunk(chunks[0])).slice(0, 60)}…  (${buildDataChunk(chunks[0]).length} B)`);
console.log(`Exec  : ${hex(buildExecute())}`);

if (dryRun) { console.log("\n[dry-run] nichts gesendet."); process.exit(0); }

// ── MIDI ────────────────────────────────────────────────────────────────────
const out = new midi.Output();
const inp = new midi.Input();
function findPort(dev) {
  for (let i = 0; i < dev.getPortCount(); i++)
    if (dev.getPortName(i).toLowerCase().includes(portHint.toLowerCase())) return i;
  return -1;
}
const oi = findPort(out), ii = findPort(inp);
if (oi < 0 || ii < 0) { console.error(`Port "${portHint}" nicht gefunden (OUT ${oi}, IN ${ii}).`); process.exit(1); }
console.log(`\nPort: OUT[${oi}] ${out.getPortName(oi)} | IN[${ii}] ${inp.getPortName(ii)}`);

let rx = [];
inp.ignoreTypes(false, true, true); // SysEx NICHT ignorieren (erster false)
inp.on("message", (_dt, msg) => { rx.push(Uint8Array.from(msg)); });
out.openPort(oi); inp.openPort(ii);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, timeoutMs, label) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    for (const m of rx) if (pred(m)) return m;
    await sleep(10);
  }
  throw new Error(`Timeout: ${label} (${timeoutMs}ms, ${rx.length} Frames empfangen)`);
}

async function run() {
  try {
    console.log("\n1) Pivot senden…");
    out.sendMessage(Array.from(buildPivot()));
    await sleep(1000); // wie TekkForge: 1000ms bis der Loader bereit ist

    console.log("2) Magic senden (mit Wiederholung), warte auf 76 54 32 10 …");
    let magicOk = false;
    for (let versuch = 1; versuch <= 6 && !magicOk; versuch++) {
      rx = [];
      out.sendMessage(Array.from(buildMagic()));
      try {
        await waitFor((m) => contains(m, MAGIC_REPLY), 1500, `Magic ${versuch}`);
        magicOk = true;
      } catch { console.log(`   Versuch ${versuch}: keine Antwort, wiederhole…`); }
    }
    if (!magicOk) throw new Error("Keine Magic-Antwort nach 6 Versuchen — Loader nicht bereit.");
    console.log("   ✓ Loader antwortet — execute_freetribe aktiv.");

    console.log(`3) ${chunks.length} Häppchen senden…`);
    for (let i = 0; i < chunks.length; i++) {
      rx = [];
      out.sendMessage(Array.from(buildDataChunk(chunks[i])));
      await waitFor((m) => contains(m, [ACK]), 2000, `ACK für Häppchen ${i}`);
      if ((i + 1) % 64 === 0 || i === chunks.length - 1) console.log(`   ${i + 1}/${chunks.length} bestätigt`);
    }

    console.log("4) Execute an 0x80000000 — Gerät springt in den Bootloader (MIDI verschwindet).");
    out.sendMessage(Array.from(buildExecute()));
    await sleep(200);
    console.log("\n✓ FERTIG. Erwartet: Bootloader-Menü am Display, USB meldet e2fb:1802 (kein MIDI mehr).");
  } catch (e) {
    console.error(`\n✗ ${e.message}\n  Gerät aus/ein → Firmware unverändert. Nichts wurde geflasht.`);
    process.exitCode = 1;
  } finally {
    try { out.closePort(); inp.closePort(); } catch {}
  }
}
run();

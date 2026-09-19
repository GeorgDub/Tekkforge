// modtype-probe.mjs — READ-ONLY probe for the extended modulation types (72–131).
//
// Background: the MOD132 firmware carries a modulation-type table of 132 entries and
// the code limits are patched to 131, but the device PANEL encoder still stops at 72,
// and it was never confirmed that the extended types (72–131) actually change the sound.
// TekkForge can write a mod type into a pattern and send it to the edit buffer, but that
// path is untested on the device.
//
// This script does NOT write anything to the device. It reads memory over OTP 0x52 to:
//   A) confirm the reverse-engineered pointer chain the firmware's own "set mod type"
//      function uses — so a future device-side activation is built on proven math;
//   B) read back the current mod-type byte of each part, to compare with what the panel
//      shows (they must match);
//   C) peek the 2026-09-11 menu-limit candidate data region (a data byte there would be
//      a far safer fix than a runtime firmware call).
//
// Reverse-engineering (SYSTEM-vom-Geraet-2026-09-16.VSB, arm-none-eabi-objdump):
//   The panel calls setter 0xC0049B94(editObj, part, modType, flag=1). It clamps
//   cmp r2,#131 (= our patched limit) and writes strb modType,[partArray + part*0x330 + 0x814],
//   where partArray = *(editObj+4) and editObj = *(0xC033E6A4) + 0x400C. The singleton at
//   0xC033E6A4 is heap-allocated lazily (size 0x4274) the first time a pattern is edited.
//   So: p = *(0xC033E6A4); partArray = *(p + 0x4010); modType[part] = *(partArray + part*0x330 + 0x814).
//   The panel encoder clamp that stops at 72 is elsewhere (an indirect/computed value in the
//   OO menu framework); the setter itself already accepts 0..131 — which is why calling it
//   directly, or the edit-buffer path, could reach the extended types.
//
//   node scripts/modtype-probe.mjs [maxPart]      (default reads parts 0..3)

import midi from "@julusian/midi";

const H = [0xf0, 0x7d, 0x01, 0x02], END = 0xf7;
const enc7 = (d) => { const o = []; for (let i = 0; i < d.length; i += 7) { let k = 0; const e = Math.min(i + 7, d.length); for (let j = i; j < e; j++) if (d[j] & 0x80) k |= 1 << (j - i); o.push(k & 0x7f); for (let j = i; j < e; j++) o.push(d[j] & 0x7f); } return o; };
const dec7 = (d) => { const o = []; for (let i = 0; i < d.length;) { const k = d[i++]; for (let j = 0; j < 7 && i < d.length; j++) o.push(d[i++] | ((k >> j) & 1 ? 0x80 : 0)); } return o; };
const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const peekFrame = (addr, len) => [...H, 0x52, ...enc7([...le32(addr), ...le32(len)]), END];
const hx = (v) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(8, "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (d, h) => { for (let i = 0; i < d.getPortCount(); i++) if (d.getPortName(i).toLowerCase().includes(h)) return i; return -1; };

const out = new midi.Output(), inp = new midi.Input();
const oi = find(out, "electribe"), ii = find(inp, "electribe");
if (oi < 0 || ii < 0) { console.error("electribe port not found"); process.exit(1); }
let rx = []; inp.ignoreTypes(false, true, true); inp.on("message", (_d, m) => rx.push(Array.from(m)));
inp.openPort(ii); out.openPort(oi);

async function peek(addr, len, ms = 900) {
  rx = []; out.sendMessage(peekFrame(addr, len)); const t = Date.now();
  while (Date.now() - t < ms) { for (const m of rx) if (m[1] === 0x7d && m[4] === 0x52) return dec7(m.slice(5, m.length - 1)).slice(0, len); await sleep(8); }
  return null;
}
const rd32 = async (addr) => { const b = await peek(addr, 4); return b ? (b[0] | (b[1] << 8) | (b[2] << 16) | (b[3] << 24)) >>> 0 : null; };

const maxPart = Math.max(0, Math.min(15, (+process.argv[2] || 4) - 1));
const SINGLETON = 0xC033E6A4, EDIT_OFF = 0x400C, PART_STRIDE = 0x330, MODTYPE_OFF = 0x814;

(async () => {
  try {
    console.log("== A · pointer chain (read-only) ==");
    const alive = await peek(0xC0000000, 4);
    if (!alive) { console.log("0x52 does not answer — is the OTP stub build flashed and the device booted?"); return; }

    const p = await rd32(SINGLETON);
    console.log(`  *(${hx(SINGLETON)}) = ${p === null ? "—" : hx(p)}  (pattern-edit singleton)`);
    if (!p) { console.log("  singleton is 0 → open/edit a pattern on the device once, then rerun."); return; }
    if (p < 0xC0000000 || p >= 0xC2000000) { console.log("  ⚠ not a plausible DDR heap pointer — chain unconfirmed, do NOT build the call."); return; }

    const partArray = await rd32(p + EDIT_OFF + 4);
    console.log(`  *(${hx(p + EDIT_OFF + 4)}) = ${partArray === null ? "—" : hx(partArray)}  (part-parameter array base)`);
    if (!partArray || partArray < 0xC0000000 || partArray >= 0xC2000000) { console.log("  ⚠ implausible — chain unconfirmed."); return; }

    console.log("\n== B · current mod-type per part (compare with the panel) ==");
    for (let part = 0; part <= maxPart; part++) {
      const addr = (partArray + part * PART_STRIDE + MODTYPE_OFF) >>> 0;
      const b = await peek(addr, 1);
      console.log(`  part ${String(part + 1).padStart(2)} @${hx(addr)} : ${b ? `${b[0]} (display shows ${b[0] + 1})` : "—"}`);
    }
    console.log("  → if these match the mod type each part shows on the device, the chain is PROVEN.");

    console.log("\n== C · 2026-09-11 menu-limit candidate region (informational) ==");
    for (const a of [0xC00A7F60, 0xC00A7F80]) {
      const b = await peek(a, 24);
      console.log(`  ${hx(a)}: ${b ? b.map((x) => x.toString(16).padStart(2, "0")).join(" ") : "—"}`);
    }

    console.log("\n== next, by hand ==");
    console.log("  1. In TekkForge, set part 1 mod type to 72, then to 96, then 131, and press");
    console.log("     '▶ Anhören (Edit-Buffer)' each time (the existing, untested path).");
    console.log("  2. Rerun this probe after each: part 1's byte above should read 72 / 96 / 131.");
    console.log("  3. LISTEN: does the sound change between 71, 96 and 131? That is the real question.");
    console.log("     value lands + sounds distinct  → extended types work via the edit buffer, done.");
    console.log("     value lands + no audible change → the setter-call path (or the DSP mapping) is next.");
    console.log("     value never lands              → the edit-buffer path does not reach live part data.");
  } finally { out.closePort(); inp.closePort(); }
})();

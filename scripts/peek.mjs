// peek.mjs — allgemeines OTP-Memory-Peek (0x52, READ ONLY, max 64 Byte/Anfrage).
//   node scripts/peek.mjs <hexaddr> <len>            einzelne Adresse
//   node scripts/peek.mjs part3                      Diagnose-Preset (Part 3 + 13..16)
import midi from "@julusian/midi";
const H = [0xf0, 0x7d, 0x01, 0x02], END = 0xf7;
const enc7 = (d) => { const o = []; for (let i = 0; i < d.length; i += 7) { let k = 0; const e = Math.min(i + 7, d.length); for (let j = i; j < e; j++) if (d[j] & 0x80) k |= 1 << (j - i); o.push(k & 0x7f); for (let j = i; j < e; j++) o.push(d[j] & 0x7f); } return o; };
const dec7 = (d) => { const o = []; for (let i = 0; i < d.length;) { const k = d[i++]; for (let j = 0; j < 7 && i < d.length; j++) o.push(d[i++] | ((k >> j) & 1 ? 0x80 : 0)); } return o; };
const le32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
const peekFrame = (a, l) => [...H, 0x52, ...enc7([...le32(a), ...le32(l)]), END];
const hx = (v, n = 8) => "0x" + (v >>> 0).toString(16).toUpperCase().padStart(n, "0");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const find = (d, h) => { for (let i = 0; i < d.getPortCount(); i++) if (d.getPortName(i).toLowerCase().includes(h)) return i; return -1; };
const out = new midi.Output(), inp = new midi.Input();
const oi = find(out, "electribe"), ii = find(inp, "electribe");
if (oi < 0 || ii < 0) { console.error("electribe-Port nicht gefunden"); process.exit(1); }
let rx = []; inp.ignoreTypes(false, true, true); inp.on("message", (_d, m) => rx.push(Array.from(m)));
inp.openPort(ii); out.openPort(oi);
async function peek(addr, len, ms = 900) { rx = []; out.sendMessage(peekFrame(addr, len)); const t = Date.now(); while (Date.now() - t < ms) { for (const m of rx) if (m[1] === 0x7d && m[4] === 0x52) return dec7(m.slice(5, m.length - 1)).slice(0, len); await sleep(8); } return null; }
const b = (arr, o) => (arr ? arr[o] : undefined);
const VT = 0xc069ea44, VSTR = 0x148, MODBASE = 0xc06b2798, MODSTR = 0x330, MODOFF = 0x814;

(async () => {
  try {
    const alive = await peek(0xC0000000, 4);
    if (!alive) { console.log("0x52 antwortet nicht — laeuft die OTP-Firmware und ist sie der einzige MIDI-Client?"); return; }
    if (process.argv[2] === "part3" || !process.argv[2]) {
      console.log("== voice_t je Part (0xC069EA44 + p*0x148): +0x34 Osz-ID, +0x38 One-Shot, +0x2E Voice-Assign ==");
      for (const part of [0, 1, 2, 3, 12, 13, 14, 15]) {
        const base = VT + part * VSTR;
        const d = await peek(base + 0x2e, 0x30);   // 0x2e..0x5d
        const osc = d ? (d[0x34 - 0x2e] | (d[0x35 - 0x2e] << 8)) : null;
        console.log(`  Part ${String(part + 1).padStart(2)} @${hx(base)}: assign=${b(d, 0)} dspVoice=${b(d, 0x31 - 0x2e)} oscID=${osc} oneShot=${b(d, 0x38 - 0x2e)} (${d ? d.slice(0, 0x18).map(x => x.toString(16).padStart(2, "0")).join("") : "-"})`);
      }
      console.log("\n== Mod-Typ je Part (0xC06B2798 + p*0x330 + 0x814): Wert (Anzeige = Wert+1) ==");
      for (const part of [0, 1, 2, 3, 12, 13, 14, 15]) {
        const a = (MODBASE + part * MODSTR + MODOFF) >>> 0;
        const d = await peek(a, 4);
        console.log(`  Part ${String(part + 1).padStart(2)} @${hx(a)}: modType=${b(d, 0)} (Anzeige ${d ? d[0] + 1 : "-"})  [+1..+3: ${d ? d.slice(1).join(",") : "-"}]`);
      }
    } else {
      const addr = parseInt(process.argv[2], 16) >>> 0, len = Math.min(64, +(process.argv[3] || 16));
      const d = await peek(addr, len);
      console.log(`${hx(addr)} (${len}B): ${d ? d.map(x => x.toString(16).padStart(2, "0")).join(" ") : "KEINE ANTWORT"}`);
    }
  } finally { out.closePort(); inp.closePort(); }
})();

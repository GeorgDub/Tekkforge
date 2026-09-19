// Empfangs-Test: sendet harmlose Abfragen und zeigt ALLE empfangenen MIDI-Frames.
// Klaert, ob @julusian/midi SysEx-Antworten sieht (unabhaengig vom Bootloader).
import midi from "@julusian/midi";
const portHint = "electribe";
const out = new midi.Output(), inp = new midi.Input();
const find = (d) => { for (let i=0;i<d.getPortCount();i++) if (d.getPortName(i).toLowerCase().includes(portHint)) return i; return -1; };
const oi = find(out), ii = find(inp);
if (oi<0||ii<0){ console.error("Port nicht gefunden"); process.exit(1); }
console.log(`Port OUT[${oi}] ${out.getPortName(oi)} | IN[${ii}] ${inp.getPortName(ii)}`);
const hex = (a)=>Array.from(a).map(b=>b.toString(16).padStart(2,"0")).join(" ");
let n=0;
inp.ignoreTypes(false, true, true);
inp.on("message",(_dt,msg)=>{ n++; console.log(`  RX[${n}] (${msg.length}B): ${hex(msg).slice(0,80)}`); });
inp.openPort(ii); out.openPort(oi);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
(async()=>{
  console.log("\n1) Universal Device Inquiry (F0 7E 7F 06 01 F7)…");
  out.sendMessage([0xF0,0x7E,0x7F,0x06,0x01,0xF7]); await sleep(1000);
  console.log("2) KORG Search Request (F0 42 50 00 00 F7)…");
  out.sendMessage([0xF0,0x42,0x50,0x00,0x00,0xF7]); await sleep(1000);
  console.log("3) OTP-Identity (F0 7D 01 02 01 00 00 00 00 F7) — falls schon Coexist laeuft…");
  out.sendMessage([0xF0,0x7D,0x01,0x02,0x01,0x00,0x00,0x00,0x00,0xF7]); await sleep(1000);
  console.log(`\nGesamt empfangen: ${n} Frames.`);
  if(n===0) console.log("→ KEIN Empfang: entweder Port-Richtung falsch, oder das Geraet sendet nichts zurueck.");
  else console.log("→ Empfang funktioniert.");
  out.closePort(); inp.closePort();
})();

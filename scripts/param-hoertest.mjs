// Hörtest an Part 2 (Draht 1): Cutoff, Resonance, Osc-Pitch als PARAM SET.
import midi from "@julusian/midi";
const H=[0xf0,0x7d,0x01,0x02],END=0xf7;
const xor=(p)=>{let c=0;for(const b of p)c^=b;return c&0x7f;};
const frame=(cmd,sub,p)=>[...H,cmd,sub,(p.length>>7)&0x7f,p.length&0x7f,...p,xor(p),END];
const enc14=(w)=>{const v=w&0x3fff;return [(v>>7)&0x7f,v&0x7f];};
const PART=1; // Part 2 = Draht 1
const set=(lo,wert)=>frame(0x02,0x00,[PART,0x00,lo,...enc14(wert)]);
const CUTOFF=0x02,RESO=0x03,PITCH=0x01;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(); const oi=find(out,"electribe"); if(oi<0){console.log("Port?");process.exit(1);} out.openPort(oi);
const ts=()=>new Date().toLocaleTimeString();
async function step(txt,f,ms=2600){console.log(`[${ts()}] ${txt}`);out.sendMessage(f);await sleep(ms);}
(async()=>{
  console.log("=== Hörtest Part 2 — achte auf den Klang ===\n--- CUTOFF (Filter auf/zu) ---");
  await step("Cutoff 127 (weit offen, hell)", set(CUTOFF,127));
  await step("Cutoff 15  (fast zu, dumpf)",   set(CUTOFF,15));
  await step("Cutoff 127 (wieder hell)",      set(CUTOFF,127));
  await step("Cutoff 55  (Mitte)",            set(CUTOFF,55));
  console.log("--- RESONANCE (Filterschärfe) ---");
  await step("Resonance 125 (scharf/pfeifend)", set(RESO,125));
  await step("Resonance 0   (weich)",           set(RESO,0));
  console.log("--- OSC-PITCH (Tonhöhe, signed) ---");
  await step("Osc-Pitch +12 (Oktave hoch)",  set(PITCH,12));
  await step("Osc-Pitch 0   (normal)",       set(PITCH,0));
  await step("Osc-Pitch -12 (Oktave runter)",set(PITCH,-12));
  await step("Osc-Pitch 0   (normal)",       set(PITCH,0));
  console.log("\n=== fertig. Was hast du gehört? Cutoff / Resonance / Osc-Pitch je ✔/✘ ===");
  out.closePort();
})();

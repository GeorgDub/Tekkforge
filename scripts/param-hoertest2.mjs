import midi from "@julusian/midi";
const H=[0xf0,0x7d,0x01,0x02],END=0xf7;
const xor=(p)=>{let c=0;for(const b of p)c^=b;return c&0x7f;};
const frame=(cmd,sub,p)=>[...H,cmd,sub,(p.length>>7)&0x7f,p.length&0x7f,...p,xor(p),END];
const enc14=(w)=>{const v=w&0x3fff;return [(v>>7)&0x7f,v&0x7f];};
const PART=1; // Part 2
const set=(lo,w)=>frame(0x02,0x00,[PART,0x00,lo,...enc14(w)]);
const CUTOFF=0x02,RESO=0x03,PITCH=0x01;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(); const oi=find(out,"electribe"); if(oi<0){console.log("Port?");process.exit(1);} out.openPort(oi);
async function sweep(name,lo,werte,stepMs=550){process.stdout.write(`  ${name}: `);for(const w of werte){process.stdout.write(`${w} `);out.sendMessage(set(lo,w));await sleep(stepMs);}console.log("");}
(async()=>{
  const cutDown=[127,105,85,60,40,20,5];
  const resDown=[125,100,75,50,25,0];
  const pitchUp=[-63,-48,-32,-16,0,16,32,48,63];
  console.log("=== CUTOFF (hoch → runter), 2x ===");
  for(let r=1;r<=2;r++){console.log(` Durchlauf ${r}:`);await sweep("Cutoff",CUTOFF,cutDown);await sleep(900);}
  out.sendMessage(set(CUTOFF,55)); await sleep(400); // Mitte, damit Resonance hörbar
  console.log("=== RESONANCE (hoch → runter), 2x — Cutoff steht auf Mitte ===");
  for(let r=1;r<=2;r++){console.log(` Durchlauf ${r}:`);await sweep("Resonance",RESO,resDown);await sleep(900);}
  out.sendMessage(set(RESO,0)); await sleep(300);
  out.sendMessage(set(CUTOFF,127)); await sleep(300); // Filter offen fuer Pitch
  console.log("=== OSC-PITCH (-63 → +63), 2x ===");
  for(let r=1;r<=2;r++){console.log(` Durchlauf ${r}:`);await sweep("Osc-Pitch",PITCH,pitchUp);await sleep(900);}
  out.sendMessage(set(PITCH,0));
  console.log("\n=== fertig — Cutoff / Resonance / Osc-Pitch je ✔/✘ ===");
  out.closePort();
})();

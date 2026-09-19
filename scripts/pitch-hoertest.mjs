import midi from "@julusian/midi";
const H=[0xf0,0x7d,0x01,0x02],END=0xf7;
const xor=(p)=>{let c=0;for(const b of p)c^=b;return c&0x7f;};
const frame=(cmd,sub,p)=>[...H,cmd,sub,(p.length>>7)&0x7f,p.length&0x7f,...p,xor(p),END];
const enc14=(w)=>{const v=w&0x3fff;return [(v>>7)&0x7f,v&0x7f];};
const PART=1;
const set=(lo,w)=>frame(0x02,0x00,[PART,0x00,lo,...enc14(w)]);
const CUTOFF=0x02,RESO=0x03,PITCH=0x01;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(); const oi=find(out,"electribe"); if(oi<0){console.log("Port?");process.exit(1);} out.openPort(oi);
(async()=>{
  console.log("Filter ganz oeffnen fuer klaren Ton…");
  out.sendMessage(set(CUTOFF,127)); await sleep(700);
  out.sendMessage(set(RESO,0));     await sleep(1200);
  const stufen=[-63,-42,-21,0,21,42,63];
  for(let r=1;r<=2;r++){
    console.log(`=== Osc-Pitch Durchlauf ${r} (-63 → +63) ===`);
    for(const w of stufen){ console.log(`  Pitch ${w>0?"+":""}${w}`); out.sendMessage(set(PITCH,w)); await sleep(900); }
    out.sendMessage(set(PITCH,0)); await sleep(1200);
  }
  console.log("\n=== fertig — Osc-Pitch hoch/runter hoerbar? ✔/✘ ===");
  out.closePort();
})();

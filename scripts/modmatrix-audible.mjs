// Modmatrix hörbar: LFO1_SIN → Cutoff (CC74) auf Part 2 (0-idx 1), moduliert die laufende Part.
import midi from "@julusian/midi"; import fs from "node:fs";
const H=[0xf0,0x7d,0x01,0x02],END=0xf7;
const enc7=(d)=>{const o=[];for(let i=0;i<d.length;i+=7){let k=0;const e=Math.min(i+7,d.length);for(let j=i;j<e;j++)if(d[j]&0x80)k|=1<<(j-i);o.push(k&0x7f);for(let j=i;j<e;j++)o.push(d[j]&0x7f);}return o;};
const xor=(p)=>p.reduce((a,b)=>a^b,0)&0x7f;
const fr=(c,s,p)=>[...H,c,s,(p.length>>7)&0x7f,p.length&0x7f,...p,xor(p),END];
const hi7=v=>(v>>7)&0x7f,lo7=v=>v&0x7f;
const chunkFrame=(id,off,raw)=>fr(0x05,0x02,[id&0x7f,(off>>14)&0x7f,(off>>7)&0x7f,off&0x7f,...enc7(raw)]);
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(),inp=new midi.Input();out.openPort(find(out,"electribe"));inp.openPort(find(inp,"electribe"));
let rx=[];inp.ignoreTypes(false,true,true);inp.on("message",(_d,m)=>rx.push([...m]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dec=(m)=>{const p=m.slice(8,m.length-2);const v=[];for(let i=1;i+4<=p.length;i+=5){const h=p[i];v.push(((p[i+1]|((h&1)<<7))|((p[i+2]|((h&2)<<6))<<8)|((p[i+3]|((h&4)<<5))<<16)|((p[i+4]|((h&8)<<4))<<24))>>>0);}return v;};
async function ack(f,ms=1500){rx=[];out.sendMessage(f);const t=Date.now();const a=[];const seen=new Set();while(Date.now()-t<ms){for(let k=0;k<rx.length;k++){const m=rx[k];if(!seen.has(k)&&m[1]===0x7d&&m[4]===0x05&&m[5]===0x03){seen.add(k);a.push({status:m[8]});}}await sleep(8);}return a;}
async function status(){rx=[];out.sendMessage(fr(0x04,0x04,[]));const t=Date.now();while(Date.now()-t<1500){for(const m of rx)if(m[1]===0x7d&&m[4]===0x04&&m[5]===0x7f)return dec(m);await sleep(8);}return null;}
const cb=(id,cbi,args)=>fr(0x05,0x05,[id&0x7f,cbi&0x7f,...enc7(args)]);
const nrpn=(id,msb,lsb,val)=>cb(id,1,[msb,lsb,val&0xff,(val>>8)&0xff]);
const PART=+(process.argv[2]??1);         // 0-idx; 1 = Geräte-Part 2
(async()=>{
 try{
  await ack(fr(0x05,0x07,[0x7f]));
  const bin=Array.from(fs.readFileSync("G:/IdeaProjects/Omnitribe/build/modules_abs/modmatrix.bin"));
  const id=bin[6]|(bin[7]<<8);
  for(let o=0;o<bin.length;o+=180){const a=await ack(chunkFrame(id,o,bin.slice(o,o+180)),1200);if(!a.length||a[0].status!==0){console.log("chunk fail @"+o);return;}}
  const c=await ack(fr(0x05,0x04,[id]));
  console.log(`modmatrix (id ${id}) commit: ${c.map(x=>"0x"+x.status.toString(16).padStart(2,"0")).join("→")}`);
  const lsb=((PART&0x0f)<<4)|0;             // Part, Slot 0
  await ack(nrpn(id,0x13,lsb,1));           // Source LFO1_SIN
  await ack(nrpn(id,0x14,lsb,4));           // Target FILTER_CUTOFF (CC74)
  await ack(nrpn(id,0x15,lsb,100));         // Depth
  // Audio-Teiler sicher aktiv
  out.sendMessage(fr(0x04,0x05,[hi7(6),lo7(6),hi7(21),lo7(21),1]));await sleep(50);
  const s0=await status();
  console.log(`10 s: LFO moduliert Cutoff von Geräte-Part ${PART+1} — der Filter sollte HÖRBAR auf- und zufahren ...`);
  const tEnd=Date.now()+10000;while(Date.now()<tEnd){out.sendMessage(fr(0x05,0x06,[]));await sleep(20);}
  const s1=await status();
  // Cutoff auf einen mittleren Wert zuruecksetzen (CC ist absolut)
  out.sendMessage([0xB0|(PART&0x0f),74,100]);
  if(s0&&s1)console.log(`\naudio_ticks +${s1[4]-s0[4]}, egress_frames +${s1[8]-s0[8]} (CC-74-Injektionen), dropped +${s1[9]-s0[9]}, ticks_skipped ${s1[12]}\nCutoff auf Part ${PART+1} auf 100 zurueckgesetzt.`);
 } finally{out.closePort();inp.closePort();}
})();

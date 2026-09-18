// Arp hörbar OHNE Ingress: Held-Noten per Host-Callback (SUB 0x05 cb=4), Timer treibt die Clock, Drain spielt.
import midi from "@julusian/midi"; import fs from "node:fs";
const H=[0xf0,0x7d,0x01,0x02],END=0xf7;
const enc7=(d)=>{const o=[];for(let i=0;i<d.length;i+=7){let k=0;const e=Math.min(i+7,d.length);for(let j=i;j<e;j++)if(d[j]&0x80)k|=1<<(j-i);o.push(k&0x7f);for(let j=i;j<e;j++)o.push(d[j]&0x7f);}return o;};
const dec7=(d)=>{const o=[];for(let i=0;i<d.length;){const k=d[i++];for(let j=0;j<7&&i<d.length;j++)o.push(d[i++]|((k>>j)&1?0x80:0));}return o;};
const xor=(p)=>p.reduce((a,b)=>a^b,0)&0x7f;
const fr=(c,s,p)=>[...H,c,s,(p.length>>7)&0x7f,p.length&0x7f,...p,xor(p),END];
const hi7=v=>(v>>7)&0x7f,lo7=v=>v&0x7f;
const chunkFrame=(id,off,raw)=>fr(0x05,0x02,[id&0x7f,(off>>14)&0x7f,(off>>7)&0x7f,off&0x7f,...enc7(raw)]);
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(),inp=new midi.Input();out.openPort(find(out,"electribe"));inp.openPort(find(inp,"electribe"));
let rx=[];inp.ignoreTypes(false,true,true);inp.on("message",(_d,m)=>rx.push([...m]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const dec=(m)=>{const p=m.slice(8,m.length-2);const v=[];for(let i=1;i+4<=p.length;i+=5){const h=p[i];v.push(((p[i+1]|((h&1)<<7))|((p[i+2]|((h&2)<<6))<<8)|((p[i+3]|((h&4)<<5))<<16)|((p[i+4]|((h&8)<<4))<<24))>>>0);}return v;};
async function ack(f,ms=1500){rx=[];out.sendMessage(f);const t=Date.now();const a=[];const seen=new Set();while(Date.now()-t<ms){for(let k=0;k<rx.length;k++){const m=rx[k];if(!seen.has(k)&&m[1]===0x7d&&m[4]===0x05&&m[5]===0x03){seen.add(k);a.push({status:m[8],x:m[10]});}}await sleep(8);}return a;}
async function status(){rx=[];out.sendMessage(fr(0x04,0x04,[]));const t=Date.now();while(Date.now()-t<1500){for(const m of rx)if(m[1]===0x7d&&m[4]===0x04&&m[5]===0x7f)return dec(m);await sleep(8);}return null;}
const cb=(id,cbi,args)=>fr(0x05,0x05,[id&0x7f,cbi&0x7f,...enc7(args)]);
(async()=>{
 try{
  await ack(fr(0x05,0x07,[0x7f]));                    // unplace all
  const bin=Array.from(fs.readFileSync("G:/IdeaProjects/Omnitribe/build/modules_abs/arpeggiator.bin"));
  const id=bin[6]|(bin[7]<<8);
  for(let o=0;o<bin.length;o+=180){const a=await ack(chunkFrame(id,o,bin.slice(o,o+180)),1200);if(!a.length||a[0].status!==0){console.log("chunk fail @"+o);return;}}
  const c=await ack(fr(0x05,0x04,[id]));
  console.log(`arpeggiator (id ${id}) commit: ${c.map(x=>"0x"+x.status.toString(16).padStart(2,"0")).join("→")}`);
  // Held-Akkord per Callback on_note_on (cb=4): ch0, Noten 60/64/67
  for(const n of [60,64,67]){await ack(cb(id,4,[0,n,100]));await sleep(30);}
  console.log("Akkord 60/64/67 auf ch0 in den Arp gelegt (per Callback).");
  // Timer-Clock aktivieren: div_clock=21 (~48/s), src=timer
  out.sendMessage(fr(0x04,0x05,[0,0,hi7(21),lo7(21),1]));await sleep(50);
  const s0=await status();
  console.log("6 s Drain-Schleife — der Arp sollte auf Part 1 HÖRBAR laufen (Part 1 braucht einen Klang) ...");
  const tEnd=Date.now()+6000;let n=0;
  while(Date.now()<tEnd){out.sendMessage(fr(0x05,0x06,[]));n++;await sleep(20);}
  await sleep(200);
  // Noten wieder loslassen
  for(const nn of [60,64,67]){await ack(cb(id,5,[0,nn]));await sleep(20);}
  for(let i=0;i<8;i++){out.sendMessage(fr(0x05,0x06,[]));await sleep(20);}
  const s1=await status();
  if(s0&&s1)console.log(`\nclock_ticks +${s1[5]-s0[5]}, egress_frames +${s1[8]-s0[8]} (injizierte Noten), dropped +${s1[9]-s0[9]}, refused +${s1[10]-s0[10]}, ticks_skipped ${s1[12]}`);
 } finally{out.closePort();inp.closePort();}
})();

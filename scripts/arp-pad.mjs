// arp-pad.mjs — U2-Test: treibt eine ECHT gehaltene Pad-Note den Arp?
// Kein Callback, kein Host-Drain. Der interne Note-Kern-Hook 0xC00913EC faengt
// Pad-Noten (in 2a bewiesen) -> on_note_on -> Arp; die Hauptschleifen-Pumpe
// spielt die Arp-Noten. Voraussetzung: arppump-Firmware geflasht.
//
//   node scripts/arp-pad.mjs           (Setup + 20 s Live-Monitor — HALTE eine Pad-Note auf Part 1)
//   node scripts/arp-pad.mjs monitor   (nur Monitor, ohne neu aufzusetzen)
import midi from "@julusian/midi"; import fs from "node:fs";
const H=[0xf0,0x7d,0x01,0x02], END=0xf7;
const enc7=(d)=>{const o=[];for(let i=0;i<d.length;i+=7){let k=0;const e=Math.min(i+7,d.length);for(let j=i;j<e;j++)if(d[j]&0x80)k|=1<<(j-i);o.push(k&0x7f);for(let j=i;j<e;j++)o.push(d[j]&0x7f);}return o;};
const xor=(p)=>p.reduce((a,b)=>a^(b&0x7f),0)&0x7f;
const fr=(c,s,p=[])=>[...H,c,s,(p.length>>7)&0x7f,p.length&0x7f,...p,xor(p),END];
const hi7=v=>(v>>7)&0x7f, lo7=v=>v&0x7f;
const chunkFrame=(id,off,raw)=>fr(0x05,0x02,[id&0x7f,(off>>14)&0x7f,(off>>7)&0x7f,off&0x7f,...enc7(raw)]);
const cb=(id,cbi,args)=>fr(0x05,0x05,[id&0x7f,cbi&0x7f,...enc7(args)]);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(),inp=new midi.Input();
if(find(out,"electribe")<0||find(inp,"electribe")<0){console.error("electribe-Port nicht gefunden");process.exit(1);}
out.openPort(find(out,"electribe"));inp.openPort(find(inp,"electribe"));
let rx=[];inp.ignoreTypes(false,true,true);inp.on("message",(_d,m)=>rx.push([...m]));
function dec(m){const p=m.slice(8,m.length-2),v=[];for(let i=1;i+4<p.length;i+=5){const hi=p[i];v.push(((p[i+1]|((hi&1)<<7))|((p[i+2]|(((hi>>1)&1)<<7))<<8)|((p[i+3]|(((hi>>2)&1)<<7))<<16)|((p[i+4]|(((hi>>3)&1)<<7))<<24))>>>0);}return v;}
async function cmd04(sub,payload=[],ms=1200){rx=[];out.sendMessage(fr(0x04,sub,payload));const t=Date.now();while(Date.now()-t<ms){for(const m of rx)if(m[1]===0x7d&&m[4]===0x04&&m[5]===0x7f)return dec(m);await sleep(8);}return null;}
async function ack(f,ms=1500){rx=[];out.sendMessage(f);const t=Date.now();const a=[];const seen=new Set();while(Date.now()-t<ms){for(let k=0;k<rx.length;k++){const m=rx[k];if(!seen.has(k)&&m[1]===0x7d&&m[4]===0x05&&m[5]===0x03){seen.add(k);a.push({status:m[8]});}}await sleep(8);}return a;}
async function monitor(secs){
  console.log(`\n>>> HALTE JETZT eine Pad-Note auf Part 1 (und wieder loslassen zum Stoppen). ${secs}s Monitor:`);
  let prev=null;
  const tEnd=Date.now()+secs*1000;
  while(Date.now()<tEnd){
    const v=await cmd04(0x0a);
    if(v){const [eg,,,trip,,wr,,non,pump]=v; const d=prev===null?0:eg-prev; prev=eg;
      console.log(`  egress=${eg} (+${d}/s)  note_on=${non}  pump_calls=${pump}  rate_tripped=${trip}`);}
    await sleep(1000);
  }
}
(async()=>{
 try{
  if(process.argv[2]==="monitor"){await monitor(20);return;}
  await ack(fr(0x05,0x07,[0x7f]));                       // unplace all
  const inst=await cmd04(0x02,[21,0,0,hi7(21),lo7(21),1]);
  console.log("install:",inst?(inst.length===1?`abgelehnt 0x${inst[0].toString(16)} (schon installiert — ok)`:`irq ${inst[0]}`):"KEIN REPORT");
  await cmd04(0x05,[0,0,hi7(21),lo7(21),1]);             // div_clock=21, src=timer
  const bin=Array.from(fs.readFileSync("G:/IdeaProjects/Omnitribe/build/modules_abs/arpeggiator.bin"));
  const id=bin[6]|(bin[7]<<8);
  for(let o=0;o<bin.length;o+=180){const a=await ack(chunkFrame(id,o,bin.slice(o,o+180)),1200);if(!a.length||a[0].status!==0){console.log("chunk fail @"+o);return;}}
  const c=await ack(fr(0x05,0x04,[id]));
  console.log(`arpeggiator (id ${id}) commit: ${c.map(x=>"0x"+x.status.toString(16).padStart(2,"0")).join("→")} — KEINE Callback-Noten, nur echtes Pad.`);
  await monitor(20);
  console.log("\n=> Steigt egress/s waehrend du haeltst und faellt auf 0 beim Loslassen, treibt das echte Pad den Arp");
  console.log("   ueber den Note-Kern-Hook 0xC00913EC — U2 ohne TX-Hook geloest.");
 } finally{out.closePort();inp.closePort();}
})();

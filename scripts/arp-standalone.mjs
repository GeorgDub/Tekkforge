// arp-standalone.mjs — Stufe 2b(2): Arp klingt OHNE Host-Drain. Beweist die
// Hauptschleifen-Pumpe (Hook @DispatchLcdState): Timer treibt die Clock, der
// Arp schiebt Noten in die Mailbox, und die UI-Hauptschleife (nicht der Host)
// leert sie. Voraussetzung: SYSTEM_coexist_MOD132_EXEC_arppump_sprint188.vsb.
//
//   node scripts/arp-standalone.mjs            (install, laden, halten, 6 s NUR warten)
//   node scripts/arp-standalone.mjs guard      (nur Telemetrie SUB 0x0A lesen)
import midi from "@julusian/midi"; import fs from "node:fs";
const H = [0xf0,0x7d,0x01,0x02], END = 0xf7;
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
function decReport(m){const p=m.slice(8,m.length-2),v=[];for(let i=1;i+4<p.length;i+=5){const hi=p[i];v.push(((p[i+1]|((hi&1)<<7))|((p[i+2]|(((hi>>1)&1)<<7))<<8)|((p[i+3]|(((hi>>2)&1)<<7))<<16)|((p[i+4]|(((hi>>3)&1)<<7))<<24))>>>0);}return {sub:p[0],vals:v};}
async function cmd04(sub,payload=[],ms=1500){rx=[];out.sendMessage(fr(0x04,sub,payload));const t=Date.now();while(Date.now()-t<ms){for(const m of rx)if(m[1]===0x7d&&m[4]===0x04&&m[5]===0x7f)return decReport(m);await sleep(8);}return null;}
async function ack(f,ms=1500){rx=[];out.sendMessage(f);const t=Date.now();const a=[];const seen=new Set();while(Date.now()-t<ms){for(let k=0;k<rx.length;k++){const m=rx[k];if(!seen.has(k)&&m[1]===0x7d&&m[4]===0x05&&m[5]===0x03){seen.add(k);a.push({status:m[8]});}}await sleep(8);}return a;}
async function guard(tag=""){
  const r=await cmd04(0x0a);
  if(!r){console.log("KEIN REPORT — laeuft die arppump-Firmware?");return null;}
  const [frames,refused,dropped,tripped,rate,wr,ticks,noteon,pump,draining]=r.vals;
  console.log(`${tag} egress_frames=${frames} refused=${refused} dropped=${dropped} rate_tripped=${tripped} inj_wr=${wr} ticks=${ticks} pump_calls=${pump} draining=${draining}`);
  return r.vals;
}
(async()=>{
 try{
  if(process.argv[2]==="guard"){await guard("");return;}
  await ack(fr(0x05,0x07,[0x7f]));                                  // unplace all
  // Periodik installieren: irq 21 (Timer0), div_audio=0, div_clock=21, src=timer(1)
  const inst=await cmd04(0x02,[21,0,0,hi7(21),lo7(21),1]);
  console.log("install:",inst?(inst.vals.length===1?`abgelehnt 0x${inst.vals[0].toString(16)} (evtl. schon installiert — ok)`:`irq ${inst.vals[0]} orig 0x${inst.vals[1].toString(16)}`):"KEIN REPORT");
  await cmd04(0x05,[0,0,hi7(21),lo7(21),1]);                        // sicherstellen: div_clock=21, src=1
  const bin=Array.from(fs.readFileSync("G:/IdeaProjects/Omnitribe/build/modules_abs/arpeggiator.bin"));
  const id=bin[6]|(bin[7]<<8);
  for(let o=0;o<bin.length;o+=180){const a=await ack(chunkFrame(id,o,bin.slice(o,o+180)),1200);if(!a.length||a[0].status!==0){console.log("chunk fail @"+o);return;}}
  const c=await ack(fr(0x05,0x04,[id]));
  console.log(`arpeggiator (id ${id}) commit: ${c.map(x=>"0x"+x.status.toString(16).padStart(2,"0")).join("→")}`);
  for(const n of [60,64,67]){await ack(cb(id,4,[0,n,100]));await sleep(30);}   // Held-Akkord per Callback on_note_on
  console.log("Akkord 60/64/67 in den Arp gelegt. KEIN Host-Drain jetzt — nur die Hauptschleife pumpt.");
  const s0=await guard("baseline:");
  console.log("6 s NUR warten (kein Drain vom Host) — der Arp sollte auf Part 1 HÖRBAR laufen ...");
  await sleep(6000);
  const s1=await guard("nach 6s :");
  // Noten loslassen
  for(const n of [60,64,67]){await ack(cb(id,5,[0,n]));await sleep(20);}
  if(s0&&s1){
    const dPump=s1[8]-s0[8], dEg=s1[0]-s0[0], dTick=s1[6]-s0[6];
    console.log(`\n=> pump_calls +${dPump} (Hauptschleife tickte im Task-Kontext), egress_frames +${dEg} (injizierte Arp-Noten OHNE Host), clock_ticks +${dTick}, rate_tripped=${s1[3]}`);
    if(dPump>0&&dEg>0&&s1[3]===0) console.log("=> STANDALONE-PUMPE BEWIESEN: der Arp klingt ohne Host-Drain.");
    else if(dPump===0) console.log("=> pump_calls stieg NICHT — DispatchLcdState-Hook feuert nicht (falscher Kandidat / Kontext).");
    else if(dEg===0) console.log("=> Pumpe tickt, aber keine Injektion — Arp tickte nicht (clock_ticks?) oder Mailbox leer.");
  }
 } finally{out.closePort();inp.closePort();}
})();

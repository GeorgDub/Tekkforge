// multi-module.mjs — ZWEI Module gleichzeitig: Chord auf Part 1, Arp auf Part 3.
// Beide werden platziert; otp_ev_note ruft JEDES Modul, jedes filtert per Kanal-Enable
// (Chord enabled[0], Arp enabled[] mit ch0 AUS). Braucht arppump-Firmware + das NEUE
// arpeggiator.bin (enabled, NRPN pid 0x06).
//
//   node scripts/multi-module.mjs        (beide laden+konfigurieren, 25 s Monitor)
import midi from "@julusian/midi"; import fs from "node:fs";
const H=[0xf0,0x7d,0x01,0x02],END=0xf7;
const enc7=(d)=>{const o=[];for(let i=0;i<d.length;i+=7){let k=0;const e=Math.min(i+7,d.length);for(let j=i;j<e;j++)if(d[j]&0x80)k|=1<<(j-i);o.push(k&0x7f);for(let j=i;j<e;j++)o.push(d[j]&0x7f);}return o;};
const dec7=(d)=>{const o=[];for(let i=0;i<d.length;){const k=d[i++];for(let j=0;j<7&&i<d.length;j++)o.push(d[i++]|((k>>j)&1?0x80:0));}return o;};
const le32=(v)=>[v&0xff,(v>>>8)&0xff,(v>>>16)&0xff,(v>>>24)&0xff];
const xor=(p)=>p.reduce((a,b)=>a^(b&0x7f),0)&0x7f;
const fr=(c,s,p=[])=>[...H,c,s,(p.length>>7)&0x7f,p.length&0x7f,...p,xor(p),END];
const hi7=v=>(v>>7)&0x7f, lo7=v=>v&0x7f;
const chunkFrame=(id,off,raw)=>fr(0x05,0x02,[id&0x7f,(off>>14)&0x7f,(off>>7)&0x7f,off&0x7f,...enc7(raw)]);
const cb=(id,cbi,args)=>fr(0x05,0x05,[id&0x7f,cbi&0x7f,...enc7(args)]);
const nrpn=(id,msb,lsb,val)=>cb(id,1,[msb,lsb,val&0xff,(val>>8)&0xff]);
const peekFrame=(a,l)=>[...H,0x52,...enc7([...le32(a),...le32(l)]),END];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(),inp=new midi.Input();
if(find(out,"electribe")<0||find(inp,"electribe")<0){console.error("electribe-Port nicht gefunden");process.exit(1);}
out.openPort(find(out,"electribe"));inp.openPort(find(inp,"electribe"));
let rx=[];inp.ignoreTypes(false,true,true);inp.on("message",(_d,m)=>rx.push([...m]));
function dec(m){const p=m.slice(8,m.length-2),v=[];for(let i=1;i+4<p.length;i+=5){const hi=p[i];v.push(((p[i+1]|((hi&1)<<7))|((p[i+2]|(((hi>>1)&1)<<7))<<8)|((p[i+3]|(((hi>>2)&1)<<7))<<16)|((p[i+4]|(((hi>>3)&1)<<7))<<24))>>>0);}return v;}
async function cmd04(sub,payload=[],ms=1200){rx=[];out.sendMessage(fr(0x04,sub,payload));const t=Date.now();while(Date.now()-t<ms){for(const m of rx)if(m[1]===0x7d&&m[4]===0x04&&m[5]===0x7f)return dec(m);await sleep(8);}return null;}
async function ack(f,ms=1500){rx=[];out.sendMessage(f);const t=Date.now();const a=[];const seen=new Set();while(Date.now()-t<ms){for(let k=0;k<rx.length;k++){const m=rx[k];if(!seen.has(k)&&m[1]===0x7d&&m[4]===0x05&&m[5]===0x03){seen.add(k);a.push({status:m[8]});}}await sleep(8);}return a;}
async function peek(a,l,ms=800){rx=[];out.sendMessage(peekFrame(a,l));const t=Date.now();while(Date.now()-t<ms){for(const m of rx)if(m[1]===0x7d&&m[4]===0x52)return dec7(m.slice(5,m.length-1)).slice(0,l);await sleep(8);}return null;}
const rd32=async(a)=>{const b=await peek(a,4);return b?(b[0]|(b[1]<<8)|(b[2]<<16)|(b[3]<<24))>>>0:null;};
async function load(name){
  const bin=Array.from(fs.readFileSync(`G:/IdeaProjects/Omnitribe/build/modules_abs/${name}.bin`));
  const id=bin[6]|(bin[7]<<8);
  for(let o=0;o<bin.length;o+=180){const a=await ack(chunkFrame(id,o,bin.slice(o,o+180)),1200);if(!a.length||a[0].status!==0){console.log(`${name} chunk fail @${o}`);return null;}}
  const c=await ack(fr(0x05,0x04,[id]));
  console.log(`${name} (id ${id}) commit: ${c.map(x=>"0x"+x.status.toString(16).padStart(2,"0")).join("→")}`);
  return id;
}
(async()=>{
 try{
  await ack(fr(0x05,0x07,[0x7f]));                       // unplace all
  const inst=await cmd04(0x02,[21,0,0,hi7(21),lo7(21),1]);
  console.log("periodik:",inst?(inst.length===1?`0x${inst[0].toString(16)} (schon installiert — ok)`:`irq ${inst[0]}`):"KEIN REPORT");
  await cmd04(0x05,[0,0,hi7(21),lo7(21),1]);
  const chordId=await load("chord"); if(chordId===null)return;
  const arpId=await load("arpeggiator"); if(arpId===null)return;
  // Chord auf Part 1 (ch0): Maj, root=gespielte Note, aktiv.
  nrpn(chordId,0x1e,(0<<4)|0x00,0);   await sleep(20);   // chord_type = Maj
  nrpn(chordId,0x1e,(0<<4)|0x02,200); await sleep(20);   // root_override>127 -> played
  nrpn(chordId,0x1e,(0<<4)|0x01,0);   await sleep(20);   // stagger 0
  nrpn(chordId,0x1e,(0<<4)|0x03,1);   await sleep(20);   // enabled Part 1
  // Arp: ch0 AUS (Chord besitzt Part 1), ch2 (Part 3) bleibt aktiv (Default 1).
  nrpn(arpId,0x16,(0<<4)|0x06,0);     await sleep(20);   // enabled[ch0] = 0
  nrpn(arpId,0x16,(2<<4)|0x06,1);     await sleep(20);   // enabled[ch2] = 1 (Part 3)
  console.log("Chord auf Part 1 (Maj, root=gespielt), Arp auf Part 3 (ch0 des Arp deaktiviert).");
  console.log("\n>>> Spiel Akkorde/Noten auf PART 1 (Chord-Dreiklang) UND halte eine Note auf PART 3 (Arp).");
  const cg=await rd32((chordId!==null? (0xC2000000+chordId*0x10000):0)+0x24);
  let prev=null;const tEnd=Date.now()+25000;
  while(Date.now()<tEnd){
    const v=await cmd04(0x0a);
    let hn0="?";
    if(cg){const h=await peek(cg+1252,1);hn0=h?h[0]:"?";}   // chord held_n[Part1]
    if(v){const [eg,,,trip,,,,,pump]=v;const d=prev===null?0:eg-prev;prev=eg;
      console.log(`  egress=${eg} (+${d}/s)  chord.held_n[P1]=${hn0}  pump=${pump}  rate_tripped=${trip}`);}
    await sleep(1000);
  }
  console.log("\n=> Hoerst du auf Part 1 den Chord-Dreiklang UND auf Part 3 den Arp gleichzeitig,");
  console.log("   laufen zwei Module parallel — jedes auf seinem Part (Kanal-Enable trennt sie).");
 } finally{out.closePort();inp.closePort();}
})();

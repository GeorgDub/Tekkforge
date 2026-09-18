// prov-probe.mjs — PROVENIENZ-TEST: trennt injizierte von physisch gespielten Noten.
// setup: Chord auf Part 1 (Maj, root=gespielt) — EIN langsamer Pad-Druck erzeugt dann
//        die Pad-Note P UND die injizierten P+4/P+7 im selben Ring (kein Kollisionsrisiko).
// read : liest OTP_PROV_PROBE @0xC2200A00 (note, vel, slotmask, voiceObj je Note-On).
//   node scripts/prov-probe.mjs setup
//   node scripts/prov-probe.mjs read
//   node scripts/prov-probe.mjs off
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
const hx=(v)=>"0x"+(v>>>0).toString(16).toUpperCase().padStart(8,"0");
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
const PROV=0xC2200A00;
async function load(name){
  const bin=Array.from(fs.readFileSync(`G:/IdeaProjects/Omnitribe/build/modules_abs/${name}.bin`));
  const id=bin[6]|(bin[7]<<8);
  for(let o=0;o<bin.length;o+=180){const a=await ack(chunkFrame(id,o,bin.slice(o,o+180)),1200);if(!a.length||a[0].status!==0){console.log(`${name} chunk fail @${o}`);return null;}}
  const c=await ack(fr(0x05,0x04,[id]));console.log(`${name} (id ${id}) commit: ${c.map(x=>"0x"+x.status.toString(16).padStart(2,"0")).join("→")}`);return id;
}
(async()=>{
 try{
  const mode=process.argv[2]||"read";
  if(mode==="off"){const a=await ack(fr(0x05,0x07,[0x7f]));console.log("unplace all:",a.length?("0x"+a[0].status.toString(16)):"—");return;}
  if(mode==="setup"){
    await ack(fr(0x05,0x07,[0x7f]));
    const inst=await cmd04(0x02,[21,0,0,hi7(21),lo7(21),1]);console.log("periodik:",inst?(inst.length===1?`0x${inst[0].toString(16)}(schon)`:`irq ${inst[0]}`):"—");
    await cmd04(0x05,[0,0,hi7(21),lo7(21),1]);
    const id=await load("chord"); if(id===null)return;
    const cfg=async(msb,lsb,val,tag)=>{const a=await ack(nrpn(id,msb,lsb,val));console.log(`  ${tag}: ${a.length?("0x"+a[0].status.toString(16).padStart(2,"0")):"—"}`);};
    await cfg(0x1e,(0<<4)|0x00,0,  "type=Maj");
    await cfg(0x1e,(0<<4)|0x02,200,"root=played");
    await cfg(0x1e,(0<<4)|0x01,0,  "stagger=0");
    await cfg(0x1e,(0<<4)|0x03,1,  "enabled[P1]=1");
    console.log("\nSETUP fertig. Druecke GANZ LANGSAM EIN einzelnes Pad auf Part 1 (Keyboard-Modus),");
    console.log("kurz halten, loslassen. Dann: node scripts/prov-probe.mjs read");
    return;
  }
  // read
  const t=await cmd04(0x0a);
  if(t){const eg=t[0],trip=t[3],win=t[10],dc=t[11],hits=t[12],lat=t[13];
    console.log(`TELEMETRIE: egress=${eg} rate_tripped=${trip} inj_win_count=${win}/300 drain_calls=${dc}`);
    console.log(`  inj_hits=${hits}  (Ring-Treffer, MUSS >0 sein = Rueckkopplung unterdrueckt)  inj_hit_lat_max=${lat} Ticks (~ms)`);}
  const magic=await rd32(PROV), count=await rd32(PROV+4), widx=await rd32(PROV+8);
  console.log(`PROV magic=${hx(magic)} (soll 0x50525631 'PRV1')  count=${count}  widx=${widx}`);
  if(magic!==0x50525631){console.log("Probe noch nicht beschrieben — erst spielen.");return;}
  console.log("  idx  note  vel   slotmask     voiceObj     part  quelle?");
  for(let i=0;i<8;i++){
    const b=PROV+12+i*16;
    const note=await rd32(b), vel=await rd32(b+4), sm=await rd32(b+8), vo=await rd32(b+12);
    let part="?"; if(vo>=0xC069EA44 && vo<0xC069EA44+16*0x148) part=((vo-0xC069EA44)/0x148)|0;
    const cur=(widx-1)&7;
    console.log(`  [${i}]${i===cur?"*":" "}  ${String(note).padStart(3)}  ${String(vel).padStart(3)}   ${hx(sm)}   ${hx(vo)}   ${String(part).padStart(2)}`);
  }
  console.log("\n=> Vergleiche die Pad-Note (dein gespielter Ton) mit den injizierten (+4/+7 darueber):");
  console.log("   Unterscheiden sich slotmask ODER voiceObj systematisch? Dann haben wir das Herkunfts-Signal.");
 } finally{out.closePort();inp.closePort();}
})();

// u4-diag.mjs — NUR LESEN: prueft, ob der U4-Boot-Selbstlader gelaufen ist.
import midi from "@julusian/midi";
const H=[0xf0,0x7d,0x01,0x02],END=0xf7;
const enc7=(d)=>{const o=[];for(let i=0;i<d.length;i+=7){let k=0;const e=Math.min(i+7,d.length);for(let j=i;j<e;j++)if(d[j]&0x80)k|=1<<(j-i);o.push(k&0x7f);for(let j=i;j<e;j++)o.push(d[j]&0x7f);}return o;};
const dec7=(d)=>{const o=[];for(let i=0;i<d.length;){const k=d[i++];for(let j=0;j<7&&i<d.length;j++)o.push(d[i++]|((k>>j)&1?0x80:0));}return o;};
const le32=(v)=>[v&0xff,(v>>>8)&0xff,(v>>>16)&0xff,(v>>>24)&0xff];
const xor=(p)=>p.reduce((a,b)=>a^(b&0x7f),0)&0x7f;
const fr=(c,s,p=[])=>[...H,c,s,(p.length>>7)&0x7f,p.length&0x7f,...p,xor(p),END];
const peekFrame=(a,l)=>[...H,0x52,...enc7([...le32(a),...le32(l)]),END];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hx=v=>"0x"+(v>>>0).toString(16).toUpperCase().padStart(8,"0");
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(),inp=new midi.Input();
if(find(out,"electribe")<0||find(inp,"electribe")<0){console.error("electribe nicht gefunden");process.exit(1);}
out.openPort(find(out,"electribe"));inp.openPort(find(inp,"electribe"));
let rx=[];inp.ignoreTypes(false,true,true);inp.on("message",(_d,m)=>rx.push([...m]));
function dec(m){const p=m.slice(8,m.length-2),v=[];for(let i=1;i+4<p.length;i+=5){const hi=p[i];v.push(((p[i+1]|((hi&1)<<7))|((p[i+2]|(((hi>>1)&1)<<7))<<8)|((p[i+3]|(((hi>>2)&1)<<7))<<16)|((p[i+4]|(((hi>>3)&1)<<7))<<24))>>>0);}return v;}
async function cmd04(sub,payload=[],ms=1200){rx=[];out.sendMessage(fr(0x04,sub,payload));const t=Date.now();while(Date.now()-t<ms){for(const m of rx)if(m[1]===0x7d&&m[4]===0x04&&m[5]===0x7f)return dec(m);await sleep(8);}return null;}
async function peek(a,l,ms=800){rx=[];out.sendMessage(peekFrame(a,l));const t=Date.now();while(Date.now()-t<ms){for(const m of rx)if(m[1]===0x7d&&m[4]===0x52)return dec7(m.slice(5,m.length-1)).slice(0,l);await sleep(8);}return null;}
const rd32=async(a)=>{const b=await peek(a,4);return b?(b[0]|(b[1]<<8)|(b[2]<<16)|(b[3]<<24))>>>0:null;};
(async()=>{
 try{
  const t1=await cmd04(0x0a);
  await sleep(1200);
  const t2=await cmd04(0x0a);
  if(t1&&t2){const pump1=t1[8],pump2=t2[8];
    console.log(`pump_calls: ${pump1} -> ${pump2} (${pump2>pump1?"LAEUFT +"+(pump2-pump1):"STEHT!"})  draining=${t2[9]}`);
    console.log(`egress=${t2[0]} inj_hits=${t2[12]} rate_tripped=${t2[3]} ticks=${t2[6]}`);
  } else console.log("KEINE Telemetrie (SUB 0x0A) — Stub/Event-State nicht aktiv?");
  const MOD2=0xC2200000;
  const magic=await rd32(MOD2), placed=await rd32(MOD2+0x84), cstat=await rd32(MOD2+0x88), cid=await rd32(MOD2+0x8C);
  console.log(`MOD2 magic=${hx(magic)} (soll 0x4F544D33 'OTM3')  placed_mask=${hx(placed)} (Bit0=arp id1, Bit9=chord id9)`);
  console.log(`last_commit: status=${hx(cstat)} id=${cid}`);
  const arpMagic=await rd32(0xC2010000), chordMagic=await rd32(0xC2090000);
  console.log(`Slot-Magic: arp@0xC2010000=${hx(arpMagic)}  chord@0xC2090000=${hx(chordMagic)} (Modul-Magic != 0/FF = kopiert)`);
 } finally{out.closePort();inp.closePort();}
})();

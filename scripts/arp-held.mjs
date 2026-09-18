// arp-held.mjs — liest LIVE die gehaltenen Noten des Arp (g_state.n_held, Kanal 0)
// direkt aus dem DDR. Damit laesst sich zweifelsfrei sehen, ob eine gehaltene
// Pad-Note den Note-Kern-Hook 0xC00913EC erreicht — unabhaengig von egress/Timing.
// Arp-Slot id1 = 0xC2010000; g_state-Ptr @ +0x24; ArpVoice[0].n_held @ +0x30.
//
//   node scripts/arp-held.mjs        (12 s live, alle 500 ms)
import midi from "@julusian/midi";
const H=[0xf0,0x7d,0x01,0x02],END=0xf7;
const enc7=(d)=>{const o=[];for(let i=0;i<d.length;i+=7){let k=0;const e=Math.min(i+7,d.length);for(let j=i;j<e;j++)if(d[j]&0x80)k|=1<<(j-i);o.push(k&0x7f);for(let j=i;j<e;j++)o.push(d[j]&0x7f);}return o;};
const dec7=(d)=>{const o=[];for(let i=0;i<d.length;){const k=d[i++];for(let j=0;j<7&&i<d.length;j++)o.push(d[i++]|((k>>j)&1?0x80:0));}return o;};
const le32=(v)=>[v&0xff,(v>>>8)&0xff,(v>>>16)&0xff,(v>>>24)&0xff];
const peekFrame=(a,l)=>[...H,0x52,...enc7([...le32(a),...le32(l)]),END];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hx=(v)=>"0x"+(v>>>0).toString(16).toUpperCase().padStart(8,"0");
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(),inp=new midi.Input();
if(find(out,"electribe")<0||find(inp,"electribe")<0){console.error("electribe-Port nicht gefunden");process.exit(1);}
out.openPort(find(out,"electribe"));inp.openPort(find(inp,"electribe"));
let rx=[];inp.ignoreTypes(false,true,true);inp.on("message",(_d,m)=>rx.push([...m]));
async function peek(addr,len,ms=800){rx=[];out.sendMessage(peekFrame(addr,len));const t=Date.now();while(Date.now()-t<ms){for(const m of rx)if(m[1]===0x7d&&m[4]===0x52)return dec7(m.slice(5,m.length-1)).slice(0,len);await sleep(8);}return null;}
const rd32=async(a)=>{const b=await peek(a,4);return b?(b[0]|(b[1]<<8)|(b[2]<<16)|(b[3]<<24))>>>0:null;};
const SLOT=0xC2010000;
(async()=>{
 try{
  const g=await rd32(SLOT+0x24);
  if(!g||g<0xC2000000||g>=0xC2200000){console.log(`g_state-Ptr @${hx(SLOT+0x24)} = ${g===null?"—":hx(g)} — Arp platziert? (erst arp-u3/arp-pad laden)`);return;}
  console.log(`Arp g_state @${hx(g)} — dumpe 60 Byte, suche die gehaltene Note (0x3C=60 etc.):`);
  console.log("12 s live — HALTE eine Pad-Note auf Part 1 die GANZE Zeit:");
  let base=null;
  const tEnd=Date.now()+12000;
  while(Date.now()<tEnd){
    const d=await peek(g,60);
    if(d){
      const nz=d.map((b,i)=>b?`+${i}=${b}`:null).filter(Boolean).join(" ");
      console.log("  "+(nz||"(alles 0)"));
    } else console.log("  (keine Antwort)");
    await sleep(600);
  }
  console.log("=> Aendern sich Bytes waehrend du haeltst, siehst du hier Offset+Wert der gehaltenen Note und n_held.");
  console.log("=> n_held>0 waehrend du haeltst = die Note erreicht den Hook (auch bei Part-1-Level 0 / gemutet, falls du das testest).");
 } finally{out.closePort();inp.closePort();}
})();

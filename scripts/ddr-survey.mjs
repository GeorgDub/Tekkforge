// Read-only DDR-Survey ueber OTP-0x52: Adressliste zweimal lesen (Sequencer laeuft),
// je Fenster deuten FREI?/belegt/AKTIV. Fuer Stufe-2-Modulplatzierung.
import midi from "@julusian/midi";
const H=[0xf0,0x7d,0x01,0x02],END=0xf7;
const enc7=(d)=>{const o=[];for(let i=0;i<d.length;i+=7){let k=0;const e=Math.min(i+7,d.length);for(let j=i;j<e;j++)if(d[j]&0x80)k|=1<<(j-i);o.push(k&0x7f);for(let j=i;j<e;j++)o.push(d[j]&0x7f);}return o;};
const dec7=(d)=>{const o=[];let i=0;while(i<d.length){const k=d[i++];for(let j=0;j<7&&i<d.length;j++){let b=d[i++]&0x7f;if(k&(1<<j))b|=0x80;o.push(b);}}return o;};
const le32=(v)=>[v&0xff,(v>>>8)&0xff,(v>>>16)&0xff,(v>>>24)&0xff];
const peek=(a,l)=>[...H,0x52,...enc7([...le32(a),...le32(l)]),END];
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(),inp=new midi.Input();
const oi=find(out,"electribe"),ii=find(inp,"electribe");
let rx=[]; inp.ignoreTypes(false,true,true); inp.on("message",(_d,m)=>rx.push(Array.from(m)));
inp.openPort(ii); out.openPort(oi);
async function rd(a,l=64){for(let t=0;t<3;t++){rx=[];out.sendMessage(peek(a,l));const t0=Date.now();while(Date.now()-t0<400){for(const m of rx)if(m[1]===0x7d&&m[4]===0x52)return dec7(m.slice(5,m.length-1)).slice(0,l);await sleep(6);}}return null;}
const ZIELE=[
  [0xC0300000,"Luecke +3 MiB"],[0xC0800000,"Luecke +8 MiB"],[0xC1000000,"Luecke +16 MiB"],
  [0xC2000000,"Luecke +32 MiB"],[0xC3000000,"Luecke +48 MiB"],[0xC3F00000,"Luecke-Ende"],
  [0xC4000000,"DDR_AUDIO"],[0xC5000000,"DDR_STATE"],[0xC5001400,"nach Stub-State"],
  [0xC6000000,"BF523-Abbild"],[0xC6100000,"Loader-Modul-Area"],[0xC6200000,"DSP-Region"],
  [0xC7000000,"hohe DDR +112M"],[0xC7F00000,"hoechste DDR"],
];
const hex8=(a)=>(a||[]).slice(0,8).map(b=>b.toString(16).padStart(2,"0")).join("");
function deute(a,b){
  if(!a||!b)return "KEINE ANTWORT";
  const eq=a.length===b.length&&a.every((v,i)=>v===b[i]);
  if(!eq)return "AKTIV (aendert sich - nicht anfassen)";
  if(a.every(v=>v===0))return "FREI? (alle 0, stabil)";
  if(a.every(v=>v===0xff))return "FREI? (alle FF, stabil)";
  return "belegt (Muster, stabil)";
}
(async()=>{
  console.log("Lauf 1 …"); const l1={}; for(const [a] of ZIELE) l1[a]=await rd(a);
  console.log("2s Pause (Sequencer laeuft) …"); await sleep(2000);
  console.log("Lauf 2 …"); const l2={}; for(const [a] of ZIELE) l2[a]=await rd(a);
  console.log("\nAdresse      Name                erste8   Urteil");
  console.log("-".repeat(78));
  const frei=[];
  for(const [a,name] of ZIELE){
    const u=deute(l1[a],l2[a]);
    if(u.startsWith("FREI"))frei.push(a);
    console.log(`0x${a.toString(16).toUpperCase().padEnd(9)} ${name.padEnd(18)} ${hex8(l1[a]).padEnd(17)} ${u}`);
  }
  console.log(`\nFrei-Kandidaten: ${frei.map(a=>"0x"+a.toString(16).toUpperCase()).join(", ")||"keine"}`);
  out.closePort();inp.closePort();
})();

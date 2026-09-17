// Verifikation: nach 0xC0693E5E (echte Osc-Pitch-Quelle Part 2) per Hacktribe-
// RAM-Write (0x53 Adresse, 0x54 Daten) schreiben, zurueck:lesen, hoeren.
import midi from "@julusian/midi";
const HEAD=[0xf0,0x42,0x30,0x00,0x01,0x24], END=0xf7;
// KORG syxEnc (woertlich aus e2Sysex)
function syxEnc(byt){const l=byt.length,out=[];let tmp=[],b=0,cnt=7,lim=0;for(let i=0;i<l;i++){const e=byt[i];if(l<7)lim=7-l;tmp.push(e&0x7f);b|=(e&0x80)>>cnt;cnt--;if(cnt===lim){out.push(b);for(const t of tmp)out.push(t);tmp=[];b=0;cnt=7;if(l-i<7)lim=7-(l-i)+1;}}if(tmp.length){out.push(b);for(const t of tmp)out.push(t);}return out;}
function syxDec(s){const o=[];for(let off=0;off<s.length;off+=8){const l=s.slice(off,off+8);for(let i=0;i<l.length-1;i++){let a=l[i+1];a|=((l[0]&(1<<i))>>i)<<7;o.push(a);}}return o;}
const u32=(v)=>[v&0xff,(v>>>8)&0xff,(v>>>16)&0xff,(v>>>24)&0xff];
const kframe=(cmd,body)=>[...HEAD,cmd,...body,END];
const wAddr=(a,l)=>kframe(0x53,syxEnc([...u32(a),...u32(l)]));
const wData=(d)=>kframe(0x54,syxEnc(d));
const rReq=(a,l)=>kframe(0x52,syxEnc([...u32(a),...u32(l)]));
const u8=(w)=>w<0?w+256:w; const s8=(b)=>b>=128?b-256:b;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(),inp=new midi.Input();
const oi=find(out,"electribe"),ii=find(inp,"electribe");
let rx=[]; inp.ignoreTypes(false,true,true); inp.on("message",(_d,m)=>rx.push(Array.from(m)));
inp.openPort(ii); out.openPort(oi);
const ADDR=0xC0693E5E;
const enc7=(d)=>{const o=[];for(let i=0;i<d.length;i+=7){let k=0;const e=Math.min(i+7,d.length);for(let j=i;j<e;j++)if(d[j]&0x80)k|=1<<(j-i);o.push(k&0x7f);for(let j=i;j<e;j++)o.push(d[j]&0x7f);}return o;};
const dec7=(d)=>{const o=[];let i=0;while(i<d.length){const k=d[i++];for(let j=0;j<7&&i<d.length;j++){let b=d[i++]&0x7f;if(k&(1<<j))b|=0x80;o.push(b);}}return o;};
const otpPeek=(a,l)=>[0xf0,0x7d,0x01,0x02,0x52,...enc7([...u32(a),...u32(l)]),0xf7];
async function readback(){rx=[];out.sendMessage(otpPeek(ADDR,1));const t=Date.now();while(Date.now()-t<400){for(const m of rx)if(m[1]===0x7d&&m[4]===0x52){const d=dec7(m.slice(5,m.length-1));return d[0];}await sleep(8);}return null;}
async function writePitch(w){out.sendMessage(wAddr(ADDR,1));await sleep(30);out.sendMessage(wData([u8(w)]));await sleep(120);const rb=await readback();return rb;}
async function step(w,ms=2600){const rb=await writePitch(w);console.log(`  Pitch ${w>=0?"+":""}${w} geschrieben, read-back = ${rb!==null?`${rb}(${s8(rb)})`:"—"}`);await sleep(ms);}
(async()=>{
  console.log("=== Write-Test 0xC0693E5E (Osc-Pitch Part 2) — hörst du die Tonhöhe? ===");
  for(let r=1;r<=2;r++){
    console.log(` Durchlauf ${r}:`);
    await step(+24); await step(-24); await step(+12); await step(0);
  }
  console.log("\n=== fertig — wechselte die Tonhöhe hörbar? ===");
  out.closePort();inp.closePort();
})();

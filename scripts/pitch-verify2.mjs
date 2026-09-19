import midi from "@julusian/midi";
const H=[0xf0,0x7d,0x01,0x02],END=0xf7;
const enc7=(d)=>{const o=[];for(let i=0;i<d.length;i+=7){let k=0;const e=Math.min(i+7,d.length);for(let j=i;j<e;j++)if(d[j]&0x80)k|=1<<(j-i);o.push(k&0x7f);for(let j=i;j<e;j++)o.push(d[j]&0x7f);}return o;};
const dec7=(d)=>{const o=[];let i=0;while(i<d.length){const k=d[i++];for(let j=0;j<7&&i<d.length;j++){let b=d[i++]&0x7f;if(k&(1<<j))b|=0x80;o.push(b);}}return o;};
const xor=(p)=>{let c=0;for(const b of p)c^=b;return c&0x7f;};
const frame=(cmd,sub,p)=>[...H,cmd,sub,(p.length>>7)&0x7f,p.length&0x7f,...p,xor(p),END];
const enc14=(w)=>{const v=w&0x3fff;return [(v>>7)&0x7f,v&0x7f];};
const setPitch=(w)=>frame(0x02,0x00,[1,0x00,0x01,...enc14(w)]); // Part 2, Osc-Pitch
const le32=(v)=>[v&0xff,(v>>>8)&0xff,(v>>>16)&0xff,(v>>>24)&0xff];
const peek=(a,l)=>[...H,0x52,...enc7([...le32(a),...le32(l)]),END];
const s8=(b)=>b>=128?b-256:b;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(),inp=new midi.Input();
const oi=find(out,"electribe"),ii=find(inp,"electribe");
let rx=[]; inp.ignoreTypes(false,true,true); inp.on("message",(_d,m)=>rx.push(Array.from(m)));
inp.openPort(ii); out.openPort(oi);
async function ask(f,pred,ms=1500){rx=[];out.sendMessage(f);const t=Date.now();while(Date.now()-t<ms){for(const m of rx)if(pred(m))return m;await sleep(8);}return null;}
async function rd(a){const m=await ask(peek(a,1),(m)=>m[1]===0x7d&&m[4]===0x52);return m?dec7(m.slice(5,m.length-1))[0]:null;}
(async()=>{
  const id=await ask(frame(0x01,0x00,[]),(m)=>m[1]===0x7d&&m[4]===0x01&&m[5]===0x01);
  console.log("IDENTITY:", id?"OK (Coexist laeuft)":"KEINE ANTWORT");
  console.log("\nSchreibe Osc-Pitch Part 2 = +40 (PARAM SET 0x02)…");
  out.sendMessage(setPitch(40)); await sleep(200);
  const neu=await rd(0xC0693E5E), alt=await rd(0xC0694053);
  console.log(`  0xC0693E5E (NEU, echte Quelle): ${neu}(${neu!==null?s8(neu):"?"})  -> ${neu===40?"✓ Stub schreibt jetzt richtig":"✗"}`);
  console.log(`  0xC0694053 (ALT, falsch):       ${alt}(${alt!==null?s8(alt):"?"})  -> ${alt!==40?"✓ nicht mehr beschrieben":"noch beschrieben"}`);
  out.sendMessage(setPitch(0));
  out.closePort();inp.closePort();
})();

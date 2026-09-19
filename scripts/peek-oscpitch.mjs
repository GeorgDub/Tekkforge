// 0x52-Peek der Osc-Pitch-Live-Adresse Part 2 (0xC0694053) vor/nach dem Schreiben.
import midi from "@julusian/midi";
const H=[0xf0,0x7d,0x01,0x02],END=0xf7;
const enc7=(d)=>{const o=[];for(let i=0;i<d.length;i+=7){let k=0;const e=Math.min(i+7,d.length);for(let j=i;j<e;j++)if(d[j]&0x80)k|=1<<(j-i);o.push(k&0x7f);for(let j=i;j<e;j++)o.push(d[j]&0x7f);}return o;};
const dec7=(d)=>{const o=[];let i=0;while(i<d.length){const k=d[i++];for(let j=0;j<7&&i<d.length;j++){let b=d[i++]&0x7f;if(k&(1<<j))b|=0x80;o.push(b);}}return o;};
const xor=(p)=>{let c=0;for(const b of p)c^=b;return c&0x7f;};
const frame=(cmd,sub,p)=>[...H,cmd,sub,(p.length>>7)&0x7f,p.length&0x7f,...p,xor(p),END];
const enc14=(w)=>{const v=w&0x3fff;return [(v>>7)&0x7f,v&0x7f];};
const setPitch=(part,w)=>frame(0x02,0x00,[part,0x00,0x01,...enc14(w)]);
const le32=(v)=>[v&0xff,(v>>8)&0xff,(v>>16)&0xff,(v>>24)&0xff];
const peekFrame=(addr,len)=>[...H,0x52,...enc7([...le32(addr),...le32(len)]),END];
const s8=(b)=>b>=0x80?b-0x100:b;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(),inp=new midi.Input();
const oi=find(out,"electribe"),ii=find(inp,"electribe");
let rx=[]; inp.ignoreTypes(false,true,true); inp.on("message",(_d,m)=>rx.push(Array.from(m)));
inp.openPort(ii); out.openPort(oi);
const ADDR=0xC0694053, PART=1; // Part 2
async function peek(len=1,ms=800){rx=[];out.sendMessage(peekFrame(ADDR,len));const t=Date.now();while(Date.now()-t<ms){for(const m of rx)if(m[1]===0x7d&&m[4]===0x52){const data=dec7(m.slice(5,m.length-1));return data.slice(0,len);}await sleep(8);}return null;}
(async()=>{
  console.log(`Peek 0xC0694053 (Osc-Pitch Part 2, signed int8)`);
  const v0=await peek(1); console.log("  vorher   :", v0?`${v0[0]} (int8 ${s8(v0[0])})`:"KEINE ANTWORT");
  if(!v0){console.log("→ 0x52-Peek antwortet nicht. Stub-0x52-Handler?");process.exit(1);}
  console.log("\nSchreibe Osc-Pitch Part 2 = +40 …");
  out.sendMessage(setPitch(PART,40));
  for(let i=1;i<=6;i++){ const v=await peek(1); console.log(`  nach ${i} (${i*100}ms): ${v?`${v[0]} (int8 ${s8(v[0])})`:"—"}`); await sleep(60); }
  console.log("\nSchreibe Osc-Pitch Part 2 = -40 …");
  out.sendMessage(setPitch(PART,-40));
  for(let i=1;i<=4;i++){ const v=await peek(1); console.log(`  nach ${i}: ${v?`${v[0]} (int8 ${s8(v[0])})`:"—"}`); await sleep(60); }
  out.sendMessage(setPitch(PART,0));
  console.log("\nDeutung: 40 landet + bleibt = Engine liest Live nicht | 40 flackert/weg = Sequencer laedt Pattern nach | nie 40 = Schreibweg/Offset falsch");
  out.closePort();inp.closePort();
})();

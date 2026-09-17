// Speicher-Scanner ueber OTP-0x52. Modi:
//   snap   <start-hex> <len> <out.json>        — alle Bytes im Fenster sichern
//   diff   <a.json> <b.json>                   — geaenderte Adressen (alt->neu)
//   refine <in.json> <wert> <out.json>         — Kandidaten auf signed-int8-Wert eingrenzen
//   read   <addr-hex> <len>                    — einzelne Adresse lesen
import midi from "@julusian/midi"; import fs from "node:fs";
const H=[0xf0,0x7d,0x01,0x02],END=0xf7;
const enc7=(d)=>{const o=[];for(let i=0;i<d.length;i+=7){let k=0;const e=Math.min(i+7,d.length);for(let j=i;j<e;j++)if(d[j]&0x80)k|=1<<(j-i);o.push(k&0x7f);for(let j=i;j<e;j++)o.push(d[j]&0x7f);}return o;};
const dec7=(d)=>{const o=[];let i=0;while(i<d.length){const k=d[i++];for(let j=0;j<7&&i<d.length;j++){let b=d[i++]&0x7f;if(k&(1<<j))b|=0x80;o.push(b);}}return o;};
const le32=(v)=>[v&0xff,(v>>>8)&0xff,(v>>>16)&0xff,(v>>>24)&0xff];
const peekFrame=(a,l)=>[...H,0x52,...enc7([...le32(a),...le32(l)]),END];
const u8=(w)=>w<0?w+256:w; const s8=(b)=>b>=128?b-256:b;
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(),inp=new midi.Input();
const oi=find(out,"electribe"),ii=find(inp,"electribe");
let rx=[]; inp.ignoreTypes(false,true,true); inp.on("message",(_d,m)=>rx.push(Array.from(m)));
inp.openPort(ii); out.openPort(oi);
async function peek(a,l){for(let t=0;t<3;t++){rx=[];out.sendMessage(peekFrame(a,l));const t0=Date.now();while(Date.now()-t0<300){for(const m of rx)if(m[1]===0x7d&&m[4]===0x52){const d=dec7(m.slice(5,m.length-1));return d.slice(0,l);}await sleep(6);}}return null;}

const mode=process.argv[2];
(async()=>{
  if(mode==="snap"){
    const start=parseInt(process.argv[3],16),len=parseInt(process.argv[4]),outf=process.argv[5];
    const map={}; let done=0;
    for(let a=start;a<start+len;a+=64){ const d=await peek(a,64); done+=64; if(d)for(let i=0;i<d.length;i++)map[a+i]=d[i]; if((done%8192)===0)process.stderr.write(`  ${done}/${len}\r`); }
    fs.writeFileSync(outf,JSON.stringify(map)); console.log(`\nsnap: ${Object.keys(map).length} Bytes -> ${outf}`);
  } else if(mode==="diff"){
    const A=JSON.parse(fs.readFileSync(process.argv[3])),B=JSON.parse(fs.readFileSync(process.argv[4]));
    const ch=[]; for(const a in A)if(B[a]!==undefined&&A[a]!==B[a])ch.push([parseInt(a),A[a],B[a]]);
    console.log(`${ch.length} Adressen geaendert:`);
    for(const [a,x,y] of ch.slice(0,50))console.log(`  0x${a.toString(16).toUpperCase()}: ${x}(${s8(x)}) -> ${y}(${s8(y)})`);
    if(ch.length>50)console.log(`  … +${ch.length-50} weitere`);
  } else if(mode==="refine"){
    const cand=JSON.parse(fs.readFileSync(process.argv[3])),wert=u8(parseInt(process.argv[4])),outf=process.argv[5];
    const list=Array.isArray(cand)?cand:cand.map(x=>x[0]); const keep=[];
    for(const a of list){ const d=await peek(a,1); if(d&&d[0]===wert)keep.push(a); }
    fs.writeFileSync(outf,JSON.stringify(keep)); console.log(`refine: ${list.length} -> ${keep.length} (==${wert}). ${keep.map(a=>"0x"+a.toString(16).toUpperCase()).slice(0,30).join(" ")}`);
  } else if(mode==="read"){
    const a=parseInt(process.argv[3],16),l=parseInt(process.argv[4]||"1"); const d=await peek(a,l);
    console.log(d?d.map((b,i)=>`0x${(a+i).toString(16).toUpperCase()}=${b}(${s8(b)})`).join(" "):"keine Antwort");
  } else console.log("Modi: snap | diff | refine | read");
  out.closePort();inp.closePort();
})();

// Stufe 2: ein echtes Modul chunk-weise hochladen (0x05/0x02), committen (0x05/0x04),
// dann den platzierten Slot per 0x52 lesen und die Relozierung gegenpruefen. KEINE Ausfuehrung.
import midi from "@julusian/midi"; import fs from "node:fs";
const H=[0xf0,0x7d,0x01,0x02],END=0xf7;
const enc7=(d)=>{const o=[];for(let i=0;i<d.length;i+=7){let k=0;const e=Math.min(i+7,d.length);for(let j=i;j<e;j++)if(d[j]&0x80)k|=1<<(j-i);o.push(k&0x7f);for(let j=i;j<e;j++)o.push(d[j]&0x7f);}return o;};
const dec7=(d)=>{const o=[];let i=0;while(i<d.length){const k=d[i++];for(let j=0;j<7&&i<d.length;j++){let b=d[i++]&0x7f;if(k&(1<<j))b|=0x80;o.push(b);}}return o;};
const xor=(p)=>{let c=0;for(const b of p)c^=b;return c&0x7f;};
const frame=(cmd,sub,p)=>[...H,cmd,sub,(p.length>>7)&0x7f,p.length&0x7f,...p,xor(p),END];
const le32=(v)=>[v&0xff,(v>>>8)&0xff,(v>>>16)&0xff,(v>>>24)&0xff];
const peek=(a,l)=>[...H,0x52,...enc7([...le32(a),...le32(l)]),END];
const chunkFrame=(id,off,raw)=>frame(0x05,0x02,[id&0x7f,(off>>14)&0x7f,(off>>7)&0x7f,off&0x7f,...enc7(raw)]);
const commitFrame=(id)=>frame(0x05,0x04,[id&0x7f]);
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(),inp=new midi.Input();
const oi=find(out,"electribe"),ii=find(inp,"electribe");
let rx=[]; inp.ignoreTypes(false,true,true); inp.on("message",(_d,m)=>rx.push(Array.from(m)));
inp.openPort(ii); out.openPort(oi);
async function ack(f,ms=1500){rx=[];out.sendMessage(f);const t=Date.now();while(Date.now()-t<ms){for(const m of rx)if(m[1]===0x7d&&m[4]===0x05&&m[5]===0x03)return {status:m[8],id:m[9],x:m[10]};await sleep(8);}return null;}
async function rd(a,l){rx=[];out.sendMessage(peek(a,l));const t=Date.now();while(Date.now()-t<600){for(const m of rx)if(m[1]===0x7d&&m[4]===0x52)return dec7(m.slice(5,m.length-1)).slice(0,l);await sleep(8);}return null;}
const rd32=(d,o)=>d[o]|(d[o+1]<<8)|(d[o+2]<<16)|(d[o+3]<<24);
const DDR_BASE=0xC2000000, SLOT=0x10000;
const MOD="G:/IdeaProjects/Omnitribe/build/modules/modmatrix.bin"; const RAW=180;
(async()=>{
  const bin=Array.from(fs.readFileSync(MOD)); const id=bin[6]|(bin[7]<<8);
  const slot=(DDR_BASE+id*SLOT)>>>0;
  console.log(`Modul modmatrix id=${id}, ${bin.length} B -> Slot 0x${slot.toString(16).toUpperCase()}`);
  // Original-Offsets (base-0) fuer die Reloc-Erwartung
  const apiOff=rd32(bin,40), udOff=rd32(bin,36);
  const fnOff=[]; for(let i=0;i<7;i++)fnOff.push(rd32(bin,apiOff+i*4));
  console.log("=== Chunks senden ===");
  let ok=true;
  for(let off=0;off<bin.length;off+=RAW){
    const a=await ack(chunkFrame(id,off,bin.slice(off,off+RAW)));
    if(!a||a.status!==0x00){console.log(`  Chunk @${off}: ${a?"Status 0x"+a.status.toString(16):"KEIN ACK"} ✗`);ok=false;break;}
  }
  if(ok)console.log(`  alle Chunks 0x00 quittiert (recv-Zaehler zuletzt: ...)`);
  console.log("=== Commit ===");
  const c=await ack(commitFrame(id));
  console.log(`  Commit: ${c?`Status 0x${c.status.toString(16).padStart(2,"0")} (placed_mask 0x${c.x.toString(16)})`:"KEIN ACK"} ${c&&c.status===0?"✓":"✗"}`);
  if(!c||c.status!==0){console.log("Commit fehlgeschlagen — keine Verifikation.");out.closePort();inp.closePort();return;}
  console.log("=== Verifikation: Slot-Header + Relozierung per 0x52 ===");
  const hdr=await rd(slot,44);
  if(!hdr){console.log("  Slot nicht lesbar");out.closePort();inp.closePort();return;}
  const magic=rd32(hdr,0)>>>0;
  console.log(`  magic @slot+0 = 0x${magic.toString(16).toUpperCase()} ${magic===0x4F544D52?"(OTMR ✓)":"✗"}`);
  const apiAbs=rd32(await rd(slot+40,4),0)>>>0, udAbs=rd32(await rd(slot+36,4),0)>>>0;
  const eApi=(slot+apiOff)>>>0, eUd=(slot+udOff)>>>0;
  console.log(`  api      @slot+40 = 0x${apiAbs.toString(16).toUpperCase()}  erwartet 0x${eApi.toString(16).toUpperCase()} ${apiAbs===eApi?"✓":"✗"}`);
  console.log(`  user_data@slot+36 = 0x${udAbs.toString(16).toUpperCase()}  erwartet 0x${eUd.toString(16).toUpperCase()} ${udAbs===eUd?"✓":"✗"}`);
  const names=["init","on_nrpn","on_clock_tick","on_audio_tick","on_note_on","on_note_off","deinit"];
  const fnMem=await rd(slot+apiOff,28);
  let allok=(magic===0x4F544D52&&apiAbs===eApi&&udAbs===eUd);
  for(let i=0;i<7;i++){const got=rd32(fnMem,i*4)>>>0;const exp=fnOff[i]===0?0:(slot+fnOff[i])>>>0;const good=got===exp;if(!good)allok=false;console.log(`  ${names[i].padEnd(13)} = 0x${got.toString(16).toUpperCase().padStart(8,"0")}  erwartet 0x${exp.toString(16).toUpperCase().padStart(8,"0")} ${good?"✓":"✗"}`);}
  console.log(`\n=== ${allok?"✓ STUFE 2 KORREKT: Modul platziert + reloziert am Geraet (nichts ausgefuehrt)":"✗ Abweichung"} ===`);
  out.closePort();inp.closePort();
})();

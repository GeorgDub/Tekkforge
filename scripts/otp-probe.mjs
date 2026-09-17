// OTP-Test auf dem laufenden Coexist: Identity/FW-Info/Telemetrie, dann alle 20
// echten Modul-Header + Grenzsonde id 32. Normales USB-MIDI (kein Pivot).
import midi from "@julusian/midi"; import fs from "node:fs";
const H=[0xf0,0x7d,0x01,0x02], END=0xf7;
const enc7=(d)=>{const o=[];for(let i=0;i<d.length;i+=7){let k=0;const e=Math.min(i+7,d.length);for(let j=i;j<e;j++)if(d[j]&0x80)k|=1<<(j-i);o.push(k&0x7f);for(let j=i;j<e;j++)o.push(d[j]&0x7f);}return o;};
const xor=(p)=>{let c=0;for(const b of p)c^=b;return c&0x7f;};
const frame=(cmd,sub,p)=>[...H,cmd,sub,(p.length>>7)&0x7f,p.length&0x7f,...p,xor(p),END];
const modBlock=(id,hdr)=>{const e=enc7(hdr);return frame(0x05,0x01,[id&0x7f,(e.length>>7)&0x7f,e.length&0x7f,...e]);};
const contains=(m,cmd,sub)=>m.length>=8&&m[1]===0x7d&&m[4]===cmd&&m[5]===sub;
const STAT={0x00:"gueltig",0x02:"id>=32 abgewiesen",0x04:"bad magic",0x05:"api-version",0x06:"id-mismatch",0x07:"api==0",0x08:"short header"};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(),inp=new midi.Input();
const oi=find(out,"electribe"),ii=find(inp,"electribe");
if(oi<0||ii<0){console.log("Port nicht gefunden");process.exit(1);}
let rx=[]; inp.ignoreTypes(false,true,true); inp.on("message",(_d,m)=>rx.push(Array.from(m)));
inp.openPort(ii); out.openPort(oi);
async function ask(f,cmd,sub,ms=1500){rx=[];out.sendMessage(f);const t=Date.now();while(Date.now()-t<ms){for(const m of rx)if(contains(m,cmd,sub))return m;await sleep(10);}return null;}
// echte Header lesen
const dir="G:/IdeaProjects/Omnitribe/build/modules";
const mods=fs.readdirSync(dir).filter(f=>f.endsWith(".bin")).map(f=>{const d=fs.readFileSync(`${dir}/${f}`);return{name:f.slice(0,-4),id:d[6]|(d[7]<<8),hdr:Array.from(d.slice(0,44))};}).sort((a,b)=>a.id-b.id);
(async()=>{
  console.log("=== OTP-Grundfragen ===");
  const id=await ask(frame(0x01,0x00,[]),0x01,0x01); console.log("IDENTITY :", id?`OK ${id.slice(8,13).join(",")}`:"KEINE ANTWORT");
  if(!id){console.log("\n✗ Coexist antwortet nicht auf OTP. Hook feuert auf MOD132 nicht.");process.exit(1);}
  const fw=await ask(frame(0x09,0x00,[]),0x09,0x01); console.log("FW-INFO  :", fw?"OK":"—");
  const tl=await ask(frame(0x07,0x01,[]),0x07,0x02); console.log("TELEMETRY:", tl?`OK (${tl.length}B)`:"—");
  console.log("\n=== Grenzsonde id 32 (erwartet 0x02) ===");
  const gh=[0x52,0x4d,0x54,0x4f,0x01,0x00,0x20,0x00,...Array(32).fill(0),0x01,0,0,0]; // id 32, api!=0
  const g=await ask(modBlock(32,gh),0x05,0x03,2000); console.log("  id 32:", g?`Status 0x${g[8].toString(16).padStart(2,"0")} ${STAT[g[8]]||"?"}`:"KEIN ACK");
  console.log("\n=== 20 echte Modul-Header (erwartet je 0x00) ===");
  let ok=0,fail=0;
  for(const m of mods){
    const a=await ask(modBlock(m.id,m.hdr),0x05,0x03,2000);
    if(a){const s=a[8];const good=s===0x00;if(good)ok++;else fail++;console.log(`  ${good?"✓":"✗"} ${m.name.padEnd(22)} id=${String(m.id).padStart(2)} -> 0x${s.toString(16).padStart(2,"0")} ${STAT[s]||"?"}`);}
    else{fail++;console.log(`  ✗ ${m.name.padEnd(22)} id=${String(m.id).padStart(2)} -> KEIN ACK`);}
  }
  console.log(`\n=== Ergebnis: ${ok}/20 echte Module mit 0x00 quittiert, ${fail} Abweichung ===`);
  out.closePort();inp.closePort();
})();

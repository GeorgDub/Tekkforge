// Diagnose: Pivot senden, dann ALLES roh mitloggen was ueber MIDI-IN kommt,
// waehrend im Takt Magic gesendet wird. Klaert: kommt nach dem Pivot etwas rein,
// in welchem Format, und schlaegt das Senden fehl? Live-Log in Datei.
import midi from "@julusian/midi";
import fs from "node:fs";
const LOG="G:/IdeaProjects/TekkForge/.probelog.txt"; fs.writeFileSync(LOG,"");
const log=(s)=>fs.appendFileSync(LOG,s+"\n");
const hx=(a)=>Array.from(a).map(b=>b.toString(16).padStart(2,"0")).join(" ");
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const head=[0xf0,0x42,0x30,0x00,0x01,0x24];
const pivot=Uint8Array.from([...head,0x58,0,0,0,0,0,0,0,0,0,0,0xf7]);
const magic=Uint8Array.from([...head,0x64,0x01,0x23,0x45,0x67,0xf7]);
function ports(tag){const o=new midi.Output(),i=new midi.Input();let s=`[${tag}]`;for(let k=0;k<o.getPortCount();k++)s+=` O${k}:${o.getPortName(k)}`;for(let k=0;k<i.getPortCount();k++)s+=` I${k}:${i.getPortName(k)}`;o.closePort?.();i.closePort?.();log(s);}
(async()=>{
  ports("vor");
  let out=new midi.Output(),inp=new midi.Input();
  const oi=find(out,"electribe"),ii=find(inp,"electribe");
  inp.ignoreTypes(false,true,true);
  let rxN=0; inp.on("message",(_d,m)=>{rxN++;log(`  RX#${rxN}: ${hx(m)}`);});
  inp.openPort(ii); out.openPort(oi);
  log("Pivot senden…"); try{out.sendMessage(Array.from(pivot));}catch(e){log("pivot send-Fehler: "+e.message);}
  await sleep(1500);
  log("Port schliessen, 2.5s warten (USB-Re-Enum?)…");
  try{out.closePort();inp.closePort();}catch{}
  await sleep(2500);
  ports("nach 2.5s");
  // neu oeffnen
  out=new midi.Output(); inp=new midi.Input();
  const oi2=find(out,"electribe"),ii2=find(inp,"electribe");
  if(oi2<0||ii2<0){log("Port nach Pivot WEG (OUT "+oi2+" IN "+ii2+")");}
  else{
    inp.ignoreTypes(false,true,true);
    inp.on("message",(_d,m)=>{rxN++;log(`  RX#${rxN} (nach reopen): ${hx(m)}`);});
    inp.openPort(ii2); out.openPort(oi2);
    log("Magic 8x im 700ms-Takt, hoere auf ALLES…");
    for(let v=1;v<=8;v++){try{out.sendMessage(Array.from(magic));log(`  magic ${v} gesendet`);}catch(e){log(`  magic ${v} send-FEHLER: ${e.message}`);}await sleep(700);}
  }
  log(`Empfangen gesamt: ${rxN} Frames.`);
  try{out.closePort();inp.closePort();}catch{}
})();

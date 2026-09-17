// Bootloader-Start v2: Port NACH dem Pivot neu enumerieren/öffnen (Windows-WinMM
// verliert den Endpoint beim Pivot). Live-Log in Datei (unbuffered lesbar).
import midi from "@julusian/midi";
import fs from "node:fs";
const LOG = "G:/IdeaProjects/TekkForge/.bootlog.txt";
const log = (s) => { fs.appendFileSync(LOG, s + "\n"); };
fs.writeFileSync(LOG, "");

const START=0xf0,KORG=0x42,END=0xf7,PID=0x24;
const PIVOT=0x58,DATA=0x54,EXEC=0x57,MAGIC=0x64;
const MAGIC_REPLY=[0x76,0x54,0x32,0x10],ACK=0x21,CHUNK=256,OC=0x80000000;
const binPath = process.argv.find(a=>a.endsWith(".bin")) || "G:/Downloads/TekkForge/Firmware/bootloader-flashinstall-2026-09-17/bootloader.bin";
const head=()=>[START,KORG,0x30,0x00,0x01,PID];
const frame=(id,b=[])=>Uint8Array.from([...head(),id&0x7f,...b,END]);
function syxEnc(byt){const l=byt.length,out=[];let tmp=[],b=0,cnt=7,lim=0;for(let i=0;i<l;i++){const e=byt[i];if(l<7)lim=7-l;tmp.push(e&0x7f);b|=(e&0x80)>>cnt;cnt--;if(cnt===lim){out.push(b);for(const t of tmp)out.push(t);tmp=[];b=0;cnt=7;if(l-i<7)lim=7-(l-i)+1;}}if(tmp.length){out.push(b);for(const t of tmp)out.push(t);}return Uint8Array.from(out);}
const buildPivot=()=>frame(PIVOT,syxEnc(new Uint8Array(8)));
const buildMagic=()=>frame(MAGIC,[0x01,0x23,0x45,0x67]);
const buildChunk=(c)=>frame(DATA,syxEnc(c));
const buildExec=()=>{const b=new Uint8Array(8);new DataView(b.buffer).setUint32(0,OC>>>0,true);return frame(EXEC,syxEnc(b));};
function haeppchen(img){const o=[];for(let i=0;i<img.length;i+=CHUNK){const t=new Uint8Array(CHUNK);t.set(img.subarray(i,Math.min(i+CHUNK,img.length)),0);o.push(t);}return o;}
const contains=(buf,seq)=>{for(let i=0;i+seq.length<=buf.length;i++){let ok=1;for(let j=0;j<seq.length;j++)if(buf[i+j]!==seq[j]){ok=0;break;}if(ok)return 1;}return 0;};
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
const listPorts=(tag)=>{const o=new midi.Output(),ins=new midi.Input();let s=`[${tag}] OUT:`;for(let i=0;i<o.getPortCount();i++)s+=` [${i}]${o.getPortName(i)}`;s+=" | IN:";for(let i=0;i<ins.getPortCount();i++)s+=` [${i}]${ins.getPortName(i)}`;o.closePort?.();ins.closePort?.();log(s);};
const findPort=(dev,hint)=>{for(let i=0;i<dev.getPortCount();i++)if(dev.getPortName(i).toLowerCase().includes(hint))return i;return -1;};

const img=new Uint8Array(fs.readFileSync(binPath));
const chunks=haeppchen(img);
log(`bootloader.bin ${img.length} B -> ${chunks.length} Haeppchen`);

async function openPorts(hint="electribe"){
  const out=new midi.Output(),inp=new midi.Input();
  const oi=findPort(out,hint),ii=findPort(inp,hint);
  if(oi<0||ii<0){log(`  Port "${hint}" nicht gefunden (OUT ${oi} IN ${ii})`);return null;}
  inp.ignoreTypes(false,true,true);
  const rx=[];inp.on("message",(_d,m)=>rx.push(Uint8Array.from(m)));
  inp.openPort(ii);out.openPort(oi);
  log(`  geoeffnet OUT[${oi}] ${out.getPortName(oi)} | IN[${ii}] ${inp.getPortName(ii)}`);
  return {out,inp,rx};
}

(async()=>{
  try{
    listPorts("vor Pivot");
    let io=await openPorts(); if(!io) throw new Error("Kein Port vor Pivot");
    log("1) Pivot senden…"); io.out.sendMessage(Array.from(buildPivot())); await sleep(1200);
    log("   Pivot raus. Port schliessen + neu enumerieren…");
    try{io.out.closePort();io.inp.closePort();}catch{}
    await sleep(800);
    listPorts("nach Pivot");
    // versuche electribe, dann e2fb/freetribe/loader
    io=null;
    for(const hint of ["electribe","e2fb","freetribe","loader","korg"]){
      io=await openPorts(hint); if(io){log(`   Port nach Pivot: "${hint}"`);break;}
    }
    if(!io) throw new Error("Kein Port nach Pivot gefunden (Endpoint weg)");
    log("2) Magic senden…");
    let ok=false;
    for(let v=1;v<=6&&!ok;v++){io.rx.length=0;try{io.out.sendMessage(Array.from(buildMagic()));}catch(e){log("   send-Fehler: "+e.message);}await sleep(400);for(const m of io.rx)if(contains(m,MAGIC_REPLY)){ok=true;break;}if(!ok)log(`   Magic ${v}: keine Antwort`);}
    if(!ok) throw new Error("Keine Magic-Antwort");
    log("   ✓ Magic bestaetigt");
    log(`3) ${chunks.length} Haeppchen…`);
    for(let i=0;i<chunks.length;i++){io.rx.length=0;io.out.sendMessage(Array.from(buildChunk(chunks[i])));let a=false;for(let w=0;w<50&&!a;w++){await sleep(20);for(const m of io.rx)if(contains(m,[ACK])){a=true;break;}}if(!a)throw new Error(`Haeppchen ${i} kein ACK`);if((i+1)%64===0)log(`   ${i+1}/${chunks.length}`);}
    log("4) Execute…"); io.out.sendMessage(Array.from(buildExec())); await sleep(200);
    log("✓ FERTIG");
  }catch(e){log("✗ "+e.message);process.exitCode=1;}
})();

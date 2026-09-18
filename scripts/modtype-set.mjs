// modtype-set.mjs — erweiterte Modulationstypen (0..131) am Geraet setzen (Build 186e, CMD 0x0B).
// Ruft die Firmware-Setterfunktion 0xC0049B94 — das Panel klemmt bei 72, dieser Weg nicht.
// Gestuft: ohne 'apply' = flag 0 (stiller Write+Klemme, sicher), mit 'apply' = flag 1 (voll -> hoerbar).
//   node scripts/modtype-set.mjs <part 1-16> <modType 0-131> [apply]
import midi from "@julusian/midi";
const H=[0xf0,0x7d,0x01,0x02],END=0xf7;
const enc7=(d)=>{const o=[];for(let i=0;i<d.length;i+=7){let k=0;const e=Math.min(i+7,d.length);for(let j=i;j<e;j++)if(d[j]&0x80)k|=1<<(j-i);o.push(k&0x7f);for(let j=i;j<e;j++)o.push(d[j]&0x7f);}return o;};
const dec7=(d)=>{const o=[];for(let i=0;i<d.length;){const k=d[i++];for(let j=0;j<7&&i<d.length;j++)o.push(d[i++]|((k>>j)&1?0x80:0));}return o;};
const le=(v)=>[v&255,(v>>>8)&255,(v>>>16)&255,(v>>>24)&255];
const xor=(p)=>p.reduce((a,b)=>a^b,0)&0x7f;
const fr=(c,s,p)=>[...H,c,s,(p.length>>7)&0x7f,p.length&0x7f,...p,xor(p),END];
const pf=(a,l)=>[...H,0x52,...enc7([...le(a),...le(l)]),END];
const find=(d,h)=>{for(let i=0;i<d.getPortCount();i++)if(d.getPortName(i).toLowerCase().includes(h))return i;return -1;};
const out=new midi.Output(),inp=new midi.Input();out.openPort(find(out,"electribe"));inp.openPort(find(inp,"electribe"));
let rx=[];inp.ignoreTypes(false,true,true);inp.on("message",(_d,m)=>rx.push([...m]));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function peek(a,l){rx=[];out.sendMessage(pf(a,l));const t=Date.now();while(Date.now()-t<800){for(const m of rx)if(m[1]===0x7d&&m[4]===0x52)return dec7(m.slice(5,m.length-1)).slice(0,l);await sleep(8);}return null;}
async function setmt(part,mt,apply){rx=[];out.sendMessage(fr(0x0B,apply?0x02:0x01,[part&0x7f,mt&0x7f]));const t=Date.now();while(Date.now()-t<1200){for(const m of rx)if(m[1]===0x7d&&m[4]===0x05&&m[5]===0x03)return {status:m[8],part:m[9],mt:m[10]};await sleep(8);}return null;}
const partN=+process.argv[2], mt=+process.argv[3], apply=process.argv[4]==="apply";
if(!(partN>=1&&partN<=16)||!(mt>=0&&mt<=131)){console.log("Aufruf: node scripts/modtype-set.mjs <part 1-16> <modType 0-131> [apply]");process.exit(1);}
const part=partN-1;
const ADDR=(0xC06B2798+part*0x330+0x814)>>>0;
(async()=>{
 try{
  const b0=await peek(ADDR,1);
  console.log(`Part ${partN} vorher: Byte ${b0?b0[0]:"—"} (Anzeige ${b0?b0[0]+1:"—"})`);
  const st=[["ok",0],["payload<2",1],["part>=16",2],["modType>131",3],["Singleton 0/unplausibel",4],["falscher Prolog",5]];
  const r=await setmt(part,mt,apply);
  console.log(`set(part ${partN}, modType ${mt}, flag=${apply?1:0}): ${r?"Status 0x"+r.status.toString(16).padStart(2,"0")+" ("+(st.find(x=>x[1]===r.status)?.[0]??"?")+")":"KEIN ACK"}`);
  await sleep(80);
  const b1=await peek(ADDR,1);
  console.log(`Part ${partN} nachher: Byte ${b1?b1[0]:"—"} (Anzeige ${b1?b1[0]+1:"—"})  ${b1&&b1[0]===mt?"✓ gelandet":"✗"}`);
  if(!apply) console.log("Das war flag=0 (stiller Write). Wenn das Geraet lebt und der Wert stimmt: nochmal mit 'apply' fuer hoerbar.");
  else console.log("flag=1 (voll uebernommen). Jetzt Part "+partN+" mit Mod-Depth>0 spielen und den Klang hoeren.");
 } finally{out.closePort();inp.closePort();}
})();

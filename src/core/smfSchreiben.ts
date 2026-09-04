/**
 * smfSchreiben — ein SmfLied als Standard-MIDI-Datei (Format 0, eine Spur).
 *
 * Bisher entstanden MIDI-Dateien nur ueber Python (basic-pitch); die
 * TypeScript-Seite kannte nur das Lesen. Der Generator legt jetzt die
 * transkribierte Melodie als .mid neben das Set — dafuer reicht Format 0:
 * Tempo, Spurname, Note-On/Off mit Delta-Zeiten, End-of-Track.
 */
import type { SmfLied } from "./midiImport";

function varLen(v: number): number[] {
  const out = [v & 0x7f];
  v >>>= 7;
  while (v > 0) {
    out.unshift((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  return out;
}

const u32 = (v: number): number[] => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff];
const u16 = (v: number): number[] => [(v >>> 8) & 0xff, v & 0xff];

export function smfBytes(lied: SmfLied): Uint8Array {
  const tpq = Math.max(1, Math.min(32767, Math.round(lied.ticksProViertel)));
  const ereignisse: { tick: number; reihe: number; bytes: number[] }[] = [];
  const usProViertel = Math.round(60000000 / Math.max(1, lied.bpm));
  ereignisse.push({ tick: 0, reihe: 0, bytes: [0xff, 0x51, 0x03, ...u32(usProViertel).slice(1)] });
  const name = (lied.spuren[0]?.name ?? "TekkForge").slice(0, 60);
  const nameBytes = [...name].map((c) => c.charCodeAt(0) & 0x7f);
  ereignisse.push({ tick: 0, reihe: 1, bytes: [0xff, 0x03, ...varLen(nameBytes.length), ...nameBytes] });
  for (const spur of lied.spuren) {
    for (const n of spur.noten) {
      const kanal = Math.max(0, Math.min(15, n.kanal | 0));
      const note = Math.max(0, Math.min(127, Math.round(n.note)));
      const vel = Math.max(1, Math.min(127, Math.round(n.velocity)));
      const von = Math.max(0, Math.round(n.tick));
      const bis = Math.max(von + 1, Math.round(n.tick + n.dauer));
      // Note-Off vor Note-On bei gleichem Tick: reihe 2 vor 3
      ereignisse.push({ tick: bis, reihe: 2, bytes: [0x80 | kanal, note, 0] });
      ereignisse.push({ tick: von, reihe: 3, bytes: [0x90 | kanal, note, vel] });
    }
  }
  ereignisse.sort((a, b) => a.tick - b.tick || a.reihe - b.reihe);
  const spurBytes: number[] = [];
  let letzte = 0;
  for (const e of ereignisse) {
    spurBytes.push(...varLen(e.tick - letzte), ...e.bytes);
    letzte = e.tick;
  }
  spurBytes.push(0x00, 0xff, 0x2f, 0x00);
  const kopf = [0x4d, 0x54, 0x68, 0x64, ...u32(6), ...u16(0), ...u16(1), ...u16(tpq)];
  const spur = [0x4d, 0x54, 0x72, 0x6b, ...u32(spurBytes.length), ...spurBytes];
  return new Uint8Array([...kopf, ...spur]);
}

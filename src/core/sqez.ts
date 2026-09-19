/**
 * sqez — Dekoder für Korgs „SQEZ“-Strom, wie ihn die Electribe-2-Firmware für die komprimierte
 * Werks-Pattern-Bank benutzt (Flash-Selektor 0x64 bei 0x640000; der Werksreset, CommandTask-
 * Handler 0x11, entpackt ihn in die Pattern-Region 0x24).
 *
 * Nachgebaut aus der Sampler-Firmware (Ghidra-Dekompilate 2026-09-16, Namen aus vanasoft23/
 * electribe2-re): DecodeSqezPayload 0xC0034E14, SqezReadDynamicHuffmanTable 0xC0034C88,
 * SqezBuildCanonicalHuffmanTable 0xC00349CC, SqezReadBits/SqezRefillBitReader 0xC00349A0/
 * 0xC00348E4, g_SqezCrc16Table 0xC00A7750 (= CRC-16/ARC, reflektiert, Init 0).
 *
 * Format (little-endian): "SQEZ" | u32 Länge des Stroms (Bytezähler) | u32 entpackte Größe |
 * u16 CRC-16/ARC der entpackten Bytes | Bitstrom ab +0x0E (MSB zuerst, 16-Bit-Fenster).
 * LZ77 mit 8-KiB-Fenster + kanonisches Huffman in Blöcken: u16 Symbolzahl; Längentabelle des
 * 19er-Alphabets (5-Bit-Zähler, Längen 0..6 in 3 Bits, „111“+Einsen+0 = 7+, nach den ersten
 * drei ein 2-Bit-Nullenlauf); Literal/Längen-Längen (9-Bit-Zähler; 0 = eine Null, 1 = 3+4 Bit
 * Nullen, 2 = 20+9 Bit Nullen, 3..18 = Länge 1..16); Distanztabelle (14 Symbole, 4-Bit-Zähler).
 * Literal < 0x100, sonst Länge = Symbol − 0xFD; Distanzsymbol d → 0 bzw. (d−1) Extra-Bits +
 * 2^(d−1); Quelle = Position − 1 − Distanz.
 *
 * Am Gerätedump belegt: CRC 0x81C2 stimmt, entpackt 0x3E8000 = 250 × 0x4000, 243 Records
 * byte-gleich mit der Pattern-Region (die übrigen 7 hatte der Nutzer überschrieben).
 * Python-Zwilling: Omnitribe tools/formats/sqez.py.
 */

export const SQEZ_KOPF = 0x0e;
const NLIT = 512;

export interface SqezKopfDaten {
  ok: boolean;
  seriell: number;
  entpackt: number;
  crc: number;
}

export function liesSqezKopfDaten(b: Uint8Array, off = 0): SqezKopfDaten {
  const ok = b.length >= off + SQEZ_KOPF && String.fromCharCode(b[off], b[off + 1], b[off + 2], b[off + 3]) === "SQEZ";
  const u32 = (o: number) => (b[off + o] | (b[off + o + 1] << 8) | (b[off + o + 2] << 16) | (b[off + o + 3] << 24)) >>> 0;
  return { ok, seriell: ok ? u32(4) : 0, entpackt: ok ? u32(8) : 0, crc: ok ? b[off + 0xc] | (b[off + 0xd] << 8) : 0 };
}

/** CRC-16/ARC (Polynom 0xA001 reflektiert, Init 0) — g_SqezCrc16Table. */
export function crc16Arc(data: Uint8Array, crc = 0): number {
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let k = 0; k < 8; k++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc & 0xffff;
}

class BitLeser {
  fenster = 0;
  private pending = 0;
  private avail = 0;
  constructor(private readonly data: Uint8Array, private pos: number, private rest: number) {}

  nachfuellen(n: number): void {
    let w = (this.fenster << n) & 0xffff;
    let avail = this.avail;
    let pending = this.pending;
    while (avail < n) {
      n -= avail;
      w |= ((pending & ((1 << avail) - 1)) << n) & 0xffff;
      if (this.rest > 0 && this.pos < this.data.length) {
        pending = this.data[this.pos++];
        this.rest--;
      } else pending = 0;
      avail = 8;
    }
    this.avail = avail - n;
    this.pending = pending;
    this.fenster = (w | ((pending & ((1 << avail) - 1)) >>> (avail - n))) & 0xffff;
  }

  bits(n: number): number {
    const v = n ? (this.fenster >>> (16 - n)) & 0xffff : 0;
    this.nachfuellen(n);
    return v;
  }
}

class Huffman {
  laengen: Uint8Array;
  tabelle: Uint16Array;
  private links: Uint16Array;
  private rechts: Uint16Array;
  constructor(readonly n: number, readonly wurzelBits: number) {
    this.laengen = new Uint8Array(n);
    this.tabelle = new Uint16Array(1 << wurzelBits);
    this.links = new Uint16Array((n + 1) * 2);
    this.rechts = new Uint16Array((n + 1) * 2);
  }

  einheitlich(sym: number): void {
    this.laengen.fill(0);
    this.tabelle.fill(sym);
  }

  bauen(): boolean {
    const { n, wurzelBits: rb, laengen, tabelle } = this;
    const count = new Array<number>(17).fill(0);
    for (let i = 0; i < n; i++) count[laengen[i]]++;
    const code = new Array<number>(18).fill(0);
    for (let i = 1; i <= 16; i++) code[i + 1] = (code[i] + (count[i] << (16 - i))) & 0xffff;
    if (code[17] !== 0) return false;
    const shift = 16 - rb;
    const step = new Array<number>(17).fill(0);
    for (let i = 1; i <= rb; i++) {
      code[i] >>>= shift;
      step[i] = 1 << (rb - i);
    }
    for (let i = rb + 1; i <= 16; i++) step[i] = 1 << (16 - i);
    const startLang = code[rb + 1] >>> shift;
    if (startLang) for (let k = startLang; k < 1 << rb; k++) tabelle[k] = 0;
    let naechsterKnoten = n;
    for (let s = 0; s < n; s++) {
      const L = laengen[s];
      if (L === 0) continue;
      let start = code[L];
      const ende = (start + step[L]) & 0xffff;
      if (L > rb) {
        let arr: Uint16Array = tabelle;
        let idx = start >>> shift;
        for (let k = 0; k < L - rb; k++) {
          let cur = arr[idx];
          if (cur === 0) {
            if (naechsterKnoten >= this.links.length) {
              const l2 = new Uint16Array(this.links.length * 2);
              l2.set(this.links);
              this.links = l2;
              const r2 = new Uint16Array(this.rechts.length * 2);
              r2.set(this.rechts);
              this.rechts = r2;
            }
            this.links[naechsterKnoten] = 0;
            this.rechts[naechsterKnoten] = 0;
            arr[idx] = cur = naechsterKnoten++;
          }
          arr = start & (1 << (15 - rb)) ? this.rechts : this.links;
          idx = cur;
          start = (start & 0x7fff) << 1;
        }
        arr[idx] = s;
      } else {
        for (let c = start; c < ende; c++) tabelle[c] = s;
      }
      code[L] = ende;
    }
    return true;
  }

  dekodiere(br: BitLeser): number {
    let s = this.tabelle[br.fenster >>> (16 - this.wurzelBits)];
    let mask = 1 << (15 - this.wurzelBits);
    while (s > this.n - 1) {
      s = (br.fenster & mask ? this.rechts : this.links)[s];
      mask >>>= 1;
    }
    br.nachfuellen(this.laengen[s]);
    return s;
  }
}

function liesDynamisch(br: BitLeser, h: Huffman, breite: number, einschubNach: number): boolean {
  const cnt = br.bits(breite);
  if (cnt === 0) {
    h.einheitlich(br.bits(breite));
    return true;
  }
  let i = 0;
  while (i < cnt) {
    let v = br.fenster >>> 13;
    if (v === 7) {
      let mask = 0x1000;
      while (mask && br.fenster & mask) {
        v++;
        mask >>>= 1;
      }
      br.nachfuellen(v - 3);
    } else br.nachfuellen(3);
    if (i < h.n) h.laengen[i] = v;
    i++;
    if (i === einschubNach) {
      const z = br.bits(2);
      for (let j = 0; j < z; j++) if (i + j < h.n) h.laengen[i + j] = 0;
      i += z;
    }
  }
  for (let j = Math.min(i, h.n); j < h.n; j++) h.laengen[j] = 0;
  return h.bauen();
}

export type SqezErgebnis = { ok: true; bytes: Uint8Array; crcOk: boolean; kopf: SqezKopfDaten } | { ok: false; grund: string; kopf: SqezKopfDaten };

/** Entpackt den SQEZ-Strom ab `off`. `crcOk` sagt, ob die Prüfsumme des Kopfes zum Ergebnis passt. */
export function entpackeSqez(buf: Uint8Array, off = 0): SqezErgebnis {
  const kopf = liesSqezKopfDaten(buf, off);
  if (!kopf.ok) return { ok: false, grund: "kein SQEZ-Magic", kopf };
  if (kopf.entpackt > 0x2000000) return { ok: false, grund: `entpackte Größe unplausibel (${kopf.entpackt})`, kopf };
  const out = new Uint8Array(kopf.entpackt);
  let pos = 0;
  const br = new BitLeser(buf, off + SQEZ_KOPF, kopf.seriell);
  br.nachfuellen(16);
  const klein = new Huffman(19, 8);
  const dist = new Huffman(14, 8);
  const lit = new Huffman(NLIT, 12);
  let blockRest = 0;
  let sicherung = 0;
  while (pos < kopf.entpackt) {
    if (blockRest === 0) {
      if (++sicherung > 0x100000) return { ok: false, grund: "kein Fortschritt im Strom", kopf };
      blockRest = br.bits(16);
      if (!liesDynamisch(br, klein, 5, 3)) return { ok: false, grund: "Längen-Codetabelle ungültig", kopf };
      const cnt = br.bits(9);
      if (cnt === 0) lit.einheitlich(br.bits(9));
      else {
        let i = 0;
        while (i < cnt) {
          const s = klein.dekodiere(br);
          if (s < 3) {
            const lauf = s === 0 ? 1 : s === 1 ? br.bits(4) + 3 : br.bits(9) + 20;
            for (let j = 0; j < lauf; j++) if (i + j < NLIT) lit.laengen[i + j] = 0;
            i += lauf;
          } else {
            if (i < NLIT) lit.laengen[i] = s - 2;
            i++;
          }
        }
        for (let j = Math.min(i, NLIT); j < NLIT; j++) lit.laengen[j] = 0;
        if (!lit.bauen()) return { ok: false, grund: "Literal/Längen-Tabelle ungültig", kopf };
      }
      if (!liesDynamisch(br, dist, 4, -1)) return { ok: false, grund: "Distanz-Tabelle ungültig", kopf };
    }
    blockRest--;
    const s = lit.dekodiere(br);
    if (s < 0x100) out[pos++] = s;
    else {
      const laenge = s - 0xfd;
      const d = dist.dekodiere(br);
      const distanz = d === 0 ? 0 : (br.bits(d - 1) + (1 << (d - 1))) & 0xffff;
      const quelle = pos - 1 - distanz;
      for (let j = 0; j < laenge && pos < kopf.entpackt; j++) {
        const k = quelle + j;
        out[pos++] = k >= 0 ? out[k] : 0;
      }
    }
  }
  return { ok: true, bytes: out, crcOk: crc16Arc(out) === kopf.crc, kopf };
}

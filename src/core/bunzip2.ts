/**
 * bunzip2 — bzip2-Dekoder in reinem TypeScript, ohne Node-Buffer, damit er
 * im Browser, im Electron-Renderer und in Vitest gleich laeuft.
 *
 * Gebraucht wird er fuer genau eine Sache: den Hacktribe-bsdiff-Patch
 * (`hacktribe-2.patch`, BSDIFF40 mit drei bzip2-Stroemen) in der App auf die
 * Stock-Sampler-Firmware anzuwenden (`bspatch.ts`). Nur Dekodieren, kein
 * Kodieren.
 *
 * Portiert aus seek-bzip 2.0.0 (MIT) — C. Scott Ananian 2013, Eli Skeggs 2012
 * (node-bzip), Kevin Kwok 2011 (bzip2.js); nach micro-bunzip von Rob Landley
 * und der bzip2-Referenz von Julian Seward. Die MIT-Lizenz verlangt den
 * Hinweis; er steht hier. Die Struktur folgt dem Original Zeile fuer Zeile
 * (Bitleser, Blockkopf, Huffman-Gruppen, MTF/RLE, BWT-Ruecktransformation,
 * Block- und Strom-CRC), nur auf Uint8Array statt Buffer.
 */

const MAX_HUFCODE_BITS = 20;
const MAX_SYMBOLS = 258;
const SYMBOL_RUNA = 0;
const SYMBOL_RUNB = 1;
const MIN_GROUPS = 2;
const MAX_GROUPS = 6;
const GROUP_SIZE = 50;
const WHOLEPI = "314159265359";
const SQRTPI = "177245385090";
const BITMASK = [0x00, 0x01, 0x03, 0x07, 0x0f, 0x1f, 0x3f, 0x7f, 0xff];

const CRC32_TABELLE = new Uint32Array([
  0x00000000, 0x04c11db7, 0x09823b6e, 0x0d4326d9, 0x130476dc, 0x17c56b6b, 0x1a864db2, 0x1e475005, 0x2608edb8, 0x22c9f00f, 0x2f8ad6d6, 0x2b4bcb61, 0x350c9b64, 0x31cd86d3, 0x3c8ea00a, 0x384fbdbd,
  0x4c11db70, 0x48d0c6c7, 0x4593e01e, 0x4152fda9, 0x5f15adac, 0x5bd4b01b, 0x569796c2, 0x52568b75, 0x6a1936c8, 0x6ed82b7f, 0x639b0da6, 0x675a1011, 0x791d4014, 0x7ddc5da3, 0x709f7b7a, 0x745e66cd,
  0x9823b6e0, 0x9ce2ab57, 0x91a18d8e, 0x95609039, 0x8b27c03c, 0x8fe6dd8b, 0x82a5fb52, 0x8664e6e5, 0xbe2b5b58, 0xbaea46ef, 0xb7a96036, 0xb3687d81, 0xad2f2d84, 0xa9ee3033, 0xa4ad16ea, 0xa06c0b5d,
  0xd4326d90, 0xd0f37027, 0xddb056fe, 0xd9714b49, 0xc7361b4c, 0xc3f706fb, 0xceb42022, 0xca753d95, 0xf23a8028, 0xf6fb9d9f, 0xfbb8bb46, 0xff79a6f1, 0xe13ef6f4, 0xe5ffeb43, 0xe8bccd9a, 0xec7dd02d,
  0x34867077, 0x30476dc0, 0x3d044b19, 0x39c556ae, 0x278206ab, 0x23431b1c, 0x2e003dc5, 0x2ac12072, 0x128e9dcf, 0x164f8078, 0x1b0ca6a1, 0x1fcdbb16, 0x018aeb13, 0x054bf6a4, 0x0808d07d, 0x0cc9cdca,
  0x7897ab07, 0x7c56b6b0, 0x71159069, 0x75d48dde, 0x6b93dddb, 0x6f52c06c, 0x6211e6b5, 0x66d0fb02, 0x5e9f46bf, 0x5a5e5b08, 0x571d7dd1, 0x53dc6066, 0x4d9b3063, 0x495a2dd4, 0x44190b0d, 0x40d816ba,
  0xaca5c697, 0xa864db20, 0xa527fdf9, 0xa1e6e04e, 0xbfa1b04b, 0xbb60adfc, 0xb6238b25, 0xb2e29692, 0x8aad2b2f, 0x8e6c3698, 0x832f1041, 0x87ee0df6, 0x99a95df3, 0x9d684044, 0x902b669d, 0x94ea7b2a,
  0xe0b41de7, 0xe4750050, 0xe9362689, 0xedf73b3e, 0xf3b06b3b, 0xf771768c, 0xfa325055, 0xfef34de2, 0xc6bcf05f, 0xc27dede8, 0xcf3ecb31, 0xcbffd686, 0xd5b88683, 0xd1799b34, 0xdc3abded, 0xd8fba05a,
  0x690ce0ee, 0x6dcdfd59, 0x608edb80, 0x644fc637, 0x7a089632, 0x7ec98b85, 0x738aad5c, 0x774bb0eb, 0x4f040d56, 0x4bc510e1, 0x46863638, 0x42472b8f, 0x5c007b8a, 0x58c1663d, 0x558240e4, 0x51435d53,
  0x251d3b9e, 0x21dc2629, 0x2c9f00f0, 0x285e1d47, 0x36194d42, 0x32d850f5, 0x3f9b762c, 0x3b5a6b9b, 0x0315d626, 0x07d4cb91, 0x0a97ed48, 0x0e56f0ff, 0x1011a0fa, 0x14d0bd4d, 0x19939b94, 0x1d528623,
  0xf12f560e, 0xf5ee4bb9, 0xf8ad6d60, 0xfc6c70d7, 0xe22b20d2, 0xe6ea3d65, 0xeba91bbc, 0xef68060b, 0xd727bbb6, 0xd3e6a601, 0xdea580d8, 0xda649d6f, 0xc423cd6a, 0xc0e2d0dd, 0xcda1f604, 0xc960ebb3,
  0xbd3e8d7e, 0xb9ff90c9, 0xb4bcb610, 0xb07daba7, 0xae3afba2, 0xaafbe615, 0xa7b8c0cc, 0xa379dd7b, 0x9b3660c6, 0x9ff77d71, 0x92b45ba8, 0x9675461f, 0x8832161a, 0x8cf30bad, 0x81b02d74, 0x857130c3,
  0x5d8a9099, 0x594b8d2e, 0x5408abf7, 0x50c9b640, 0x4e8ee645, 0x4a4ffbf2, 0x470cdd2b, 0x43cdc09c, 0x7b827d21, 0x7f436096, 0x7200464f, 0x76c15bf8, 0x68860bfd, 0x6c47164a, 0x61043093, 0x65c52d24,
  0x119b4be9, 0x155a565e, 0x18197087, 0x1cd86d30, 0x029f3d35, 0x065e2082, 0x0b1d065b, 0x0fdc1bec, 0x3793a651, 0x3352bbe6, 0x3e119d3f, 0x3ad08088, 0x2497d08d, 0x2056cd3a, 0x2d15ebe3, 0x29d4f654,
  0xc5a92679, 0xc1683bce, 0xcc2b1d17, 0xc8ea00a0, 0xd6ad50a5, 0xd26c4d12, 0xdf2f6bcb, 0xdbee767c, 0xe3a1cbc1, 0xe760d676, 0xea23f0af, 0xeee2ed18, 0xf0a5bd1d, 0xf464a0aa, 0xf9278673, 0xfde69bc4,
  0x89b8fd09, 0x8d79e0be, 0x803ac667, 0x84fbdbd0, 0x9abc8bd5, 0x9e7d9662, 0x933eb0bb, 0x97ffad0c, 0xafb010b1, 0xab710d06, 0xa6322bdf, 0xa2f33668, 0xbcb4666d, 0xb8757bda, 0xb5365d03, 0xb1f740b4,
]);

class Crc32 {
  private crc = 0xffffffff;
  wert(): number {
    return ~this.crc >>> 0;
  }
  lauf(byte: number, anzahl: number): void {
    while (anzahl-- > 0) this.crc = (this.crc << 8) ^ CRC32_TABELLE[((this.crc >>> 24) ^ byte) & 0xff];
  }
}

export class Bzip2Fehler extends Error {}

class BitLeser {
  pos = 0;
  private bitOffset = 0;
  private curByte = 0;
  private hasByte = false;
  constructor(private readonly daten: Uint8Array) {}
  private byteHolen(): void {
    if (!this.hasByte) {
      if (this.pos >= this.daten.length) throw new Bzip2Fehler("Unerwartetes Ende der bzip2-Daten");
      this.curByte = this.daten[this.pos++];
      this.hasByte = true;
    }
  }
  read(bits: number): number {
    let result = 0;
    while (bits > 0) {
      this.byteHolen();
      const remaining = 8 - this.bitOffset;
      if (bits >= remaining) {
        result <<= remaining;
        result |= BITMASK[remaining] & this.curByte;
        this.hasByte = false;
        this.bitOffset = 0;
        bits -= remaining;
      } else {
        result <<= bits;
        const shift = remaining - bits;
        result |= (this.curByte & (BITMASK[bits] << shift)) >> shift;
        this.bitOffset += bits;
        bits = 0;
      }
    }
    return result;
  }
  /** Sechs Bytes als Hex — die Blocksignatur (π bzw. √π). */
  pi(): string {
    let s = "";
    for (let i = 0; i < 6; i++) s += this.read(8).toString(16).padStart(2, "0");
    return s;
  }
  eof(): boolean {
    return this.pos >= this.daten.length && !this.hasByte;
  }
}

interface HufGruppe {
  permute: Uint16Array;
  limit: Float64Array;
  base: Uint32Array;
  minLen: number;
  maxLen: number;
}

class Ausgabe {
  private buf: Uint8Array;
  pos = 0;
  constructor(erwartet: number) {
    this.buf = new Uint8Array(Math.max(16384, erwartet));
  }
  byte(b: number): void {
    if (this.pos >= this.buf.length) {
      const neu = new Uint8Array(this.buf.length * 2);
      neu.set(this.buf);
      this.buf = neu;
    }
    this.buf[this.pos++] = b;
  }
  ergebnis(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

function mtf(array: Uint8Array, index: number): number {
  const src = array[index];
  for (let i = index; i > 0; i--) array[i] = array[i - 1];
  array[0] = src;
  return src;
}

class Bunzip {
  private readonly reader: BitLeser;
  private readonly dbufSize: number;
  private dbuf: Uint32Array = new Uint32Array(0);
  private streamCRC = 0;
  private targetBlockCRC = 0;
  private writePos = 0;
  private writeCurrent = 0;
  private writeCount = 0;
  private writeRun = 0;

  constructor(reader: BitLeser) {
    this.reader = reader;
    if (reader.read(8) !== 0x42 || reader.read(8) !== 0x5a || reader.read(8) !== 0x68) throw new Bzip2Fehler("Kein bzip2-Strom (Magic „BZh“ fehlt)");
    const level = reader.read(8) - 0x30;
    if (level < 1 || level > 9) throw new Bzip2Fehler("bzip2-Blockgröße außerhalb 1…9");
    this.dbufSize = 100000 * level;
  }

  /** Naechsten Block lesen und dekodieren (Huffman + MTF/RLE + BWT-Vorbereitung). false = Stromende. */
  private naechsterBlock(): boolean {
    const reader = this.reader;
    const h = reader.pi();
    if (h === SQRTPI) return false;
    if (h !== WHOLEPI) throw new Bzip2Fehler("Blocksignatur ungültig");
    this.targetBlockCRC = reader.read(32) >>> 0;
    this.streamCRC = (this.targetBlockCRC ^ ((this.streamCRC << 1) | (this.streamCRC >>> 31))) >>> 0;
    if (reader.read(1)) throw new Bzip2Fehler("Randomisierte Blöcke (bzip2 < 0.9.5) werden nicht unterstützt");
    const origPointer = reader.read(24);
    if (origPointer > this.dbufSize) throw new Bzip2Fehler("BWT-Startzeiger außerhalb des Blocks");

    let t = reader.read(16);
    const symToByte = new Uint8Array(256);
    let symTotal = 0;
    for (let i = 0; i < 16; i++) {
      if (t & (1 << (0xf - i))) {
        const o = i * 16;
        const k = reader.read(16);
        for (let j = 0; j < 16; j++) if (k & (1 << (0xf - j))) symToByte[symTotal++] = o + j;
      }
    }

    const groupCount = reader.read(3);
    if (groupCount < MIN_GROUPS || groupCount > MAX_GROUPS) throw new Bzip2Fehler("Ungültige Zahl an Huffman-Gruppen");
    const nSelectors = reader.read(15);
    if (nSelectors === 0) throw new Bzip2Fehler("Keine Huffman-Selektoren");
    const mtfSymbol = new Uint8Array(256);
    for (let i = 0; i < groupCount; i++) mtfSymbol[i] = i;
    const selectors = new Uint8Array(nSelectors);
    for (let i = 0; i < nSelectors; i++) {
      let j = 0;
      for (; reader.read(1); j++) if (j >= groupCount) throw new Bzip2Fehler("Selektor außerhalb der Gruppen");
      selectors[i] = mtf(mtfSymbol, j);
    }

    let symCount = symTotal + 2;
    const groups: HufGruppe[] = [];
    for (let j = 0; j < groupCount; j++) {
      const length = new Uint8Array(symCount);
      const temp = new Uint16Array(MAX_HUFCODE_BITS + 1);
      t = reader.read(5);
      for (let i = 0; i < symCount; i++) {
        for (;;) {
          if (t < 1 || t > MAX_HUFCODE_BITS) throw new Bzip2Fehler("Huffman-Codelänge außerhalb 1…20");
          if (!reader.read(1)) break;
          if (!reader.read(1)) t++;
          else t--;
        }
        length[i] = t;
      }
      let minLen = length[0];
      let maxLen = length[0];
      for (let i = 1; i < symCount; i++) {
        if (length[i] > maxLen) maxLen = length[i];
        else if (length[i] < minLen) minLen = length[i];
      }
      const g: HufGruppe = {
        permute: new Uint16Array(MAX_SYMBOLS),
        limit: new Float64Array(MAX_HUFCODE_BITS + 2),
        base: new Uint32Array(MAX_HUFCODE_BITS + 1),
        minLen,
        maxLen,
      };
      groups.push(g);
      let pp = 0;
      for (let i = minLen; i <= maxLen; i++) {
        temp[i] = 0;
        g.limit[i] = 0;
        for (t = 0; t < symCount; t++) if (length[t] === i) g.permute[pp++] = t;
      }
      for (let i = 0; i < symCount; i++) temp[length[i]]++;
      pp = t = 0;
      for (let i = minLen; i < maxLen; i++) {
        pp += temp[i];
        g.limit[i] = pp - 1;
        pp <<= 1;
        t += temp[i];
        g.base[i + 1] = pp - t;
      }
      g.limit[maxLen + 1] = Number.MAX_VALUE;
      g.limit[maxLen] = pp + temp[maxLen] - 1;
      g.base[minLen] = 0;
    }

    const byteCount = new Uint32Array(256);
    for (let i = 0; i < 256; i++) mtfSymbol[i] = i;
    let runPos = 0;
    let dbufCount = 0;
    let selector = 0;
    let uc = 0;
    const dbuf = (this.dbuf = new Uint32Array(this.dbufSize));
    symCount = 0;
    let hufGroup: HufGruppe = groups[0];
    for (;;) {
      if (!symCount--) {
        symCount = GROUP_SIZE - 1;
        if (selector >= nSelectors) throw new Bzip2Fehler("Selektoren erschöpft");
        hufGroup = groups[selectors[selector++]];
      }
      let i = hufGroup.minLen;
      let j = reader.read(i);
      for (; ; i++) {
        if (i > hufGroup.maxLen) throw new Bzip2Fehler("Huffman-Code zu lang");
        if (j <= hufGroup.limit[i]) break;
        j = (j << 1) | reader.read(1);
      }
      j -= hufGroup.base[i];
      if (j < 0 || j >= MAX_SYMBOLS) throw new Bzip2Fehler("Huffman-Symbol außerhalb der Tabelle");
      const nextSym = hufGroup.permute[j];
      if (nextSym === SYMBOL_RUNA || nextSym === SYMBOL_RUNB) {
        if (!runPos) {
          runPos = 1;
          t = 0;
        }
        if (nextSym === SYMBOL_RUNA) t += runPos;
        else t += 2 * runPos;
        runPos <<= 1;
        continue;
      }
      if (runPos) {
        runPos = 0;
        if (dbufCount + t > this.dbufSize) throw new Bzip2Fehler("Lauf überschreitet den Block");
        uc = symToByte[mtfSymbol[0]];
        byteCount[uc] += t;
        while (t--) dbuf[dbufCount++] = uc;
      }
      if (nextSym > symTotal) break;
      if (dbufCount >= this.dbufSize) throw new Bzip2Fehler("Block überschreitet die Blockgröße");
      i = nextSym - 1;
      uc = mtf(mtfSymbol, i);
      uc = symToByte[uc];
      byteCount[uc]++;
      dbuf[dbufCount++] = uc;
    }
    if (origPointer < 0 || origPointer >= dbufCount) throw new Bzip2Fehler("BWT-Startzeiger außerhalb der dekodierten Daten");
    let j = 0;
    for (let i = 0; i < 256; i++) {
      const k = j + byteCount[i];
      byteCount[i] = j;
      j = k;
    }
    for (let i = 0; i < dbufCount; i++) {
      uc = dbuf[i] & 0xff;
      dbuf[byteCount[uc]] |= i << 8;
      byteCount[uc]++;
    }
    let pos = 0;
    let current = 0;
    let run = 0;
    if (dbufCount) {
      pos = dbuf[origPointer];
      current = pos & 0xff;
      pos >>= 8;
      run = -1;
    }
    this.writePos = pos;
    this.writeCurrent = current;
    this.writeCount = dbufCount;
    this.writeRun = run;
    return true;
  }

  /** BWT rueckgaengig machen, RLE1 aufloesen, Block-CRC pruefen, Bytes ausgeben. */
  private blockAusgeben(out: Ausgabe): void {
    const dbuf = this.dbuf;
    let pos = this.writePos;
    let current = this.writeCurrent;
    let dbufCount = this.writeCount;
    let run = this.writeRun;
    const crc = new Crc32();
    while (dbufCount) {
      dbufCount--;
      const previous = current;
      pos = dbuf[pos];
      current = pos & 0xff;
      pos >>= 8;
      let copies: number;
      let outbyte: number;
      if (run++ === 3) {
        copies = current;
        outbyte = previous;
        current = -1;
      } else {
        copies = 1;
        outbyte = current;
      }
      crc.lauf(outbyte, copies);
      while (copies--) out.byte(outbyte);
      if (current !== previous) run = 0;
    }
    this.writeCount = dbufCount;
    if (crc.wert() !== this.targetBlockCRC) {
      throw new Bzip2Fehler(`Block-CRC falsch (gelesen ${crc.wert().toString(16)}, erwartet ${this.targetBlockCRC.toString(16)})`);
    }
  }

  /** Alle Bloecke eines Stroms dekodieren; am Ende die Strom-CRC pruefen. */
  strom(out: Ausgabe): void {
    for (;;) {
      if (this.naechsterBlock()) {
        this.blockAusgeben(out);
      } else {
        const soll = this.reader.read(32) >>> 0;
        if (soll !== this.streamCRC) throw new Bzip2Fehler(`Strom-CRC falsch (gelesen ${this.streamCRC.toString(16)}, erwartet ${soll.toString(16)})`);
        return;
      }
    }
  }
}

/**
 * Einen bzip2-Strom vollstaendig dekodieren. `erwartet` ist nur eine
 * Groessenvorgabe fuer den Ausgabepuffer (kein Limit). Wirft `Bzip2Fehler`
 * bei jedem Formatfehler — auch bei falscher Block- oder Strom-CRC, damit
 * ein kaputter Patch nie ein halbes Firmware-Abbild ergibt.
 */
export function bunzip2(daten: Uint8Array, erwartet = 0): Uint8Array {
  const reader = new BitLeser(daten);
  const out = new Ausgabe(erwartet);
  new Bunzip(reader).strom(out);
  return out.ergebnis();
}

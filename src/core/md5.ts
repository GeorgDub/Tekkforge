/**
 * md5 — reines TypeScript, weil der Renderer kein Node-`crypto` hat. Nur für Prüfsummen in
 * LIESMICH-Dateien (SD-Update-Paket u. a.), damit der Nutzer sie mit den bestehenden
 * `Stock-PCM-Restore`-Angaben vergleichen kann — nicht als Sicherheitsfunktion.
 * Geprüft gegen die RFC-1321-Testvektoren.
 */
function toWords(msg: Uint8Array): { words: Int32Array; bitLen: number } {
  const len = msg.length;
  const withPad = (((len + 8) >> 6) + 1) << 4; // 32-bit-Wörter
  const words = new Int32Array(withPad);
  for (let i = 0; i < len; i++) words[i >> 2] |= msg[i] << ((i % 4) * 8);
  words[len >> 2] |= 0x80 << ((len % 4) * 8);
  const bitLen = len * 8;
  words[withPad - 2] = bitLen & 0xffffffff;
  words[withPad - 1] = Math.floor(bitLen / 0x100000000);
  return { words, bitLen };
}

const add = (a: number, b: number): number => (a + b) | 0;
const rol = (x: number, c: number): number => (x << c) | (x >>> (32 - c));
const cmn = (q: number, a: number, b: number, x: number, s: number, t: number): number => add(rol(add(add(a, q), add(x, t)), s), b);
const ff = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn((b & c) | (~b & d), a, b, x, s, t);
const gg = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn((b & d) | (c & ~d), a, b, x, s, t);
const hh = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn(b ^ c ^ d, a, b, x, s, t);
const ii = (a: number, b: number, c: number, d: number, x: number, s: number, t: number) => cmn(c ^ (b | ~d), a, b, x, s, t);

/** MD5-Digest als 16 Bytes. */
export function md5(msg: Uint8Array): Uint8Array {
  const { words } = toWords(msg);
  let a = 0x67452301,
    b = -271733879,
    c = -1732584194,
    d = 271733878;
  for (let i = 0; i < words.length; i += 16) {
    const oa = a,
      ob = b,
      oc = c,
      od = d;
    const w = (j: number) => words[i + j];
    a = ff(a, b, c, d, w(0), 7, -680876936);
    d = ff(d, a, b, c, w(1), 12, -389564586);
    c = ff(c, d, a, b, w(2), 17, 606105819);
    b = ff(b, c, d, a, w(3), 22, -1044525330);
    a = ff(a, b, c, d, w(4), 7, -176418897);
    d = ff(d, a, b, c, w(5), 12, 1200080426);
    c = ff(c, d, a, b, w(6), 17, -1473231341);
    b = ff(b, c, d, a, w(7), 22, -45705983);
    a = ff(a, b, c, d, w(8), 7, 1770035416);
    d = ff(d, a, b, c, w(9), 12, -1958414417);
    c = ff(c, d, a, b, w(10), 17, -42063);
    b = ff(b, c, d, a, w(11), 22, -1990404162);
    a = ff(a, b, c, d, w(12), 7, 1804603682);
    d = ff(d, a, b, c, w(13), 12, -40341101);
    c = ff(c, d, a, b, w(14), 17, -1502002290);
    b = ff(b, c, d, a, w(15), 22, 1236535329);
    a = gg(a, b, c, d, w(1), 5, -165796510);
    d = gg(d, a, b, c, w(6), 9, -1069501632);
    c = gg(c, d, a, b, w(11), 14, 643717713);
    b = gg(b, c, d, a, w(0), 20, -373897302);
    a = gg(a, b, c, d, w(5), 5, -701558691);
    d = gg(d, a, b, c, w(10), 9, 38016083);
    c = gg(c, d, a, b, w(15), 14, -660478335);
    b = gg(b, c, d, a, w(4), 20, -405537848);
    a = gg(a, b, c, d, w(9), 5, 568446438);
    d = gg(d, a, b, c, w(14), 9, -1019803690);
    c = gg(c, d, a, b, w(3), 14, -187363961);
    b = gg(b, c, d, a, w(8), 20, 1163531501);
    a = gg(a, b, c, d, w(13), 5, -1444681467);
    d = gg(d, a, b, c, w(2), 9, -51403784);
    c = gg(c, d, a, b, w(7), 14, 1735328473);
    b = gg(b, c, d, a, w(12), 20, -1926607734);
    a = hh(a, b, c, d, w(5), 4, -378558);
    d = hh(d, a, b, c, w(8), 11, -2022574463);
    c = hh(c, d, a, b, w(11), 16, 1839030562);
    b = hh(b, c, d, a, w(14), 23, -35309556);
    a = hh(a, b, c, d, w(1), 4, -1530992060);
    d = hh(d, a, b, c, w(4), 11, 1272893353);
    c = hh(c, d, a, b, w(7), 16, -155497632);
    b = hh(b, c, d, a, w(10), 23, -1094730640);
    a = hh(a, b, c, d, w(13), 4, 681279174);
    d = hh(d, a, b, c, w(0), 11, -358537222);
    c = hh(c, d, a, b, w(3), 16, -722521979);
    b = hh(b, c, d, a, w(6), 23, 76029189);
    a = hh(a, b, c, d, w(9), 4, -640364487);
    d = hh(d, a, b, c, w(12), 11, -421815835);
    c = hh(c, d, a, b, w(15), 16, 530742520);
    b = hh(b, c, d, a, w(2), 23, -995338651);
    a = ii(a, b, c, d, w(0), 6, -198630844);
    d = ii(d, a, b, c, w(7), 10, 1126891415);
    c = ii(c, d, a, b, w(14), 15, -1416354905);
    b = ii(b, c, d, a, w(5), 21, -57434055);
    a = ii(a, b, c, d, w(12), 6, 1700485571);
    d = ii(d, a, b, c, w(3), 10, -1894986606);
    c = ii(c, d, a, b, w(10), 15, -1051523);
    b = ii(b, c, d, a, w(1), 21, -2054922799);
    a = ii(a, b, c, d, w(8), 6, 1873313359);
    d = ii(d, a, b, c, w(15), 10, -30611744);
    c = ii(c, d, a, b, w(6), 15, -1560198380);
    b = ii(b, c, d, a, w(13), 21, 1309151649);
    a = ii(a, b, c, d, w(4), 6, -145523070);
    d = ii(d, a, b, c, w(11), 10, -1120210379);
    c = ii(c, d, a, b, w(2), 15, 718787259);
    b = ii(b, c, d, a, w(9), 21, -343485551);
    a = add(a, oa);
    b = add(b, ob);
    c = add(c, oc);
    d = add(d, od);
  }
  const out = new Uint8Array(16);
  [a, b, c, d].forEach((v, k) => {
    out[k * 4] = v & 0xff;
    out[k * 4 + 1] = (v >>> 8) & 0xff;
    out[k * 4 + 2] = (v >>> 16) & 0xff;
    out[k * 4 + 3] = (v >>> 24) & 0xff;
  });
  return out;
}

/** MD5 als 32-stellige Hex-Zeichenkette. */
export function md5Hex(msg: Uint8Array): string {
  return Array.from(md5(msg), (b) => b.toString(16).padStart(2, "0")).join("");
}

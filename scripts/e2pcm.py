"""KORGelec2PCM — Werks-PCM-Container der electribe 2 Synth.

Decoder = exakter Nachbau der ARM-Routinen 0xC0046BD0 (Blöcke) und 0xC008B8E0
(Modi 0..6) aus der Synth-Firmware v2.02. Encoder = eigener Bau, der genau den
Bitstrom erzeugt, den dieser Decoder liest (per DP über die Breiten-Tabelle).

Streamformat (alles Big-Endian im Stream, Tabellen im Container Little-Endian):
  Block:     u16  count(13 bit)            -- Block = genau ein Subblock (Werk: 2048)
  Subblock:  u16  mode(3)<<13 | n(13)
             mode 7:  n x 12 bit roh, MSB zuerst, Byte-gerundet
             mode 0-6: u16 len; u8 t0<<4|t1; u8 t2<<4|t3 (Breiten -1); Bitstrom ab Bit 2
  Wert:      w Bit signed. -2^(w-1) = Escape: (w==12: 1 Bit, 0 => literal -2048)
             dann 2 Bit Tabellenindex (>= aktueller Index => +1), neue Breite.
             w < 12: Wert = Residuum + Prädiktion; w >= 12: Wert absolut.
  Prädiktion: 0: 0 | 1: s1 | 2: 2s1-s2 | 3: 3(s1-s2)+s3 | 4..6: s1+trunc((s1-s2)/2)
  Ausgabe:   (v << 4) & 0xffff; Prüfsumme = 32-bit-Summe der u16-Ausgaben.
"""
import struct

M32 = 0xffffffff


def s32(x):
    x &= M32
    return x - 0x100000000 if x & 0x80000000 else x


# ---------------------------------------------------------------- Decoder ---

def _predict(mode, s1, s2, s3):
    if mode == 1:
        return s1
    if mode == 2:
        return 2 * s1 - s2
    if mode == 3:
        return 3 * (s1 - s2) + s3
    if mode >= 4:
        d = s1 - s2
        if d < 0:
            d += 1
        return s1 + (d >> 1)
    return 0


def decode_modes(src, pos, n, mode, out):
    b0, b1 = src[pos], src[pos + 1]
    t = [((b0 >> 4) & 0xf) + 1, (b0 & 0xf) + 1, ((b1 >> 4) & 0xf) + 1, (b1 & 0xf) + 1, 12]
    idx, w = 4, 12
    fp = (src[pos + 2] << 24) | (src[pos + 3] << 16) | (src[pos + 4] << 8) | src[pos + 5]
    ip = pos + 6
    r3 = 2
    s1 = s2 = s3 = 0
    chk = 0
    for _ in range(n):
        while True:
            v = s32(fp << r3) >> (32 - w)
            r3 += w
            if r3 & 0x10:
                fp = ((fp << 16) | (src[ip] << 8) | src[ip + 1]) & M32
                ip += 2
                r3 -= 16
            if v == -(1 << (w - 1)):
                if w == 12:
                    bit = (fp >> (31 - r3)) & 1
                    r3 += 1
                    if not bit:
                        break
                sel = (fp >> (30 - r3)) & 3
                r3 += 2
                if sel >= idx:
                    sel += 1
                idx = sel
                w = t[idx]
                continue
            break
        if w < 12:
            v += _predict(mode, s1, s2, s3)
        o = (v << 4) & 0xffff
        out.append(o)
        chk = (chk + o) & M32
        s3, s2, s1 = s2, s1, v
    return chk


def decode_raw12(src, pos, n, out):
    chk = 0
    bitpos = 0
    for _ in range(n):
        byte = pos + (bitpos >> 3)
        sh = bitpos & 7
        b2 = src[byte + 2] if byte + 2 < len(src) else 0
        v = ((src[byte] << 16) | (src[byte + 1] << 8) | b2)
        v = (v >> (12 - sh)) & 0xfff
        if v >= 0x800:
            v -= 0x1000
        o = (v << 4) & 0xffff
        out.append(o)
        chk = (chk + o) & M32
        bitpos += 12
    return chk, (bitpos + 7) >> 3


def decode_section(src, sec):
    """Dekodiert eine Sektion (DRUM/SMPL) ab Header-Offset. -> (u16-Liste, chk, soll, ende, modi)"""
    total = struct.unpack_from("<I", src, sec + 8)[0]
    want = struct.unpack_from("<I", src, sec + 12)[0]
    sl = sec + 0x20
    out = []
    chk = 0
    remaining = total
    stats = {}
    while remaining > 0:
        blk = ((src[sl] << 8) | src[sl + 1]) & 0x1fff
        left = blk
        while left > 0:
            hdr = (src[sl] << 8) | src[sl + 1]
            n, mode = hdr & 0x1fff, hdr >> 13
            if mode == 7:
                c, used = decode_raw12(src, sl + 2, n, out)
                sl += 2 + used
            else:
                L = (src[sl + 2] << 8) | src[sl + 3]
                c = decode_modes(src, sl + 4, n, mode, out)
                sl += 4 + L
            chk = (chk + c) & M32
            left -= n
            stats[mode] = stats.get(mode, 0) + n
        remaining -= blk
    return out, chk, want, sl, stats


# ---------------------------------------------------------------- Encoder ---

class _BitWriter:
    __slots__ = ("buf", "acc", "nbits")

    def __init__(self):
        self.buf = bytearray()
        self.acc = 0
        self.nbits = 0

    def put(self, val, w):
        self.acc = (self.acc << w) | (val & ((1 << w) - 1))
        self.nbits += w
        while self.nbits >= 8:
            self.nbits -= 8
            self.buf.append((self.acc >> self.nbits) & 0xff)
        self.acc &= (1 << self.nbits) - 1 if self.nbits else 0

    def finish(self):
        if self.nbits:
            self.buf.append((self.acc << (8 - self.nbits)) & 0xff)
            self.nbits = 0
        return bytes(self.buf)


def _needed_width(r):
    """kleinste Breite w (1..11), sodass r in (-2^(w-1), 2^(w-1)) liegt; 12 wenn nicht."""
    if r == 0:
        return 1
    a = -r if r < 0 else r
    w = a.bit_length() + 1  # |r| < 2^(w-1)  <=>  bit_length(|r|) <= w-1
    return w if w <= 11 else 12


def _residuals(samples, mode):
    s1 = s2 = s3 = 0
    res = []
    for v in samples:
        res.append(v - _predict(mode, s1, s2, s3))
        s3, s2, s1 = s2, s1, v
    return res


def _dp_encode(samples, res, table):
    """Optimale Breitenwahl per DP. table = 4 Breiten (1..11 oder 16=ungenutzt) + [12].
    Rückgabe: (Bitzahl, Pfad als Liste von Tabellenindizes) oder None, wenn unmöglich."""
    t = list(table) + [12]
    n = len(samples)
    INF = 1 << 60
    # Kosten für Sample i in Zustand j: Breite t[j]
    # Escape-Kosten von j: t[j] + (1 if t[j]==12) + 2
    esc = [t[j] + (1 if t[j] == 12 else 0) + 2 for j in range(5)]
    # Startzustand: j=4 (12 Bit)
    cost = [INF] * 5
    cost[4] = 0
    back = []
    for i in range(n):
        r = res[i]
        nw = _needed_width(r)
        fits = [(t[j] >= nw) if t[j] < 12 else True for j in range(5)]
        # aus Zustand k in Zustand j wechseln (k != j) kostet cost[k] + esc[k]
        sw = [cost[k] + esc[k] for k in range(5)]
        best = min(range(5), key=lambda k: sw[k])
        others = [k for k in range(5) if k != best]
        second = min(others, key=lambda k: sw[k])
        ncost = [INF] * 5
        prev = [0] * 5
        for j in range(5):
            if not fits[j]:
                continue
            stay = cost[j]
            k = second if j == best else best
            switch = cost[k] + esc[k] if cost[k] < INF else INF
            if stay <= switch:
                ncost[j] = stay + t[j]
                prev[j] = j
            else:
                ncost[j] = switch + t[j]
                prev[j] = k
        cost = ncost
        back.append(prev)
    j = min(range(5), key=lambda k: cost[k])
    if cost[j] >= INF:
        return None
    path = [0] * n
    for i in range(n - 1, -1, -1):
        path[i] = j
        j = back[i][j]
    return cost[min(range(5), key=lambda k: cost[k])], path


def _emit(samples, res, table, path):
    t = list(table) + [12]
    bw = _BitWriter()
    bw.put(0, 2)  # der Decoder überspringt die ersten zwei Bits
    idx = 4
    for i, v in enumerate(samples):
        j = path[i]
        if j != idx:
            w = t[idx]
            bw.put(-(1 << (w - 1)), w)  # Escape
            if w == 12:
                bw.put(1, 1)
            sel = j - 1 if j > idx else j
            bw.put(sel, 2)
            idx = j
        w = t[idx]
        bw.put(res[i] if w < 12 else v, w)
    # Polster: Korgs Länge L liegt 0..2 Bytes über dem byte-gerundeten Bitstrom (3997 Werks-
    # Subblöcke gemessen, 2026-09-13); der ARM-Leser (0xC008B8E0) greift ohnehin bis zu 3 Bytes
    # über L hinaus in den nächsten Kopf. 2 Bytes halten uns in Korgs Hülle.
    data = bw.finish() + b"\0\0"
    hdr = bytes([((table[0] - 1) << 4) | (table[1] - 1), ((table[2] - 1) << 4) | (table[3] - 1)])
    return hdr + data


def _candidate_tables(res):
    widths = sorted(_needed_width(r) for r in res)
    n = len(widths)
    cands = set()
    for lo_q in (0.30, 0.50, 0.65):
        w0 = max(1, min(11, widths[int(n * lo_q)]))
        cands.add(tuple(min(11, w0 + k) for k in range(4)))
    for q in ((0.5, 0.75, 0.9, 0.98), (0.4, 0.7, 0.9, 0.99), (0.6, 0.8, 0.93, 0.99)):
        ws = sorted(set(max(1, min(11, widths[min(n - 1, int(n * x))])) for x in q))
        while len(ws) < 4:
            ws.append(16)
        cands.add(tuple(ws[:4]))
    return cands


def encode_block(samples, modes=(0, 1, 2, 3, 4)):
    """samples: 12-bit-Werte (-2047..2047), max 8191. -> Subblock-Bytes inkl. Header."""
    n = len(samples)
    assert 0 < n <= 8191
    best = None
    for mode in modes:
        res = _residuals(samples, mode)
        for table in _candidate_tables(res):
            r = _dp_encode(samples, res, table)
            if r is None:
                continue
            bits, path = r
            if best is None or bits < best[0]:
                best = (bits, mode, table, path, res)
    bits, mode, table, path, res = best
    body = _emit(samples, res, table, path)
    if len(body) > 0xffff:
        return encode_raw12(samples)
    return struct.pack(">HH", (mode << 13) | n, len(body)) + body


def encode_raw12(samples):
    bw = _BitWriter()
    for v in samples:
        bw.put(v, 12)
    return struct.pack(">H", (7 << 13) | len(samples)) + bw.finish()


def quantize16(pcm16):
    """16-bit -> 12-bit (gerundet, auf -2047..2047 geklemmt; -2048 bleibt dem Escape vorbehalten)."""
    out = []
    for s in pcm16:
        v = (s + 8) >> 4
        if v > 2047:
            v = 2047
        elif v < -2047:
            v = -2047
        out.append(v)
    return out


def encode_stream(samples12, block=2048):
    """Liste von 12-bit-Werten -> Stream-Bytes (Blöcke à `block`), Prüfsumme, Anzahl."""
    parts = []
    chk = 0
    for i in range(0, len(samples12), block):
        chunk = samples12[i:i + block]
        parts.append(encode_block(chunk))
        for v in chunk:
            chk = (chk + ((v << 4) & 0xffff)) & M32
    return b"".join(parts), chk, len(samples12)

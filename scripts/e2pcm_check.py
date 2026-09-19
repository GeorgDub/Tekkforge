"""Kennzahlen-Hülle eines KORGelec2PCM-Streams (Gegencheck eigener Bauten gegen das Werk).

Aufruf: python e2pcm_check.py <PCM.VSB> [ab=0xOFFSET]
  Zählt je Subblock Modus, n, Länge L, deklarierte/benutzte Breiten, Escapes, Literal -2048,
  Bitleser-Zustände (r3), Polster hinter dem letzten gelesenen Byte. Gemessen am Werk
  (2026-09-13): Modi 0-4 (+ 1x 7), n immer 2048 außer dem letzten Block (335), Breiten 1-11
  und 16 (= unbenutzter Tabellenplatz), r3 0..18, L = byte-gerundeter Bitstrom + 0..2.
  Eigene Bauten sollen in genau dieser Hülle bleiben.
"""
import struct, sys, collections, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import e2pcm

M32 = 0xffffffff
SMPL = 0x7610
HDR = 0x100


def s32(x):
    x &= M32
    return x - 0x100000000 if x & 0x80000000 else x


def walk(src, mode, pos, n, st):
    b0, b1 = src[pos], src[pos + 1]
    t = [((b0 >> 4) & 0xf) + 1, (b0 & 0xf) + 1, ((b1 >> 4) & 0xf) + 1, (b1 & 0xf) + 1, 12]
    for x in t[:4]:
        st["tw"][x] += 1
    idx, w = 4, 12
    fp = (src[pos + 2] << 24) | (src[pos + 3] << 16) | (src[pos + 4] << 8) | src[pos + 5]
    ip = pos + 6
    r3 = 2
    bits = 2
    s1 = s2 = s3 = 0
    for _ in range(n):
        while True:
            st["r3"][r3] += 1
            if r3 + w > 32:
                st["over32"] += 1
            v = s32(fp << r3) >> (32 - w)
            r3 += w
            bits += w
            if r3 & 0x10:
                fp = ((fp << 16) | (src[ip] << 8) | src[ip + 1]) & M32
                ip += 2
                r3 -= 16
            if v == -(1 << (w - 1)):
                if w == 12:
                    bit = (fp >> (31 - r3)) & 1
                    r3 += 1
                    bits += 1
                    if not bit:
                        st["lit2048"] += 1
                        break
                sel = (fp >> (30 - r3)) & 3
                r3 += 2
                bits += 2
                if sel >= idx:
                    sel += 1
                st["esc"] += 1
                st["used_w"][t[sel]] += 1
                idx = sel
                w = t[idx]
                continue
            break
        if w < 12:
            v += e2pcm._predict(mode, s1, s2, s3)
        if v < -2048 or v > 2047:
            st["range"] += 1
        s3, s2, s1 = s2, s1, v
    return bits


def scan(p, start=0):
    total = struct.unpack_from("<I", p, SMPL + 8)[0]
    sl = SMPL + 0x20
    rem = total
    st = collections.defaultdict(int)
    for k in ("tw", "used_w", "r3", "modes", "n", "Ldelta"):
        st[k] = collections.Counter()
    nsub = 0
    short_mid = 0
    last_n = None
    while rem > 0:
        hdr = (p[sl] << 8) | p[sl + 1]
        n, mode = hdr & 0x1fff, hdr >> 13
        inr = sl >= start
        if mode == 7:
            used = (n * 12 + 7) >> 3
            if inr:
                st["modes"][7] += 1
                st["n"][n] += 1
            sl += 2 + used
        else:
            L = (p[sl + 2] << 8) | p[sl + 3]
            if inr:
                st["modes"][mode] += 1
                st["n"][n] += 1
                bits = walk(p, mode, sl + 4, n, st)
                st["Ldelta"][L - (2 + ((bits + 7) >> 3))] += 1
            sl += 4 + L
        if inr:
            nsub += 1
            if last_n is not None and last_n != 2048:
                short_mid += 1
            last_n = n
        rem -= n
    print(f"{nsub} Subblöcke ab {start:#x}, Stream-Ende {sl:#x}, Samples gesamt {total}")
    print("  Modi:", dict(sorted(st["modes"].items())))
    ns = st["n"]
    print("  n:", dict(sorted(ns.items())) if len(ns) < 12 else f"{len(ns)} Werte, min {min(ns)} max {max(ns)}",
          f"| kurze Blöcke NICHT am Ende: {short_mid}")
    print("  Breiten deklariert:", dict(sorted(st["tw"].items())))
    print("  Breiten benutzt:", dict(sorted(st["used_w"].items())))
    print("  Escapes:", st["esc"], "Literal -2048:", st["lit2048"], "außerhalb 12 Bit:", st["range"], "r3+w>32:", st["over32"])
    print("  r3 gesehen:", sorted(st["r3"]))
    print("  L - byteceil:", dict(sorted(st["Ldelta"].items())))
    bad = []
    if st["over32"] or st["range"]:
        bad.append("Leser-/Wertebereich verletzt")
    if any(w not in range(1, 12) and w != 16 for w in st["tw"]):
        bad.append("deklarierte Breite außerhalb 1..11/16")
    if any(m > 4 and m != 7 for m in st["modes"]):
        bad.append("Modus 5/6 (Werk nutzt sie nie)")
    if short_mid:
        bad.append("kurzer Block mitten im Stream (Werk: nur der letzte)")
    if any(d < 0 or d > 2 for d in st["Ldelta"]):
        bad.append("L außerhalb byteceil+0..2")
    print("HÜLLE OK" if not bad else "AUSSERHALB DER WERKS-HÜLLE: " + "; ".join(bad))
    return not bad


if __name__ == "__main__":
    path = sys.argv[1]
    start = 0
    for a in sys.argv[2:]:
        if a.startswith("ab="):
            start = int(a[3:], 0)
    p = open(path, "rb").read()[HDR:]
    print("Container-Ende", hex(struct.unpack_from("<I", p, 0x30)[0]))
    sys.exit(0 if scan(p, start) else 1)

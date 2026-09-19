"""PCM.VSB bauen: eigene Samples an den Werks-Stream anhängen und SMPR-Einträge umbiegen.

Aufruf: python e2pcm_build.py <werks PCM.VSB> <out PCM.VSB> <Geraet.all> idx=name [idx=name ...]
  idx  = SMPR-Index (= Osz-Programm - 50), name = Sample-Name in der .all-Bank
"""
import struct, sys, time, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # e2pcm.py liegt daneben
import e2pcm

HDR = 0x100
SMPL_SEC = 0x7610
SMPR_SEC = 0x5550
PAYLOAD = 0x800000
TAIL_SILENCE = 64  # Samples Stille, damit die 51-Sample-Endschleife leer ist


def walk_stream_end(p, sec):
    total = struct.unpack_from("<I", p, sec + 8)[0]
    sl = sec + 0x20
    rem = total
    while rem > 0:
        hdr = (p[sl] << 8) | p[sl + 1]
        n, mode = hdr & 0x1fff, hdr >> 13
        if mode == 7:
            sl += 2 + ((n * 12 + 7) >> 3)
        else:
            sl += 4 + ((p[sl + 2] << 8) | p[sl + 3])
        rem -= n
    return sl


def read_all_bank(path):
    d = open(path, "rb").read()
    out = {}
    i = 0
    while True:
        i = d.find(b"RIFF", i)
        if i < 0:
            break
        sz = struct.unpack_from("<I", d, i + 4)[0]
        wav = d[i:i + 8 + sz]
        fmt = wav.find(b"fmt ")
        ch, rate = struct.unpack_from("<HI", wav, fmt + 10)
        dat = wav.find(b"data")
        dlen = struct.unpack_from("<I", wav, dat + 4)[0]
        es = wav.find(b"esli")
        name = wav[es + 10:es + 26].split(b"\0")[0].decode("ascii", "replace")
        pcm = list(struct.unpack_from(f"<{dlen // 2}h", wav, dat + 8))
        if ch == 2:
            pcm = [(pcm[k] + pcm[k + 1]) // 2 for k in range(0, len(pcm) - 1, 2)]
        if rate == 22050:  # linear auf 44100 hochtasten
            up = []
            for k in range(len(pcm)):
                nxt = pcm[k + 1] if k + 1 < len(pcm) else pcm[k]
                up.append(pcm[k])
                up.append((pcm[k] + nxt) // 2)
            pcm = up
            rate = 44100
        out[name] = (pcm, rate)
        i += 8 + sz
    return out


def read_wav(path, target_rate=44100):
    """WAV (PCM 16/24/32 Bit oder Float32, mono/stereo, beliebige Rate) -> int16-Liste @ target_rate."""
    import numpy as np
    d = open(path, "rb").read()
    assert d[:4] == b"RIFF" and d[8:12] == b"WAVE", path
    p = 12
    fmt = None
    data = None
    while p + 8 <= len(d):
        tag = d[p:p + 4]
        sz = struct.unpack_from("<I", d, p + 4)[0]
        if tag == b"fmt ":
            fmt = struct.unpack_from("<HHIIHH", d, p + 8)
        elif tag == b"data":
            data = d[p + 8:p + 8 + sz]
            break
        p += 8 + sz + (sz & 1)
    tagf, ch, rate, _, _, bits = fmt
    if tagf == 3 or bits == 32 and tagf != 1:
        x = np.frombuffer(data[:len(data) // 4 * 4], dtype="<f4").astype(np.float64)
    elif bits == 16:
        x = np.frombuffer(data[:len(data) // 2 * 2], dtype="<i2").astype(np.float64) / 32768.0
    elif bits == 24:
        b = np.frombuffer(data[:len(data) // 3 * 3], dtype=np.uint8).reshape(-1, 3).astype(np.int64)
        v = b[:, 0] | (b[:, 1] << 8) | (b[:, 2] << 16)
        v = np.where(v & 0x800000, v - 0x1000000, v)
        x = v.astype(np.float64) / 8388608.0
    elif bits == 32:
        x = np.frombuffer(data[:len(data) // 4 * 4], dtype="<i4").astype(np.float64) / 2147483648.0
    else:
        raise SystemExit(f"{path}: {bits} Bit nicht unterstützt")
    if ch > 1:
        x = x[:len(x) // ch * ch].reshape(-1, ch).mean(axis=1)
    if rate != target_rate:
        # gefensterte Sinc-Interpolation (Tiefpass bei min(rate, target)/2), 16 Nullstellen je Seite
        ratio = target_rate / rate
        n_out = int(len(x) * ratio)
        cutoff = min(1.0, ratio)  # relativ zur Quellrate
        a = 16
        t = np.arange(n_out) / ratio  # Quellposition je Ausgabesample
        i0 = np.floor(t).astype(np.int64)
        out = np.zeros(n_out)
        wsum = np.zeros(n_out)
        for k in range(-a + 1, a + 1):
            idx = i0 + k
            dt = t - idx
            w = cutoff * np.sinc(cutoff * dt) * (0.5 + 0.5 * np.cos(np.pi * dt / a)) * (np.abs(dt) < a)
            valid = (idx >= 0) & (idx < len(x))
            out += w * np.where(valid, x[np.clip(idx, 0, len(x) - 1)], 0.0)
            wsum += w
        x = out / np.where(wsum == 0, 1.0, wsum)
    y = np.clip(np.round(x * 32767.0), -32768, 32767).astype(np.int64)
    return y.tolist()


def walk_blocks(p, sec):
    """Alle Blöcke der Sektion: Liste von (offset, n, mode, next_offset)."""
    total = struct.unpack_from("<I", p, sec + 8)[0]
    sl = sec + 0x20
    rem = total
    out = []
    while rem > 0:
        hdr = (p[sl] << 8) | p[sl + 1]
        n, mode = hdr & 0x1fff, hdr >> 13
        nxt = sl + 2 + ((n * 12 + 7) >> 3) if mode == 7 else sl + 4 + ((p[sl + 2] << 8) | p[sl + 3])
        out.append((sl, n, mode, nxt))
        sl = nxt
        rem -= n
    return out


def prefix_checksum(p, blocks):
    """Stream-Prüfsumme über die angegebenen Blöcke (dekodiert sie dafür)."""
    chk = 0
    for sl, n, mode, _ in blocks:
        out = []
        if mode == 7:
            c, _ = e2pcm.decode_raw12(p, sl + 2, n, out)
        else:
            c = e2pcm.decode_modes(p, sl + 4, n, mode, out)
        chk = (chk + c) & 0xffffffff
    return chk


def build(werks_path, out_path, replacements, log=print, ueber_werk=False, kuerzen=False):
    """replacements: {smpr_idx: (name, int16-Liste @44.1k)}

    Volumen-Riegel (Gerät gebrickt 2026-09-11 bei +242 k Samples über dem Werk, Ursache offen):
      Standard  -> Abbruch, wenn die Gesamtzahl der Samples das Werk übersteigt.
      kuerzen   -> Werks-Stream am Blockende so kürzen, dass Werk-Rest + eigene <= Werk;
                   verwaiste SMPR-Einträge zeigen auf Stille (Oszillatoren stumm, Boot sicher).
      ueber_werk-> bewusst über das Werk hinaus (nur wenn H1 am Gerät widerlegt ist).
    Alle eigenen Samples werden wie bei Korg als EIN zusammenhängender Stream kodiert:
    nur der allerletzte Block ist kürzer als 2048 (Werk: 3996 x 2048 + 1 x 335).
    """
    f = open(werks_path, "rb").read()
    hdr, p = f[:HDR], bytearray(f[HDR:])
    assert p[:12] == b"KORGelec2PCM"
    werk_count = count = struct.unpack_from("<I", p, SMPL_SEC + 8)[0]
    chk = struct.unpack_from("<I", p, SMPL_SEC + 12)[0]
    blocks = walk_blocks(p, SMPL_SEC)
    end = blocks[-1][3]
    smpr_n = struct.unpack_from("<I", p, SMPR_SEC + 8)[0]
    log(f"Werk: {count} Samples in {len(blocks)} Blöcken, Stream-Ende {end:#x}, frei bis {PAYLOAD:#x}: {PAYLOAD - end} B")

    # eigene Samples zu einem Strom zusammenfügen (Offsets in Samples innerhalb des Anhangs)
    joined = []
    layout = {}
    for idx, (name, pcm) in replacements.items():
        assert 0 <= idx < smpr_n
        s12 = e2pcm.quantize16(pcm) + [0] * TAIL_SILENCE
        layout[idx] = (name, len(joined), len(s12))
        joined += s12
    user_n = len(joined)

    if count + user_n > werk_count:
        if kuerzen:
            keep = 0
            kept = []
            for b in blocks:
                if keep + b[1] + user_n > werk_count:
                    break
                kept.append(b)
                keep += b[1]
            if not kept:
                raise SystemExit("kuerzen: eigene Samples allein sind größer als das Werk")
            log(f"kürze Werk auf {len(kept)} Blöcke = {keep} Samples (weg: {count - keep}), Prüfsumme neu …")
            t0 = time.time()
            chk = prefix_checksum(p, kept)
            log(f"  Prüfsumme des Rests {chk:#x} ({time.time() - t0:.0f}s)")
            count = keep
            end = kept[-1][3]
        elif ueber_werk:
            log(f"⚠ ÜBER WERK: {count + user_n - werk_count} Samples mehr als das Werk (H1 ungeklärt)")
        else:
            raise SystemExit(f"Volumen {count + user_n} > Werk {werk_count}: --kuerzen oder --ueber-werk angeben")

    t0 = time.time()
    stream, c, n = e2pcm.encode_stream(joined)
    log(f"Anhang: {n} Samples, {len(stream)} B ({8 * len(stream) / max(n, 1):.2f} bit/S), {time.time() - t0:.1f}s")
    base = 2 * count
    for idx, (name, off, ln) in layout.items():
        a = base + 2 * off
        c_bytes = 2 * ln
        old = struct.unpack_from("<4I", p, SMPR_SEC + 0x20 + 16 * idx)
        struct.pack_into("<4I", p, SMPR_SEC + 0x20 + 16 * idx, a, c_bytes - 102, c_bytes, 0x10066)
        log(f"  SMPR {idx:3d} <- {name!r}: {ln} Samples, a={a:#x}  (alt a={old[0]:#x} c={old[2]:#x} d={old[3]:#x})")
    count += n
    chk = (chk + c) & 0xffffffff

    # verwaiste Werks-Einträge (Daten hinter dem gekürzten Ende) -> auf die Endstille des ersten Samples
    if kuerzen:
        first = next(iter(layout.values()))
        sil_a = base + 2 * (first[1] + first[2] - TAIL_SILENCE)
        sil_c = 2 * TAIL_SILENCE
        orphans = 0
        for i in range(smpr_n):
            if i in layout:
                continue
            a, b, cc, d = struct.unpack_from("<4I", p, SMPR_SEC + 0x20 + 16 * i)
            if a + cc > 2 * (count - n):
                struct.pack_into("<4I", p, SMPR_SEC + 0x20 + 16 * i, sil_a, sil_c - 102, sil_c, 0x10066)
                orphans += 1
        log(f"  {orphans} verwaiste SMPR-Einträge auf Stille umgebogen")

    if end + len(stream) > PAYLOAD - 2:
        raise SystemExit(f"passt nicht: {end + len(stream)} > {PAYLOAD - 2}")
    p[end:end + len(stream)] = stream
    new_end = end + len(stream)
    for k in range(new_end, PAYLOAD):
        p[k] = 0xff
    struct.pack_into("<I", p, SMPL_SEC + 8, count)
    struct.pack_into("<I", p, SMPL_SEC + 12, chk)
    struct.pack_into("<I", p, 0x30, new_end)
    # Halbwort-Prüfsumme der gesamten 8 MB muss 0 sein -> letztes Halbwort anpassen
    struct.pack_into("<H", p, PAYLOAD - 2, 0)
    s = sum(struct.unpack_from(f"<{PAYLOAD // 2}H", p, 0)) & 0xffff
    struct.pack_into("<H", p, PAYLOAD - 2, (-s) & 0xffff)
    open(out_path, "wb").write(hdr + bytes(p))
    log(f"geschrieben: {out_path} — {count} Samples, Container-Ende {new_end:#x}, Prüfsumme {chk:#x}")
    return bytes(p)


def verify(out_path, replacements, log=print):
    f = open(out_path, "rb").read()
    p = f[HDR:]
    assert len(f) == HDR + PAYLOAD
    hs = sum(struct.unpack_from(f"<{PAYLOAD // 2}H", p, 0)) & 0xffff
    smpl, c, want, end, stats = e2pcm.decode_section(p, SMPL_SEC)
    ok = c == want and hs == 0 and end == struct.unpack_from("<I", p, 0x30)[0]
    log(f"Prüfung: Halbwortsumme {hs}, Stream-Prüfsumme {c:#x} == {want:#x}: {c == want}, Ende {end:#x}, Modi {stats}")
    raw = bytes()
    import array
    a = array.array("H", smpl)
    raw = a.tobytes()
    for idx, (name, pcm) in replacements.items():
        a0, b, cc, d = struct.unpack_from("<4I", p, SMPR_SEC + 0x20 + 16 * idx)
        got = list(struct.unpack_from(f"<{cc // 2}h", raw, a0))
        exp = [(v << 4) for v in e2pcm.quantize16(pcm)] + [0] * TAIL_SILENCE
        same = got == exp
        ok = ok and same
        log(f"  SMPR {idx:3d} {name!r}: {len(got)} Samples zurückgelesen, identisch: {same}, Schleife {b:#x}..{cc:#x}, d={d:#x}")
    log("GESAMT OK" if ok else "FEHLER")
    return ok


if __name__ == "__main__":
    # Quelle: entweder eine .all-Bank (Namen) oder ein Ordner (WAV-Dateien relativ dazu)
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) < 4:
        raise SystemExit(__doc__ + "\nSchalter: --kuerzen (Werk kürzen, Volumen <= Werk)  --ueber-werk (bewusst darüber)")
    werks, out, bank = args[:3]
    samples = read_all_bank(bank) if bank.lower().endswith(".all") else None
    rep = {}
    for arg in args[3:]:
        idx, name = arg.split("=", 1)
        if samples is not None:
            pcm, rate = samples[name]
        else:
            pcm = read_wav(os.path.join(bank, name))
        rep[int(idx)] = (os.path.splitext(os.path.basename(name))[0], pcm)
    build(werks, out, rep, kuerzen="--kuerzen" in flags, ueber_werk="--ueber-werk" in flags)
    verify(out, rep)

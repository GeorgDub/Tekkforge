#!/usr/bin/env python3
"""
make_bootsect.py — Boot-Sektor (128 KiB, AIS + SBL) und BOOT.VSB für die Electribe 2 bauen/prüfen.

Nachbau von vanasoft23/freetribe (Branch bootloader-mess), cpu/src/bootloader/service/boot_section.c:
  Boot-Sektor = AIS-Kopf (40 B, "TIPA", Sequential-Read-Enable, Function-Execute 6 = PLL/Clock,
                Section-Load nach 0x80000000 mit SBL-Größe)
              + SBL-Nutzlast (bootloader.bin, genau 131022 B = 0x20000 - 40 - 8 - 2)
              + AIS-Schwanz (8 B, Jump-and-Close 0x80000000)
              + 16-Bit-LE-Wortsumme über alles davor (2 B)
              = 0x20000 B, landet an Flash-Offset 0 (Selektor 0).

BOOT.VSB = 0x100-Byte-Korg-Kopf + Boot-Sektor. Die Sampler-/Hacktribe-Firmware prüft beim
SD-Update (DATA UTILITY → SOFTWARE UPDATE, Pfad KORG/hacktribe/System/BOOT.VSB) laut Ghidra
(HACKTRIBE.bin, LoadBootVsbToSerialFlash 0xC002F5A8, vanasoft23/electribe2-re):
  +0x00  16 Bytes "KORG SYSTEM FILE"          (ValidateVsbResourceHeaderMagic)
  +0x20  "BOOT" (4 Bytes verglichen)
  +0x2C  00 01 23|24                          (ValidateVsbResourceHeaderType, Modus 1: 0x23 oder 0x24)
  +0x3C  u32 LE Nutzlastlänge == 0x20000      (GetVsbPayloadLength == GetBootVsbFlashSpan)
Alle anderen Kopfbytes werden aus einer Vorlage (z. B. laufende SYSTEM.VSB) übernommen.

⚠ Ein fehlerhafter Boot-Sektor macht das Gerät nur noch per JTAG (J9) erreichbar. Diese Datei
  baut und prüft nur — sie schreibt NICHTS auf die SD-Karte und nichts ins Gerät.

Aufrufe:
  python scripts/make_bootsect.py build  <bootloader.bin> <bootsect.bin>
  python scripts/make_bootsect.py vsb    <bootsect.bin> <vorlage.VSB> <BOOT.VSB> [--id 0x24]
  python scripts/make_bootsect.py check  <bootsect.bin | BOOT.VSB | flashdump.bin>
  python scripts/make_bootsect.py extract <bootsect.bin | flashdump.bin> <sbl_out.bin>
"""
import struct
import sys

BOOTSECT_SIZE = 0x20000
AIS_HEAD = bytes([
    0x54, 0x49, 0x50, 0x41,                                  # "TIPA" AIS-Magic
    0x63, 0x59, 0x53, 0x58,                                  # Sequential Read Enable
    0x0D, 0x59, 0x53, 0x58, 0x06, 0x00, 0x03, 0x00,          # Function Execute 6 (PLL/Clock), 3 Argumente
    0x01, 0x00, 0x18, 0x00, 0x05, 0x02, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00,
    0x01, 0x59, 0x53, 0x58,                                  # Section Load
    0x00, 0x00, 0x00, 0x80,                                  # Zieladresse 0x80000000 (On-Chip-RAM)
    # + u32 LE Sektionsgröße (wird eingesetzt)
])
AIS_TAIL = bytes([0x06, 0x59, 0x53, 0x58, 0x00, 0x00, 0x00, 0x80])  # Jump and Close → 0x80000000
CHECKSUM_LEN = 2
SBL_SIZE = BOOTSECT_SIZE - (len(AIS_HEAD) + 4) - len(AIS_TAIL) - CHECKSUM_LEN  # 131022
VSB_MAGIC = b"KORG SYSTEM FILE"


def checksum16(buf: bytes) -> int:
    s = 0
    for i in range(0, len(buf) - (len(buf) % 2), 2):
        s = (s + buf[i] + (buf[i + 1] << 8)) & 0xFFFF
    return s


def build_bootsect(sbl: bytes) -> bytes:
    if len(sbl) > SBL_SIZE:
        raise SystemExit(f"SBL zu groß: {len(sbl)} > {SBL_SIZE} Bytes")
    if len(sbl) < SBL_SIZE:
        print(f"Hinweis: SBL {len(sbl)} B, wird mit Nullen auf {SBL_SIZE} B aufgefüllt")
        sbl = sbl + bytes(SBL_SIZE - len(sbl))
    body = AIS_HEAD + struct.pack("<I", SBL_SIZE) + sbl + AIS_TAIL
    out = body + struct.pack("<H", checksum16(body))
    assert len(out) == BOOTSECT_SIZE
    return out


def parse_bootsect(buf: bytes):
    """Gibt (ok, Befund-Zeilen, sbl_bytes) zurück; akzeptiert auch größere Flash-Dumps (nimmt die ersten 128 KiB)."""
    lines = []
    ok = True
    if len(buf) < BOOTSECT_SIZE:
        return False, [f"zu kurz: {len(buf)} B < {BOOTSECT_SIZE}"], b""
    buf = buf[:BOOTSECT_SIZE]
    if buf[:4] != b"TIPA":
        return False, ["kein AIS-Magic 'TIPA' am Anfang"], b""
    pos = 4
    sbl = b""
    while pos + 4 <= len(buf):
        op = buf[pos:pos + 4]
        if op[1:4] != b"YSX":
            lines.append(f"  @0x{pos:05X}: unbekanntes Wort {op.hex()} — Ende der Kommandos")
            break
        code = op[0]
        if code == 0x63:
            lines.append(f"  @0x{pos:05X}: Sequential Read Enable")
            pos += 4
        elif code == 0x0D:
            fn, argc = struct.unpack_from("<HH", buf, pos + 4)
            args = struct.unpack_from("<" + "I" * argc, buf, pos + 8)
            lines.append(f"  @0x{pos:05X}: Function Execute {fn} args={[hex(a) for a in args]}")
            pos += 8 + 4 * argc
        elif code == 0x01:
            addr, size = struct.unpack_from("<II", buf, pos + 4)
            lines.append(f"  @0x{pos:05X}: Section Load → 0x{addr:08X}, {size} B (0x{size:X})")
            sbl = buf[pos + 12:pos + 12 + size]
            if addr != 0x80000000:
                ok = False
                lines.append("    ⚠ Zieladresse ist nicht 0x80000000")
            pos += 12 + size
        elif code == 0x06:
            addr, = struct.unpack_from("<I", buf, pos + 4)
            lines.append(f"  @0x{pos:05X}: Jump and Close → 0x{addr:08X}")
            pos += 8
            if addr != 0x80000000:
                ok = False
                lines.append("    ⚠ Einsprung ist nicht 0x80000000")
            break
        else:
            lines.append(f"  @0x{pos:05X}: AIS-Opcode 0x{code:02X} (nicht ausgewertet) — Abbruch")
            ok = False
            break
    stored = struct.unpack_from("<H", buf, pos)[0] if pos + 2 <= len(buf) else None
    calc = checksum16(buf[:pos])
    if stored == calc:
        lines.append(f"  Prüfsumme @0x{pos:05X}: 0x{stored:04X} OK (vanasoft-Konvention)")
    else:
        lines.append(f"  Prüfsumme @0x{pos:05X}: gespeichert {stored!r}, berechnet 0x{calc:04X} — "
                     "weicht ab (bei Korg-Werksflash normal: dort gibt es diese Summe nicht)")
    lines.append(f"  Rest nach dem Kommando-Ende: {BOOTSECT_SIZE - pos - 2} B")
    return ok, lines, sbl


def make_vsb(bootsect: bytes, template_header: bytes, product_id: int) -> bytes:
    if len(bootsect) != BOOTSECT_SIZE:
        raise SystemExit("Boot-Sektor muss genau 0x20000 Bytes haben")
    hdr = bytearray(template_header[:0x100])
    if len(hdr) != 0x100 or hdr[:16] != VSB_MAGIC:
        raise SystemExit("Vorlage hat keinen gültigen 'KORG SYSTEM FILE'-Kopf")
    hdr[0x20:0x28] = b"BOOT" + bytes(4)
    hdr[0x2C:0x2F] = bytes([0x00, 0x01, product_id & 0xFF])
    struct.pack_into("<I", hdr, 0x34, BOOTSECT_SIZE)   # wie in SYSTEM.VSB gespiegelt, wird nicht geprüft
    struct.pack_into("<I", hdr, 0x3C, BOOTSECT_SIZE)   # geprüfte Nutzlastlänge
    return bytes(hdr) + bootsect


def check_vsb(buf: bytes):
    lines = []
    ok = True
    if buf[:16] != VSB_MAGIC:
        return False, ["kein 'KORG SYSTEM FILE'-Magic"]
    name = buf[0x20:0x28].split(b"\0")[0].decode("ascii", "replace")
    ident = (buf[0x2C] << 16) | (buf[0x2D] << 8) | buf[0x2E]
    length = struct.unpack_from("<I", buf, 0x3C)[0]
    rev = (buf[0x2A], buf[0x2B])
    lines.append(f"  Name @0x20: {name!r}   Identität @0x2C: 0x{ident:06X}   Revision @0x2A: {rev}   Länge @0x3C: 0x{length:X}")
    if name != "BOOT":
        lines.append("  (kein BOOT-Kopf — Prüfung als BOOT.VSB nicht anwendbar)")
        return True, lines
    if buf[0x2C] != 0 or buf[0x2D] != 1 or buf[0x2E] not in (0x23, 0x24):
        ok = False
        lines.append("  ⚠ Identität nicht 0x000123/0x000124 — LoadBootVsbToSerialFlash lehnt ab")
    if length != BOOTSECT_SIZE:
        ok = False
        lines.append("  ⚠ Länge != 0x20000 — LoadBootVsbToSerialFlash lehnt ab")
    if len(buf) != 0x100 + BOOTSECT_SIZE:
        ok = False
        lines.append(f"  ⚠ Dateigröße {len(buf)} != 0x{0x100 + BOOTSECT_SIZE:X}")
    ok2, sub, _ = parse_bootsect(buf[0x100:])
    lines += ["  Nutzlast (Boot-Sektor):"] + sub
    return ok and ok2, lines


def main(argv):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass
    if len(argv) < 3:
        print(__doc__)
        return 2
    cmd = argv[1]
    if cmd == "build":
        sbl = open(argv[2], "rb").read()
        out = build_bootsect(sbl)
        open(argv[3], "wb").write(out)
        ok, lines, _ = parse_bootsect(out)
        print(f"geschrieben: {argv[3]} ({len(out)} B)")
        print("\n".join(lines))
        return 0 if ok else 1
    if cmd == "vsb":
        if len(argv) < 5:
            print(__doc__)
            return 2
        pid = 0x24
        if "--id" in argv:
            pid = int(argv[argv.index("--id") + 1], 0)
        bootsect = open(argv[2], "rb").read()
        tmpl = open(argv[3], "rb").read(0x100)
        out = make_vsb(bootsect, tmpl, pid)
        open(argv[4], "wb").write(out)
        ok, lines = check_vsb(out)
        print(f"geschrieben: {argv[4]} ({len(out)} B)")
        print("\n".join(lines))
        return 0 if ok else 1
    if cmd == "check":
        buf = open(argv[2], "rb").read()
        if buf[:16] == VSB_MAGIC:
            ok, lines = check_vsb(buf)
        else:
            ok, lines, _ = parse_bootsect(buf)
        print(f"{argv[2]}: {'OK' if ok else 'FEHLER'}")
        print("\n".join(lines))
        return 0 if ok else 1
    if cmd == "extract":
        buf = open(argv[2], "rb").read()
        if buf[:16] == VSB_MAGIC:
            buf = buf[0x100:]
        ok, lines, sbl = parse_bootsect(buf)
        open(argv[3], "wb").write(sbl)
        print(f"SBL extrahiert: {argv[3]} ({len(sbl)} B)")
        print("\n".join(lines))
        return 0 if ok else 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))

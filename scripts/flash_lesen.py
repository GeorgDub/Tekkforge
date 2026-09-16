#!/usr/bin/env python3
"""
flash_lesen.py — einen Bereich des 16-MiB-Flash der Electribe 2 über Hacktribes SysEx 0x55 lesen
(NUR lesen) und als Datei sichern. Braucht mido + eine Hacktribe-basierte Firmware am USB.

  python scripts/flash_lesen.py <adresse> <laenge> <ausgabe.bin> [port-teilstring] [--kanal 0]

Beispiel — Werks-Boot-Sektor (Rückweg vor jeder Bootloader-Installation):
  python scripts/flash_lesen.py 0 0x20000 "G:/Downloads/TekkForge/Firmware/Werks-Bootsektor.bin"

Protokoll (hacktribe e2sysex.py read_flash, am Gerät 2026-09-16 belegt):
  TX F0 42 3g 00 01 24 55 <syxEnc(addr_le32 ‖ len_le32)> F7
  RX F0 42 3g 00 01 24 54 55 00 <syxEnc(data)> F7
Der KORG-USB-Treiber ist Single-Client: TekkForge/DAW vorher schließen.
"""
import sys
import time

import mido


def syx_enc(byt: bytes) -> list[int]:
    out: list[int] = []
    for i in range(0, len(byt), 7):
        block = byt[i : i + 7]
        hi = 0
        for j, b in enumerate(block):
            if b & 0x80:
                hi |= 1 << j
        out.append(hi)
        out.extend(b & 0x7F for b in block)
    return out


def syx_dec(syx: list[int]) -> bytes:
    out = bytearray()
    for i in range(0, len(syx), 8):
        block = syx[i : i + 8]
        if not block:
            break
        hi = block[0]
        for j, b in enumerate(block[1:]):
            out.append(b | (0x80 if hi & (1 << j) else 0))
    return bytes(out)


def main(argv: list[str]) -> int:
    if len(argv) < 4:
        print(__doc__)
        return 2
    addr = int(argv[1], 0)
    laenge = int(argv[2], 0)
    out_pfad = argv[3]
    port_teil = "electribe"
    kanal = 0
    rest = argv[4:]
    if "--kanal" in rest:
        kanal = int(rest[rest.index("--kanal") + 1], 0)
        del rest[rest.index("--kanal") : rest.index("--kanal") + 2]
    if rest:
        port_teil = rest[0]
    outs = [n for n in mido.get_output_names() if port_teil.lower() in n.lower()]
    ins = [n for n in mido.get_input_names() if port_teil.lower() in n.lower()]
    if not outs or not ins:
        print("Port nicht gefunden. Ausgänge:", mido.get_output_names(), "Eingänge:", mido.get_input_names())
        return 1
    head = [0x42, 0x30 + kanal, 0x00, 0x01, 0x24]
    chunk = 0x100
    daten = bytearray()
    t0 = time.time()
    with mido.open_output(outs[0]) as o, mido.open_input(ins[0]) as i:
        # Eingang leeren
        for _ in i.iter_pending():
            pass
        off = 0
        while off < laenge:
            n = min(chunk, laenge - off)
            a = addr + off
            body = syx_enc(a.to_bytes(4, "little") + n.to_bytes(4, "little"))
            o.send(mido.Message("sysex", data=head + [0x55] + body))
            antwort = None
            t = time.time()
            while time.time() - t < 3.0:
                m = i.receive(block=False)
                if m is None:
                    time.sleep(0.002)
                    continue
                d = list(m.data)
                if m.type == "sysex" and len(d) >= 8 and d[0] == 0x42 and d[5] == 0x54 and d[6] == 0x55:
                    antwort = d
                    break
            if antwort is None:
                print(f"keine Antwort bei 0x{a:X} — Port belegt? Hacktribe? Kanal {kanal}?")
                return 1
            teil = syx_dec(antwort[8:])[:n]
            if len(teil) != n:
                print(f"kurze Antwort bei 0x{a:X}: {len(teil)} von {n}")
                return 1
            daten += teil
            off += n
            if (off // chunk) % 64 == 0 or off == laenge:
                print(f"  {off}/{laenge} Bytes ({time.time() - t0:.0f} s)")
    open(out_pfad, "wb").write(daten)
    print(f"geschrieben: {out_pfad} ({len(daten)} Bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))

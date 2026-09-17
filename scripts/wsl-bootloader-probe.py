#!/usr/bin/env python3
# Bootloader-Reachability-Probe fuer Linux/WSL2 ueber das ALSA-RAWMIDI-Geraet
# (/dev/snd/midiC*D*), NUR Python-stdlib (kein mido/rtmidi/alsa-utils noetig).
# Beweist die Erreichbarkeit: Pivot (0x58) -> Magic (64 01 23 45 67) -> 76 54 32 10.
# Kein bin-Upload (das ist genau der Test, den Windows nicht schaffte).
# WICHTIG: Der Loader RE-INITIALISIERT den USB-MIDI-Endpoint nach dem Pivot;
# darum wird das rawmidi-Geraet NACH dem Pivot neu gesucht und neu geoeffnet.
import os, sys, time, select, glob, re

PIVOT = bytes([0xf0,0x42,0x30,0x00,0x01,0x24,0x58] + [0x00]*10 + [0xf7])
MAGIC = bytes([0xf0,0x42,0x30,0x00,0x01,0x24,0x64,0x01,0x23,0x45,0x67,0xf7])
REPLY = bytes([0x76,0x54,0x32,0x10])

def hx(b): return " ".join(f"{x:02x}" for x in b)

def midi_nodes():
    return sorted(glob.glob("/dev/snd/midiC*D*"))

def card_name(node):
    m = re.search(r"midiC(\d+)D", node)
    if not m: return ""
    try:
        with open(f"/proc/asound/card{m.group(1)}/id") as f:
            return f.read().strip()
    except OSError:
        return ""

def find_electribe():
    for n in midi_nodes():
        nm = card_name(n)
        if "sampler" in nm.lower() or "electribe" in nm.lower():
            return n, nm
    ns = midi_nodes()
    return (ns[0], card_name(ns[0])) if ns else (None, None)

def drain(fd, ms=200):
    end = time.time()+ms/1000
    while time.time() < end:
        r,_,_ = select.select([fd],[],[],0.02)
        if r: os.read(fd, 4096)

def read_reply(fd, want, timeout=1.5):
    buf = bytearray(); end = time.time()+timeout
    while time.time() < end:
        r,_,_ = select.select([fd],[],[],0.05)
        if r:
            buf += os.read(fd, 4096)
            if want in bytes(buf):
                return bytes(buf)
    return bytes(buf)

def main():
    node, nm = find_electribe()
    print("rawmidi-Geraete:", midi_nodes())
    if not node:
        print("FEHLER: kein /dev/snd/midiC*D*. snd-usb-audio geladen? Geraet per usbipd angehaengt?")
        sys.exit(2)
    print(f"benutze {node}  (Karte: {nm})")

    fd = os.open(node, os.O_RDWR)
    print("\n1) Pivot senden (0x58) ...")
    os.write(fd, PIVOT); print("   raus:", hx(PIVOT))
    os.close(fd)
    time.sleep(1.0)

    print("2) rawmidi-Geraet NACH Pivot neu suchen (ueberlebt der Endpoint?) ...")
    node2 = None
    for _ in range(12):
        n2, nm2 = find_electribe()
        if n2:
            node2 = n2
            if n2 != node:
                print(f"   HINWEIS: Geraeteknoten aenderte sich nach Pivot: {node} -> {n2}")
            break
        time.sleep(0.3)
    if not node2:
        print("   BEFUND: electribe-rawmidi ist nach dem Pivot NICHT mehr da.")
        print("   (Ergebnis: der Loader-Endpoint re-enumeriert ueber usbip/WSL nicht sauber.)")
        sys.exit(3)
    print(f"   da: {node2}")

    print("3) Magic senden, warte auf 76 54 32 10 (6 Versuche) ...")
    got = None
    fd = os.open(node2, os.O_RDWR)
    drain(fd, 200)
    for v in range(1, 7):
        os.write(fd, MAGIC)
        rep = read_reply(fd, REPLY, 1.5)
        if REPLY in rep:
            got = rep; break
        if rep:
            print(f"   V{v}: Frame ohne Magic-Antwort: {hx(rep)}")
        else:
            print(f"   V{v}: keine Antwort")
    os.close(fd)

    if got:
        print("\nERFOLG: Loader antwortet ->", hx(got))
        print("Der Custom-Bootloader (execute_freetribe) ist ueber Linux/WSL2 ERREICHBAR.")
        sys.exit(0)
    print("\nBEFUND: Pivot ging raus, Knoten blieb sichtbar, aber keine Magic-Antwort.")
    print("Der Loader antwortet auch ueber ALSA/usbip nicht auf den Handschlag.")
    sys.exit(4)

if __name__ == "__main__":
    main()

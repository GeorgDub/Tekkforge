"""
prep-drogen.py — Ableton-Stem-Export eines Songs (Drums/Bass/Melody/Vocals-
Ordner mit One-Shots und langen Phrasen) fuer die Electribe aufbereiten.

  * Dubletten (gleicher Inhalt) und Fast-Dubletten (gleicher Ordner, gleiche
    Laenge ±20 ms) werden entfernt — es bleibt die lautere Fassung.
  * One-Shots (< 6 s): mono, Stille vorn/hinten weg, normalisiert.
  * Lange Phrasen (>= 6 s): mono, per Varispeed vom Songtempo auf 175 BPM
    (Half-Time: 89,1 → 178,2 BPM, Rate 1,018) und in 4-Tekk-Takt-Chunks
    (5,486 s) geschnitten — Chunks A, B, C … Stille-Chunks fallen weg.
  * Ergebnis: <ziel>/<Name>.wav + <ziel>/manifest.json (Name, Kategorie,
    Gruppe, Art, Laenge) — Eingabe fuer make-folder-bank.mjs.

Aufruf: python scripts/prep-drogen.py [quellordner] [zielordner] [--bpm 89.1]
"""
import hashlib
import io
import json
import os
import re
import sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace") if hasattr(sys.stdout, "buffer") else sys.stdout
import numpy as np
import librosa
import soundfile as sf

_POS = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and not sys.argv[i - 1].startswith("--")]
SRC = _POS[0] if len(_POS) > 0 else r"G:\Mukke Stuff\Musik für Sample\round 1\drogen"
OUT = _POS[1] if len(_POS) > 1 else r"G:\IdeaProjects\TekkForge\examples\e2s\drogen"
SONG_BPM = float(sys.argv[sys.argv.index("--bpm") + 1]) if "--bpm" in sys.argv else 89.1
PREFIX = "Dr"
TARGET_BPM = 175.0
SR = 44100
BAR_T = 240.0 / TARGET_BPM
CHUNK_T = 4 * BAR_T                     # 5,486 s
K = min((0.5, 1.0, 2.0), key=lambda kk: abs(SONG_BPM * kk - TARGET_BPM))
RATE = SONG_BPM * K / TARGET_BPM        # 1,018 bei 89,1
LANG_AB = 6.0
STILLE_DB = -50.0
CHUNK_MIN_DB = -45.0

os.makedirs(OUT, exist_ok=True)

# Ordner → (Kategorie-ID, Gruppenname aus Dateiname)
KAT = {"Drums": None, "Bass": 0, "Melody": 14, "Vocals": 9}
DRUM_KAT = {"Kick": 2, "Snare": 3, "Hat": 5, "Perc": 13}


def log(*a):
    print(*a, flush=True)


def lade(path):
    y, _ = librosa.load(path, sr=SR, mono=True)
    return y.astype(np.float32)


def trimme(y, db=STILLE_DB):
    yt, _ = librosa.effects.trim(y, top_db=-db)
    return yt


def normalisiere(y, peak=0.95):
    p = float(np.max(np.abs(y))) or 1.0
    return y * (peak / p)


def fades(seg, fi_s=0.002, fo_s=0.010):
    seg = seg.copy()
    fi, fo = int(fi_s * SR), int(fo_s * SR)
    if fi and len(seg) > fi:
        seg[:fi] *= np.linspace(0, 1, fi)
    if fo and len(seg) > fo:
        seg[-fo:] *= np.linspace(1, 0, fo)
    return seg


def rms_db(y):
    return float(20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9))


def kurz(s):
    return re.sub(r"[^\x20-\x7e]", "", s)[:16].strip()


# ── Dateien sammeln, Dubletten entfernen ──
dateien = []
gesehen = {}
for ordner in ("Drums", "Bass", "Melody", "Vocals"):
    d = os.path.join(SRC, ordner)
    if not os.path.isdir(d):
        continue
    for f in sorted(os.listdir(d)):
        if not f.lower().endswith(".wav"):
            continue
        p = os.path.join(d, f)
        h = hashlib.md5(open(p, "rb").read()).hexdigest()
        if h in gesehen:
            log(f"  Dublette: {ordner}/{f} == {gesehen[h]}")
            continue
        gesehen[h] = f"{ordner}/{f}"
        m = re.match(r"(\d+)\s*-\s*(\w+)\s+(\w+)", f)
        nr, art, dyn = (int(m.group(1)), m.group(2), m.group(3)) if m else (0, "X", "")
        y = lade(p)
        dateien.append(dict(ordner=ordner, datei=f, nr=nr, art=art, dyn=dyn, y=y, dauer=len(y) / SR, rms=rms_db(y)))

# Fast-Dubletten: gleicher Ordner + Art, Laenge ±20 ms → lautere behalten
behalten = []
for e in dateien:
    zw = next((b for b in behalten if b["ordner"] == e["ordner"] and b["art"] == e["art"] and abs(b["dauer"] - e["dauer"]) < 0.02), None)
    if zw:
        if e["rms"] > zw["rms"]:
            log(f"  Fast-Dublette: {zw['datei']} ersetzt durch lautere {e['datei']}")
            behalten[behalten.index(zw)] = e
        else:
            log(f"  Fast-Dublette: {e['datei']} (leiser als {zw['datei']}) weg")
        continue
    behalten.append(e)

# ── Aufbereiten ──
manifest = []
zaehler = {}


def name_fuer(gruppe, suffix=""):
    zaehler[gruppe] = zaehler.get(gruppe, 0) + 1
    n = f"{PREFIX} {gruppe}{zaehler[gruppe]}{suffix}"
    return kurz(n)


def schreibe(name, y, kat, gruppe, art, quelle, extra=None):
    pfad = os.path.join(OUT, f"{name}.wav")
    sf.write(pfad, y, SR, subtype="PCM_16")
    manifest.append(dict(file=os.path.basename(pfad), name=name, category=kat, group=gruppe, kind=art,
                         source=quelle, seconds=round(len(y) / SR, 3), rms=round(rms_db(y), 1), **(extra or {})))
    log(f"  {name:16s} {art:7s} {len(y)/SR:6.2f}s  {rms_db(y):6.1f} dBFS  ← {quelle}")


log(f"Song {SONG_BPM} BPM · k={K} · Varispeed-Rate {RATE:.4f} · Chunk {CHUNK_T:.3f} s")
for e in behalten:
    quelle = f"{e['ordner']}/{e['datei']}"
    if e["ordner"] == "Drums":
        kat = DRUM_KAT.get(e["art"], 13)
        gruppe = e["art"] + ("L" if e["dyn"].lower().startswith("loud") else "S")
        y = normalisiere(fades(trimme(e["y"])))
        schreibe(name_fuer(gruppe), y, kat, gruppe, "oneshot", quelle)
        continue
    kat = KAT[e["ordner"]]
    if e["dauer"] < LANG_AB:
        gruppe = {"Bass": "Bass", "Melody": "Stab", "Vocals": "Vox"}[e["ordner"]]
        y = normalisiere(fades(trimme(e["y"])))
        schreibe(name_fuer(gruppe), y, kat, gruppe, "oneshot", quelle)
        continue
    # lange Phrase: Varispeed, dann Chunks
    gruppe = {"Bass": "Bass", "Melody": "Melo", "Vocals": "Vers"}[e["ordner"]]
    zaehler[gruppe] = zaehler.get(gruppe, 0) + 1
    basisname = f"{PREFIX} {gruppe}{zaehler[gruppe]}"
    y = librosa.resample(e["y"], orig_sr=SR, target_sr=SR * RATE, res_type="soxr_hq") if abs(RATE - 1) > 0.002 else e["y"]
    y = normalisiere(y)
    n = int(round(CHUNK_T * SR))
    anzahl = len(y) // n
    rest = (len(y) - anzahl * n) / SR
    log(f"  {basisname}: {e['dauer']:.1f}s → {len(y)/SR:.1f}s @175, {anzahl} Chunks (Rest {rest:.1f}s)")
    for c in range(anzahl):
        seg = fades(y[c * n:(c + 1) * n], 0.002, 0.004)
        if rms_db(seg) < CHUNK_MIN_DB:
            log(f"    Chunk {chr(65+c)} still ({rms_db(seg):.1f} dBFS) — weg")
            continue
        schreibe(kurz(f"{basisname} {chr(65 + c)}"), seg, kat, gruppe + str(zaehler[gruppe]), "loop", quelle,
                 dict(chunk=c, chunks=anzahl))

with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fh:
    json.dump(dict(prefix=PREFIX, song_bpm=SONG_BPM, rate=round(RATE, 4), target_bpm=TARGET_BPM, samples=manifest), fh, ensure_ascii=False, indent=1)
gesamt = sum(m["seconds"] for m in manifest)
log(f"\n{len(manifest)} Samples · {gesamt:.1f} s ≈ {gesamt*2*SR/1048576:.1f} MB → {OUT}")

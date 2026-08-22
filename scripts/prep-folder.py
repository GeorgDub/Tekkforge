"""
prep-folder.py — einen beliebigen Sample-Ordner (One-Shots, Loops, Vocals,
ganze Tracks, Stems) fuer eine Electribe-2-Sampler-Bank aufbereiten.

  * Eingabe: alle wav/aif/mp3/m4a eines Ordners (flach). Unlesbare und
    praktisch stille Dateien (Peak < 0,05) fallen weg, Dubletten (gleicher
    Inhalt oder gleiche Laenge + Korrelation > 0,98) ebenfalls.
  * Rolle je Datei aus Dateiname + Laenge + Pegel (kick, snare, clap, hat,
    perc, ton, bass, fx, vox, melo, track) — korrigierbar per --overrides
    JSON {"<datei>": "<rolle>"} oder {"<datei>": {"role": .., "name": ..}}.
  * One-Shots: mono 44,1 k, Stille weg, Fades, normalisiert auf 0,95.
  * Loops/Phrasen (>= 2,5 s): wenn die Laenge bis auf ±12 % ganze Takte beim
    Bank-Tempo ergibt → per Varispeed exakt auf Takte gebracht. Bis 8 Takte
    bleibt die Melodie GANZ (8-Takter laufen am Geraet ueber das Alternate-
    Paar: 13 spielt, 14 schweigt); laenger → genau zwei Haelften A/B.
  * Vocal-Sammlungen (Stimme, 12–60 s ohne BPM im Namen) werden an Pausen
    in Shots zerlegt (die lautesten 16).
  * Tracks (> 60 s) und Stems ("-other-"/"-vocals-" im Namen, "<n>bpm"):
    Tempo aus dem Namen oder gemessen, Half-/Double-Time auf das Bank-Tempo,
    Varispeed, Downbeat-Raster, dann 8-Takt-Fenster ausgewaehlt (DROP =
    lautestes, BREAK = leisestes in der Mitte, VAR = harmonisch am weitesten
    vom DROP, INTRO = erstes hoerbare), jedes Fenster als EIN Sample. Vollmixe gehen dafuer durch Demucs (htdemucs): MELO = "other",
    VOX = "vocals" (nur wenn hoerbar). --no-demucs nimmt den Vollmix.
  * Ergebnis: <ziel>/<Name>.wav + <ziel>/manifest.json (file, name,
    category, group, family, role, kind, bars, seconds …) — Eingabe fuer
    make-folder-bank.mjs / make-folder-set.mjs.

Aufruf: python scripts/prep-folder.py <quelle> <ziel> --prefix Xx --bpm 180
          [--overrides datei.json] [--dry] [--no-demucs] [--track-windows 3]
          [--max-seconds 235] [--vox-split 12]
          [--select [--volume N] [--max-file-seconds 20]]
            --select: Ordner groesser als das RAM-Budget → Rangliste (taktgenaue
            1–8-Takt-Loops, laut, "melo" im Namen, je Namensfamilie erst das
            beste) in Budget-Scheiben; --volume N nimmt die N-te Scheibe.
"""
import hashlib
import io
import json
import os
import re
import subprocess
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace") if hasattr(sys.stdout, "buffer") else sys.stdout
import numpy as np
import librosa
import soundfile as sf

# ── Argumente ──────────────────────────────────────────────────────────────
_MIT_WERT = {"--prefix", "--bpm", "--overrides", "--track-windows", "--max-seconds", "--vox-windows", "--vox-split", "--volume", "--max-file-seconds"}
_POS = [a for i, a in enumerate(sys.argv[1:], 1) if not a.startswith("--") and sys.argv[i - 1] not in _MIT_WERT]


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


SRC = _POS[0]
OUT = _POS[1]
PREFIX = arg("--prefix", "Xx")
TARGET_BPM = float(arg("--bpm", "180"))
OVERRIDES = json.load(open(arg("--overrides", None), encoding="utf-8")) if "--overrides" in sys.argv else {}
DRY = "--dry" in sys.argv
NO_DEMUCS = "--no-demucs" in sys.argv
TRACK_WINDOWS = int(arg("--track-windows", "3"))
VOX_WINDOWS = int(arg("--vox-windows", "2"))
MAX_SECONDS = float(arg("--max-seconds", "235"))
SELECT = "--select" in sys.argv            # Auswahl bis zum Budget statt alles
VOLUME = int(arg("--volume", "1"))          # n-te Scheibe der Rangliste
MAX_FILE_SECONDS = float(arg("--max-file-seconds", "20")) if SELECT else 1e9

SR = 44100
BEAT_T = 60.0 / TARGET_BPM
BAR_T = 4 * BEAT_T
CHUNK_BARS = 4
LANG_AB = 2.5          # ab hier Loop/Phrase statt One-Shot
TRACK_AB = 60.0        # ab hier ganzer Track
VOXSAMMLUNG_AB = float(arg("--vox-split", "12"))  # Vocal-Datei ohne BPM ab hier: Shots an Pausen
STILL_PEAK = 0.05
TAKT_TOLERANZ = 0.12

KAT = {"bass": 0, "kick": 2, "snare": 3, "clap": 4, "hat": 5, "ton": 7, "vox": 9, "fx": 11, "perc": 13, "melo": 15}
ROLLEN = set(KAT) | {"track"}

try:
    import imageio_ffmpeg
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except Exception:
    FFMPEG = None


def log(*a):
    print(*a, flush=True)


# ── Laden ──────────────────────────────────────────────────────────────────
def lade(path):
    """mono float32 @ SR; mp3/m4a notfalls per ffmpeg."""
    ext = path.lower().rsplit(".", 1)[-1]
    if ext in ("m4a", "aac", "ogg", "opus") or (ext == "mp3" and FFMPEG):
        if not FFMPEG:
            raise RuntimeError("kein ffmpeg (pip install imageio-ffmpeg)")
        raw = subprocess.run([FFMPEG, "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(SR), "-"],
                             capture_output=True).stdout
        y = np.frombuffer(raw, dtype=np.float32).copy()
        if not len(y):
            raise RuntimeError("ffmpeg lieferte nichts")
        return y
    y, _ = librosa.load(path, sr=SR, mono=True)
    return y.astype(np.float32)


def rms_db(y):
    return float(20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9)) if len(y) else -120.0


def trimme(y, db=50):
    yt, _ = librosa.effects.trim(y, top_db=db)
    return yt if len(yt) > 64 else y


def normalisiere(y, peak=0.95):
    p = float(np.max(np.abs(y))) or 1.0
    return (y * (peak / p)).astype(np.float32)


def fades(seg, fi_s=0.002, fo_s=0.010):
    seg = seg.copy()
    fi, fo = int(fi_s * SR), int(fo_s * SR)
    if fi and len(seg) > fi:
        seg[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)
    if fo and len(seg) > fo:
        seg[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32)
    return seg


def varispeed(y, rate):
    """rate > 1 → kuerzer/hoeher."""
    if abs(rate - 1) < 0.002:
        return y
    return librosa.resample(y, orig_sr=SR, target_sr=SR * rate, res_type="soxr_hq").astype(np.float32)


# ── Namen ──────────────────────────────────────────────────────────────────
_UML = str.maketrans({"ä": "ae", "ö": "oe", "ü": "ue", "Ä": "Ae", "Ö": "Oe", "Ü": "Ue", "ß": "ss"})
_vergeben = set()


def saubere(s, maxlen=16):
    s = s.translate(_UML)
    s = re.sub(r"[^\x20-\x7e]", "", s)
    s = re.sub(r"[_]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:maxlen].strip()


def eindeutig(name):
    basis = name
    n = 2
    while name.lower() in _vergeben:
        suffix = str(n)
        name = (basis[: 16 - len(suffix)]).rstrip() + suffix
        n += 1
    _vergeben.add(name.lower())
    return name


def familie(stem):
    s = stem.lower().translate(_UML)
    s = re.sub(r"\(.*?\)", "", s)
    s = re.sub(r"^\d+\s*", "", s)
    s = re.sub(r"[\s_\-!#.]*\d+[\s_\-!#.\d]*$", "", s)
    s = re.sub(r"[\s_\-!#.]+", " ", s).strip()
    return s or stem.lower()


# ── Rollen ─────────────────────────────────────────────────────────────────
RE = {
    "vox": r"vocal|vokal|vox\b|audio|whatsapp|stimme|voice|communic|prophet|gzuz|abriss|gefuehl|nase|seen me|gibs tekk|katze",
    "fx": r"\bfx\b|effekt|effect|sweep|alarm|riser|noise|quietsch|schall|aufgeschlizt|impact|crash|scratch",
    "melo": r"melo|mello|synth|syme|pad\b|\d+(me|sp)\w*heiko|liebestrank|krossi|lackleder|mega ton|metropole|\bbgg\b|biese|hawk|bush|devillache|hyper|barett|hibliebe|honig|hpbe|intro|default|dhrc|sound|ancer|lead|chord|string|piano|arp",
    "kick": r"kick|kicker|kiuck|\bbd\b|bassdrum|bumbug|\bki\d|tetoki|vink\d|bilanz|kank|tropf|turbo|toumoux|hard french|taeter drum|bern drum|hardki|emmaki|luzz\d? 16|druff|hub kick|homm|\bexo|dudibrumm|geil\b|boooffl|futeloser|baus\d|\bbreak\b|piup|aniki",
    "bass": r"bass|bas\b|\bsub\b|808 bass",
    "snare": r"snar|snair|snarre|snaare|\bsn\d|\bsd\b|rim",
    "clap": r"clap|klatsch|handclap",
    "hat": r"\bhat|hihat|hi-hat|\bhh\b|eatclose|eatopen|zlzzer|cymbal|ride|crash",
    "ton": r"\bton\b|\bto\[n\]|ton[-_ ]?\d|_ton|teeton|tee ton|techno ton|tekke ton|tontekk|\bfuer\b|\btab\b|\bdn\b|foterlo|bussmj|moral|rtw|\bfote",
    "perc": r"perc|shaker|tom\b|conga|bongo|tab\b|wood|click",
}


def rolle_fuer(stem, dauer, rms, peak):
    s = re.sub(r"[_]+", " ", stem.lower().translate(_UML))
    if dauer >= TRACK_AB:
        return "track"
    if re.search(r"\d+\s*bpm", s) and dauer >= VOXSAMMLUNG_AB:
        return "track"
    if re.search(RE["vox"], s):
        return "vox"
    if re.search(RE["fx"], s) and not re.search(RE["hat"], s):
        return "fx"
    if re.search(RE["kick"], s):
        return "kick"
    if re.search(RE["bass"], s):
        return "bass"
    if re.search(RE["clap"], s):
        return "clap"
    if re.search(RE["snare"], s):
        return "snare"
    if re.search(RE["hat"], s):
        return "hat"
    if re.search(RE["melo"], s) and dauer >= 1.0:
        return "melo"
    if re.search(RE["ton"], s):
        return "ton" if dauer < LANG_AB else "melo"
    if re.search(RE["perc"], s):
        return "perc"
    # Fallback ueber Laenge/Pegel
    if dauer >= LANG_AB:
        return "melo"
    if dauer < 0.9 and rms > -8.5:
        return "kick"
    if dauer < 0.6:
        return "perc"
    return "ton"


# ── Sammeln ────────────────────────────────────────────────────────────────
os.makedirs(OUT, exist_ok=True)
eintraege = []
hashes = {}
for f in sorted(os.listdir(SRC), key=str.lower):
    ext = f.lower().rsplit(".", 1)[-1] if "." in f else ""
    if ext not in ("wav", "aif", "aiff", "flac", "mp3", "m4a", "ogg"):
        continue
    p = os.path.join(SRC, f)
    h = hashlib.md5(open(p, "rb").read()).hexdigest()
    if h in hashes:
        log(f"  Dublette        {f}  ==  {hashes[h]}")
        continue
    hashes[h] = f
    try:
        y = lade(p)
    except Exception as e:
        log(f"  UNLESBAR        {f}  ({str(e).splitlines()[0][:60]})")
        continue
    peak = float(np.max(np.abs(y))) if len(y) else 0.0
    if peak < STILL_PEAK or len(y) < 64:
        log(f"  still/leer      {f}  (Peak {peak:.3f})")
        continue
    stem = f.rsplit(".", 1)[0]
    dauer = len(y) / SR
    e = dict(datei=f, stem=stem, y=y, dauer=dauer, rms=rms_db(y), peak=peak)
    ov = OVERRIDES.get(f) or OVERRIDES.get(stem)
    if isinstance(ov, str):
        ov = {"role": ov}
    if ov and ov.get("role") == "skip":
        log(f"  uebersprungen   {f}  (overrides)")
        continue
    e["rolle"] = (ov or {}).get("role") or rolle_fuer(stem, dauer, e["rms"], peak)
    e["name_ov"] = (ov or {}).get("name")
    e["bars_ov"] = (ov or {}).get("bars")
    if e["rolle"] not in ROLLEN:
        raise SystemExit(f"{f}: unbekannte Rolle {e['rolle']}")
    eintraege.append(e)

# Fast-Dubletten: gleiche Laenge (±5 ms) und Korrelation > 0,98 → lautere behalten
behalten = []
for e in eintraege:
    dup = None
    for b in behalten:
        if abs(b["dauer"] - e["dauer"]) > 0.05 or e["dauer"] > 30:
            continue
        n = min(len(b["y"]), len(e["y"]), int(0.2 * SR) if e["dauer"] < 2.5 else len(e["y"]))
        a1, a2 = b["y"][:n], e["y"][:n]
        c = float(np.dot(a1, a2) / (np.linalg.norm(a1) * np.linalg.norm(a2) + 1e-9))
        if c > 0.98:
            dup = b
            break
    if dup:
        if e["rms"] > dup["rms"] + 0.5:
            log(f"  Fast-Dublette   {dup['datei']}  ersetzt durch lautere  {e['datei']}")
            behalten[behalten.index(dup)] = e
        else:
            log(f"  Fast-Dublette   {e['datei']}  ==  {dup['datei']}")
        continue
    behalten.append(e)

if SELECT:
    # Rangliste: taktgenaue 1–8-Takt-Loops zuerst, laut vor leise, "melo" im Namen bevorzugt;
    # je Namensfamilie zunaechst nur das beste, dann Volume-Scheibe bis zum Budget.
    def score(e):
        bars = e["dauer"] / BAR_T
        fit = abs(bars - round(bars)) / max(1, round(bars))
        sc = -fit * 10 + min(e["rms"], -8) / 10
        if 2.5 <= e["dauer"] <= 11:
            sc += 2
        if round(bars) in (4, 8):
            sc += 1
        if "melo" in e["stem"].lower():
            sc += 1
        return sc
    kand = sorted([e for e in behalten if e["dauer"] <= MAX_FILE_SECONDS and e["rolle"] != "track"], key=score, reverse=True)
    erste, zweite, gesehen_fam = [], [], set()
    for e in kand:
        fam = familie(e["stem"])
        (zweite if fam in gesehen_fam else erste).append(e)
        gesehen_fam.add(fam)
    rang = erste + zweite
    scheiben, akt, summe = [], [], 0.0
    for e in rang:
        if summe + e["dauer"] > MAX_SECONDS and akt:
            scheiben.append(akt)
            akt, summe = [], 0.0
        akt.append(e)
        summe += e["dauer"]
    if akt:
        scheiben.append(akt)
    if VOLUME > len(scheiben):
        raise SystemExit(f"nur {len(scheiben)} Volumes moeglich")
    log(f"\nAuswahl: {len(rang)} Kandidaten ({sum(e['dauer'] for e in rang):.0f} s) → {len(scheiben)} Volumes a {MAX_SECONDS:.0f} s; Volume {VOLUME} mit {len(scheiben[VOLUME - 1])} Dateien")
    log(f"  weggelassen: {len(behalten) - len(rang)} Dateien > {MAX_FILE_SECONDS:.0f} s / Tracks")
    behalten = scheiben[VOLUME - 1]


log(f"\n{len(behalten)} Dateien · Bank-Tempo {TARGET_BPM:g} BPM · Takt {BAR_T:.3f} s · 4 Takte {4 * BAR_T:.3f} s")
if DRY:
    for e in sorted(behalten, key=lambda e: (e["rolle"], e["datei"].lower())):
        log(f"  {e['rolle']:6s} {e['dauer']:7.2f}s {e['rms']:6.1f}dB  {e['datei']}   [{familie(e['stem'])}]")
    sys.exit(0)

# ── Schreiben ──────────────────────────────────────────────────────────────
manifest = []
gesamt = 0.0


def schreibe(name, y, rolle, kind, quelle, bars=0, gruppe=None, fam=None, extra=None):
    global gesamt
    name = eindeutig(saubere(name))
    pfad = os.path.join(OUT, f"{name}.wav")
    sf.write(pfad, y, SR, subtype="PCM_16")
    m = dict(file=os.path.basename(pfad), name=name, category=KAT.get(rolle, 16), role=rolle,
             group=gruppe or rolle, family=fam or rolle, kind=kind, bars=bars, source=quelle,
             seconds=round(len(y) / SR, 3), rms=round(rms_db(y), 1))
    m.update(extra or {})
    manifest.append(m)
    gesamt += len(y) / SR
    log(f"  {name:16s} {rolle:5s} {kind:7s} {len(y) / SR:6.2f}s {bars:>2}T {rms_db(y):6.1f}dB  <- {quelle}")
    return m


def oneshot(e):
    y = normalisiere(fades(trimme(e["y"], 50)))
    schreibe(e["name_ov"] or e["stem"], y, e["rolle"], "oneshot", e["datei"], fam=familie(e["stem"]))


def auf_takte(y, bars_ist, erlaubt=tuple(range(1, 17))):
    """Naechste ganze Taktzahl in Toleranz → (y_varispeed, bars) oder (y, 0)."""
    kand = min(erlaubt, key=lambda b: abs(bars_ist - b))
    if abs(bars_ist - kand) / kand <= TAKT_TOLERANZ:
        ziel = kand * BAR_T
        rate = (len(y) / SR) / ziel
        y2 = varispeed(y, rate)
        n = int(round(ziel * SR))
        y2 = y2[:n] if len(y2) >= n else np.pad(y2, (0, n - len(y2)))
        return y2, kand
    return y, 0


def chunks_schreiben(basisname, y, bars, rolle, quelle, fam, gruppe):
    """Bis 8 Takte bleibt die Melodie ganz; laenger → genau zwei Haelften A/B."""
    if bars <= 8:
        schreibe(basisname, normalisiere(fades(y, 0.002, 0.004)), rolle, "loop", quelle, bars=bars, fam=fam, gruppe=gruppe)
        return
    h = len(y) // 2
    base = saubere(basisname, 14)
    log(f"    {bars} Takte → zwei Haelften a {bars / 2:g} Takte")
    for i, seg in enumerate((y[:h], y[h:])):
        schreibe(f"{base} {chr(65 + i)}", normalisiere(fades(seg, 0.002, 0.004)), rolle, "loop", quelle,
                 bars=round(bars / 2), fam=fam, gruppe=gruppe, extra=dict(chunk=i, chunks=2))


def loop_oder_phrase(e):
    """Melo/FX/Vox >= 2,5 s: auf Takte bringen und ggf. chunken, sonst Phrase."""
    y = trimme(e["y"], 45) if e["rolle"] != "melo" else e["y"]
    bars_ist = len(y) / SR / BAR_T
    if e["bars_ov"]:
        ziel = e["bars_ov"] * BAR_T
        y = varispeed(y, (len(y) / SR) / ziel)
        n = int(round(ziel * SR))
        y, bars = (y[:n] if len(y) >= n else np.pad(y, (0, n - len(y)))), e["bars_ov"]
    else:
        y, bars = auf_takte(y, bars_ist)
    name = e["name_ov"] or e["stem"]
    fam = familie(e["stem"])
    if bars:
        log(f"  {e['datei']}: {bars_ist:.2f} → {bars} Takte (Varispeed {len(e['y']) / len(y):.3f})")
        chunks_schreiben(name, y, bars, e["rolle"], e["datei"], fam, f"{e['rolle']}:{fam}")
    elif bars_ist > 8:
        # keine ganze Taktzahl, aber lang — ganz lassen bzw. halbieren, nicht zerstueckeln
        log(f"  {e['datei']}: {bars_ist:.2f} Takte, kein Raster → als Ganzes ({round(bars_ist)} Takte)")
        chunks_schreiben(name, y, round(bars_ist), e["rolle"], e["datei"], fam, f"{e['rolle']}:{fam}")
    else:
        log(f"  {e['datei']}: {bars_ist:.2f} Takte → Phrase (One-Shot)")
        schreibe(name, normalisiere(fades(y, 0.002, 0.01)), e["rolle"], "oneshot", e["datei"], fam=fam)


def vox_sammlung(e):
    """Lange Vocal-Datei ohne Tempo: an Pausen in Shots zerlegen, lauteste 16."""
    y = normalisiere(e["y"])
    segs = []
    for top_db in (32, 24, 18):  # Film-Ton mit Grundrauschen braucht eine haertere Schwelle
        grenzen = librosa.effects.split(y, top_db=top_db, frame_length=2048, hop_length=512)
        segs = []
        for a, b in grenzen:
            if segs and a - segs[-1][1] < 0.25 * SR:
                segs[-1][1] = b
            else:
                segs.append([a, b])
        segs = [(a, b) for a, b in segs if 0.25 * SR <= b - a <= 4.5 * SR]
        if len(segs) >= 3:
            break
    segs.sort(key=lambda ab: -rms_db(y[ab[0]:ab[1]]))
    segs = sorted(segs[:16])
    log(f"  {e['datei']}: {len(grenzen)} Abschnitte → {len(segs)} Shots")
    if len(segs) < 3:
        log("    zu wenig Pausen → Takt-Chunks statt Shots")
        loop_oder_phrase(e)
        return
    base = saubere(e["name_ov"] or e["stem"], 12)
    for i, (a, b) in enumerate(segs):
        seg = y[max(0, a - int(0.01 * SR)):b + int(0.05 * SR)]
        schreibe(f"{base} {i + 1}", normalisiere(fades(seg, 0.003, 0.02)), "vox", "oneshot", e["datei"],
                 fam=familie(e["stem"]), gruppe="voxshot")


# ── Tracks / Stems ─────────────────────────────────────────────────────────
_DEMUCS = None


def demucs_stems(y_mono, quellen):
    """Demucs auf einem Mono-Fenster; liefert dict source → mono."""
    global _DEMUCS
    import torch
    from demucs.pretrained import get_model
    from demucs.apply import apply_model
    if _DEMUCS is None:
        _DEMUCS = get_model("htdemucs")
        _DEMUCS.eval()
    wav = torch.from_numpy(np.stack([y_mono, y_mono]).astype(np.float32))[None]
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)
    with torch.no_grad():
        out = apply_model(_DEMUCS, wav, device="cpu", progress=False, shifts=1, overlap=0.25)[0]
    out = out * (ref.std() + 1e-8) + ref.mean()
    return {s: out[i].numpy().mean(axis=0) for i, s in enumerate(_DEMUCS.sources) if s in quellen}


def tempo_messen(y):
    """Takt-Autokorrelation der Onset-Kurve, 80–200 BPM in 0,25er-Schritten."""
    ya = librosa.resample(y, orig_sr=SR, target_sr=22050, res_type="polyphase")
    hop = 128
    on = librosa.onset.onset_strength(y=ya, sr=22050, hop_length=hop)
    ac = librosa.autocorrelate(on)
    fps = 22050 / hop
    best, bestv = TARGET_BPM, -1.0
    for bpm in np.arange(80, 200, 0.25):
        lag = int(round(4 * 60 * fps / bpm))
        if 0 < lag < len(ac) and ac[lag] > bestv:
            bestv, best = ac[lag], float(bpm)
    return best


def downbeat_phase(y, beat_t):
    """Beat-Raster und Downbeat-Versatz: Phase 0..3 mit meister Bassenergie."""
    ya = librosa.resample(y, orig_sr=SR, target_sr=22050, res_type="polyphase")
    on = librosa.onset.onset_strength(y=ya, sr=22050, hop_length=512)
    _, beats = librosa.beat.beat_track(onset_envelope=on, sr=22050, hop_length=512, bpm=60.0 / beat_t, units="time")
    if len(beats) < 8:
        return 0.0
    low = librosa.feature.rms(y=librosa.effects.preemphasis(ya, coef=-0.97), frame_length=2048, hop_length=512)[0]
    lt = librosa.frames_to_time(np.arange(len(low)), sr=22050, hop_length=512)
    bl = np.interp(beats, lt, low)
    ph = [bl[i::4].mean() for i in range(4)]
    i0 = int(np.argmax(ph))
    return float(beats[i0]) % (4 * beat_t)


def track(e):
    """Ganzer Track oder Stem → Fenster-Auswahl."""
    s = e["stem"].lower()
    art = "vox" if re.search(r"-?vocals?-|\bvocals?\b|vox", s) else "melo" if re.search(r"-other-|instrumental|-bass-|-drums-|inst\b", s) else "mix"
    m = re.search(r"(\d+(?:[.,]\d+)?)\s*bpm", s)
    y0 = normalisiere(e["y"])
    bpm = float(m.group(1).replace(",", ".")) if m else tempo_messen(y0)
    k = min((0.5, 1.0, 2.0), key=lambda kk: abs(bpm * kk - TARGET_BPM))
    rate = bpm * k / TARGET_BPM
    y = varispeed(y0, rate)
    log(f"  {e['datei']}: {len(e['y']) / SR:.0f} s · {bpm:.1f} BPM · k={k} · Varispeed {rate:.4f} · Art {art}")
    off = downbeat_phase(y, BEAT_T)
    fenster_bars = 8 if art != "vox" else 4
    n = int(round(fenster_bars * BAR_T * SR))
    starts = np.arange(off * SR, len(y) - n, n).astype(int)
    if not len(starts):
        log("    zu kurz fuer ein Fenster")
        return
    segs = [y[a:a + n] for a in starts]
    pegel = np.array([rms_db(sg) for sg in segs])
    hoerbar = np.where(pegel > -35)[0]
    log(f"    Downbeat-Versatz {off:.2f} s · {len(segs)} Fenster a {fenster_bars} Takte · {len(hoerbar)} hoerbar · Pegel {pegel.max():.0f}…{pegel.min():.0f} dB")
    if not len(hoerbar):
        log("    nichts hoerbar")
        return
    chroma = [librosa.feature.chroma_cqt(y=sg, sr=SR).mean(axis=1) for sg in segs]
    chroma = [c / (np.linalg.norm(c) + 1e-9) for c in chroma]
    gew = {}
    anzahl = VOX_WINDOWS if art == "vox" else TRACK_WINDOWS
    if art == "vox":
        # lauteste Fenster, nicht direkt benachbart, in Zeitreihenfolge VX1..VXn
        wahl = []
        for i in sorted(hoerbar, key=lambda i: -pegel[i]):
            if len(hoerbar) <= anzahl or all(abs(i - j) >= 2 for j in wahl):
                wahl.append(int(i))
            if len(wahl) >= anzahl:
                break
        for j, i in enumerate(sorted(wahl)):
            gew[f"VX{j + 1}"] = i
        anzahl = 0
    else:
        gew["DROP"] = int(hoerbar[np.argmax(pegel[hoerbar])])
    if anzahl >= 2:
        mitte = [i for i in hoerbar if 0.2 * len(segs) <= i <= 0.85 * len(segs) and i not in gew.values()]
        if mitte:
            gew["BREAK"] = int(min(mitte, key=lambda i: pegel[i]))
    if anzahl >= 3:
        rest = [i for i in hoerbar if i not in gew.values() and pegel[i] > pegel.max() - 12]
        if rest:
            gew["VAR"] = int(max(rest, key=lambda i: min(np.linalg.norm(chroma[i] - chroma[j]) for j in gew.values())))
    if anzahl >= 4:
        rest = [i for i in hoerbar if i not in gew.values()]
        if rest:
            gew["INTRO"] = int(rest[0])
    extra = max(0, anzahl - len(gew))
    rest = [i for i in hoerbar if i not in gew.values()]
    rest.sort(key=lambda i: -pegel[i])
    for j in range(min(extra, len(rest))):
        gew[f"PART{j + 1}"] = int(rest[j])
    trk_nr = len([m for m in manifest if m.get("track")]) and (max(m["track"] for m in manifest if m.get("track")) + 1) or 1
    tag = f"{PREFIX}{trk_nr}"
    fam = familie(e["stem"])
    log(f"    gewaehlt: " + ", ".join(f"{l}@{starts[i] / SR:.0f}s({pegel[i]:.0f}dB)" for l, i in sorted(gew.items(), key=lambda kv: kv[1])))
    for label, i in sorted(gew.items(), key=lambda kv: kv[1]):
        seg = segs[i]
        t0 = starts[i] / SR
        quelle = f"{e['datei']} @ {t0:.1f}s"
        quellen = {"melo": seg}
        if art == "mix" and not NO_DEMUCS:
            st = demucs_stems(seg, ("bass", "other", "vocals"))
            vox_stark = rms_db(st["vocals"]) > -32
            # Tekk: die "Melodie" steckt oft im Bass-Stem → alles ausser Drums; schwache Vocals bleiben drin
            quellen = {"melo": st["bass"] + st["other"] + (0 if vox_stark else st["vocals"]), "vox": st["vocals"] if vox_stark else None}
        elif art == "vox":
            quellen = {"vox": seg}
        for art2, sg in quellen.items():
            if sg is None or rms_db(sg) < -40:
                continue
            rolle = "vox" if art2 == "vox" else "melo"
            basis = f"{tag} {label}" + ("" if art2 != "vox" or art == "vox" else " VX")
            schreibe(basis, normalisiere(fades(sg, 0.002, 0.004)), rolle, "loop", quelle, bars=fenster_bars, fam=fam,
                     gruppe=f"{rolle}:{tag} {label}", extra=dict(track=trk_nr, label=label))


# ── Durchlauf ──────────────────────────────────────────────────────────────
reihenfolge = {"kick": 0, "snare": 1, "clap": 2, "hat": 3, "perc": 4, "ton": 5, "bass": 6, "fx": 7, "vox": 8, "melo": 9, "track": 10}
for e in sorted(behalten, key=lambda e: (reihenfolge[e["rolle"]], e["datei"].lower())):
    r = e["rolle"]
    if r == "track":
        track(e)
    elif r == "vox" and e["dauer"] >= VOXSAMMLUNG_AB:
        vox_sammlung(e)
    elif e["dauer"] >= LANG_AB and r in ("melo", "fx", "vox", "bass", "ton"):
        loop_oder_phrase(e)
    else:
        oneshot(e)

if gesamt > MAX_SECONDS:
    log(f"\n! {gesamt:.1f} s > Budget {MAX_SECONDS:.0f} s — Bank wird am Geraet nicht passen")
with open(os.path.join(OUT, "manifest.json"), "w", encoding="utf-8") as fh:
    json.dump(dict(prefix=PREFIX, target_bpm=TARGET_BPM, source=SRC, samples=manifest), fh, ensure_ascii=False, indent=1)
rollen = {}
for m in manifest:
    rollen[m["role"]] = rollen.get(m["role"], 0) + 1
log(f"\n{len(manifest)} Samples · {gesamt:.1f} s ≈ {gesamt * 2 * SR / 1048576:.1f} MB · " + " ".join(f"{k}:{v}" for k, v in sorted(rollen.items())) + f" → {OUT}")

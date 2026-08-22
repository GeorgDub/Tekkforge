"""
analyze-round1.py — Songs aus „round 1" analysieren und für round1.all slicen.

Je Song:
  * Tempo + Beat-Raster (librosa), Downbeat-Phase über Kick-Energie
  * Tonart (Krumhansl-Templates auf der Chroma-Summe)
  * MELO  = 8 Tekk-Takte (bei 175 BPM = 10,97 s) aus dem melodischsten,
            perkussionsärmsten Abschnitt (Hook). Quelle ist — wenn ein
            Stem-Ordner angegeben ist — die (Instrumental)-Spur des Songs,
            sonst der Vollmix; Demucs (htdemucs) nimmt daraus Drums und Bass
            heraus (die kommen vom Gerät). Geliefert als zwei Hälften
            MELOA / MELOB à 4 Takte (Alternate-Paar 13/14 am Gerät → eine
            8-Takt-Melodie loopt in einem einzelnen Pattern).
  * VOX   = 4 Tekk-Takte der stärksten Vocal-Phrase aus der (Vocals)-Spur
            (nur mit Stem-Ordner; entfällt, wenn der Song keine Vocals hat)
  * DROP  = 1 Tekk-Takt aus dem lautesten melodischen Abschnitt (Vollmix)
  * STAB  = 0,6 s ab dem stärksten Onset im Melodie-Stem, mit Tonhöhe
  * Melodie des MELO-Fensters als 128 Sechzehntel (pyin auf dem Stem)
  * Akkorde je Tekk-Takt (8) + Bassnoten

Tempo-Oktave: Rap (~90 BPM) wird als Half-Time behandelt (k=2), d. h. ein
Rap-Beat = zwei Tekk-Beats; Stretch-Faktor bleibt damit nahe 1.

Aufruf:  python scripts/analyze-round1.py [quellordner] [zielordner]
             [--stems-dir <ordner>] [--only 3,14] [--varispeed 14|all]
             [--no-stems [5,8]]
         --stems-dir Ordner mit "<nn>_<name>_(Instrumental).wav" und
                     "..._(Vocals).wav" (UVR-Export, gleiche Länge wie Original)
         --only      nur diese Songs neu rechnen, Rest in analyse.json behalten
         --varispeed diese Songs per Resampling statt Phase-Vocoder auf Tempo
                     bringen (Tonhöhe geht mit; Noten/Akkorde/Bass werden
                     mitverschoben) — z. B. Stein zu Stein 129 → 175 = +5,26 HT
         --no-stems  Demucs überspringen (alle Songs, oder nur die genannten):
                     MELO dann aus dem Instrumental (bzw. Vollmix) wie er ist
Ausgabe: <ziel>/<nn>-{MELOA,MELOB,VOX,DROP,STAB}.wav + <ziel>/analyse.json
"""
import json
import io
import os
import re
import sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace") if hasattr(sys.stdout, "buffer") else sys.stdout
import numpy as np
import librosa
import soundfile as sf
from scipy.signal import butter, sosfiltfilt

_FLAGS_MIT_WERT = {"--only", "--varispeed", "--stems-dir"}
_POS = [a for i, a in enumerate(sys.argv[1:], 1)
        if not a.startswith("--") and sys.argv[i - 1] not in _FLAGS_MIT_WERT
        and not (sys.argv[i - 1] == "--no-stems" and re.fullmatch(r"[\d,]+", a))]
SRC = _POS[0] if len(_POS) > 0 else r"G:\Mukke Stuff\Musik für Sample\round 1"
OUT = _POS[1] if len(_POS) > 1 else r"G:\IdeaProjects\TekkForge\examples\e2s\round1"
STEMS_DIR = sys.argv[sys.argv.index("--stems-dir") + 1] if "--stems-dir" in sys.argv else None
TARGET_BPM = 175.0
SR = 44100
SR_A = 22050  # Analyse-Rate
BEAT_T = 60.0 / TARGET_BPM          # 0.3429 s
BAR_T = 4 * BEAT_T                  # 1.3714 s
MELO_BARS = 8
MELO_T = MELO_BARS * BAR_T          # 10.971 s
HALF_T = MELO_T / 2                 # 5.486 s
VOX_BARS = 4
VOX_T = VOX_BARS * BAR_T
STEPS = MELO_BARS * 16              # 128 Sechzehntel
STAB_T = 0.6
VOX_MIN_DBFS = -32.0                # darunter gilt: keine Vocals im Song

os.makedirs(OUT, exist_ok=True)

MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

_MODEL = None


def log(*a):
    print(*a, flush=True)


def _hat_soxr():
    try:
        import soxr  # noqa: F401
        return True
    except Exception:
        return False


def demucs_model():
    global _MODEL
    if _MODEL is None:
        from demucs.pretrained import get_model
        _MODEL = get_model("htdemucs")
        _MODEL.eval()
    return _MODEL


def stem_dateien(idx):
    """(Instrumental, Vocals)-Pfade für Song idx aus STEMS_DIR oder (None, None)."""
    if not STEMS_DIR:
        return None, None
    inst = voc = None
    for f in os.listdir(STEMS_DIR):
        if not f.lower().endswith(".wav"):
            continue
        m = re.match(r"(\d+)_", f)
        if not m or int(m.group(1)) != idx:
            continue
        if "(Instrumental)" in f:
            inst = os.path.join(STEMS_DIR, f)
        elif "(Vocals)" in f:
            voc = os.path.join(STEMS_DIR, f)
    return inst, voc


def key_of(chroma_mean):
    best = (-2, 0, "maj")
    for r in range(12):
        for name, tpl in (("maj", MAJ), ("min", MIN)):
            c = np.corrcoef(np.roll(tpl, r), chroma_mean)[0, 1]
            if c > best[0]:
                best = (c, r, name)
    return best[1], best[2]


def chord_of(chroma_vec, key_root, key_mode):
    """Dur/Moll-Dreiklang, der die Chroma am besten erklärt; leichte
    Bevorzugung der Tonart-Diatonik."""
    best = (-9, 0, "maj")
    scale = [0, 2, 4, 5, 7, 9, 11] if key_mode == "maj" else [0, 2, 3, 5, 7, 8, 10]
    for r in range(12):
        for mode, third in (("maj", 4), ("min", 3)):
            tpl = np.zeros(12)
            tpl[r] = 1.0
            tpl[(r + third) % 12] = 0.8
            tpl[(r + 7) % 12] = 0.7
            s = float(np.dot(tpl, chroma_vec))
            if (r - key_root) % 12 in scale:
                s *= 1.15
            if s > best[0]:
                best = (s, r, mode)
    return best[1], best[2]


def triad(root, mode, low=57):
    """Dreiklang als MIDI-Noten im Bereich ab `low` (A3=57)."""
    r = low + ((root - low) % 12)
    third = 4 if mode == "maj" else 3
    return [r, r + third, r + 7]


def fades(seg, fi_s=0.002, fo_s=0.012):
    seg = seg.copy()
    fi, fo = int(fi_s * SR), int(fo_s * SR)
    if fi:
        seg[:fi] *= np.linspace(0, 1, fi)
    if fo:
        seg[-fo:] *= np.linspace(1, 0, fo)
    return seg


def stretch_to(seg, rate, n_target, varispeed=False, normalize=True):
    """Auf Tempo bringen und exakt auf n_target Samples schneiden.
    varispeed=False: Phase-Vocoder (Tonhöhe bleibt).
    varispeed=True:  Resampling wie ein schneller laufendes Band — Tonhöhe
                     geht um 12·log2(1/rate) Halbtöne mit (klassischer Tekk-Trick)."""
    if abs(rate - 1.0) > 0.002:
        if varispeed:
            seg = librosa.resample(seg, orig_sr=SR, target_sr=SR * rate,
                                   res_type="soxr_hq" if _hat_soxr() else "kaiser_best")
        else:
            seg = librosa.effects.time_stretch(seg, rate=rate)
    if len(seg) < n_target:
        seg = np.pad(seg, (0, n_target - len(seg)))
    seg = fades(seg[:n_target])
    if normalize:
        peak = float(np.max(np.abs(seg))) or 1.0
        seg = seg * (0.95 / peak)
    return seg


def lade_fenster(path, t0, length_s, stereo=True):
    ys, _ = librosa.load(path, sr=SR, mono=not stereo, offset=max(0.0, t0), duration=length_s)
    if stereo and ys.ndim == 1:
        ys = np.stack([ys, ys])
    return ys


def separate(path, t0, length_s, sources=("other", "vocals")):
    """Demucs auf dem Fenster [t0, t0+length_s] (Stereo). Liefert
    (stem_mono aus `sources`, mix_mono) ab t0, beide @SR."""
    import torch
    from demucs.apply import apply_model
    pad = 0.75
    start = max(0.0, t0 - pad)
    ys = lade_fenster(path, start, length_s + 2 * pad)
    model = demucs_model()
    wav = torch.from_numpy(np.ascontiguousarray(ys, dtype=np.float32))[None]
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)
    with torch.no_grad():
        out = apply_model(model, wav, device="cpu", progress=False, shifts=1, overlap=0.25)[0]
    out = out * (ref.std() + 1e-8) + ref.mean()
    src = dict(zip(model.sources, out.numpy()))
    stem = sum(src[s] for s in sources).mean(axis=0)
    mix = ys.mean(axis=0)
    off = int((t0 - start) * SR)
    return stem[off:], mix[off:]


def rms_db(x):
    return float(20 * np.log10(np.sqrt(np.mean(x ** 2)) + 1e-9))


def analyse(path, idx, varispeed=False, stems=True):
    name = os.path.basename(path)
    inst_pfad, voc_pfad = stem_dateien(idx)
    log(f"\n[{idx:02d}] {name}{'  [VARISPEED]' if varispeed else ''}{'' if stems else '  [NO-STEMS]'}"
        f"{'  [UVR: Inst+Vox]' if inst_pfad and voc_pfad else ''}")
    y, _ = librosa.load(path, sr=SR, mono=True)
    dur = len(y) / SR
    ya = librosa.resample(y, orig_sr=SR, target_sr=SR_A, res_type="polyphase")
    log(f"  geladen: {dur:.1f} s")

    # ── Tempo & Beats ──
    onset = librosa.onset.onset_strength(y=ya, sr=SR_A, hop_length=512)
    tempo, beat_frames = librosa.beat.beat_track(onset_envelope=onset, sr=SR_A, hop_length=512, units="frames")
    tempo = float(np.atleast_1d(tempo)[0])
    beats = librosa.frames_to_time(beat_frames, sr=SR_A, hop_length=512)
    if len(beats) < 32:
        raise RuntimeError("zu wenige Beats")
    k = min((0.5, 1.0, 2.0), key=lambda kk: abs(tempo * kk - TARGET_BPM))
    eff_bpm = tempo * k
    rate = eff_bpm / TARGET_BPM
    log(f"  Tempo {tempo:.1f} BPM · k={k} → effektiv {eff_bpm:.1f} · Stretch-Rate {rate:.3f}")

    # ── HPSS + Takt-Features (Fensterwahl) ──
    S = librosa.stft(ya, n_fft=2048, hop_length=512)
    H, P = librosa.decompose.hpss(S, margin=2.0)
    yh = librosa.istft(H, hop_length=512, length=len(ya))
    yp = librosa.istft(P, hop_length=512, length=len(ya))
    rms_h = librosa.feature.rms(y=yh, hop_length=512)[0]
    rms_p = librosa.feature.rms(y=yp, hop_length=512)[0]
    rms_t = librosa.feature.rms(y=ya, hop_length=512)[0]
    chroma = librosa.feature.chroma_cqt(y=yh, sr=SR_A, hop_length=512)
    low = np.abs(S[: int(160 / (SR_A / 2048)) + 1, :]).sum(axis=0)
    kick_at_beat = low[np.clip(beat_frames, 0, len(low) - 1)]
    phase = int(np.argmax([kick_at_beat[p::4].sum() for p in range(4)]))
    bars = beats[phase::4]
    log(f"  Beats {len(beats)} · Takte {len(bars)} · Downbeat-Phase {phase}")

    def frames_between(t0, t1):
        f0 = int(t0 * SR_A / 512)
        f1 = max(f0 + 1, int(t1 * SR_A / 512))
        return f0, f1

    melo_src_bars = max(1, int(round(32 / k)) // 4)   # 8 Tekk-Takte in Quelltakten
    vox_src_bars = max(1, int(round(16 / k)) // 4)    # 4 Tekk-Takte in Quelltakten
    src_melo_len = MELO_T * rate
    src_bar_len = BAR_T * rate
    src_vox_len = VOX_T * rate

    # Phrasenraster
    cm = []
    for b in range(len(bars) - 1):
        f0, f1 = frames_between(bars[b], bars[b + 1])
        cm.append(chroma[:, f0:f1].mean(axis=1))
    cm = np.array(cm)
    nov = np.r_[0, np.linalg.norm(np.diff(cm, axis=0), axis=1)] if len(cm) > 1 else np.zeros(len(cm))
    step_bars = melo_src_bars
    o = int(max(range(step_bars), key=lambda oo: nov[oo::step_bars].sum())) if len(nov) and step_bars > 1 else 0

    cands = []
    b = o
    while b + melo_src_bars < len(bars):
        t0, t1 = bars[b], bars[b + melo_src_bars]
        f0, f1 = frames_between(t0, t1)
        h = float(rms_h[f0:f1].mean())
        p = float(rms_p[f0:f1].mean())
        t = float(rms_t[f0:f1].mean())
        cvec = chroma[:, f0:f1].mean(axis=1)
        clarity = float(cvec.max() / (cvec.sum() + 1e-9))
        cands.append(dict(bar=b, t0=float(t0), t1=float(t1), h=h, p=p, t=t, clarity=clarity))
        b += step_bars
    if not cands:
        raise RuntimeError("keine Kandidatenfenster")
    hs = np.array([c["h"] for c in cands])
    h_thr = np.percentile(hs, 55)

    def melo_score(c):
        if c["h"] < h_thr:
            return -1
        return (c["h"] / (c["p"] + 1e-6)) * (0.5 + c["clarity"])

    # Melodie-Quelle: Instrumental-Stem (UVR) oder Vollmix; Demucs nimmt Drums/Bass raus
    melo_pfad = inst_pfad or path
    quellen = ("other",) if inst_pfad else ("other", "vocals")

    # Top-4 nach HPSS, Entscheidung per Demucs: das Fenster mit dem lautesten Melodie-Stem
    top = sorted((c for c in cands if melo_score(c) > 0), key=melo_score, reverse=True)[:4] or [max(cands, key=melo_score)]
    melo = top[0]
    stem_cache = {}
    if stems and len(top) > 1:
        for c in top:
            try:
                st, mx = separate(melo_pfad, c["t0"], src_melo_len, quellen)
                stem_cache[c["bar"]] = (st, mx)
                log(f"    Kandidat Takt {c['bar']:3d} @{c['t0']:6.1f}s: Stem {rms_db(st):6.1f} dBFS ({rms_db(st)-rms_db(mx):+.1f} dB zur Quelle)")
            except Exception as e:
                log(f"    Kandidat Takt {c['bar']}: Demucs fehlgeschlagen ({e})")
        if stem_cache:
            melo = max((c for c in top if c["bar"] in stem_cache), key=lambda c: rms_db(stem_cache[c["bar"]][0]))

    def drop_score(c):
        if c is melo:
            return -1
        return c["t"] * (c["h"] ** 0.5)
    drop = max(cands, key=drop_score)
    log(f"  MELO {melo['t0']:.1f}s (Takt {melo['bar']}, {melo_src_bars} Quelltakte, h/p={melo['h']/(melo['p']+1e-6):.2f}) · DROP {drop['t0']:.1f}s (Takt {drop['bar']})")

    # ── Schneiden ──
    n_melo = int(round(MELO_T * SR))
    n_half = int(round(HALF_T * SR))
    n_bar = int(round(BAR_T * SR))
    n_vox = int(round(VOX_T * SR))
    n_stab = int(round(STAB_T * SR))

    def cut(t0, length_s):
        a = int(t0 * SR)
        b_ = min(len(y), a + int(length_s * SR) + 2048)
        return y[a:b_]

    stem_ok = False
    if stems:
        try:
            if melo["bar"] in stem_cache:
                stem, mix = stem_cache[melo["bar"]]
            else:
                stem, mix = separate(melo_pfad, melo["t0"], src_melo_len, quellen)
            stem_ok = rms_db(stem) - rms_db(mix) >= -26.0
            log(f"  Demucs: Melodie-Stem {rms_db(stem)-rms_db(mix):+.1f} dB zur Quelle{'' if stem_ok else ' → zu leise, nehme Quelle'}")
        except Exception as e:
            log(f"  Demucs fehlgeschlagen ({e}) → Quelle")
    if stem_ok:
        melo_src = stem
    elif inst_pfad:
        melo_src = lade_fenster(inst_pfad, melo["t0"], src_melo_len + 0.1, stereo=False)
        log("  MELO-Quelle: Instrumental-Stem (ohne Demucs)")
    else:
        melo_src = cut(melo["t0"], src_melo_len)

    melo_seg = stretch_to(melo_src, rate, n_melo, varispeed)
    melo_a = fades(melo_seg[:n_half], 0.002, 0.003)
    melo_b = fades(melo_seg[n_half:n_half * 2], 0.002, 0.012)
    drop_seg = stretch_to(cut(drop["t0"], src_bar_len), rate, n_bar, varispeed)
    shift_exact = 12 * np.log2(1 / rate) if varispeed else 0.0
    shift = int(round(shift_exact))
    if varispeed:
        log(f"  Varispeed: Tonhöhe {shift_exact:+.2f} Halbtöne (Noten {shift:+d})")

    # ── VOX: stärkste 4-Takt-Vocal-Phrase aus der Vocals-Spur ──
    vox = None
    if voc_pfad:
        yv, _ = librosa.load(voc_pfad, sr=SR_A, mono=True)
        rms_v = librosa.feature.rms(y=yv, hop_length=512)[0]
        best = None
        for b in range(0, len(bars) - vox_src_bars):
            f0, f1 = frames_between(bars[b], bars[b + vox_src_bars])
            seg = rms_v[f0:f1]
            if not len(seg):
                continue
            lvl = float(np.sqrt(np.mean(seg ** 2)))
            dichte = float((seg > 0.02).mean())     # Anteil der Frames mit Stimme
            score = lvl * (0.4 + dichte)
            if best is None or score > best[0]:
                best = (score, b, lvl, dichte)
        if best:
            _, vb, lvl, dichte = best
            db = 20 * np.log10(lvl + 1e-9)
            if db >= VOX_MIN_DBFS:
                vox_src = lade_fenster(voc_pfad, bars[vb], src_vox_len + 0.1, stereo=False)
                vox_seg = stretch_to(vox_src, rate, n_vox, varispeed)
                vox = dict(t0=round(float(bars[vb]), 2), bar=int(vb), dbfs=round(float(db), 1), dichte=round(dichte, 2))
                sf.write(os.path.join(OUT, f"{idx:02d}-VOX.wav"), vox_seg, SR, subtype="PCM_16")
                log(f"  VOX {bars[vb]:.1f}s (Takt {vb}): {db:.1f} dBFS, Stimme in {dichte*100:.0f}% der Frames")
            else:
                log(f"  VOX: Vocals zu leise ({db:.1f} dBFS) → kein VOX-Sample")
    if vox is None:
        alt = os.path.join(OUT, f"{idx:02d}-VOX.wav")
        if os.path.exists(alt):
            os.remove(alt)

    # Analysespur fürs Fenster: Melodie-Quelle → 22050, Mittenband
    win22 = librosa.resample(melo_src[: int(src_melo_len * SR)], orig_sr=SR, target_sr=SR_A, res_type="polyphase")
    sos = butter(4, [180, 5000], btype="bandpass", fs=SR_A, output="sos")
    win_mid = sosfiltfilt(sos, win22).astype(np.float32)

    # STAB: stärkster Onset im Stem (nicht in den letzten 0,6 s)
    on_h = librosa.onset.onset_strength(y=win_mid, sr=SR_A, hop_length=512)
    grenze = max(1, int((src_melo_len - STAB_T * rate) * SR_A / 512))
    on_h = on_h[:grenze]
    stab_rel = (int(np.argmax(on_h)) * 512) / SR_A if len(on_h) else 0.0
    stab_t = melo["t0"] + stab_rel
    a_s = int(stab_rel * SR)
    stab_raw = melo_src[a_s: a_s + int((STAB_T * rate if varispeed else STAB_T) * SR) + 2048]
    stab_seg = stretch_to(stab_raw, rate if varispeed else 1.0, n_stab, varispeed)
    a0 = int(stab_rel * SR_A)
    fz, vz, _ = librosa.pyin(win_mid[a0:a0 + int(STAB_T * SR_A)], fmin=110, fmax=2000, sr=SR_A,
                             frame_length=2048, hop_length=256)
    ok = vz & np.isfinite(fz)
    stab_voiced = float(ok.mean()) if len(ok) else 0.0
    stab_note = int(round(float(np.median(librosa.hz_to_midi(fz[ok]))))) if ok.sum() >= 4 and stab_voiced >= 0.3 else None
    if stab_note is not None:
        stab_note += shift

    # ── Melodie (128 Sechzehntel) ──
    f0s, voiced, _ = librosa.pyin(win_mid, fmin=110, fmax=1500, sr=SR_A, frame_length=2048, hop_length=256)
    n_fr = len(f0s)
    notes = []
    prev = None
    for s in range(STEPS):
        a = int(s * n_fr / STEPS)
        b_ = max(a + 1, int((s + 1) * n_fr / STEPS))
        fv = f0s[a:b_]
        vv = voiced[a:b_] & np.isfinite(fv)
        if vv.mean() >= 0.4:
            notes.append(int(round(float(np.median(librosa.hz_to_midi(fv[vv]))))) + shift)
        else:
            notes.append(None)
    events = []
    for s, n in enumerate(notes):
        if n is not None and n != prev:
            events.append([s, n])
        prev = n

    # ── Akkorde je Tekk-Takt (8) + Tonart ──
    key_root, key_mode = key_of(chroma.mean(axis=1))
    chords, bass = [], []
    for tb in range(MELO_BARS):
        t0 = melo["t0"] + tb * src_bar_len
        a, bb = frames_between(t0, t0 + src_bar_len)
        r, m = chord_of(chroma[:, a:bb].mean(axis=1), key_root, key_mode)
        r = (r + shift) % 12
        chords.append(triad(r, m))
        bass.append(24 + ((r - 24) % 12) + 12)  # C2..B2 (36..47)
    key_root = (key_root + shift) % 12
    ev64 = sum(1 for e in events if e[0] < 64)
    log(f"  Tonart {NAMES[key_root]}{key_mode} · Akkorde {[NAMES[c[0]%12] for c in chords]} · {len(events)} Melodie-Events ({ev64} in Hälfte A) · Stab {stab_note}")

    stem_ = f"{idx:02d}"
    sf.write(os.path.join(OUT, f"{stem_}-MELOA.wav"), melo_a, SR, subtype="PCM_16")
    sf.write(os.path.join(OUT, f"{stem_}-MELOB.wav"), melo_b, SR, subtype="PCM_16")
    sf.write(os.path.join(OUT, f"{stem_}-DROP.wav"), drop_seg, SR, subtype="PCM_16")
    sf.write(os.path.join(OUT, f"{stem_}-STAB.wav"), stab_seg, SR, subtype="PCM_16")

    return dict(
        idx=idx, file=name, duration=round(dur, 1), bpm=round(tempo, 1), k=k,
        eff_bpm=round(eff_bpm, 1), rate=round(rate, 4),
        varispeed=bool(varispeed), shift=round(float(shift_exact), 2), stems=bool(stem_ok),
        quelle="instrumental" if inst_pfad else "mix",
        key=f"{NAMES[key_root]}{key_mode}", key_root=key_root, key_mode=key_mode,
        melo=dict(t0=round(melo["t0"], 2), bar=melo["bar"], bars=MELO_BARS),
        vox=vox,
        drop=dict(t0=round(drop["t0"], 2), bar=drop["bar"]),
        stab=dict(t0=round(stab_t, 2), note=stab_note, voiced=round(stab_voiced, 2)),
        notes=notes, events=events, chords=chords, bass=bass,
    )


def _idx_liste(flag, n_max=99):
    """--only 3,14 bzw. --varispeed 14 / all → Menge."""
    if flag in sys.argv:
        i = sys.argv.index(flag) + 1
        wert = sys.argv[i] if i < len(sys.argv) else ""
        if wert == "all":
            return set(range(1, n_max + 1))
        if re.fullmatch(r"[\d,]+", wert):
            return {int(x) for x in wert.split(",")}
        return set(range(1, n_max + 1)) if flag == "--no-stems" else set()
    return set()


def main():
    files = sorted(f for f in os.listdir(SRC) if f.lower().endswith((".wav", ".mp3", ".flac", ".aiff", ".aif")))
    only = _idx_liste("--only")
    varispeed = _idx_liste("--varispeed")
    no_stems = _idx_liste("--no-stems")
    json_pfad = os.path.join(OUT, "analyse.json")
    results = []
    if only and os.path.exists(json_pfad):  # Teil-Lauf: bestehende Ergebnisse behalten
        with open(json_pfad, encoding="utf-8") as fh:
            results = json.load(fh)
    for i, f in enumerate(files, 1):
        if only and i not in only:
            continue
        try:
            r = analyse(os.path.join(SRC, f), i, varispeed=i in varispeed, stems=i not in no_stems)
        except Exception as e:  # ein Song darf die Runde nicht abbrechen
            log(f"  FEHLER: {e}")
            r = dict(idx=i, file=f, error=str(e))
        results = [x for x in results if x.get("idx") != i] + [r]
        results.sort(key=lambda x: x["idx"])
        with open(json_pfad, "w", encoding="utf-8") as fh:
            json.dump(results, fh, ensure_ascii=False, indent=1)
    log(f"\nfertig: {len(results)} Songs → {OUT}")


if __name__ == "__main__":
    main()

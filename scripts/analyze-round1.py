"""
analyze-round1.py — Songs aus „round 1" analysieren und für tekk5.all slicen.

Je Song:
  * Tempo + Beat-Raster (librosa), Downbeat-Phase über Kick-Energie
  * Tonart (Krumhansl-Templates auf der Chroma-Summe)
  * MELO  = 4 Tekk-Takte (bei 175 BPM = 5,486 s) aus dem melodischsten,
            perkussionsärmsten Abschnitt (Breakdown-Hook) — time-gestretcht
            auf exakt 175 BPM, Tonhöhe bleibt
  * DROP  = 1 Tekk-Takt aus dem lautesten melodischen Abschnitt
  * STAB  = 0,6 s ab dem stärksten harmonischen Onset im MELO-Abschnitt,
            mit gemessener Tonhöhe (für die Transposition im Pattern)
  * Melodie des MELO-Abschnitts als 64 Sechzehntel (pyin → MIDI-Noten)
  * Akkorde je Tekk-Takt (Dur/Moll-Templates auf Chroma) + Bassnoten

Tempo-Oktave: Rap (~90 BPM) wird als Half-Time behandelt (k=2), d. h. ein
Rap-Beat = zwei Tekk-Beats; Stretch-Faktor bleibt damit nahe 1.

Aufruf:  python scripts/analyze-round1.py [quellordner] [zielordner]
             [--only 3,14] [--varispeed 14]
         --only      nur diese Songs neu rechnen, Rest in analyse.json behalten
         --varispeed diese Songs per Resampling statt Phase-Vocoder auf Tempo
                     bringen (Tonhöhe geht mit; Noten/Akkorde/Bass werden
                     mitverschoben) — z. B. Stein zu Stein 129 → 175 = +5,26 HT
Ausgabe: <ziel>/<nn>-{MELO,DROP,STAB}.wav + <ziel>/analyse.json
"""
import json
import io
import os
import sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace") if hasattr(sys.stdout, "buffer") else sys.stdout
import re
import numpy as np
import librosa
import soundfile as sf
from scipy.signal import butter, sosfiltfilt

_POS = [a for i, a in enumerate(sys.argv[1:], 1)
        if not a.startswith("--") and not sys.argv[i - 1].startswith("--")]
SRC = _POS[0] if len(_POS) > 0 else r"G:\Mukke Stuff\Musik für Sample\round 1"
OUT = _POS[1] if len(_POS) > 1 else r"G:\IdeaProjects\TekkForge\examples\e2s\round1"
TARGET_BPM = 175.0
SR = 44100
SR_A = 22050  # Analyse-Rate
BEAT_T = 60.0 / TARGET_BPM          # 0.3429 s
BAR_T = 4 * BEAT_T                  # 1.3714 s
MELO_T = 4 * BAR_T                  # 5.4857 s
STAB_T = 0.6

os.makedirs(OUT, exist_ok=True)

MAJ = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
MIN = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])
NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def log(*a):
    print(*a, flush=True)


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


def stretch_to(seg, rate, n_target, varispeed=False):
    """Auf Tempo bringen und exakt auf n_target Samples schneiden.
    varispeed=False: Phase-Vocoder (Tonhöhe bleibt).
    varispeed=True:  Resampling wie ein schneller laufendes Band — Tonhöhe
                     geht um 12·log2(1/rate) Halbtöne mit (klassischer Tekk-Trick)."""
    if abs(rate - 1.0) > 0.002:
        if varispeed:
            seg = librosa.resample(seg, orig_sr=SR, target_sr=SR * rate, res_type="soxr_hq"
                                   if _hat_soxr() else "kaiser_best")
        else:
            seg = librosa.effects.time_stretch(seg, rate=rate)
    if len(seg) < n_target:
        seg = np.pad(seg, (0, n_target - len(seg)))
    seg = seg[:n_target].copy()
    # kurze Fades gegen Klicks
    fi = int(0.002 * SR)
    fo = int(0.012 * SR)
    seg[:fi] *= np.linspace(0, 1, fi)
    seg[-fo:] *= np.linspace(1, 0, fo)
    peak = float(np.max(np.abs(seg))) or 1.0
    return seg * (0.95 / peak)


def _hat_soxr():
    try:
        import soxr  # noqa: F401
        return True
    except Exception:
        return False


def analyse(path, idx, varispeed=False):
    name = os.path.basename(path)
    log(f"\n[{idx:02d}] {name}{'  [VARISPEED]' if varispeed else ''}")
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
    # Tempo-Oktave: k Tekk-Beats je erkannter Beat
    k = min((0.5, 1.0, 2.0), key=lambda kk: abs(tempo * kk - TARGET_BPM))
    eff_bpm = tempo * k
    rate = eff_bpm / TARGET_BPM  # >1 = Quelle schneller als Ziel → wird verlangsamt... (librosa: rate>1 = schneller)
    log(f"  Tempo {tempo:.1f} BPM · k={k} → effektiv {eff_bpm:.1f} · Stretch-Rate {rate:.3f}")

    # ── HPSS + Takt-Features ──
    S = librosa.stft(ya, n_fft=2048, hop_length=512)
    H, P = librosa.decompose.hpss(S, margin=2.0)
    yh = librosa.istft(H, hop_length=512, length=len(ya))
    yp = librosa.istft(P, hop_length=512, length=len(ya))
    # Mittenband der harmonischen Spur (Lead statt Bass) für Stab + Melodie
    sos = butter(4, [180, 5000], btype="bandpass", fs=SR_A, output="sos")
    yh_mid = sosfiltfilt(sos, yh).astype(np.float32)
    rms_h = librosa.feature.rms(y=yh, hop_length=512)[0]
    rms_p = librosa.feature.rms(y=yp, hop_length=512)[0]
    rms_t = librosa.feature.rms(y=ya, hop_length=512)[0]
    chroma = librosa.feature.chroma_cqt(y=yh, sr=SR_A, hop_length=512)
    # Kick-Energie (<160 Hz) je Beat für die Downbeat-Phase
    low = np.abs(S[: int(160 / (SR_A / 2048)) + 1, :]).sum(axis=0)
    kick_at_beat = low[np.clip(beat_frames, 0, len(low) - 1)]
    phase = int(np.argmax([kick_at_beat[p::4].sum() for p in range(4)]))
    bars = beats[phase::4]  # Taktanfänge der Quelle (Quell-Beats)
    bar_frames = beat_frames[phase::4]
    log(f"  Beats {len(beats)} · Takte {len(bars)} · Downbeat-Phase {phase}")

    def frames_between(t0, t1):
        f0 = int(t0 * SR_A / 512)
        f1 = max(f0 + 1, int(t1 * SR_A / 512))
        return f0, f1

    # Quell-Beats je Tekk-Takt: 4/k  (k=2 → 2 Quell-Beats = 1 Tekk-Takt)
    src_beats_per_tekk_bar = 4.0 / k
    # MELO-Fenster = 4 Tekk-Takte = 16/k Quell-Beats; Startpunkte an Quell-Taktanfängen
    melo_src_beats = int(round(16 / k))
    melo_src_bars = max(1, melo_src_beats // 4)

    # Phrasenraster: Versatz o, bei dem die Chroma-Neuheit an 4-Takt-Grenzen maximal ist
    cm = []
    for b in range(len(bars) - 1):
        f0, f1 = frames_between(bars[b], bars[b + 1])
        cm.append(chroma[:, f0:f1].mean(axis=1))
    cm = np.array(cm)
    nov = np.r_[0, np.linalg.norm(np.diff(cm, axis=0), axis=1)] if len(cm) > 1 else np.zeros(len(cm))
    step_bars = max(1, melo_src_bars)
    offs = range(step_bars) if step_bars > 1 else [0]
    o = int(max(offs, key=lambda oo: nov[oo::step_bars].sum())) if len(nov) else 0

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
    ts = np.array([c["t"] for c in cands])
    h_thr = np.percentile(hs, 55)
    # MELO: harmonisch stark, möglichst wenig Perkussion, klare Tonalität
    def melo_score(c):
        if c["h"] < h_thr:
            return -1
        return (c["h"] / (c["p"] + 1e-6)) * (0.5 + c["clarity"])
    melo = max(cands, key=melo_score)
    # DROP: laut und harmonisch — nicht dasselbe Fenster wie MELO
    def drop_score(c):
        if c is melo:
            return -1
        return c["t"] * (c["h"] ** 0.5)
    drop = max(cands, key=drop_score)
    log(f"  MELO {melo['t0']:.1f}s (Takt {melo['bar']}, h/p={melo['h']/(melo['p']+1e-6):.2f}) · DROP {drop['t0']:.1f}s (Takt {drop['bar']})")

    # ── Slices schneiden & stretchen ──
    n_melo = int(round(MELO_T * SR))
    n_bar = int(round(BAR_T * SR))
    n_stab = int(round(STAB_T * SR))
    src_melo_len = MELO_T * rate
    src_bar_len = BAR_T * rate

    def cut(t0, length_s):
        a = int(t0 * SR)
        b = min(len(y), a + int(length_s * SR) + 2048)
        return y[a:b]

    melo_seg = stretch_to(cut(melo["t0"], src_melo_len), rate, n_melo, varispeed)
    drop_seg = stretch_to(cut(drop["t0"], src_bar_len), rate, n_bar, varispeed)
    # Varispeed verschiebt die Tonhöhe — alle Song-Noten ziehen mit (gerundet)
    shift_exact = 12 * np.log2(1 / rate) if varispeed else 0.0
    shift = int(round(shift_exact))
    if varispeed:
        log(f"  Varispeed: Tonhöhe {shift_exact:+.2f} Halbtöne (Noten {shift:+d})")

    # STAB: stärkster harmonischer Onset im MELO-Quellfenster
    f0, f1 = frames_between(melo["t0"], melo["t0"] + src_melo_len - STAB_T)
    on_h = librosa.onset.onset_strength(y=yh_mid[f0 * 512:f1 * 512], sr=SR_A, hop_length=512)
    stab_t = melo["t0"] + (int(np.argmax(on_h)) * 512) / SR_A if len(on_h) else melo["t0"]
    # STAB bekommt dieselbe Varispeed-Verschiebung wie der Loop (Quelle etwas länger schneiden)
    stab_raw = cut(stab_t, STAB_T * rate if varispeed else STAB_T)
    stab_seg = stretch_to(stab_raw, rate if varispeed else 1.0, n_stab, varispeed)
    # Tonhöhe des Stabs (Mittenband, Lead-Bereich A2..B6)
    a0 = int(stab_t * SR_A)
    fz, vz, pz = librosa.pyin(yh_mid[a0:a0 + int(STAB_T * SR_A)], fmin=110, fmax=2000, sr=SR_A,
                              frame_length=2048, hop_length=256)
    ok = vz & np.isfinite(fz)
    stab_voiced = float(ok.mean()) if len(ok) else 0.0
    stab_note = int(round(float(np.median(librosa.hz_to_midi(fz[ok]))))) if ok.sum() >= 4 and stab_voiced >= 0.3 else None
    if stab_note is not None:
        stab_note += shift

    # ── Melodie (64 Sechzehntel) aus dem MELO-Quellfenster (Mittenband) ──
    seg_h = yh_mid[int(melo["t0"] * SR_A): int((melo["t0"] + src_melo_len) * SR_A)]
    f0s, voiced, _ = librosa.pyin(seg_h, fmin=110, fmax=1500, sr=SR_A, frame_length=2048, hop_length=256)
    n_fr = len(f0s)
    notes = []
    prev = None
    for s in range(64):
        a = int(s * n_fr / 64)
        b = max(a + 1, int((s + 1) * n_fr / 64))
        fv = f0s[a:b]
        vv = voiced[a:b] & np.isfinite(fv)
        if vv.mean() >= 0.4:
            n = int(round(float(np.median(librosa.hz_to_midi(fv[vv]))))) + shift
            notes.append(n)
        else:
            notes.append(None)
    # Notenereignisse: neu, wenn Note wechselt oder nach Pause
    events = []
    for s, n in enumerate(notes):
        if n is not None and n != prev:
            events.append([s, n])
        prev = n

    # ── Akkorde je Tekk-Takt + Tonart ──
    key_root, key_mode = key_of(chroma.mean(axis=1))
    chords, bass = [], []
    for tb in range(4):
        t0 = melo["t0"] + tb * src_bar_len
        a, bb = frames_between(t0, t0 + src_bar_len)
        r, m = chord_of(chroma[:, a:bb].mean(axis=1), key_root, key_mode)
        r = (r + shift) % 12
        chords.append(triad(r, m))
        bass.append(24 + ((r - 24) % 12) + 12 if r >= 0 else 36)  # C2..B2 (36..47)
    key_root = (key_root + shift) % 12
    log(f"  Tonart {NAMES[key_root]}{key_mode} · Akkorde {[NAMES[c[0]%12] for c in chords]} · {len(events)} Melodie-Events · Stab {stab_note}")

    stem = f"{idx:02d}"
    sf.write(os.path.join(OUT, f"{stem}-MELO.wav"), melo_seg, SR, subtype="PCM_16")
    sf.write(os.path.join(OUT, f"{stem}-DROP.wav"), drop_seg, SR, subtype="PCM_16")
    sf.write(os.path.join(OUT, f"{stem}-STAB.wav"), stab_seg, SR, subtype="PCM_16")

    return dict(
        idx=idx, file=name, duration=round(dur, 1), bpm=round(tempo, 1), k=k,
        eff_bpm=round(eff_bpm, 1), rate=round(rate, 4),
        varispeed=bool(varispeed), shift=round(float(shift_exact), 2),
        key=f"{NAMES[key_root]}{key_mode}", key_root=key_root, key_mode=key_mode,
        melo=dict(t0=round(melo["t0"], 2), bar=melo["bar"]),
        drop=dict(t0=round(drop["t0"], 2), bar=drop["bar"]),
        stab=dict(t0=round(stab_t, 2), note=stab_note, voiced=round(stab_voiced, 2)),
        notes=notes, events=events, chords=chords, bass=bass,
    )


def _idx_liste(flag):
    """--only 3,14 bzw. --varispeed 14 → {3, 14}."""
    if flag in sys.argv:
        return {int(x) for x in sys.argv[sys.argv.index(flag) + 1].split(",")}
    return set()


def main():
    files = sorted(f for f in os.listdir(SRC) if f.lower().endswith((".wav", ".mp3", ".flac", ".aiff", ".aif")))
    only = _idx_liste("--only")
    varispeed = _idx_liste("--varispeed")
    json_pfad = os.path.join(OUT, "analyse.json")
    results = []
    if only and os.path.exists(json_pfad):  # Teil-Lauf: bestehende Ergebnisse behalten
        with open(json_pfad, encoding="utf-8") as fh:
            results = json.load(fh)
    for i, f in enumerate(files, 1):
        if only and i not in only:
            continue
        try:
            r = analyse(os.path.join(SRC, f), i, varispeed=i in varispeed)
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

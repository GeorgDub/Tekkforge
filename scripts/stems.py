"""
stems.py — Demucs (htdemucs) auf fertig geschnittenen Fenster-WAVs fuer den
Generator-Tab. Eingabe ist ein JSON (Pfad als Argument):

  { "fenster": [ { "id": "DROP", "wav": "<pfad zum mono-44.1k-wav>", "nurVox": false }, ... ],
    "ziel": "<ordner>",
    "teile": ["melo", "vox", "drums", "bass"] }   # optional, Vorgabe ohne "bass"

Je Fenster entstehen <ziel>/<id>-melo.wav (bass + other; Vocals werden
eingefaltet, wenn sie leiser als -36 dB sind), <ziel>/<id>-vox.wav (nur
wenn Vocals > -36 dB, dann auf 0,95 normalisiert) und <ziel>/<id>-drums.wav, dazu <id>-bass.wav sobald hoerbar (fuer die Bassline-Noten)
(Drums-Stem, normalisiert — Quelle fuer geschnittene Kick/Snare/Hat-One-Shots).
Fenster mit "nurVox": true liefern nur die Vocals (Vocal-Vollabdeckung des
ganzen Lieds); melo und drums sind dann null.
Fortschritt auf stderr, Ergebnis-JSON auf stdout:

  { "fenster": [ { "id": "DROP", "melo": "<pfad>" | null, "vox": "<pfad>" | null, "drums": "<pfad>" | null } ] }
"""
import io
import json
import os
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace") if hasattr(sys.stdout, "buffer") else sys.stdout
import numpy as np
import soundfile as sf

SR = 44100
_MODEL = None


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def rms_db(y):
    return float(20 * np.log10(np.sqrt(np.mean(y ** 2)) + 1e-9)) if len(y) else -120.0


def modell():
    global _MODEL
    if _MODEL is None:
        import torch  # noqa: F401
        from demucs.pretrained import get_model
        _MODEL = get_model("htdemucs")
        _MODEL.eval()
    return _MODEL


def geraet():
    """Grafikkarte, wenn Torch eine sieht — sonst CPU.

    Der Unterschied ist erheblich (Groessenordnung 5- bis 15-fach). Ob eine
    Karte nutzbar ist, haengt NICHT an der Hardware allein: die uebliche
    pip-Installation von Torch bringt nur die CPU-Fassung mit, dann bleibt die
    Karte ungenutzt. `pythonStatus` meldet das, damit die App es sagen kann.
    """
    import torch
    return "cuda" if torch.cuda.is_available() else "cpu"


def stems(y, qualitaet="schnell"):
    import torch
    from demucs.apply import apply_model
    m = modell()
    wav = torch.from_numpy(np.stack([y, y]).astype(np.float32))[None]
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)
    # Gemessen (10 s Audio, i7-11850H, 8 Threads): shifts=1 -> 5,9 s,
    # shifts=0 -> 4,6 s. Das Ueberlappungsmass macht dagegen kaum etwas aus.
    # "shifts" mittelt ueber zufaellig verschobene Durchlaeufe; fuer unsere
    # 8-Takt-Fenster ist der Gewinn den Aufpreis nicht wert.
    shifts, overlap = (0, 0.10) if qualitaet == "schnell" else (1, 0.25)
    dev = geraet()
    with torch.no_grad():
        out = apply_model(m, wav, device=dev, progress=False, shifts=shifts, overlap=overlap)[0]
    out = out.cpu() * (ref.std() + 1e-8) + ref.mean()
    return {s: out[i].numpy().mean(axis=0) for i, s in enumerate(m.sources)}


def normalisiere(y, peak=0.95):
    p = float(np.max(np.abs(y))) or 1.0
    return (y * (peak / p)).astype(np.float32)


def main():
    anfrage = json.load(open(sys.argv[1], encoding="utf-8"))
    ziel = anfrage["ziel"]
    qualitaet = anfrage.get("qualitaet", "schnell")
    # Welche Teile sollen ueberhaupt herausfallen? Ohne Angabe alle ausser Bass
    # (der steckt dann wie bisher in der Melodie mit drin) — so bleiben aeltere
    # Aufrufer unveraendert.
    teile = set(anfrage.get("teile") or ["melo", "vox", "drums"])
    os.makedirs(ziel, exist_ok=True)
    ergebnis = []
    fenster = anfrage["fenster"]
    dev = geraet()
    log(f"Demucs auf {'Grafikkarte' if dev == 'cuda' else 'Prozessor'} · {qualitaet}")
    for i, f in enumerate(fenster):
        t0 = time.perf_counter()
        log(f"Demucs: Fenster {i + 1}/{len(fenster)} ({f['id']}) …")
        y, sr = sf.read(f["wav"], dtype="float32", always_2d=True)
        y = y.mean(axis=1)
        if sr != SR:
            import librosa
            y = librosa.resample(y, orig_sr=sr, target_sr=SR, res_type="soxr_hq")
        st = stems(y, qualitaet)
        # -36 dB: Tekk-Vocals liegen oft 20 dB unter den Drums (Tommi Track 1: -32…-36 dB) und
        # sollen trotzdem als eigener, hochnormalisierter Vox-Loop rauskommen
        vox_stark = rms_db(st["vocals"]) > -36
        if f.get("nurVox"):
            vox_pfad = None
            if vox_stark and "vox" in teile:
                vox_pfad = os.path.join(ziel, f"{f['id']}-vox.wav")
                sf.write(vox_pfad, normalisiere(st["vocals"]), SR, subtype="PCM_16")
            log(f"  … {time.perf_counter() - t0:.1f} s")
            ergebnis.append({"id": f["id"], "melo": None, "vox": vox_pfad, "drums": None, "voxDb": round(rms_db(st["vocals"]), 1)})
            continue
        # Bass gehoert normalerweise zur Melodie. Wird er ausdruecklich als
        # eigener Teil gewuenscht, faellt er dort heraus — sonst haette man ihn
        # zweimal im Set und die Melodie waere basslastig.
        bass_extra = "bass" in teile
        melo = st["other"] + (0 if bass_extra else st["bass"]) + (0 if vox_stark else st["vocals"])
        melo_pfad = None
        if "melo" in teile:
            melo_pfad = os.path.join(ziel, f"{f['id']}-melo.wav")
            sf.write(melo_pfad, normalisiere(melo), SR, subtype="PCM_16")
        # Der Bass-Stem kommt IMMER mit, wenn er hoerbar ist: TekkForge liest
        # daraus die Bassline als Noten (core/grundton.ts). Als eigenes Sample
        # landet er nur, wenn "bass" in teile steht — das entscheidet der Aufrufer.
        bass_pfad = None
        if rms_db(st["bass"]) > -45:
            bass_pfad = os.path.join(ziel, f"{f['id']}-bass.wav")
            sf.write(bass_pfad, normalisiere(st["bass"]), SR, subtype="PCM_16")
        vox_pfad = None
        if vox_stark and "vox" in teile:
            vox_pfad = os.path.join(ziel, f"{f['id']}-vox.wav")
            sf.write(vox_pfad, normalisiere(st["vocals"]), SR, subtype="PCM_16")
        drums_pfad = None
        if "drums" in teile and rms_db(st["drums"]) > -45:
            drums_pfad = os.path.join(ziel, f"{f['id']}-drums.wav")
            sf.write(drums_pfad, normalisiere(st["drums"]), SR, subtype="PCM_16")
        log(f"  … {time.perf_counter() - t0:.1f} s")
        ergebnis.append({"id": f["id"], "melo": melo_pfad, "vox": vox_pfad, "drums": drums_pfad, "bass": bass_pfad, "voxDb": round(rms_db(st["vocals"]), 1)})
    print(json.dumps({"fenster": ergebnis}))


if __name__ == "__main__":
    main()

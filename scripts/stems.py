"""
stems.py — Demucs (htdemucs) auf fertig geschnittenen Fenster-WAVs fuer den
Generator-Tab. Eingabe ist ein JSON (Pfad als Argument):

  { "fenster": [ { "id": "DROP", "wav": "<pfad zum mono-44.1k-wav>" }, ... ],
    "ziel": "<ordner>" }

Je Fenster entstehen <ziel>/<id>-melo.wav (bass + other; Vocals werden
eingefaltet, wenn sie leiser als -32 dB sind) und <ziel>/<id>-vox.wav (nur
wenn Vocals > -32 dB). Fortschritt auf stderr, Ergebnis-JSON auf stdout:

  { "fenster": [ { "id": "DROP", "melo": "<pfad>", "vox": "<pfad>" | null } ] }
"""
import io
import json
import os
import sys

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


def stems(y):
    import torch
    from demucs.apply import apply_model
    m = modell()
    wav = torch.from_numpy(np.stack([y, y]).astype(np.float32))[None]
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)
    with torch.no_grad():
        out = apply_model(m, wav, device="cpu", progress=False, shifts=1, overlap=0.25)[0]
    out = out * (ref.std() + 1e-8) + ref.mean()
    return {s: out[i].numpy().mean(axis=0) for i, s in enumerate(m.sources)}


def normalisiere(y, peak=0.95):
    p = float(np.max(np.abs(y))) or 1.0
    return (y * (peak / p)).astype(np.float32)


def main():
    anfrage = json.load(open(sys.argv[1], encoding="utf-8"))
    ziel = anfrage["ziel"]
    os.makedirs(ziel, exist_ok=True)
    ergebnis = []
    fenster = anfrage["fenster"]
    for i, f in enumerate(fenster):
        log(f"Demucs: Fenster {i + 1}/{len(fenster)} ({f['id']}) …")
        y, sr = sf.read(f["wav"], dtype="float32", always_2d=True)
        y = y.mean(axis=1)
        if sr != SR:
            import librosa
            y = librosa.resample(y, orig_sr=sr, target_sr=SR, res_type="soxr_hq")
        st = stems(y)
        vox_stark = rms_db(st["vocals"]) > -32
        melo = st["bass"] + st["other"] + (0 if vox_stark else st["vocals"])
        melo_pfad = os.path.join(ziel, f"{f['id']}-melo.wav")
        sf.write(melo_pfad, normalisiere(melo), SR, subtype="PCM_16")
        vox_pfad = None
        if vox_stark:
            vox_pfad = os.path.join(ziel, f"{f['id']}-vox.wav")
            sf.write(vox_pfad, normalisiere(st["vocals"]), SR, subtype="PCM_16")
        ergebnis.append({"id": f["id"], "melo": melo_pfad, "vox": vox_pfad, "voxDb": round(rms_db(st["vocals"]), 1)})
    print(json.dumps({"fenster": ergebnis}))


if __name__ == "__main__":
    main()

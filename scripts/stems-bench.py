"""
stems-bench.py — misst, wie lange die Stem-Trennung je Einstellung braucht.

Aufruf:  python scripts/stems-bench.py <wav-oder-mp3> [sekunden]

Trennt denselben Ausschnitt mit verschiedenen Einstellungen und nennt die
Zeiten. Damit laesst sich belegen, was eine Aenderung wirklich bringt, statt
es zu behaupten.
"""
import sys
import time

import numpy as np
import soundfile as sf
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model

SR = 44100


def lade(pfad, sekunden):
    y, sr = sf.read(pfad, dtype="float32", always_2d=True)
    y = y.mean(axis=1)
    if sr != SR:
        import librosa

        y = librosa.resample(y, orig_sr=sr, target_sr=SR, res_type="soxr_hq")
    n = int(sekunden * SR)
    start = max(0, len(y) // 3)
    return y[start : start + n]


def trenne(modell, y, device, overlap, shifts):
    wav = torch.from_numpy(np.stack([y, y]).astype(np.float32))[None]
    ref = wav.mean(0)
    wav = (wav - ref.mean()) / (ref.std() + 1e-8)
    t0 = time.perf_counter()
    with torch.no_grad():
        apply_model(modell, wav, device=device, progress=False, shifts=shifts, overlap=overlap)
    return time.perf_counter() - t0


def main():
    pfad = sys.argv[1]
    sekunden = float(sys.argv[2]) if len(sys.argv) > 2 else 10.0
    y = lade(pfad, sekunden)
    print(f"Torch {torch.__version__} · CUDA: {torch.cuda.is_available()} · Threads: {torch.get_num_threads()}")
    print(f"Ausschnitt: {len(y) / SR:.1f} s")

    for name in ("htdemucs", "mdx_extra_q"):
        try:
            t0 = time.perf_counter()
            m = get_model(name)
            m.eval()
            laden = time.perf_counter() - t0
        except Exception as e:  # Modell nicht vorhanden -> ueberspringen, nicht abbrechen
            print(f"{name}: nicht verfuegbar ({e})")
            continue
        print(f"\n{name} (Laden {laden:.1f} s)")
        for overlap, shifts in ((0.25, 1), (0.25, 0), (0.10, 0), (0.00, 0)):
            try:
                d = trenne(m, y, "cpu", overlap, shifts)
                print(f"  overlap {overlap:.2f} shifts {shifts}: {d:6.1f} s  ({d / (len(y) / SR):.2f}x Echtzeit)")
            except Exception as e:
                print(f"  overlap {overlap:.2f} shifts {shifts}: Fehler {e}")


if __name__ == "__main__":
    main()

"""
audio-zu-midi.py — mehrstimmige Transkription mit basic-pitch (Spotify, ONNX).

Aufruf:
    python scripts/audio-zu-midi.py <eingabe.wav> <ausgabe.mid> [--onset 0.5] [--frame 0.3]
           [--min-ms 58] [--min-hz 0] [--max-hz 0] [--melodia]

Die Eingabe ist eine WAV (mono oder stereo, jede Rate — basic-pitch resamplet
selbst auf 22,05 kHz). Die Ausgabe ist eine Standard-MIDI-Datei (eine Spur,
alle Noten, Velocity aus der Amplitude), die der Wizard „MIDI zu Korg" wie
jede andere MIDI-Datei liest. Auf stdout kommt EINE JSON-Zeile mit der
Zusammenfassung; alles andere geht nach stderr.

Schwellen: `onset` (0…1) — wie deutlich ein Anschlag sein muss; `frame`
(0…1) — wie sicher ein Ton je Rahmen sein muss; `min-ms` — kuerzere Noten
fallen weg; `min-hz`/`max-hz` — Tonhoehenfenster (0 = offen); `melodia` —
Glaettung fuer einstimmige Melodien.

Installiert in der py-cuda-Umgebung als `pip install --no-deps basic-pitch`
plus `onnxruntime pretty_midi mir_eval resampy scipy` (Python 3.13 baut die
alte numpy-Pinnung von basic-pitch nicht, deshalb ohne Abhaengigkeitsaufloesung).
"""
import argparse
import json
import sys
import time
import warnings

warnings.filterwarnings("ignore")


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("eingabe")
    p.add_argument("ausgabe")
    p.add_argument("--onset", type=float, default=0.5)
    p.add_argument("--frame", type=float, default=0.3)
    p.add_argument("--min-ms", type=float, default=58.0)
    p.add_argument("--min-hz", type=float, default=0.0)
    p.add_argument("--max-hz", type=float, default=0.0)
    p.add_argument("--melodia", action="store_true")
    a = p.parse_args()

    t0 = time.time()
    try:
        from basic_pitch import ICASSP_2022_MODEL_PATH
        from basic_pitch.inference import predict
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "fehler": f"basic-pitch fehlt: {e}"}))
        return 2

    try:
        _, midi_data, note_events = predict(
            a.eingabe,
            ICASSP_2022_MODEL_PATH,
            onset_threshold=a.onset,
            frame_threshold=a.frame,
            minimum_note_length=a.min_ms,
            minimum_frequency=a.min_hz or None,
            maximum_frequency=a.max_hz or None,
            melodia_trick=a.melodia,
        )
        midi_data.write(a.ausgabe)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "fehler": str(e)}))
        return 1

    noten = [
        {"start": round(float(s), 4), "ende": round(float(e), 4), "note": int(n), "vel": int(round(float(v) * 127))}
        for (s, e, n, v, *_rest) in note_events
    ]
    tief = min((n["note"] for n in noten), default=0)
    hoch = max((n["note"] for n in noten), default=0)
    print(
        json.dumps(
            {
                "ok": True,
                "noten": len(noten),
                "tiefste": tief,
                "hoechste": hoch,
                "dauer": round(max((n["ende"] for n in noten), default=0.0), 2),
                "sekunden": round(time.time() - t0, 2),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())

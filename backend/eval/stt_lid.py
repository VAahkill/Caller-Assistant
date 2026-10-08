"""Quality check for hearing callers: language identification and speech recognition
on real held-out speech (FLEURS test, never used to train any of the models).

Reports, per language, how often the language is identified correctly (each clip on
its own, restricted to the caller languages) and the character error rate (CER) of
each speech model with the language given, on clean 16 kHz audio and on the same
audio squeezed through a phone line (300-3400 Hz, 8 kHz, G.711 mu-law). Targets:
language ID >= 95 %, CER te/ta <= 0.15, hi <= 0.10, en <= 0.08.

    pip install pyarrow soundfile          # plus the server's speech extras
    python eval/stt_lid.py --clips 30 --out report.json
    python eval/stt_lid.py --models te=main,te=vasista22/whisper-telugu-small   # compare models

Clips are cached in --data (default ~/.cache/opencall-eval). Slow on a CPU: about
half an hour for the default run.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fleurs import cer, fetch  # noqa: E402

from opencall.audio import float_to_pcm16, mulaw_decode, mulaw_encode, resample  # noqa: E402

CONFIGS = {"en": "en_us", "hi": "hi_in", "te": "te_in", "ta": "ta_in"}


def phone_line(pcm16k: bytes) -> bytes:
    """What a caller sounds like after a narrowband phone call."""
    x = np.frombuffer(pcm16k, dtype=np.int16).astype(np.float32)
    spectrum = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / 16000)
    spectrum[(freqs < 300) | (freqs > 3400)] = 0
    band = np.clip(np.fft.irfft(spectrum, len(x)), -32768, 32767).astype(np.int16).tobytes()
    return resample(mulaw_decode(mulaw_encode(resample(band, 16000, 8000))), 8000, 16000)


def load_clips(lang: str, n: int, data: Path) -> list[tuple[dict, bytes]]:
    import soundfile as sf

    meta = fetch(CONFIGS[lang], n, data)
    clips = []
    for m in meta:
        audio, rate = sf.read(data / CONFIGS[lang] / m["file"], dtype="float32")
        clips.append((m, float_to_pcm16(audio)))
    return clips


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--langs", default="te,ta,hi,en")
    ap.add_argument("--candidates", default="en,hi,te,ta", help="the caller languages language ID chooses from")
    ap.add_argument("--clips", type=int, default=30)
    ap.add_argument("--data", type=Path, default=Path.home() / ".cache" / "opencall-eval")
    ap.add_argument("--models-dir", type=Path, default=Path("./data/models"), help="where converted models are kept")
    ap.add_argument("--main-model", default="large-v3-turbo")
    ap.add_argument("--models", default="", help="lang=model pairs to score (main = the main model); "
                                                 "default: the main model and each language's own model")
    ap.add_argument("--bands", default="16k,8k")
    ap.add_argument("--no-lid", action="store_true")
    ap.add_argument("--out", type=Path, default=Path("stt_lid_report.json"))
    args = ap.parse_args()

    from opencall.languages import LanguageTracker
    from opencall.providers.stt import DEFAULT_MODELS, FasterWhisperSTT

    langs = [lang.strip() for lang in args.langs.split(",") if lang.strip()]
    candidates = [lang.strip() for lang in args.candidates.split(",") if lang.strip()]
    bands = [b.strip() for b in args.bands.split(",") if b.strip()]
    pairs: list[tuple[str, str]] = []
    if args.models:
        for item in args.models.split(","):
            lang, _, model = item.partition("=")
            pairs.append((lang.strip(), model.strip()))
    else:
        for lang in langs:
            pairs.append((lang, "main"))
            if lang in DEFAULT_MODELS:
                pairs.append((lang, DEFAULT_MODELS[lang]))

    lid = None
    if not args.no_lid:
        from opencall.providers.lid import VoxLinguaLID

        lid = VoxLinguaLID()
    report: dict = {"candidates": candidates, "clips": args.clips, "lid": {}, "stt": {}, "rows": []}
    stt_by_model: dict[str, FasterWhisperSTT] = {}
    for lang in langs:
        clips = load_clips(lang, args.clips, args.data)
        for band in bands:
            audio = [(m, pcm if band == "16k" else phone_line(pcm)) for m, pcm in clips]
            if lid is not None:
                right, seconds = 0, []
                for m, pcm in audio:
                    started = time.monotonic()
                    post = LanguageTracker(candidates).restrict(lid.identify(pcm))
                    seconds.append(time.monotonic() - started)
                    guess = max(post, key=post.__getitem__)
                    right += guess == lang
                    report["rows"].append({"lang": lang, "band": band, "file": m["file"], "lid": guess,
                                           "p": round(post[guess], 3)})
                report["lid"][f"{lang}/{band}"] = {"accuracy": round(right / len(audio), 3), "n": len(audio),
                                                   "mean_s": round(float(np.mean(seconds)), 2)}
                print(f"LID {lang} {band}: {right}/{len(audio)}", flush=True)
            for plang, model in pairs:
                if plang != lang:
                    continue
                spec = args.main_model if model == "main" else model
                stt = stt_by_model.get(spec)
                if stt is None:
                    stt = stt_by_model[spec] = FasterWhisperSTT(args.main_model, "cpu", models={lang: spec},
                                                                models_dir=args.models_dir)
                    stt.models = {code: spec for code in CONFIGS}
                errors, started, total = [], time.monotonic(), 0.0
                for m, pcm in audio:
                    text = stt._run(pcm, lang).text
                    errors.append(cer(m["text"], text))
                    total += len(pcm) / 32000
                    report["rows"].append({"lang": lang, "band": band, "model": spec, "file": m["file"],
                                           "cer": round(errors[-1], 3), "text": text, "ref": m["text"]})
                elapsed = time.monotonic() - started
                key = f"{lang}/{band}/{spec}"
                report["stt"][key] = {"cer": round(float(np.mean(errors)), 3),
                                      "median_cer": round(float(np.median(errors)), 3),
                                      "realtime_factor": round(elapsed / total, 2), "n": len(errors)}
                print(f"STT {key}: CER {report['stt'][key]['cer']} (median {report['stt'][key]['median_cer']}), "
                      f"RTF {report['stt'][key]['realtime_factor']}", flush=True)
                args.out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps({"lid": report["lid"], "stt": report["stt"]}, indent=1))


if __name__ == "__main__":
    main()

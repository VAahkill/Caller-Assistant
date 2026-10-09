"""Quality check for hearing callers: language identification and speech recognition
on real held-out speech (FLEURS test, never used to train any of the models).

Reports, per language, how often the language is identified correctly (each clip on
its own, restricted to the caller languages) and the character error rate (CER) of
each speech model with the language given, on clean 16 kHz audio and on the same
audio squeezed through a phone line (300-3400 Hz, 8 kHz, G.711 mu-law), with
street-like background noise if asked ("8k@20": 20 dB below the voice). Targets:
language ID >= 95 %, CER te/ta <= 0.15, hi <= 0.10, en <= 0.08.

    pip install pyarrow soundfile          # plus the server's speech extras
    python eval/stt_lid.py --clips 30 --out report.json
    python eval/stt_lid.py --models te=main,te=vasista22/whisper-telugu-small   # compare models
    python eval/stt_lid.py --bands 16k,8k,8k@20,8k@10    # clean, phone line, phone line with noise

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
sys.path.insert(0, str(Path(__file__).resolve().parent))

from fleurs import cer, fetch  # noqa: E402
from phone import phone_line  # noqa: E402

from opencall.audio import float_to_pcm16  # noqa: E402

CONFIGS = {"en": "en_us", "hi": "hi_in", "te": "te_in", "ta": "ta_in"}


def as_heard(pcm16k: bytes, band: str, seed: int) -> bytes:
    """``band``: "16k" (as recorded), "8k" (a phone line) or "8k@<dB>" (a phone line
    with background noise that many dB below the voice)."""
    if band == "16k":
        return pcm16k
    if band == "8k":
        return phone_line(pcm16k)
    if band.startswith("8k@"):
        return phone_line(pcm16k, float(band[3:]), seed)
    raise ValueError(f"unknown band {band!r}: use 16k, 8k or 8k@<dB>")


# A simulated call's turns: (clip offset, seconds kept; 0 = the whole clip). The
# first turn is short, like "Hello, I'm from Swiggy"; the tracker settles over the call.
CALL_TURNS = [(0, 3), (1, 0), (2, 2), (3, 5)]
CALL_CUTS = sorted({cut for _, cut in CALL_TURNS if cut})


def simulated_calls(scored: list[dict], lang: str, candidates: list[str]) -> dict:
    """Each clip starts one call of CALL_TURNS (the clips after it, cut as listed),
    replayed through the call's LanguageTracker: how often the language is right
    after the first turn, on every turn, and at the end."""
    from opencall.languages import LanguageTracker

    first = every = last = 0
    for start in range(len(scored)):
        tracker = LanguageTracker(candidates)
        right = []
        for offset, cut in CALL_TURNS:
            logprobs, secs = scored[(start + offset) % len(scored)][cut]
            right.append(tracker.hear(logprobs, secs).language == lang)
        first += right[0]
        every += all(right)
        last += right[-1]
    n = max(1, len(scored))
    return {"calls": len(scored), "call_first_turn": round(first / n, 3), "call_every_turn": round(every / n, 3),
            "call_end": round(last / n, 3)}


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
    ap.add_argument("--bands", default="16k,8k@20")
    ap.add_argument("--beam", type=int, default=1, help="beam search width (the server's OPENCALL_WHISPER_BEAM_SIZE)")
    ap.add_argument("--no-lid", action="store_true")
    ap.add_argument("--no-stt", action="store_true", help="language ID only")
    ap.add_argument("--lid-dir", type=Path, default=None, help="the language-ID model (default: Hugging Face cache)")
    ap.add_argument("--out", type=Path, default=Path("stt_lid_report.json"))
    args = ap.parse_args()

    from opencall.languages import LanguageTracker
    from opencall.providers.stt import DEFAULT_MODELS, FasterWhisperSTT

    langs = [lang.strip() for lang in args.langs.split(",") if lang.strip()]
    candidates = [lang.strip() for lang in args.candidates.split(",") if lang.strip()]
    bands = [b.strip() for b in args.bands.split(",") if b.strip()]
    pairs: list[tuple[str, str]] = []
    if args.no_stt:
        pass
    elif args.models:
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

        lid = VoxLinguaLID(args.lid_dir)
    report: dict = {"candidates": candidates, "clips": args.clips, "bands": bands, "beam": args.beam, "lid": {},
                    "stt": {}, "rows": []}
    stt_by_model: dict[str, FasterWhisperSTT] = {}
    for lang in langs:
        clips = load_clips(lang, args.clips, args.data)
        for band in bands:
            audio = [(m, as_heard(pcm, band, seed)) for seed, (m, pcm) in enumerate(clips)]
            if lid is not None:
                right, seconds, scored = 0, [], []
                for m, pcm in audio:
                    started = time.monotonic()
                    whole = lid.identify(pcm)
                    seconds.append(time.monotonic() - started)
                    post = LanguageTracker(candidates).restrict(whole)
                    guess = max(post, key=post.__getitem__)
                    right += guess == lang
                    report["rows"].append({"lang": lang, "band": band, "file": m["file"], "lid": guess,
                                           "p": round(post[guess], 3)})
                    # The same clip cut short, for the simulated calls.
                    clip = {cut: (lid.identify(pcm[: cut * 32000]), min(cut, len(pcm) / 32000)) for cut in CALL_CUTS}
                    clip[0] = (whole, len(pcm) / 32000)
                    scored.append(clip)
                report["lid"][f"{lang}/{band}"] = {"accuracy": round(right / len(audio), 3), "n": len(audio),
                                                   "mean_s": round(float(np.mean(seconds)), 2),
                                                   **simulated_calls(scored, lang, candidates)}
                print(f"LID {lang} {band}: {right}/{len(audio)}; calls {report['lid'][f'{lang}/{band}']}",
                      flush=True)
            for plang, model in pairs:
                if plang != lang:
                    continue
                spec = args.main_model if model == "main" else model
                stt = stt_by_model.get(spec)
                if stt is None:
                    stt = stt_by_model[spec] = FasterWhisperSTT(args.main_model, "cpu", models={lang: spec},
                                                                models_dir=args.models_dir, beam_size=args.beam)
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

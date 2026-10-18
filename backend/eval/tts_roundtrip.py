"""Which Telugu voice is easiest to understand? Each voice says the same call lines,
the Telugu speech model writes down what it heard (also after a simulated phone
line), and the character error rate against the text is reported, with how fast
each voice speaks. A lower error rate means clearer speech; it says nothing about
how pleasant a voice sounds, so listen to the saved samples too (--save).

    python eval/tts_roundtrip.py --models-dir ./data/models --out tts_report.json --save samples/
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fleurs import cer  # noqa: E402
from stt_lid import phone_line  # noqa: E402

from opencall.audio import to_wav  # noqa: E402
from opencall.transliterate import latin_to_script  # noqa: E402

# Replies as the assistant says them (IndicTrans2 output for typical English replies),
# plus lines with English words the voice has to cope with.
LINES = [
    "హాయ్, ఇది రాహుల్ సహాయకుడు అవా. రాహుల్ ఇప్పుడు కాల్ తీసుకోలేడు. నేను ఎలా సహాయం చేయగలను?",
    "దయచేసి అపోలో ఫార్మసీకి ఎదురుగా ఉన్న గ్రీన్ గేట్కు రండి.",
    "దయచేసి ఆ పార్శిల్ను సెక్యూరిటీ గార్డుతో వదిలివేయండి.",
    "నేను ఆయనకు ఒక సందేశం పంపగలనా?",
    "క్షమించండి, నేను ఏ సంకేతాలు లేదా ఓటిపి లను పంచుకోలేను. మీరు ఫోన్ చేశారని రాహుల్కు తెలియజేస్తాను.",
    "ఒక్క క్షణం, దయచేసి, నన్ను రాహుల్తో సంప్రదించనివ్వండి.",
    "వేచి ఉన్నందుకు ధన్యవాదాలు. మీరు దానిని తలుపు వద్ద వదిలివేయవచ్చు అని రాహుల్ చెప్పారు.",
    "దయచేసి మీ పేరు మరియు మీరు ఎందుకు కాల్ చేస్తున్నారో నాకు చెప్పగలరా?",
    "నేను మీ ఫోన్కు ఎస్ఎంఎస్ ద్వారా లొకేషన్ పంపాను.",
    "దయచేసి రేపు ఉదయం మళ్ళీ కాల్ చేయండి.",
    "ఇది అమెజాన్ డెలివరీకి సంబంధించినదా?",
    "దయచేసి గంట మోగించవద్దు, శిశువు నిద్రపోతుంది.",
    "సరే, నేను అతనికి చెబుతాను. ధన్యవాదాలు, బై!",
    "క్షమించండి, మీరు మళ్ళీ చెప్పగలరా?",
    "ఆలయం తరువాత ఎడమవైపుకు తిరగండి మరియు ఇది కుడి వైపున ఉన్న మూడవ ఇల్లు.",
    "రాహుల్ తిరిగి వచ్చినప్పుడు మీ చెల్లింపును వసూలు చేయవచ్చు.",
    "పది నిమిషాల్లో మీకు తిరిగి కాల్ చేస్తానని రాహుల్ నన్ను అడిగాడు.",
    "గేట్ కోడ్ నేను పంచుకోగలిగేది కాదు, కానీ గార్డు మీ కోసం దాన్ని తెరుస్తాడు.",
    "దయచేసి లిఫ్ట్ దగ్గర వేచి ఉండండి, ఎవరైనా కిందకు వస్తారు.",
    "మీ స్విగ్గీ ఆర్డర్ను బయట బెంచ్ మీద వదిలివేయవచ్చు.",
    "మీ Swiggy ఆర్డర్ వచ్చింది, OTP ఎవరికీ చెప్పకండి.",
    "UPI ద్వారా PhonePe లో పేమెంట్ చేయవచ్చు.",
    "Amazon పార్సెల్ ని గేటు దగ్గర ఉంచండి.",
]


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--models-dir", type=Path, default=Path("./data/models"))
    ap.add_argument("--piper-dir", type=Path, default=None, help="folder with the Piper voices (default: HF cache)")
    ap.add_argument("--stt", default="vasista22/whisper-telugu-small@717212f9c4c16a78a86ddcb98f93c7f73ef8a5cc")
    ap.add_argument("--voices", default="mms:te,piper:te_IN-padmavathi-medium,piper:te_IN-venkatesh-medium")
    ap.add_argument("--save", type=Path, default=None, help="folder to save each voice's audio in")
    ap.add_argument("--out", type=Path, default=Path("tts_report.json"))
    args = ap.parse_args()

    from opencall.providers.indic import MMSEngine
    from opencall.providers.piper import PiperEngine
    from opencall.providers.stt import FasterWhisperSTT

    stt = FasterWhisperSTT(args.stt, "cpu", models_dir=args.models_dir)
    mms, piper = MMSEngine(), PiperEngine(args.piper_dir)
    report: dict = {"stt": args.stt, "summary": {}, "rows": []}
    for voice in [v.strip() for v in args.voices.split(",") if v.strip()]:
        kind, _, name = voice.partition(":")
        errors = {"16k": [], "phone": []}
        synth_s = audio_s = 0.0
        for i, line in enumerate(LINES):
            text = latin_to_script(line, "te")  # what the voice is given (see TTSRouter)
            started = time.monotonic()
            pcm = mms.synth(text, "te") if kind == "mms" else piper.synth(text, name)
            if i:  # the first one includes loading the voice
                synth_s += time.monotonic() - started
                audio_s += len(pcm) / 32000
            row = {"voice": voice, "text": text, "seconds": round(len(pcm) / 32000, 2)}
            for band, audio in [("16k", pcm), ("phone", phone_line(pcm))]:
                heard = stt._run(audio, "te").text
                errors[band].append(cer(text, heard))
                row[band] = {"heard": heard, "cer": round(errors[band][-1], 3)}
            report["rows"].append(row)
            print(json.dumps(row, ensure_ascii=False), flush=True)
            if args.save:
                args.save.mkdir(parents=True, exist_ok=True)
                (args.save / f"{voice.replace(':', '_')}-{i:02d}.wav").write_bytes(to_wav(pcm, 16000))
        report["summary"][voice] = {
            "cer_16k": round(statistics.mean(errors["16k"]), 3),
            "cer_phone": round(statistics.mean(errors["phone"]), 3),
            "median_cer_16k": round(statistics.median(errors["16k"]), 3),
            "synthesis_realtime_factor": round(synth_s / max(audio_s, 1e-9), 3),
            "lines": len(LINES),
        }
        print(json.dumps({voice: report["summary"][voice]}), flush=True)
        args.out.write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    print(json.dumps(report["summary"], indent=1))


if __name__ == "__main__":
    main()

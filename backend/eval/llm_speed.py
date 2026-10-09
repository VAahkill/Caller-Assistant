"""How fast a local LLM server answers the call prompt: prompt reading (tokens/s,
with and without the warm-up's cached prompt), time to the first word, and writing
speed (tokens/s). Uses llama.cpp's llama-server, which reports its timings.

    python eval/llm_speed.py --url http://127.0.0.1:8080 --out speed.json

The prompts are the real ones: the warm-up prompt the server caches before calls,
then a Telugu delivery caller's first turn (system prompt with the delivery details,
the caller's words in English).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[0]))
sys.path.insert(0, str(HERE))

from suite import BASE_PROFILE  # noqa: E402

from opencall.agent import Conversation  # noqa: E402
from opencall.models import Profile  # noqa: E402


def prompts() -> tuple[list[dict], list[dict]]:
    profile = Profile.model_validate(BASE_PROFILE)
    speakable = ["en", "hi", "te", "ta"]
    warm = Conversation.inbound(profile, None, "", "", speakable).warm_up_messages()
    call = Conversation.inbound(profile, None, "+919876500101", "", speakable)
    call.language, call.pivot, call._delivery = "te", True, True
    call.history.append({"role": "user", "content": "Hello, I'm calling from Swiggy. I have an order for Rahul."
                                                    " Where is the house?"})
    return warm, call._messages()


def ask(url: str, messages: list[dict], extra: dict, max_tokens: int, cache: bool = True) -> dict:
    body = {"model": "x", "messages": messages, "temperature": 0.4, "max_tokens": max_tokens, "stream": True,
            "cache_prompt": cache, **extra}
    req = urllib.request.Request(f"{url}/v1/chat/completions", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    started, first, text, timings = time.monotonic(), None, [], {}
    with urllib.request.urlopen(req, timeout=900) as r:
        for raw in r:
            line = raw.decode().strip()
            if not line.startswith("data:") or line.endswith("[DONE]"):
                continue
            chunk = json.loads(line[5:])
            timings = chunk.get("timings") or timings
            for choice in chunk.get("choices") or []:
                piece = (choice.get("delta") or {}).get("content")
                if piece:
                    first = first if first is not None else time.monotonic() - started
                    text.append(piece)
    return {"first_token_s": round(first, 2) if first is not None else None,
            "total_s": round(time.monotonic() - started, 2), "reply": "".join(text),
            "prompt_tokens_read": timings.get("prompt_n"), "prompt_cached": timings.get("cache_n"),
            "prompt_tok_s": round(timings.get("prompt_per_second", 0.0), 1),
            "reply_tokens": timings.get("predicted_n"), "gen_tok_s": round(timings.get("predicted_per_second", 0.0), 2)}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default="http://127.0.0.1:8080")
    ap.add_argument("--extra-body", default='{"reasoning_effort": "none"}')
    ap.add_argument("--out", type=Path)
    args = ap.parse_args()
    extra = json.loads(args.extra_body)
    warm, call = prompts()
    result = {"cold": ask(args.url, call, extra, 300, cache=False)}  # nothing cached
    ask(args.url, warm, extra, 1)  # the engine's warm-up
    result["after_warm_up"] = ask(args.url, call, extra, 300)
    result["long_reply"] = ask(args.url, call[:-1] + [{
        "role": "user", "content": "Please describe the way from Apollo Pharmacy to the flat in detail, in about"
                                   " 120 words."}], extra, 200)
    print(json.dumps(result, indent=1, ensure_ascii=False))
    if args.out:
        args.out.write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()

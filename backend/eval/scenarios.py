"""End-to-end check of whole calls, the way a caller meets the assistant: real
language ID, speech recognition, translation, voices and a real local LLM, through
the same CallSession a phone call or the app's practice call uses.

Each call of eval/suite.py is played by a synthetic caller: their lines are spoken
by a different voice from the assistant's, then squeezed through a phone line
(8 kHz, mu-law) with background noise, and fed in as live audio (the turn detector
decides when they stopped), or sent as a practice-call recording or typed line.
The user's side (hold answers, live replies) is scripted too.

Every call must pass all of its checks:

- answered: every caller turn got words back (or the hold, refusal or goodbye it
  needed), with no turn errors and no "something went wrong" apology;
- language: the call stayed in the caller's language, and every reply after their
  first words was in it, written in its script;
- no_leak: no tags, brackets, speaker labels or private notes were said;
- audio: every reply was spoken, and the speech reads back (text-to-speech, then
  speech-to-text) as the same words, not as letters being spelled: at least 70% of
  the sentence's letters come back, in order (digits don't count: "402" may well be
  read back as words), or for a sentence of a word or two, it isn't as long as
  spelling it out would be;
- latency: the caller heard something within 5 s of finishing each turn;
- plus what that call is about: directions given, OTP refused and the user alerted,
  message taken, hold asked and the user's answer passed on, spam ended, the facts
  given, the user's live words said in the caller's language, VIP flagged, the away
  status given, the table booked.

Every turn is saved in the JSON report (what was heard, its English, the reply in
English and as said, audio files, events, timings), with a short Markdown summary.

    python eval/scenarios.py --llm-url http://127.0.0.1:11434/v1 --llm-model qwen3.5:4b --out report/

Slow on a CPU (about a minute per call with a 4B model on 4 cores). --only runs
some calls; --resume skips calls already in the report.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import re
import shutil
import sys
import time
import unicodedata
import wave
import zlib
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[0]))
sys.path.insert(0, str(HERE))

from fleurs import cer  # noqa: E402
from phone import add_noise, phone_line  # noqa: E402
from suite import BASE_PROFILE, OWNER, OWNER_VOICES, scenarios  # noqa: E402

from opencall.audio import resample  # noqa: E402
from opencall.languages import script_of  # noqa: E402
from opencall.models import CallStatus, Profile, Task, TaskKind  # noqa: E402
from opencall.telephony.queue_bridge import QueueBridge  # noqa: E402

log = logging.getLogger("eval.scenarios")
RATE = 16000
LATENCY_LIMIT_S = 5.0  # the caller hears something this soon after they stop
READ_BACK_MIN = 0.7  # share of a sentence's letters heard back, in order, from its own speech
SCRIPT_SHARE = 0.7  # of a reply's letters in the caller's script
_LEAK = re.compile(r"[\[\]<>{}]|private note|withheld|^\s*(assistant|user|system)\s*[:：]|\bassistant\s*:", re.I | re.M)


# ---------------------------------------------------------------- the stack
def build_engine(args):
    from opencall.config import Settings
    from opencall.engine import Engine
    from opencall.providers import build_llm
    from opencall.providers.lid import LanguageID, VoxLinguaLID, WhisperLID
    from opencall.providers.mt import IndicTrans2, TranslationService
    from opencall.providers.stt import DEFAULT_MODELS, FasterWhisperSTT
    from opencall.providers.tts import TTSRouter

    data = args.data_dir
    if data.exists() and not args.keep_data:
        for name in ("profile.json", "calls.json", "messages.json", "tasks.json"):
            (data / name).unlink(missing_ok=True)
    settings = Settings(_env_file=None, data_dir=data, api_token="eval", llm_base_url=args.llm_url,
                        llm_model=args.llm_model, llm_api_key=args.llm_key, llm_extra_body=args.llm_extra_body,
                        llm_temperature=args.temperature, asterisk_enabled=False, expo_push_url="",
                        clone_provider="none", whisper_device="cpu", indic_preload="")
    models = settings.models_dir if args.models_dir is None else args.models_dir
    stt = FasterWhisperSTT(settings.whisper_model, "cpu", models=dict(DEFAULT_MODELS), models_dir=models,
                           owner_english=settings.owner_stt_model)
    lid = LanguageID(VoxLinguaLID(args.lid_dir), WhisperLID(stt))
    mt = TranslationService(IndicTrans2(args.mt_dir))
    tts = TTSRouter(settings.voices_dir, "kokoro", "none", "mms", piper="on", piper_dir=args.piper_dir)
    llm = LoggingLLM(build_llm(settings))
    return Engine(settings, llm=llm, stt=stt, lid=lid, mt=mt, tts=tts)


class LoggingLLM:
    """The real LLM client, keeping each request's messages, reply and timing."""

    def __init__(self, inner):
        self.inner = inner
        self.calls: list[dict] = []

    def __getattr__(self, name):
        return getattr(self.inner, name)

    async def stream(self, messages):
        started, first, parts = time.monotonic(), None, []
        entry = {"at": time.time(), "messages": messages}
        try:
            async for chunk in self.inner.stream(messages):
                if first is None:
                    first = time.monotonic() - started
                parts.append(chunk)
                yield chunk
        except Exception as e:
            entry["error"] = f"{e.__class__.__name__}: {e}"
            raise
        finally:
            entry.update(reply="".join(parts), first_token_s=first, total_s=round(time.monotonic() - started, 2))
            self.calls.append(entry)

    async def warm_up(self, messages):
        return await self.inner.warm_up(messages)


class EvalBridge(QueueBridge):
    """A phone line in memory. Speech isn't paced (the caller "hears" it at once);
    when each sentence arrived is noted."""

    paced = False

    def __init__(self, call_id: str, number: str, direction: str = "inbound"):
        super().__init__(call_id, number, direction)
        self.frames = 0
        self.hung_up_by = ""

    async def send_audio(self, frame: bytes) -> None:
        self.frames += 1

    async def hangup(self) -> None:
        if not self.hung_up_by:
            self.hung_up_by = "assistant"
        await super().hangup()


# ---------------------------------------------------------------- audio
def speak(engine, text: str, voice: str, lang: str) -> bytes:
    """``text`` in a caller's (or the user's) voice. "mms:ta@0.86": the MMS voice
    slowed to 0.86 of its speed (and pitch), so it doesn't sound like the assistant."""
    voice, _, factor = voice.partition("@")
    pcm = engine.tts._speak(text, voice, lang)
    if factor:
        pcm = resample(pcm, RATE, int(RATE / float(factor)))
    return pcm


def pad(pcm: bytes, before: float = 0.4, after: float = 1.2) -> bytes:
    return b"\x00\x00" * int(before * RATE) + pcm + b"\x00\x00" * int(after * RATE)


def write_wav(path: Path, pcm: bytes) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(pcm)
    return str(path)


# ---------------------------------------------------------------- text checks
def _letters(text: str) -> str:
    text = unicodedata.normalize("NFC", text).lower()
    return "".join(ch for ch in text if unicodedata.category(ch)[0] in "LM")


def read_back(said: str, heard: str) -> float:
    """How much of what was said (its letters, in order) came back from speech
    recognition of its own audio: 1.0 when everything did. Digits, spaces and
    punctuation don't count, and extra letters heard (a number read out as words)
    aren't penalised; a word spelled out letter by letter comes back as other letters."""
    a, b = _letters(said), _letters(heard)
    if not a:
        return 1.0
    prev = [0] * (len(b) + 1)
    for ch in a:
        cur = [0]
        for j, other in enumerate(b):
            cur.append(prev[j] + 1 if ch == other else max(prev[j + 1], cur[j]))
        prev = cur
    return prev[-1] / len(a)


def _spelled_words(text: str) -> list[str]:
    """Runs of three or more single Latin letters ("H E L L O"), joined ("hello").
    (Indian scripts are checked by ``read_back``: a spelled word comes back as letter
    names, which share few letters with it.)"""
    runs, run = [], []
    for word in re.split(r"[\s,.;:!?'\"()-]+", text) + [""]:
        if len(word) == 1 and word.isascii() and word.isalpha():
            run.append(word)
            continue
        if len(run) >= 3:
            runs.append("".join(run).lower())
        run = []
    return runs


def _made_of(run: str, acronyms: set[str]) -> bool:
    """Whether a run of spelled letters is the text's abbreviations one after another
    ("sbiatm" from "SBI ATM")."""
    if not run:
        return True
    return any(run.startswith(a) and _made_of(run[len(a):], acronyms) for a in acronyms)


SHORT_LETTERS = 12  # a sentence this short ("Thank you!") is judged by its length instead
SPELLED_S_PER_LETTER = 0.4  # spelling takes about this long a letter; words take under 0.1 s


def spelled_out(said: str, heard: str, seconds: float) -> bool:
    """Whether speech recognition heard letters being spelled where the text has words
    (an abbreviation such as "SBI" is meant to be spelled), or didn't hear most of it.
    Speech recognition often mishears a lone short word, so a short sentence only has
    to be no longer than spelling it would take."""
    acronyms = {w.lower() for w in re.findall(r"\b[A-Z]{2,6}\b", said)}
    if any(not _made_of(w, acronyms) for w in _spelled_words(heard)):
        return True
    letters = len(_letters(said))
    if letters < SHORT_LETTERS:
        return seconds > 0.6 + SPELLED_S_PER_LETTER * letters
    return read_back(said, heard) < READ_BACK_MIN


def script_share(text: str, lang: str) -> float:
    """How much of the text's letters are in ``lang``'s script (en: Latin)."""
    letters = [script_of(ch) for ch in text if unicodedata.category(ch).startswith("L")]
    letters = [s for s in letters if s]
    if not letters:
        return 1.0
    return sum(s == lang for s in letters) / len(letters)


def has_any(text: str, words: list[str]) -> bool:
    low = text.lower()
    return any(w.lower() in low for w in words)


# ---------------------------------------------------------------- one call
class CallRun:
    def __init__(self, engine, sc: dict, out: Path, args):
        self.engine, self.sc, self.out, self.args = engine, sc, out, args
        self.events: list[tuple[float, dict]] = []
        self.speech: list[dict] = []
        self.turns: list[dict] = []
        self.stages: list[dict] = []
        self.unexpected_holds = 0

    # --- hooks
    def _hook_speech(self):
        engine = self.engine
        original = engine.speech

        async def speech(text, voice, lang, cache=False):
            started = time.monotonic()
            pcm = await original(text, voice, lang, cache=cache)
            self.speech.append({"t": time.monotonic(), "made_in_s": round(time.monotonic() - started, 2),
                                "text": text, "lang": lang, "pcm": pcm})
            return pcm

        engine.speech = speech
        return lambda: setattr(engine, "speech", original)

    def _hook_stages(self):
        """Notes how long language ID, speech recognition and translation take."""
        engine = self.engine
        stt, mt, lid = engine.stt, engine.mt, engine.lid
        transcribe, translate, identify = stt.transcribe, mt.translate, lid.identify

        def note(stage, started, **info):
            self.stages.append({"stage": stage, "t": time.monotonic(), "s": round(time.monotonic() - started, 3),
                                **info})

        async def timed_transcribe(pcm, language_hint=None):
            started = time.monotonic()
            out = await transcribe(pcm, language_hint)
            note("stt", started, lang=language_hint, text=out.text)
            return out

        async def timed_translate(text, src, tgt):
            started = time.monotonic()
            out = await translate(text, src, tgt)
            note("mt", started, src=src, tgt=tgt)
            return out

        def timed_identify(pcm):
            started = time.monotonic()
            out = identify(pcm)
            note("lid", started)
            return out

        stt.transcribe, mt.translate, lid.identify = timed_transcribe, timed_translate, timed_identify

        def unhook():
            del stt.transcribe, mt.translate, lid.identify  # back to the class methods
        return unhook

    async def _collect(self, q, call_id_box):
        while True:
            ev = await q.get()
            if ev.get("call_id") in (None, call_id_box[0]) or ev.get("event") in ("task_update",):
                self.events.append((time.monotonic(), ev))

    def _events(self, name: str, since: float = 0.0) -> list[dict]:
        return [e for t, e in self.events if e.get("event") == name and t >= since]

    # --- waiting
    async def settle(self, session, bridge, timeout: float = 420.0) -> str:
        """Until the assistant is done with the last input: "idle", "hold" (waiting
        for the user's answer) or "ended"."""
        deadline = time.monotonic() + timeout
        quiet_since = None
        await asyncio.sleep(0.2)
        while time.monotonic() < deadline:
            if session.closed.is_set() or bridge.hung_up.is_set():
                return "ended"
            if session.record.status == CallStatus.on_hold and session._hold_waiters:
                return "hold"
            busy = (session._turn_active or not session._play_q.empty() or session._playing.is_set()
                    or not bridge.inbound.empty()
                    or any(not t.done() and "turn" in t.get_name() for t in session._tasks))
            if busy:
                quiet_since = None
            elif quiet_since is None:
                quiet_since = time.monotonic()
            elif time.monotonic() - quiet_since > 0.4:
                return "idle"
            await asyncio.sleep(0.05)
        return "timeout"

    # --- the call
    async def run(self) -> dict:
        engine, sc = self.engine, self.sc
        profile = Profile.model_validate({**BASE_PROFILE, **sc["profile"]})
        engine.store.save_profile(profile)
        await self._quiet_engine()
        unhook_speech, unhook_stages = self._hook_speech(), self._hook_stages()
        llm_before = len(engine.llm.calls)
        call_id = [""]
        q = engine.bus.subscribe()
        collector = asyncio.create_task(self._collect(q, call_id))
        direction = "outbound" if sc["outbound"] else "inbound"
        bridge = EvalBridge(f"eval{int(time.time() * 1000) % 10**9}", sc["number"], direction)
        call_id[0] = bridge.call_id
        task = None
        if sc["outbound"]:
            o = sc["outbound"]
            task = Task(kind=TaskKind(o["kind"]), number=sc["number"], goal=o["goal"], target_name=o["target_name"])
            engine.store.tasks.put(task)
            engine.tasks.pending_calls[bridge.call_id] = task.id
        started, started_wall = time.monotonic(), time.time()
        try:
            decision = engine.screen(sc["number"])
            if not decision.answer:
                raise RuntimeError(f"the call was screened out: {decision.reason}")
            session = engine.open_session(bridge)
            session.language_hint = sc["hint"]
            runner = asyncio.create_task(engine.run_session(session))
            first = await self.settle(session, bridge)  # the greeting
            greeting_done = time.monotonic()
            state = first
            steps = sc["steps"]
            for i, step in enumerate(steps):
                if state == "ended":
                    self.turns.append({"step": i, "skipped": "the call had ended"})
                    continue
                state = await self._step(i, step, session, bridge)
                following = steps[i + 1] if i + 1 < len(steps) else {}
                while state == "hold" and following.get("owner") != "answer":
                    # The user answers: as planned, or (a hold nobody planned for) by
                    # saying to take a message.
                    expected = step.get("expect", {}).get("hold")
                    if not expected:
                        self.unexpected_holds += 1
                    use_planned = expected or sc["expect"].get("hold_allowed")
                    text, lang = (sc.get("hold_answer") if use_planned else None) or OWNER["unexpected_hold"]
                    await asyncio.sleep(2.0)
                    self.turns[-1].setdefault("owner_answers", []).append(
                        {"text": text, "at": round(time.monotonic() - started, 2)})
                    await session.answer_hold(None, text, lang)
                    state = await self.settle(session, bridge)
            if not bridge.hung_up.is_set():
                bridge.hung_up_by = "caller"
                await bridge.hangup()
            await asyncio.wait_for(runner, 600)
        finally:
            unhook_speech()
            unhook_stages()
            await asyncio.sleep(0.2)
            collector.cancel()
            engine.bus.unsubscribe(q)
        timed = [t for t in self.turns if t.get("t0") is not None]
        for t in timed:
            t["rel_t0"] = round(t.pop("t0") - started, 3)
        for a, b in zip(timed, timed[1:], strict=False):
            a["rel_t1"] = b["rel_t0"]
        for st in self.stages:
            st["t"] = round(st["t"] - started, 3)
        rec = session.record
        stored_task = engine.store.tasks.get(task.id) if task else None
        result = {
            "id": sc["id"], "lang": sc["lang"], "kind": sc["kind"], "mode": sc["mode"], "hint": sc["hint"],
            "caller_voice": sc["voice"], "seconds": round(time.monotonic() - started, 1),
            "greeting_s": round(greeting_done - started, 2),
            "call": {"language": rec.language, "category": rec.category, "summary": rec.summary,
                     "message": rec.message, "urgent": rec.urgent, "action_items": rec.action_items,
                     "hung_up_by": bridge.hung_up_by,
                     "outcome": stored_task.outcome if stored_task else None,
                     "outcome_result": stored_task.result if stored_task else None},
            "transcript": [line.model_dump(mode="json") for line in rec.transcript],
            "turns": self.turns,
            "events": [{"t": round(t - started, 2), **{k: v for k, v in e.items() if k not in ("call", "who")}}
                       for t, e in self.events],
            "llm": [{k: v for k, v in c.items() if k != "messages"} | {"last_messages": c["messages"][-3:]}
                    for c in engine.llm.calls[llm_before:]],
            "stages": self.stages,
            "unexpected_holds": self.unexpected_holds,
        }
        for c in result["llm"]:
            c["at"] = round(c["at"] - started_wall, 2)
        llm_dir = self.out / "llm"
        llm_dir.mkdir(parents=True, exist_ok=True)
        with open(llm_dir / f"{sc['id']}.jsonl", "w", encoding="utf-8") as f:
            for c in engine.llm.calls[llm_before:]:
                f.write(json.dumps(c, ensure_ascii=False) + "\n")
        result["sentences"] = await self._save_speech(started)
        self._turn_texts(result, started_wall)
        result["checks"] = check(sc, result, fixed_texts(self.engine))
        result["passed"] = all(c["ok"] for c in result["checks"].values())
        return result

    def _turn_texts(self, result: dict, started_wall: float) -> None:
        """Puts into each turn what was heard (and its English), the reply as the model
        wrote it (English) and as said, the stage timings and the audio files."""
        for t in result["turns"]:
            if "rel_t0" not in t:
                continue
            lo, hi = t["rel_t0"], t.get("rel_t1", float("inf"))
            # A caller line is written when it has been transcribed, after the turn started.
            lines = [ln for ln in result["transcript"] if lo <= ln["at"] - started_wall < hi]
            heard = [ln for ln in lines if ln["speaker"] == "caller" and ln["kind"] == "speech"]
            replies = [ln for ln in lines if ln["speaker"] == "assistant"]
            t["heard"] = " ".join(ln["text"] for ln in heard)
            t["heard_english"] = " ".join(ln.get("english") or ln["text"] for ln in heard)
            t["reply"] = " ".join(ln["text"] for ln in replies)
            t["reply_english"] = " ".join(ln.get("english") or ln["text"] for ln in replies)
            t["reply_audio"] = [s["audio"] for s in result["sentences"] if lo <= s["t"] < hi and s.get("audio")]
            stages = [st for st in result["stages"] if lo <= st["t"] < hi]
            for name in ("lid", "stt", "mt"):
                done = [st["s"] for st in stages if st["stage"] == name]
                if done:
                    t[f"{name}_s"] = round(sum(done), 2)
            first_llm = next((c for c in result["llm"] if lo <= c["at"] < hi), None)
            if first_llm:
                t["llm_first_token_s"] = first_llm["first_token_s"] and round(first_llm["first_token_s"], 2)
                t["llm_total_s"] = first_llm["total_s"]

    async def _quiet_engine(self, timeout: float = 600.0) -> None:
        """Lets the engine finish preparing for calls (translations, the new prompt in
        the LLM's cache, fixed lines), as it would between real calls."""
        await asyncio.sleep(0.1)
        deadline = time.monotonic() + timeout
        while self.engine._background and time.monotonic() < deadline:
            await asyncio.sleep(0.2)

    async def _step(self, i: int, step: dict, session, bridge) -> str:
        sc, args = self.sc, self.args
        entry: dict = {"step": i, **{k: v for k, v in step.items() if k != "expect"}}
        self.turns.append(entry)
        if "owner" in step:
            t0 = time.monotonic()
            entry["t0"] = t0
            if step["owner"] == "answer":
                await asyncio.sleep(2.0)  # the user reads the question and types
                t0 = entry["t0"] = time.monotonic()
                ok = await session.answer_hold(None, step["text"], step["lang"])
                entry["accepted"] = ok
            elif step["owner"] == "say":
                await session.owner_say(step["text"], step["lang"])
            elif step["owner"] == "say_audio":
                pcm = add_noise(speak(self.engine, step["text"], OWNER_VOICES[step["lang"]], step["lang"]), 30.0, i)
                entry["audio"] = write_wav(self.out / "audio" / sc["id"] / f"{i:02d}_owner.wav", pcm)
                await session.owner_say_audio(pcm, step["lang"])
            state = await self.settle(session, bridge)
            entry["state_after"] = state
            return state
        text = step["caller"]
        mode = sc["mode"]
        entry["t0"] = None
        if mode == "typed":
            entry["t0"] = time.monotonic()
            session.submit_text(text, sc["hint"])
        else:
            pcm = speak(self.engine, text, sc["voice"], sc["lang"])
            entry["caller_seconds"] = round(len(pcm) / 2 / RATE, 2)
            line = phone_line(pad(pcm), args.snr, seed=zlib.crc32(sc["id"].encode()) % 1000 + i)
            entry["audio"] = write_wav(self.out / "audio" / sc["id"] / f"{i:02d}_caller.wav", line)
            if mode == "recording":
                entry["t0"] = time.monotonic()
                session.submit_recording(line, sc["hint"])
            else:
                # Live audio: the turn detector ends the turn after its silence.
                bridge.feed(line)
                while not bridge.inbound.empty():
                    await asyncio.sleep(0.01)
                entry["t0"] = time.monotonic()
        state = await self.settle(session, bridge)
        entry["state_after"] = state
        return state

    async def _save_speech(self, started: float) -> list[dict]:
        """Saves every spoken sentence and reads it back with the speech model."""
        out = []
        for n, s in enumerate(self.speech):
            item = {"t": round(s["t"] - started, 2), "made_in_s": s["made_in_s"], "text": s["text"],
                    "lang": s["lang"], "seconds": round(len(s["pcm"]) / 2 / RATE, 2)}
            if s["pcm"]:
                item["audio"] = write_wav(self.out / "audio" / self.sc["id"] / f"say_{n:02d}.wav", s["pcm"])
                if not self.args.no_roundtrip:
                    heard = await self.engine.stt.transcribe(s["pcm"], s["lang"])
                    item["read_back"] = heard.text
                    item["read_back_cer"] = round(cer(s["text"], heard.text), 3)
                    item["read_back_share"] = round(read_back(s["text"], heard.text), 3)
            out.append(item)
        return out


# ---------------------------------------------------------------- checks
FIXED_KEYS = ("filler", "filler_again", "hold_reminder", "fallback", "refusal")


def fixed_texts(engine) -> dict[str, list[str]]:
    """The fixed lines (in every caller language) that the checks look for."""
    return {key: sorted({engine.fixed_line(key, lang) for lang in ("en", "hi", "te", "ta")}) for key in FIXED_KEYS}


def hand_written_fixed() -> dict[str, list[str]]:
    """The same, from phrases.py (for a report saved without them)."""
    from opencall.phrases import fill, phrase

    names = BASE_PROFILE["user_name"], BASE_PROFILE["assistant_name"]
    return {key: sorted({fill(phrase(key, lang), *names) for lang in ("en", "hi", "te", "ta")}) for key in FIXED_KEYS}


def check(sc: dict, r: dict, fixed: dict[str, list[str]]) -> dict:
    lang = sc["lang"]
    checks: dict[str, dict] = {}

    def put(name, ok, detail=""):
        checks[name] = {"ok": bool(ok), "detail": detail}

    lines = r["transcript"]
    fillers = set(fixed["filler"]) | set(fixed["filler_again"]) | set(fixed["hold_reminder"])
    fallback, refusal = set(fixed["fallback"]), set(fixed["refusal"])
    assistant = [ln for ln in lines if ln["speaker"] == "assistant"]
    caller_lines = [ln for ln in lines if ln["speaker"] == "caller" and ln["kind"] == "speech"]
    first_caller_at = caller_lines[0]["at"] if caller_lines else float("inf")
    replies = [ln for ln in assistant if ln["at"] >= first_caller_at]

    events = r["events"]
    problems = []
    lat_detail = []
    max_first_audio = 0.0
    # Per step: what was said after it, until the next step.
    for idx, step in enumerate(sc["steps"]):
        turn = next((t for t in r["turns"] if t.get("step") == idx), None)
        if turn is None or turn.get("skipped"):
            # The assistant ended the call before the script did: fine for a spam call,
            # or before a line that expected nothing in particular.
            if not (sc["expect"].get("ends_by_assistant") or (not step.get("expect") and "owner" not in step)):
                problems.append(f"step {idx} not run ({turn.get('skipped') if turn else 'missing'})")
            continue
        exp = step.get("expect", {})
        t_from, t_to = turn["rel_t0"], turn.get("rel_t1", float("inf"))
        said = [s for s in r["sentences"] if t_from <= s["t"] < t_to]
        said_texts = {s["text"] for s in said}
        step_lines = [ln for ln in assistant if ln["text"] in said_texts]
        english = " ".join((ln.get("english") or ln["text"]) for ln in step_lines)
        step_events = [e for e in events if t_from <= e["t"] < t_to]
        names = [e["event"] for e in step_events]
        if "caller" in step:
            real = [s for s in said if s["text"] not in fillers]
            if real:
                lat = real[0]["t"] - t_from
                turn["first_reply_s"] = round(lat, 2)
            if said:
                first_audio = said[0]["t"] - t_from
                turn["first_audio_s"] = round(first_audio, 2)
                max_first_audio = max(max_first_audio, first_audio)
                lat_detail.append(f"step {idx}: {first_audio:.1f} s")
            ended = "call_ended" in names or r["call"]["hung_up_by"] == "assistant"
            if not real and "hold_question" not in names and "task_needs_decision" not in names and not ended:
                problems.append(f"step {idx}: no reply")
        elif said:
            turn["owner_first_audio_s"] = round(said[0]["t"] - t_from, 2)
        if exp.get("category") and not any(e.get("category") == exp["category"] for e in step_events
                                           if e["event"] == "call_category") and r["call"]["category"] != exp["category"]:
            problems.append(f"step {idx}: category {r['call']['category']!r}, expected {exp['category']!r}")
        if exp.get("reply_any") and not has_any(english, exp["reply_any"]):
            problems.append(f"step {idx}: reply lacks any of {exp['reply_any'][:4]}: {english[:160]!r}")
        if exp.get("alert"):
            kinds = [e.get("kind") for e in step_events if e["event"] == "sensitive_request"]
            if not any(k in exp["alert"] for k in kinds):
                problems.append(f"step {idx}: no {exp['alert']} alert (got {kinds})")
        if exp.get("fixed") == "refusal" and not any(ln["text"] in refusal for ln in step_lines):
            problems.append(f"step {idx}: refusal not said")
        if exp.get("hold") and "hold_question" not in names and "task_needs_decision" not in names:
            problems.append(f"step {idx}: no hold question")
        if exp.get("no_hold") and ("hold_question" in names or "task_needs_decision" in names):
            problems.append(f"step {idx}: put the caller on hold")
        if exp.get("said_to_caller"):
            user_lines = [ln for ln in lines if ln["speaker"] == "user" and ln["kind"] == "note"]
            if not user_lines:
                problems.append(f"step {idx}: the user's words weren't said")
            elif script_share(user_lines[-1]["text"], lang) < SCRIPT_SHARE:
                problems.append(f"step {idx}: the user's words weren't said in the caller's script: "
                                f"{user_lines[-1]['text'][:80]!r}")

    exp = sc.get("expect", {})
    call = r["call"]
    if exp.get("category") and call["category"] != exp["category"]:
        problems.append(f"category {call['category']!r}, expected {exp['category']!r}")
    if exp.get("ends_by_assistant") and call["hung_up_by"] != "assistant":
        problems.append("the assistant didn't end the call")
    for group in exp.get("message_all", []):
        if not has_any(call["message"], group):
            problems.append(f"message lacks any of {group}: {call['message'][:120]!r}")
    if exp.get("urgent") == "vip":
        if not any(e["event"] == "urgent_call" and e.get("reason") == "vip" for e in events) or not call["urgent"]:
            problems.append("no VIP alert")
    if exp.get("message_or_hold") and not call["message"] and not any(e["event"] == "hold_question" for e in events):
        problems.append("neither a message nor a hold question")
    if exp.get("greeting_any"):
        greeting = assistant[0] if assistant else None
        if not greeting or not has_any(greeting.get("english") or greeting["text"], exp["greeting_any"]):
            problems.append(f"greeting lacks {exp['greeting_any']}")
    if exp.get("outcome") and call["outcome"] != exp["outcome"]:
        problems.append(f"outcome {call['outcome']!r}, expected {exp['outcome']!r}")
    if exp.get("outcome_any") and not has_any(call["outcome_result"] or "", exp["outcome_any"]):
        problems.append(f"outcome result lacks the time: {call['outcome_result']!r}")
    if r["unexpected_holds"] and not exp.get("hold_allowed"):
        problems.append(f"{r['unexpected_holds']} unexpected hold(s)")
    put("expected_actions", not problems, "; ".join(problems))

    errors = [e.get("detail", "") for e in events if e["event"] == "turn_error"]
    apologies = [ln["text"] for ln in assistant if ln["text"] in fallback]
    put("no_errors", not errors and not apologies, "; ".join(errors[:3] + apologies[:1]))

    # Language: what the call settled on, every caller line, every reply after the caller spoke.
    wrong = []
    if call["language"] != lang:
        wrong.append(f"call language {call['language']}")
    wrong += [f"caller line in {ln['lang']}" for ln in caller_lines if ln["lang"] != lang]
    wrong += [f"reply in {ln['lang']}: {ln['text'][:50]!r}" for ln in replies if ln["lang"] != lang]
    put("language", not wrong, "; ".join(wrong[:4]))

    bad_script = [f"{ln['text'][:60]!r} ({script_share(ln['text'], lang):.0%})" for ln in replies
                  if script_share(ln["text"], lang) < SCRIPT_SHARE]
    put("script", not bad_script, "; ".join(bad_script[:3]))

    leaks = [ln["text"][:80] for ln in assistant if _LEAK.search(ln["text"]) or _LEAK.search(ln.get("english", ""))]
    leaks += [ln["text"][:80] for ln in lines if ln["speaker"] == "user" and _LEAK.search(ln["text"])]
    put("no_leak", not leaks, "; ".join(leaks[:3]))

    silent = [s["text"][:60] for s in r["sentences"] if not s["seconds"]]
    spelled = [f"{s['text'][:50]!r} heard as {s.get('read_back', '')[:50]!r} ({s['read_back_share']:.0%})"
               for s in r["sentences"] if "read_back" in s and spelled_out(s["text"], s["read_back"], s["seconds"])]
    put("audio", not silent and not spelled, "; ".join((["no audio: " + t for t in silent] + spelled)[:3]))

    put("latency", max_first_audio <= LATENCY_LIMIT_S, ", ".join(lat_detail))
    return checks


# ---------------------------------------------------------------- report
def summarise(results: list[dict], meta: dict) -> dict:
    by: dict[str, list[bool]] = {}
    for r in results:
        for key in ("all", f"lang:{r['lang']}", f"kind:{r['kind']}"):
            by.setdefault(key, []).append(r["passed"])
    check_names = sorted({c for r in results for c in r["checks"]})
    first_audio = [t["first_audio_s"] for r in results for t in r["turns"] if "first_audio_s" in t]
    first_reply = [t["first_reply_s"] for r in results for t in r["turns"] if "first_reply_s" in t]
    llm_first = [c["first_token_s"] for r in results for c in r["llm"] if c.get("first_token_s") is not None]
    stage = {name: [t[f"{name}_s"] for r in results for t in r["turns"] if f"{name}_s" in t and "caller" in t]
             for name in ("lid", "stt", "mt")}

    def pct(values, q):
        return round(float(np.percentile(values, q)), 2) if values else None

    return {
        "meta": meta,
        "pass_rate": round(sum(by["all"]) / len(by["all"]), 3) if results else 0.0,
        "passed": sum(by.get("all", [])), "total": len(results),
        "by": {k: f"{sum(v)}/{len(v)}" for k, v in sorted(by.items())},
        "checks": {c: f"{sum(r['checks'][c]['ok'] for r in results if c in r['checks'])}/{len(results)}"
                   for c in check_names},
        "latency_s": {"first_audio_p50": pct(first_audio, 50), "first_audio_p90": pct(first_audio, 90),
                      "first_reply_p50": pct(first_reply, 50), "first_reply_p90": pct(first_reply, 90),
                      "llm_first_token_p50": pct(llm_first, 50), "llm_first_token_p90": pct(llm_first, 90),
                      **{f"{name}_p50": pct(v, 50) for name, v in stage.items()}},
        "failed": {r["id"]: {c: v["detail"] for c, v in r["checks"].items() if not v["ok"]}
                   for r in results if not r["passed"]},
    }


def markdown(summary: dict, results: list[dict]) -> str:
    m = summary["meta"]
    out = [f"# Call scenarios: {summary['passed']}/{summary['total']} passed ({summary['pass_rate']:.0%})", "",
           f"LLM `{m['llm_model']}` at {m['llm_url']}; caller audio through an 8 kHz phone line with noise at"
           f" {m['snr']} dB SNR; {m['date']}.", "", "| Group | Passed |", "|---|---|"]
    out += [f"| {k} | {v} |" for k, v in summary["by"].items()]
    out += ["", "| Check | Passed |", "|---|---|"] + [f"| {k} | {v} |" for k, v in summary["checks"].items()]
    lat = summary["latency_s"]
    out += ["", f"Latency after the caller stops (s): first audio p50 {lat['first_audio_p50']}, p90"
            f" {lat['first_audio_p90']}; first real reply p50 {lat['first_reply_p50']}, p90 {lat['first_reply_p90']};"
            f" LLM first token p50 {lat['llm_first_token_p50']}, p90 {lat['llm_first_token_p90']}; per caller turn"
            f" p50: language ID {lat['lid_p50']}, speech recognition {lat['stt_p50']}, translation {lat['mt_p50']}.",
            ""]
    if summary["failed"]:
        out += ["## Failed", ""]
        for sid, fails in summary["failed"].items():
            out += [f"- **{sid}**: " + "; ".join(f"{c}: {d}" for c, d in fails.items())]
        out.append("")
    out += ["## Replies", ""]
    for r in results:
        out.append(f"### {r['id']} ({'pass' if r['passed'] else 'FAIL'})")
        for ln in r["transcript"]:
            if ln["kind"] == "alert":
                continue
            extra = f"  _(en: {ln['english']})_" if ln.get("english") and ln["english"] != ln["text"] else ""
            out.append(f"- {ln['speaker']} [{ln['lang']}]: {ln['text']}{extra}")
        if r["call"]["message"] or r["call"]["summary"]:
            out.append(f"- message: {r['call']['message']!r}; summary: {r['call']['summary']!r}")
        out.append("")
    return "\n".join(out)


def recheck(out: Path) -> None:
    """Runs the checks again on a saved report (after a change to the checks)."""
    report_path = out / "scenarios.json"
    report = json.loads(report_path.read_text())
    meta = report["summary"]["meta"]
    by_id = {sc["id"]: sc for sc in scenarios()}
    for r in report["scenarios"]:
        if "sentences" in r and r["id"] in by_id:
            r["checks"] = check(by_id[r["id"]], r, meta.get("fixed") or hand_written_fixed())
            r["passed"] = all(c["ok"] for c in r["checks"].values())
    summary = summarise(report["scenarios"], meta)
    report_path.write_text(json.dumps({"summary": summary, "scenarios": report["scenarios"]}, ensure_ascii=False,
                                      indent=1), encoding="utf-8")
    (out / "scenarios.md").write_text(markdown(summary, report["scenarios"]), encoding="utf-8")
    print(json.dumps({k: v for k, v in summary.items() if k not in ("meta",)}, indent=1, ensure_ascii=False))


async def main_async(args) -> None:
    engine = build_engine(args)
    args.out.mkdir(parents=True, exist_ok=True)
    report_path = args.out / "scenarios.json"
    previous = {}
    if args.resume and report_path.exists():
        previous = {r["id"]: r for r in json.loads(report_path.read_text())["scenarios"]}
    todo = [sc for sc in scenarios() if not args.only or any(re.fullmatch(p, sc["id"]) for p in args.only)]
    if args.summary == "off":
        async def no_summary(transcript):
            from opencall.agent import CallSummary
            return CallSummary("")
        from opencall.agent import Conversation
        Conversation.summarize = lambda self, transcript: no_summary(transcript)  # type: ignore[method-assign]
    started = time.monotonic()
    await engine.warm_up_all()
    log.info("Warm-up took %.0f s", time.monotonic() - started)
    meta = {"fixed": fixed_texts(engine), "llm_model": args.llm_model, "llm_url": args.llm_url, "llm_extra_body": args.llm_extra_body,
            "temperature": args.temperature, "snr": args.snr, "date": time.strftime("%Y-%m-%d %H:%M"),
            "roundtrip": not args.no_roundtrip, "summaries": args.summary, "warm_up_s": round(time.monotonic() - started)}
    results = [previous[sc["id"]] for sc in scenarios() if sc["id"] in previous and sc not in todo]
    for sc in todo:
        if sc["id"] in previous and args.resume:
            results.append(previous[sc["id"]])
            continue
        if (args.out / "audio" / sc["id"]).exists():
            shutil.rmtree(args.out / "audio" / sc["id"])
        run = CallRun(engine, sc, args.out, args)
        log.info("=== %s", sc["id"])
        try:
            r = await run.run()
        except Exception as e:
            log.exception("%s crashed", sc["id"])
            r = {"id": sc["id"], "lang": sc["lang"], "kind": sc["kind"], "mode": sc["mode"], "passed": False,
                 "checks": {"ran": {"ok": False, "detail": f"{e.__class__.__name__}: {e}"}}, "turns": run.turns,
                 "transcript": [], "llm": [], "call": {"message": "", "summary": ""}}
        results.append(r)
        log.info("%s: %s %s", sc["id"], "PASS" if r["passed"] else "FAIL",
                 {c: v["detail"] for c, v in r["checks"].items() if not v["ok"]})
        order = [s["id"] for s in scenarios()]
        results.sort(key=lambda x: order.index(x["id"]) if x["id"] in order else 999)
        summary = summarise(results, meta)
        report_path.write_text(json.dumps({"summary": summary, "scenarios": results}, ensure_ascii=False, indent=1),
                               encoding="utf-8")
        (args.out / "scenarios.md").write_text(markdown(summary, results), encoding="utf-8")
    summary = summarise(results, meta)
    print(json.dumps({k: v for k, v in summary.items() if k != "failed"}, indent=1))
    await engine.shutdown()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--llm-url", default="http://127.0.0.1:11434/v1")
    ap.add_argument("--llm-model", default="qwen3.5:4b")
    ap.add_argument("--llm-key", default="ollama")
    ap.add_argument("--llm-extra-body", default='{"reasoning_effort": "none"}')
    ap.add_argument("--temperature", type=float, default=0.4)
    ap.add_argument("--snr", type=float, default=20.0, help="background noise, dB below the caller's voice")
    ap.add_argument("--out", type=Path, default=Path("scenario_report"))
    ap.add_argument("--data-dir", type=Path, default=Path("./eval-data"), help="the server's data folder for the run")
    ap.add_argument("--keep-data", action="store_true")
    ap.add_argument("--models-dir", type=Path, default=None, help="converted speech models (default: data dir)")
    ap.add_argument("--lid-dir", type=Path, default=None)
    ap.add_argument("--mt-dir", type=Path, default=None)
    ap.add_argument("--piper-dir", type=Path, default=None)
    ap.add_argument("--only", nargs="*", help="regexes of call ids to run")
    ap.add_argument("--resume", action="store_true")
    ap.add_argument("--no-roundtrip", action="store_true", help="don't read the replies back from their speech")
    ap.add_argument("--summary", choices=["on", "off"], default="on", help="the end-of-call summary")
    ap.add_argument("--recheck", action="store_true", help="only run the checks again on the report in --out")
    args = ap.parse_args()
    if args.recheck:
        recheck(args.out)
        return
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    asyncio.run(main_async(args))


if __name__ == "__main__":
    main()

"""Pluggable speech and language providers.

Each kind has a tiny interface so the engine never imports a heavy model
directly. Real providers import their libraries lazily, so the server (and
the tests) start without a GPU or any model downloaded.
"""

from __future__ import annotations

from ..config import Settings
from .llm import LLM, OpenAICompatLLM, ScriptedLLM
from .stt import STT, FasterWhisperSTT, NullSTT
from .tts import TTSRouter
from .vad import VAD, EnergyVAD, make_vad

__all__ = [
    "LLM",
    "STT",
    "VAD",
    "TTSRouter",
    "EnergyVAD",
    "OpenAICompatLLM",
    "ScriptedLLM",
    "FasterWhisperSTT",
    "NullSTT",
    "make_vad",
    "build_llm",
    "build_stt",
]


def build_llm(s: Settings) -> LLM:
    if s.llm_provider == "scripted":
        return ScriptedLLM()
    return OpenAICompatLLM(s.llm_base_url, s.llm_api_key, s.llm_model, s.llm_temperature,
                           connect_timeout=s.llm_connect_timeout_s, first_token_timeout=s.llm_first_token_timeout_s,
                           idle_timeout=s.llm_idle_timeout_s)


def build_stt(s: Settings) -> STT:
    if s.stt_provider == "faster_whisper":
        languages = [code.strip() for code in s.caller_languages.split(",") if code.strip()]
        return FasterWhisperSTT(s.whisper_model, s.whisper_device, languages)
    return NullSTT()

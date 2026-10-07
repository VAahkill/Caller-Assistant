"""Speech to text."""

from __future__ import annotations

import asyncio
import threading
from dataclasses import dataclass
from typing import Protocol

from ..audio import pcm16_to_float


@dataclass
class Transcription:
    text: str
    language: str = "en"


class STT(Protocol):
    async def transcribe(self, pcm16k: bytes, language_hint: str | None = None) -> Transcription: ...


class FasterWhisperSTT:
    """Faster-Whisper on CPU or GPU. Detects the caller's language per turn,
    which is how a Hindi or Telugu speaking delivery partner gets answered in
    their own language."""

    def __init__(self, model: str = "large-v3-turbo", device: str = "auto", languages: list[str] | None = None):
        self.model_name = model
        self.device = device
        # When set, speech is only ever recognised as one of these. Whisper often
        # mistakes Telugu for Tamil (and similar pairs); limiting it to the
        # languages your callers actually speak avoids that.
        self.languages = languages or []
        self._model = None
        self._lock = threading.Lock()

    def warm_up(self) -> None:
        self._load()

    def _load(self):
        with self._lock:
            return self._load_locked()

    def _load_locked(self):
        if self._model is None:
            from faster_whisper import WhisperModel  # heavy import, done once

            device = self.device
            if device == "auto":
                try:
                    import torch

                    device = "cuda" if torch.cuda.is_available() else "cpu"
                except ImportError:
                    device = "cpu"
            compute = "float16" if device == "cuda" else "int8"
            self._model = WhisperModel(self.model_name, device=device, compute_type=compute)
        return self._model

    def _run(self, pcm16k: bytes, language_hint: str | None) -> Transcription:
        model = self._load()
        audio = pcm16_to_float(pcm16k)
        options = dict(beam_size=1, vad_filter=False, condition_on_previous_text=False)
        segments, info = model.transcribe(audio, language=language_hint, **options)
        if not language_hint and self.languages and info.language not in self.languages:
            # Segments are lazy, so nothing was transcribed yet; redo it in the most
            # likely of the allowed languages.
            segments, info = model.transcribe(audio, language=_closest(info, self.languages), **options)
        text = " ".join(s.text for s in segments).strip()
        return Transcription(text=text, language=info.language or "en")

    async def transcribe(self, pcm16k: bytes, language_hint: str | None = None) -> Transcription:
        return await asyncio.to_thread(self._run, pcm16k, language_hint)


# Whisper's mistakes mostly stay inside a language family (Telugu heard as Tamil
# or Kannada), so a wrong guess is first corrected to an allowed language of the
# same family.
_FAMILIES = [{"te", "ta", "kn", "ml"}, {"hi", "mr", "ne", "gu", "pa", "bn", "ur"}]


def _closest(info, allowed: list[str]) -> str:
    probs = dict(info.all_language_probs or [])
    family = next((f for f in _FAMILIES if info.language in f), set())
    candidates = [code for code in allowed if code in family] or allowed
    return max(candidates, key=lambda code: probs.get(code, 0.0))


class NullSTT:
    async def transcribe(self, pcm16k: bytes, language_hint: str | None = None) -> Transcription:
        return Transcription(text="")

"""Speech to text."""

from __future__ import annotations

import asyncio
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

    def __init__(self, model: str = "large-v3-turbo", device: str = "auto"):
        self.model_name = model
        self.device = device
        self._model = None

    def _load(self):
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
        segments, info = model.transcribe(
            pcm16_to_float(pcm16k),
            beam_size=1,
            language=language_hint,
            vad_filter=False,
            condition_on_previous_text=False,
        )
        text = " ".join(s.text for s in segments).strip()
        return Transcription(text=text, language=info.language or "en")

    async def transcribe(self, pcm16k: bytes, language_hint: str | None = None) -> Transcription:
        return await asyncio.to_thread(self._run, pcm16k, language_hint)


class NullSTT:
    async def transcribe(self, pcm16k: bytes, language_hint: str | None = None) -> Transcription:
        return Transcription(text="")

"""Voice activity detection: decides when the caller starts and stops talking.

``EnergyVAD`` needs nothing but numpy and is fine on clean phone audio.
``SileroVAD`` is far better on noisy lines (traffic, scooters) and runs on CPU.
"""

from __future__ import annotations

from typing import Protocol

import numpy as np

from ..audio import FRAME_MS, pcm16_to_float


class VAD(Protocol):
    def is_speech(self, frame: bytes) -> bool: ...


class EnergyVAD:
    def __init__(self, threshold_db: float = -38.0):
        self.threshold_db = threshold_db
        self.noise_db = -60.0

    def is_speech(self, frame: bytes) -> bool:
        x = pcm16_to_float(frame)
        rms = float(np.sqrt(np.mean(x * x)) + 1e-9)
        db = 20 * np.log10(rms)
        speech = db > max(self.threshold_db, self.noise_db + 12)
        if not speech:  # slowly track the background noise floor
            self.noise_db = 0.95 * self.noise_db + 0.05 * db
        return speech


class SileroVAD:
    def __init__(self, threshold: float = 0.5):
        from silero_vad import load_silero_vad
        import torch

        self._torch = torch
        self.model = load_silero_vad()
        self.threshold = threshold
        self._buf = np.zeros(0, dtype=np.float32)
        self._last = False

    def is_speech(self, frame: bytes) -> bool:
        # Silero wants 512-sample windows at 16 kHz.
        self._buf = np.concatenate([self._buf, pcm16_to_float(frame)])
        while len(self._buf) >= 512:
            window, self._buf = self._buf[:512], self._buf[512:]
            prob = self.model(self._torch.from_numpy(window), 16000).item()
            self._last = prob > self.threshold
        return self._last


def make_vad(kind: str) -> VAD:
    if kind == "silero":
        return SileroVAD()
    return EnergyVAD()


class TurnDetector:
    """Turns per-frame speech flags into "caller started" / "caller finished"."""

    def __init__(self, vad: VAD, end_silence_ms: int = 650, start_ms: int = 120):
        self.vad = vad
        self.end_frames = max(1, end_silence_ms // FRAME_MS)
        self.start_frames = max(1, start_ms // FRAME_MS)
        self.speaking = False
        self._voiced = 0
        self._silent = 0
        self.buffer = bytearray()
        self._preroll: list[bytes] = []

    def push(self, frame: bytes) -> tuple[str | None, bytes]:
        """Returns ("start", b"") | ("end", utterance_pcm) | (None, b"")."""
        speech = self.vad.is_speech(frame)
        if not self.speaking:
            self._preroll = (self._preroll + [frame])[-self.start_frames - 5 :]
            self._voiced = self._voiced + 1 if speech else 0
            if self._voiced >= self.start_frames:
                self.speaking = True
                self._silent = 0
                self.buffer = bytearray(b"".join(self._preroll))
                return "start", b""
            return None, b""
        self.buffer += frame
        if speech:
            self._voiced += 1
        self._silent = 0 if speech else self._silent + 1
        if self._silent >= self.end_frames:
            self.speaking = False
            self._voiced = 0
            self._preroll = []
            utt = bytes(self.buffer)
            self.buffer = bytearray()
            return "end", utt
        return None, b""

    @property
    def voiced_ms(self) -> int:
        return self._voiced * FRAME_MS

"""Voice activity detection: decides when the caller starts and stops talking.

``SileroVAD`` (the default) is far better on noisy lines (traffic, scooters) and
on quiet speech, and runs on a CPU. ``EnergyVAD`` needs nothing but numpy; it is
used when Silero isn't installed.
"""

from __future__ import annotations

import copy
import logging
import threading
from typing import Protocol

import numpy as np

from ..audio import FRAME_MS, pcm16_to_float

log = logging.getLogger("opencall.vad")


class VAD(Protocol):
    def is_speech(self, frame: bytes) -> bool: ...


class EnergyVAD:
    name = "energy"

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


_silero_model = None
_silero_lock = threading.Lock()


def _load_silero():
    """Loads the Silero model once; every call gets its own copy of the state."""
    global _silero_model
    with _silero_lock:
        if _silero_model is None:
            import torch

            threads = torch.get_num_threads()
            from silero_vad import load_silero_vad

            # Importing silero_vad sets torch to one thread for the whole process,
            # which would slow every other model (the voices) down.
            torch.set_num_threads(threads)
            try:
                import onnxruntime  # noqa: F401  (about 5x cheaper per frame than TorchScript)

                _silero_model = load_silero_vad(onnx=True)
            except ImportError:
                _silero_model = load_silero_vad()
        return _silero_model


class SileroVAD:
    def __init__(self, threshold: float = 0.5):
        import torch

        self._torch = torch
        shared = _load_silero()
        # The ONNX wrapper keeps its state in plain attributes (a shallow copy shares
        # the loaded session); the TorchScript model keeps it inside, so it is deep-copied.
        jit = isinstance(shared, torch.nn.Module)
        self.model = copy.deepcopy(shared) if jit else copy.copy(shared)
        self.model.reset_states()
        self.name = "Silero (TorchScript)" if jit else "Silero (ONNX)"
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


_warned: set[str] = set()


def make_vad(kind: str) -> VAD:
    if kind == "silero":
        try:
            return SileroVAD()
        except ImportError as e:
            reason = f"it isn't installed ({e.name}); install the vad extra"
        except Exception as e:  # a broken install must not stop calls being answered
            reason = f"it failed to load ({e.__class__.__name__}: {e})"
        if reason not in _warned:
            _warned.add(reason)
            log.warning("Silero voice detection is off because %s. Using the simple energy detector.", reason)
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

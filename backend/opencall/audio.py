"""PCM helpers. Inside the engine all audio is 16 kHz, mono, signed 16-bit."""

from __future__ import annotations

import io
import wave

import numpy as np

RATE = 16000
FRAME_MS = 20
FRAME_SAMPLES = RATE * FRAME_MS // 1000  # 320
FRAME_BYTES = FRAME_SAMPLES * 2


def resample(pcm: bytes, src_rate: int, dst_rate: int) -> bytes:
    if src_rate == dst_rate or not pcm:
        return pcm
    x = np.frombuffer(pcm, dtype=np.int16).astype(np.float32)
    n_out = int(round(len(x) * dst_rate / src_rate))
    if n_out <= 0:
        return b""
    t_out = np.linspace(0, len(x) - 1, n_out)
    y = np.interp(t_out, np.arange(len(x)), x)
    return np.clip(y, -32768, 32767).astype(np.int16).tobytes()


def float_to_pcm16(samples: np.ndarray) -> bytes:
    return (np.clip(samples, -1.0, 1.0) * 32767).astype(np.int16).tobytes()


def pcm16_to_float(pcm: bytes) -> np.ndarray:
    return np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0


# G.711 mu-law (Twilio media streams). audioop is gone from Python 3.13.
_BIAS = 0x84
_CLIP = 32635


def mulaw_decode(data: bytes) -> bytes:
    u = ~np.frombuffer(data, dtype=np.uint8).astype(np.int32) & 0xFF
    sign = u & 0x80
    exponent = (u >> 4) & 0x07
    mantissa = u & 0x0F
    sample = ((mantissa << 3) + _BIAS) << exponent
    sample -= _BIAS
    return np.where(sign != 0, -sample, sample).astype(np.int16).tobytes()


def mulaw_encode(pcm: bytes) -> bytes:
    x = np.frombuffer(pcm, dtype=np.int16).astype(np.int32)
    sign = np.where(x < 0, 0x80, 0)
    x = np.minimum(np.abs(x), _CLIP) + _BIAS
    exponent = np.floor(np.log2(x)).astype(np.int32) - 7
    exponent = np.clip(exponent, 0, 7)
    mantissa = (x >> (exponent + 3)) & 0x0F
    return (~(sign | (exponent << 4) | mantissa) & 0xFF).astype(np.uint8).tobytes()


def frames(pcm: bytes, frame_bytes: int = FRAME_BYTES):
    for i in range(0, len(pcm), frame_bytes):
        chunk = pcm[i : i + frame_bytes]
        if len(chunk) < frame_bytes:
            chunk = chunk + b"\x00" * (frame_bytes - len(chunk))
        yield chunk


def to_wav(pcm: bytes, rate: int = RATE, channels: int = 1) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(channels)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def read_wav(data: bytes) -> tuple[bytes, int]:
    """Returns mono 16-bit PCM and its rate from WAV bytes."""
    with wave.open(io.BytesIO(data), "rb") as w:
        rate, ch, width = w.getframerate(), w.getnchannels(), w.getsampwidth()
        raw = w.readframes(w.getnframes())
    if width != 2:
        raise ValueError("only 16-bit WAV is supported")
    if ch > 1:
        x = np.frombuffer(raw, dtype=np.int16).reshape(-1, ch).mean(axis=1)
        raw = x.astype(np.int16).tobytes()
    return raw, rate


class StereoRecorder:
    """Keeps caller (left) and assistant (right) audio for the call recording."""

    def __init__(self) -> None:
        self.caller = bytearray()
        self.assistant = bytearray()

    def add_caller(self, pcm: bytes) -> None:
        self.caller += pcm
        # Keep the assistant track aligned in time with silence.
        if len(self.assistant) < len(self.caller) - FRAME_BYTES * 50:
            self.assistant += b"\x00" * (len(self.caller) - FRAME_BYTES * 50 - len(self.assistant))

    def add_assistant(self, pcm: bytes) -> None:
        self.assistant += pcm

    def wav(self) -> bytes:
        n = max(len(self.caller), len(self.assistant))
        left = np.frombuffer(bytes(self.caller) + b"\x00" * (n - len(self.caller)), dtype=np.int16)
        right = np.frombuffer(bytes(self.assistant) + b"\x00" * (n - len(self.assistant)), dtype=np.int16)
        return to_wav(np.stack([left, right], axis=1).tobytes(), channels=2)

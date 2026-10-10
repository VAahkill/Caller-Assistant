"""What a caller sounds like by the time their voice reaches the assistant: a
narrowband phone line (300-3400 Hz, 8 kHz, G.711 mu-law) with background noise,
back at the 16 kHz the call pipeline works in."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from opencall.audio import mulaw_decode, mulaw_encode, resample  # noqa: E402


def _band(x: np.ndarray, rate: int = 16000, low: float = 300.0, high: float = 3400.0) -> np.ndarray:
    spectrum = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / rate)
    spectrum[(freqs < low) | (freqs > high)] = 0
    return np.fft.irfft(spectrum, len(x))


def noise_like(n: int, rate: int = 16000, seed: int = 0) -> np.ndarray:
    """Street-like background noise: pink (1/f) noise with a slow loudness wobble,
    unit RMS."""
    rng = np.random.default_rng(seed)
    white = rng.standard_normal(n)
    spectrum = np.fft.rfft(white)
    freqs = np.fft.rfftfreq(n, 1 / rate)
    spectrum[1:] /= np.sqrt(freqs[1:])
    spectrum[0] = 0
    pink = np.fft.irfft(spectrum, n)
    wobble = 1 + 0.3 * np.sin(2 * np.pi * np.arange(n) / rate * rng.uniform(0.2, 0.6) + rng.uniform(0, 6.3))
    pink *= wobble
    return pink / (np.sqrt(np.mean(pink ** 2)) + 1e-9)


def add_noise(pcm16k: bytes, snr_db: float | None, seed: int = 0) -> bytes:
    """``pcm16k`` with noise at this signal-to-noise ratio (measured over the voiced
    part); None leaves it clean."""
    if snr_db is None:
        return pcm16k
    x = np.frombuffer(pcm16k, dtype=np.int16).astype(np.float64)
    if not len(x):
        return pcm16k
    level = speech_level(x)
    if level == 0:
        return pcm16k
    noisy = x + noise_like(len(x), seed=seed) * level / (10 ** (snr_db / 20))
    return np.clip(noisy, -32768, 32767).astype(np.int16).tobytes()


# A handset's automatic gain sends speech at about this level (active speech, dB below
# full scale). Some FLEURS recordings are 35 dB quieter; through mu-law at that level
# they lose most of their detail, which no phone call does.
PHONE_LEVEL_DBFS = -26.0


def speech_level(x: np.ndarray) -> float:
    """RMS of the voiced part (samples above 5% of the peak)."""
    voiced = x[np.abs(x) > 0.05 * (np.abs(x).max() + 1e-9)]
    return float(np.sqrt(np.mean(voiced ** 2))) if len(voiced) else 0.0


def at_phone_level(pcm16k: bytes, level_dbfs: float = PHONE_LEVEL_DBFS) -> bytes:
    x = np.frombuffer(pcm16k, dtype=np.int16).astype(np.float64)
    level = speech_level(x) if len(x) else 0.0
    if level == 0:
        return pcm16k
    x *= 32768 * 10 ** (level_dbfs / 20) / level
    return np.clip(x, -32768, 32767).astype(np.int16).tobytes()


def phone_line(pcm16k: bytes, snr_db: float | None = None, seed: int = 0,
               level_dbfs: float | None = None) -> bytes:
    """``pcm16k`` (16 kHz PCM16) after background noise and a narrowband phone call,
    at a phone's speech level (None: as recorded)."""
    if level_dbfs is not None:
        pcm16k = at_phone_level(pcm16k, level_dbfs)
    noisy = add_noise(pcm16k, snr_db, seed)
    x = np.frombuffer(noisy, dtype=np.int16).astype(np.float64)
    band = np.clip(_band(x), -32768, 32767).astype(np.int16).tobytes()
    return resample(mulaw_decode(mulaw_encode(resample(band, 16000, 8000))), 8000, 16000)


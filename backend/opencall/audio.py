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


def decode_audio(data: bytes, rate: int | None = None) -> tuple[bytes, int]:
    """Mono PCM16 and rate from WAV, or from any format ffmpeg reads (the app
    records AAC/M4A, which is what phones produce natively). With ``rate``, the
    audio is converted to that rate."""
    if data[:4] == b"RIFF":
        try:
            pcm, src = read_wav(data)
            return (resample(pcm, src, rate), rate) if rate else (pcm, src)
        except (ValueError, wave.Error, EOFError):
            pass  # float or 24-bit WAV: ffmpeg reads those too
    import shutil
    import subprocess
    import tempfile

    if not shutil.which("ffmpeg"):
        raise ValueError("Install ffmpeg on the server to accept phone recordings (m4a).")
    # From a file, not a pipe: an M4A whose index comes last can't be read from a pipe,
    # and ffmpeg then "succeeds" with no audio at all.
    with tempfile.NamedTemporaryFile(suffix=".audio") as f:
        f.write(data)
        f.flush()
        proc = subprocess.run(
            ["ffmpeg", "-nostdin", "-loglevel", "error", "-i", f.name, "-ac", "1", "-ar", str(rate or RATE),
             "-f", "s16le", "pipe:1"],
            capture_output=True,
            timeout=60,
        )
    if proc.returncode != 0:
        raise ValueError("Could not read that audio file.")
    if not proc.stdout:
        raise ValueError("That recording has no audio in it.")
    return proc.stdout, rate or RATE


def trim_silence(pcm: bytes, rate: int = RATE, pad_ms: int = 250) -> bytes:
    """Cuts the silence before and after the speech in a recording. Returns b""
    when there is no speech at all. Quiet speech counts: speech is told apart from
    the recording's own background, not by a fixed level, because some phones and
    lines deliver it well below -50 dBFS."""
    x = pcm16_to_float(pcm)
    n = rate * FRAME_MS // 1000
    if len(x) < n:
        return b""
    frames_ = x[: len(x) - len(x) % n].reshape(-1, n)
    db = 20 * np.log10(np.sqrt(np.mean(frames_ * frames_, axis=1)) + 1e-9)
    peak, background = float(db.max()), float(np.percentile(db, 10))
    if peak < -75.0:
        return b""  # (near) digital silence
    if peak - background < 6.0:
        return pcm  # one level throughout: no silence around it to tell apart
    voiced = np.flatnonzero(db > max(peak - 35.0, background + 6.0))
    pad = pad_ms // FRAME_MS
    start = max(0, int(voiced[0]) - pad) * n
    end = min(len(frames_), int(voiced[-1]) + 1 + pad) * n
    return pcm[start * 2 : end * 2]


def _middle_of_longest_quiet(energy: np.ndarray) -> int:
    quiet = np.append(energy <= energy.min() * 1.5 + 1e-7, False)
    best, best_len, run = 0, 0, -1
    for i, q in enumerate(quiet):
        if q and run < 0:
            run = i
        elif not q and run >= 0:
            if i - run > best_len:
                best, best_len = (run + i) // 2, i - run
            run = -1
    return best


def split_at_pauses(pcm: bytes, rate: int = RATE, max_s: float = 9.0, min_s: float = 4.0) -> list[bytes]:
    """Cuts long speech into pieces of at most ``max_s`` seconds. Each cut is in the
    middle of the longest quiet stretch (energy averaged over 60 ms, so not inside a
    word) between ``min_s`` and ``max_s`` into the piece. Short speech comes back
    as one piece."""
    n = rate * FRAME_MS // 1000
    max_frames, min_frames = int(max_s * 1000) // FRAME_MS, int(min_s * 1000) // FRAME_MS
    x = pcm16_to_float(pcm)
    total = len(x) // n
    if total <= max_frames:
        return [pcm]
    frames_ = x[: total * n].reshape(-1, n)
    energy = np.convolve(np.mean(frames_ * frames_, axis=1), np.ones(3) / 3, mode="same")
    pieces, start = [], 0
    while total - start > max_frames:
        lo, hi = start + min_frames, start + max_frames
        cut = lo + _middle_of_longest_quiet(energy[lo:hi])
        pieces.append(pcm[start * n * 2 : cut * n * 2])
        start = cut
    pieces.append(pcm[start * n * 2 :])
    return pieces


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

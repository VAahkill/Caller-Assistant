"""Caller audio: Silero voice detection by default, and recordings from the app
decoded reliably and trimmed to the speech."""

import shutil
import subprocess

import numpy as np
import pytest

from opencall.audio import decode_audio, to_wav, trim_silence
from opencall.config import Settings
from opencall.providers.vad import EnergyVAD, make_vad

needs_ffmpeg = pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg is not installed")


def tone(seconds, rate=16000, amp=6000):
    t = np.arange(int(seconds * rate)) / rate
    return (np.sin(2 * np.pi * 220 * t) * amp).astype(np.int16).tobytes()


def test_silero_is_the_default_and_energy_the_fallback(monkeypatch, caplog):
    assert Settings().vad_provider == "silero"
    import opencall.providers.vad as vad

    def missing():
        raise ImportError("No module named 'silero_vad'", name="silero_vad")

    monkeypatch.setattr(vad, "SileroVAD", missing)
    vad._warned.clear()
    assert isinstance(make_vad("silero"), EnergyVAD)
    assert "Silero voice detection is off" in caplog.text and "silero_vad" in caplog.text
    assert isinstance(make_vad("energy"), EnergyVAD)


def test_trim_silence_keeps_quiet_speech_and_drops_silence():
    silence = b"\x00\x00" * 16000
    quiet = tone(1, amp=300)  # about -40 dBFS
    trimmed = trim_silence(silence + quiet + silence)
    assert 1.0 <= len(trimmed) / 32000 <= 1.6
    assert trim_silence(silence) == b""
    assert trim_silence(b"") == b""


@needs_ffmpeg
def test_phone_recordings_decode_even_with_the_index_at_the_end(tmp_path):
    wav = tmp_path / "in.wav"
    wav.write_bytes(to_wav(tone(2)))
    m4a = tmp_path / "rec.m4a"  # ffmpeg writes the MP4 index last unless told otherwise
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-c:a", "aac", str(m4a)], check=True)
    pcm, rate = decode_audio(m4a.read_bytes())
    assert rate == 16000 and 1.9 <= len(pcm) / 32000 <= 2.2


@needs_ffmpeg
def test_float_wav_is_read(tmp_path):
    wav = tmp_path / "in.wav"
    wav.write_bytes(to_wav(tone(1)))
    flt = tmp_path / "float.wav"
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(wav), "-c:a", "pcm_f32le", str(flt)], check=True)
    pcm, rate = decode_audio(flt.read_bytes())
    assert rate == 16000 and 0.95 <= len(pcm) / 32000 <= 1.05


@needs_ffmpeg
def test_unreadable_audio_is_an_error():
    with pytest.raises(ValueError, match="Could not read that audio file"):
        decode_audio(b"definitely not audio" * 50)

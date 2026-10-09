"""Caller audio: Silero voice detection by default, recordings from the app decoded
reliably and trimmed to the speech, and long speech transcribed in full."""

import importlib.util
import shutil
import subprocess
from types import SimpleNamespace

import numpy as np
import pytest

from opencall.audio import decode_audio, split_at_pauses, to_wav, trim_silence
from opencall.config import Settings
from opencall.providers.stt import FasterWhisperSTT
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


@pytest.mark.skipif(importlib.util.find_spec("silero_vad") is None, reason="silero-vad is not installed")
def test_silero_loads_once_and_each_call_has_its_own_state():
    import torch

    threads = torch.get_num_threads()
    a, b = make_vad("silero"), make_vad("silero")
    assert a.name.startswith("Silero") and a.model is not b.model
    assert torch.get_num_threads() == threads  # importing silero_vad must not slow the voices
    assert a.is_speech(b"\x00\x00" * 16000) is False


def test_trim_silence_keeps_quiet_speech_and_drops_silence():
    silence = b"\x00\x00" * 16000
    quiet = tone(1, amp=300)  # about -40 dBFS
    trimmed = trim_silence(silence + quiet + silence)
    assert 1.0 <= len(trimmed) / 32000 <= 1.6
    assert trim_silence(silence) == b""
    assert trim_silence(b"") == b""


def test_trim_silence_keeps_speech_quieter_than_minus_50_dbfs():
    # Some phones and lines deliver speech this quiet; it used to be cut away whole.
    silence = b"\x00\x00" * 16000
    very_quiet = tone(1, amp=60)  # about -54 dBFS
    assert 1.0 <= len(trim_silence(silence + very_quiet + silence)) / 32000 <= 1.6
    rng = np.random.default_rng(0)
    hiss = (rng.normal(0, 20, 16000)).astype(np.int16).tobytes()  # background at about -64 dBFS
    trimmed = trim_silence(hiss + tone(1, amp=1000) + hiss)
    assert 1.0 <= len(trimmed) / 32000 <= 1.6  # the hiss around the speech goes


def test_trim_silence_leaves_a_recording_without_quiet_parts_whole():
    speech = tone(0.5)
    assert trim_silence(speech) == speech


def test_long_speech_is_cut_at_its_pauses():
    pause = b"\x00\x00" * 8000  # half a second
    speech = tone(6) + pause + tone(6) + pause + tone(7)
    pieces = split_at_pauses(speech)
    assert b"".join(pieces) == speech
    # cut near the middle of each pause (6.0-6.5 s and 12.5-13.0 s), not in the speech
    first, second = len(pieces[0]) / 32000, (len(pieces[0]) + len(pieces[1])) / 32000
    assert len(pieces) == 3 and 6.1 <= first <= 6.4 and 12.6 <= second <= 12.9
    assert split_at_pauses(tone(8)) == [tone(8)]
    assert all(len(p) <= 9 * 32000 for p in split_at_pauses(tone(30)))


def test_a_long_turn_is_transcribed_in_full():
    """Whisper stops after 224 tokens, which a long Telugu turn needs; the pieces
    are transcribed one by one in the language of the first."""

    class FakeWhisper:
        def __init__(self):
            self.calls = []

        def transcribe(self, audio, language=None, **_):
            self.calls.append(language)
            text = ["ఆర్డర్ ఉంది", "గేట్ దగ్గర ఉన్నాను", "ఎక్కడికి రావాలి\ufffd"][len(self.calls) - 1]
            return iter([SimpleNamespace(text=" " + text)]), SimpleNamespace(language=language or "te",
                                                                          all_language_probs=[("te", 0.9)])

    stt = FasterWhisperSTT(languages=["en", "hi", "te"])
    stt._model = FakeWhisper()
    pause = b"\x00\x00" * 8000
    result = stt._run(tone(6) + pause + tone(6) + pause + tone(7), None)
    assert stt._model.calls == [None, "te", "te"]
    assert result.text == "ఆర్డర్ ఉంది గేట్ దగ్గర ఉన్నాను ఎక్కడికి రావాలి" and result.language == "te"


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

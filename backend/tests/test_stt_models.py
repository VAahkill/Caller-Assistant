"""Each caller language is transcribed by the best model for it: the Telugu, Tamil
and Hindi fine-tunes by default (converted once on first use), the main model for
everything else, and the main model again if a language's own model can't load."""

import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from opencall.config import Settings
from opencall.providers import build_stt
from opencall.providers import stt as stt_mod
from opencall.providers.stt import DEFAULT_MODELS, LEAD_SILENCE_S, FasterWhisperSTT, parse_models, resolve_model


def test_the_indian_language_models_are_on_by_default():
    models = parse_models("")
    assert set(models) == {"te", "ta", "hi"} and models == DEFAULT_MODELS
    assert all("@" in spec for spec in models.values())  # pinned to a revision


def test_models_can_be_replaced_or_turned_off(caplog):
    models = parse_models("te=org/better-telugu@abc, hi=off, kn = org/kannada ,nonsense")
    assert models["te"] == "org/better-telugu@abc" and models["kn"] == "org/kannada"
    assert "hi" not in models and models["ta"] == DEFAULT_MODELS["ta"]
    assert "nonsense" in caplog.text
    assert parse_models("te=main, ta=none, hi=default") == {}


def test_settings_reach_the_speech_model(tmp_path):
    stt = build_stt(Settings(data_dir=tmp_path, stt_models="te=off", whisper_model="small", caller_languages="en,te"))
    assert isinstance(stt, FasterWhisperSTT)
    assert "te" not in stt.models and "ta" in stt.models
    assert stt.model_name == "small" and stt.languages == ["en", "te"]
    assert stt.ct2_dir == tmp_path / "models" / "ct2"


def fake_hub(monkeypatch, list_repo_files):
    """The Hugging Face client, faked: these tests never go online, and CI doesn't
    install the speech extras."""
    monkeypatch.setitem(sys.modules, "huggingface_hub", SimpleNamespace(list_repo_files=list_repo_files))


def test_model_names_and_folders_are_used_as_they_are(tmp_path, monkeypatch):
    def offline(*a, **k):
        raise AssertionError("must not look anything up")

    fake_hub(monkeypatch, offline)
    assert resolve_model("large-v3-turbo", tmp_path) == "large-v3-turbo"
    folder = tmp_path / "my-model"
    folder.mkdir()
    assert resolve_model(str(folder), tmp_path) == str(folder)
    converted = tmp_path / "org--name-abcdef123456"
    converted.mkdir()
    (converted / "model.bin").write_bytes(b"x")
    assert resolve_model("org/name@abcdef1234567890", tmp_path) == str(converted)


def test_a_ready_made_ctranslate2_repo_is_not_converted(tmp_path, monkeypatch):
    fake_hub(monkeypatch, lambda repo, revision=None: ["config.json", "model.bin"])
    monkeypatch.setattr(stt_mod, "convert_to_ct2", lambda *a: pytest.fail("must not convert"))
    assert resolve_model("Systran/faster-whisper-small", tmp_path) == "Systran/faster-whisper-small"


def test_a_transformers_fine_tune_is_converted_once(tmp_path, monkeypatch):
    fake_hub(monkeypatch,
                        lambda repo, revision=None: ["config.json", "model.safetensors", "flax_model.msgpack"])
    converted = []

    def convert(repo, revision, out_root):
        converted.append((repo, revision))
        out = out_root / "done"
        out.mkdir(parents=True, exist_ok=True)
        return out

    monkeypatch.setattr(stt_mod, "convert_to_ct2", convert)
    assert resolve_model("vasista22/whisper-telugu-small@717212f9", tmp_path) == str(tmp_path / "done")
    assert converted == [("vasista22/whisper-telugu-small", "717212f9")]


def test_an_already_converted_model_is_not_downloaded_again(tmp_path):
    out = tmp_path / "org--name-0123456789ab"
    out.mkdir()
    (out / "model.bin").write_bytes(b"x")
    assert stt_mod.convert_to_ct2("org/name", "0123456789abcdef", tmp_path) == out


class FakeModel:
    def __init__(self, name):
        self.name = name
        self.calls = []

    def transcribe(self, audio, language=None, **options):
        self.calls.append(language)
        self.audio = audio
        self.options = options
        return iter([SimpleNamespace(text=f" {self.name}")]), SimpleNamespace(language=language or "en",
                                                                             all_language_probs=[])


def fake_stt(monkeypatch, broken=()):
    opened = []

    def open_model(self, spec):
        opened.append(spec)
        if spec in broken:
            raise OSError("download failed")
        return FakeModel(spec)

    monkeypatch.setattr(FasterWhisperSTT, "_open", open_model)
    stt = FasterWhisperSTT("large-v3-turbo", models={"te": "org/telugu", "ta": "org/tamil"}, models_dir=Path("/x"))
    return stt, opened


def test_each_language_is_transcribed_by_its_own_model(monkeypatch):
    stt, opened = fake_stt(monkeypatch)
    pcm = b"\x01\x00" * 16000
    assert stt._run(pcm, "te").text == "org/telugu"
    assert stt._run(pcm, "en").text == "large-v3-turbo"
    assert stt._run(pcm, "hi").text == "large-v3-turbo"  # no model of its own here
    assert stt._run(pcm, "te").text == "org/telugu"
    assert opened == ["org/telugu", "large-v3-turbo"]  # each loaded once


def test_only_the_speech_reaches_the_model_not_the_silence_around_it(monkeypatch):
    stt, _ = fake_stt(monkeypatch)
    rate = 16000
    t = np.arange(rate) / rate
    speech = (np.sin(2 * np.pi * 200 * t) * 8000).astype(np.int16).tobytes()
    silence = b"\x00\x00" * rate
    stt._run(silence + speech + silence * 2, "te")
    heard = stt._extra["org/telugu"].audio[int(rate * LEAD_SILENCE_S):]  # after the silence put first
    assert 1.0 <= len(heard) / rate <= 1.6  # the second of speech and a little padding
    stt._run(silence, "te")  # nothing but silence: passed on as it is, not dropped here
    assert len(stt._extra["org/telugu"].audio) == rate + int(rate * LEAD_SILENCE_S)


def test_the_model_hears_half_a_second_of_silence_before_the_words(monkeypatch):
    """Audio that starts right at the first sound made the fine-tuned models skip the
    first word or sentence."""
    stt, _ = fake_stt(monkeypatch)
    rate = 16000
    t = np.arange(rate) / rate
    speech = (np.sin(2 * np.pi * 200 * t) * 8000).astype(np.int16)
    stt._run(speech.tobytes(), "te")
    heard = stt._extra["org/telugu"].audio
    lead = int(rate * LEAD_SILENCE_S)
    assert LEAD_SILENCE_S == 0.5 and not heard[:lead].any()
    assert np.allclose(heard[lead:], speech / 32768.0, atol=1e-4)


def test_a_model_that_cannot_load_falls_back_to_the_main_one(monkeypatch, caplog):
    stt, opened = fake_stt(monkeypatch, broken={"org/tamil"})
    pcm = b"\x01\x00" * 16000
    assert stt._run(pcm, "ta").text == "large-v3-turbo"
    assert "Couldn't load the ta speech model org/tamil" in caplog.text
    assert stt.model_for("ta") == "large-v3-turbo"
    stt._run(pcm, "ta")
    assert opened.count("org/tamil") == 1  # not retried on every turn


def test_warm_up_loads_the_callers_language_models(monkeypatch):
    stt, opened = fake_stt(monkeypatch)
    stt.warm_up(["en", "te", "hi"])
    assert opened == ["large-v3-turbo", "org/telugu"]


def test_the_server_loads_the_models_for_the_callers_languages(engine):
    loaded = []
    engine.stt.models = {"te": "org/telugu"}
    engine.stt.warm_up = lambda languages=None: loaded.append(languages)
    engine.store.profile.caller_languages = ["en", "te"]
    engine.warm_up()
    assert loaded == [["en", "te"]]


async def test_the_users_english_replies_use_the_quicker_model(monkeypatch):
    stt, opened = fake_stt(monkeypatch)
    stt.owner_english = "small"
    pcm = b"\x01\x00" * 16000
    assert (await stt.transcribe_owner(pcm, "en")).text == "small"
    assert (await stt.transcribe_owner(pcm, "te")).text == "org/telugu"  # their language's own model
    assert (await stt.transcribe(pcm, "en")).text == "large-v3-turbo"  # callers keep the main model
    assert opened.count("small") == 1


def test_the_model_for_english_replies_waits_until_it_is_needed(monkeypatch):
    stt, opened = fake_stt(monkeypatch)
    stt.owner_english = "small"
    stt.warm_up_owner("en")  # it costs memory; many users never speak a reply
    stt.warm_up_owner("te")
    assert opened == ["org/telugu"]


async def test_without_a_quicker_model_the_users_replies_use_the_main_one(monkeypatch, caplog):
    stt, _ = fake_stt(monkeypatch, broken={"small"})
    stt.owner_english = "small"
    pcm = b"\x01\x00" * 16000
    assert (await stt.transcribe_owner(pcm, "en")).text == "large-v3-turbo"
    assert "Couldn't load the en speech model small" in caplog.text
    assert build_stt(Settings(owner_stt_model="main")).owner_english == ""
    assert build_stt(Settings()).owner_english == "small"


def test_the_server_loads_the_model_for_the_users_replies(engine):
    loaded = []
    engine.stt.warm_up_owner = loaded.append
    engine.store.profile.owner_language = "te"
    engine.warm_up()
    assert loaded == ["te"]


def test_the_beam_width_setting_reaches_every_model(monkeypatch, tmp_path):
    stt, _ = fake_stt(monkeypatch)
    pcm = b"\x01\x00" * 16000
    stt._run(pcm, "te")
    assert stt._extra["org/telugu"].options["beam_size"] == 1  # greedy unless asked
    built = build_stt(Settings(data_dir=tmp_path, whisper_beam_size=5))
    assert built.beam_size == 5
    stt.beam_size = 5
    stt._run(pcm, "en")
    assert stt._model.options["beam_size"] == 5

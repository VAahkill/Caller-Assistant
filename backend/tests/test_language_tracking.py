"""The caller's language is decided once from their first words and then kept: one
odd-sounding turn or a short "haan" never flips the call to another language, the
app hears about each change, and typed text gets its language from its script."""

import asyncio
import importlib.util
import math

import pytest

from opencall.languages import LanguageTracker, guess_language, script_runs
from opencall.providers.lid import LanguageID, build_lid, parse_labels
from opencall.providers.stt import Transcription
from opencall.telephony.queue_bridge import QueueBridge

CALLERS = ["en", "hi", "te", "ta"]


def lid(**probs):
    """A language-ID result: the given probabilities, the rest spread thinly."""
    rest = max(1e-6, 1 - sum(probs.values()))
    out = {lang: math.log(rest / 100) for lang in ["en", "hi", "te", "ta", "kn", "ml", "fr", "as"]}
    out.update({lang: math.log(p) for lang, p in probs.items()})
    return out


def test_a_clear_first_turn_settles_the_language():
    t = LanguageTracker(CALLERS)
    heard = t.hear(lid(te=0.97, ta=0.02), seconds=5)
    assert heard.language == "te" and heard.changed and t.settled
    assert heard.confidence > 0.9
    again = t.hear(lid(te=0.95), seconds=3)
    assert again.language == "te" and not again.changed


def test_unsure_short_turns_add_up_before_the_language_is_settled():
    t = LanguageTracker(CALLERS)
    first = t.hear(lid(te=0.6, ta=0.35), seconds=1.5)
    assert first.language == "te" and not t.settled  # a guess, still open
    t.hear(lid(te=0.7, ta=0.25), seconds=2)
    assert not t.settled
    t.hear(lid(te=0.75, ta=0.2), seconds=3)
    t.hear(lid(te=0.8, ta=0.15), seconds=3)
    assert t.language == "te" and t.settled


def test_the_order_of_the_callers_languages_breaks_a_tie():
    assert LanguageTracker(["te", "ta"]).hear(lid(te=0.45, ta=0.45), 3).language == "te"
    assert LanguageTracker(["ta", "te"]).hear(lid(te=0.45, ta=0.45), 3).language == "ta"


def test_only_the_callers_languages_are_ever_chosen():
    # Telugu often scores as Assamese or Kannada unrestricted; those aren't offered.
    t = LanguageTracker(["en", "te"])
    assert t.hear(lid(**{"as": 0.6, "kn": 0.3, "te": 0.05}), 5).language == "te"
    post = t.restrict(lid(**{"as": 0.6, "te": 0.05}))
    assert set(post) == {"en", "te"} and abs(sum(post.values()) - 1) < 1e-9


def test_one_odd_turn_does_not_switch_a_settled_call():
    t = LanguageTracker(CALLERS)
    t.hear(lid(te=0.97), 5)
    odd = t.hear(lid(hi=0.95), 4)  # one turn that sounded like Hindi
    assert odd.language == "te" and not odd.changed
    back = t.hear(lid(te=0.9), 4)
    assert back.language == "te"
    # and the next Hindi-sounding turn starts counting from scratch
    assert t.hear(lid(hi=0.95), 4).language == "te"


def test_two_clear_turns_in_another_language_switch_it():
    t = LanguageTracker(CALLERS)
    t.hear(lid(te=0.97), 5)
    assert t.hear(lid(hi=0.95), 4).language == "te"
    switched = t.hear(lid(hi=0.96), 3)
    assert switched.language == "hi" and switched.changed and switched.confidence >= 0.9


def test_short_words_never_switch_a_settled_language():
    t = LanguageTracker(CALLERS)
    t.hear(lid(te=0.97), 5)
    for _ in range(4):  # "haan", "ok", "yes"
        assert t.hear(lid(hi=0.99), 0.6).language == "te"


def test_an_unsure_other_language_does_not_count_towards_a_switch():
    t = LanguageTracker(CALLERS)
    t.hear(lid(te=0.97), 5)
    for _ in range(4):
        assert t.hear(lid(hi=0.6, te=0.3), 4).language == "te"


def test_a_language_chosen_in_the_app_is_settled_at_once():
    t = LanguageTracker(CALLERS)
    chosen = t.choose("ta")
    assert chosen.language == "ta" and chosen.changed and t.settled and chosen.confidence == 1.0
    assert not t.choose("ta").changed
    assert t.hear(lid(te=0.95), 4).language == "ta"  # one turn changes nothing


def test_a_language_outside_the_callers_list_can_still_be_chosen():
    t = LanguageTracker(["en", "te"])
    assert t.choose("kn").language == "kn"
    assert "kn" in t.candidates


def test_the_first_language_counts_as_a_change_even_if_it_is_the_default():
    t = LanguageTracker(["en", "hi"])
    assert t.language == "en" and not t.decided
    assert t.hear(lid(en=0.99), 5).changed
    assert not t.hear(lid(en=0.99), 5).changed


def test_an_empty_list_of_languages_means_english():
    assert LanguageTracker([]).candidates == ["en"]


@pytest.mark.parametrize("text, lang", [
    ("హలో, డెలివరీ వచ్చింది", "te"),
    ("வணக்கம், டெலிவரி வந்திருக்கு", "ta"),
    ("नमस्ते, डिलीवरी आई है", "hi"),
    ("ನಮಸ್ಕಾರ", "kn"),
    ("Swiggy నుండి ఆర్డర్ వచ్చింది", "te"),  # an English brand name in a Telugu line
    ("Hi, delivery for Rahul", "en"),
    ("123 456", "en"),
])
def test_typed_language_comes_from_the_script(text, lang):
    assert guess_language(text) == lang


def test_text_is_split_into_runs_of_one_script():
    assert script_runs("Swiggy నుండి OTP 1234 వచ్చింది.") == [
        ("en", "Swiggy "), ("te", "నుండి "), ("en", "OTP 1234 "), ("te", "వచ్చింది.")]
    assert script_runs("") == []
    assert script_runs("12, 34.") == [("en", "12, 34.")]
    assert script_runs("1. నమస్తే") == [("te", "1. నమస్తే")]
    assert "".join(piece for _, piece in script_runs("Hello हाँ ok")) == "Hello हाँ ok"


def test_language_labels_are_read_from_the_model_files():
    text = "'ab: Abkhazian' => 0\n'te: Telugu' => 2\n'af: Afrikaans' => 1\n================\n'starting_index' => 0\n"
    assert parse_labels(text) == ["ab", "af", "te"]


class BrokenLID:
    name = "VoxLingua107"
    loaded = False

    def warm_up(self):
        raise OSError("no network")

    def identify(self, pcm):
        raise OSError("no network")


class WhisperGuess:
    name = "Whisper"

    def __init__(self):
        self.calls = 0

    def warm_up(self):
        pass

    def identify(self, pcm):
        self.calls += 1
        return lid(te=0.9)


def test_language_id_falls_back_to_whispers_guess(caplog):
    whisper = WhisperGuess()
    ident = LanguageID(BrokenLID(), whisper)
    ident.warm_up()
    assert ident.failed and ident.available and ident.name == "Whisper"
    assert "isn't available" in caplog.text and "no network" in caplog.text
    assert ident.identify(b"") == lid(te=0.9) and whisper.calls == 1


def test_without_any_language_id_the_turn_is_left_to_the_speech_model(caplog):
    ident = LanguageID(BrokenLID())
    assert ident.identify(b"") is None
    assert ident.failed and not ident.available and ident.name == "none"
    assert "isn't available" in caplog.text


def test_one_bad_turn_does_not_turn_language_id_off(caplog):
    class Flaky:
        name, loaded = "VoxLingua107", True

        def __init__(self):
            self.n = 0

        def identify(self, pcm):
            self.n += 1
            if self.n == 1:
                raise ValueError("odd audio")
            return lid(ta=0.9)

    whisper = WhisperGuess()
    ident = LanguageID(Flaky(), whisper)
    assert ident.identify(b"") == lid(te=0.9)  # Whisper's guess for that turn
    assert ident.identify(b"") == lid(ta=0.9) and not ident.failed
    assert "failed on one turn" in caplog.text


def test_language_id_is_chosen_in_the_settings():
    class STT:
        def detect_language(self, pcm):
            return {}

    assert build_lid("voxlingua", STT()).primary.name == "VoxLingua107"
    assert build_lid("voxlingua", STT()).fallback is not None
    assert build_lid("voxlingua", object()).fallback is None
    assert build_lid("whisper", STT()).name == "Whisper"
    assert build_lid("none", STT()) is None


class ScriptedLID:
    name = "test"

    def __init__(self, results):
        self.results = list(results)

    def warm_up(self):
        pass

    def identify(self, pcm):
        return self.results.pop(0)


class RecordingSTT:
    def __init__(self, texts):
        self.texts = list(texts)
        self.hints = []

    async def transcribe(self, pcm, language_hint=None):
        self.hints.append(language_hint)
        return Transcription(self.texts.pop(0), language_hint or "en")


async def start_call(engine, call_id="lang1"):
    bridge = QueueBridge(call_id, "+919876543210")
    task = asyncio.create_task(engine.handle_call(bridge))
    while call_id not in engine.sessions:
        await asyncio.sleep(0.005)
    return bridge, engine.sessions[call_id], task


def language_events(engine, call_id="lang1"):
    return [(e["language"], e["confidence"]) for e in engine.bus.history
            if e["event"] == "call_language" and e.get("call_id") == call_id]


async def test_speech_is_transcribed_in_the_callers_language_and_the_app_is_told(engine, llm):
    engine.lid = ScriptedLID([lid(te=0.97), lid(hi=0.95), lid(te=0.9)])
    engine.stt = RecordingSTT(["హలో", "హా", "సరే"])
    llm.responder = lambda m: "సరే."
    bridge, s, task = await start_call(engine)
    for _ in range(3):
        await s.submit_recording(b"\x01\x00" * 16000 * 4)
    assert engine.stt.hints == ["te", "te", "te"]  # the Hindi-sounding turn stays Telugu
    assert [lang for lang, _ in language_events(engine)] == ["te"]
    assert s.record.language == "te"
    await bridge.hangup()
    await task


async def test_a_language_chosen_in_the_app_skips_language_id(engine, llm):
    engine.lid = ScriptedLID([])  # would fail if asked
    engine.stt = RecordingSTT(["வணக்கம்"])
    bridge, s, task = await start_call(engine)
    await s.submit_recording(b"\x01\x00" * 16000 * 2, "ta")
    assert engine.stt.hints == ["ta"]
    assert language_events(engine) == [("ta", 1.0)]
    await bridge.hangup()
    await task


async def test_typed_text_sets_the_language_by_its_script(engine, llm):
    llm.responder = lambda m: "OK."
    bridge, s, task = await start_call(engine)
    await s.handle_text("హలో, డెలివరీ వచ్చింది")
    await s.handle_text("హా")
    await s.handle_text("नमस्ते, डिलीवरी है")
    assert [lang for lang, _ in language_events(engine)] == ["te", "hi"]
    await bridge.hangup()
    await task


async def test_without_language_id_each_turn_is_whispers_guess(engine, llm):
    engine.lid = None
    engine.stt.next = [Transcription("హలో", "te")]
    llm.responder = lambda m: "సరే."
    bridge, s, task = await start_call(engine)
    await s.submit_recording(b"\x01\x00" * 16000)
    assert [lang for lang, _ in language_events(engine)] == ["te"]
    assert s.record.language == "te"
    await bridge.hangup()
    await task


def test_hindi_scored_as_urdu_still_counts_as_hindi():
    # Over a phone line spoken Hindi often scores as Urdu; they sound alike.
    t = LanguageTracker(CALLERS)
    assert t.hear(lid(ur=0.7, hi=0.2, te=0.05), 5).language == "hi"
    both = LanguageTracker(["en", "hi", "ur"])  # unless the callers speak both
    assert both.hear(lid(ur=0.7, hi=0.2), 5).language == "ur"


@pytest.mark.skipif(importlib.util.find_spec("torch") is None, reason="torch is not installed")
def test_the_language_id_network_matches_the_published_weights_layout():
    import numpy as np
    import torch

    from opencall.providers.lid import VoxLinguaLID, _build, _fbank_matrix

    ecapa, classifier = _build(torch)
    keys = set(ecapa.state_dict()) | {"c." + k for k in classifier.state_dict()}
    for key in ["blocks.0.conv.conv.weight", "blocks.1.res2net_block.blocks.6.norm.norm.running_mean",
                "blocks.3.se_block.conv2.conv.bias", "mfa.conv.conv.weight", "asp.tdnn.conv.conv.weight",
                "asp_bn.norm.weight", "fc.conv.weight", "c.norm.norm.weight", "c.DNN.block_0.linear.w.weight",
                "c.out.w.weight"]:
        assert key in keys
    lid_model = VoxLinguaLID()
    lid_model._model = (torch, ecapa.eval(), classifier.eval(), _fbank_matrix(torch), torch.hamming_window(400))
    lid_model.labels = [f"l{i}" for i in range(107)]
    noise = (np.random.default_rng(0).normal(0, 3000, 16000)).astype(np.int16).tobytes()
    for pcm in [noise, noise[:1000]]:  # a normal turn, and one too short to judge
        out = lid_model.identify(pcm)
        assert len(out) == 107 and abs(sum(math.exp(v) for v in out.values()) - 1) < 1e-4
    assert lid_model.features(np.zeros(16000, dtype=np.float32)).shape == (1, 101, 60)


def test_the_callers_languages_are_set_in_the_app(settings, engine):
    from fastapi.testclient import TestClient

    from opencall.api import create_app

    c = TestClient(create_app(settings, engine, start_gateways=False))
    h = {"Authorization": "Bearer test-token"}
    assert c.get("/profile", headers=h).json()["caller_languages"] == ["en", "hi", "te", "ta"]
    r = c.patch("/profile", headers=h, json={"caller_languages": ["TE", "en", "te"],
                                             "voices_by_language": {"te": "piper:te_IN-padmavathi-medium"}})
    assert r.status_code == 200 and r.json()["caller_languages"] == ["te", "en"]
    assert engine.store.profile.voices_by_language == {"te": "piper:te_IN-padmavathi-medium"}
    assert c.patch("/profile", headers=h, json={"caller_languages": ["Telugu"]}).status_code == 422
    assert c.patch("/profile", headers=h, json={"voices_by_language": {"te": "padmavathi"}}).status_code == 422
    assert engine.store.profile.caller_languages == ["te", "en"]

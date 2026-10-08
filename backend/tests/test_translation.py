"""Translation between the caller's language and English: sentence by sentence,
cached, through English between two Indian languages, never failing a call, and the
assistant's English said in the caller's language (checked again for codes)."""

import asyncio
import os
import sys
from pathlib import Path

import pytest

from opencall.languages import needs_translation
from opencall.providers import mt as mt_mod
from opencall.providers.mt import (
    IndicTrans2,
    NoTranslation,
    TranslationService,
    build_translator,
    load_indic_processor,
    split_sentences,
)
from opencall.telephony.queue_bridge import QueueBridge


def test_text_is_translated_a_sentence_at_a_time():
    assert split_sentences("Hello! Rahul isn't home. Can I take a message?") == [
        "Hello!", "Rahul isn't home.", "Can I take a message?"]
    assert split_sentences("नमस्ते। पार्सल आया है।") == ["नमस्ते।", "पार्सल आया है।"]
    assert split_sentences("Flat 4.2 is on the left\nthanks") == ["Flat 4.2 is on the left", "thanks"]
    assert split_sentences("  ") == []


@pytest.mark.parametrize("text, lang, expected", [
    ("Please come to the green gate.", "te", True),
    ("Please come to the green gate.", "en", False),
    ("దయచేసి గేటు దగ్గరకు రండి.", "te", False),
    ("Swiggy ఆర్డర్ వచ్చింది", "te", False),  # already in Telugu, with a brand name
    ("OK", "xx", False),  # a language nobody can translate into
])
def test_which_lines_need_translating(text, lang, expected):
    assert needs_translation(text, lang) is expected


class FakeDirection:
    def __init__(self):
        self.calls = []

    def translate(self, sentence, src, tgt):
        self.calls.append((sentence, src, tgt))
        return f"<{tgt}:{sentence}>"


def fake_indictrans(monkeypatch, cache_size=4096):
    model = IndicTrans2(cache_size=cache_size)
    directions = {"en-indic": FakeDirection(), "indic-en": FakeDirection()}
    monkeypatch.setattr(model, "_direction", lambda name: directions[name])
    return model, directions


def test_english_to_telugu_uses_the_flores_codes(monkeypatch):
    model, d = fake_indictrans(monkeypatch)
    assert model.translate("Hi. Come up.", "en", "te") == "<tel_Telu:Hi.> <tel_Telu:Come up.>"
    assert d["en-indic"].calls == [("Hi.", "eng_Latn", "tel_Telu"), ("Come up.", "eng_Latn", "tel_Telu")]
    assert model.translate("Hi.", "en", "en") == "Hi."
    assert d["indic-en"].calls == []


def test_between_two_indian_languages_it_goes_through_english(monkeypatch):
    model, d = fake_indictrans(monkeypatch)
    assert model.translate("నమస్తే", "te", "hi") == "<hin_Deva:<eng_Latn:నమస్తే>>"
    assert d["indic-en"].calls == [("నమస్తే", "tel_Telu", "eng_Latn")]
    assert d["en-indic"].calls == [("<eng_Latn:నమస్తే>", "eng_Latn", "hin_Deva")]


def test_repeated_sentences_come_from_the_cache(monkeypatch):
    model, d = fake_indictrans(monkeypatch, cache_size=2)
    for _ in range(3):
        model.translate("One moment, please.", "en", "ta")
    assert len(d["en-indic"].calls) == 1
    model.translate("A.", "en", "ta")
    model.translate("B.", "en", "ta")  # the oldest is dropped
    model.translate("One moment, please.", "en", "ta")
    assert len(d["en-indic"].calls) == 4


def test_unknown_languages_are_refused_by_the_engine(monkeypatch):
    model, _ = fake_indictrans(monkeypatch)
    with pytest.raises(ValueError):
        model.translate("Hi", "en", "xx")
    assert model.supports("te") and not model.supports("xx")


class Broken:
    name = "IndicTrans2"

    def __init__(self, error):
        self.error = error

    def supports(self, lang):
        return True

    def warm_up(self, languages):
        raise self.error

    def translate(self, text, src, tgt):
        raise self.error


async def test_a_missing_engine_turns_translation_off_with_a_warning(caplog):
    service = TranslationService(Broken(ImportError("No module named 'onnxruntime'")))
    assert service.available
    service.warm_up(["te"])
    assert not service.available and service.name == "none"
    assert "isn't available" in caplog.text and "onnxruntime" in caplog.text
    assert await service.translate("Hello", "en", "te") == "Hello"


async def test_one_bad_sentence_is_kept_as_it_is(caplog):
    service = TranslationService(Broken(ValueError("odd input")))
    assert await service.translate("Hello", "en", "te") == "Hello"
    assert service.available  # the engine still works for other sentences
    assert "Couldn't translate" in caplog.text


async def test_none_translates_nothing():
    service = build_translator("none")
    assert not service.available and service.name == "none"
    assert not service.can_translate("en", "te") and service.can_translate("te", "te")
    assert await service.translate("Hello", "en", "te") == "Hello"
    assert NoTranslation().translate("x", "en", "te") == "x"
    assert build_translator("indictrans2").name == "IndicTrans2"


@pytest.fixture
def restore_toolkit_modules():
    names = ["IndicTransToolkit", "IndicTransToolkit.processor"]
    saved = {name: sys.modules.pop(name) for name in names if name in sys.modules}
    yield
    for name in names:
        sys.modules.pop(name, None)
    sys.modules.update(saved)


def test_the_indic_processor_loads_without_the_package_init(tmp_path, monkeypatch, restore_toolkit_modules):
    package = tmp_path / "IndicTransToolkit"
    package.mkdir()
    (package / "__init__.py").write_text("raise ImportError('needs an older transformers')\n")
    (package / "processor.py").write_text("class IndicProcessor:\n    def __init__(self, inference=True):\n"
                                          "        self.inference = inference\n")
    monkeypatch.syspath_prepend(str(tmp_path))
    cls = load_indic_processor()
    assert cls(inference=True).inference is True
    assert load_indic_processor() is cls  # loaded once


def test_a_missing_toolkit_is_a_clear_import_error(monkeypatch, restore_toolkit_modules):
    monkeypatch.setattr(mt_mod.importlib.util, "find_spec", lambda name: None)
    with pytest.raises(ImportError, match="opencall\\[mt\\]"):
        load_indic_processor()


class FakeMT:
    name = "fake"

    def __init__(self, table=None):
        self.table = table or {}
        self.calls = []

    def supports(self, lang):
        return lang in ("en", "te", "ta", "hi", "kn")

    def warm_up(self, languages):
        self.warmed = languages

    def translate(self, text, src, tgt):
        self.calls.append((text, src, tgt))
        return self.table.get(text, f"[{tgt}] {text}")


async def start_call(engine, call_id="mt1"):
    bridge = QueueBridge(call_id, "+919876543210")
    task = asyncio.create_task(engine.handle_call(bridge))
    while call_id not in engine.sessions:
        await asyncio.sleep(0.005)
    return bridge, engine.sessions[call_id], task


async def test_an_english_reply_is_said_in_the_callers_language(engine, llm):
    engine.mt = TranslationService(FakeMT({"Please come to the green gate.": "దయచేసి ఆకుపచ్చ గేటు దగ్గరకు రండి."}))
    spoken = []
    real = engine.tts.synthesize

    async def synthesize(text, voice, lang="en"):
        spoken.append((text, lang))
        return await real(text, voice, lang)

    engine.tts.synthesize = synthesize
    llm.responder = lambda m: "Please come to the green gate."
    bridge, s, task = await start_call(engine)
    await s.handle_text("హలో, డెలివరీ వచ్చింది", "te")
    line = [x for x in s.record.transcript if x.speaker == "assistant"][-1]
    assert line.text == "దయచేసి ఆకుపచ్చ గేటు దగ్గరకు రండి." and line.english == "Please come to the green gate."
    assert line.lang == "te"
    assert ("దయచేసి ఆకుపచ్చ గేటు దగ్గరకు రండి.", "te") in spoken
    assert s.conv.history[-1]["content"] == "Please come to the green gate."  # the assistant's own words
    await bridge.hangup()
    await task


async def test_a_reply_already_in_the_callers_language_is_not_translated(engine, llm):
    fake = FakeMT()
    engine.mt = TranslationService(fake)
    llm.responder = lambda m: "సరే, గేటు దగ్గరకు రండి."
    bridge, s, task = await start_call(engine)
    await s.handle_text("హలో", "te")
    assert fake.calls == []
    await bridge.hangup()
    await task


async def test_a_translation_that_reveals_a_code_is_not_said(engine, llm):
    engine.mt = TranslationService(FakeMT({"Okay, thank you.": "సరే, 482913 ధన్యవాదాలు."}))
    llm.responder = lambda m: "Okay, thank you."
    bridge, s, task = await start_call(engine)
    await s.handle_text("హలో", "te")
    assert not any("482913" in x.text for x in s.record.transcript)
    assert any(e["event"] == "sensitive_request" and e["kind"] == "blocked_output" for e in engine.bus.history)
    await bridge.hangup()
    await task


def test_fixed_lines_are_hand_written_or_translated(engine):
    fake = FakeMT()
    engine.mt = TranslationService(fake)
    assert engine.fixed_line("filler", "te") == "ఒక్క క్షణం ఆగండి."
    assert engine.fixed_line("filler", "kn") == "[kn] One moment, please."
    assert engine.fixed_line("filler", "en") == "One moment, please."
    assert fake.calls == [("One moment, please.", "en", "kn")]


def test_translation_is_warmed_for_the_callers_languages(engine):
    fake = FakeMT()
    engine.mt = TranslationService(fake)
    engine.store.profile.caller_languages = ["en", "te", "ta"]
    engine.warm_up()
    assert fake.warmed == ["te", "ta"] and engine.ready["mt"] is True


MT_DIR = os.environ.get("OPENCALL_TEST_MT_DIR")


@pytest.mark.skipif(not MT_DIR, reason="set OPENCALL_TEST_MT_DIR to a folder with the IndicTrans2 models to run")
def test_real_translation_keeps_names_and_numbers():
    model = IndicTrans2(Path(MT_DIR))
    te = model.translate("Rahul will be home at 5 PM.", "en", "te")
    assert "5" in te and any("ఀ" <= ch <= "౿" for ch in te)
    back = model.translate("నేను గేటు దగ్గర ఉన్నాను.", "te", "en").lower()
    assert "gate" in back

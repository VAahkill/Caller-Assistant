"""Telugu, Tamil and other Indian-language voices: routing and number spelling."""

import asyncio

from opencall.providers.indic import spell_numbers
from opencall.providers.tts import TTSRouter
from opencall.telephony.queue_bridge import QueueBridge


class FakeEngine:
    def __init__(self, kind="mms"):
        self.kind = kind
        self.calls = []

    def synth(self, *args):
        self.calls.append(args)
        return b"\x00\x00" * 160

    def warm_up(self, lang):
        self.calls.append(("warm", lang))


def router(tmp_path, indic="mms"):
    r = TTSRouter(tmp_path / "voices", provider="kokoro", clone_provider="none", indic=indic)
    r.kokoro = FakeEngine("kokoro")
    if r.indic is not None:
        r.indic = FakeEngine(indic)
    return r


def test_digits_are_spoken_as_words():
    assert spell_numbers("ఫ్లాట్ 9849012345 కి రండి", "te") == (
        "ఫ్లాట్ తొమ్మిది ఎనిమిది నాలుగు తొమ్మిది సున్నా ఒకటి రెండు మూడు నాలుగు ఐదు కి రండి"
    )
    assert spell_numbers("₹302 மட்டும்", "ta") == "மூன்று பூஜ்ஜியம் இரண்டு ரூபாய் மட்டும்"
    assert spell_numbers("Flat 302", "en") == "Flat 302"


def test_telugu_and_tamil_use_the_indian_language_voice(tmp_path):
    r = router(tmp_path)
    r._synth_sync("నమస్కారం", "kokoro:am_adam", "te")
    r._synth_sync("வணக்கம்", "kokoro:af_heart", "ta")
    r._synth_sync("Hello", "kokoro:af_heart", "en")
    r._synth_sync("Sure, one minute.", "kokoro:af_heart", "te")  # model answered in English
    assert r.indic.calls == [("నమస్కారం", "te", "male", ""), ("வணக்கம்", "ta", "female", "")]
    assert r.kokoro.calls == [("Hello", "af_heart", "en"), ("Sure, one minute.", "af_heart", "en")]
    assert {"te", "ta", "en", "hi"} <= r.supported_languages("kokoro:af_heart")
    assert {"te", "ta"} <= r.supported_languages("clone:mum")  # clones fall back for these
    assert "mms:te" in [v.id for v in r.list_voices()]


def test_parler_speakers_are_offered_and_keep_their_gender_in_english(tmp_path):
    r = router(tmp_path, indic="parler")
    ids = [v.id for v in r.list_voices()]
    assert {"parler:Lalitha", "parler:Prakash", "parler:Jaya"} <= set(ids)
    r._synth_sync("నమస్కారం", "parler:Prakash", "te")
    r._synth_sync("Hello", "parler:Prakash", "en")
    assert r.indic.calls == [("నమస్కారం", "te", "male", "Prakash")]
    assert r.kokoro.calls == [("Hello", "am_michael", "en")]


def test_can_be_turned_off(tmp_path):
    r = router(tmp_path, indic="none")
    assert "te" not in r.supported_languages("kokoro:af_heart")
    assert not [v for v in r.list_voices() if v.id.startswith("mms:")]


async def test_a_telugu_caller_is_answered_in_telugu(engine, llm, tmp_path):
    spoken = []

    async def synthesize(text, voice, lang="en"):
        spoken.append(lang)
        return b"\x00\x00" * 160

    engine.tts = router(tmp_path)
    engine.tts.synthesize = synthesize
    llm.responder = lambda m: "సరే, మీ ఆర్డర్ కోసం వచ్చారా?"
    bridge = QueueBridge("call1", "+919876543210")
    task = asyncio.create_task(engine.handle_call(bridge))
    while "call1" not in engine.sessions:
        await asyncio.sleep(0.01)
    session = engine.sessions["call1"]
    await session.handle_text("హలో, డెలివరీ వచ్చింది", "te")
    system_text = " ".join(m["content"] for m in llm.calls[-1] if m["role"] == "system")
    assert "Telugu" in system_text and "Tamil" in system_text
    assert spoken[-1] == "te"
    await bridge.hangup()
    await task


def test_speech_is_kept_to_the_callers_languages():
    from types import SimpleNamespace

    from opencall.providers.stt import FasterWhisperSTT

    class FakeWhisper:
        def __init__(self):
            self.languages = []

        def transcribe(self, audio, language=None, **_):
            self.languages.append(language)
            info = SimpleNamespace(language=language or "ta", all_language_probs=[("ta", 0.52), ("hi", 0.08), ("te", 0.02), ("en", 0.01)])
            return iter([SimpleNamespace(text=" నమస్కారం")]), info

    # Heard as Tamil; Hindi scores higher than Telugu, but Telugu is the allowed
    # language closest to Tamil.
    stt = FasterWhisperSTT(languages=["en", "hi", "te"])
    stt._model = FakeWhisper()
    result = stt._run(b"\x00\x00" * 1600, None)
    assert result.language == "te" and stt._model.languages == [None, "te"]

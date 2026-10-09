"""Start-up: speech models and the LLM are loaded before the first call, readiness is
tracked, and fixed lines are spoken from memory."""

import asyncio

from opencall.agent import opening_line
from opencall.providers.llm import LLMError, ScriptedLLM
from opencall.telephony.queue_bridge import QueueBridge


class WarmableLLM(ScriptedLLM):
    def __init__(self, fail=0):
        super().__init__(lambda m: "A short summary.")
        self.warmed: list[list[dict]] = []
        self.fail = fail

    async def warm_up(self, messages):
        self.warmed.append(messages)
        if self.fail:
            self.fail -= 1
            raise LLMError("Couldn't reach the language model at http://ollama:11434/v1 (ConnectError).")


async def test_llm_is_warmed_with_the_real_call_prompt(engine):
    engine.llm = WarmableLLM()
    await engine.warm_up_llm()
    system = engine.llm.warmed[0][0]
    assert system["role"] == "system" and "WHAT TO DO" in system["content"] and "THIS CALL" in system["content"]
    assert engine.llm.warmed[0][-1]["role"] == "user"
    assert engine.ready["llm"] is True


async def test_a_failed_warm_up_is_reported_not_ready(engine, caplog):
    engine.llm = WarmableLLM(fail=1)
    await engine.warm_up_llm(retry=False)
    assert engine.ready["llm"] is False
    assert "Couldn't reach the language model" in caplog.text


async def test_a_failed_turn_marks_the_llm_not_ready_until_it_answers_again(engine):
    engine.llm = WarmableLLM()
    engine.ready["llm"] = True
    engine.llm_failed()
    assert engine.ready["llm"] is False
    await engine._llm_warming
    assert engine.ready["llm"] is True


async def test_the_prompt_is_cached_again_after_a_call_summary(engine):
    engine.llm = WarmableLLM()
    bridge = QueueBridge("c1", "+919876543210")
    task = asyncio.create_task(engine.handle_call(bridge))
    while "c1" not in engine.sessions:
        await asyncio.sleep(0.01)
    s = engine.sessions["c1"]
    s.conv.llm = engine.llm
    await s.handle_text("Hi, tell Rahul that Priya called.", "en")
    await bridge.hangup()
    await task
    assert s.record.summary == "A short summary."
    await engine._llm_warming
    assert len(engine.llm.warmed) == 1


def test_speech_warm_up_sets_ready_and_keeps_fixed_lines_in_memory(engine):
    synth = []
    real = engine.tts._synth_sync
    engine.tts._synth_sync = lambda text, voice, lang: synth.append((text, lang)) or real(text, voice, lang)
    engine.warm_up()
    assert engine.ready["stt"] and engine.ready["tts"]
    assert (opening_line(engine.store.profile), "en") in synth
    assert ("ఒక్క క్షణం ఆగండి.", "te") in synth  # "one moment" for Telugu callers

    async def must_not_synthesize(*a, **k):
        raise AssertionError("should come from memory")

    engine.tts.synthesize = must_not_synthesize
    pcm = asyncio.run(engine.speech(opening_line(engine.store.profile), engine.store.profile.voice, "en", cache=True))
    assert pcm


def test_the_refusal_to_share_a_code_is_ready_in_every_caller_language(engine):
    engine.store.profile.caller_languages = ["te", "ta"]
    engine.warm_up()

    async def must_not_synthesize(*a, **k):
        raise AssertionError("should come from memory")

    engine.tts.synthesize = must_not_synthesize
    voice = engine.store.profile.voice
    for lang in ("te", "ta"):
        assert asyncio.run(engine.speech(engine.fixed_line("refusal", lang), voice, lang, cache=True))


async def test_a_profile_change_prepares_the_new_prompt_and_greeting(engine):
    engine.llm = WarmableLLM()
    engine.ready["tts"] = True
    engine.store.profile.user_name = "Priya"
    engine.store.save_profile()
    engine.store.profile.assistant_name = "Maya"
    engine.store.save_profile()  # while the first warm-up is still running
    while engine._background:
        await asyncio.gather(*engine._background)
    assert len(engine.llm.warmed) == 2  # once, then again with the newest prompt
    assert "Priya" in engine.llm.warmed[-1][0]["content"] and "Maya" in engine.llm.warmed[-1][0]["content"]
    greeting = opening_line(engine.store.profile)
    assert "Priya" in greeting and "Maya" in greeting and (greeting, engine.store.profile.voice, "en") in engine._speech_cache


async def test_a_profile_change_during_a_call_waits_for_the_call_to_end(engine):
    engine.llm = WarmableLLM()
    bridge = QueueBridge("c1", "+919876543210")
    task = asyncio.create_task(engine.handle_call(bridge))
    while "c1" not in engine.sessions:
        await asyncio.sleep(0.01)
    engine.sessions["c1"].conv.llm = engine.llm
    engine.store.profile.user_name = "Priya"
    engine.store.save_profile()
    assert engine.llm.warmed == []  # not while the caller is using the model
    await bridge.hangup()
    await task
    await engine._llm_warming
    assert "Priya" in engine.llm.warmed[-1][0]["content"]

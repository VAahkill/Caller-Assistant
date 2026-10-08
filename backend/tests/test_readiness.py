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

"""A call turn never ends in silence: failures are reported and apologised for, slow
replies get a "one moment", turns run one at a time, hang-up stops everything, and
the app is told what the assistant is doing."""

import asyncio

import pytest

from opencall.phrases import phrase
from opencall.providers.llm import LLMError, LLMTimeout, ScriptedLLM
from opencall.providers.stt import Transcription
from opencall.telephony.queue_bridge import QueueBridge


async def start_call(engine, call_id="t1", number="+919876543210"):
    bridge = QueueBridge(call_id, number)
    task = asyncio.create_task(engine.handle_call(bridge))
    while call_id not in engine.sessions:
        await asyncio.sleep(0.005)
    return bridge, engine.sessions[call_id], task


def events(engine, name, call_id="t1"):
    return [e for e in engine.bus.history if e["event"] == name and e.get("call_id") == call_id]


def assistant_lines(session):
    return [l.text for l in session.record.transcript if l.speaker == "assistant"]


class SlowLLM(ScriptedLLM):
    """Waits before the first word; records whether the stream was closed."""

    def __init__(self, delay, reply="Sure, come to the green gate."):
        super().__init__(lambda m: reply)
        self.delay = delay
        self.closed = 0
        self.started = asyncio.Event()

    async def stream(self, messages):
        self.calls.append(messages)
        self.started.set()
        try:
            await asyncio.sleep(self.delay)
            for word in self.responder(messages).split(" "):
                yield word + " "
        finally:
            self.closed += 1


class FailingLLM(ScriptedLLM):
    def __init__(self, error):
        super().__init__()
        self.error = error

    async def stream(self, messages):
        self.calls.append(messages)
        raise self.error
        yield  # an async generator, like the real client


@pytest.mark.parametrize("error", [LLMTimeout("The language model didn't start answering within 180 s."),
                                   RuntimeError("boom")])
async def test_a_failed_turn_is_reported_and_apologised_for(engine, error):
    engine.llm = FailingLLM(error)
    engine.ready["llm"] = True
    bridge, s, task = await start_call(engine)
    s.conv.llm = engine.llm
    await s.handle_text("Hi, is Rahul there?", "en")
    err = events(engine, "turn_error")
    assert len(err) == 1 and err[0]["detail"]
    if isinstance(error, LLMError):
        assert "180 s" in err[0]["detail"] and engine.ready["llm"] is False
    else:
        assert "RuntimeError" in err[0]["detail"]
    assert assistant_lines(s)[-1] == phrase("fallback", "en")
    await s.wait_playback()
    await asyncio.sleep(0)
    states = [e["state"] for e in events(engine, "assistant_status")]
    assert states[-3:] == ["error", "speaking", "listening"]
    # The call carries on: the next turn is answered normally.
    s.conv.llm = ScriptedLLM(lambda m: "May I know who's calling?")
    await s.handle_text("It's Priya.", "en")
    assert assistant_lines(s)[-1] == "May I know who's calling?"
    await bridge.hangup()
    await task


async def test_the_fallback_is_in_the_callers_language(engine):
    engine.llm = FailingLLM(LLMError("down"))
    bridge, s, task = await start_call(engine)
    s.conv.llm = engine.llm
    await s.handle_text("రాహుల్ ఉన్నారా?")  # language from the script
    assert s.record.language == "te"
    assert assistant_lines(s)[-1] == phrase("fallback", "te")
    await bridge.hangup()
    await task


async def test_slow_reply_gets_a_spoken_filler(engine, settings):
    settings.filler_after_s = 0.05
    settings.filler_again_s = 0.1
    llm = SlowLLM(0.4)
    bridge, s, task = await start_call(engine)
    s.conv.llm = llm
    await s.handle_text("Swiggy order, where should I come?", "en")
    said = assistant_lines(s)
    assert said[1:] == [phrase("filler", "en"), phrase("filler_again", "en"), "Sure, come to the green gate."]
    await bridge.hangup()
    await task


async def test_quick_reply_gets_no_filler(engine, settings):
    settings.filler_after_s = 0.3
    bridge, s, task = await start_call(engine)
    s.conv.llm = SlowLLM(0.0)
    await s.handle_text("Swiggy order, where should I come?", "en")
    await asyncio.sleep(0.4)
    assert phrase("filler", "en") not in assistant_lines(s)
    await bridge.hangup()
    await task


async def test_typed_turns_are_answered_one_at_a_time(engine):
    replies = iter(["First answer.", "Second answer."])
    llm = SlowLLM(0.1)
    llm.responder = lambda m: next(replies)
    bridge, s, task = await start_call(engine)
    s.conv.llm = llm
    a = s.submit_text("first", "en")
    b = s.submit_text("second", "en")
    await asyncio.gather(a, b)
    order = [(l.speaker, l.text.strip()) for l in s.record.transcript][1:]
    assert order == [("caller", "first"), ("assistant", "First answer."),
                     ("caller", "second"), ("assistant", "Second answer.")]
    await bridge.hangup()
    await task


async def test_a_line_typed_before_the_greeting_is_answered_after_it(engine):
    greeting_done = asyncio.Event()
    real = engine.tts.synthesize

    async def slow_greeting(text, voice, lang="en"):
        if text.startswith("Hi, this is"):
            await asyncio.sleep(0.2)
            greeting_done.set()
        return await real(text, voice, lang)

    engine.tts.synthesize = slow_greeting
    engine.llm.responder = lambda m: "Okay."
    bridge = QueueBridge("t1", "+919876543210")
    session = engine.open_session(bridge)
    turn = session.submit_text("Hello?", "en")  # before the call even started running
    task = asyncio.create_task(engine.run_session(session))
    await turn
    assert [l.speaker for l in session.record.transcript] == ["assistant", "caller", "assistant"]
    assert session.record.transcript[0].text.startswith("Hi, this is")
    await bridge.hangup()
    await task


async def test_hang_up_cancels_the_turn_and_closes_the_llm_stream(engine):
    llm = SlowLLM(30)
    bridge, s, task = await start_call(engine)
    s.conv.llm = llm
    s.submit_text("Where should I come?", "en")
    await asyncio.wait_for(llm.started.wait(), 2)
    await bridge.hangup()
    await asyncio.wait_for(task, 2)  # doesn't wait 30 s for the model
    assert llm.closed == 1
    assert not any(t for t in s._tasks if not t.done())
    assert assistant_lines(s) == [s.conv.opening_line()]


async def test_status_events_follow_a_spoken_turn(engine):
    engine.stt.next = [Transcription("Hi, is Rahul there?", "en")]
    engine.llm.responder = lambda m: "May I know who's calling?"
    bridge, s, task = await start_call(engine)
    await s.wait_playback()  # the greeting
    await asyncio.sleep(0)
    await s.submit_recording(b"\x01\x00" * 16000, "en")
    await s.wait_playback()
    await asyncio.sleep(0)
    states = [e["state"] for e in events(engine, "assistant_status")]
    assert states == ["speaking", "listening", "transcribing", "thinking", "speaking", "listening"]
    await bridge.hangup()
    await task
    assert events(engine, "assistant_status")[-1]["state"] == "idle"


async def test_a_recording_is_one_utterance_in_the_chosen_language(engine):
    heard = []

    async def transcribe(pcm, language_hint=None):
        heard.append((len(pcm), language_hint))
        return Transcription("నాకు స్విగ్గీ ఆర్డర్ ఉంది, ఎక్కడికి రావాలి?", language_hint or "en")

    engine.stt.transcribe = transcribe
    engine.llm.responder = lambda m: "సరే, మీరు గేట్ దగ్గరకు రండి."
    bridge, s, task = await start_call(engine)
    recording = b"\x01\x00" * 16000 * 9  # 9 s with pauses would be cut up by the turn detector
    await s.submit_recording(recording, "te")
    assert heard == [(len(recording), "te")]
    assert s.record.language == "te" and s.record.category == "delivery"
    caller = [l for l in s.record.transcript if l.speaker == "caller"]
    assert len(caller) == 1 and caller[0].lang == "te"
    await bridge.hangup()
    await task


async def test_a_recording_with_no_words_is_reported(engine):
    bridge, s, task = await start_call(engine)
    await s.submit_recording(b"\x00\x00" * 16000)
    assert "Couldn't make out any words" in events(engine, "turn_error")[0]["detail"]
    await bridge.hangup()
    await task


async def test_the_practice_language_is_used_for_speech_and_english_letters(engine):
    bridge, s, task = await start_call(engine)
    s.language_hint = "te"
    assert s._typed_language("nenu gate daggara unnanu") == "te"
    assert s._typed_language("स्विगी से ऑर्डर है") == "hi"  # the script wins
    s.language_hint = None
    assert s._typed_language("Hello") == "en"
    await bridge.hangup()
    await task


async def test_transcript_lines_have_ids_and_can_get_a_translation_later(engine):
    bridge, s, task = await start_call(engine)
    await s.handle_text("నమస్కారం", "te")
    line = next(l for l in s.record.transcript if l.speaker == "caller")
    assert line.id and line.lang == "te"
    sent = events(engine, "transcript")
    assert any(e["line"]["id"] == line.id and e["line"]["lang"] == "te" for e in sent)
    await s.update_line(line, translation="Hello", translation_lang="en", english="Hello")
    upd = events(engine, "transcript_update")[-1]
    assert upd["line_id"] == line.id and upd["translation"] == "Hello" and upd["translation_lang"] == "en"
    assert line.english == "Hello"
    await bridge.hangup()
    await task


async def test_owner_words_are_said_once_and_codes_are_blocked(engine):
    bridge, s, task = await start_call(engine)
    assert await s.owner_say("I'll be down in two minutes", "en")
    lines = [(l.speaker, l.text) for l in s.record.transcript]
    assert lines[-1] == ("user", "I'll be down in two minutes")
    assert not await s.owner_say("The OTP is 482913")
    assert "482913" not in " ".join(l.text for l in s.record.transcript if l.speaker != "system")
    assert events(engine, "sensitive_request")[-1]["kind"] == "blocked_output"
    await bridge.hangup()
    await task


async def test_hold_reminder_is_in_the_callers_language(engine, settings):
    settings.hold_timeout_s = 5
    settings.hold_reminder_s = 0.1
    replies = iter(["ఒక్క నిమిషం. [HOLD: Can the parcel be left with the guard?]", "సరే.", "Summary."])
    engine.llm.responder = lambda m: next(replies)
    bridge, s, task = await start_call(engine)
    turn = s.submit_text("పార్సెల్ గార్డ్ దగ్గర ఇవ్వొచ్చా?", "te")
    for _ in range(300):
        if phrase("hold_reminder", "te") in assistant_lines(s):
            break
        await asyncio.sleep(0.01)
    assert phrase("hold_reminder", "te") in assistant_lines(s)
    assert await s.answer_hold(None, "Yes, leave it with the guard")
    await turn
    hold_states = [e for e in events(engine, "assistant_status") if e["state"] == "idle"]
    assert hold_states and "waiting for Rahul" in hold_states[0]["detail"]
    await bridge.hangup()
    await task

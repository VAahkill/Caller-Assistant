"""The assistant thinks in English and the call is translated both ways: what the
caller says reaches the model in English, its English reply is said in the caller's
language, the user sees every line in their own language, and what the user types
or says in their language is said to the caller in the caller's."""

import asyncio

from opencall.models import Away, Instruction, KnowledgeNote
from opencall.phrases import fill, phrase
from opencall.providers.mt import TranslationService
from opencall.providers.stt import Transcription
from opencall.telephony.queue_bridge import QueueBridge


class TableMT:
    """Translates from a table (anything else comes back tagged with the target)."""

    name = "table"

    def __init__(self, table=None):
        self.table = dict(table or {})
        self.calls = []

    def supports(self, lang):
        return lang in ("en", "te", "ta", "hi", "kn")

    def warm_up(self, languages):
        pass

    def translate(self, text, src, tgt):
        self.calls.append((text, src, tgt))
        return self.table.get((text, tgt), f"[{tgt}] {text}")


SWIGGY_TE = "నాకు స్విగ్గీ ఆర్డర్ ఉంది, ఎక్కడికి రావాలి?"
SWIGGY_EN = "I have a Swiggy order, where should I come?"
GATE_EN = "Please come to the green gate opposite Apollo Pharmacy."
GATE_TE = "దయచేసి అపోలో ఫార్మసీ ఎదురుగా ఉన్న ఆకుపచ్చ గేటు దగ్గరకు రండి."


def table_mt(engine, extra=None):
    mt = TableMT({(SWIGGY_TE, "en"): SWIGGY_EN, (GATE_EN, "te"): GATE_TE, **(extra or {})})
    engine.mt = TranslationService(mt)
    return mt


async def start_call(engine, call_id="lt1", number="+919876543210", hint=None):
    bridge = QueueBridge(call_id, number)
    s = engine.open_session(bridge)
    s.language_hint = hint  # as the practice call sets it, before the call starts
    task = asyncio.create_task(engine.run_session(s))
    return bridge, s, task


async def settle(s):
    """Lets spawned translations for the user finish."""
    for _ in range(5):
        await asyncio.sleep(0)
        pending = [t for t in s._tasks if not t.done() and "translat" in t.get_name()]
        if pending:
            await asyncio.gather(*pending)


def events(engine, name, call_id="lt1"):
    return [e for e in engine.bus.history if e["event"] == name and e.get("call_id") == call_id]


def lines(s, speaker):
    return [line for line in s.record.transcript if line.speaker == speaker]


async def test_a_telugu_caller_is_answered_by_a_model_that_works_in_english(engine, llm):
    table_mt(engine)
    llm.responder = lambda m: GATE_EN
    bridge, s, task = await start_call(engine)
    await s.handle_text(SWIGGY_TE, "te")
    sent = llm.calls[-1]
    assert sent[-1] == {"role": "user", "content": SWIGGY_EN}
    system = sent[0]["content"]
    assert "the caller speaks Telugu. You see their words translated into English" in system
    assert "write only plain English" in system and "Reply only in Telugu" not in system
    assert "Opposite Apollo Pharmacy" in system  # the delivery was recognised (in both languages)
    caller = lines(s, "caller")[-1]
    assert caller.text == SWIGGY_TE and caller.lang == "te" and caller.english == SWIGGY_EN
    reply = lines(s, "assistant")[-1]
    assert reply.text == GATE_TE and reply.lang == "te" and reply.english == GATE_EN
    assert s.conv.history[-2:] == [{"role": "user", "content": SWIGGY_EN},
                                   {"role": "assistant", "content": GATE_EN}]
    assert "translating" in [e["state"] for e in events(engine, "assistant_status")]
    await bridge.hangup()
    await task


async def test_the_user_reads_every_line_in_their_own_language(engine, llm):
    table_mt(engine)
    llm.responder = lambda m: GATE_EN
    bridge, s, task = await start_call(engine)
    await s.handle_text(SWIGGY_TE, "te")
    await settle(s)
    updates = {u["line_id"]: u for u in events(engine, "transcript_update")}
    caller, reply = lines(s, "caller")[-1], lines(s, "assistant")[-1]
    # The user reads English: the English the model worked with, no extra translation.
    assert updates[caller.id]["translation"] == SWIGGY_EN and updates[caller.id]["translation_lang"] == "en"
    assert updates[reply.id]["translation"] == GATE_EN and caller.translation == SWIGGY_EN
    await bridge.hangup()
    await task


async def test_a_hindi_reading_user_gets_the_lines_in_hindi(engine, llm):
    mt = table_mt(engine)
    engine.store.profile.owner_language = "hi"
    llm.responder = lambda m: GATE_EN
    bridge, s, task = await start_call(engine)
    await s.handle_text(SWIGGY_TE, "te")
    await settle(s)
    caller, reply = lines(s, "caller")[-1], lines(s, "assistant")[-1]
    assert caller.translation == f"[hi] {SWIGGY_EN}" and caller.translation_lang == "hi"
    assert reply.translation == f"[hi] {GATE_EN}"
    assert (SWIGGY_EN, "en", "hi") in mt.calls  # from the English, not from the Telugu
    await bridge.hangup()
    await task


async def test_live_translation_can_be_switched_off(engine, llm):
    table_mt(engine)
    engine.store.profile.translate_live = False
    llm.responder = lambda m: GATE_EN
    bridge, s, task = await start_call(engine)
    await s.handle_text(SWIGGY_TE, "te")
    await settle(s)
    assert not events(engine, "transcript_update")
    assert lines(s, "caller")[-1].english == SWIGGY_EN  # the model still works in English
    await bridge.hangup()
    await task


async def test_a_credential_request_is_caught_in_the_english_too(engine, llm):
    # Kannada has no patterns of its own; its English translation gives it away.
    kn = "ದಯವಿಟ್ಟು ನಿಮ್ಮ ಒಟಿಪಿ ಹೇಳಿ"
    mt = table_mt(engine, {(kn, "en"): "Please tell me your OTP"})
    bridge, s, task = await start_call(engine)
    await s.handle_text(kn, "kn")
    assert llm.calls == []  # the model never saw the turn
    alert = events(engine, "sensitive_request")[-1]
    assert alert["kind"] == "otp" and alert["said"] == kn
    english = fill(phrase("refusal", "en"), "Rahul")
    said = lines(s, "assistant")[-1]
    assert said.text == f"[kn] {english}" and said.english == english  # no Kannada one by hand
    assert (english, "en", "kn") in mt.calls
    assert s.conv.history[-1] == {"role": "assistant", "content": english}
    await bridge.hangup()
    await task


async def test_a_telugu_otp_request_gets_the_hand_written_refusal(engine, llm):
    table_mt(engine, {("మీ ఓటీపీ చెప్పండి", "en"): "Tell me your OTP"})
    bridge, s, task = await start_call(engine)
    await s.handle_text("మీ ఓటీపీ చెప్పండి", "te")
    assert llm.calls == []
    said = lines(s, "assistant")[-1]
    assert said.text == fill(phrase("refusal", "te"), "Rahul")
    assert said.english == fill(phrase("refusal", "en"), "Rahul")
    await bridge.hangup()
    await task


async def test_a_spam_pitch_found_in_the_english_is_declined_in_the_callers_language(engine, llm):
    ta = "உங்களுக்கு ஒரு சலுகை இருக்கிறது"
    table_mt(engine, {(ta, "en"): "Sir, you have a pre-approved personal loan offer"})
    bridge, s, task = await start_call(engine)
    await s.handle_text(ta, "ta")
    await asyncio.wait_for(task, 5)
    assert s.record.category == "spam" and llm.calls == []
    assert lines(s, "assistant")[-1].text == phrase("spam_decline", "ta")


async def test_a_failed_translation_leaves_the_call_in_the_callers_language(engine, llm):
    class Unchanged(TableMT):
        def translate(self, text, src, tgt):
            self.calls.append((text, src, tgt))
            return text  # what the translation service hands back when it fails

    engine.mt = TranslationService(Unchanged())
    llm.responder = lambda m: "సరే."
    bridge, s, task = await start_call(engine)
    await s.handle_text("హలో", "te")
    assert llm.calls[-1][-1]["content"] == "హలో"
    assert "Reply only in Telugu, written in Telugu script." in llm.calls[-1][0]["content"]
    await bridge.hangup()
    await task


async def test_the_users_english_is_said_to_the_caller_in_telugu(engine, llm):
    mt = table_mt(engine, {("I'm coming down.", "te"): "నేను కిందకు వస్తున్నాను.",
                           ("Please wait at the gate.", "te"): "దయచేసి గేటు దగ్గర ఉండండి."})
    spoken = []
    real = engine.tts.synthesize

    async def synthesize(text, voice, lang="en"):
        spoken.append((text, lang))
        return await real(text, voice, lang)

    engine.tts.synthesize = synthesize
    llm.responder = lambda m: GATE_EN
    bridge, s, task = await start_call(engine)
    await s.handle_text(SWIGGY_TE, "te")
    assert await s.owner_say("I'm coming down. Please wait at the gate.")
    # A sentence at a time, so the caller hears the first while the second is translated.
    assert spoken[-2:] == [("నేను కిందకు వస్తున్నాను.", "te"), ("దయచేసి గేటు దగ్గర ఉండండి.", "te")]
    line = lines(s, "user")[-1]
    assert line.text == "నేను కిందకు వస్తున్నాను. దయచేసి గేటు దగ్గర ఉండండి." and line.lang == "te"
    assert line.translation == "I'm coming down. Please wait at the gate." and line.translation_lang == "en"
    assert s.conv.history[-1] == {"role": "assistant", "content": "I'm coming down. Please wait at the gate."}
    assert ("I'm coming down.", "en", "te") in mt.calls
    await bridge.hangup()
    await task


async def test_the_users_telugu_reaches_a_hindi_caller_through_english(engine, llm):
    mt = table_mt(engine, {("నేను వస్తున్నాను.", "en"): "I am coming.", ("I am coming.", "hi"): "मैं आ रहा हूँ।"})
    engine.store.profile.owner_language = "te"
    bridge, s, task = await start_call(engine)
    await s.handle_text("नमस्ते, पार्सल आया है", "hi")
    assert await s.owner_say("నేను వస్తున్నాను.")
    line = lines(s, "user")[-1]
    assert line.text == "मैं आ रहा हूँ।" and line.translation == "నేను వస్తున్నాను." and line.translation_lang == "te"
    assert line.english == "I am coming."
    assert [c for c in mt.calls if c[0] in ("నేను వస్తున్నాను.", "I am coming.")] == [
        ("నేను వస్తున్నాను.", "te", "en"), ("I am coming.", "en", "hi")]
    await bridge.hangup()
    await task


async def test_a_code_that_appears_in_the_translation_is_not_said(engine, llm):
    table_mt(engine, {("Tell him the usual one.", "te"): "అతనికి 482913 చెప్పండి."})
    bridge, s, task = await start_call(engine)
    await s.handle_text("హలో", "te")
    assert not await s.owner_say("Tell him the usual one.")
    assert not any("482913" in line.text for line in s.record.transcript)
    assert events(engine, "sensitive_request")[-1]["kind"] == "blocked_output"
    await bridge.hangup()
    await task


async def test_the_users_voice_is_heard_in_their_language(engine, llm):
    table_mt(engine, {("నేను వస్తున్నాను", "en"): "I am coming", ("I am coming", "hi"): "मैं आ रहा हूँ"})
    engine.store.profile.owner_language = "te"
    heard = []

    async def transcribe(pcm, language_hint=None):
        heard.append(language_hint)
        return Transcription("నేను వస్తున్నాను", language_hint or "en")

    engine.stt.transcribe = transcribe
    bridge, s, task = await start_call(engine)
    await s.handle_text("नमस्ते", "hi")
    assert await s.owner_say_audio(b"\x01\x00" * 16000) == "నేను వస్తున్నాను"
    assert heard == ["te"]
    assert lines(s, "user")[-1].text == "मैं आ रहा हूँ"
    await bridge.hangup()
    await task


async def test_the_users_voice_goes_to_the_model_kept_for_their_replies(engine, llm):
    """A speech engine with a quicker model for the user's replies gets them there."""
    table_mt(engine, {("I am coming", "hi"): "मैं आ रहा हूँ"})
    used = []

    async def for_callers(pcm, language_hint=None):
        used.append("callers")
        return Transcription("I am coming", "en")

    async def for_the_user(pcm, language_hint=None):
        used.append(("user", language_hint))
        return Transcription("I am coming", "en")

    engine.stt.transcribe, engine.stt.transcribe_owner = for_callers, for_the_user
    bridge, s, task = await start_call(engine)
    await s.handle_text("नमस्ते", "hi")
    assert await s.owner_say_audio(b"\x01\x00" * 16000, "en") == "I am coming"
    assert used == [("user", "en")] and lines(s, "user")[-1].text == "मैं आ रहा हूँ"
    await bridge.hangup()
    await task


async def test_a_hold_answer_in_the_users_language_reaches_the_model_in_english(engine, llm, settings):
    settings.hold_timeout_s = 5
    table_mt(engine, {("గార్డ్ దగ్గర ఇవ్వమను", "en"): "Ask him to leave it with the guard",
                      ("Can it be left with the guard?", "te"): "గార్డ్ దగ్గర ఇవ్వొచ్చా?"})
    engine.store.profile.owner_language = "te"
    replies = iter(["One moment. [HOLD: Can it be left with the guard?]", "Rahul says yes, leave it with the guard."])
    llm.responder = lambda m: next(replies)
    bridge, s, task = await start_call(engine)
    turn = s.submit_text("Can I leave the parcel with the guard?", "en")
    while not s.record.holds:
        await asyncio.sleep(0.005)
    await settle(s)
    question = next(line for line in s.record.transcript if line.kind == "hold_question")
    assert question.translation == "గార్డ్ దగ్గర ఇవ్వొచ్చా?" and question.translation_lang == "te"
    assert await s.answer_hold(None, "గార్డ్ దగ్గర ఇవ్వమను")
    await turn
    note = llm.calls[-1][-1]["content"]
    assert note.startswith("[Private note") and "Ask him to leave it with the guard" in note
    answer = lines(s, "user")[-1]
    assert answer.text == "గార్డ్ దగ్గర ఇవ్వమను" and answer.lang == "te" and answer.english.startswith("Ask him")
    await bridge.hangup()
    await task


async def test_a_practice_call_in_telugu_is_greeted_in_telugu(engine):
    table_mt(engine)
    bridge, s, task = await start_call(engine, hint="te")
    while not lines(s, "assistant"):
        await asyncio.sleep(0.005)
    greeting = lines(s, "assistant")[0]
    assert greeting.lang == "te" and greeting.text.startswith("నమస్కారం, నేను Ava, Rahul గారి")
    assert greeting.english == s.conv.opening_line()
    await bridge.hangup()
    await task


async def test_the_away_status_is_in_the_greeting_in_every_language(engine):
    mt = table_mt(engine, {("Rahul is in a meeting until 3 PM.", "te"): "రాహుల్ 3 గంటల వరకు మీటింగ్‌లో ఉన్నారు."})
    engine.store.profile.away = Away(preset="meeting", message="In a meeting until 3 PM")
    assert engine.greeting("en") == ("Hi, this is Ava, Rahul's assistant. Rahul is in a meeting until 3 PM."
                                     " How can I help?")
    te = engine.greeting("te")
    assert te.startswith(fill(phrase("greeting_intro", "te"), "Rahul", "Ava"))
    assert "రాహుల్ 3 గంటల వరకు మీటింగ్‌లో ఉన్నారు." in te and te.endswith(phrase("greeting_help", "te"))
    assert [c for c in mt.calls if c[2] == "te"] == [("Rahul is in a meeting until 3 PM.", "en", "te")]
    engine.store.profile.away = Away(preset="meeting", message="In a meeting", until=1.0)  # long over
    assert "meeting" not in engine.greeting("en")


async def test_the_users_telugu_instructions_reach_the_model_in_english(engine, llm):
    rule = "కొరియర్ వాళ్ళకి పార్సెల్ గార్డ్ దగ్గర ఇవ్వమని చెప్పు"
    note = "నేను శుక్రవారం వరకు గోవాలో ఉన్నాను"
    table_mt(engine, {(rule, "en"): "Tell couriers to give the parcel to the guard",
                      (note, "en"): "I am in Goa until Friday"})
    p = engine.store.profile
    p.instructions = [Instruction(text=rule)]
    p.knowledge = [KnowledgeNote(text=note, share_with="anyone")]
    assert engine.translate_owner_texts() == 2
    assert engine.translate_owner_texts() == 0  # once per text
    llm.responder = lambda m: "Okay."
    bridge, s, task = await start_call(engine)
    await s.handle_text("Hello?", "en")
    system = llm.calls[-1][0]["content"]
    assert "- Tell couriers to give the parcel to the guard" in system and "- I am in Goa until Friday" in system
    assert rule not in system
    await bridge.hangup()
    await task


async def test_new_text_in_another_language_is_translated_before_the_prompt_is_warmed(engine):
    table_mt(engine, {("గేటు దగ్గర వదిలేయండి", "en"): "Leave it at the gate"})

    class Warm:
        def __init__(self):
            self.warmed = []

        async def stream(self, messages):
            yield "ok"

        async def warm_up(self, messages):
            self.warmed.append(messages)

    engine.llm = Warm()
    engine.store.profile.instructions.append(Instruction(text="గేటు దగ్గర వదిలేయండి", applies_to="delivery"))
    engine.store.profile.knowledge.append(KnowledgeNote(text="గేటు దగ్గర వదిలేయండి", share_with="anyone"))
    engine.store.save_profile()
    while engine._background:
        await asyncio.gather(*engine._background)
    assert engine.owner_english("గేటు దగ్గర వదిలేయండి") == "Leave it at the gate"
    assert "- Leave it at the gate" in engine.llm.warmed[-1][0]["content"]


async def test_the_summary_is_in_the_users_language_with_action_items(engine, llm):
    table_mt(engine, {("Priya called about dinner.", "te"): "ప్రియ డిన్నర్ గురించి కాల్ చేశారు.",
                      ("Call Priya back", "te"): "ప్రియకు తిరిగి కాల్ చేయండి"})
    engine.store.profile.owner_language = "te"
    replies = iter(["Okay, I'll tell him.", "Sure.",
                    "Summary: Priya called about dinner.\nUrgent: yes\nActions:\n- Call Priya back"])
    llm.responder = lambda m: next(replies)
    bridge, s, task = await start_call(engine)
    await s.handle_text("Hi, this is Priya.", "en")
    await s.handle_text("Ask him to call me about dinner.", "en")
    await bridge.hangup()
    await task
    rec = engine.store.calls.get("lt1")
    assert rec.summary == "ప్రియ డిన్నర్ గురించి కాల్ చేశారు." and rec.action_items == ["ప్రియకు తిరిగి కాల్ చేయండి"]
    assert rec.urgent and events(engine, "urgent_call")[-1]["reason"] == "summary"
    assert "Summarise this phone call for Rahul" in llm.calls[-1][0]["content"]


class PausingLLM:
    """Says one sentence, then takes its time over the next (like a slow CPU model)."""

    def __init__(self):
        self.calls, self.closed = [], 0
        self.first_sentence_out = asyncio.Event()

    async def stream(self, messages):
        self.calls.append(messages)
        try:
            yield "Please come to the green gate. "
            self.first_sentence_out.set()
            await asyncio.sleep(5)
            yield "Then take the lift to the fourth floor."
        finally:
            self.closed += 1


async def test_the_user_speaking_stops_the_assistants_reply(engine):
    engine.store.profile.voice = "kokoro:af_heart"
    llm = PausingLLM()
    bridge, s, task = await start_call(engine)
    s.conv.llm = llm
    turn = s.submit_text("Where should I come?", "en")
    await asyncio.wait_for(llm.first_sentence_out.wait(), 5)
    await asyncio.sleep(0.05)
    assert await s.owner_say("I'm coming down myself.", "en")
    await asyncio.sleep(0.05)
    assert turn.cancelled() and llm.closed == 1  # the model was stopped, not left writing
    assert not events(engine, "turn_error")  # stopping it isn't a failure
    said = [(line.speaker, line.text) for line in s.record.transcript if line.speaker in ("assistant", "user")]
    assert said[-2:] == [("assistant", "Please come to the green gate."), ("user", "I'm coming down myself.")]
    assert {"role": "assistant", "content": "I'm coming down myself."} in s.conv.history
    # The call goes on: the next caller line is answered.
    s.conv.llm = engine.llm
    engine.llm.responder = lambda m: "Okay."
    await s.handle_text("Okay, I'm waiting.", "en")
    assert lines(s, "assistant")[-1].text == "Okay."
    await bridge.hangup()
    await task


async def test_the_users_words_are_not_cut_off_by_their_next_ones(engine):
    bridge, s, task = await start_call(engine)
    await s.wait_playback()
    cleared = []
    original = bridge.clear_audio

    async def clear_audio():
        cleared.append(True)
        await original()

    bridge.clear_audio = clear_audio
    assert await s.owner_say("I'm coming down.", "en")
    assert await s.owner_say("Two minutes.", "en")
    assert cleared == []
    assert [line.text for line in lines(s, "user")] == ["I'm coming down.", "Two minutes."]
    await bridge.hangup()
    await task


async def test_a_hold_is_left_alone_when_the_user_speaks(engine, settings):
    settings.hold_timeout_s = 5
    replies = iter(["One moment. [HOLD: Can the parcel be left with the guard?]", "Okay, leave it with the guard."])
    engine.llm.responder = lambda m: next(replies, "Okay.")
    bridge, s, task = await start_call(engine)
    turn = s.submit_text("Can I leave it with the guard?", "en")
    for _ in range(300):
        if s.record.holds:
            break
        await asyncio.sleep(0.01)
    assert await s.owner_say("Hold on, please.", "en")
    assert not turn.done()  # still waiting for the answer
    assert await s.answer_hold(None, "Yes")
    await turn
    assert lines(s, "assistant")[-1].text == "Okay, leave it with the guard."
    await bridge.hangup()
    await task

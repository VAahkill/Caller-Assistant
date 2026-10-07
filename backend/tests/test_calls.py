"""End-to-end call flows with a scripted LLM, silent TTS and a queue bridge."""

import asyncio

from opencall.models import CallStatus, TaskKind, TaskStatus
from opencall.telephony.queue_bridge import QueueBridge


async def start_call(engine, number="+919876543210", direction="inbound", call_id="call1"):
    bridge = QueueBridge(call_id, number, direction)
    task = asyncio.create_task(engine.handle_call(bridge))
    for _ in range(100):
        if call_id in engine.sessions:
            break
        await asyncio.sleep(0.01)
    return bridge, engine.sessions[call_id], task


def events(engine, name):
    return [e for e in engine.bus.history if e["event"] == name]


async def test_delivery_partner_gets_directions_in_their_language(engine, llm):
    llm.responder = lambda m: "Aap Apollo Pharmacy ke saamne aaiye, hari gate dikhega. [SEND_LOCATION]"
    bridge, session, task = await start_call(engine)
    await session.handle_text("Bhaiya Swiggy order hai, location kahan hai?", "hi")
    system_text = " ".join(m["content"] for m in llm.calls[-1] if m["role"] == "system")
    assert "Opposite Apollo Pharmacy" in system_text  # address only shared once it's a delivery
    assert session.record.category == "delivery"
    assert session.record.language == "hi"
    await bridge.hangup()
    await task
    assert events(engine, "call_ended")


async def test_address_not_given_to_unknown_callers(engine, llm):
    llm.responder = lambda m: "May I know who's calling?"
    bridge, session, task = await start_call(engine)
    await session.handle_text("Hi, is Rahul there?")
    assert all("Apollo" not in m["content"] for m in llm.calls[-1])
    await bridge.hangup()
    await task


async def test_otp_request_is_refused_without_the_llm(engine, llm):
    bridge, session, task = await start_call(engine)
    await session.handle_text("Please tell me the OTP to complete the delivery")
    assert llm.calls == []  # the model never saw the turn
    said = [l.text for l in session.record.transcript if l.speaker == "assistant"]
    assert "can't share any verification codes" in said[-1]
    assert events(engine, "sensitive_request")[0]["kind"] == "otp"
    await bridge.hangup()
    await task


async def test_model_cannot_leak_a_code(engine, llm):
    llm.responder = lambda m: "Sure. The code is 482913. Anything else?"
    bridge, session, task = await start_call(engine)
    await session.handle_text("hello what's up")
    said = " ".join(l.text for l in session.record.transcript if l.speaker == "assistant")
    assert "482913" not in said and "Anything else?" in said
    assert any(e["kind"] == "blocked_output" for e in events(engine, "sensitive_request"))
    await bridge.hangup()
    await task


async def test_spam_is_declined_and_hung_up(engine, llm):
    bridge, session, task = await start_call(engine)
    await session.handle_text("Sir you have a pre-approved personal loan of five lakhs")
    await asyncio.wait_for(task, 5)
    assert bridge.hung_up.is_set()
    assert session.record.category == "spam"
    assert llm.calls == []
    assert not engine.store.messages.list()  # spam doesn't create a message


async def test_hold_then_user_answers(engine, llm):
    replies = iter([
        "Let me quickly check with Rahul, can you hold? [HOLD: Is Rahul free for dinner at 8?]",
        "Thanks for holding! Rahul says 9 works better. Does that suit you?",
    ])
    llm.responder = lambda m: next(replies)
    bridge, session, task = await start_call(engine)
    turn = asyncio.create_task(session.handle_text("Is Rahul free for dinner at 8 tonight?"))
    for _ in range(100):
        if session.record.status == CallStatus.on_hold:
            break
        await asyncio.sleep(0.01)
    q = events(engine, "hold_question")[0]
    assert q["question"] == "Is Rahul free for dinner at 8?"
    assert await session.answer_hold(q["hold_id"], "Can't do 8, 9 PM works")
    await turn
    assert "Rahul replied" in llm.calls[-1][-1]["content"]
    assert session.record.holds[0].answer == "Can't do 8, 9 PM works"
    assert any(l.text.startswith("Thanks for holding") for l in session.record.transcript)
    await bridge.hangup()
    await task


async def test_hold_timeout_takes_a_message(engine, llm):
    replies = iter([
        "One moment, let me check with Rahul. [HOLD: Can Rahul send the documents today?]",
        "Sorry for the wait, Rahul isn't free. Want to leave a message?",
        "Got it, I'll tell him. [MESSAGE: Priya from the bank: please send the documents today] Bye! [END_CALL]",
    ])
    llm.responder = lambda m: next(replies)
    bridge, session, task = await start_call(engine)
    await session.handle_text("Can Rahul send the documents today?")
    assert "isn't available" in llm.calls[-1][-1]["content"]
    await session.handle_text("Yes, tell him Priya called about the documents.")
    await asyncio.wait_for(task, 5)
    msgs = engine.store.messages.list()
    assert msgs and "Priya" in msgs[0].text
    assert events(engine, "message_taken")


async def test_outbound_booking_with_alternative_time(engine, llm):
    replies = iter([
        "One second, let me check that with Rahul. [HOLD: 8 PM is full, 9 PM is free. Book 9?]",
        "Great, please book it for 9 under Rahul. Thank you! [OUTCOME: booked | Table for 3 at 9 PM under Rahul] [END_CALL]",
    ])
    llm.responder = lambda m: next(replies)

    class FakeDialer:
        name = "fake"

        def __init__(self):
            self.bridges = []

        async def dial(self, number, call_id):
            bridge = QueueBridge(call_id, number, "outbound")
            self.bridges.append(bridge)
            asyncio.create_task(engine.handle_call(bridge))

    engine.dialer = FakeDialer()
    t = await engine.tasks.create(TaskKind.book, "040 2345 6789", "Book a table for 3 at 8 PM tonight", "Paradise")
    await asyncio.sleep(0.05)
    session = engine.sessions[t.call_id]
    assert "Book a table for 3" in session.conv.system_prompt
    turn = asyncio.create_task(session.handle_text("Hello, Paradise restaurant."))
    for _ in range(100):
        if engine.store.tasks.get(t.id).status == TaskStatus.waiting_user:
            break
        await asyncio.sleep(0.01)
    decision = events(engine, "task_needs_decision")[0]
    await session.answer_hold(decision["hold_id"], "Yes, 9 is fine")
    await turn
    done = engine.store.tasks.get(t.id)
    assert done.status == TaskStatus.done and done.outcome == "booked"
    assert "9 PM" in done.result
    await asyncio.sleep(1)
    assert engine.dialer.bridges[0].hung_up.is_set()


async def test_reply_to_message_calls_back(engine):
    from opencall.models import CallerMessage

    dialed = []

    class FakeDialer:
        name = "fake"

        async def dial(self, number, call_id):
            dialed.append(number)

    engine.dialer = FakeDialer()
    msg = engine.store.messages.put(CallerMessage(call_id="x", number="+919811111111", text="Call me about rent"))
    await engine.tasks.reply_to_message(msg, "I'll transfer it tomorrow morning", call_back=True)
    task = engine.store.tasks.get(msg.callback_task_id)
    assert task.kind == TaskKind.callback and dialed == ["+919811111111"]

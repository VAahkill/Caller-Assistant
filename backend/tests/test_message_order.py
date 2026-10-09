"""The message list sent to the LLM: one system message, then alternating turns that
always end with a user turn, on every path. A list that ends with a system message
makes Ollama's llama3.1 template leave out the assistant header, and the model then
says "assistant" out loud and drifts into another language."""

import asyncio

import pytest

from opencall.agent import Conversation, Say, TagStreamParser
from opencall.models import Location, Profile, Task, TaskKind
from opencall.providers.llm import ScriptedLLM
from opencall.telephony.queue_bridge import QueueBridge


def assert_well_formed(messages):
    roles = [m["role"] for m in messages]
    assert roles[0] == "system" and "system" not in roles[1:], roles
    turns = roles[1:]
    assert turns and turns[0] == "user" and turns[-1] == "user", roles
    assert all(a != b for a, b in zip(turns, turns[1:])), roles  # strictly alternating
    assert all(m["content"].strip() for m in messages), messages


class CheckedLLM(ScriptedLLM):
    """A scripted LLM that fails the test if any request is badly ordered."""

    async def stream(self, messages):
        if not messages[0]["content"].startswith("Summarise"):
            assert_well_formed(messages)
        async for chunk in super().stream(messages):
            yield chunk


def profile() -> Profile:
    return Profile(
        user_name="Rahul",
        location=Location(address="Flat 402, Road No. 3, Banjara Hills", landmarks="Opposite Apollo Pharmacy"),
    )


def inbound(llm, contact="") -> Conversation:
    return Conversation.inbound(profile(), llm, "+919876543210", contact, ["en", "hi", "te", "ta"])


async def drain(actions):
    return [a async for a in actions]


async def test_plain_turn():
    llm = CheckedLLM(lambda m: "May I know who's calling?")
    conv = inbound(llm)
    await drain(conv.respond("Hi, is Rahul there?", "en"))
    sent = llm.calls[-1]
    # The turns start with the greeting the caller heard, as the assistant's own turn.
    assert [m["role"] for m in sent] == ["system", "user", "assistant", "user"]
    assert sent[1]["content"].startswith("[Private note") and sent[2]["content"] == conv.opening_line()
    assert sent[3]["content"] == "Hi, is Rahul there?"
    assert "LANGUAGE: always write plain English" in sent[0]["content"]


async def test_delivery_context_lives_in_the_system_message():
    llm = CheckedLLM(lambda m: "Come to the green gate.")
    conv = inbound(llm)
    await drain(conv.respond("నాకు స్విగ్గీ ఆర్డర్ ఉంది, ఎక్కడికి రావాలి?", "te"))
    sent = llm.calls[-1]
    assert [m["role"] for m in sent] == ["system", "user", "assistant", "user"]
    assert "Opposite Apollo Pharmacy" in sent[0]["content"]
    assert "the caller is speaking Telugu. Reply only in Telugu, written in Telugu script." in sent[0]["content"]
    # Still there on the next turn, and still before the turns.
    await drain(conv.respond("నేను అపోలో ఫార్మసీ దగ్గర ఉన్నాను", "te"))
    assert [m["role"] for m in llm.calls[-1]] == ["system", "user", "assistant", "user", "assistant", "user"]
    assert "DELIVERY:" in llm.calls[-1][0]["content"]


async def test_delivery_found_by_the_model_also_goes_to_the_system_message():
    replies = iter(["[CATEGORY: delivery] Sure, where are you now?", "Take the left after the temple."])
    llm = CheckedLLM(lambda m: next(replies))
    conv = inbound(llm)
    await drain(conv.respond("Hello, I'm outside, which way?", "en"))
    assert "DELIVERY:" not in llm.calls[0][0]["content"]
    await drain(conv.respond("Near the temple", "en"))
    assert "DELIVERY:" in llm.calls[1][0]["content"]


@pytest.mark.parametrize("answer", ["Tell her 9 PM works", None])
async def test_hold_answer_and_timeout_are_private_user_notes(answer):
    replies = iter(["Let me check with Rahul. [HOLD: Is Rahul free at 8?]", "Thanks for holding!"])
    llm = CheckedLLM(lambda m: next(replies))
    conv = inbound(llm)
    await drain(conv.respond("Is Rahul free for dinner at 8?", "en"))
    await drain(conv.resume_after_hold(answer))
    last = llm.calls[-1][-1]
    assert last["role"] == "user" and last["content"].startswith("[Private note from Rahul's side")
    assert ("Tell her 9 PM works" in last["content"]) if answer else ("isn't available" in last["content"])
    assert "LANGUAGE: always write plain English" in llm.calls[-1][0]["content"]


async def test_outbound_kickoff_is_a_private_user_note():
    llm = CheckedLLM(lambda m: "Hello, I'm calling for Rahul about a table for 3.")
    task = Task(kind=TaskKind.book, number="+914023456789", goal="Book a table for 3 at 8 PM")
    conv = Conversation.for_task(profile(), llm, task, ["en"])
    await drain(conv.start_outbound())
    sent = llm.calls[-1]
    assert [m["role"] for m in sent] == ["system", "user"]
    assert sent[1]["content"].startswith("[Private note") and "Greet them" in sent[1]["content"]
    assert "LANGUAGE: start in English" in sent[0]["content"]


async def test_turns_stay_alternating_after_interruptions():
    llm = CheckedLLM(lambda m: "Okay.")
    conv = inbound(llm)
    # A turn cut off before the model said anything leaves two user turns in a row,
    # and the user's own words leave two assistant turns in a row.
    conv.history += [{"role": "user", "content": "Hello?"}, {"role": "assistant", "content": "Hi!"},
                     {"role": "assistant", "content": "Rahul says he'll call back."}]
    await drain(conv.respond("Hello? Are you there?", "en"))
    await drain(conv.respond("Okay, thanks", "en"))
    sent = llm.calls[-1]
    assert [m["role"] for m in sent] == ["system", "user", "assistant", "user", "assistant", "user", "assistant",
                                         "user"]
    assert sent[4]["content"] == "Hi!\nRahul says he'll call back."


async def test_reply_cut_short_is_kept_in_history():
    llm = CheckedLLM(lambda m: "Sure! The gate is green. Come in.")
    conv = inbound(llm)
    actions = conv.respond("Where?", "en")
    first = await actions.__anext__()
    assert first == Say("Sure!")
    await actions.aclose()  # the caller hung up mid-reply
    assert conv.history[-1] == {"role": "assistant", "content": "Sure!"}


async def test_private_notes_do_not_unlock_numbers_on_inbound_calls():
    llm = CheckedLLM(lambda m: "Okay.")
    conv = inbound(llm)
    conv.history.append({"role": "user", "content": "My parcel number is 778899"})
    conv.history.append({"role": "user", "content": "[Private note from Rahul's side; the caller did not say this] Rahul replied: \"4821\""})
    allowed = conv.allowed_numbers()
    assert "778899" in allowed and "4821" not in allowed


def _parse(chunks):
    p = TagStreamParser()
    out = []
    for c in chunks:
        out += p.feed(c)
    return out + p.close()


@pytest.mark.parametrize(
    "reply",
    [
        "assistant\n\nSure, come to the green gate.",
        "  Assistant:  Sure, come to the green gate.",
        "<|start_header_id|>assistant<|end_header_id|>\n\nSure, come to the green gate.",
    ],
)
def test_a_leaked_role_header_is_never_spoken(reply):
    for size in (1, 3, 7, len(reply)):
        out = _parse([reply[i : i + size] for i in range(0, len(reply), size)])
        assert out == [Say("Sure, come to the green gate.")], (size, out)


def test_the_word_assistant_in_a_real_sentence_is_kept():
    assert _parse(["Assistant here", ", how can I help?"]) == [Say("Assistant here, how can I help?")]
    assert _parse(["I'm Rahul's assistant."]) == [Say("I'm Rahul's assistant.")]
    assert _parse(["assistant"]) == []


async def test_every_request_in_a_full_call_is_well_formed(engine):
    """Delivery, hold with an answer, typed interjection and a second turn through the
    real call session."""
    replies = iter([
        "Sure, come past Apollo Pharmacy.",
        "Let me check with Rahul. [HOLD: Can you leave it with the guard?]",
        "Thanks for holding! Rahul says yes, leave it with the guard.",
        "Okay, bye! [END_CALL]",
    ])
    llm = CheckedLLM(lambda m: next(replies))
    engine.llm = llm
    bridge = QueueBridge("roles", "+919876543210")
    call = asyncio.create_task(engine.handle_call(bridge))
    while "roles" not in engine.sessions:
        await asyncio.sleep(0.01)
    s = engine.sessions["roles"]
    await s.handle_text("Swiggy delivery, where should I come?", "en")
    turn = asyncio.create_task(s.handle_text("Can I leave it with the guard?", "en"))
    while not s.record.holds:
        await asyncio.sleep(0.01)
    assert await s.answer_hold(s.record.holds[0].id, "Yes, leave it with the guard")
    await turn
    await s.say_now("Thank you!")
    await s.handle_text("Okay, done", "en")
    await asyncio.wait_for(call, 5)
    assert len([c for c in llm.calls if not c[0]["content"].startswith("Summarise")]) == 4

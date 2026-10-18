"""The practice call socket (/ws/simulate v2): every message is acknowledged or
answered with an error, never dropped; the call's own events come back on the same
socket; recordings are one utterance; the user's own actions work there too. With a
goal it is a practice "Call for me", run like a real outbound call."""

import asyncio
import base64
import json
import time

import numpy as np
from fastapi.testclient import TestClient

from opencall.api import create_app
from opencall.audio import to_wav
from opencall.models import TaskKind
from opencall.providers.stt import Transcription
from opencall.telephony.queue_bridge import QueueBridge

SWIGGY = "Hi, I have a Swiggy order for you. Where should I come?"


def client(settings, engine):
    return TestClient(create_app(settings, engine, start_gateways=False))


def read_until(ws, stop):
    """JSON events (and a count of audio clips) until ``stop(event)`` is true."""
    got, clips = [], 0
    while True:
        msg = ws.receive()
        assert msg["type"] != "websocket.close", got
        if msg.get("bytes") is not None:
            clips += 1
            continue
        ev = json.loads(msg["text"])
        got.append(ev)
        if stop(ev):
            return got, clips


def said(ev):
    return ev["event"] == "transcript" and ev["line"]["speaker"] == "assistant"


def tone(seconds, rate=16000, amp=6000):
    t = np.arange(int(seconds * rate)) / rate
    return (np.sin(2 * np.pi * 220 * t) * amp).astype(np.int16).tobytes()


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def test_typed_swiggy_line_gets_ack_transcript_status_and_audio(settings, engine, llm):
    llm.responder = lambda m: "Sure! Come to the green gate opposite Apollo Pharmacy."
    with client(settings, engine).websocket_connect("/ws/simulate?token=test-token&number=9876543210&wav=1") as ws:
        started = ws.receive_json()
        assert started["event"] == "started"
        ws.send_json({"text": SWIGGY})
        events, clips = read_until(ws, lambda e: said(e) and "green gate" in e["line"]["text"])
        while ws.receive().get("bytes") is None:  # the reply's speech follows its transcript line
            pass
        clips += 1
        ws.send_json({"hangup": True})
    kinds = [e["event"] for e in events]
    assert {"event": "ack", "kind": "text"} in events
    assert "call_started" in kinds and "call_category" in kinds
    caller = [e["line"] for e in events if e["event"] == "transcript" and e["line"]["speaker"] == "caller"]
    assert caller[0]["text"] == SWIGGY and caller[0]["lang"] == "en" and caller[0]["id"]
    states = [e["state"] for e in events if e["event"] == "assistant_status"]
    assert "thinking" in states and "speaking" in states
    assert all(e.get("call_id") == started["call_id"] for e in events if e["event"] != "ack")
    assert clips >= 1
    sent = llm.calls[0]
    assert sent[-1]["role"] == "user" and "Opposite Apollo Pharmacy" in sent[0]["content"]


def test_bad_messages_get_an_error_and_the_call_goes_on(settings, engine, llm):
    llm.responder = lambda m: "May I know who's calling?"
    with client(settings, engine).websocket_connect("/ws/simulate?token=test-token&number=9876543210") as ws:
        ws.receive_json()
        ws.send_text("hello?")
        assert read_until(ws, lambda e: e["event"] == "error")[0][-1]["detail"].startswith("Messages must be JSON")
        ws.send_json({"text": "   "})
        assert read_until(ws, lambda e: e["event"] == "error")[0][-1]["detail"] == "The message was empty."
        ws.send_json({"something": 1})
        assert "Send {" in read_until(ws, lambda e: e["event"] == "error")[0][-1]["detail"]
        ws.send_json({"audio_b64": "not base64!"})
        assert "base64" in read_until(ws, lambda e: e["event"] == "error")[0][-1]["detail"]
        ws.send_json({"audio_b64": b64(to_wav(b"\x00\x00" * 16000))})
        assert "couldn't hear any speech" in read_until(ws, lambda e: e["event"] == "error")[0][-1]["detail"]
        ws.send_json({"text": "Hi, is Rahul there?"})
        events, _ = read_until(ws, lambda e: said(e) and e["line"]["text"] == "May I know who's calling?")
        assert {"event": "ack", "kind": "text"} in events
        ws.send_json({"hangup": True})


def test_a_recording_is_one_utterance_in_the_chosen_language(settings, engine, llm):
    heard = []

    async def transcribe(pcm, language_hint=None):
        heard.append((len(pcm) / 32000, language_hint))
        return Transcription("నాకు స్విగ్గీ ఆర్డర్ ఉంది, ఎక్కడికి రావాలి?", language_hint or "en")

    engine.stt.transcribe = transcribe
    llm.responder = lambda m: "సరే, మీరు అపోలో ఫార్మసీ దగ్గరకు రండి."
    # 1 s of silence, speech with a 1 s pause in the middle, 1 s of silence: the live
    # turn detector would cut this in two.
    silence = b"\x00\x00" * 16000
    recording = to_wav(silence + tone(2) + silence + tone(2) + silence)
    with client(settings, engine).websocket_connect(
            "/ws/simulate?token=test-token&number=9876543210&wav=1&lang=te") as ws:
        ws.receive_json()
        ws.send_json({"audio_b64": b64(recording)})
        events, _ = read_until(ws, lambda e: said(e) and "అపోలో" in e["line"]["text"])
        ws.send_json({"hangup": True})
    ack = next(e for e in events if e["event"] == "ack")
    assert ack["kind"] == "audio" and 5.0 <= ack["seconds"] <= 5.6  # the silence around it is trimmed
    assert len(heard) == 1 and heard[0][1] == "te"
    caller = [e["line"] for e in events if e["event"] == "transcript" and e["line"]["speaker"] == "caller"]
    assert len(caller) == 1 and caller[0]["lang"] == "te"
    assert any(e["event"] == "call_category" and e["category"] == "delivery" for e in events)
    assert "transcribing" in [e["state"] for e in events if e["event"] == "assistant_status"]


def test_the_users_own_words_can_be_said_in_a_practice_call(settings, engine, llm):
    engine.stt.next = [Transcription("I'm coming down now", "en")]
    with client(settings, engine).websocket_connect("/ws/simulate?token=test-token&number=9876543210") as ws:
        ws.receive_json()
        ws.send_json({"action": "say", "text": "Please wait at the gate", "lang": "en"})
        events, _ = read_until(ws, lambda e: e["event"] == "transcript" and e["line"]["speaker"] == "user")
        assert events[-1]["line"]["text"] == "Please wait at the gate"
        assert {"event": "ack", "kind": "say"} in events
        ws.send_json({"action": "say_audio", "audio_b64": b64(to_wav(tone(1)))})
        events, _ = read_until(ws, lambda e: e["event"] == "transcript" and e["line"]["speaker"] == "user")
        assert events[-1]["line"]["text"] == "I'm coming down now"
        ws.send_json({"action": "say", "text": "The OTP is 482913"})
        events, _ = read_until(ws, lambda e: e["event"] == "error")
        assert "code-like number" in events[-1]["detail"]
        ws.send_json({"hangup": True})


def test_the_events_socket_takes_say_actions_and_reports_unknown_calls(settings, engine, llm):
    c = client(settings, engine)
    with c.websocket_connect("/ws/simulate?token=test-token&number=9876543210") as sim:
        call_id = sim.receive_json()["call_id"]
        with c.websocket_connect("/ws/events?token=test-token") as ev:
            assert ev.receive_json()["event"] == "call_snapshot"
            ev.send_json({"action": "say", "call_id": "nope", "text": "hi"})
            while (m := ev.receive_json())["event"] != "error":
                pass
            assert m["detail"] == "That call is no longer live."
            ev.send_text("{oops")
            while (m := ev.receive_json())["event"] != "error":
                pass
            assert m["detail"] == "Messages must be JSON."
            ev.send_json({"action": "say", "call_id": call_id, "text": "Leave it with the guard"})
            while not ((m := ev.receive_json())["event"] == "transcript" and m["line"]["speaker"] == "user"):
                pass
            assert m["line"]["text"] == "Leave it with the guard"
        r = c.post(f"/calls/{call_id}/say", headers={"Authorization": "Bearer test-token"}, json={"text": "Thank you"})
        assert r.status_code == 200
        assert any(l.text == "Thank you" and l.speaker == "user" for l in engine.sessions[call_id].record.transcript)
        sim.send_json({"hangup": True})


# ----------------------------------------------------------------- practice Call for me
PARADISE = ("/ws/simulate?token=test-token&wav=1&number=04023456789&kind=book&target_name=Paradise"
            "&goal=Book%20a%20table%20for%203%20at%208%20PM%20tonight")


def until_closed(ws):
    """JSON events until the server ends the call and closes the socket."""
    got = []
    while True:
        msg = ws.receive()
        if msg["type"] == "websocket.close":
            return got
        if msg.get("text") is not None:
            got.append(json.loads(msg["text"]))


def test_practice_call_for_me_runs_like_a_real_call(settings, engine, llm):
    settings.hold_timeout_s = 10
    replies = iter([
        "One second, let me check that with Rahul. [HOLD: 8 PM is full, 9 PM is free. Book 9?]",
        ("Great, please book it for 9 under Rahul. Thank you! [OUTCOME: booked | Table for 3 at 9 PM under Rahul] "
         "[END_CALL]"),
    ])
    llm.responder = lambda m: next(replies)
    with client(settings, engine).websocket_connect(PARADISE) as ws:
        started = ws.receive_json()
        assert started["event"] == "started" and started["task_id"] and started["call_id"]
        task = engine.store.tasks.get(started["task_id"])
        assert task.practice and task.kind == "book" and task.number == "+914023456789"
        assert task.call_id == started["call_id"] and task.target_name == "Paradise"
        session = engine.sessions[started["call_id"]]
        assert session.conv.outbound and "Book a table for 3" in session.conv.system_prompt
        ws.send_json({"text": "Hello, Paradise restaurant."})  # the place picks up and speaks first
        events, _ = read_until(ws, lambda e: e["event"] == "task_needs_decision")
        assert events[-1]["question"] == "8 PM is full, 9 PM is free. Book 9?"
        assert engine.store.tasks.get(task.id).status == "waiting_user"
        ws.send_json({"action": "answer", "hold_id": events[-1]["hold_id"], "text": "Yes, 9 is fine"})
        events += until_closed(ws)  # the assistant books it and hangs up
    done = engine.store.tasks.get(task.id)
    assert done.status == "done" and done.outcome == "booked" and "9 PM" in done.result
    updates = [e for e in events if e["event"] == "task_update"]
    assert [u["task"]["status"] for u in updates] == ["dialing", "in_call", "done"]
    assert all(u["title"].startswith("Practice: ") for u in updates)
    assert updates[-1]["title"] == "Practice: Paradise: Table for 3 at 9 PM under Rahul"
    record = engine.store.calls.get(task.call_id)
    assert record.practice and record.direction == "outbound" and record.task_id == task.id
    assert "Hello, Paradise restaurant" in llm.calls[0][-1]["content"]  # its first words reached the model


def test_practice_call_for_me_is_not_screened(settings, engine, llm):
    url = "/ws/simulate?token=test-token&number=%2B442079460000&goal=Ask%20about%20the%20order"
    with client(settings, engine).websocket_connect(url) as ws:
        started = ws.receive_json()  # an international number would be rejected if it called in
        assert started["event"] == "started" and engine.store.tasks.get(started["task_id"]).kind == "enquire"
        ws.send_json({"hangup": True})


def test_an_unknown_kind_is_an_error(settings, engine):
    with client(settings, engine).websocket_connect("/ws/simulate?token=test-token&goal=x&kind=order") as ws:
        ev = ws.receive_json()
    assert ev["event"] == "error" and "enquire, book, callback or custom" in ev["detail"]
    assert engine.store.tasks.list() == []


def test_the_assistant_speaks_first_when_the_place_says_nothing(settings, engine, llm):
    llm.responder = lambda m: "Hello, I'm calling for Rahul. Are you open on Sunday?"
    url = "/ws/simulate?token=test-token&wav=1&number=04023456789&goal=Ask%20if%20they%20are%20open%20on%20Sunday"
    with client(settings, engine).websocket_connect(url) as ws:
        ws.receive_json()
        events, _ = read_until(ws, said)  # after 3 s of silence, as on a real call
        assert events[-1]["line"]["text"] == "Hello, I'm calling for Rahul."
        ws.send_json({"hangup": True})
    assert llm.calls[0][-1]["content"].startswith("[Private note")


def test_the_task_ends_when_the_app_closes_the_socket(settings, engine, llm):
    with client(settings, engine).websocket_connect(PARADISE) as ws:
        task_id = ws.receive_json()["task_id"]
        ws.close()  # the app went away mid-call
        for _ in range(200):
            if engine.store.tasks.get(task_id).status not in ("dialing", "in_call"):
                break
            time.sleep(0.02)
    task = engine.store.tasks.get(task_id)
    assert task.status == "failed" and task.result == "The call ended before a result."
    assert not engine.tasks.pending_calls


async def test_a_practice_task_whose_call_never_started_still_ends(engine):
    task = await engine.tasks.create(TaskKind.enquire, "04023456789", "Ask if they are open", practice=True)
    assert task.status == "dialing" and task.call_id in engine.tasks.pending_calls
    await engine.tasks.end_if_unfinished(task.id)
    assert engine.store.tasks.get(task.id).status == "failed" and not engine.tasks.pending_calls


def test_every_practice_call_is_marked_as_one(settings, engine, llm):
    with client(settings, engine).websocket_connect("/ws/simulate?token=test-token&number=9876543210") as ws:
        started = ws.receive_json()
        assert started["task_id"] is None
        ws.send_json({"hangup": True})
    assert engine.store.calls.get(started["call_id"]).practice


async def test_a_phone_call_is_not_a_practice_call(engine):
    bridge = QueueBridge("call1", "+919876543210")
    call = asyncio.create_task(engine.handle_call(bridge))
    await asyncio.sleep(0.05)
    await bridge.hangup()
    await call
    assert engine.store.calls.get("call1").practice is False

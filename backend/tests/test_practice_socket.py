"""The practice call socket (/ws/simulate v2): every message is acknowledged or
answered with an error, never dropped; the call's own events come back on the same
socket; recordings are one utterance; the user's own actions work there too."""

import base64
import json

import numpy as np
from fastapi.testclient import TestClient

from opencall.api import create_app
from opencall.audio import to_wav
from opencall.providers.stt import Transcription

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

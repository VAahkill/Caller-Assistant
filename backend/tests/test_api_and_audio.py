import base64
import io
import json
import wave

import numpy as np
from fastapi.testclient import TestClient

from opencall import __version__
from opencall.api import create_app
from opencall.audio import mulaw_decode, mulaw_encode, resample
from opencall.owner_chat import extract_phone

H = {"Authorization": "Bearer test-token"}


def client(settings, engine):
    return TestClient(create_app(settings, engine, start_gateways=False))


def receive_until_closed(ws):
    """Everything the simulator sends until it hangs up: (json events, binary audio)."""
    events, audio = [], []
    while True:
        msg = ws.receive()
        if msg["type"] == "websocket.close":
            return events, audio
        if msg.get("bytes") is not None:
            audio.append(msg["bytes"])
        else:
            events.append(json.loads(msg["text"]))


def test_auth_required(settings, engine):
    c = client(settings, engine)
    assert c.get("/health").status_code == 200
    assert c.get("/profile").status_code == 401
    assert c.get("/profile", headers=H).json()["user_name"] == "Rahul"


def test_profile_and_instructions(settings, engine):
    c = client(settings, engine)
    r = c.patch("/profile", headers=H, json={"available": True, "block_international": False})
    assert r.json()["available"] is True
    ins = c.post("/instructions", headers=H, json={"text": "Tell couriers to leave parcels with the guard"}).json()
    assert engine.store.profile.instructions[0].id == ins["id"]
    c.delete(f"/instructions/{ins['id']}", headers=H)
    assert engine.store.profile.instructions == []


def test_owner_chat_creates_a_call_task(settings, engine, llm):
    llm.responder = lambda m: "[CALL: enquire | +91 40 2345 6789 | Paradise | Check if a table for 3 is free at 8 PM]\nOn it!"
    c = client(settings, engine)
    r = c.post("/assistant/chat", headers=H, json={"text": "check if a 3 seater is free at 8 tonight"}).json()
    assert r["reply"] == "On it!"
    task = r["actions"][0]["task"]
    assert task["number"] == "+914023456789"
    # No telephony configured in tests, so the task fails with a clear reason.
    stored = engine.store.tasks.get(task["id"])
    assert stored.status == "failed" and "No outbound telephony" in stored.result


def test_voice_clone_upload(settings, engine):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x01\x00" * 16000 * 8)
    c = client(settings, engine)
    r = c.post("/voices", headers=H, data={"label": "My Voice"}, files={"audio": ("v.wav", buf.getvalue(), "audio/wav")})
    assert r.json()["id"] == "clone:my_voice"
    assert any(v["id"] == "clone:my_voice" for v in c.get("/voices", headers=H).json())


def test_simulator_websocket(settings, engine, llm):
    llm.responder = lambda m: "Sure, I'll tell Rahul you called. [MESSAGE: Ankit called] Bye! [END_CALL]"
    c = client(settings, engine)
    with c.websocket_connect("/ws/simulate?token=test-token&number=9876543210") as ws:
        assert ws.receive_json()["event"] == "started"
        ws.send_json({"text": "Hi, this is Ankit, tell Rahul I called"})
        events, audio = receive_until_closed(ws)
    assert audio
    assert engine.store.messages.list()[0].text == "Ankit called"
    assert {"event": "ack", "kind": "text"} in events


def test_practice_call_from_the_app(settings, engine, llm):
    """The app's practice call: a spoken clip in, whole WAV sentences out."""
    from opencall.audio import read_wav, to_wav
    from opencall.providers.stt import Transcription

    engine.stt.next = [Transcription("హలో, స్విగ్గీ ఆర్డర్", "te")]
    llm.responder = lambda m: "సరే, ఒక్క నిమిషం. [END_CALL]"
    tone = (np.sin(np.linspace(0, 2000, 8000)) * 8000).astype(np.int16).tobytes()  # half a second
    c = client(settings, engine)
    with c.websocket_connect("/ws/simulate?token=test-token&number=9876543210&wav=1") as ws:
        call_id = ws.receive_json()["call_id"]
        ws.send_json({"audio_b64": base64.b64encode(to_wav(tone, 16000)).decode()})
        events, clips = receive_until_closed(ws)  # the greeting and the reply; the call ends after it
    assert clips and all(c[:4] == b"RIFF" and read_wav(c)[1] == 16000 for c in clips)
    assert any(e["event"] == "ack" and e["kind"] == "audio" for e in events)
    said = [e["line"]["text"] for e in events if e["event"] == "transcript" and e["line"]["speaker"] == "assistant"]
    assert said[-1] == "సరే, ఒక్క నిమిషం."
    record = engine.store.calls.get(call_id)
    assert record.language == "te"
    assert [l.text for l in record.transcript if l.speaker == "caller"] == ["హలో, స్విగ్గీ ఆర్డర్"]


def test_typed_text_language_is_guessed_from_its_script():
    from opencall.languages import guess_language

    assert guess_language("మీ ఆర్డర్ వచ్చింది") == "te"
    assert guess_language("உங்கள் ஆர்டர்") == "ta"
    assert guess_language("आपका ऑर्डर") == "hi"
    assert guess_language("Your order, 302") == "en"


def test_mulaw_roundtrip_and_resample():
    x = (np.sin(np.linspace(0, 40, 1600)) * 12000).astype(np.int16).tobytes()
    y = np.frombuffer(mulaw_decode(mulaw_encode(x)), dtype=np.int16)
    assert np.max(np.abs(y.astype(int) - np.frombuffer(x, dtype=np.int16))) < 600
    assert len(resample(x, 8000, 16000)) == len(x) * 2


def test_extract_phone():
    assert extract_phone("Paradise Biryani · 040 6666 1234 · Open now") == "04066661234"
    assert extract_phone("no number here") == ""


def test_health_reports_what_is_ready(settings, engine):
    engine.ready.update(stt=True, tts=True)
    body = TestClient(create_app(settings, engine, start_gateways=False)).get("/health").json()
    assert body["ok"] and body["version"] == __version__ and body["active_calls"] == 0
    assert body["ready"] == {"stt": True, "tts": True, "llm": False, "mt": False, "lid": False}
    assert body["llm_model"] == settings.llm_model

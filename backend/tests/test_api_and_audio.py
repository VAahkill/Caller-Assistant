import io
import wave

import numpy as np
from fastapi.testclient import TestClient

from opencall.api import create_app
from opencall.audio import mulaw_decode, mulaw_encode, resample
from opencall.owner_chat import extract_phone

H = {"Authorization": "Bearer test-token"}


def client(settings, engine):
    return TestClient(create_app(settings, engine, start_gateways=False))


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
        ws.send_json({"text": "Hi, this is Ankit, tell Rahul I called"})
        got_audio = False
        try:
            while True:
                ws.receive_bytes()
                got_audio = True
        except Exception:
            pass
    assert got_audio
    assert engine.store.messages.list()[0].text == "Ankit called"


def test_mulaw_roundtrip_and_resample():
    x = (np.sin(np.linspace(0, 40, 1600)) * 12000).astype(np.int16).tobytes()
    y = np.frombuffer(mulaw_decode(mulaw_encode(x)), dtype=np.int16)
    assert np.max(np.abs(y.astype(int) - np.frombuffer(x, dtype=np.int16))) < 600
    assert len(resample(x, 8000, 16000)) == len(x) * 2


def test_extract_phone():
    assert extract_phone("Paradise Biryani · 040 6666 1234 · Open now") == "04066661234"
    assert extract_phone("no number here") == ""

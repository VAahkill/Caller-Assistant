"""API contract v2: profile fields and their checks, away status, instructions and
notes with who they're for and when they end, templates, blocking and VIPs,
and the user's live replies over REST."""

import asyncio
import io
import json
import time
import wave

import pytest
from fastapi.testclient import TestClient

from opencall.api import create_app
from opencall.models import Contact
from opencall.providers.mt import TranslationService
from opencall.providers.stt import Transcription
from opencall.screening import screen_number
from opencall.telephony.queue_bridge import QueueBridge

H = {"Authorization": "Bearer test-token"}


def client(settings, engine):
    return TestClient(create_app(settings, engine, start_gateways=False))


# ------------------------------------------------------------------ profile
def test_profile_patch_takes_the_new_fields(settings, engine):
    c = client(settings, engine)
    r = c.patch("/profile", headers=H, json={
        "owner_language": "TE", "translate_live": False, "caller_languages": ["te", "en"],
        "blocked_numbers": ["98765 43210", "+919876543210"], "vip_numbers": ["040-2345 6789"],
        "home_country_code": "+91", "user_name": "  Rahul  Kumar ",
    })
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["owner_language"] == "te" and body["translate_live"] is False
    assert body["caller_languages"] == ["te", "en"] and body["user_name"] == "Rahul Kumar"
    assert body["blocked_numbers"] == ["+919876543210"] and body["vip_numbers"] == ["+914023456789"]
    assert engine.store.profile.owner_language == "te"
    # Fields left out (or null) stay as they were; an older app's extra fields are ignored.
    r = c.patch("/profile", headers=H, json={"available": True, "user_name": None, "languages": ["en", "hi"]})
    assert r.status_code == 200 and r.json()["user_name"] == "Rahul Kumar" and r.json()["available"] is True


@pytest.mark.parametrize("code, ok", [("+91", "+91"), ("91", "+91"), ("+1", "+1"), ("+1264", "+1264"),
                                      ("9876543210", None), ("+0", None), ("+91 98765", None), ("", None),
                                      ("+12345", None)])
def test_the_country_code_must_be_a_country_code_not_a_phone_number(settings, engine, code, ok):
    r = client(settings, engine).patch("/profile", headers=H, json={"home_country_code": code})
    if ok:
        assert r.status_code == 200 and r.json()["home_country_code"] == ok
    else:
        assert r.status_code == 422 and "country calling code" in r.text
        assert engine.store.profile.home_country_code == "+91"


@pytest.mark.parametrize("patch", [{"user_name": "   "}, {"assistant_name": "x" * 61}, {"owner_language": "telugu"},
                                   {"blocked_numbers": ["12"]}, {"blocked_prefixes": ["+91 abc"]},
                                   {"caller_languages": ["en", "Hindi!"]}])
def test_bad_profile_values_are_refused(settings, engine, patch):
    assert client(settings, engine).patch("/profile", headers=H, json=patch).status_code == 422


# ------------------------------------------------------------------ away
def test_away_status_set_cleared_and_heard_in_the_greeting(settings, engine):
    c = client(settings, engine)
    until = time.time() + 3600
    r = c.put("/away", headers=H, json={"preset": "meeting", "message": "In a meeting until 3 PM", "until": until})
    assert r.status_code == 200
    away = r.json()["away"]
    assert away["preset"] == "meeting" and away["message"] == "In a meeting until 3 PM" and away["until"] == until
    assert away["set_at"] > 0
    assert "Rahul is in a meeting until 3 PM." in engine.greeting("en")
    r = c.put("/away", headers=H, json={"preset": "driving", "until": None})  # the preset's own words
    assert r.json()["away"]["message"] == "Driving" and "Rahul is driving." in engine.greeting("en")
    assert c.delete("/away", headers=H).json()["away"] is None
    assert "can't take the call right now" in engine.greeting("en")


@pytest.mark.parametrize("body", [{"preset": "custom", "message": " "}, {"preset": "meeting", "until": 1.0},
                                  {"message": "x" * 201}])
def test_bad_away_statuses_are_refused(settings, engine, body):
    assert client(settings, engine).put("/away", headers=H, json=body).status_code == 422
    assert engine.store.profile.away is None


def test_away_can_be_set_and_cleared_through_profile_patch(settings, engine):
    c = client(settings, engine)
    r = c.patch("/profile", headers=H, json={"away": {"preset": "sleeping", "message": "Sleeping until 7 AM"}})
    assert r.json()["away"]["message"] == "Sleeping until 7 AM"
    assert c.patch("/profile", headers=H, json={"available": False}).json()["away"] is not None  # untouched
    assert c.patch("/profile", headers=H, json={"away": None}).json()["away"] is None


# ------------------------------------------------------------------ instructions and notes
def test_instructions_with_who_they_are_for_and_an_end(settings, engine):
    c = client(settings, engine)
    soon = time.time() + 86400
    r = c.post("/instructions", headers=H, json={
        "text": " Put my boss through to a hold ", "applies_to": "numbers", "numbers": ["98222 22222"],
        "category": "Work", "expires_at": soon})
    assert r.status_code == 200, r.text
    ins = r.json()
    assert ins["text"] == "Put my boss through to a hold" and ins["numbers"] == ["+919822222222"]
    assert ins["category"] == "work" and ins["enabled"] is True and ins["expires_at"] == soon
    assert ins["created_at"] == ins["updated_at"]
    time.sleep(0.01)
    r = c.patch(f"/instructions/{ins['id']}", headers=H, json={"enabled": False, "expires_at": None})
    assert r.status_code == 200
    changed = r.json()
    assert changed["enabled"] is False and changed["expires_at"] is None and changed["text"] == ins["text"]
    assert changed["created_at"] == ins["created_at"] and changed["updated_at"] > ins["updated_at"]
    assert engine.store.profile.instructions[0].enabled is False
    assert c.patch("/instructions/nope", headers=H, json={"enabled": True}).status_code == 404
    assert c.delete(f"/instructions/{ins['id']}", headers=H).json() == {"ok": True}
    assert engine.store.profile.instructions == []


@pytest.mark.parametrize("body", [{"text": "  "}, {"text": "For him", "applies_to": "numbers"},
                                  {"text": "x", "applies_to": "friends"}, {"text": "x", "expires_at": 1.0},
                                  {"text": "x", "applies_to": "numbers", "numbers": ["1"]}, {"text": "x" * 1001}])
def test_bad_instructions_are_refused(settings, engine, body):
    assert client(settings, engine).post("/instructions", headers=H, json=body).status_code == 422
    assert engine.store.profile.instructions == []


def test_an_older_app_can_still_add_instructions_and_notes(settings, engine):
    c = client(settings, engine)
    assert c.post("/instructions", headers=H, json={"text": "Tell couriers to leave parcels with the guard"}).json()[
        "applies_to"] == "everyone"
    note = c.post("/knowledge", headers=H, json={"id": "ignored", "text": "In Goa until Friday",
                                                 "share_with": "anyone"}).json()
    assert note["share_with"] == "anyone" and note["id"] != "ignored" and note["enabled"] is True


def test_notes_with_who_may_hear_them(settings, engine):
    c = client(settings, engine)
    r = c.post("/knowledge", headers=H, json={"text": "The guard's name is Ramesh.", "share_with": "delivery"})
    note = r.json()
    assert note["share_with"] == "delivery" and note["numbers"] == []
    r = c.patch(f"/knowledge/{note['id']}", headers=H, json={"share_with": "numbers", "numbers": ["9811111111"]})
    assert r.json()["numbers"] == ["+919811111111"]
    assert c.patch(f"/knowledge/{note['id']}", headers=H, json={"numbers": []}).status_code == 422
    assert c.patch(f"/knowledge/{note['id']}", headers=H, json={"text": ""}).status_code == 422
    assert c.patch("/knowledge/nope", headers=H, json={"enabled": False}).status_code == 404
    assert c.post("/knowledge", headers=H, json={"text": "x", "share_with": "everyone"}).status_code == 422
    assert c.delete(f"/knowledge/{note['id']}", headers=H).json() == {"ok": True}
    assert engine.store.profile.knowledge == []


def test_the_templates_cover_what_an_indian_owner_needs(settings, engine):
    templates = client(settings, engine).get("/instructions/templates", headers=H).json()
    assert len(templates) >= 30
    assert all(set(t) == {"category", "text", "applies_to"} for t in templates)
    assert all(t["applies_to"] in ("everyone", "contacts", "unknown", "delivery") for t in templates)
    categories = {t["category"] for t in templates}
    assert {"delivery", "security", "family", "work", "health", "home", "unknown", "sales", "availability",
            "callbacks"} <= categories
    text = " ".join(t["text"] for t in templates).lower()
    for topic in ("otp", "kyc", "bank", "landlord", "courier", "clinic", "loan", "credit card", "insurance",
                  "real-estate", "meeting", "driving", "sleeping", "call back", "swiggy"):
        assert topic in text, topic
    assert len({t["text"] for t in templates}) == len(templates)  # no repeats
    # A template added as it is works as an instruction.
    t = next(t for t in templates if t["applies_to"] == "delivery")
    assert client(settings, engine).post("/instructions", headers=H, json=t).status_code == 200


# ------------------------------------------------------------------ blocking and VIPs
def test_blocking_and_unblocking_a_number(settings, engine):
    c = client(settings, engine)
    engine.store.profile.vip_numbers = ["+919876543210"]
    r = c.post("/contacts/block", headers=H, json={"number": "098765 43210"})
    assert r.status_code == 200
    assert r.json()["blocked_numbers"] == ["+919876543210"] and r.json()["vip_numbers"] == []
    assert not screen_number(engine.store.profile, "9876543210").answer
    assert c.post("/contacts/block", headers=H, json={"number": "+91 98765 43210"}).json()["blocked_numbers"] == [
        "+919876543210"]  # once
    assert c.post("/contacts/block", headers=H, json={"number": " "}).status_code == 422
    r = c.delete("/contacts/block/%2B919876543210", headers=H)
    assert r.status_code == 200 and r.json()["blocked_numbers"] == []
    assert screen_number(engine.store.profile, "9876543210").answer


def test_unblocking_also_frees_a_contact_an_older_app_blocked(settings, engine):
    engine.store.profile.contacts = [Contact(number="+919811111111", name="Ex", blocked=True)]
    c = client(settings, engine)
    assert not screen_number(engine.store.profile, "9811111111").answer
    c.delete("/contacts/block/9811111111", headers=H)
    assert screen_number(engine.store.profile, "9811111111").answer


async def test_a_vip_call_is_urgent_and_the_model_is_told(engine, llm):
    engine.store.profile.vip_numbers = ["+919844444444"]
    llm.responder = lambda m: "Of course, I'll let Rahul know right away."
    bridge = QueueBridge("vip1", "9844444444")
    task = asyncio.create_task(engine.handle_call(bridge))
    while "vip1" not in engine.sessions:
        await asyncio.sleep(0.005)
    s = engine.sessions["vip1"]
    await s.handle_text("Hi, it's Anil, is Rahul there?", "en")
    assert "VIP list" in llm.calls[-1][0]["content"]
    urgent = [e for e in engine.bus.history if e["event"] == "urgent_call"]
    assert urgent and urgent[0]["reason"] == "vip" and urgent[0]["call_id"] == "vip1"
    await bridge.hangup()
    await task
    assert engine.store.calls.get("vip1").urgent is True


def test_calls_list_has_urgency_and_action_items(settings, engine):
    from opencall.models import CallRecord

    engine.store.calls.put(CallRecord(id="c9", number="+919800000000", summary="Bank called.", urgent=True,
                                      action_items=["Call the bank back"]))
    call = client(settings, engine).get("/calls", headers=H).json()[0]
    assert call["urgent"] is True and call["action_items"] == ["Call the bank back"] and "transcript" not in call


# ------------------------------------------------------------------ the user's live replies over REST
class TableMT:
    name = "table"

    def __init__(self, table):
        self.table = table

    def supports(self, lang):
        return lang in ("en", "te", "hi")

    def warm_up(self, languages):
        pass

    def translate(self, text, src, tgt):
        return self.table.get((text, tgt), f"[{tgt}] {text}")


def wav(seconds=1.0):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(b"\x10\x00" * int(16000 * seconds))
    return buf.getvalue()


def next_event(ws):
    """The next JSON event from the practice socket, past the audio clips it sends."""
    while True:
        msg = ws.receive()
        assert msg["type"] != "websocket.close"
        if msg.get("bytes") is None:
            return json.loads(msg["text"])


def test_say_and_say_audio_reach_a_telugu_caller_in_telugu(settings, engine, llm):
    engine.mt = TranslationService(TableMT({("I'm coming down.", "te"): "నేను కిందకు వస్తున్నాను.",
                                            ("Wait at the gate.", "te"): "గేటు దగ్గర ఉండండి."}))
    engine.stt.next = [Transcription("Wait at the gate.", "en")]
    llm.responder = lambda m: "Okay."
    c = client(settings, engine)
    with c.websocket_connect("/ws/simulate?token=test-token&number=9876543210&lang=te") as sim:
        call_id = next_event(sim)["call_id"]
        sim.send_json({"text": "హలో"})
        while not ((m := next_event(sim))["event"] == "transcript" and m["line"]["speaker"] == "assistant"
                   and m["line"]["text"] == "[te] Okay."):
            pass
        r = c.post(f"/calls/{call_id}/say", headers=H, json={"text": "I'm coming down.", "lang": "en"})
        assert r.status_code == 200
        r = c.post(f"/calls/{call_id}/say-audio", headers=H, data={"lang": "en"},
                   files={"audio": ("reply.wav", wav(), "audio/wav")})
        assert r.status_code == 200 and r.json() == {"ok": True, "heard": "Wait at the gate."}
        said = [(line.text, line.translation) for line in engine.sessions[call_id].record.transcript
                if line.speaker == "user"]
        assert said == [("నేను కిందకు వస్తున్నాను.", "I'm coming down."), ("గేటు దగ్గర ఉండండి.", "Wait at the gate.")]
        assert c.post(f"/calls/{call_id}/say", headers=H, json={"text": "OTP is 482913"}).status_code == 422
        r = c.post(f"/calls/{call_id}/say-audio", headers=H, files={"audio": ("x.wav", b"not audio", "audio/wav")})
        assert r.status_code == 422
        sim.send_json({"hangup": True})
    assert c.post("/calls/nope/say", headers=H, json={"text": "hi"}).status_code == 404

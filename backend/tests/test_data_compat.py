"""Data saved by the first version of the server (profile.json, calls, messages,
tasks, recorded voices) loads without losing anything, and gets the new fields'
defaults."""

import json

from opencall.models import Profile
from opencall.providers.tts import TTSRouter
from opencall.store import Store

V1_PROFILE = {
    "user_name": "Rahul", "assistant_name": "Maya", "enabled": True, "available": False,
    "home_country_code": "+91", "block_international": True, "answer_unknown_numbers": True,
    "voice": "clone:my_voice", "languages": ["en", "hi"], "blocked_prefixes": ["+91140"],
    "location": {"lat": 17.41, "lng": 78.43, "address": "Flat 402, Road No. 3", "building": "Sri Sai Nilayam",
                 "floor_unit": "4th floor", "landmarks": "Opposite Apollo Pharmacy",
                 "gate_instructions": "Green gate", "geocoded_hint": "Banjara Hills"},
    "instructions": [{"id": "ins1", "text": "Tell couriers to leave parcels with the guard",
                      "created_at": 1700000000.0}],
    "knowledge": [{"id": "kn1", "text": "I'm in Goa until Friday", "share_with": "anyone"},
                  {"id": "kn2", "text": "Back on Monday", "share_with": "contacts"}],
    "contacts": [{"number": "+919811111111", "name": "Priya", "blocked": False},
                 {"number": "+919822222222", "name": "Spammer", "blocked": True}],
    "push_tokens": ["ExponentPushToken[abc]"],
}

V1_CALL = {
    "id": "call1", "direction": "inbound", "number": "+919833333333", "contact_name": "", "category": "delivery",
    "status": "ended", "language": "hi", "started_at": 1700000000.0, "ended_at": 1700000060.0,
    "transcript": [{"speaker": "assistant", "text": "Hi, this is Maya.", "at": 1700000001.0, "kind": "speech"},
                   {"speaker": "caller", "text": "Swiggy order hai", "at": 1700000005.0, "kind": "speech"}],
    "holds": [{"id": "h1", "question": "Leave it with the guard?", "asked_at": 1700000010.0, "answer": "Yes",
               "answered_at": 1700000020.0, "sensitive": False}],
    "summary": "A Swiggy delivery.", "message": "", "recording": "call1.wav", "task_id": None, "reject_reason": "",
}


def test_a_first_version_data_folder_loads_without_loss(tmp_path):
    (tmp_path / "profile.json").write_text(json.dumps(V1_PROFILE))
    (tmp_path / "calls.json").write_text(json.dumps([V1_CALL]))
    (tmp_path / "messages.json").write_text(json.dumps([{
        "id": "m1", "call_id": "call1", "number": "+919833333333", "caller_name": "", "text": "Call me back",
        "created_at": 1700000070.0, "status": "new", "reply": "", "callback_task_id": None}]))
    (tmp_path / "tasks.json").write_text(json.dumps([{
        "id": "t1", "kind": "book", "number": "+914023456789", "goal": "Table for 3", "target_name": "Paradise",
        "status": "done", "outcome": "booked", "result": "Booked for 8 PM", "call_id": "c2",
        "created_at": 1700000000.0, "updated_at": 1700000100.0}]))
    store = Store(tmp_path)
    p = store.profile
    assert (p.user_name, p.assistant_name, p.voice, p.home_country_code) == ("Rahul", "Maya", "clone:my_voice", "+91")
    assert p.location.landmarks == "Opposite Apollo Pharmacy" and p.location.gate_instructions == "Green gate"
    assert [c.blocked for c in p.contacts] == [False, True] and p.push_tokens == ["ExponentPushToken[abc]"]
    ins = p.instructions[0]
    assert (ins.id, ins.text, ins.enabled, ins.applies_to, ins.category) == (
        "ins1", "Tell couriers to leave parcels with the guard", True, "everyone", "general")
    assert ins.created_at == ins.updated_at == 1700000000.0 and ins.expires_at is None
    assert [(n.id, n.share_with, n.enabled) for n in p.knowledge] == [("kn1", "anyone", True),
                                                                       ("kn2", "contacts", True)]
    # New fields get their defaults.
    assert p.caller_languages == ["en", "hi", "te", "ta"] and p.owner_language == "en" and p.translate_live
    assert p.blocked_numbers == [] and p.vip_numbers == [] and p.away is None
    call = store.calls.get("call1")
    assert [line.text for line in call.transcript] == ["Hi, this is Maya.", "Swiggy order hai"]
    assert all(line.id for line in call.transcript) and call.holds[0].answer == "Yes"
    assert call.urgent is False and call.action_items == [] and call.summary == "A Swiggy delivery."
    assert store.messages.get("m1").text == "Call me back" and store.tasks.get("t1").result == "Booked for 8 PM"
    # Saved again and read back: the same.
    store.save_profile()
    again = Store(tmp_path).profile
    assert again.model_dump() == p.model_dump()


def test_a_first_version_recorded_voice_is_still_listed(tmp_path):
    voices = tmp_path / "voices"
    voices.mkdir()
    (voices / "my_voice.wav").write_bytes(b"RIFF....WAVE")
    (voices / "my_voice.json").write_text(json.dumps({"label": "My voice", "seconds": 21.4}))
    router = TTSRouter(voices, provider="silent", clone_provider="xtts")  # loads nothing until it speaks
    voice = router.get_voice("clone:my_voice")
    assert voice is not None and voice.name == "My voice" and voice.status == "ready" and voice.seconds == 21.4


def test_an_odd_country_code_saved_by_an_older_app_is_kept():
    assert Profile(home_country_code="91").home_country_code == "+91"
    assert Profile(home_country_code="9876543210").home_country_code == "9876543210"  # not lost on load

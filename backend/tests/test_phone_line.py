"""The phone line: what GET /health says about it, "Call for me" refused (409, no
task) when it can't place calls, and a plain reason, never a raw error, when a call
still can't be placed."""

import httpx
import pytest
from fastapi.testclient import TestClient

from opencall.api import create_app
from opencall.models import TaskKind, TaskStatus
from opencall.telephony.asterisk import AsteriskGateway
from opencall.telephony.base import NO_LINE

H = {"Authorization": "Bearer test-token"}
ARI = "http://host.docker.internal:8088/ari"
UNREACHABLE = ("No phone line is connected. Your server's settings point to a SIM modem line, but nothing "
               "answers there. If you haven't set up a modem, that's expected.")
# The app shows these to the owner as they are: no setting names, file names or addresses.
JARGON = ("OPENCALL_", ".env", "ari.conf", "ARI", "host.docker.internal", "8088", "/ari")
TASK = {"number": "04023456789", "goal": "Ask if they are open on Sunday", "target_name": "Paradise"}


def refused(request):
    raise httpx.ConnectError("All connection attempts failed", request=request)


def asterisk(settings, engine, handler, url=ARI):
    """The app as the first .env.example set it up: Asterisk at host.docker.internal."""
    settings.asterisk_ari_url = url
    settings.asterisk_ari_user, settings.asterisk_ari_password = "opencall", "s3cret-pass"
    app = create_app(settings, engine, start_gateways=False)
    assert isinstance(engine.dialer, AsteriskGateway)
    engine.dialer.transport = httpx.MockTransport(handler)
    return TestClient(app)


def line(c):
    return c.get("/health").json()["phone_line"]


def test_without_a_line_health_says_none(settings, engine):
    c = TestClient(create_app(settings, engine, start_gateways=False))
    assert line(c) == {"kind": "none", "ok": False, "inbound": False, "outbound": False, "detail": NO_LINE}


def test_asterisk_that_does_not_answer(settings, engine):
    c = asterisk(settings, engine, refused)
    assert line(c) == {"kind": "gsm", "ok": False, "inbound": False, "outbound": False, "detail": UNREACHABLE}


def test_asterisk_that_answers_is_checked_at_most_every_15_seconds(settings, engine):
    asked = []

    def ari(request):
        asked.append((request.method, request.url.path, request.headers.get("authorization", "")))
        return httpx.Response(200, json={"system": {"version": "20.5.0"}})

    c = asterisk(settings, engine, ari)
    first = line(c)
    assert (first["kind"], first["ok"], first["inbound"], first["outbound"]) == ("gsm", True, True, True)
    assert first["detail"] == ("Your SIM modem's phone software is running. If calls still don't come through, "
                               "check that the modem is plugged in and its SIM has signal.")
    assert line(c) == first
    assert len(asked) == 1  # the second /health used the recent check
    assert asked[0][:2] == ("GET", "/ari/asterisk/info") and asked[0][2].startswith("Basic ")


def test_asterisk_with_the_wrong_login(settings, engine, caplog):
    c = asterisk(settings, engine, lambda r: httpx.Response(401, text="Authentication required"))
    status = line(c)
    assert not status["ok"] and not status["outbound"]
    assert "password" in status["detail"] and not any(j in status["detail"] for j in JARGON)
    assert "s3cret-pass" not in status["detail"]
    # The setting names are for whoever reads the server's log.
    assert "OPENCALL_ASTERISK_ARI_USER" in caplog.text and "OPENCALL_ASTERISK_ARI_PASSWORD" in caplog.text


def test_the_details_never_show_a_password_from_the_url(settings, engine):
    c = asterisk(settings, engine, refused, url="http://opencall:hunter2@192.168.1.20:8088/ari")
    detail = line(c)["detail"]
    assert detail == UNREACHABLE and "hunter2" not in detail


def test_something_else_at_the_address(settings, engine, caplog):
    c = asterisk(settings, engine, lambda r: httpx.Response(404, text="Not Found"))
    status = line(c)
    assert not status["ok"] and not any(j in status["detail"] for j in JARGON)
    assert "OPENCALL_ASTERISK_ARI_URL" in caplog.text


def test_call_for_me_without_a_line_is_refused_and_makes_no_task(settings, engine):
    c = TestClient(create_app(settings, engine, start_gateways=False))
    r = c.post("/tasks", headers=H, json=TASK)
    assert r.status_code == 409 and r.json() == {"detail": NO_LINE}
    assert engine.store.tasks.list() == []


def test_call_for_me_checks_the_line_again_before_dialling(settings, engine):
    up = {"now": True}
    dialled = []

    def ari(request):
        if not up["now"]:
            return refused(request)
        if request.method == "POST":
            dialled.append(request.url.params["endpoint"])
        return httpx.Response(200, json={})

    c = asterisk(settings, engine, ari)
    assert line(c)["ok"]
    up["now"] = False  # Asterisk stopped since that check
    r = c.post("/tasks", headers=H, json=TASK)
    assert r.status_code == 409 and r.json() == {"detail": UNREACHABLE}
    assert engine.store.tasks.list() == [] and dialled == []
    assert not line(c)["ok"]  # /health now shows the failed check
    up["now"] = True
    r = c.post("/tasks", headers=H, json=TASK)
    assert r.status_code == 200 and r.json()["status"] == "dialing" and not r.json()["practice"]
    assert dialled == ["Quectel/quectel0/914023456789"]


@pytest.mark.parametrize("ari, reason", [
    (refused, UNREACHABLE),
    (lambda r: httpx.Response(401), "didn't accept the server's password"),
    (lambda r: httpx.Response(500, json={"message": "Allocation failed"}), "The SIM modem couldn't start the call"),
])
async def test_an_asterisk_dial_that_fails_gets_a_plain_result(engine, ari, reason):
    engine.settings.asterisk_ari_url = ARI
    gw = AsteriskGateway(engine)
    gw.transport = httpx.MockTransport(ari)
    engine.dialer = gw
    task = await engine.tasks.create(TaskKind.enquire, TASK["number"], TASK["goal"], "Paradise")
    assert task.status == TaskStatus.failed and task.outcome == "failed"
    assert reason in task.result
    for text in ("All connection attempts failed", "Allocation failed", "HTTPStatusError", "401", *JARGON):
        assert text not in task.result
    assert not engine.tasks.pending_calls and not gw.expected
    update = [e for e in engine.bus.history if e["event"] == "task_update"][-1]
    assert update["task"]["status"] == "failed" and "All connection attempts failed" not in update["title"]


async def test_no_line_and_unknown_dial_errors_get_plain_results(engine, caplog):
    task = await engine.tasks.create(TaskKind.enquire, TASK["number"], TASK["goal"])
    assert task.status == TaskStatus.failed and task.result == NO_LINE

    class BrokenDialer:
        name = "broken"

        async def dial(self, number, call_id):
            raise ValueError("unexpected token at 0x1f")

    engine.dialer = BrokenDialer()
    task = await engine.tasks.create(TaskKind.enquire, TASK["number"], TASK["goal"])
    assert task.status == TaskStatus.failed
    assert task.result == ("The call couldn't be started because of a problem on the server. "
                           "Its log says what went wrong.")
    assert "ValueError: unexpected token at 0x1f" in caplog.text  # the details are in the log only


class WorkingDialer:
    """A line that can call out (no status(): trusted, like the other tests' fakes)."""
    name = "fake"

    def __init__(self):
        self.dialled = []

    async def dial(self, number, call_id):
        self.dialled.append(number)


def message(engine, practice=False):
    from opencall.models import CallerMessage, CallRecord

    call = CallRecord(number="+919812345678", practice=practice)
    engine.store.calls.put(call)
    msg = CallerMessage(call_id=call.id, number=call.number, text="Call me about the report")
    engine.store.messages.put(msg)
    return msg


def test_a_call_back_reply_without_a_line_is_refused_and_saves_nothing(settings, engine):
    c = TestClient(create_app(settings, engine, start_gateways=False))
    msg = message(engine)
    r = c.post(f"/messages/{msg.id}/reply", headers=H, json={"text": "I'll call at 6", "call_back": True})
    assert r.status_code == 409
    assert r.json()["detail"].startswith(NO_LINE) and 'Turn off "Call them back"' in r.json()["detail"]
    assert engine.store.messages.get(msg.id).reply == "" and engine.store.tasks.list() == []
    # Without the call back, the reply is saved.
    r = c.post(f"/messages/{msg.id}/reply", headers=H, json={"text": "I'll call at 6", "call_back": False})
    assert r.status_code == 200 and r.json()["reply"] == "I'll call at 6" and r.json()["callback_task_id"] is None


def test_a_message_from_a_practice_call_is_never_called_back(settings, engine):
    engine.dialer = WorkingDialer()
    c = TestClient(create_app(settings, engine, start_gateways=False))
    msg = message(engine, practice=True)
    r = c.post(f"/messages/{msg.id}/reply", headers=H, json={"text": "Thanks", "call_back": True})
    assert r.status_code == 409 and "practice call" in r.json()["detail"]
    assert engine.dialer.dialled == [] and engine.store.tasks.list() == []


def test_a_call_back_reply_with_a_line_calls_them(settings, engine):
    engine.dialer = WorkingDialer()
    c = TestClient(create_app(settings, engine, start_gateways=False))
    msg = message(engine)
    r = c.post(f"/messages/{msg.id}/reply", headers=H, json={"text": "I'll call at 6", "call_back": True})
    assert r.status_code == 200 and r.json()["callback_task_id"]
    assert engine.dialer.dialled == ["+919812345678"]


def test_owner_chat_without_a_line_says_so_and_makes_no_task(settings, engine, llm):
    llm.responder = lambda m: "[CALL: enquire | +91 40 2345 6789 | Paradise | Check if a table for 3 is free at 8 PM]\nOn it!"
    c = TestClient(create_app(settings, engine, start_gateways=False))
    r = c.post("/assistant/chat", headers=H, json={"text": "check if a 3 seater is free at 8 tonight"}).json()
    assert r["actions"] == [] and engine.store.tasks.list() == []
    assert r["reply"].startswith("I can't call Paradise yet. No phone line is set up")
    assert "On it!" not in r["reply"] and "practise" in r["reply"]


async def test_practice_calls_never_buzz_the_phone(monkeypatch):
    from opencall import events

    posted = []

    class Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def post(self, url, json):
            posted.append(json[0]["body"])

    monkeypatch.setattr(events.httpx, "AsyncClient", Client)
    bus = events.EventBus(push_url="https://push.example/send", push_tokens=lambda: ["ExponentPushToken[x]"])
    await bus._push("hold_question", {"who": "Paradise", "question": "Book 9?", "practice": True})
    await bus._push("call_started", {"who": "Paradise", "call": {"practice": True}})
    await bus._push("task_update", {"title": "Practice: Calling Paradise", "task": {"practice": True}})
    assert posted == []
    await bus._push("hold_question", {"who": "Paradise", "question": "Book 9?", "call_id": "c1"})
    assert posted == ["Paradise asks: Book 9?"]

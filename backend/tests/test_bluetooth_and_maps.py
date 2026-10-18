import asyncio

from fastapi.testclient import TestClient

from opencall.api import create_app
from opencall.maps import coords_from_text
from opencall.models import TaskKind, TaskStatus
from opencall.telephony import bluetooth
from opencall.telephony.bluetooth import NO_PHONE, BluetoothGateway, DBusOfono


class FakeOfono:
    def __init__(self):
        self.answered, self.hung_up, self.dialled, self.texts = [], [], [], []
        self.phone: str | None = "OnePlus 9"  # the connected phone's name

    async def connected_phone(self):
        return self.phone

    async def start(self, on_added, on_removed, on_state):
        self.on_added, self.on_removed, self.on_state = on_added, on_removed, on_state

    async def answer(self, path):
        self.answered.append(path)
        await self.on_state(path, "active")

    async def hangup(self, path):
        self.hung_up.append(path)

    async def send_sms(self, number, text):
        self.texts.append((number, text))
        return True

    async def dial(self, number):
        self.dialled.append(number)
        path = f"/hfp/dev/voicecall{len(self.dialled):02d}"
        await self.on_added(path, number, "dialing")
        return path


async def make(engine):
    engine.settings.bluetooth_answer_delay_s = 0.05
    engine.settings.bluetooth_answer_delay_available_s = 0.05
    ofono = FakeOfono()
    gw = BluetoothGateway(engine, ofono, open_audio=False)
    await gw.start()
    return gw, ofono


async def wait_for(cond, steps=100):
    for _ in range(steps):
        if cond():
            return True
        await asyncio.sleep(0.02)
    return False


async def test_answers_after_ringing_and_ends_with_the_phone(engine):
    gw, ofono = await make(engine)
    await ofono.on_added("/hfp/dev/voicecall01", "+919876543210", "incoming")
    assert await wait_for(lambda: engine.sessions)
    assert ofono.answered == ["/hfp/dev/voicecall01"]
    call_id = next(iter(engine.sessions))
    bridge = engine.sessions[call_id].bridge
    assert bridge.can_sms and await bridge.send_sms("map link")
    assert ofono.texts == [("+919876543210", "map link")]
    await ofono.on_removed("/hfp/dev/voicecall01")  # caller hung up
    assert await wait_for(lambda: not engine.sessions)
    assert engine.store.calls.get(call_id).status == "ended"
    assert ofono.hung_up == []  # we don't hang up a call that's already gone


async def test_does_not_answer_if_you_picked_up(engine):
    gw, ofono = await make(engine)
    await ofono.on_added("/hfp/dev/voicecall01", "+919876543210", "incoming")
    await ofono.on_state("/hfp/dev/voicecall01", "active")  # you answered on the phone
    await asyncio.sleep(0.2)
    assert ofono.answered == [] and not engine.sessions


async def test_rejects_international_without_answering(engine):
    gw, ofono = await make(engine)
    await ofono.on_added("/hfp/dev/voicecall01", "+442079460000", "incoming")
    assert await wait_for(lambda: ofono.hung_up)
    assert ofono.answered == []
    assert engine.store.calls.list()[0].status == "rejected"


async def test_outbound_call_starts_when_answered(engine):
    from opencall.models import TaskKind

    gw, ofono = await make(engine)
    engine.dialer = gw
    task = await engine.tasks.create(TaskKind.enquire, "04023456789", "Ask if they are open on Sunday")
    assert ofono.dialled == ["+914023456789"]
    await ofono.on_state("/hfp/dev/voicecall01", "active")
    assert await wait_for(lambda: task.call_id in engine.sessions)
    assert engine.sessions[task.call_id].conv.outbound


async def test_the_line_is_up_while_a_phone_is_connected(engine):
    gw, ofono = await make(engine)
    status = await gw.status()
    assert (status.kind, status.ok, status.inbound, status.outbound) == ("bluetooth", True, True, True)
    assert status.detail == ("OnePlus 9 is connected over Bluetooth, so the assistant can answer its calls and "
                             "make calls for you.")
    ofono.phone = None  # the phone went out of range
    status = await gw.status()
    assert (status.ok, status.outbound, status.detail) == (False, False, NO_PHONE)


class NoDBus(FakeOfono):
    """What dbus-next does without a system D-Bus, as in Docker Desktop on Windows."""

    async def start(self, on_added, on_removed, on_state):
        raise FileNotFoundError(2, "No such file or directory")


async def test_bluetooth_that_cannot_start_does_not_stop_the_server(engine, monkeypatch, caplog):
    monkeypatch.setattr(bluetooth, "in_docker", lambda: True)
    gw = BluetoothGateway(engine, NoDBus(), open_audio=False)
    await gw.start()  # logged, not raised
    assert "The Bluetooth phone link couldn't start (FileNotFoundError" in caplog.text
    status = await gw.status()
    assert (status.kind, status.ok, status.inbound, status.outbound) == ("bluetooth", False, False, False)
    assert status.detail.startswith("Bluetooth calls are switched on, but the server runs in Docker")
    engine.dialer = gw
    task = await engine.tasks.create(TaskKind.enquire, "04023456789", "Ask if they are open on Sunday")
    assert task.status == TaskStatus.failed and task.result == status.detail


async def test_the_real_dbus_link_never_raises_at_start(engine):
    gw = BluetoothGateway(engine, DBusOfono(), open_audio=False)
    await gw.start()  # whatever this computer has (no D-Bus, no oFono, or both), the server starts
    assert (await gw.status()).kind == "bluetooth"


def test_health_shows_why_bluetooth_is_not_working(settings, engine, monkeypatch):
    monkeypatch.setattr(bluetooth, "in_docker", lambda: False)
    settings.bluetooth_enabled = True
    app = create_app(settings, engine, start_gateways=False)
    engine.dialer.ofono = NoDBus()
    with TestClient(app) as c:
        c.portal.call(engine.dialer.start)
        status = c.get("/health").json()["phone_line"]
    assert status["kind"] == "bluetooth" and not status["ok"]
    assert "couldn't reach this computer's Bluetooth phone service" in status["detail"]


def test_coords_from_google_maps_links():
    assert coords_from_text("https://www.google.com/maps/place/X/@17.41,78.43,17z/data=!3d17.4123!4d78.4356") == (17.4123, 78.4356)
    assert coords_from_text("https://www.google.com/maps/search/?api=1&query=17.4123,78.4356") == (17.4123, 78.4356)
    assert coords_from_text("https://maps.google.com/?q=17.4123%2C78.4356") == (17.4123, 78.4356)
    assert coords_from_text("geo:12.97,77.59") == (12.97, 77.59)
    assert coords_from_text("no coordinates") is None


async def test_a_phone_that_fails_to_attach_is_tried_again_without_stopping_the_link():
    from opencall.telephony.bluetooth import DBusOfono

    ofono = DBusOfono()
    ofono.attach_retry_s = 0
    tries = []

    async def attach(path, props, Variant):  # the phone's call service isn't up for the first two tries
        tries.append(path)
        if len(tries) < 3:
            raise RuntimeError("org.ofono.VoiceCallManager not found")
        ofono.modem_path = path

    ofono._attach = attach
    await ofono._attach_safely("/hfp/phone", {}, None)
    assert tries == ["/hfp/phone"] * 3 and ofono.modem_path == "/hfp/phone"

    tries.clear()
    ofono.modem_path = None

    async def never(path, props, Variant):
        tries.append(path)
        raise RuntimeError("gone")

    ofono._attach = never
    await ofono._attach_safely("/hfp/phone", {}, None)  # gives up quietly; the link keeps running
    assert len(tries) == 3 and ofono.modem_path is None

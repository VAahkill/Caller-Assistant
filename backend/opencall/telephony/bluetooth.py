"""Bluetooth bridge: your own phone, your own number, no extra cost.

The server pairs with your phone as a Bluetooth hands-free device, the same
way a car kit does. The phone then reports incoming calls to the server, lets
it answer, hang up and dial, and routes the call audio over Bluetooth. Nothing
to buy, no forwarding, no second number; it works with Android and iPhone.

Stack on the server (Linux, e.g. a home PC or Raspberry Pi with Bluetooth):
BlueZ + oFono (call control over D-Bus) + PipeWire (call audio, read and
written with pw-record / pw-play). See docs/TELEPHONY.md.

Limits: the phone has to stay within Bluetooth range of the server (home), and
call audio is narrowband (8 kHz CVSD or 16 kHz mSBC).

Where there is no oFono to talk to (no system D-Bus, as in Docker Desktop on
Windows), the server still starts: the gateway logs why and reports it as the
line's status.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import re
from pathlib import Path
from typing import TYPE_CHECKING, Any, Protocol

from ..audio import FRAME_BYTES
from ..models import new_id
from .base import LineStatus, PhoneLineError
from .queue_bridge import QueueBridge

if TYPE_CHECKING:
    from ..engine import Engine

log = logging.getLogger("opencall.bluetooth")


# ----------------------------------------------------------------- oFono access
class Ofono(Protocol):
    """The handful of oFono operations the gateway needs (fakeable in tests)."""

    async def start(self, on_call_added, on_call_removed, on_call_state) -> None: ...

    async def answer(self, call_path: str) -> None: ...

    async def hangup(self, call_path: str) -> None: ...

    async def dial(self, number: str) -> str: ...

    async def send_sms(self, number: str, text: str) -> bool: ...

    async def connected_phone(self) -> str | None:
        """The name of the phone connected as a hands-free device ("" if it has
        none), or None when no phone is connected."""


def build_bmessage(number: str, text: str) -> str:
    """An SMS in the Bluetooth MAP bMessage format."""
    body = "BEGIN:MSG\r\n" + text.replace("\r\n", "\n").replace("\n", "\r\n") + "\r\nEND:MSG\r\n"
    return (
        "BEGIN:BMSG\r\nVERSION:1.0\r\nSTATUS:UNREAD\r\nTYPE:SMS_GSM\r\nFOLDER:telecom/msg/outbox\r\n"
        "BEGIN:BENV\r\nBEGIN:VCARD\r\nVERSION:2.1\r\n"
        f"TEL:{number}\r\nEND:VCARD\r\n"
        "BEGIN:BBODY\r\nCHARSET:UTF-8\r\n"
        f"LENGTH:{len(body.encode())}\r\n{body}"
        "END:BBODY\r\nEND:BENV\r\nEND:BMSG\r\n"
    )


class DBusOfono:
    """oFono over the system D-Bus, using dbus-next (pure Python)."""

    attach_retry_s = 2.0

    def __init__(self) -> None:
        self.bus = None
        self.modem_path: str | None = None
        self._cb: tuple = ()

    async def _iface(self, path: str, name: str):
        intro = await self.bus.introspect("org.ofono", path)
        return self.bus.get_proxy_object("org.ofono", path, intro).get_interface(name)

    async def start(self, on_call_added, on_call_removed, on_call_state) -> None:
        from dbus_next import BusType, Variant
        from dbus_next.aio import MessageBus

        self._cb = (on_call_added, on_call_removed, on_call_state)
        self.bus = await MessageBus(bus_type=BusType.SYSTEM).connect()
        manager = await self._iface("/", "org.ofono.Manager")
        manager.on_modem_added(lambda path, props: asyncio.ensure_future(self._attach_safely(path, props, Variant)))
        manager.on_modem_removed(self._detach)
        for path, props in await manager.call_get_modems():
            await self._attach_safely(path, props, Variant)
        if not self.modem_path:
            log.warning("No Bluetooth phone found yet. Pair and connect your phone; it will be picked up automatically.")

    async def _attach_safely(self, path: str, props: dict[str, Any], Variant) -> None:
        """A phone that fails to attach is logged and tried again, without stopping the link:
        its call service can show up a few seconds after the modem powers on."""
        for attempt in range(1, 4):
            try:
                await self._attach(path, props, Variant)
                return
            except Exception as e:
                log.warning("Couldn't attach the Bluetooth phone %s (try %d of 3): %s: %s",
                            path, attempt, e.__class__.__name__, e)
                await asyncio.sleep(self.attach_retry_s)

    async def _attach(self, path: str, props: dict[str, Any], Variant) -> None:
        if _val(props.get("Type")) != "hfp":
            return
        modem = await self._iface(path, "org.ofono.Modem")
        if not _val(props.get("Powered")):
            await modem.call_set_property("Powered", Variant("b", True))
            await asyncio.sleep(1)  # VoiceCallManager appears once the modem is up
        vcm = await self._iface(path, "org.ofono.VoiceCallManager")
        on_added, on_removed, _ = self._cb
        vcm.on_call_added(lambda call_path, call_props: asyncio.ensure_future(self._call_added(call_path, call_props)))
        vcm.on_call_removed(lambda call_path: asyncio.ensure_future(on_removed(call_path)))
        self.modem_path = path
        log.info("Using phone %s (%s)", _val(props.get("Name")) or path, path)

    def _detach(self, path: str) -> None:
        if path == self.modem_path:
            self.modem_path = None
            log.info("The Bluetooth phone disconnected (%s)", path)

    async def connected_phone(self) -> str | None:
        """The name of the phone whose calls the link handles ("" if it has none), or None."""
        if self.bus is None or self.modem_path is None:
            return None
        manager = await self._iface("/", "org.ofono.Manager")
        for path, props in await manager.call_get_modems():
            if path == self.modem_path and _val(props.get("Powered")):
                return _val(props.get("Name")) or ""
        return None

    async def _call_added(self, call_path: str, props: dict[str, Any]) -> None:
        on_added, _, on_state = self._cb
        call = await self._iface(call_path, "org.ofono.VoiceCall")
        call.on_property_changed(
            lambda name, value: asyncio.ensure_future(on_state(call_path, _val(value))) if name == "State" else None
        )
        await on_added(call_path, _val(props.get("LineIdentification")) or "", _val(props.get("State")) or "")

    async def answer(self, call_path: str) -> None:
        await (await self._iface(call_path, "org.ofono.VoiceCall")).call_answer()

    async def hangup(self, call_path: str) -> None:
        with contextlib.suppress(Exception):
            await (await self._iface(call_path, "org.ofono.VoiceCall")).call_hangup()

    async def dial(self, number: str) -> str:
        if not self.modem_path:
            raise PhoneLineError(NO_PHONE)
        try:
            vcm = await self._iface(self.modem_path, "org.ofono.VoiceCallManager")
            return await vcm.call_dial(number, "default")
        except Exception as e:
            log.warning("The phone didn't dial %s: %s: %s", number, e.__class__.__name__, e)
            raise PhoneLineError("Your phone didn't start the call. Check that it has signal and is still connected "
                                 "to this computer over Bluetooth.") from e

    async def send_sms(self, number: str, text: str) -> bool:
        """Sends an SMS through the phone with the Bluetooth Message Access
        Profile (BlueZ obexd on the session bus). Android supports this once you
        allow "message access" for the paired computer; iPhones generally don't."""
        import os
        import tempfile

        from dbus_next import Variant
        from dbus_next.aio import MessageBus

        m = re.search(r"dev_([0-9A-Fa-f]{2}(?:_[0-9A-Fa-f]{2}){5})", self.modem_path or "")
        if not m:
            return False
        address = m.group(1).replace("_", ":")
        bus = await MessageBus().connect()  # obexd lives on the user's session bus
        path = ""
        tmp = tempfile.NamedTemporaryFile("w", suffix=".bmsg", delete=False, newline="")
        try:
            tmp.write(build_bmessage(number, text))
            tmp.close()
            intro = await bus.introspect("org.bluez.obex", "/org/bluez/obex")
            client = bus.get_proxy_object("org.bluez.obex", "/org/bluez/obex", intro).get_interface("org.bluez.obex.Client1")
            path = await client.call_create_session(address, {"Target": Variant("s", "map")})
            intro = await bus.introspect("org.bluez.obex", path)
            mas = bus.get_proxy_object("org.bluez.obex", path, intro).get_interface("org.bluez.obex.MessageAccess1")
            await mas.call_set_folder("telecom/msg")
            await mas.call_push_message(tmp.name, "outbox", {"Charset": Variant("s", "utf8")})
            await asyncio.sleep(2)  # let the transfer finish before closing the session
            return True
        except Exception as e:
            log.warning("Bluetooth SMS failed: %s", e)
            return False
        finally:
            if path:
                with contextlib.suppress(Exception):
                    await client.call_remove_session(path)
            os.unlink(tmp.name)
            bus.disconnect()


def _val(v: Any) -> Any:
    return getattr(v, "value", v)


NO_PHONE = ("Bluetooth calls are switched on, but no phone is connected yet. Pair your phone with this computer "
            "and connect it in the phone's Bluetooth settings.")


def in_docker() -> bool:
    return Path("/.dockerenv").exists()


def start_problem(error: Exception) -> str:
    """Why the Bluetooth link couldn't start, for the user."""
    if in_docker():
        return ("Bluetooth calls are switched on, but the server runs in Docker, which can't use this computer's "
                "Bluetooth. The Bluetooth link needs the server running directly on a Linux computer.")
    if isinstance(error, ImportError):
        return "Bluetooth calls are switched on, but this server was installed without its Bluetooth support."
    return ("Bluetooth calls are switched on, but the server couldn't reach this computer's Bluetooth phone "
            "service. Check that Bluetooth and the hands-free service are running, then restart the server.")


# ----------------------------------------------------------------- call audio
async def find_node(match: str) -> str:
    """Name of the first PipeWire node whose name contains ``match``."""
    proc = await asyncio.create_subprocess_exec(
        "pw-cli", "ls", "Node", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
    )
    out, _ = await proc.communicate()
    for name in re.findall(r'node\.name = "([^"]+)"', out.decode(errors="ignore")):
        if match in name:
            return name
    return ""


class HFPBridge(QueueBridge):
    """Moves call audio between PipeWire's Bluetooth nodes and the engine."""

    def __init__(self, gateway: "BluetoothGateway", call_path: str, call_id: str, number: str, direction: str):
        super().__init__(call_id, number, direction)
        self.gateway = gateway
        self.call_path = call_path
        self._rec: asyncio.subprocess.Process | None = None
        self._play: asyncio.subprocess.Process | None = None
        self._reader: asyncio.Task | None = None
        self.can_sms = gateway.engine.settings.bluetooth_sms and bool(number)

    async def send_sms(self, text: str) -> bool:
        return await self.gateway.ofono.send_sms(self.number, text)

    async def open_audio(self, source: str, sink: str) -> None:
        fmt = ["--rate", "16000", "--channels", "1", "--format", "s16"]
        self._rec = await asyncio.create_subprocess_exec(
            "pw-record", "--target", source, *fmt, "-", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
        )
        self._play = await asyncio.create_subprocess_exec(
            "pw-play", "--target", sink, *fmt, "-", stdin=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL
        )
        self._reader = asyncio.create_task(self._read())

    async def _read(self) -> None:
        assert self._rec and self._rec.stdout
        while True:
            chunk = await self._rec.stdout.read(FRAME_BYTES)
            if not chunk:
                break
            self.feed(chunk)

    async def send_audio(self, frame: bytes) -> None:
        if self._play and self._play.stdin and not self._play.stdin.is_closing():
            with contextlib.suppress(ConnectionError):
                self._play.stdin.write(frame)
                await self._play.stdin.drain()

    async def hangup(self) -> None:
        if not self.hung_up.is_set():
            await self.gateway.ofono.hangup(self.call_path)
        await self.close()

    async def close(self) -> None:
        for p in (self._rec, self._play):
            if p and p.returncode is None:
                with contextlib.suppress(ProcessLookupError):
                    p.kill()
        if self._reader:
            self._reader.cancel()
        self.hung_up.set()
        self.close_input()


# ----------------------------------------------------------------- gateway
class BluetoothGateway:
    name = "bluetooth"

    def __init__(self, engine: "Engine", ofono: Ofono | None = None, open_audio: bool = True):
        self.engine = engine
        self.ofono: Ofono = ofono or DBusOfono()
        self.open_audio = open_audio
        self.calls: dict[str, HFPBridge] = {}  # call path -> live bridge
        self.states: dict[str, str] = {}
        self.numbers: dict[str, str] = {}
        self.outbound: dict[str, str] = {}  # call path -> call_id we dialled
        self._tasks: set[asyncio.Task] = set()
        self.problem = ""  # why the link couldn't start, for the user

    async def start(self) -> None:
        try:
            await self.ofono.start(self._on_added, self._on_removed, self._on_state)
        except Exception as e:
            self.problem = start_problem(e)
            log.error("The Bluetooth phone link couldn't start (%s: %s). Calls won't reach the assistant over "
                      "Bluetooth until BlueZ and oFono run on this computer and the server is restarted; see "
                      "docs/TELEPHONY.md.", e.__class__.__name__, e)

    async def status(self, fresh: bool = False) -> LineStatus:
        if self.problem:
            return LineStatus("bluetooth", ok=False, inbound=False, outbound=False, detail=self.problem)
        try:
            phone = await asyncio.wait_for(self.ofono.connected_phone(), 2)
        except Exception as e:
            log.warning("Couldn't ask oFono which phone is connected: %s: %s", e.__class__.__name__, e)
            return LineStatus("bluetooth", ok=False, inbound=False, outbound=False,
                              detail="The server couldn't ask this computer's Bluetooth which phone is connected.")
        if phone is None:
            return LineStatus("bluetooth", ok=False, inbound=False, outbound=False, detail=NO_PHONE)
        return LineStatus("bluetooth", ok=True, inbound=True, outbound=True,
                          detail=f"{phone or 'Your phone'} is connected over Bluetooth, so the assistant can answer "
                                 "its calls and make calls for you.")

    def _spawn(self, coro) -> None:
        t = asyncio.create_task(coro)
        self._tasks.add(t)
        t.add_done_callback(self._tasks.discard)

    async def _on_added(self, path: str, number: str, state: str) -> None:
        self.states[path] = state
        self.numbers[path] = number
        if state in ("incoming", "waiting"):
            self._spawn(self._incoming(path, number))

    async def _on_state(self, path: str, state: str) -> None:
        self.states[path] = state
        if state == "active" and path in self.outbound and path not in self.calls:
            self._spawn(self._connect(path, self.outbound.pop(path), self.numbers.get(path, ""), "outbound"))
        if state == "disconnected":
            await self._on_removed(path)

    async def _on_removed(self, path: str) -> None:
        self.states.pop(path, None)
        bridge = self.calls.pop(path, None)
        if bridge:
            await bridge.close()  # the far end hung up; don't send another hangup

    async def _incoming(self, path: str, number: str) -> None:
        decision = self.engine.screen(number)
        if not decision.answer:
            await self.engine.record_rejected(number, decision)
            await self.ofono.hangup(path)
            return
        # Let the phone ring so you can pick up yourself; answer if you don't.
        delay = self.engine.settings.bluetooth_answer_delay_s
        if self.engine.store.profile.available:
            delay = max(delay, self.engine.settings.bluetooth_answer_delay_available_s)
        await asyncio.sleep(delay)
        if self.states.get(path) not in ("incoming", "waiting"):
            return  # you answered it, or the caller gave up
        await self.ofono.answer(path)
        await self._connect(path, new_id(), number, "inbound")

    async def _connect(self, path: str, call_id: str, number: str, direction: str) -> None:
        bridge = HFPBridge(self, path, call_id, number, direction)
        self.calls[path] = bridge
        if self.open_audio:
            s = self.engine.settings
            source = s.bluetooth_source or await find_node("bluez_input")
            sink = s.bluetooth_sink or await find_node("bluez_output")
            if not source or not sink:
                log.error("Bluetooth call audio nodes not found; is PipeWire running with oFono support?")
            await bridge.open_audio(source, sink)
        try:
            await self.engine.handle_call(bridge)
        finally:
            self.calls.pop(path, None)

    async def dial(self, number: str, call_id: str) -> None:
        if self.problem:
            raise PhoneLineError(self.problem)
        path = await self.ofono.dial(number)
        self.numbers[path] = number
        self.outbound[path] = call_id
        if self.states.get(path) == "active":  # answered before we stored the path
            self._spawn(self._connect(path, self.outbound.pop(path), number, "outbound"))

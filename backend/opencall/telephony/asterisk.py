"""Asterisk / FreePBX bridge (open source, self-hosted).

Inbound: the carrier forwards calls to a SIP number that lands on Asterisk. The
dialplan asks this server whether to answer (``/telephony/asterisk/screen``),
then hands the call audio to us with the AudioSocket application:

    exten => _X.,1,Set(OC=${CURL(http://opencall:8000/telephony/asterisk/screen?uuid=${UUID()}...)})

See deploy/asterisk/extensions.conf for the full dialplan.

Outbound: we ask Asterisk's REST interface (ARI) to originate a call; when it is
answered the dialplan runs AudioSocket with the UUID we generated. Whether ARI
answers (and accepts the login) is the line's status; it is checked at most every
15 s, so GET /health stays quick.

AudioSocket wire format: 1 byte type, 2 byte big-endian length, payload.
Types: 0x00 hangup, 0x01 UUID, 0x03 DTMF, 0x10 audio (8 kHz signed 16-bit LE), 0xff error.
"""

from __future__ import annotations

import asyncio
import logging
import struct
import time
import uuid
from typing import TYPE_CHECKING
from urllib.parse import urlparse

import httpx

from ..audio import resample
from .ami import ami_command, sms_command
from .base import NO_LINE, LineStatus, PhoneLineError
from .queue_bridge import QueueBridge

if TYPE_CHECKING:
    from ..engine import Engine

log = logging.getLogger("opencall.asterisk")

KIND_HANGUP, KIND_UUID, KIND_DTMF, KIND_AUDIO, KIND_ERROR = 0x00, 0x01, 0x03, 0x10, 0xFF
STATUS_TTL_S = 15.0


class AudioSocketBridge(QueueBridge):
    def __init__(self, call_id: str, number: str, direction: str, writer: asyncio.StreamWriter,
                 gateway: "AsteriskGateway | None" = None):
        super().__init__(call_id, number, direction)
        self.writer = writer
        self.gateway = gateway
        self.can_sms = bool(gateway and gateway.sms_enabled and number)

    async def send_sms(self, text: str) -> bool:
        return await self.gateway.send_sms(self.number, text) if self.gateway else False

    async def send_audio(self, frame: bytes) -> None:
        pcm8k = resample(frame, 16000, 8000)
        try:
            self.writer.write(struct.pack(">BH", KIND_AUDIO, len(pcm8k)) + pcm8k)
            await self.writer.drain()
        except (ConnectionError, RuntimeError):
            await super().hangup()

    async def hangup(self) -> None:
        if not self.hung_up.is_set():
            try:
                self.writer.write(struct.pack(">BH", KIND_HANGUP, 0))
                await self.writer.drain()
            except (ConnectionError, RuntimeError):
                pass
        await super().hangup()


class AsteriskGateway:
    """Runs the AudioSocket TCP server and the ARI dialer."""

    name = "asterisk"

    def __init__(self, engine: "Engine"):
        self.engine = engine
        s = engine.settings
        self.port = s.asterisk_audiosocket_port
        # uuid -> (number, direction, call_id); filled by the screen webhook or dial().
        self.expected: dict[str, tuple[str, str, str]] = {}
        self._server: asyncio.base_events.Server | None = None
        self.transport: httpx.AsyncBaseTransport | None = None  # tests swap in httpx.MockTransport
        self._status: LineStatus | None = None
        self._status_at = 0.0
        self._status_lock = asyncio.Lock()

    @property
    def sms_enabled(self) -> bool:
        return bool(self.engine.settings.asterisk_ami_user)

    async def send_sms(self, number: str, text: str) -> bool:
        s = self.engine.settings
        return await ami_command(s.asterisk_ami_host, s.asterisk_ami_port, s.asterisk_ami_user,
                                 s.asterisk_ami_password, sms_command(s.asterisk_sms_command, number, text))

    # --------------------------------------------------- inbound screening
    async def screen(self, call_uuid: str, number: str) -> str:
        decision = self.engine.screen(number)
        if not decision.answer:
            await self.engine.record_rejected(number, decision)
            return "reject"
        self.expected[call_uuid.lower()] = (number, "inbound", uuid.UUID(call_uuid).hex[:12])
        return "answer"

    # --------------------------------------------------- line status
    def _client(self, timeout: float) -> httpx.AsyncClient:
        s = self.engine.settings
        return httpx.AsyncClient(timeout=timeout, auth=(s.asterisk_ari_user, s.asterisk_ari_password),
                                 transport=self.transport)

    def _where(self) -> str:
        """Where ARI is expected, as host:port (without any login in the URL)."""
        url = urlparse(self.engine.settings.asterisk_ari_url)
        return url.netloc.rsplit("@", 1)[-1] or self.engine.settings.asterisk_ari_url

    # What the owner reads (the app shows it); setting names go to the log instead.
    def _unreachable(self) -> str:
        return ("No phone line is connected. Your server's settings point to a SIM modem line, but nothing "
                "answers there. If you haven't set up a modem, that's expected.")

    def _bad_login(self) -> str:
        log.warning("Asterisk at %s refused the ARI login: OPENCALL_ASTERISK_ARI_USER and "
                    "OPENCALL_ASTERISK_ARI_PASSWORD in .env must match ari.conf", self._where())
        return ("Your SIM modem's phone software didn't accept the server's password. The phone line guide "
                "shows where the two passwords are set; they must be the same.")

    def _not_ari(self) -> str:
        log.warning("Something answers at %s but it isn't ARI: OPENCALL_ASTERISK_ARI_URL usually ends in /ari",
                    self._where())
        return ("Something answers at the address your server has for its SIM modem line, but it isn't the "
                "modem's phone software. Check that address with the phone line guide.")

    def _line(self, ok: bool, detail: str) -> LineStatus:
        inbound = ok and self.engine.settings.asterisk_enabled
        return LineStatus("gsm", ok=ok, inbound=inbound, outbound=ok, detail=detail)

    async def status(self, fresh: bool = False) -> LineStatus:
        async with self._status_lock:  # callers arriving during a check share it
            if not fresh and self._status and time.monotonic() - self._status_at < STATUS_TTL_S:
                return self._status
            self._status = await self._check()
            self._status_at = time.monotonic()
            return self._status

    async def _check(self) -> LineStatus:
        s = self.engine.settings
        if not s.asterisk_ari_url:
            return self._line(False, NO_LINE)
        try:
            async with self._client(2.0) as client:
                r = await client.get(f"{s.asterisk_ari_url.rstrip('/')}/asterisk/info")
        except httpx.HTTPError as e:
            log.info("Asterisk ARI at %s doesn't answer (%s: %s)", s.asterisk_ari_url, e.__class__.__name__, e)
            return self._line(False, self._unreachable())
        if r.status_code in (401, 403):
            return self._line(False, self._bad_login())
        if not r.is_success:
            log.info("Asterisk ARI at %s answered %s: %s", s.asterisk_ari_url, r.status_code, r.text[:200])
            return self._line(False, self._not_ari())
        # ARI answering shows Asterisk runs, not that the modem has signal; only a call shows that.
        return self._line(True, "Your SIM modem's phone software is running. If calls still don't come "
                                "through, check that the modem is plugged in and its SIM has signal.")

    def _failed(self, detail: str) -> PhoneLineError:
        """The line failed while dialling: remember it (so /health shows it) and say why."""
        self._status, self._status_at = self._line(False, detail), time.monotonic()
        return PhoneLineError(detail)

    # --------------------------------------------------- outbound
    async def dial(self, number: str, call_id: str) -> None:
        s = self.engine.settings
        if not s.asterisk_ari_url:
            raise PhoneLineError(NO_LINE)
        call_uuid = str(uuid.uuid4())
        self.expected[call_uuid] = (number, "outbound", call_id)
        try:
            async with self._client(15) as client:
                r = await client.post(
                    f"{s.asterisk_ari_url.rstrip('/')}/channels",
                    params={
                        "endpoint": s.asterisk_outbound_endpoint.format(number=number.lstrip("+")),
                        "context": s.asterisk_outbound_context,
                        "extension": "s",
                        "priority": 1,
                        "timeout": 40,
                    },
                    json={"variables": {"OPENCALL_UUID": call_uuid}},
                )
        except httpx.HTTPError as e:
            self.expected.pop(call_uuid, None)
            log.warning("Asterisk ARI at %s doesn't answer (%s: %s)", s.asterisk_ari_url, e.__class__.__name__, e)
            raise self._failed(self._unreachable()) from e
        if r.is_success:
            return
        self.expected.pop(call_uuid, None)
        log.warning("Asterisk refused the call to %s: %s %s", number, r.status_code, r.text[:200])
        if r.status_code in (401, 403):
            raise self._failed(self._bad_login())
        if r.status_code == 404:
            raise self._failed(self._not_ari())
        # Asterisk is there, but the channel couldn't be made: the modem is missing or
        # has no network (or OPENCALL_ASTERISK_OUTBOUND_ENDPOINT names no device).
        raise PhoneLineError("The SIM modem couldn't start the call. Check that the modem is plugged in and its "
                             "SIM has signal.")

    # --------------------------------------------------- audio socket server
    async def start(self) -> None:
        self._server = await asyncio.start_server(self._on_connect, "0.0.0.0", self.port)
        log.info("AudioSocket listening on :%s", self.port)

    async def stop(self) -> None:
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    async def _on_connect(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        try:
            kind, payload = await _read_msg(reader)
            if kind != KIND_UUID or len(payload) != 16:
                writer.close()
                return
            call_uuid = str(uuid.UUID(bytes=payload))
            number, direction, call_id = self.expected.pop(call_uuid, ("", "inbound", uuid.UUID(call_uuid).hex[:12]))
            bridge = AudioSocketBridge(call_id, number, direction, writer, self)
            pump = asyncio.create_task(self._pump(reader, bridge))
            await self.engine.handle_call(bridge)
            pump.cancel()
        except Exception:
            log.exception("audiosocket connection failed")
        finally:
            writer.close()

    async def _pump(self, reader: asyncio.StreamReader, bridge: AudioSocketBridge) -> None:
        try:
            while True:
                kind, payload = await _read_msg(reader)
                if kind == KIND_AUDIO:
                    bridge.feed(resample(payload, 8000, 16000))
                elif kind in (KIND_HANGUP, KIND_ERROR):
                    break
        except (asyncio.IncompleteReadError, ConnectionError):
            pass
        bridge.hung_up.set()
        bridge.close_input()


async def _read_msg(reader: asyncio.StreamReader) -> tuple[int, bytes]:
    header = await reader.readexactly(3)
    kind, length = struct.unpack(">BH", header)
    payload = await reader.readexactly(length) if length else b""
    return kind, payload

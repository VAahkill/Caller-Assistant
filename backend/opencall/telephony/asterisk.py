"""Asterisk / FreePBX bridge (open source, self-hosted).

Inbound: the carrier forwards calls to a SIP number that lands on Asterisk. The
dialplan asks this server whether to answer (``/telephony/asterisk/screen``),
then hands the call audio to us with the AudioSocket application:

    exten => _X.,1,Set(OC=${CURL(http://opencall:8000/telephony/asterisk/screen?uuid=${UUID()}...)})

See deploy/asterisk/extensions.conf for the full dialplan.

Outbound: we ask Asterisk's REST interface (ARI) to originate a call; when it is
answered the dialplan runs AudioSocket with the UUID we generated.

AudioSocket wire format: 1 byte type, 2 byte big-endian length, payload.
Types: 0x00 hangup, 0x01 UUID, 0x03 DTMF, 0x10 audio (8 kHz signed 16-bit LE), 0xff error.
"""

from __future__ import annotations

import asyncio
import logging
import struct
import uuid
from typing import TYPE_CHECKING

import httpx

from ..audio import resample
from .ami import ami_command, sms_command
from .queue_bridge import QueueBridge

if TYPE_CHECKING:
    from ..engine import Engine

log = logging.getLogger("opencall.asterisk")

KIND_HANGUP, KIND_UUID, KIND_DTMF, KIND_AUDIO, KIND_ERROR = 0x00, 0x01, 0x03, 0x10, 0xFF


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

    # --------------------------------------------------- outbound
    async def dial(self, number: str, call_id: str) -> None:
        s = self.engine.settings
        if not s.asterisk_ari_url:
            raise RuntimeError("OPENCALL_ASTERISK_ARI_URL is not set")
        call_uuid = str(uuid.uuid4())
        self.expected[call_uuid] = (number, "outbound", call_id)
        async with httpx.AsyncClient(timeout=15, auth=(s.asterisk_ari_user, s.asterisk_ari_password)) as client:
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
            r.raise_for_status()

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

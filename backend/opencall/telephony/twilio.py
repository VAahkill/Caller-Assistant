"""Twilio bridge (paid after trial credit, but the quickest to set up).

Inbound: point the Twilio number's voice webhook at /telephony/twilio/voice and
forward your mobile's unanswered calls to that number. Twilio streams the call
audio over a websocket (Media Streams) to /telephony/twilio/stream.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
from typing import TYPE_CHECKING
from xml.sax.saxutils import quoteattr

import httpx
from fastapi import WebSocket

from ..models import new_id
from ..audio import mulaw_decode, mulaw_encode, resample
from .queue_bridge import QueueBridge

if TYPE_CHECKING:
    from ..engine import Engine

log = logging.getLogger("opencall.twilio")
API = "https://api.twilio.com/2010-04-01"


def valid_signature(auth_token: str, url: str, params: dict[str, str], signature: str) -> bool:
    data = url + "".join(k + params[k] for k in sorted(params))
    digest = base64.b64encode(hmac.new(auth_token.encode(), data.encode(), hashlib.sha1).digest()).decode()
    return hmac.compare_digest(digest, signature or "")


def stream_twiml(ws_url: str, params: dict[str, str]) -> str:
    p = "".join(f"<Parameter name={quoteattr(k)} value={quoteattr(v)}/>" for k, v in params.items())
    return f"<?xml version=\"1.0\" encoding=\"UTF-8\"?><Response><Connect><Stream url={quoteattr(ws_url)}>{p}</Stream></Connect></Response>"


def reject_twiml() -> str:
    return '<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected"/></Response>'


class TwilioBridge(QueueBridge):
    def __init__(self, ws: WebSocket, gateway: "TwilioGateway", call_id: str, number: str, direction: str, stream_sid: str, call_sid: str):
        super().__init__(call_id, number, direction)
        self.ws = ws
        self.gateway = gateway
        self.stream_sid = stream_sid
        self.call_sid = call_sid

    async def send_audio(self, frame: bytes) -> None:
        payload = base64.b64encode(mulaw_encode(resample(frame, 16000, 8000))).decode()
        try:
            await self.ws.send_text(json.dumps({"event": "media", "streamSid": self.stream_sid, "media": {"payload": payload}}))
        except Exception:
            await super().hangup()

    async def clear_audio(self) -> None:
        try:
            await self.ws.send_text(json.dumps({"event": "clear", "streamSid": self.stream_sid}))
        except Exception:
            pass

    async def hangup(self) -> None:
        if not self.hung_up.is_set():
            await self.gateway.end_call(self.call_sid)
        await super().hangup()

    async def send_sms(self, text: str) -> bool:
        return await self.gateway.send_sms(self.number, text)


class TwilioGateway:
    name = "twilio"

    def __init__(self, engine: "Engine"):
        self.engine = engine
        s = engine.settings
        self.sid, self.token, self.from_number = s.twilio_account_sid, s.twilio_auth_token, s.twilio_from_number

    @property
    def ws_url(self) -> str:
        base = self.engine.settings.public_url.rstrip("/").replace("https://", "wss://").replace("http://", "ws://")
        return f"{base}/telephony/twilio/stream"

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=15, auth=(self.sid, self.token))

    async def inbound_twiml(self, form: dict[str, str]) -> str:
        number = form.get("From", "")  # the original caller, also on forwarded calls
        decision = self.engine.screen(number)
        if not decision.answer:
            await self.engine.record_rejected(number, decision)
            return reject_twiml()
        return stream_twiml(self.ws_url, {"number": number, "direction": "inbound"})

    async def dial(self, number: str, call_id: str) -> None:
        twiml = stream_twiml(self.ws_url, {"number": number, "direction": "outbound", "call_id": call_id})
        async with self._client() as c:
            r = await c.post(f"{API}/Accounts/{self.sid}/Calls.json",
                             data={"To": number, "From": self.from_number, "Twiml": twiml})
            r.raise_for_status()

    async def end_call(self, call_sid: str) -> None:
        if not call_sid:
            return
        try:
            async with self._client() as c:
                await c.post(f"{API}/Accounts/{self.sid}/Calls/{call_sid}.json", data={"Status": "completed"})
        except httpx.HTTPError as e:
            log.warning("could not end call: %s", e)

    async def send_sms(self, to: str, body: str) -> bool:
        try:
            async with self._client() as c:
                r = await c.post(f"{API}/Accounts/{self.sid}/Messages.json",
                                 data={"To": to, "From": self.from_number, "Body": body})
                return r.is_success
        except httpx.HTTPError:
            return False

    async def handle_stream(self, ws: WebSocket) -> None:
        """Serve one Twilio Media Streams websocket."""
        await ws.accept()
        bridge: TwilioBridge | None = None
        call_task: asyncio.Task | None = None
        try:
            while True:
                msg = json.loads(await ws.receive_text())
                ev = msg.get("event")
                if ev == "start":
                    start = msg["start"]
                    params = start.get("customParameters", {})
                    bridge = TwilioBridge(ws, self, params.get("call_id") or new_id(), params.get("number", ""),
                                          params.get("direction", "inbound"), start["streamSid"], start.get("callSid", ""))
                    call_task = asyncio.create_task(self.engine.handle_call(bridge))
                elif ev == "media" and bridge:
                    bridge.feed(resample(mulaw_decode(base64.b64decode(msg["media"]["payload"])), 8000, 16000))
                elif ev == "stop":
                    break
        except Exception:
            pass
        finally:
            if bridge:
                bridge.hung_up.set()
                bridge.close_input()
            if call_task:
                await call_task

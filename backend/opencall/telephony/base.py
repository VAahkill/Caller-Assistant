"""The swappable phone layer.

A *bridge* carries one live call's audio between a phone network and the call
engine. Each telephony backend (Asterisk AudioSocket, Twilio Media Streams, the
in-app simulator) implements ``CallBridge``; nothing else in the engine knows
which one is in use. Audio crossing this boundary is always 16 kHz mono PCM16
in 20 ms frames; bridges convert from 8 kHz slin or mu-law themselves.

A *dialer* places outbound calls. When the callee answers, the backend opens a
bridge for the new call and hands it to the engine exactly like an inbound call.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from typing import Protocol


class CallBridge(Protocol):
    call_id: str
    number: str
    direction: str  # "inbound" | "outbound"

    def audio_in(self) -> AsyncIterator[bytes]: ...

    async def send_audio(self, frame: bytes) -> None: ...

    async def clear_audio(self) -> None:
        """Drop any audio already queued on the far side (barge-in)."""

    async def hangup(self) -> None: ...

    async def send_sms(self, text: str) -> bool:
        """Text the other party (e.g. a map link). Returns False if unsupported."""


class Dialer(Protocol):
    name: str

    async def dial(self, number: str, call_id: str) -> None: ...


class NoDialer:
    name = "none"

    async def dial(self, number: str, call_id: str) -> None:
        raise RuntimeError(
            "No outbound telephony is configured. Set up Asterisk ARI or Twilio (see docs/TELEPHONY.md)."
        )

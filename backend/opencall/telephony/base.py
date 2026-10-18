"""The swappable phone layer.

A *bridge* carries one live call's audio between a phone network and the call
engine. Each telephony backend (Asterisk AudioSocket, Twilio Media Streams, the
in-app simulator) implements ``CallBridge``; nothing else in the engine knows
which one is in use. Audio crossing this boundary is always 16 kHz mono PCM16
in 20 ms frames; bridges convert from 8 kHz slin or mu-law themselves.

A *dialer* places outbound calls. When the callee answers, the backend opens a
bridge for the new call and hands it to the engine exactly like an inbound call.
It also says whether its phone line works (``status``, shown by GET /health), and
raises ``PhoneLineError`` with a plain reason when a call can't be placed.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from dataclasses import asdict, dataclass
from typing import Protocol

log = logging.getLogger("opencall.telephony")

NO_LINE = ("No phone line is set up on your server yet, so it can't answer your real calls or make calls "
           "for you. Practice calls in the app work without one.")


class PhoneLineError(RuntimeError):
    """A call couldn't be placed for a known reason. The message says why in plain
    words: the app shows it to the user."""


@dataclass
class LineStatus:
    """What the server found about its phone line. ``ok``: a line is connected and
    can carry calls now; ``inbound``: real calls can reach the assistant;
    ``outbound``: "Call for me" can place real calls; ``detail``: one or two
    sentences for the user (never a password or token)."""

    kind: str  # bluetooth | gsm | twilio | none
    ok: bool
    inbound: bool
    outbound: bool
    detail: str

    def to_json(self) -> dict:
        return asdict(self)


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

    async def dial(self, number: str, call_id: str) -> None:
        """Starts the call; raises PhoneLineError when the line can't place it."""

    async def status(self, fresh: bool = False) -> LineStatus:
        """The line's state. ``fresh``: check now rather than trust a recent check."""


class NoDialer:
    name = "none"

    async def dial(self, number: str, call_id: str) -> None:
        raise PhoneLineError(NO_LINE)

    async def status(self, fresh: bool = False) -> LineStatus:
        return LineStatus("none", ok=False, inbound=False, outbound=False, detail=NO_LINE)


async def line_status(dialer: Dialer, fresh: bool = False) -> LineStatus:
    """The phone line's state, for GET /health and before "Call for me" dials."""
    kind = {"asterisk": "gsm"}.get(dialer.name, dialer.name)
    status = getattr(dialer, "status", None)
    if status is None:  # a dialer that can't tell (the tests' fakes): trust it
        return LineStatus(kind, ok=True, inbound=True, outbound=True, detail="")
    try:
        return await status(fresh)
    except Exception as e:
        log.warning("Couldn't check the phone line (%s): %s: %s", dialer.name, e.__class__.__name__, e)
        return LineStatus(kind, ok=False, inbound=False, outbound=False,
                          detail="The server couldn't check its phone line. Its log says why.")

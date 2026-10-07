"""A bridge backed by an in-memory queue; the transport-specific bridges and the
tests build on it."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator

from ..audio import FRAME_BYTES


class QueueBridge:
    def __init__(self, call_id: str, number: str, direction: str = "inbound"):
        self.call_id = call_id
        self.number = number
        self.direction = direction
        self.inbound: asyncio.Queue[bytes | None] = asyncio.Queue()
        self.sent: list[bytes] = []
        self.sms: list[str] = []
        self.hung_up = asyncio.Event()
        self._rest = b""

    def feed(self, pcm16k: bytes) -> None:
        """Queue caller audio (any length); it is re-cut into 20 ms frames."""
        data = self._rest + pcm16k
        n = len(data) - len(data) % FRAME_BYTES
        for i in range(0, n, FRAME_BYTES):
            self.inbound.put_nowait(data[i : i + FRAME_BYTES])
        self._rest = data[n:]

    def close_input(self) -> None:
        self.inbound.put_nowait(None)

    async def audio_in(self) -> AsyncIterator[bytes]:
        while True:
            frame = await self.inbound.get()
            if frame is None:
                return
            yield frame

    async def send_audio(self, frame: bytes) -> None:
        self.sent.append(frame)

    async def clear_audio(self) -> None:
        pass

    async def hangup(self) -> None:
        if not self.hung_up.is_set():
            self.hung_up.set()
            self.close_input()

    async def send_sms(self, text: str) -> bool:
        return False

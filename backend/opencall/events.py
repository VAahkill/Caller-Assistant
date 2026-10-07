"""Fan-out of live events to the mobile app, plus push notifications.

Every connected app (websocket on /ws/events) gets every event. Events that
need the user's attention are also sent as push notifications through Expo's
free push service, so they arrive when the app is closed.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

log = logging.getLogger("opencall.events")

# Events that should also buzz the phone, with how to word the notification.
PUSH_EVENTS = {
    "call_started": ("high", "Assistant answering {who}"),
    "hold_question": ("max", "{who} asks: {question}"),
    "sensitive_request": ("max", "Security: {who} asked for your {kind}"),
    "message_taken": ("high", "Message from {who}"),
    "task_update": ("high", "{title}"),
    "task_needs_decision": ("max", "{title}"),
}


class EventBus:
    def __init__(self, push_url: str = "", push_tokens: callable = lambda: []):  # type: ignore[valid-type]
        self._subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
        self._push_url = push_url
        self._push_tokens = push_tokens
        self.history: list[dict[str, Any]] = []  # for tests and late joiners

    def subscribe(self) -> asyncio.Queue[dict[str, Any]]:
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1000)
        self._subscribers.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue[dict[str, Any]]) -> None:
        self._subscribers.discard(q)

    async def publish(self, event: str, **data: Any) -> None:
        payload = {"event": event, **data}
        self.history.append(payload)
        del self.history[:-500]
        for q in list(self._subscribers):
            try:
                q.put_nowait(payload)
            except asyncio.QueueFull:
                log.warning("dropping event for slow subscriber")
        if event in PUSH_EVENTS:
            asyncio.get_running_loop().create_task(self._push(event, payload))

    async def _push(self, event: str, payload: dict[str, Any]) -> None:
        tokens = self._push_tokens()
        if not tokens or not self._push_url:
            return
        priority, template = PUSH_EVENTS[event]
        fields = {"who": payload.get("who", "Caller"), "question": "", "kind": "", "title": "", **payload}
        try:
            body = template.format(**fields)
        except (KeyError, IndexError):
            body = event
        messages = [
            {
                "to": t,
                "title": "OpenCall",
                "body": body[:180],
                "data": payload,
                "priority": "high",
                "sound": "default",
                "channelId": "calls-urgent" if priority == "max" else "calls",
                # Matches the app's "hold" category, which adds an inline reply box.
                **({"categoryId": "hold"} if event in ("hold_question", "task_needs_decision") else {}),
            }
            for t in tokens
        ]
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(self._push_url, json=messages)
        except httpx.HTTPError as e:  # never let a push failure break a call
            log.warning("push failed: %s", e)

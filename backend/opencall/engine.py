"""Wires providers, the store, the event bus and live call sessions together."""

from __future__ import annotations

import asyncio
import logging

from .agent import Conversation
from .config import Settings
from .events import EventBus
from .models import CallDirection, CallerMessage, CallRecord, CallStatus
from .providers import build_llm, build_stt, make_vad
from .providers.llm import LLM
from .providers.stt import STT
from .providers.tts import TTSRouter
from .screening import ScreenDecision, find_contact, normalize_number, screen_number
from .session import CallSession
from .store import Store
from .tasks import TaskManager
from .telephony.base import CallBridge, Dialer, NoDialer

log = logging.getLogger("opencall.engine")


class Engine:
    def __init__(
        self,
        settings: Settings,
        store: Store | None = None,
        llm: LLM | None = None,
        stt: STT | None = None,
        tts: TTSRouter | None = None,
        dialer: Dialer | None = None,
    ):
        self.settings = settings
        self.store = store or Store(settings.data_dir)
        self.bus = EventBus(settings.expo_push_url, lambda: self.store.profile.push_tokens)
        self.llm = llm or build_llm(settings)
        self.stt = stt or build_stt(settings)
        self.tts = tts or TTSRouter(settings.voices_dir, settings.tts_provider, settings.clone_provider)
        self.dialer: Dialer = dialer or NoDialer()
        self.tasks = TaskManager(self)
        self.sessions: dict[str, CallSession] = {}

    def make_vad(self):
        return make_vad(self.settings.vad_provider)

    def screen(self, number: str) -> ScreenDecision:
        return screen_number(self.store.profile, number)

    async def record_rejected(self, number: str, decision: ScreenDecision) -> None:
        rec = CallRecord(number=normalize_number(number, self.store.profile.home_country_code),
                         category=decision.category, status=CallStatus.rejected, reject_reason=decision.reason)
        self.store.calls.put(rec)
        await self.bus.publish("call_rejected", call=rec.model_dump(mode="json"), who=rec.number, reason=decision.reason)

    def _speakable(self) -> list[str]:
        return sorted(self.tts.supported_languages(self.store.profile.voice))

    async def handle_call(self, bridge: CallBridge) -> CallSession:
        """Run a connected call to completion. Called by every telephony bridge."""
        profile = self.store.profile
        task = self.tasks.task_for_call(bridge.call_id) if bridge.direction == "outbound" else None
        if task:
            rec = CallRecord(id=bridge.call_id, direction=CallDirection.outbound, number=task.number,
                             contact_name=task.target_name, category="task", task_id=task.id)
            conv = Conversation.for_task(profile, self.llm, task, self._speakable())
        else:
            contact = find_contact(profile, bridge.number)
            number = normalize_number(bridge.number, profile.home_country_code)
            rec = CallRecord(id=bridge.call_id, number=number, contact_name=contact.name if contact else "",
                             category="contact" if contact else "unknown")
            conv = Conversation.inbound(profile, self.llm, number, rec.contact_name, self._speakable(),
                                        can_text=getattr(bridge, "can_sms", False))
        session = CallSession(self, bridge, rec, conv)
        self.sessions[rec.id] = session
        if task:
            await self.tasks.on_connected(task, session)
        try:
            await session.run()
        finally:
            self.sessions.pop(rec.id, None)
        return session

    async def on_call_finished(self, session: CallSession) -> None:
        rec = session.record
        if rec.task_id:
            await self.tasks.on_call_ended(session)
        elif rec.message or (rec.category not in ("spam", "delivery") and rec.summary):
            msg = CallerMessage(call_id=rec.id, number=rec.number, caller_name=rec.contact_name,
                                text=rec.message or rec.summary)
            self.store.messages.put(msg)
            await self.bus.publish("message_taken", message=msg.model_dump(mode="json"), call_id=rec.id,
                                   who=rec.contact_name or rec.number)
        await self.bus.publish("call_ended", call=rec.model_dump(mode="json"), call_id=rec.id,
                               who=rec.contact_name or rec.number)

    async def shutdown(self) -> None:
        for s in list(self.sessions.values()):
            await s.bridge.hangup()
        await asyncio.sleep(0)

"""Wires providers, the store, the event bus and live call sessions together."""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections import OrderedDict

from .agent import Conversation, opening_line
from .config import Settings
from .events import EventBus
from .models import CallDirection, CallerMessage, CallRecord, CallStatus
from .providers import build_llm, build_stt, make_vad
from .phrases import phrase
from .providers.llm import LLM, LLMError
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
        self.tts = tts or TTSRouter(settings.voices_dir, settings.tts_provider, settings.clone_provider,
                                    settings.indic_tts, settings.indic_parler_model)
        self.dialer: Dialer = dialer or NoDialer()
        self.tasks = TaskManager(self)
        self.sessions: dict[str, CallSession] = {}
        # What is loaded and working, for /health and the app's status screen. mt
        # (translation) and lid (language identification) are set by those services.
        self.ready: dict[str, bool] = {"stt": False, "tts": False, "llm": False, "mt": False, "lid": False}
        self._speech_cache: OrderedDict[tuple[str, str, str], bytes] = OrderedDict()
        self._speech_lock = threading.Lock()
        self._background: set[asyncio.Task] = set()
        self._llm_warming: asyncio.Task | None = None
        self._warm_again = False
        self._changed_during_call = False
        self.store.on_profile_saved.append(self.profile_changed)

    # ------------------------------------------------------------ warm-up
    def warm_up(self) -> None:
        """Download and load the speech models now, so the first call doesn't wait for them."""
        load_stt = getattr(self.stt, "warm_up", None)
        if load_stt is not None:
            load_stt()
        self.ready["stt"] = True
        vad = self.make_vad()
        log.info("Voice activity detection: %s", getattr(vad, "name", type(vad).__name__))
        self.tts.warm_up(self.store.profile.voice, [lang.strip() for lang in self.settings.indic_preload.split(",")])
        self._prerender_phrases()
        self.ready["tts"] = True
        log.info("Speech models loaded, ready for calls.")

    def _prerender_phrases(self) -> None:
        """The greeting, "one moment" and the apology play instantly from memory."""
        voice = self.store.profile.voice
        langs = {"en"} | {lang.strip() for lang in self.settings.indic_preload.split(",") if lang.strip()}
        supported = self.tts.supported_languages(voice)
        self._prerender_greeting()
        for text, lang in [(phrase(key, lang), lang) for lang in sorted(langs & supported)
                           for key in ("filler", "fallback")]:
            self._remember((text, voice, lang), self.tts._synth_sync(text, voice, lang))

    def _prerender_greeting(self) -> None:
        voice, text = self.store.profile.voice, opening_line(self.store.profile)
        with self._speech_lock:
            if (text, voice, "en") in self._speech_cache:
                return
        self._remember((text, voice, "en"), self.tts._synth_sync(text, voice, "en"))

    def profile_changed(self) -> None:
        """The user changed something the call prompt or the greeting is made from
        (their name, location, instructions...): prepare the new ones now, so the
        next caller isn't kept waiting while the model reads the new prompt."""
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return  # saved outside the running server (a script): nothing to prepare
        if self.sessions:
            self._changed_during_call = True  # the caller is using the model; prepare when the call ends
            return
        self._changed_during_call = False
        self.refresh_llm_cache()
        if self.ready["tts"]:
            self._spawn(asyncio.to_thread(self._prerender_greeting))

    async def warm_up_all(self) -> None:
        """Speech models (in a thread) and the LLM at the same time."""
        llm = asyncio.create_task(self.warm_up_llm())
        try:
            await asyncio.to_thread(self.warm_up)
        finally:
            await llm

    async def warm_up_llm(self, retry: bool = True) -> None:
        """Sends the real call prompt once, so the model is loaded and the server has
        the prompt cached before the first caller. Retries until the LLM answers (it
        may still be starting, or the model not pulled yet)."""
        warm = getattr(self.llm, "warm_up", None)
        if warm is None:
            self.ready["llm"] = True
            return
        messages = Conversation.inbound(self.store.profile, self.llm, "", "", self._speakable()).warm_up_messages()
        delay = 15.0
        while True:
            started = time.monotonic()
            try:
                await warm(messages)
            except LLMError as e:
                self.ready["llm"] = False
                if not retry:
                    log.warning("LLM warm-up failed: %s", e)
                    return
                log.warning("The LLM isn't ready yet: %s Trying again in %.0f s.", e, delay)
                await asyncio.sleep(delay)
                delay = min(delay * 2, 300.0)
                continue
            self.ready["llm"] = True
            log.info("LLM %s is ready (warm-up took %.1f s).", self.settings.llm_model, time.monotonic() - started)
            if self._warm_again:  # the prompt changed while this warm-up ran
                self._warm_again = False
                self._llm_warming = self._spawn(self.warm_up_llm(retry=False))
            return

    def _start_llm_warm_up(self, retry: bool) -> None:
        if self._llm_warming and not self._llm_warming.done():
            return
        self._llm_warming = self._spawn(self.warm_up_llm(retry=retry))

    def llm_failed(self) -> None:
        """A call turn couldn't get an answer: report not ready and keep trying."""
        self.ready["llm"] = False
        if getattr(self.llm, "warm_up", None) is not None:
            self._start_llm_warm_up(retry=True)

    def refresh_llm_cache(self) -> None:
        """Put the call prompt, as it is now, in the LLM server's cache, so the next
        caller's first reply starts quickly. Done after a call summary (a different
        prompt) and when the user changes something the prompt is made from."""
        if getattr(self.llm, "warm_up", None) is None:
            return
        if self._llm_warming and not self._llm_warming.done():
            self._warm_again = True
            return
        self._start_llm_warm_up(retry=False)

    def _spawn(self, coro) -> asyncio.Task:
        task = asyncio.get_running_loop().create_task(coro)
        self._background.add(task)
        task.add_done_callback(self._background_done)
        return task

    def _background_done(self, task: asyncio.Task) -> None:
        self._background.discard(task)
        if not task.cancelled() and task.exception() is not None:
            log.error("background task failed", exc_info=task.exception())

    # ------------------------------------------------------------ speech
    def _remember(self, key: tuple[str, str, str], pcm: bytes) -> None:
        with self._speech_lock:
            self._speech_cache[key] = pcm
            self._speech_cache.move_to_end(key)
            while len(self._speech_cache) > 64:
                self._speech_cache.popitem(last=False)

    async def speech(self, text: str, voice: str, lang: str, cache: bool = False) -> bytes:
        """Synthesised speech; fixed lines (cache=True) are kept in memory."""
        if not cache:
            return await self.tts.synthesize(text, voice, lang)
        key = (text, voice, lang)
        with self._speech_lock:
            hit = self._speech_cache.get(key)
        if hit is not None:
            return hit
        pcm = await self.tts.synthesize(text, voice, lang)
        if pcm:
            self._remember(key, pcm)
        return pcm

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

    def open_session(self, bridge: CallBridge) -> CallSession:
        """Set up a connected call (registered, not yet running)."""
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
        return session

    async def run_session(self, session: CallSession) -> CallSession:
        """Run a call opened with ``open_session`` to completion."""
        task = self.store.tasks.get(session.record.task_id) if session.record.task_id else None
        try:
            if task:
                await self.tasks.on_connected(task, session)
            await session.run()
        finally:
            self.sessions.pop(session.record.id, None)
            if self._changed_during_call and not self.sessions:
                self.profile_changed()
        return session

    async def handle_call(self, bridge: CallBridge) -> CallSession:
        """Run a connected call to completion. Called by every telephony bridge."""
        return await self.run_session(self.open_session(bridge))

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
        for t in list(self._background):
            t.cancel()
        await asyncio.gather(*self._background, return_exceptions=True)

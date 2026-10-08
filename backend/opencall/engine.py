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
from .languages import needs_translation
from .models import CallDirection, CallerMessage, CallRecord, CallStatus
from .phrases import phrase
from .providers import build_lid, build_llm, build_stt, make_vad
from .providers.llm import LLM, LLMError
from .providers.mt import TranslationService, build_translator
from .providers.stt import STT
from .providers.tts import TTSRouter
from .screening import ScreenDecision, find_contact, normalize_number, screen_number
from .session import CallSession
from .store import Store
from .tasks import TaskManager
from .telephony.base import CallBridge, Dialer, NoDialer
from .voice_samples import VoiceSamples

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
        lid=None,
        mt: TranslationService | None = None,
    ):
        self.settings = settings
        self.store = store or Store(settings.data_dir)
        self.bus = EventBus(settings.expo_push_url, lambda: self.store.profile.push_tokens)
        self.llm = llm or build_llm(settings)
        self.stt = stt or build_stt(settings)
        # Which language a caller speaks (None: Whisper guesses every turn).
        self.lid = lid if lid is not None else build_lid(settings.lid_provider, self.stt)
        # Translation between the caller's language and English.
        self.mt = mt or build_translator(settings.mt_provider)
        self.tts = tts or TTSRouter(settings.voices_dir, settings.tts_provider, settings.clone_provider,
                                    settings.indic_tts, settings.indic_parler_model, settings.piper_voices)
        self.tts.chosen_voices = lambda: self.store.profile.voices_by_language
        self.samples = VoiceSamples(self.tts, settings.voices_dir / "samples")
        self.dialer: Dialer = dialer or NoDialer()
        self.tasks = TaskManager(self)
        self.sessions: dict[str, CallSession] = {}
        # What is loaded and working, for /health and the app's status screen. mt
        # (translation) and lid (language identification) are set by those services.
        self.ready: dict[str, bool] = {"stt": False, "tts": False, "llm": False, "mt": False, "lid": False}
        self._speech_cache: OrderedDict[tuple[str, ...], bytes] = OrderedDict()
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
            if getattr(self.stt, "models", None):
                load_stt(self.store.profile.caller_languages)  # and each caller language's own model
            else:
                load_stt()
        self.ready["stt"] = True
        if self.lid is not None:
            self.lid.warm_up()
            self.ready["lid"] = self.lid.available
            log.info("Language identification: %s", self.lid.name)
        self.mt.warm_up([lang for lang in self.store.profile.caller_languages if lang != "en"])
        self.ready["mt"] = self.mt.available
        log.info("Translation: %s", self.mt.name)
        vad = self.make_vad()
        log.info("Voice activity detection: %s", getattr(vad, "name", type(vad).__name__))
        self.tts.warm_up(self.store.profile.voice, self._speech_languages())
        self._prerender_phrases()
        self.ready["tts"] = True
        log.info("Speech models loaded, ready for calls.")
        made = self.samples.prerender(["en", *self._speech_languages()])
        log.info("Voice demos ready: %d.", made)

    def _prerender_phrases(self) -> None:
        """The greeting, "one moment" and the apology play instantly from memory, in
        the voices now chosen. Lines already in memory aren't made again."""
        voice = self.store.profile.voice
        supported = self.tts.supported_languages(voice)
        self._prerender(opening_line(self.store.profile), voice, "en")
        for lang in ["en", *self._speech_languages()]:
            if lang in supported:
                for key in ("filler", "fallback"):
                    self._prerender(self.fixed_line(key, lang), voice, lang)

    def _prerender(self, text: str, voice: str, lang: str) -> None:
        key = self._speech_key(text, voice, lang)
        with self._speech_lock:
            if key in self._speech_cache:
                return
        self._remember(key, self.tts._synth_sync(text, voice, lang))

    def _speech_languages(self) -> list[str]:
        """Languages to have voices ready for: the caller languages and OPENCALL_INDIC_PRELOAD."""
        extra = [lang.strip() for lang in self.settings.indic_preload.split(",") if lang.strip()]
        return list(dict.fromkeys([*self.store.profile.caller_languages, *extra]))

    def _speech_key(self, text: str, voice: str, lang: str) -> tuple[str, ...]:
        """Cached speech depends on the voices chosen per language too."""
        chosen = self.store.profile.voices_by_language
        if not chosen:
            return (text, voice, lang)
        return (text, voice, lang, ",".join(f"{k}={v}" for k, v in sorted(chosen.items())))

    def fixed_line(self, key: str, lang: str) -> str:
        """A fixed line (see phrases.py) in ``lang``: written by hand for the languages
        callers use most, translated from English (and cached) for the rest."""
        text = phrase(key, lang)
        if lang != "en" and needs_translation(text, lang):
            return self.mt.translate_sync(text, "en", lang)
        return text

    def profile_changed(self) -> None:
        """The user changed something the call prompt or the greeting is made from
        (their name, location, instructions, voices...): prepare the new ones now, so
        the next caller isn't kept waiting while the model reads the new prompt."""
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            return  # saved outside the running server (a script): nothing to prepare
        if self.sessions:
            self._changed_during_call = True  # the caller is using the model; prepare when the call ends
            return
        self._changed_during_call = False
        self.refresh_llm_cache()
        self.release_unused_voice_model()
        if self.ready["tts"]:
            self._spawn(asyncio.to_thread(self._prerender_phrases))

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

    # ------------------------------------------------------------ voices
    def prepare_voice(self, voice_id: str) -> asyncio.Task:
        """Gets a just-recorded voice ready (its speaker latents, then its demo) in the
        background, and tells the app when it is ready or why it failed."""

        async def prepare() -> None:
            info = await asyncio.to_thread(self.tts.prepare_clone, voice_id)
            if info.status == "ready":
                try:
                    await self.samples.get(voice_id)
                except Exception as e:
                    log.warning("Couldn't make the demo for %s: %s: %s", voice_id, e.__class__.__name__, e)
            self.release_unused_voice_model()
            await self.bus.publish("voice_status", voice_id=voice_id, status=info.status, detail=info.detail)

        return self._spawn(prepare())

    def release_unused_voice_model(self) -> None:
        """The recorded-voice model takes 2 to 3 GB; it stays loaded only while the
        user has a recorded voice in use (it is loaded again when one is chosen)."""
        if self.tts.xtts is not None and not self.tts.uses_recorded_voice(self.store.profile.voice):
            self.tts.xtts.unload()

    def forget_voice(self, voice_id: str) -> None:
        """A recorded voice was deleted: stop using it anywhere."""
        self.samples.forget(voice_id)
        profile = self.store.profile
        changed = False
        if profile.voice == voice_id:
            profile.voice = self.settings.default_voice
            changed = True
        if voice_id in profile.voices_by_language.values():
            profile.voices_by_language = {k: v for k, v in profile.voices_by_language.items() if v != voice_id}
            changed = True
        if changed:
            self.store.save_profile()

    # ------------------------------------------------------------ speech
    def _remember(self, key: tuple[str, ...], pcm: bytes) -> None:
        with self._speech_lock:
            self._speech_cache[key] = pcm
            self._speech_cache.move_to_end(key)
            while len(self._speech_cache) > 64:
                self._speech_cache.popitem(last=False)

    async def speech(self, text: str, voice: str, lang: str, cache: bool = False) -> bytes:
        """Synthesised speech; fixed lines (cache=True) are kept in memory."""
        if not cache:
            return await self.tts.synthesize(text, voice, lang)
        key = self._speech_key(text, voice, lang)
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

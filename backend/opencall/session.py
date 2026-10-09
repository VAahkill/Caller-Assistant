"""One live call: audio in, turn-taking, barge-in, speech out, hold, recording."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import TYPE_CHECKING

from .agent import (
    Action,
    Category,
    Conversation,
    EndCall,
    Hold,
    Outcome,
    Say,
    SecurityAlert,
    SendLocation,
    TakeMessage,
)
from .audio import FRAME_BYTES, FRAME_MS, StereoRecorder, frames
from .guardrails import scrub_outgoing
from .languages import LanguageTracker, guess_language, needs_translation, written_in_latin
from .models import CallRecord, CallStatus, HoldQuestion, TranscriptLine
from .phrases import fill, phrase
from .providers.llm import LLMError
from .providers.mt import split_sentences
from .providers.vad import TurnDetector
from .telephony.base import CallBridge

if TYPE_CHECKING:
    from .engine import Engine

log = logging.getLogger("opencall.session")


class CallSession:
    """Runs one call.

    Everything the other party says becomes a *turn*. Turns run one at a time (a
    typed line sent while the assistant is still answering waits its turn), every
    turn is a tracked task that is cancelled when the call ends, and a turn that
    fails is logged, reported to the app as ``turn_error`` and answered with a
    spoken apology, so the caller never just hears silence. The app follows along
    through ``assistant_status`` events (listening, transcribing, thinking,
    speaking, idle while on hold, error).
    """

    def __init__(self, engine: "Engine", bridge: CallBridge, record: CallRecord, conv: Conversation):
        self.engine = engine
        self.bridge = bridge
        self.record = record
        self.conv = conv
        s = engine.settings
        self.turns = TurnDetector(engine.make_vad(), s.end_of_turn_silence_ms)
        self.recorder = StereoRecorder()
        self._play_q: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._playing = asyncio.Event()
        self._turn_lock = asyncio.Lock()
        self._turn_active = False
        self._tasks: set[asyncio.Task] = set()  # turns, fillers, kickoff: cancelled at hang-up
        self._respond_task: asyncio.Task | None = None  # the spoken turn a barge-in cancels
        self._reply_task: asyncio.Task | None = None  # the turn whose reply is being made and said
        self._queued_by = "assistant"  # who the audio waiting to be played is from
        self._ending = False
        self._hangup_after_playback = False
        self._hold_waiters: dict[str, asyncio.Future[str]] = {}
        self._language = "en"
        self._status: str | None = None
        # The caller's language: decided from their first words, then kept (see
        # LanguageTracker), so one odd turn doesn't switch the call to another language.
        self.tracker = LanguageTracker(engine.store.profile.caller_languages)
        # The caller's language when the app chose it (practice call); speech is then
        # recognised in that language instead of being guessed.
        self.language_hint: str | None = None
        self._greeted = asyncio.Event()  # turns wait for the greeting to be on its way
        self.closed = asyncio.Event()

    # ------------------------------------------------------------ helpers
    @property
    def who(self) -> str:
        return self.record.contact_name or self.record.number or "Unknown caller"

    async def _publish(self, event: str, **data) -> None:
        await self.engine.bus.publish(event, call_id=self.record.id, who=self.who, **data)

    async def _line(self, speaker: str, text: str, kind: str = "speech", lang: str = "",
                    translation: str = "", translation_lang: str = "", english: str = "") -> TranscriptLine:
        line = TranscriptLine(speaker=speaker, text=text, kind=kind, lang=lang,  # type: ignore[arg-type]
                              translation=translation, translation_lang=translation_lang, english=english)
        self.record.transcript.append(line)
        await self._publish("transcript", line=line.model_dump(mode="json"))
        return line

    async def update_line(self, line: TranscriptLine, *, translation: str | None = None,
                          translation_lang: str | None = None, english: str | None = None) -> None:
        """Adds a translation to a line that is already on screen (it shows at once;
        the translation follows as a ``transcript_update`` event)."""
        if translation is not None:
            line.translation = translation
        if translation_lang is not None:
            line.translation_lang = translation_lang
        if english is not None:
            line.english = english
        await self._publish("transcript_update", line_id=line.id, translation=line.translation,
                            translation_lang=line.translation_lang, english=line.english)

    # ------------------------------------------------------------ translation
    @property
    def owner_language(self) -> str:
        return self.engine.store.profile.owner_language or "en"

    def _owner_text_language(self, text: str, lang: str | None) -> str:
        """The language the user wrote ``text`` in: as given, else its script says it.
        Latin letters are read as English (rather than romanised Telugu, say) unless the
        user's own language is written in them."""
        if lang:
            return lang
        script = guess_language(text, default="")
        if script:
            return script
        return self.owner_language if written_in_latin(self.owner_language) else "en"

    async def _translate(self, text: str, src: str, tgt: str) -> str | None:
        """``text`` in ``tgt``, or None if it can't be translated (no engine for these
        languages, or it failed and came back unchanged)."""
        if src == tgt:
            return text
        if not text.strip() or not self.engine.mt.can_translate(src, tgt):
            return None
        out = (await self.engine.mt.translate(text, src, tgt)).strip()
        return out if out and out != text.strip() else None

    async def _english(self, text: str, lang: str) -> str | None:
        """What the caller said, in English for the model (None: the model gets it as said)."""
        if lang == "en" or not self.engine.mt.can_translate(lang, "en"):
            return None
        await self._set_status("translating")
        return await self._translate(text, lang, "en")

    def _translate_for_user(self, line: TranscriptLine) -> None:
        """Shows the line in the user's own language too (the caller's words, the
        assistant's, a hold question), when live translation is on. From English when
        the line has it: that is one step, and what the assistant actually meant."""
        profile = self.engine.store.profile
        target = self.owner_language
        if not profile.translate_live or line.lang == target or not line.text.strip():
            return
        text, src = (line.english, "en") if line.english else (line.text, line.lang or "en")
        if src == target:
            self.spawn(self.update_line(line, translation=text, translation_lang=target), "show translation")
            return
        if not self.engine.mt.can_translate(src, target):
            return

        async def translate() -> None:
            out = await self._translate(text, src, target)
            if out:
                await self.update_line(line, translation=out, translation_lang=target)

        self.spawn(translate(), "translate for the user")

    async def _set_status(self, state: str, detail: str = "") -> None:
        if state == self._status and not detail:
            return
        self._status = state
        await self._publish("assistant_status", state=state, **({"detail": detail} if detail else {}))

    def _save(self) -> None:
        self.engine.store.calls.put(self.record)

    def spawn(self, coro: Awaitable[None], name: str) -> asyncio.Task:
        """Runs ``coro`` as part of this call: it is cancelled when the call ends and
        its failure is logged."""
        task = asyncio.get_running_loop().create_task(coro, name=f"call {self.record.id}: {name}")  # type: ignore[arg-type]
        self._tasks.add(task)
        task.add_done_callback(self._task_done)
        return task

    def _task_done(self, task: asyncio.Task) -> None:
        self._tasks.discard(task)
        if not task.cancelled() and task.exception() is not None:
            log.error("%s failed", task.get_name(), exc_info=task.exception())

    async def _cancel_tasks(self) -> None:
        tasks = [t for t in self._tasks if not t.done()]
        for t in tasks:
            t.cancel()
        # Failures were already logged by _task_done; this only waits for them to stop.
        await asyncio.gather(*tasks, return_exceptions=True)

    # ------------------------------------------------------------ main loop
    async def run(self) -> None:
        self.record.status = CallStatus.active
        self._save()
        await self._publish("call_started", call=self.record.model_dump(mode="json"))
        if self.conv.vip:
            await self._publish("urgent_call", reason="vip", title=f"VIP {self.who} is calling")
        player = asyncio.create_task(self._player())
        limit = asyncio.create_task(self._time_limit())
        try:
            if not self.conv.outbound:
                # In the language chosen for a practice call, else the one callers speak most.
                self._language = self.language_hint or self.tracker.language
                await self._greet()
            else:
                self.spawn(self._outbound_kickoff(), "outbound kickoff")
            self._greeted.set()
            async for frame in self.bridge.audio_in():
                if self._ending and not self._hangup_after_playback:
                    break
                await self._on_frame(frame)
        except Exception:
            log.exception("call %s crashed", self.record.id)
        finally:
            self._greeted.set()
            # Stop whatever is still thinking or speaking first: an orphaned turn would
            # keep the LLM busy for the next call.
            await self._cancel_tasks()
            await self._finish()
            for t in (player, limit):
                if not t.done():
                    t.cancel()
            await asyncio.gather(player, limit, return_exceptions=True)

    async def _outbound_kickoff(self) -> None:
        # Let the callee say "Hello?" first; if they don't within 3 s, start talking.
        await asyncio.sleep(3)
        if not self.record.transcript and self._respond_task is None and not self._turn_active:
            self._respond_task = self.spawn(self._turn("kickoff", self._kickoff), "kickoff turn")

    async def _kickoff(self) -> None:
        await self._set_status("thinking")
        await self._run_actions(self.conv.start_outbound(), filler=False)

    async def _time_limit(self) -> None:
        await asyncio.sleep(self.engine.settings.max_call_minutes * 60)
        await self._say(self.conv.fixed_say("wrap_up"))
        await self._end_after_playback()

    async def _on_frame(self, frame: bytes) -> None:
        self.recorder.add_caller(frame)
        event, utterance = self.turns.push(frame)
        if event == "start" and not self._turn_active:
            await self._set_status("listening")
        # Barge-in: the caller talks over the assistant -> stop speaking at once.
        if self.turns.speaking and self._playing.is_set() and self.turns.voiced_ms >= self.engine.settings.barge_in_ms:
            await self._interrupt()
        if event == "end" and utterance:
            if self.record.status == CallStatus.on_hold:
                return  # caller chatter while on hold is recorded but not answered
            await self._interrupt(cancel_response=True)
            self._respond_task = self.spawn(
                self._turn("speech", lambda: self._handle_utterance(utterance)), "caller turn")

    async def _interrupt(self, cancel_response: bool = False) -> None:
        drained = False
        while not self._play_q.empty():
            self._play_q.get_nowait()
            drained = True
        if drained or self._playing.is_set():
            await self.bridge.clear_audio()
        self._playing.clear()
        if cancel_response and self._respond_task and not self._respond_task.done():
            self._respond_task.cancel()

    # ------------------------------------------------------------ turns
    async def _turn(self, name: str, work: Callable[[], Awaitable[None]]) -> None:
        await self._greeted.wait()  # a line typed straight away is answered after the greeting
        async with self._turn_lock:
            if self.closed.is_set():
                return
            self._turn_active = True
            try:
                await work()
            except asyncio.CancelledError:
                raise
            except Exception as e:
                log.exception("call %s: %s turn failed", self.record.id, name)
                await self._turn_failed(e)
            finally:
                self._turn_active = False
            if self._play_q.empty() and not self._playing.is_set():
                await self._set_status("idle" if self.record.status == CallStatus.on_hold else "listening")

    async def _turn_failed(self, error: Exception) -> None:
        if isinstance(error, LLMError):
            detail = str(error)
            self.engine.llm_failed()
        else:
            detail = f"Something went wrong while answering ({error.__class__.__name__}: {error})"[:300]
        await self._set_status("error", detail)
        await self._publish("turn_error", detail=detail)
        await self._say(self.conv.fixed_say("fallback"))

    async def _handle_utterance(self, pcm: bytes, language_hint: str | None = None, origin: str = "live") -> None:
        await self._set_status("transcribing")
        language = await self._spoken_language(pcm, language_hint or self.language_hint)
        if language:
            self._language = language  # a filler during transcription is said in it
        # The wait the caller notices starts when they stop talking: "One moment,
        # please" is timed from here, not from when their words are understood.
        fill = self._start_fillers()
        try:
            result = await self.engine.stt.transcribe(pcm, language)
            text = result.text.strip()
            if not text:
                if origin == "recording":
                    await self._publish("turn_error",
                                        detail="Couldn't make out any words in that recording. Please try again.")
                return
            if language is None:  # no language ID: Whisper's guess for this turn
                language = result.language or self._language
                await self._language_heard(self.tracker.choose(language, confidence=0.0))
            await self._caller_turn(text, language, fill)
        finally:
            if fill:
                fill.cancel()

    async def _spoken_language(self, pcm: bytes, chosen: str | None) -> str | None:
        """The call's language, updated with this utterance: chosen in the app, or
        decided by the language-ID model. None when there is no language ID."""
        if chosen:
            heard = self.tracker.choose(chosen)
        else:
            lid = self.engine.lid
            logprobs = await asyncio.to_thread(lid.identify, pcm) if lid is not None else None
            if logprobs is None:
                return None
            heard = self.tracker.hear(logprobs, len(pcm) / 32000)
        await self._language_heard(heard)
        return heard.language

    async def _language_heard(self, heard) -> None:
        if heard.changed:
            self.record.language = heard.language
            await self._publish("call_language", language=heard.language, confidence=round(heard.confidence, 2))

    async def _caller_turn(self, text: str, language: str, fill: asyncio.Task | None = None) -> None:
        """Answers what the caller said. ``fill``: the filler timer, when it was started
        earlier (when they stopped talking)."""
        self._language = language
        fill = fill or self._start_fillers()
        self.record.language = language
        line = await self._line("caller", text, lang=language)
        # The model works in English: the caller's words go to it translated (and are
        # checked for credential requests in both languages).
        english = await self._english(text, language)
        if english is not None:
            line.english = english
        self._translate_for_user(line)
        await self._set_status("thinking")
        await self._run_actions(self.conv.respond(text, language, english), fill=fill)

    def _typed_language(self, text: str) -> str:
        # The script says it for Telugu, Tamil, Hindi...; English letters could be
        # English or romanised Telugu, so the language chosen in the app wins there.
        return guess_language(text, default="") or self.language_hint or "en"

    async def handle_text(self, text: str, language: str | None = None) -> None:
        """Process one thing the other party said (also used by tests and the simulator).
        Returns when the turn is over."""
        lang = language or self._typed_language(text)

        async def typed() -> None:
            await self._language_heard(self.tracker.choose(lang))
            await self._caller_turn(text, lang)

        await self._turn("text", typed)

    def submit_text(self, text: str, language: str | None = None) -> asyncio.Task:
        """Queue a typed line; it is answered after any turn already in progress."""
        return self.spawn(self.handle_text(text, language), "typed turn")

    def submit_recording(self, pcm16k: bytes, language: str | None = None) -> asyncio.Task:
        """A finished recording (the practice call's record button) is one utterance:
        it is transcribed whole instead of being cut up by the turn detector."""
        self.recorder.add_caller(pcm16k)
        return self.spawn(
            self._turn("recording", lambda: self._handle_utterance(pcm16k, language, origin="recording")),
            "recorded turn")

    # ------------------------------------------------------------ actions
    def _start_fillers(self) -> asyncio.Task | None:
        return self.spawn(self._fillers(), "filler") if self.engine.settings.filler_after_s > 0 else None

    async def _run_actions(self, actions: AsyncIterator[Action], filler: bool = False,
                           fill: asyncio.Task | None = None) -> None:
        """Carries out the model's reply. A filler is said if the first words are slow
        to come: ``fill`` is one already timing, or ``filler`` starts one now."""
        if fill is None and filler:
            fill = self._start_fillers()
        self._reply_task = asyncio.current_task()
        try:
            async with contextlib.aclosing(actions) as stream:  # type: ignore[type-var]
                async for action in stream:
                    if fill and not isinstance(action, (Category, SecurityAlert)):
                        fill.cancel()
                        fill = None
                    if isinstance(action, Say):
                        await self._say(action)
                    elif isinstance(action, Hold):
                        await stream.aclose()  # stop the model before waiting for the user
                        await self._hold(action.question)
                        return
                    elif isinstance(action, TakeMessage):
                        self.record.message = (self.record.message + " " + action.text).strip()
                        await self._line("system", f"Message taken: {action.text}", kind="note")
                    elif isinstance(action, Category):
                        self.record.category = action.value
                        await self._publish("call_category", category=action.value)
                    elif isinstance(action, SecurityAlert):
                        await self._security_alert(action)
                    elif isinstance(action, SendLocation):
                        await self._send_location()
                    elif isinstance(action, Outcome):
                        await self.engine.tasks.on_outcome(self, action)
                    elif isinstance(action, EndCall):
                        await self._end_after_playback()
        finally:
            if fill:
                fill.cancel()
            if self._reply_task is asyncio.current_task():
                self._reply_task = None
        self._save()

    async def _fillers(self) -> None:
        """'One moment, please' when the reply is slow to start."""
        s = self.engine.settings
        await asyncio.sleep(s.filler_after_s)
        await self._say_fixed("filler")
        if s.filler_again_s > 0:
            await asyncio.sleep(s.filler_again_s)
            await self._say_fixed("filler_again")

    async def _greet(self) -> None:
        lang = self._language
        text = await self.engine.greeting_async(lang)
        english = self.conv.opening_line()
        await self._speak(text, english="" if text == english else english, lang=lang, cached=True,
                          translated=True)

    async def _say(self, say: Say) -> None:
        if say.fixed:
            await self._say_fixed(say.fixed)
        else:
            await self._speak(say.text, already_scrubbed=True)

    async def _say_fixed(self, key: str) -> None:
        """A fixed line in the caller's language: hand-written, or translated once and
        kept; its speech comes from memory after the first time."""
        lang = self._language
        profile = self.engine.store.profile
        english = fill(phrase(key, "en"), profile.user_name, profile.assistant_name)
        text = await self.engine.fixed_line_async(key, lang)
        await self._speak(text, english="" if text == english else english, lang=lang, cached=True,
                          translated=True, already_scrubbed=True)

    async def _speak(self, text: str, already_scrubbed: bool = False, cached: bool = False,
                     lang: str | None = None, record: bool = True, english: str = "",
                     translated: bool = False) -> None:
        """Says ``text`` to the caller. English is translated into the caller's language
        first (unless ``translated``: it is in that language already, and ``english`` is
        its English)."""
        if not already_scrubbed:
            res = scrub_outgoing(text, self.conv.allowed_numbers())
            if res.blocked:
                await self._security_alert(SecurityAlert("blocked_output", text))
                return
            text = res.text
        lang = lang or self._language
        if not translated and needs_translation(text, lang) and self.engine.mt.can_translate("en", lang):
            # The assistant's English, said in the caller's language. The translation is
            # checked again: a number must not slip through in other words.
            await self._set_status("translating")
            english, text = text, await self.engine.mt.translate(text, "en", lang)
            res = scrub_outgoing(text, self.conv.allowed_numbers())
            if res.blocked:
                await self._security_alert(SecurityAlert("blocked_output", text))
                return
            text = res.text
        line = await self._line("assistant", text, lang=lang, english=english) if record else None
        await self._voice(text, lang, cached)
        if line is not None:
            self._translate_for_user(line)  # after the caller's audio is on its way

    async def _voice(self, text: str, lang: str, cached: bool = False, by: str = "assistant") -> bool:
        """Synthesises ``text`` (in ``lang``) and queues it for the phone line. ``by``:
        whose words they are (the user's aren't cut off when they speak again)."""
        voice = self.engine.store.profile.voice
        try:
            # Each sentence is said by a voice that reads its script (see TTSRouter).
            pcm = await self.engine.speech(text, voice, lang, cache=cached)
        except Exception as e:
            log.exception("TTS failed for %r", text)
            await self._publish("turn_error", detail=f"Couldn't speak a reply ({e.__class__.__name__}: {e})"[:300])
            return False
        if not pcm:
            log.warning("TTS made no audio for %r (%s)", text, lang)
            return False
        await self._set_status("speaking")
        self._queued_by = by
        for f in frames(pcm):
            self._play_q.put_nowait(f)
        return True

    async def _player(self) -> None:
        """Sends queued speech to the phone line at real-time pace."""
        next_at = time.monotonic()
        while True:
            frame = await self._play_q.get()
            if frame is None:
                return
            self._playing.set()
            await self.bridge.send_audio(frame)
            self.recorder.add_assistant(frame)
            if getattr(self.bridge, "paced", True):
                next_at = max(next_at + FRAME_MS / 1000, time.monotonic() - 0.2)
                await asyncio.sleep(max(0, next_at - time.monotonic()))
            if self._play_q.empty():
                self._playing.clear()
                next_at = time.monotonic()
                if not self._turn_active and not self.closed.is_set():
                    await self._set_status("idle" if self.record.status == CallStatus.on_hold else "listening")

    async def wait_playback(self) -> None:
        while not self._play_q.empty() or self._playing.is_set():
            await asyncio.sleep(FRAME_MS / 1000)

    async def _end_after_playback(self) -> None:
        self._ending = True
        self._hangup_after_playback = True

        async def _later():
            await self.wait_playback()
            await asyncio.sleep(0.3)
            await self.bridge.hangup()

        self.spawn(_later(), "hang up after playback")

    async def _send_location(self) -> None:
        loc = self.engine.store.profile.location
        link = loc.maps_link()
        if not link:
            return
        text = f"Delivery location for {self.engine.store.profile.user_name}: {link}"
        if loc.landmarks:
            text += f"\n{loc.landmarks}"
        if loc.floor_unit:
            text += f"\n{loc.floor_unit}"
        try:
            sent = await self.bridge.send_sms(text[:450])
        except Exception:
            log.exception("SMS failed")
            sent = False
        note = "Texted the map link to the caller." if sent else "Couldn't text the map link; directions were read out."
        await self._line("system", note, kind="note")

    # ------------------------------------------------------------ security
    async def _security_alert(self, alert: SecurityAlert) -> None:
        if alert.kind == "blocked_output":
            text = "Blocked the assistant from saying a code-like number or credential."
        else:
            text = f"Caller asked for your {alert.kind}. Nothing was shared."
        await self._line("system", text, kind="alert")
        await self._publish("sensitive_request", kind=alert.kind, text=text, said=alert.detail)

    # ------------------------------------------------------------ hold
    async def _hold(self, question: str) -> None:
        hold = HoldQuestion(question=question)
        self.record.holds.append(hold)
        self.record.status = CallStatus.on_hold
        self._save()
        fut: asyncio.Future[str] = asyncio.get_running_loop().create_future()
        self._hold_waiters[hold.id] = fut
        line = await self._line("caller", question, kind="hold_question", lang="en", english=question)
        self._translate_for_user(line)
        event = "task_needs_decision" if self.conv.outbound else "hold_question"
        await self._publish(event, hold_id=hold.id, question=question,
                            title=f"{self.who}: {question}", task_id=self.record.task_id)
        await self._set_status("idle", f"waiting for {self.engine.store.profile.user_name}")
        if self.conv.outbound:
            await self.engine.tasks.on_waiting_user(self)

        s = self.engine.settings
        timeout = s.hold_timeout_s if self.engine.store.profile.available else min(20.0, s.hold_timeout_s)
        deadline = time.monotonic() + timeout
        answer: str | None = None
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                answer = await asyncio.wait_for(asyncio.shield(fut), timeout=min(remaining, s.hold_reminder_s))
                break
            except asyncio.TimeoutError:
                if deadline - time.monotonic() > 2:
                    await self._say_fixed("hold_reminder")
        self._hold_waiters.pop(hold.id, None)
        hold.answer = answer
        hold.answered_at = time.time() if answer else None
        self.record.status = CallStatus.active
        await self._publish("hold_resolved", hold_id=hold.id, answered=answer is not None)
        if self.conv.outbound:
            await self.engine.tasks.on_resumed(self)
        await self._set_status("thinking")
        await self._run_actions(self.conv.resume_after_hold(answer), filler=True)

    async def answer_hold(self, hold_id: str | None, text: str, lang: str | None = None) -> bool:
        """The user typed an answer in the app, in their own language: the model gets
        it in English."""
        if hold_id is None and self._hold_waiters:
            hold_id = next(iter(self._hold_waiters))
        fut = self._hold_waiters.get(hold_id or "")
        if not fut or fut.done():
            return False
        src = self._owner_text_language(text, lang)
        english = await self._translate(text, src, "en") if src != "en" else None
        await self._line("user", text, lang=src, english=english or "")
        if not fut.done():  # it may have timed out while the answer was being translated
            fut.set_result(english or text)
        return True

    def can_say(self, text: str) -> bool:
        """Whether the user's words would be said (not empty, no code-like number)."""
        return bool(text.strip()) and not scrub_outgoing(text, self.conv.allowed_numbers()).blocked

    async def owner_answer(self, hold_id: str | None, text: str, lang: str | None = None) -> None:
        """The user's reply in the app: the answer to a pending hold question, or else
        words to say to the caller right away."""
        if not await self.answer_hold(hold_id, text, lang):
            await self.owner_say(text, lang)

    async def owner_say(self, text: str, lang: str | None = None) -> bool:
        """Says the user's own words (typed or spoken in the app, in their language) to
        the caller right away, in the caller's language. A sentence at a time, so the
        caller hears the first one while the next is being translated. Returns False
        if nothing was said (empty, or blocked because it had a code-like number)."""
        text = text.strip()
        if not text:
            return False
        started = time.monotonic()
        src = self._owner_text_language(text, lang)
        caller = self._language
        allowed = self.conv.allowed_numbers()
        if scrub_outgoing(text, allowed).blocked:
            await self._security_alert(SecurityAlert("blocked_output", text))
            return False
        await self._take_over()
        said, english, first_audio = [], [], None
        for sentence in split_sentences(text) or [text]:
            if src != caller:
                await self._set_status("translating")
            in_english = sentence if src == "en" else (await self._translate(sentence, src, "en") or sentence)
            if src == caller:
                out = sentence
            elif caller == "en":
                out = in_english
            else:
                out = await self._translate(in_english, "en", caller) or in_english
            res = scrub_outgoing(out, allowed)
            if res.blocked:  # the translation came out with a code in it
                await self._security_alert(SecurityAlert("blocked_output", out))
                continue
            if await self._voice(res.text, caller, by="user") and first_audio is None:
                first_audio = time.monotonic() - started
            said.append(res.text)
            english.append(in_english)
        if not said:
            return False
        log.info("call %s: the user's words reached the caller after %.2f s", self.record.id,
                 first_audio if first_audio is not None else -1)
        spoken, in_english = " ".join(said), " ".join(english)
        await self._line("user", spoken, kind="note", lang=caller,
                         translation=text if text != spoken else "", translation_lang=src if text != spoken else "",
                         english=in_english if in_english != spoken else "")
        self.conv.history.append({"role": "assistant", "content": in_english})
        return True

    async def _take_over(self) -> None:
        """The user is speaking to the caller themselves, like picking up the extension:
        the assistant stops the reply it is making and stops talking, so the user's
        words go out at once instead of taking turns with the assistant's sentence by
        sentence. A hold is left alone (the reply is waiting for the user's answer)."""
        if self.record.status == CallStatus.on_hold:
            return
        reply = self._reply_task
        if reply is not None and not reply.done() and reply is not asyncio.current_task():
            log.info("call %s: the user is speaking; the assistant's reply is stopped", self.record.id)
            reply.cancel()
        if self._queued_by == "assistant":
            await self._interrupt()

    async def owner_say_audio(self, pcm16k: bytes, lang: str | None = None) -> str:
        """The user's spoken reply, in their language: transcribed, then said to the
        caller in theirs. Returns what was heard."""
        stt = self.engine.stt
        started = time.monotonic()
        # A quicker model for the user's English where there is one (see FasterWhisperSTT).
        transcribe = getattr(stt, "transcribe_owner", stt.transcribe)
        heard = await transcribe(pcm16k, lang or self.owner_language)
        log.info("call %s: the user's recording was heard in %.2f s", self.record.id, time.monotonic() - started)
        text = heard.text.strip()
        if not text:
            await self._publish("turn_error", detail="Couldn't make out any words in your recording.")
            return ""
        await self.owner_say(text, lang or guess_language(text, default="") or heard.language or None)
        return text

    async def say_now(self, text: str, lang: str | None = None) -> None:
        """The user typed something to be said right away, outside a hold."""
        await self.owner_say(text, lang)

    async def end(self) -> None:
        await self._say(self.conv.fixed_say("goodbye"))
        await self._end_after_playback()

    async def _summary_for_user(self) -> None:
        """The summary, action items and message in the user's own language."""
        rec, target = self.record, self.owner_language
        if target == "en" or not self.engine.store.profile.translate_live:
            return
        rec.summary = await self._translate(rec.summary, "en", target) or rec.summary
        rec.action_items = [await self._translate(a, "en", target) or a for a in rec.action_items]
        if rec.message and guess_language(rec.message, default="en") == "en":
            rec.message = await self._translate(rec.message, "en", target) or rec.message

    # ------------------------------------------------------------ teardown
    async def _finish(self) -> None:
        if self.closed.is_set():
            return
        self.closed.set()
        self._play_q.put_nowait(None)
        for fut in self._hold_waiters.values():
            if not fut.done():
                fut.cancel()
        rec = self.record
        rec.status = CallStatus.ended
        rec.ended_at = time.time()
        await self._set_status("idle")
        if len(self.recorder.caller) > FRAME_BYTES * 10:
            name = f"{rec.id}.wav"
            (self.engine.settings.recordings_dir / name).write_bytes(self.recorder.wav())
            rec.recording = name
        # The model reads the call in English where it went through English.
        transcript = "\n".join(f"{line.speaker}: {line.english or line.text}" for line in rec.transcript
                               if line.kind != "alert")
        if rec.category != "spam" and len(rec.transcript) > 2:
            summary = await self.conv.summarize(transcript)
            rec.summary, rec.action_items = summary.text, summary.action_items
            await self._summary_for_user()
            if summary.urgent and not rec.urgent:
                await self._publish("urgent_call", reason="summary", title=f"Urgent: {self.who}: {rec.summary}")
            rec.urgent = rec.urgent or summary.urgent
            self.engine.refresh_llm_cache()
        self._save()
        await self.engine.on_call_finished(self)

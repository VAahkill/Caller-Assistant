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
from .languages import LanguageTracker, guess_language
from .models import CallRecord, CallStatus, HoldQuestion, TranscriptLine
from .phrases import phrase
from .providers.llm import LLMError
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
                            translation_lang=line.translation_lang)

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
        player = asyncio.create_task(self._player())
        limit = asyncio.create_task(self._time_limit())
        try:
            if not self.conv.outbound:
                await self._speak(self.conv.opening_line(), cached=True)
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
        await self._speak("I'm sorry, I have to wrap up now. I'll pass everything on. Goodbye!")
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
        line = phrase("fallback", self._language)
        self.conv.history.append({"role": "assistant", "content": line})
        await self._speak(line, cached=True)

    async def _handle_utterance(self, pcm: bytes, language_hint: str | None = None, origin: str = "live") -> None:
        await self._set_status("transcribing")
        language = await self._spoken_language(pcm, language_hint or self.language_hint)
        result = await self.engine.stt.transcribe(pcm, language)
        text = result.text.strip()
        if not text:
            if origin == "recording":
                await self._publish("turn_error", detail="Couldn't make out any words in that recording. Please try again.")
            return
        if language is None:  # no language ID: Whisper's guess for this turn
            language = result.language or self._language
            await self._language_heard(self.tracker.choose(language, confidence=0.0))
        await self._caller_turn(text, language)

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

    async def _caller_turn(self, text: str, language: str, english: str | None = None) -> None:
        self._language = language
        self.record.language = language
        await self._line("caller", text, lang=language)
        await self._set_status("thinking")
        await self._run_actions(self.conv.respond(text, language, english), filler=True)

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
    async def _run_actions(self, actions: AsyncIterator[Action], filler: bool = False) -> None:
        fill = self.spawn(self._fillers(), "filler") if filler and self.engine.settings.filler_after_s > 0 else None
        try:
            async with contextlib.aclosing(actions) as stream:  # type: ignore[type-var]
                async for action in stream:
                    if fill and not isinstance(action, (Category, SecurityAlert)):
                        fill.cancel()
                        fill = None
                    if isinstance(action, Say):
                        await self._speak(action.text, already_scrubbed=True)
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
        self._save()

    async def _fillers(self) -> None:
        """'One moment, please' when the reply is slow to start."""
        s = self.engine.settings
        await asyncio.sleep(s.filler_after_s)
        await self._speak(phrase("filler", self._language), cached=True)
        if s.filler_again_s > 0:
            await asyncio.sleep(s.filler_again_s)
            await self._speak(phrase("filler_again", self._language), cached=True)

    async def _speak(self, text: str, already_scrubbed: bool = False, cached: bool = False,
                     lang: str | None = None, record: bool = True) -> None:
        if not already_scrubbed:
            res = scrub_outgoing(text, self.conv.allowed_numbers())
            if res.blocked:
                await self._security_alert(SecurityAlert("blocked_output", text))
                return
            text = res.text
        lang = lang or self._language
        if record:
            await self._line("assistant", text, lang=lang)
        voice = self.engine.store.profile.voice
        tts_lang = lang if lang in self.engine.tts.supported_languages(voice) else "en"
        try:
            pcm = await self.engine.speech(text, voice, tts_lang, cache=cached)
        except Exception as e:
            log.exception("TTS failed for %r", text)
            await self._publish("turn_error", detail=f"Couldn't speak a reply ({e.__class__.__name__}: {e})"[:300])
            return
        if not pcm:
            log.warning("TTS made no audio for %r (%s)", text, tts_lang)
            return
        await self._set_status("speaking")
        for f in frames(pcm):
            self._play_q.put_nowait(f)

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
        await self._line("caller", question, kind="hold_question", lang="en")
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
                    await self._speak(phrase("hold_reminder", self._language), cached=True)
        self._hold_waiters.pop(hold.id, None)
        hold.answer = answer
        hold.answered_at = time.time() if answer else None
        self.record.status = CallStatus.active
        await self._publish("hold_resolved", hold_id=hold.id, answered=answer is not None)
        if self.conv.outbound:
            await self.engine.tasks.on_resumed(self)
        await self._set_status("thinking")
        await self._run_actions(self.conv.resume_after_hold(answer), filler=True)

    async def answer_hold(self, hold_id: str | None, text: str) -> bool:
        """The user typed an answer in the app."""
        if hold_id is None and self._hold_waiters:
            hold_id = next(iter(self._hold_waiters))
        fut = self._hold_waiters.get(hold_id or "")
        if not fut or fut.done():
            return False
        await self._line("user", text, lang=guess_language(text))
        fut.set_result(text)
        return True

    def can_say(self, text: str) -> bool:
        """Whether the user's words would be said (not empty, no code-like number)."""
        return bool(text.strip()) and not scrub_outgoing(text, self.conv.allowed_numbers()).blocked

    async def owner_answer(self, hold_id: str | None, text: str, lang: str | None = None) -> None:
        """The user's reply in the app: the answer to a pending hold question, or else
        words to say to the caller right away."""
        if not await self.answer_hold(hold_id, text):
            await self.owner_say(text, lang)

    async def owner_say(self, text: str, lang: str | None = None) -> bool:
        """Says the user's own words to the caller right away (typed, or spoken and
        transcribed, in the app). Translating them into the caller's language plugs
        in here; until then they are said as written. Returns False if nothing was
        said (empty, or blocked because it contained a code-like number)."""
        text = text.strip()
        if not text:
            return False
        lang = lang or guess_language(text)
        res = scrub_outgoing(text, self.conv.allowed_numbers())
        if res.blocked:
            await self._security_alert(SecurityAlert("blocked_output", text))
            return False
        await self._line("user", res.text, kind="note", lang=lang)
        self.conv.history.append({"role": "assistant", "content": res.text})
        await self._speak(res.text, already_scrubbed=True, lang=lang, record=False)
        return True

    async def owner_say_audio(self, pcm16k: bytes, lang: str | None = None) -> str:
        """The user's spoken reply: transcribed, then said to the caller. Returns what was heard."""
        heard = await self.engine.stt.transcribe(pcm16k, lang)
        text = heard.text.strip()
        if not text:
            await self._publish("turn_error", detail="Couldn't make out any words in your recording.")
            return ""
        await self.owner_say(text, lang or heard.language)
        return text

    async def say_now(self, text: str) -> None:
        """The user typed something to be said right away, outside a hold."""
        await self.owner_say(text)

    async def end(self) -> None:
        await self._speak(f"I have to go now. I'll let {self.engine.store.profile.user_name} know. Bye!")
        await self._end_after_playback()

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
        transcript = "\n".join(f"{l.speaker}: {l.text}" for l in rec.transcript if l.kind != "alert")
        if rec.category != "spam" and len(rec.transcript) > 2:
            rec.summary = await self.conv.summarize(transcript)
            self.engine.refresh_llm_cache()
        self._save()
        await self.engine.on_call_finished(self)

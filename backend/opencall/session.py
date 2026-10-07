"""One live call: audio in, turn-taking, barge-in, speech out, hold, recording."""

from __future__ import annotations

import asyncio
import contextlib
import logging
import time
from collections.abc import AsyncIterator
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
from .models import CallRecord, CallStatus, HoldQuestion, TranscriptLine
from .providers.vad import TurnDetector
from .telephony.base import CallBridge

if TYPE_CHECKING:
    from .engine import Engine

log = logging.getLogger("opencall.session")


class CallSession:
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
        self._respond_task: asyncio.Task | None = None
        self._ending = False
        self._hangup_after_playback = False
        self._hold_waiters: dict[str, asyncio.Future[str]] = {}
        self._language = "en"
        self.closed = asyncio.Event()

    # ------------------------------------------------------------ helpers
    @property
    def who(self) -> str:
        return self.record.contact_name or self.record.number or "Unknown caller"

    async def _publish(self, event: str, **data) -> None:
        await self.engine.bus.publish(event, call_id=self.record.id, who=self.who, **data)

    async def _line(self, speaker: str, text: str, kind: str = "speech") -> None:
        line = TranscriptLine(speaker=speaker, text=text, kind=kind)  # type: ignore[arg-type]
        self.record.transcript.append(line)
        await self._publish("transcript", line=line.model_dump(mode="json"))

    def _save(self) -> None:
        self.engine.store.calls.put(self.record)

    # ------------------------------------------------------------ main loop
    async def run(self) -> None:
        self.record.status = CallStatus.active
        self._save()
        await self._publish("call_started", call=self.record.model_dump(mode="json"))
        player = asyncio.create_task(self._player())
        limit = asyncio.create_task(self._time_limit())
        try:
            if not self.conv.outbound:
                await self._speak(self.conv.opening_line())
            else:
                asyncio.create_task(self._outbound_kickoff())
            async for frame in self.bridge.audio_in():
                if self._ending and not self._hangup_after_playback:
                    break
                await self._on_frame(frame)
        except Exception:
            log.exception("call %s crashed", self.record.id)
        finally:
            await self._finish()
            for t in (player, limit, self._respond_task):
                if t and not t.done():
                    t.cancel()
                    with contextlib.suppress(asyncio.CancelledError, Exception):
                        await t

    async def _outbound_kickoff(self) -> None:
        # Let the callee say "Hello?" first; if they don't within 3 s, start talking.
        await asyncio.sleep(3)
        if not self.record.transcript and self._respond_task is None:
            self._respond_task = asyncio.create_task(self._run_actions(self.conv.start_outbound()))

    async def _time_limit(self) -> None:
        await asyncio.sleep(self.engine.settings.max_call_minutes * 60)
        await self._speak("I'm sorry, I have to wrap up now. I'll pass everything on. Goodbye!")
        await self._end_after_playback()

    async def _on_frame(self, frame: bytes) -> None:
        self.recorder.add_caller(frame)
        event, utterance = self.turns.push(frame)
        # Barge-in: the caller talks over the assistant -> stop speaking at once.
        if self.turns.speaking and self._playing.is_set() and self.turns.voiced_ms >= self.engine.settings.barge_in_ms:
            await self._interrupt()
        if event == "end" and utterance:
            if self.record.status == CallStatus.on_hold:
                return  # caller chatter while on hold is recorded but not answered
            await self._interrupt(cancel_response=True)
            self._respond_task = asyncio.create_task(self._handle_utterance(utterance))

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

    async def _handle_utterance(self, pcm: bytes) -> None:
        result = await self.engine.stt.transcribe(pcm)
        if not result.text.strip():
            return
        await self.handle_text(result.text, result.language)

    async def handle_text(self, text: str, language: str = "en") -> None:
        """Process one thing the other party said (also used by tests and the simulator)."""
        self._language = language or self._language
        self.record.language = self._language
        await self._line("caller", text)
        await self._run_actions(self.conv.respond(text, self._language))

    # ------------------------------------------------------------ actions
    async def _run_actions(self, actions: AsyncIterator[Action]) -> None:
        async for action in actions:
            if isinstance(action, Say):
                await self._speak(action.text, already_scrubbed=True)
            elif isinstance(action, Hold):
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
                link = self.engine.store.profile.location.maps_link()
                if link and await self.bridge.send_sms(f"Location for {self.engine.store.profile.user_name}: {link}"):
                    await self._line("system", "Sent the map link by SMS.", kind="note")
            elif isinstance(action, Outcome):
                await self.engine.tasks.on_outcome(self, action)
            elif isinstance(action, EndCall):
                await self._end_after_playback()
        self._save()

    async def _speak(self, text: str, already_scrubbed: bool = False) -> None:
        if not already_scrubbed:
            res = scrub_outgoing(text, self.conv.allowed_numbers())
            if res.blocked:
                await self._security_alert(SecurityAlert("blocked_output", text))
                return
            text = res.text
        await self._line("assistant", text)
        voice = self.engine.store.profile.voice
        lang = self._language if self._language in self.engine.tts.supported_languages(voice) else "en"
        try:
            pcm = await self.engine.tts.synthesize(text, voice, lang)
        except Exception:
            log.exception("TTS failed")
            return
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
            next_at = max(next_at + FRAME_MS / 1000, time.monotonic() - 0.2)
            await asyncio.sleep(max(0, next_at - time.monotonic()))
            if self._play_q.empty():
                self._playing.clear()
                next_at = time.monotonic()

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

        asyncio.create_task(_later())

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
        await self._line("caller", question, kind="hold_question")
        event = "task_needs_decision" if self.conv.outbound else "hold_question"
        await self._publish(event, hold_id=hold.id, question=question,
                            title=f"{self.who}: {question}", task_id=self.record.task_id)
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
                    await self._speak("Still checking, thanks for waiting.")
        self._hold_waiters.pop(hold.id, None)
        hold.answer = answer
        hold.answered_at = time.time() if answer else None
        self.record.status = CallStatus.active
        await self._publish("hold_resolved", hold_id=hold.id, answered=answer is not None)
        if self.conv.outbound:
            await self.engine.tasks.on_resumed(self)
        await self._run_actions(self.conv.resume_after_hold(answer))

    async def answer_hold(self, hold_id: str | None, text: str) -> bool:
        """The user typed an answer in the app."""
        if hold_id is None and self._hold_waiters:
            hold_id = next(iter(self._hold_waiters))
        fut = self._hold_waiters.get(hold_id or "")
        if not fut or fut.done():
            return False
        await self._line("user", text)
        fut.set_result(text)
        return True

    async def say_now(self, text: str) -> None:
        """The user typed something to be said right away, outside a hold."""
        await self._line("user", text, kind="note")
        self.conv.history.append({"role": "assistant", "content": text})
        await self._speak(text)

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
        if len(self.recorder.caller) > FRAME_BYTES * 10:
            name = f"{rec.id}.wav"
            (self.engine.settings.recordings_dir / name).write_bytes(self.recorder.wav())
            rec.recording = name
        transcript = "\n".join(f"{l.speaker}: {l.text}" for l in rec.transcript if l.kind != "alert")
        if rec.category != "spam" and len(rec.transcript) > 2:
            rec.summary = await self.conv.summarize(transcript)
        self._save()
        await self.engine.on_call_finished(self)

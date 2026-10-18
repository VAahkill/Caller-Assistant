"""Outbound concierge calls: "check if a table for 3 is free at 8", "book it",
and callbacks that carry the user's reply to someone who left a message.

A practice task is the same call made in the app (/ws/simulate), with the user
playing the place called: it is created here and connected by the practice socket
instead of a dialer, and from then on runs exactly like a real one."""

from __future__ import annotations

import logging
import time
from typing import TYPE_CHECKING

from .agent import Outcome
from .models import CallerMessage, MessageStatus, Task, TaskKind, TaskStatus, new_id
from .screening import normalize_number
from .telephony.base import PhoneLineError

if TYPE_CHECKING:
    from .engine import Engine
    from .session import CallSession

log = logging.getLogger("opencall.tasks")


class TaskManager:
    def __init__(self, engine: "Engine"):
        self.engine = engine
        self.pending_calls: dict[str, str] = {}  # call_id -> task_id while dialing

    def _save(self, task: Task) -> Task:
        task.updated_at = time.time()
        return self.engine.store.tasks.put(task)

    async def _publish(self, task: Task, title: str, event: str = "task_update") -> None:
        if task.practice:  # so a notification is never mistaken for a real call
            title = f"Practice: {title}"
        await self.engine.bus.publish(event, task=task.model_dump(mode="json"), task_id=task.id, title=title)

    async def create(self, kind: TaskKind, number: str, goal: str, target_name: str = "",
                     practice: bool = False) -> Task:
        """A new task, and its call: dialled now, or for a practice task waiting for
        the practice socket to connect it (as ``task.call_id``)."""
        profile = self.engine.store.profile
        task = Task(kind=kind, number=normalize_number(number, profile.home_country_code), goal=goal.strip(),
                    target_name=target_name, practice=practice)
        self._save(task)
        if practice:
            await self._calling(task)
        else:
            await self.start(task)
        return task

    async def _calling(self, task: Task) -> str:
        """Marks the task as calling; the call finds it by its id when it connects."""
        call_id = new_id()
        task.call_id = call_id
        task.status = TaskStatus.dialing
        self.pending_calls[call_id] = task.id
        self._save(task)
        await self._publish(task, f"Calling {task.target_name or task.number}...")
        return call_id

    async def start(self, task: Task) -> None:
        call_id = await self._calling(task)
        try:
            await self.engine.dialer.dial(task.number, call_id)
            return
        except PhoneLineError as e:  # no line, or it can't place calls: the reason is for the user
            log.warning("Couldn't call %s: %s", task.number, e)
            reason = str(e)
        except Exception as e:
            log.warning("Couldn't call %s: %s: %s", task.number, e.__class__.__name__, e)
            reason = "The call couldn't be started because of a problem on the server. Its log says what went wrong."
        await self.fail(task, reason, f"Couldn't place the call: {reason}")

    async def fail(self, task: Task, reason: str, title: str = "") -> None:
        if task.call_id:
            self.pending_calls.pop(task.call_id, None)
        task.status = TaskStatus.failed
        task.outcome = "failed"
        task.result = reason
        self._save(task)
        await self._publish(task, title or f"{task.target_name or task.number}: {reason}")

    async def end_if_unfinished(self, task_id: str) -> None:
        """A call that ended without reporting back (a practice socket that closed
        before its call started) ends its task too: it never stays "dialing"."""
        task = self.engine.store.tasks.get(task_id)
        if task and task.status not in (TaskStatus.done, TaskStatus.failed):
            await self.fail(task, "The call ended before a result.")

    def task_for_call(self, call_id: str) -> Task | None:
        task_id = self.pending_calls.pop(call_id, None)
        return self.engine.store.tasks.get(task_id) if task_id else None

    async def on_connected(self, task: Task, session: "CallSession") -> None:
        task.status = TaskStatus.in_call
        self._save(task)
        await self._publish(task, f"Connected to {task.target_name or task.number}")

    async def on_waiting_user(self, session: "CallSession") -> None:
        task = self._task_of(session)
        if task:
            task.status = TaskStatus.waiting_user
            self._save(task)

    async def on_resumed(self, session: "CallSession") -> None:
        task = self._task_of(session)
        if task:
            task.status = TaskStatus.in_call
            self._save(task)

    async def on_outcome(self, session: "CallSession", outcome: Outcome) -> None:
        task = self._task_of(session)
        if not task:
            return
        task.outcome = outcome.status
        task.result = outcome.summary
        task.status = TaskStatus.failed if outcome.status == "failed" else TaskStatus.done
        self._save(task)
        await self._publish(task, f"{task.target_name or task.number}: {outcome.summary or outcome.status}")

    async def on_call_ended(self, session: "CallSession") -> None:
        task = self._task_of(session)
        if not task or task.status in (TaskStatus.done, TaskStatus.failed):
            return
        # The call ended without an explicit outcome; report what we have.
        task.status = TaskStatus.done if session.record.summary else TaskStatus.failed
        task.outcome = task.outcome or ("unknown" if session.record.summary else "failed")
        task.result = task.result or session.record.summary or "The call ended before a result."
        self._save(task)
        await self._publish(task, f"{task.target_name or task.number}: {task.result}")

    def _task_of(self, session: "CallSession") -> Task | None:
        tid = session.record.task_id
        return self.engine.store.tasks.get(tid) if tid else None

    async def reply_to_message(self, msg: CallerMessage, reply: str, call_back: bool) -> CallerMessage:
        msg.reply = reply
        msg.status = MessageStatus.replied
        if call_back:
            task = await self.create(TaskKind.callback, msg.number, reply, target_name=msg.caller_name)
            msg.callback_task_id = task.id
        self.engine.store.messages.put(msg)
        return msg

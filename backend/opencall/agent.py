"""The conversation brain, independent of audio.

``Conversation`` turns what the other party said into a stream of actions
(say this sentence, put the call on hold, end the call, ...). The audio layer in
``session.py`` executes them. Keeping this text-only makes the call logic easy
to test without any speech models.
"""

from __future__ import annotations

import re
from collections.abc import AsyncIterator
from dataclasses import dataclass, field

from . import prompts
from .guardrails import detect_sensitive_request, published_numbers, refusal, scrub_outgoing
from .models import Profile, Task
from .providers.llm import LLM, Message
from .screening import classify_utterance


# ---------------------------------------------------------------- actions
@dataclass
class Say:
    text: str


@dataclass
class Hold:
    question: str
    sensitive: bool = False


@dataclass
class TakeMessage:
    text: str


@dataclass
class EndCall:
    pass


@dataclass
class Category:
    value: str


@dataclass
class Outcome:
    status: str
    summary: str


@dataclass
class SendLocation:
    pass


@dataclass
class SecurityAlert:
    kind: str
    detail: str


Action = Say | Hold | TakeMessage | EndCall | Category | Outcome | SendLocation | SecurityAlert


# ---------------------------------------------------------------- parsing
_TAG_RE = re.compile(r"\[(HOLD|MESSAGE|END_CALL|CATEGORY|OUTCOME|SEND_LOCATION)(?::\s*([^\]]*))?\]", re.I)
_SENTENCE_END = re.compile(r"([.!?।]+[\"')\]]?)(\s+|$)|\n+")


def _tag_to_action(name: str, payload: str) -> Action | None:
    name = name.upper()
    payload = (payload or "").strip()
    if name == "HOLD":
        return Hold(payload or "The caller has a question.")
    if name == "MESSAGE":
        return TakeMessage(payload)
    if name == "END_CALL":
        return EndCall()
    if name == "CATEGORY":
        return Category(payload.lower() or "unknown")
    if name == "SEND_LOCATION":
        return SendLocation()
    if name == "OUTCOME":
        status, _, summary = payload.partition("|")
        return Outcome(status.strip().lower() or "unknown", summary.strip())
    return None


class TagStreamParser:
    """Splits a streamed LLM reply into speakable sentences and control tags.

    Sentences are released as soon as they end, so text-to-speech can start on
    the first sentence while the model is still writing the second one.
    """

    def __init__(self) -> None:
        self.buf = ""

    def feed(self, chunk: str) -> list[Action]:
        self.buf += chunk
        return self._drain(final=False)

    def close(self) -> list[Action]:
        return self._drain(final=True)

    def _drain(self, final: bool) -> list[Action]:
        out: list[Action] = []
        while True:
            # Never cut inside a tag that hasn't closed yet.
            open_idx = self.buf.rfind("[")
            pending_tag = open_idx != -1 and "]" not in self.buf[open_idx:]
            tag = _TAG_RE.search(self.buf)
            sent = _SENTENCE_END.search(self.buf)
            if tag and (not sent or tag.start() <= sent.start()):
                before = self.buf[: tag.start()].strip()
                if before:
                    out.append(Say(before))
                action = _tag_to_action(tag.group(1), tag.group(2) or "")
                if action:
                    out.append(action)
                self.buf = self.buf[tag.end() :]
                continue
            if sent and not (pending_tag and open_idx < sent.end()):
                text = self.buf[: sent.end()].strip()
                self.buf = self.buf[sent.end() :]
                if text and re.search(r"\w", text):
                    out.append(Say(text))
                continue
            break
        if final:
            rest = re.sub(r"\[[^\]]*$", "", self.buf).strip()  # drop a dangling half tag
            if rest and re.search(r"\w", rest):
                out.append(Say(rest))
            self.buf = ""
        return out


# ---------------------------------------------------------------- conversation
@dataclass
class Conversation:
    profile: Profile
    llm: LLM
    system_prompt: str
    caller_number: str = ""
    is_contact: bool = False
    outbound: bool = False
    category: str = "unknown"
    history: list[Message] = field(default_factory=list)
    _location_shared: bool = False
    _turns: int = 0

    @classmethod
    def inbound(cls, profile: Profile, llm: LLM, number: str, contact_name: str, speakable: list[str]) -> "Conversation":
        prompt = prompts.inbound_system_prompt(profile, number, contact_name, speakable)
        return cls(profile, llm, prompt, caller_number=number, is_contact=bool(contact_name),
                   category="contact" if contact_name else "unknown")

    @classmethod
    def for_task(cls, profile: Profile, llm: LLM, task: Task, speakable: list[str]) -> "Conversation":
        prompt = prompts.outbound_system_prompt(profile, task, speakable)
        return cls(profile, llm, prompt, caller_number=task.number, outbound=True, category="task")

    # What the assistant is allowed to say out loud, number-wise.
    def allowed_numbers(self) -> set[str]:
        p = self.profile
        texts = [p.location.address, p.location.building, p.location.floor_unit, p.location.landmarks,
                 p.location.gate_instructions, p.location.geocoded_hint, self.caller_number]
        texts += [n.text for n in p.knowledge]
        texts += [m["content"] for m in self.history if m["role"] == "user"]  # numbers the other party said
        if self.outbound:
            texts += [m["content"] for m in self.history if m["role"] == "system"]
        return published_numbers(*texts)

    def _messages(self) -> list[Message]:
        return [{"role": "system", "content": self.system_prompt}, *self.history[-30:]]

    def opening_line(self) -> str:
        p = self.profile
        return (
            f"Hi, this is {p.assistant_name}, {p.user_name}'s assistant. "
            f"{p.user_name} can't take the call right now. How can I help?"
        )

    async def respond(self, text: str, language: str = "en") -> AsyncIterator[Action]:
        """Handle one turn from the other party."""
        self._turns += 1
        self.history.append({"role": "user", "content": text})

        match = detect_sensitive_request(text)
        if match:
            line = refusal(language, self.profile.user_name)
            self.history.append({"role": "assistant", "content": line})
            yield SecurityAlert(match.kind, text)
            yield Say(line)
            return

        if not self.outbound and self.category in ("unknown", "contact"):
            hint = classify_utterance(text)
            if hint == "spam" and not self.is_contact:
                self.category = "spam"
                line = "Thanks, but we're not interested. Please remove this number from your list. Bye!"
                self.history.append({"role": "assistant", "content": line})
                yield Category("spam")
                yield Say(line)
                yield EndCall()
                return
            if hint == "delivery":
                self._enter_delivery_mode()
                yield Category("delivery")

        async for action in self._generate():
            yield action

    async def resume_after_hold(self, answer: str | None) -> AsyncIterator[Action]:
        note = (
            prompts.hold_answer_note(self.profile.user_name, answer)
            if answer
            else prompts.hold_timeout_note(self.profile.user_name)
        )
        self.history.append({"role": "system", "content": note})
        async for action in self._generate():
            yield action

    async def start_outbound(self) -> AsyncIterator[Action]:
        """Used when nobody speaks first after an outbound call connects."""
        self.history.append({"role": "system", "content": "The call just connected. Greet them and state why you're calling."})
        async for action in self._generate():
            yield action

    def _enter_delivery_mode(self) -> None:
        self.category = "delivery"
        if not self._location_shared:
            self._location_shared = True
            self.history.append({"role": "system", "content": prompts.delivery_context(self.profile)})

    async def _generate(self) -> AsyncIterator[Action]:
        parser = TagStreamParser()
        spoken: list[str] = []
        allowed = self.allowed_numbers()
        stop = False

        def handle(actions: list[Action]):
            nonlocal stop
            for a in actions:
                if isinstance(a, Say):
                    res = scrub_outgoing(a.text, allowed)
                    if res.blocked:
                        yield SecurityAlert("blocked_output", a.text)
                        continue
                    spoken.append(res.text)
                    yield Say(res.text)
                elif isinstance(a, Category):
                    if a.value == "delivery":
                        self._enter_delivery_mode()
                    self.category = a.value if not self.outbound else self.category
                    yield a
                else:
                    yield a
                    if isinstance(a, Hold):
                        stop = True  # wait for the user before saying anything else
                        return

        async for chunk in self.llm.stream(self._messages()):
            for out in handle(parser.feed(chunk)):
                yield out
            if stop:
                break
        if not stop:
            for out in handle(parser.close()):
                yield out
        self.history.append({"role": "assistant", "content": " ".join(spoken)})

    async def summarize(self, transcript: str) -> str:
        msgs: list[Message] = [
            {"role": "system", "content": prompts.SUMMARY_PROMPT},
            {"role": "user", "content": transcript[-6000:]},
        ]
        out = []
        try:
            async for chunk in self.llm.stream(msgs):
                out.append(chunk)
        except Exception:  # summaries are nice-to-have
            return ""
        return re.sub(r"\[[^\]]*\]", "", "".join(out)).strip()

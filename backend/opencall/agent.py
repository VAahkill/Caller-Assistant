"""The conversation brain, independent of audio.

``Conversation`` turns what the other party said into a stream of actions
(say this sentence, put the call on hold, end the call, ...). The audio layer in
``session.py`` executes them. Keeping this text-only makes the call logic easy
to test without any speech models.
"""

from __future__ import annotations

import logging
import re
from collections.abc import AsyncIterator, Callable
from contextlib import aclosing
from dataclasses import dataclass, field

from . import prompts
from .guardrails import detect_sensitive_request, published_numbers, scrub_outgoing
from .languages import full_stop_ends_sentence
from .models import Profile, Task
from .phrases import fill, phrase
from .providers.llm import LLM, Message
from .screening import classify_utterance

log = logging.getLogger("opencall.agent")

# ---------------------------------------------------------------- actions
@dataclass
class Say:
    """Words for the other party. ``fixed`` names a fixed line (see phrases.py): ``text``
    is then its English, and the call says it in the caller's language from the
    hand-written or cached translation."""

    text: str
    fixed: str = ""


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
# A model that was handed a prompt without the assistant header writes the header itself
# ("assistant\n\nSure..."); that word must never be spoken.
_LEAKED_ROLE = re.compile(r"\s*(?:<\|start_header_id\|>\s*)?assistant\s*(?:<\|end_header_id\|>)?[ \t]*(?::|\n|$)", re.I)
_ROLE_HEADS = ("assistant", "<|start_header_id|>assistant<|end_header_id|>")
# A model's reasoning, when the server leaves it in the reply text: never spoken.
_THINK = re.compile(r"<think>.*?</think>\s*", re.S | re.I)


def _maybe_role_header(head: str) -> bool:
    """Whether the start of a reply could still turn out to be a leaked role header."""
    h = head.lstrip().lower()
    return any(r.startswith(h) for r in _ROLE_HEADS) or bool(
        re.fullmatch(r"(?:<\|start_header_id\|>\s*)?assistant\s*(?:<\|end_header_id\|>)?[ \t]*", h)
    )


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
        self._head_checked = False

    def feed(self, chunk: str) -> list[Action]:
        self.buf += chunk
        return self._drain(final=False)

    def close(self) -> list[Action]:
        return self._drain(final=True)

    def _drain(self, final: bool) -> list[Action]:
        held = self._hold_back_thinking(final)
        out = self._drain_text(final)
        self.buf += held
        return out

    def _hold_back_thinking(self, final: bool) -> str:
        """Drops finished <think> blocks and holds back one still being written (it is
        dropped if the reply ends inside it). Returns the held-back text."""
        self.buf = _THINK.sub("", self.buf)
        start = self.buf.lower().find("<think>")
        if start == -1:
            return ""
        held, self.buf = self.buf[start:], self.buf[:start]
        return "" if final else held

    def _sentence_end(self, final: bool) -> re.Match | None:
        """Where the first sentence in the buffer ends, if it does: the full stop of
        "Dr." or of "No." before a number doesn't end one."""
        for m in _SENTENCE_END.finditer(self.buf):
            if m.group(1) is None or m.group(1).rstrip("\"')]") != "." or "\n" in m.group(2):
                return m
            after = self.buf[m.end() :]
            ends = full_stop_ends_sentence(self.buf[: m.start()], after if after or final else None)
            if ends is None:
                return None  # wait for the next words
            if ends:
                return m
        return None

    def _drain_text(self, final: bool) -> list[Action]:
        out: list[Action] = []
        if not self._head_checked:
            leaked = _LEAKED_ROLE.match(self.buf)
            if leaked and (final or self.buf[leaked.end() - 1 : leaked.end()] in (":", "\n")):
                self.buf = self.buf[leaked.end() :]
            elif not final and _maybe_role_header(self.buf):
                return out  # wait for more text before deciding
            self._head_checked = True
        while True:
            # Never cut inside a tag that hasn't closed yet.
            open_idx = self.buf.rfind("[")
            pending_tag = open_idx != -1 and "]" not in self.buf[open_idx:]
            tag = _TAG_RE.search(self.buf)
            sent = self._sentence_end(final)
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
    """The LLM side of one call.

    The message list sent to the model is always one system message (the call's
    prompt plus this turn's context: delivery details, reply language) followed by
    alternating user/assistant turns, and it always ends with a user turn. Notes from
    the user's side (a hold answer, "the call just connected") are user turns marked
    as private notes, never trailing system messages. An answered call's turns start
    with the greeting the caller heard, as the assistant's own first turn: told about
    it only in the system message, small models said it again as their first reply.
    """

    profile: Profile
    llm: LLM
    system_prompt: str
    caller_number: str = ""
    is_contact: bool = False
    outbound: bool = False
    category: str = "unknown"
    history: list[Message] = field(default_factory=list)
    opening: str = ""  # the greeting the caller heard, in English (answered calls)
    can_text: bool = False  # whether this phone line can send the caller an SMS
    language: str = ""  # the caller's language; empty until they speak
    vip: bool = False  # the caller is on the user's VIP list
    # The English of what the user wrote in another language (instructions, notes,
    # directions), from the engine's translation cache.
    english: Callable[[str], str] = field(default=lambda t: t, repr=False)
    # Whether this turn goes through English: the caller's words were translated into
    # English for the model, and its English reply is translated back for the caller.
    pivot: bool = False
    heard: list[str] = field(default_factory=list)  # the other party's own words
    _delivery: bool = False
    _turns: int = 0

    @classmethod
    def inbound(cls, profile: Profile, llm: LLM, number: str, contact_name: str, speakable: list[str],
                can_text: bool = False, vip: bool = False,
                english: Callable[[str], str] | None = None) -> "Conversation":
        can_text = can_text and bool(number)
        english = english or (lambda t: t)
        prompt = prompts.inbound_system_prompt(profile, number, contact_name, speakable, can_text,
                                               opening_line=opening_line(profile, english), vip=vip,
                                               english=english)
        return cls(profile, llm, prompt, caller_number=number, is_contact=bool(contact_name),
                   category="contact" if contact_name else "unknown", can_text=can_text, vip=vip,
                   english=english, opening=opening_line(profile, english))

    @classmethod
    def for_task(cls, profile: Profile, llm: LLM, task: Task, speakable: list[str],
                 english: Callable[[str], str] | None = None) -> "Conversation":
        english = english or (lambda t: t)
        prompt = prompts.outbound_system_prompt(profile, task, speakable, english)
        return cls(profile, llm, prompt, caller_number=task.number, outbound=True, category="task",
                   english=english)

    # What the assistant is allowed to say out loud, number-wise.
    def allowed_numbers(self) -> set[str]:
        p = self.profile
        texts = [p.location.address, p.location.building, p.location.floor_unit, p.location.landmarks,
                 p.location.gate_instructions, p.location.geocoded_hint, self.caller_number]
        texts += [n.text for n in p.knowledge]
        texts += self.heard
        for m in self.history:
            if m["role"] != "user":
                continue
            # Numbers the other party said; on our own outbound calls also those in the
            # user's notes (the booking time they agreed to, say).
            if self.outbound or not prompts.is_private_note(m["content"]):
                texts.append(m["content"])
        return published_numbers(*texts)

    def system_message(self) -> str:
        parts = [self.system_prompt.rstrip()]
        if self._delivery:
            rules = prompts.call_rules(self.profile, prompts.Caller(self.caller_number, self.is_contact, self.vip),
                                       self.english)
            parts.append(prompts.delivery_context(self.profile, self.can_text, rules.delivery, rules.delivery_facts,
                                                  self.english))
        parts.append(prompts.language_note(self.language, self.pivot))
        return "\n\n".join(parts)

    def _messages(self, history: list[Message] | None = None) -> list[Message]:
        """System message first, then strictly alternating turns ending with a user turn
        (strict chat templates such as Gemma's reject anything else)."""
        turns: list[Message] = []
        greeting: list[Message] = [
            {"role": "user", "content": prompts.call_answered_note(self.profile.user_name)},
            {"role": "assistant", "content": self.opening},
        ] if self.opening else []
        for m in greeting + (self.history if history is None else history)[-30:]:
            if m["role"] not in ("user", "assistant") or not m["content"].strip():
                continue
            if turns and turns[-1]["role"] == m["role"]:
                turns[-1] = {"role": m["role"], "content": turns[-1]["content"] + "\n" + m["content"]}
            else:
                turns.append({"role": m["role"], "content": m["content"]})
        while turns and turns[0]["role"] != "user":
            turns.pop(0)
        if not turns or turns[-1]["role"] != "user":
            raise RuntimeError("the conversation has no new turn to answer")
        return [{"role": "system", "content": self.system_message()}, *turns]

    def warm_up_messages(self) -> list[Message]:
        """A request shaped like a real first turn, so a local LLM loads the model and
        caches the prompt before the first call."""
        return self._messages([{"role": "user", "content": "Hello?"}])

    def opening_line(self) -> str:
        return opening_line(self.profile, self.english)

    def fixed_say(self, key: str) -> Say:
        """A fixed line; the history keeps it in the language the model is working in."""
        english = fill(phrase(key, "en"), self.profile.user_name, self.profile.assistant_name)
        said = english if self.pivot else fill(phrase(key, self.language), self.profile.user_name,
                                                self.profile.assistant_name)
        self.history.append({"role": "assistant", "content": said})
        return Say(english, fixed=key)

    async def respond(self, text: str, language: str = "en", english: str | None = None) -> AsyncIterator[Action]:
        """Handle one turn from the other party. ``english`` is the same words in
        English when they were translated: the model then works in English (history
        included) and its reply is translated back. The safety checks look at both."""
        self._turns += 1
        self.language = language or self.language
        self.pivot = english is not None and self.language != "en"
        self.heard.append(text)
        self.history.append({"role": "user", "content": english if self.pivot else text})

        match = detect_sensitive_request(text, english)
        if match:
            yield SecurityAlert(match.kind, text)
            yield self.fixed_say("refusal")
            return

        if not self.outbound and self.category in ("unknown", "contact"):
            hint = classify_utterance(text, english)
            if hint == "spam" and not self.is_contact and not self.vip:
                self.category = "spam"
                yield Category("spam")
                yield self.fixed_say("spam_decline")
                yield EndCall()
                return
            if hint == "delivery":
                self._enter_delivery_mode()
                yield Category("delivery")

        async with aclosing(self._generate()) as actions:
            async for action in actions:
                yield action

    async def resume_after_hold(self, answer: str | None) -> AsyncIterator[Action]:
        """``answer``: what the user replied, in English (or the caller's language when
        the call doesn't go through English)."""
        note = (
            prompts.hold_answer_note(self.profile.user_name, answer)
            if answer
            else prompts.hold_timeout_note(self.profile.user_name)
        )
        self.history.append({"role": "user", "content": note})
        async with aclosing(self._generate()) as actions:
            async for action in actions:
                yield action

    async def start_outbound(self) -> AsyncIterator[Action]:
        """Used when nobody speaks first after an outbound call connects."""
        self.history.append({"role": "user", "content": prompts.outbound_kickoff_note(self.profile.user_name)})
        async with aclosing(self._generate()) as actions:
            async for action in actions:
                yield action

    def _enter_delivery_mode(self) -> None:
        self.category = "delivery"
        self._delivery = True

    async def _generate(self) -> AsyncIterator[Action]:
        parser = TagStreamParser()
        spoken: list[str] = []
        allowed = self.allowed_numbers()
        stop = False
        acted = False  # put them on hold, ended the call or texted them

        def handle(actions: list[Action]):
            nonlocal stop, acted
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
                    if isinstance(a, (Hold, EndCall)) and not spoken and not acted:
                        # Small models sometimes do this without a word; nobody is put on
                        # hold or hung up on in silence.
                        log.warning("The model chose %s without saying anything; saying a fixed line first.",
                                    type(a).__name__)
                        yield self.fixed_say("filler" if isinstance(a, Hold) else "goodbye")
                    acted = acted or isinstance(a, (Hold, EndCall, SendLocation))
                    yield a
                    if isinstance(a, Hold):
                        stop = True  # wait for the user before saying anything else
                        return

        try:
            # aclosing: when the turn is cancelled (hang-up, barge-in) the HTTP stream is
            # closed at once, which tells Ollama to stop generating.
            async with aclosing(self.llm.stream(self._messages())) as chunks:
                async for chunk in chunks:
                    for out in handle(parser.feed(chunk)):
                        yield out
                    if stop:
                        break
            if not stop:
                for out in handle(parser.close()):
                    yield out
                if not spoken and not acted:
                    # An empty reply (or one that was all tags) would leave the caller
                    # waiting in silence.
                    log.warning("The model's reply had nothing to say to the caller; asking them to repeat.")
                    yield self.fixed_say("fallback")
        finally:
            # Keep what was actually said, even if the turn was cut short.
            if spoken:
                self.history.append({"role": "assistant", "content": " ".join(spoken)})

    async def summarize(self, transcript: str) -> "CallSummary":
        msgs: list[Message] = [
            {"role": "system", "content": prompts.SUMMARY_PROMPT.format(user=self.profile.user_name)},
            {"role": "user", "content": transcript[-6000:]},
        ]
        out = []
        try:
            async for chunk in self.llm.stream(msgs):
                out.append(chunk)
        except Exception as e:  # a summary is nice to have; the transcript is kept anyway
            log.warning("call summary failed: %s", e)
            return CallSummary("")
        return parse_summary("".join(out))


@dataclass
class CallSummary:
    text: str
    urgent: bool = False
    action_items: list[str] = field(default_factory=list)


_LABEL = re.compile(r"^\s*[*_#]*\s*(summary|urgent|action items?|actions?|to ?dos?|next steps?)\s*[*_]*\s*:"
                    r"\s*[*_]*\s*(.*)$", re.I)
_NOTHING = ("none", "no", "nothing", "-", "n/a")


def parse_summary(raw: str) -> CallSummary:
    """Reads the model's "Summary: / Urgent: / Actions:" answer. A model that ignores
    the format still gives a summary: its whole answer."""
    text = re.sub(r"\[[^\]]*\]", "", raw).strip()
    text = re.sub(r"^(here is|here's)[^:\n]*:\s*", "", text, flags=re.I).strip()
    summary: list[str] = []
    urgent = False
    actions: list[str] = []
    section = ""
    labelled = False
    for line in text.splitlines():
        m = _LABEL.match(line)
        if m:
            labelled = True
            label, item = m.group(1).lower(), m.group(2).strip()
            section = label if label in ("summary", "urgent") else "actions"
            if section == "urgent":
                urgent = item.lower().startswith(("yes", "true"))
                continue
        else:
            item = line.strip()
        if not item:
            continue
        if section == "actions":
            item = re.sub(r"^([-*•]|\d+[.)])\s*", "", item).strip()
            if item and item.lower().rstrip(".") not in _NOTHING:
                actions.append(item)
        elif section in ("summary", ""):
            summary.append(item)
    if not labelled:
        return CallSummary(text)
    return CallSummary(" ".join(summary).strip(), urgent, actions[:5])


def greeting_parts(profile: Profile, english: Callable[[str], str] = lambda t: t) -> list[tuple[str, str]]:
    """The greeting as (fixed line key or "" for the away status, its English)."""
    def line(key: str) -> tuple[str, str]:
        return key, fill(phrase(key, "en"), profile.user_name, profile.assistant_name)

    away = prompts.away_sentence(profile, english)
    middle = ("", away) if away else line("greeting_busy")
    return [line("greeting_intro"), middle, line("greeting_help")]


def opening_line(profile: Profile, english: Callable[[str], str] = lambda t: t) -> str:
    """The English greeting, e.g. "Hi, this is Ava, Rahul's assistant. Rahul is in a
    meeting until 3 PM. How can I help?" """
    return " ".join(text for _, text in greeting_parts(profile, english))

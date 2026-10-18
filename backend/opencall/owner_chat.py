"""The user talking to their own assistant: "call this restaurant and check if a
table for 3 is free at 8", "from now on tell couriers to leave parcels with the
guard", "I'm available now"."""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from .models import Instruction, KnowledgeNote, TaskKind
from .telephony.base import line_status

if TYPE_CHECKING:
    from .engine import Engine

PROMPT = """\
You are {assistant}, {user}'s phone assistant, chatting with {user} (your boss) in the app.
You can do these things by writing a tag on its own line. Tags are hidden from {user}.
- [CALL: enquire|book|custom | <phone number> | <place name or ""> | <goal in one sentence>]
    Place a phone call for them. Use "enquire" when they only want to check, "book" when
    they say book/reserve/confirm. If no phone number is known, ask for it.
- [INSTRUCTION: <rule for handling calls>]  e.g. "Tell couriers to leave parcels with the guard."
- [NOTE: <fact callers may be told>]          e.g. "I'm travelling until Friday."
- [AVAILABLE: yes|no]  whether {user} can answer hold questions right now.
- [ASSISTANT: on|off]  turn call answering on or off.
After the tag, confirm in one short friendly sentence. If something is unclear, ask.
Phone number shared with this message, if any: {shared}
"""

_TAG = re.compile(r"\[(CALL|INSTRUCTION|NOTE|AVAILABLE|ASSISTANT):\s*([^\]]*)\]", re.I)
_PHONE = re.compile(r"(?:\+?\d[\d\s().-]{7,}\d)")


def extract_phone(text: str) -> str:
    """Pick a phone number out of shared text (a Maps listing, a WhatsApp forward...)."""
    m = _PHONE.search(text or "")
    return re.sub(r"[^\d+]", "", m.group(0)) if m else ""


@dataclass
class OwnerReply:
    text: str
    actions: list[dict] = field(default_factory=list)


async def handle_owner_message(engine: "Engine", text: str, shared: str = "", history: list[dict] | None = None) -> OwnerReply:
    profile = engine.store.profile
    shared_number = extract_phone(shared) or extract_phone(text)
    system = PROMPT.format(assistant=profile.assistant_name, user=profile.user_name, shared=shared_number or "none")
    content = text if not shared else f"{text}\n\n(Shared with this message: {shared})"
    messages = [{"role": "system", "content": system}, *(history or [])[-10:], {"role": "user", "content": content}]
    raw = "".join([c async for c in engine.llm.stream(messages)])

    actions: list[dict] = []
    refused: list[str] = []  # calls asked for that the phone line can't make
    for m in _TAG.finditer(raw):
        kind, payload = m.group(1).upper(), m.group(2).strip()
        if kind == "CALL":
            parts = [p.strip().strip('"') for p in payload.split("|")]
            while len(parts) < 4:
                parts.append("")
            mode, number, name, goal = parts[:4]
            number = extract_phone(number) or shared_number
            if not number:
                continue
            line = await line_status(engine.dialer, fresh=True)
            if not line.outbound:
                refused.append(f"I can't call {name or number} yet. {line.detail} You can practise the call on "
                               "the Call for me tab.")
                continue
            task_kind = TaskKind(mode) if mode in TaskKind._value2member_map_ else TaskKind.custom
            task = await engine.tasks.create(task_kind, number, goal or text, target_name=name)
            actions.append({"type": "task_created", "task": task.model_dump(mode="json")})
        elif kind == "INSTRUCTION":
            profile.instructions.append(Instruction(text=payload))
            actions.append({"type": "instruction_added", "text": payload})
        elif kind == "NOTE":
            profile.knowledge.append(KnowledgeNote(text=payload))
            actions.append({"type": "note_added", "text": payload})
        elif kind == "AVAILABLE":
            profile.available = payload.lower().startswith("y")
            actions.append({"type": "availability", "available": profile.available})
        elif kind == "ASSISTANT":
            profile.enabled = payload.lower() == "on"
            actions.append({"type": "enabled", "enabled": profile.enabled})
    if actions:
        engine.store.save_profile()
    # The model's words would say it is calling, so a refused call replaces them.
    reply = " ".join(refused) or _TAG.sub("", raw).strip() or "Done."
    return OwnerReply(text=reply, actions=actions)

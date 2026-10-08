"""Data models shared by the API, the call engine and the store."""

from __future__ import annotations

import re
import time
import uuid
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator

LANGUAGE_CODE = re.compile(r"^[a-z]{2,3}$")


def language_codes(value: list[str]) -> list[str]:
    """Lower-case language codes, each once; English if none."""
    codes = list(dict.fromkeys(code.strip().lower() for code in value if code.strip()))
    bad = [c for c in codes if not LANGUAGE_CODE.match(c)]
    if bad:
        raise ValueError(f"not language codes: {', '.join(bad)} (use codes like en, hi, te, ta)")
    return codes or ["en"]


def voice_per_language(value: dict[str, str]) -> dict[str, str]:
    """{language code: voice id}, e.g. {"te": "piper:te_IN-padmavathi-medium"}."""
    out = {}
    for lang, voice in value.items():
        lang, voice = lang.strip().lower(), voice.strip()
        if not LANGUAGE_CODE.match(lang) or ":" not in voice:
            raise ValueError(f"expected a language code and a voice id like kokoro:af_heart, got {lang}: {voice}")
        out[lang] = voice
    return out


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def now() -> float:
    return time.time()


class Location(BaseModel):
    """Where deliveries should go. Pinned by the user on a map in the app."""

    lat: float | None = None
    lng: float | None = None
    address: str = ""
    building: str = ""
    floor_unit: str = ""
    landmarks: str = ""  # "Opposite Apollo Pharmacy, green gate on the right"
    gate_instructions: str = ""
    geocoded_hint: str = ""  # filled from reverse geocoding when the pin moves

    def maps_link(self) -> str:
        if self.lat is None or self.lng is None:
            return ""
        return f"https://www.google.com/maps/search/?api=1&query={self.lat},{self.lng}"

    def describe(self) -> str:
        parts = [
            ("Address", self.address),
            ("Building", self.building),
            ("Floor / unit", self.floor_unit),
            ("Landmarks", self.landmarks),
            ("Gate / entry", self.gate_instructions),
            ("Nearby (from map pin)", self.geocoded_hint),
            ("Map link (can be sent by SMS)", self.maps_link()),
        ]
        return "\n".join(f"- {k}: {v}" for k, v in parts if v)


class Contact(BaseModel):
    number: str
    name: str = ""
    blocked: bool = False


class Instruction(BaseModel):
    id: str = Field(default_factory=new_id)
    text: str
    created_at: float = Field(default_factory=now)


class KnowledgeNote(BaseModel):
    """Facts the assistant may share with callers ("I'm in Goa until Friday")."""

    id: str = Field(default_factory=new_id)
    text: str
    share_with: Literal["anyone", "contacts"] = "contacts"


class Profile(BaseModel):
    user_name: str = "the user"
    assistant_name: str = "Ava"
    enabled: bool = True
    available: bool = False  # whether the user can answer hold questions now
    home_country_code: str = "+91"
    block_international: bool = True
    answer_unknown_numbers: bool = True
    voice: str = "kokoro:af_heart"
    # Languages callers speak, most likely first (that order breaks ties when the
    # assistant decides which one a caller is speaking).
    caller_languages: list[str] = Field(default_factory=lambda: ["en", "hi", "te", "ta"])
    # A voice per language, e.g. {"te": "piper:te_IN-padmavathi-medium"}; languages not
    # listed use ``voice`` when it can speak them, else that language's default voice.
    voices_by_language: dict[str, str] = Field(default_factory=dict)
    blocked_prefixes: list[str] = Field(default_factory=lambda: ["+91140"])  # India telemarketing series
    location: Location = Field(default_factory=Location)
    instructions: list[Instruction] = Field(default_factory=list)
    knowledge: list[KnowledgeNote] = Field(default_factory=list)
    contacts: list[Contact] = Field(default_factory=list)
    push_tokens: list[str] = Field(default_factory=list)

    @field_validator("caller_languages")
    @classmethod
    def _languages(cls, value: list[str]) -> list[str]:
        return language_codes(value)

    @field_validator("voices_by_language")
    @classmethod
    def _voices(cls, value: dict[str, str]) -> dict[str, str]:
        return voice_per_language(value)


class CallDirection(str, Enum):
    inbound = "inbound"
    outbound = "outbound"


class CallStatus(str, Enum):
    ringing = "ringing"
    active = "active"
    on_hold = "on_hold"
    ended = "ended"
    rejected = "rejected"


class TranscriptLine(BaseModel):
    """One line of a call. ``text`` is what was said, in ``lang``. ``translation`` is
    the line in the user's own language (it may arrive later, as a transcript_update
    event) and ``english`` the English the assistant reasoned with. For the user's own
    interjections (speaker "user") ``text`` is what was said to the caller and
    ``translation`` what the user wrote."""

    id: str = Field(default_factory=new_id)
    speaker: Literal["caller", "assistant", "user", "system"]
    text: str
    lang: str = ""
    translation: str = ""
    translation_lang: str = ""
    english: str = ""
    at: float = Field(default_factory=now)
    kind: Literal["speech", "hold_question", "alert", "note"] = "speech"


class HoldQuestion(BaseModel):
    id: str = Field(default_factory=new_id)
    question: str
    asked_at: float = Field(default_factory=now)
    answer: str | None = None
    answered_at: float | None = None
    sensitive: bool = False


class CallRecord(BaseModel):
    id: str = Field(default_factory=new_id)
    direction: CallDirection = CallDirection.inbound
    number: str = ""
    contact_name: str = ""
    category: str = "unknown"  # spam | delivery | contact | business | unknown
    status: CallStatus = CallStatus.ringing
    language: str = "en"
    started_at: float = Field(default_factory=now)
    ended_at: float | None = None
    transcript: list[TranscriptLine] = Field(default_factory=list)
    holds: list[HoldQuestion] = Field(default_factory=list)
    summary: str = ""
    message: str = ""  # message the caller left for the user
    recording: str = ""  # file name under recordings/
    task_id: str | None = None  # set for outbound concierge calls
    reject_reason: str = ""


class MessageStatus(str, Enum):
    new = "new"
    read = "read"
    replied = "replied"


class CallerMessage(BaseModel):
    id: str = Field(default_factory=new_id)
    call_id: str
    number: str
    caller_name: str = ""
    text: str
    created_at: float = Field(default_factory=now)
    status: MessageStatus = MessageStatus.new
    reply: str = ""
    callback_task_id: str | None = None


class TaskKind(str, Enum):
    enquire = "enquire"  # "check if a table for 3 is available"
    book = "book"  # "check and book"
    callback = "callback"  # call a caller back and convey the user's reply
    custom = "custom"


class TaskStatus(str, Enum):
    queued = "queued"
    dialing = "dialing"
    in_call = "in_call"
    waiting_user = "waiting_user"
    done = "done"
    failed = "failed"


class Task(BaseModel):
    id: str = Field(default_factory=new_id)
    kind: TaskKind = TaskKind.enquire
    number: str
    goal: str
    target_name: str = ""
    status: TaskStatus = TaskStatus.queued
    outcome: str = ""  # booked | available | unavailable | conveyed | failed | ...
    result: str = ""
    call_id: str | None = None
    created_at: float = Field(default_factory=now)
    updated_at: float = Field(default_factory=now)

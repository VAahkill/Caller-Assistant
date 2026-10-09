"""Data models shared by the API, the call engine and the store."""

from __future__ import annotations

import re
import time
import uuid
from collections.abc import Callable
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, field_validator, model_validator

LANGUAGE_CODE = re.compile(r"^[a-z]{2,3}$")
# A country calling code such as +91 (not a phone number).
COUNTRY_CODE = re.compile(r"^\+[1-9]\d{0,3}$")


def language_codes(value: list[str]) -> list[str]:
    """Lower-case language codes, each once; English if none."""
    codes = list(dict.fromkeys(code.strip().lower() for code in value if code.strip()))
    bad = [c for c in codes if not LANGUAGE_CODE.match(c)]
    if bad:
        raise ValueError(f"not language codes: {', '.join(bad)} (use codes like en, hi, te, ta)")
    return codes or ["en"]


def language_code(value: str) -> str:
    code = value.strip().lower()
    if not LANGUAGE_CODE.match(code):
        raise ValueError(f"not a language code: {value!r} (use a code like en, hi, te, ta)")
    return code


def country_code(value: str) -> str:
    """"+91" as it is; "91" or " +91 " tidied; anything else refused."""
    code = value.strip().replace(" ", "")
    if code.isdigit():
        code = "+" + code
    if not COUNTRY_CODE.match(code):
        raise ValueError(f"not a country calling code: {value!r} (the code with a plus, like +91; not a phone number)")
    return code


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

    def describe(self, english: Callable[[str], str] = lambda t: t) -> str:
        """The details for the assistant; ``english`` gives the English of what the
        user wrote in another language (the map hint is kept as the map gives it)."""
        parts = [
            ("Address", english(self.address)),
            ("Building", english(self.building)),
            ("Floor / unit", english(self.floor_unit)),
            ("Landmarks", english(self.landmarks)),
            ("Gate / entry", english(self.gate_instructions)),
            ("Nearby (from map pin)", self.geocoded_hint),
            ("Map link (can be sent by SMS)", self.maps_link()),
        ]
        return "\n".join(f"- {k}: {v}" for k, v in parts if v)

    def texts(self) -> list[str]:
        """What the user wrote (for translating ahead of calls)."""
        return [self.address, self.building, self.floor_unit, self.landmarks, self.gate_instructions]


class Contact(BaseModel):
    number: str
    name: str = ""
    blocked: bool = False


AppliesTo = Literal["everyone", "contacts", "unknown", "delivery", "numbers"]
ShareWith = Literal["anyone", "contacts", "delivery", "numbers"]


class _Rule(BaseModel):
    """What instructions and notes have in common: they can be switched off, can end
    on their own, and can be meant for some callers only."""

    id: str = Field(default_factory=new_id)
    text: str
    enabled: bool = True
    numbers: list[str] = Field(default_factory=list)  # for applies_to / share_with "numbers"
    expires_at: float | None = None
    created_at: float = Field(default_factory=now)
    updated_at: float = Field(default_factory=now)

    @model_validator(mode="before")
    @classmethod
    def _updated_defaults_to_created(cls, data):
        # New, or saved by an older server: not updated since it was made.
        if isinstance(data, dict) and "updated_at" not in data:
            stamp = data.get("created_at") or now()
            data = {**data, "created_at": stamp, "updated_at": stamp}
        return data

    def active(self, at: float | None = None) -> bool:
        return self.enabled and (self.expires_at is None or self.expires_at > (now() if at is None else at))


class Instruction(_Rule):
    """How to handle calls ("Tell couriers to leave parcels with the guard")."""

    applies_to: AppliesTo = "everyone"
    category: str = "general"


class KnowledgeNote(_Rule):
    """Facts the assistant may share with callers ("I'm in Goa until Friday")."""

    share_with: ShareWith = "contacts"


class Away(BaseModel):
    """What the user is doing instead of taking calls. ``message`` is English and
    reads after "Rahul is ...", e.g. "In a meeting until 3 PM"."""

    preset: str = "custom"
    message: str
    until: float | None = None  # when it ends by itself; None: until switched off
    set_at: float = Field(default_factory=now)

    def active(self, at: float | None = None) -> bool:
        return self.until is None or self.until > (now() if at is None else at)


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
    # The language the user reads and writes in the app: caller lines are shown
    # translated into it (translate_live), and what the user types or says to a caller
    # in it is translated into the caller's language.
    owner_language: str = "en"
    translate_live: bool = True
    blocked_prefixes: list[str] = Field(default_factory=lambda: ["+91140"])  # India telemarketing series
    blocked_numbers: list[str] = Field(default_factory=list)  # never answered
    vip_numbers: list[str] = Field(default_factory=list)  # urgent notification; the assistant takes extra care
    away: Away | None = None
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

    @field_validator("owner_language")
    @classmethod
    def _owner_language(cls, value: str) -> str:
        return language_code(value)

    @field_validator("home_country_code")
    @classmethod
    def _country(cls, value: str) -> str:
        # Tidied when it can be; an odd value saved by an older app is kept as it is
        # (the app's PATCH is checked strictly, see api.ProfilePatch).
        try:
            return country_code(value)
        except ValueError:
            return value

    def current_away(self, at: float | None = None) -> Away | None:
        """The away status, unless it has ended."""
        return self.away if self.away is not None and self.away.active(at) else None


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
    urgent: bool = False  # a VIP called, or the call needs the user soon
    action_items: list[str] = Field(default_factory=list)  # from the end-of-call summary


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

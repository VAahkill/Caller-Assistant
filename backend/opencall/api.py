"""HTTP + websocket API used by the mobile app and the telephony gateways."""

from __future__ import annotations

import asyncio
import base64
import binascii
import contextlib
import hmac
import json
import logging
import re
import time
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, PlainTextResponse, Response
from pydantic import BaseModel, Field, field_validator

from . import __version__
from .audio import decode_audio, resample, to_wav, trim_silence
from .config import Settings
from .engine import Engine
from .maps import coords_from_link, reverse_geocode
from .models import (
    AppliesTo,
    Away,
    Contact,
    Instruction,
    KnowledgeNote,
    Location,
    MessageStatus,
    Profile,
    ShareWith,
    TaskKind,
    country_code,
    language_code,
    language_codes,
    new_id,
    voice_per_language,
)
from .owner_chat import handle_owner_message
from .screening import normalize_number
from .templates import TEMPLATES
from .providers.tts import VoiceInfo
from .telephony.asterisk import AsteriskGateway
from .telephony.bluetooth import BluetoothGateway
from .telephony.queue_bridge import QueueBridge
from .telephony.twilio import TwilioGateway, valid_signature
from .voice_samples import VoiceNotReady


log = logging.getLogger("opencall.api")


def _report_warm_up(task: asyncio.Task) -> None:
    if not task.cancelled() and task.exception():
        log.warning("Speech models didn't load: %s", task.exception())


_LANG = re.compile(r"^[a-z]{2,3}$")


def lang_code(value: object) -> str | None:
    """A language code from the app ("te", "hi"...), or None for none/invalid ("auto")."""
    code = str(value or "").strip().lower()
    return code if _LANG.match(code) else None


def decode_recording(b64: str) -> bytes:
    """A recording sent by the app (base64, any format) as 16 kHz PCM with the
    silence before and after the speech cut off. Raises ValueError with a message
    for the user."""
    try:
        raw = base64.b64decode(b64, validate=True)
    except (binascii.Error, ValueError) as e:
        raise ValueError("The recording wasn't valid base64.") from e
    pcm, rate = decode_audio(raw)
    speech = trim_silence(resample(pcm, rate, 16000))
    if len(speech) < 16000 * 2 // 4:  # under a quarter of a second
        raise ValueError("I couldn't hear any speech in that recording. Please try again, a little closer to the phone.")
    return speech


def _name(value: str | None) -> str | None:
    if value is None:
        return None
    value = " ".join(value.split())
    if not value:
        raise ValueError("can't be empty")
    if len(value) > 60:
        raise ValueError("is too long (60 characters at most)")
    return value


# What the away presets say when the app sends no message of its own (English, read
# after "Rahul is ...").
AWAY_PRESETS = {"meeting": "In a meeting", "driving": "Driving", "sleeping": "Sleeping", "gym": "At the gym",
                "travelling": "Travelling", "busy": "Busy", "out": "Out", "leave": "On leave"}


class AwayIn(BaseModel):
    preset: str = "custom"
    message: str = ""
    until: float | None = None

    def to_away(self) -> Away:
        message = " ".join(self.message.split()) or AWAY_PRESETS.get(self.preset.strip().lower(), "")
        if not message:
            raise HTTPException(422, "Say what you're doing, e.g. \"In a meeting until 3 PM\".")
        if len(message) > 200:
            raise HTTPException(422, "The away message is too long (200 characters at most).")
        if self.until is not None and self.until <= time.time():
            raise HTTPException(422, "That end time has already passed.")
        return Away(preset=self.preset.strip().lower() or "custom", message=message, until=self.until)


class ProfilePatch(BaseModel):
    """Any profile field but the location, instructions, notes, contacts and push
    tokens (they have their own endpoints). Missing or null fields are left as they
    are, except ``away``: null clears it."""

    user_name: str | None = None
    assistant_name: str | None = None
    enabled: bool | None = None
    available: bool | None = None
    home_country_code: str | None = None
    block_international: bool | None = None
    answer_unknown_numbers: bool | None = None
    voice: str | None = None
    blocked_prefixes: list[str] | None = None
    caller_languages: list[str] | None = None
    owner_language: str | None = None
    translate_live: bool | None = None
    voices_by_language: dict[str, str] | None = None
    blocked_numbers: list[str] | None = None
    vip_numbers: list[str] | None = None
    away: AwayIn | None = None

    @field_validator("user_name", "assistant_name")
    @classmethod
    def _names(cls, value: str | None) -> str | None:
        return _name(value)

    @field_validator("home_country_code")
    @classmethod
    def _country(cls, value: str | None) -> str | None:
        return None if value is None else country_code(value)

    @field_validator("caller_languages")
    @classmethod
    def _languages(cls, value: list[str] | None) -> list[str] | None:
        return None if value is None else language_codes(value)

    @field_validator("owner_language")
    @classmethod
    def _owner_language(cls, value: str | None) -> str | None:
        return None if value is None else language_code(value)

    @field_validator("voices_by_language")
    @classmethod
    def _voices(cls, value: dict[str, str] | None) -> dict[str, str] | None:
        return None if value is None else voice_per_language(value)

    @field_validator("blocked_prefixes")
    @classmethod
    def _prefixes(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return None
        prefixes = list(dict.fromkeys(p.replace(" ", "") for p in value if p.strip()))
        bad = [p for p in prefixes if not re.fullmatch(r"\+?\d{2,15}", p)]
        if bad:
            raise ValueError(f"not number prefixes: {', '.join(bad)} (digits, optionally starting with +)")
        return prefixes


def numbers_in(values: list[str], home_cc: str) -> list[str]:
    """Phone numbers as the server keeps them (+<country><number>), each once. Raises
    HTTPException 422 for something that isn't a phone number."""
    out = []
    for raw in values:
        if not raw.strip():
            continue
        digits = re.sub(r"\D", "", raw)
        if not 3 <= len(digits) <= 15:
            raise HTTPException(422, f"{raw!r} isn't a phone number.")
        out.append(normalize_number(raw, home_cc))
    return list(dict.fromkeys(out))


class InstructionIn(BaseModel):
    text: str
    enabled: bool = True
    applies_to: AppliesTo = "everyone"
    numbers: list[str] = Field(default_factory=list)
    category: str = "general"
    expires_at: float | None = None


class InstructionPatch(BaseModel):
    text: str | None = None
    enabled: bool | None = None
    applies_to: AppliesTo | None = None
    numbers: list[str] | None = None
    category: str | None = None
    expires_at: float | None = None


class KnowledgeIn(BaseModel):
    text: str
    share_with: ShareWith = "contacts"
    numbers: list[str] = Field(default_factory=list)
    enabled: bool = True
    expires_at: float | None = None


class KnowledgePatch(BaseModel):
    text: str | None = None
    share_with: ShareWith | None = None
    numbers: list[str] | None = None
    enabled: bool | None = None
    expires_at: float | None = None


class NumberIn(BaseModel):
    number: str


class VoicePatch(BaseModel):
    label: str


class TextIn(BaseModel):
    text: str


class PushToken(BaseModel):
    token: str


class AnswerIn(BaseModel):
    text: str
    hold_id: str | None = None


class SayIn(BaseModel):
    text: str
    lang: str | None = None


class ReplyIn(BaseModel):
    text: str
    call_back: bool = True


class TaskIn(BaseModel):
    number: str
    goal: str
    kind: TaskKind = TaskKind.enquire
    target_name: str = ""


class ChatIn(BaseModel):
    text: str
    shared: str = ""
    history: list[dict] = []


def create_app(settings: Settings | None = None, engine: Engine | None = None, start_gateways: bool = True) -> FastAPI:
    settings = settings or Settings()
    engine = engine or Engine(settings)
    asterisk = AsteriskGateway(engine)
    twilio = TwilioGateway(engine)
    bluetooth = BluetoothGateway(engine) if settings.bluetooth_enabled else None
    if engine.dialer.name == "none":
        if bluetooth:
            engine.dialer = bluetooth
        elif settings.asterisk_ari_url:
            engine.dialer = asterisk
        elif settings.twilio_account_sid:
            engine.dialer = twilio

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if start_gateways:
            warm = asyncio.create_task(engine.warm_up_all())
            warm.add_done_callback(_report_warm_up)
        if start_gateways and settings.asterisk_enabled:
            await asterisk.start()
        if start_gateways and bluetooth:
            await bluetooth.start()
        yield
        if start_gateways and not warm.done():
            warm.cancel()
        await engine.shutdown()
        if start_gateways and settings.asterisk_enabled:
            await asterisk.stop()

    app = FastAPI(title="OpenCall Receptionist", version=__version__, lifespan=lifespan)
    app.state.engine = engine

    def auth(request: Request) -> None:
        header = request.headers.get("authorization", "")
        token = header.removeprefix("Bearer ").strip() or request.query_params.get("token", "")
        if not hmac.compare_digest(token, settings.api_token):
            raise HTTPException(401, "bad token")

    def ws_ok(token: str) -> bool:
        return hmac.compare_digest(token or "", settings.api_token)

    store = engine.store
    A = [Depends(auth)]

    # ------------------------------------------------------------ health
    @app.get("/health")
    async def health():
        return {"ok": True, "version": __version__, "dialer": engine.dialer.name,
                "active_calls": len(engine.sessions), "ready": dict(engine.ready), "llm_model": settings.llm_model}

    # ------------------------------------------------------------ profile & settings
    @app.get("/profile", dependencies=A)
    async def get_profile() -> Profile:
        return store.profile

    @app.patch("/profile", dependencies=A)
    async def patch_profile(patch: ProfilePatch) -> Profile:
        data = store.profile.model_dump()
        changes = {k: v for k, v in patch.model_dump(exclude={"away"}).items() if v is not None}
        cc = changes.get("home_country_code", store.profile.home_country_code)
        for field in ("blocked_numbers", "vip_numbers"):
            if field in changes:
                changes[field] = numbers_in(changes[field], cc)
        data.update(changes)
        if "away" in patch.model_fields_set:
            data["away"] = patch.away.to_away().model_dump() if patch.away is not None else None
        return await save_profile(Profile.model_validate(data))

    async def save_profile(profile: Profile | None = None) -> Profile:
        store.save_profile(profile)
        await engine.bus.publish("profile_updated")
        return store.profile

    # ------------------------------------------------------------ away status
    @app.put("/away", dependencies=A)
    async def put_away(body: AwayIn) -> Profile:
        """What the user is doing instead of taking calls ("In a meeting until 3 PM"):
        callers hear it in the greeting until it ends."""
        store.profile.away = body.to_away()
        return await save_profile()

    @app.delete("/away", dependencies=A)
    async def delete_away() -> Profile:
        store.profile.away = None
        return await save_profile()

    @app.put("/location", dependencies=A)
    async def put_location(loc: Location) -> Location:
        if loc.lat is not None and loc.lng is not None and not loc.geocoded_hint:
            loc.geocoded_hint = await reverse_geocode(loc.lat, loc.lng)
        store.profile.location = loc
        store.save_profile()
        return loc

    @app.post("/location/from-link", dependencies=A)
    async def location_from_link(body: TextIn):
        """Read the pin out of a Google Maps link the user shared or pasted."""
        found = await coords_from_link(body.text.strip())
        if not found:
            raise HTTPException(422, "Couldn't find a location in that link.")
        return {"lat": found[0], "lng": found[1]}

    # ------------------------------------------------------------ instructions and notes
    def clean_text(text: str) -> str:
        text = text.strip()
        if not text:
            raise HTTPException(422, "The text is empty.")
        if len(text) > 1000:
            raise HTTPException(422, "That's too long for the assistant to keep in mind (1000 characters at most).")
        return text

    def check_rule(rule, numbers_needed: bool) -> None:
        if numbers_needed and not rule.numbers:
            raise HTTPException(422, "Add the phone numbers this is for.")
        if rule.expires_at is not None and rule.expires_at <= time.time() and rule.enabled:
            raise HTTPException(422, "That end date has already passed.")

    def find(items: list, item_id: str, what: str):
        found = next((i for i in items if i.id == item_id), None)
        if found is None:
            raise HTTPException(404, f"No such {what}.")
        return found

    @app.get("/instructions/templates", dependencies=A)
    async def instruction_templates():
        """Ready-made instructions, grouped by category in the app."""
        return TEMPLATES

    @app.post("/instructions", dependencies=A)
    async def add_instruction(body: InstructionIn) -> Instruction:
        cc = store.profile.home_country_code
        ins = Instruction(text=clean_text(body.text), enabled=body.enabled, applies_to=body.applies_to,
                          numbers=numbers_in(body.numbers, cc), category=body.category.strip().lower() or "general",
                          expires_at=body.expires_at)
        check_rule(ins, ins.applies_to == "numbers")
        store.profile.instructions.append(ins)
        await save_profile()
        return ins

    @app.patch("/instructions/{ins_id}", dependencies=A)
    async def patch_instruction(ins_id: str, patch: InstructionPatch) -> Instruction:
        ins = find(store.profile.instructions, ins_id, "instruction")
        changes = patch.model_dump(exclude_unset=True)
        if "text" in changes:
            changes["text"] = clean_text(changes["text"] or "")
        if "numbers" in changes:
            changes["numbers"] = numbers_in(changes["numbers"] or [], store.profile.home_country_code)
        if "category" in changes:
            changes["category"] = (changes["category"] or "").strip().lower() or "general"
        for key in ("enabled", "applies_to"):
            if changes.get(key, "") is None:
                changes.pop(key)
        updated = ins.model_copy(update={**changes, "updated_at": time.time()})
        check_rule(updated, updated.applies_to == "numbers")
        store.profile.instructions = [updated if i.id == ins_id else i for i in store.profile.instructions]
        await save_profile()
        return updated

    @app.delete("/instructions/{ins_id}", dependencies=A)
    async def del_instruction(ins_id: str):
        store.profile.instructions = [i for i in store.profile.instructions if i.id != ins_id]
        await save_profile()
        return {"ok": True}

    @app.post("/knowledge", dependencies=A)
    async def add_note(body: KnowledgeIn) -> KnowledgeNote:
        note = KnowledgeNote(text=clean_text(body.text), share_with=body.share_with, enabled=body.enabled,
                             numbers=numbers_in(body.numbers, store.profile.home_country_code),
                             expires_at=body.expires_at)
        check_rule(note, note.share_with == "numbers")
        store.profile.knowledge.append(note)
        await save_profile()
        return note

    @app.patch("/knowledge/{note_id}", dependencies=A)
    async def patch_note(note_id: str, patch: KnowledgePatch) -> KnowledgeNote:
        note = find(store.profile.knowledge, note_id, "note")
        changes = patch.model_dump(exclude_unset=True)
        if "text" in changes:
            changes["text"] = clean_text(changes["text"] or "")
        if "numbers" in changes:
            changes["numbers"] = numbers_in(changes["numbers"] or [], store.profile.home_country_code)
        for key in ("enabled", "share_with"):
            if changes.get(key, "") is None:
                changes.pop(key)
        updated = note.model_copy(update={**changes, "updated_at": time.time()})
        check_rule(updated, updated.share_with == "numbers")
        store.profile.knowledge = [updated if n.id == note_id else n for n in store.profile.knowledge]
        await save_profile()
        return updated

    @app.delete("/knowledge/{note_id}", dependencies=A)
    async def del_note(note_id: str):
        store.profile.knowledge = [n for n in store.profile.knowledge if n.id != note_id]
        await save_profile()
        return {"ok": True}

    @app.put("/contacts", dependencies=A)
    async def put_contacts(contacts: list[Contact]):
        """The app syncs the phone's address book here (numbers and names only)."""
        store.profile.contacts = contacts
        store.save_profile()
        return {"count": len(contacts)}

    @app.post("/contacts/block", dependencies=A)
    async def block_number(body: NumberIn) -> Profile:
        """Calls from this number are never answered (a VIP stops being one)."""
        p = store.profile
        number = (numbers_in([body.number], p.home_country_code) or [None])[0]
        if number is None:
            raise HTTPException(422, "Which number?")
        if number not in p.blocked_numbers:
            p.blocked_numbers.append(number)
        p.vip_numbers = [n for n in p.vip_numbers if normalize_number(n, p.home_country_code) != number]
        return await save_profile()

    @app.delete("/contacts/block/{number}", dependencies=A)
    async def unblock_number(number: str) -> Profile:
        p = store.profile
        target = normalize_number(number, p.home_country_code)
        p.blocked_numbers = [n for n in p.blocked_numbers if normalize_number(n, p.home_country_code) != target]
        for c in p.contacts:  # blocked by an older app, on the contact itself
            if c.blocked and normalize_number(c.number, p.home_country_code) == target:
                c.blocked = False
        return await save_profile()

    @app.post("/push/register", dependencies=A)
    async def register_push(body: PushToken):
        if body.token not in store.profile.push_tokens:
            store.profile.push_tokens.append(body.token)
            store.save_profile()
        return {"ok": True}

    # ------------------------------------------------------------ calls
    @app.get("/calls", dependencies=A)
    async def list_calls(limit: int = 50):
        return [c.model_dump(mode="json", exclude={"transcript"}) for c in store.calls.list()[:limit]]

    @app.get("/calls/{call_id}", dependencies=A)
    async def get_call(call_id: str):
        live = engine.sessions.get(call_id)
        rec = live.record if live else store.calls.get(call_id)
        if not rec:
            raise HTTPException(404)
        return rec

    @app.get("/calls/{call_id}/recording", dependencies=A)
    async def get_recording(call_id: str):
        rec = store.calls.get(call_id)
        if not rec or not rec.recording:
            raise HTTPException(404)
        return FileResponse(settings.recordings_dir / Path(rec.recording).name, media_type="audio/wav")

    def live(call_id: str):
        s = engine.sessions.get(call_id)
        if not s:
            raise HTTPException(404, "call is not live")
        return s

    @app.post("/calls/{call_id}/answer", dependencies=A)
    async def answer_hold(call_id: str, body: AnswerIn):
        """The user's answer to a hold question (in their language; the model gets it
        in English), or, with no question waiting, words said to the caller."""
        s = live(call_id)
        if await s.answer_hold(body.hold_id, body.text):
            return {"ok": True, "mode": "hold_answer"}
        await s.say_now(body.text)
        return {"ok": True, "mode": "said"}

    @app.post("/calls/{call_id}/say", dependencies=A)
    async def say(call_id: str, body: SayIn):
        """The user's own words for the caller (in ``lang``, by default their own
        language), translated and said in the caller's language right away."""
        if not await live(call_id).owner_say(body.text, lang_code(body.lang)):
            raise HTTPException(422, "Nothing was said: the text was empty or contained a code-like number.")
        return {"ok": True}

    @app.post("/calls/{call_id}/say-audio", dependencies=A)
    async def say_audio(call_id: str, audio: UploadFile = File(...), lang: str = Form("")):
        """The user's spoken reply (in ``lang``, by default their own language):
        transcribed, translated and said to the caller in theirs."""
        s = live(call_id)
        try:
            pcm, rate = decode_audio(await audio.read())
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        heard = await s.owner_say_audio(resample(pcm, rate, 16000), lang_code(lang))
        if not heard:
            raise HTTPException(422, "I couldn't hear anything.")
        return {"ok": True, "heard": heard}

    @app.post("/calls/{call_id}/end", dependencies=A)
    async def end_call(call_id: str):
        await live(call_id).end()
        return {"ok": True}

    # ------------------------------------------------------------ messages
    @app.get("/messages", dependencies=A)
    async def list_messages():
        return store.messages.list()

    @app.post("/messages/{msg_id}/reply", dependencies=A)
    async def reply_message(msg_id: str, body: ReplyIn):
        msg = store.messages.get(msg_id)
        if not msg:
            raise HTTPException(404)
        return await engine.tasks.reply_to_message(msg, body.text, body.call_back)

    @app.post("/messages/{msg_id}/read", dependencies=A)
    async def read_message(msg_id: str):
        msg = store.messages.get(msg_id)
        if not msg:
            raise HTTPException(404)
        if msg.status == MessageStatus.new:
            msg.status = MessageStatus.read
            store.messages.put(msg)
        return msg

    # ------------------------------------------------------------ outbound tasks

    @app.get("/tasks", dependencies=A)
    async def list_tasks():
        return store.tasks.list()

    @app.post("/tasks", dependencies=A)
    async def create_task(body: TaskIn):
        return await engine.tasks.create(body.kind, body.number, body.goal, body.target_name)

    # ------------------------------------------------------------ talk to the assistant

    @app.post("/assistant/chat", dependencies=A)
    async def owner_chat(body: ChatIn):
        reply = await handle_owner_message(engine, body.text, body.shared, body.history)
        return {"reply": reply.text, "actions": reply.actions}

    @app.post("/assistant/voice", dependencies=A)
    async def owner_voice(audio: UploadFile = File(...), shared: str = Form("")):
        """Push-to-talk: a WAV clip in, the assistant's reply as text and speech out."""
        try:
            pcm, rate = decode_audio(await audio.read())
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        said = await engine.stt.transcribe(resample(pcm, rate, 16000))
        if not said.text:
            raise HTTPException(422, "I couldn't hear anything.")
        reply = await handle_owner_message(engine, said.text, shared)
        return {"heard": said.text, "reply": reply.text, "actions": reply.actions}

    @app.get("/assistant/speak", dependencies=A)
    async def speak(text: str, voice: str | None = None, lang: str = "en"):
        """Voice preview; a GET so the app's audio player can stream it by URL."""
        pcm = await engine.tts.synthesize(text[:300], voice or store.profile.voice, lang)
        return Response(to_wav(pcm), media_type="audio/wav")

    # ------------------------------------------------------------ voices
    def voice_json(voice: VoiceInfo) -> dict:
        data = voice.to_json()
        data["sample_url"] = engine.samples.url(voice)
        return data

    @app.get("/voices", dependencies=A)
    async def list_voices():
        """The user's recorded voices first (newest first), then the built-in ones."""
        return [voice_json(v) for v in engine.tts.list_voices()]

    @app.get("/voices/{voice_id}/sample.wav", dependencies=A)
    async def voice_sample(voice_id: str, request: Request, lang: str | None = None, v: str | None = None):
        """The voice saying a short line in ``lang`` (or its own language). Made once
        and kept; the URL in ``sample_url`` carries its version, so the app may cache
        it for good."""
        if engine.tts.get_voice(voice_id) is None:
            raise HTTPException(404, "No such voice.")
        try:
            path, key = await engine.samples.get(voice_id, lang_code(lang))
        except VoiceNotReady as e:
            raise HTTPException(409, str(e)) from e
        except Exception as e:
            log.exception("Couldn't make the demo for %s", voice_id)
            raise HTTPException(503, f"Couldn't make this voice's demo ({e.__class__.__name__}: {e})"[:300]) from e
        etag = f'"{key}"'
        cache = "public, max-age=31536000, immutable" if v == key else "no-cache"
        headers = {"ETag": etag, "Cache-Control": cache}
        if request.headers.get("if-none-match") == etag:
            return Response(status_code=304, headers=headers)
        return FileResponse(path, media_type="audio/wav", headers=headers)

    @app.get("/voices/{voice_id}/recording", dependencies=A)
    async def voice_recording(voice_id: str):
        """What the user recorded for a voice of their own."""
        path = engine.tts.clone_recording(voice_id)
        if path is None:
            raise HTTPException(404, "No recording for this voice.")
        return FileResponse(path, media_type="audio/wav", headers={"Cache-Control": "private, max-age=3600"})

    @app.post("/voices", dependencies=A)
    async def add_voice(label: str = Form("My voice"), audio: UploadFile = File(...)):
        """A recording of the user's voice (15-30 s, any format the phone records).
        Returns the new voice as "preparing"; a voice_status event follows when it is
        ready (or failed), and GET /voices shows its status too."""
        data = await audio.read()
        try:
            voice = await asyncio.to_thread(engine.tts.add_clone, label, data)
        except ValueError as e:
            raise HTTPException(422, str(e)) from e
        engine.prepare_voice(voice.id)
        return voice_json(voice)

    @app.patch("/voices/{voice_id}", dependencies=A)
    async def rename_voice(voice_id: str, patch: VoicePatch):
        try:
            return voice_json(engine.tts.rename_clone(voice_id, patch.label))
        except KeyError as e:
            raise HTTPException(404, "Only your own recorded voices can be renamed.") from e

    @app.delete("/voices/{voice_id}", dependencies=A)
    async def delete_voice(voice_id: str):
        """Deletes a recorded voice. If it was in use, the default voice takes over."""
        voice_id = voice_id if ":" in voice_id else f"clone:{voice_id}"  # older apps send the bare name
        if not engine.tts.delete_clone(voice_id):
            raise HTTPException(404, "No such recorded voice.")
        engine.forget_voice(voice_id)
        await engine.bus.publish("profile_updated")
        return {"ok": True}

    # ------------------------------------------------------------ live events for the app
    async def owner_action(session, msg: dict):
        """The user acting in a live call from the app: answer a hold question, or say
        something to the caller (typed, or recorded). Checks the request first and
        returns (problem for the user, None) or (None, the work to run)."""
        action = msg.get("action")
        lang = lang_code(msg.get("lang"))
        if action in ("answer", "say"):
            text = str(msg.get("text") or "").strip()
            if not text:
                return "The message was empty.", None
            if not session.can_say(text):
                return "Not said: it contains a code-like number, which the assistant never reads out.", None
            if action == "answer":
                return None, session.owner_answer(msg.get("hold_id"), text, lang)
            return None, session.owner_say(text, lang)
        if action == "say_audio":
            try:
                pcm = await asyncio.to_thread(decode_recording, str(msg.get("audio_b64") or ""))
            except ValueError as e:
                return str(e), None
            return None, session.owner_say_audio(pcm, lang)
        return f"Unknown action {action!r}. Use answer, say or say_audio.", None

    @app.websocket("/ws/events")
    async def events_ws(ws: WebSocket, token: str = Query("")):
        if not ws_ok(token):
            await ws.close(code=4401)
            return
        await ws.accept()
        q = engine.bus.subscribe()
        # Late joiners get the live calls so the transcript screen can catch up.
        for s in engine.sessions.values():
            await ws.send_json({"event": "call_snapshot", "call": s.record.model_dump(mode="json")})

        async def pump_out():
            while True:
                await ws.send_json(await q.get())

        out = asyncio.create_task(pump_out())
        try:
            while True:
                try:
                    msg = json.loads(await ws.receive_text())
                except json.JSONDecodeError:
                    await ws.send_json({"event": "error", "detail": "Messages must be JSON."})
                    continue
                if not isinstance(msg, dict) or "action" not in msg:
                    await ws.send_json({"event": "error", "detail": "Expected an action, e.g. {\"action\": \"say\", ...}."})
                    continue
                session = engine.sessions.get(str(msg.get("call_id") or ""))
                if not session:
                    await ws.send_json({"event": "error", "call_id": msg.get("call_id"),
                                        "detail": "That call is no longer live."})
                    continue
                problem, work = await owner_action(session, msg)
                if problem:
                    await ws.send_json({"event": "error", "call_id": session.record.id, "detail": problem})
                else:
                    session.spawn(work, f"user {msg['action']}")
        except (WebSocketDisconnect, RuntimeError):
            pass  # the app went away (or closed mid-send); nothing to clean up but the queue
        finally:
            out.cancel()
            engine.bus.unsubscribe(q)

    # ------------------------------------------------------------ simulator (no phone needed)
    @app.websocket("/ws/simulate")
    async def simulate(ws: WebSocket, token: str = Query(""), number: str = Query("+919800000000"),
                       wav: bool = Query(False), lang: str = Query("")):
        """Pretend to be a caller (the app's practice call).

        Send binary 16 kHz PCM16 frames (a live stream), ``{"text": ..., "lang"?}``,
        ``{"audio_b64": <a finished recording in any format ffmpeg reads>, "lang"?}``
        (answered as one utterance), the user's own ``{"action": "say"|"say_audio"|
        "answer", ...}``, or ``{"hangup": true}``. ``lang`` (here or per message) is
        the caller's language, if known.

        Receive ``started`` or ``rejected``; ``ack`` for every accepted message and
        ``error`` (never silence) for anything that can't be used; every event of
        this call (transcript, assistant_status, call_category, hold_question,
        turn_error, call_ended...); and the assistant's speech as binary audio. With
        ``wav=1`` each sentence arrives at once as a WAV file instead of as
        real-time frames.
        """
        if not ws_ok(token):
            await ws.close(code=4401)
            return
        await ws.accept()
        decision = engine.screen(number)
        if not decision.answer:
            await ws.send_json({"event": "rejected", "reason": decision.reason})
            await ws.close()
            return

        send_lock = asyncio.Lock()
        gone = asyncio.Event()

        async def send(data: dict | bytes) -> None:
            if gone.is_set():
                return
            try:
                async with send_lock:
                    if isinstance(data, bytes):
                        await ws.send_bytes(data)
                    else:
                        await ws.send_json(data)
            except (WebSocketDisconnect, RuntimeError):
                gone.set()  # the app closed the socket; the call is hung up below

        class SimBridge(QueueBridge):
            def __init__(self, call_id: str, number: str):
                super().__init__(call_id, number)
                self.paced = not wav  # the app plays whole sentences, so don't pace them out
                self._pending = bytearray()
                self._timer: asyncio.TimerHandle | None = None
                self._flushes: set[asyncio.Task] = set()

            async def send_audio(self, frame: bytes) -> None:
                if not wav:
                    await send(frame)
                    return
                self._pending += frame
                if self._timer:
                    self._timer.cancel()
                self._timer = asyncio.get_running_loop().call_later(0.15, self._schedule_flush)

            def _schedule_flush(self) -> None:
                task = asyncio.create_task(self.flush())
                self._flushes.add(task)
                task.add_done_callback(self._flushes.discard)

            async def flush(self) -> None:
                pcm, self._pending = bytes(self._pending), bytearray()
                if pcm:
                    await send(to_wav(pcm))

        bridge = SimBridge(new_id(), number)
        events = engine.bus.subscribe()  # before the call starts, so no event is missed
        session = engine.open_session(bridge)
        session.language_hint = lang_code(lang)
        call = asyncio.create_task(engine.run_session(session))
        await send({"event": "started", "call_id": bridge.call_id})
        done = {"event": "_simulate_done"}

        async def forward():
            while True:
                ev = await events.get()
                if ev is done:
                    return
                if ev.get("call_id") == bridge.call_id:
                    await send(ev)

        async def read_client():
            while True:
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    return
                if msg.get("bytes"):
                    bridge.feed(msg["bytes"])
                    continue
                if msg.get("text") is None:
                    continue
                try:
                    data = json.loads(msg["text"])
                except json.JSONDecodeError:
                    data = None
                if not isinstance(data, dict):
                    await send({"event": "error", "detail": 'Messages must be JSON objects, e.g. {"text": "Hello"}.'})
                    continue
                if data.get("hangup"):
                    return
                if session.closed.is_set():
                    await send({"event": "error", "detail": "The call has ended."})
                    continue
                said_lang = lang_code(data.get("lang"))
                if data.get("action"):
                    problem, work = await owner_action(session, data)
                    if problem:
                        await send({"event": "error", "detail": problem})
                    else:
                        await send({"event": "ack", "kind": str(data["action"])})
                        session.spawn(work, f"user {data['action']}")
                elif "audio_b64" in data:
                    try:
                        pcm = await asyncio.to_thread(decode_recording, str(data["audio_b64"] or ""))
                    except ValueError as e:
                        await send({"event": "error", "detail": str(e)})
                        continue
                    await send({"event": "ack", "kind": "audio", "seconds": round(len(pcm) / 32000, 1)})
                    session.submit_recording(pcm, said_lang)
                elif "text" in data:
                    text = str(data["text"] or "").strip()
                    if not text:
                        await send({"event": "error", "detail": "The message was empty."})
                        continue
                    await send({"event": "ack", "kind": "text"})
                    session.submit_text(text, said_lang)
                else:
                    await send({"event": "error",
                                "detail": 'Send {"text": ...}, {"audio_b64": ...} or {"hangup": true}.'})

        forwarder = asyncio.create_task(forward())
        reader = asyncio.create_task(read_client())
        hung_up = asyncio.create_task(bridge.hung_up.wait())
        try:
            await asyncio.wait({reader, hung_up}, return_when=asyncio.FIRST_COMPLETED)
            if reader.done() and not reader.cancelled() and reader.exception():
                log.error("Practice call socket failed", exc_info=reader.exception())
        finally:
            for t in (reader, hung_up):
                t.cancel()
            await bridge.hangup()
            try:
                await call
            except Exception:
                log.exception("Practice call %s ended with an error", bridge.call_id)
            if wav:
                await bridge.flush()
            events.put_nowait(done)  # everything published before this still goes out
            await forwarder
            engine.bus.unsubscribe(events)
            if not gone.is_set():
                with contextlib.suppress(RuntimeError):  # already closed by the client
                    await ws.close()

    # ------------------------------------------------------------ telephony webhooks
    @app.get("/telephony/asterisk/screen", response_class=PlainTextResponse)
    async def asterisk_screen(uuid: str, number: str = "", token: str = ""):
        if not ws_ok(token):
            raise HTTPException(401)
        return await asterisk.screen(uuid, number)

    @app.post("/telephony/twilio/voice")
    async def twilio_voice(request: Request):
        form = {k: str(v) for k, v in (await request.form()).items()}
        url = settings.public_url.rstrip("/") + "/telephony/twilio/voice"
        if settings.twilio_auth_token and not valid_signature(
            settings.twilio_auth_token, url, form, request.headers.get("X-Twilio-Signature", "")
        ):
            raise HTTPException(403, "bad Twilio signature")
        return Response(await twilio.inbound_twiml(form), media_type="application/xml")

    @app.websocket("/telephony/twilio/stream")
    async def twilio_stream(ws: WebSocket):
        await twilio.handle_stream(ws)

    return app

"""HTTP + websocket API used by the mobile app and the telephony gateways."""

from __future__ import annotations

import asyncio
import contextlib
import hmac
import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import Depends, FastAPI, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, PlainTextResponse, Response
from pydantic import BaseModel

from .audio import to_wav
from .config import Settings
from .engine import Engine
from .maps import coords_from_link, reverse_geocode
from .models import Contact, Instruction, KnowledgeNote, Location, MessageStatus, Profile, TaskKind, new_id
from .owner_chat import handle_owner_message
from .telephony.asterisk import AsteriskGateway
from .telephony.bluetooth import BluetoothGateway
from .telephony.queue_bridge import QueueBridge
from .telephony.twilio import TwilioGateway, valid_signature


class ProfilePatch(BaseModel):
    user_name: str | None = None
    assistant_name: str | None = None
    enabled: bool | None = None
    available: bool | None = None
    home_country_code: str | None = None
    block_international: bool | None = None
    answer_unknown_numbers: bool | None = None
    voice: str | None = None
    blocked_prefixes: list[str] | None = None


class TextIn(BaseModel):
    text: str


class PushToken(BaseModel):
    token: str


class AnswerIn(BaseModel):
    text: str
    hold_id: str | None = None


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
        if start_gateways and settings.asterisk_enabled:
            await asterisk.start()
        if start_gateways and bluetooth:
            await bluetooth.start()
        yield
        await engine.shutdown()
        if start_gateways and settings.asterisk_enabled:
            await asterisk.stop()

    app = FastAPI(title="OpenCall Receptionist", version="0.1.0", lifespan=lifespan)
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
        return {"ok": True, "dialer": engine.dialer.name, "active_calls": len(engine.sessions)}

    # ------------------------------------------------------------ profile & settings
    @app.get("/profile", dependencies=A)
    async def get_profile() -> Profile:
        return store.profile

    @app.patch("/profile", dependencies=A)
    async def patch_profile(patch: ProfilePatch) -> Profile:
        data = store.profile.model_dump()
        data.update({k: v for k, v in patch.model_dump().items() if v is not None})
        store.save_profile(Profile.model_validate(data))
        await engine.bus.publish("profile_updated")
        return store.profile

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

    @app.post("/instructions", dependencies=A)
    async def add_instruction(body: TextIn) -> Instruction:
        ins = Instruction(text=body.text.strip())
        store.profile.instructions.append(ins)
        store.save_profile()
        return ins

    @app.delete("/instructions/{ins_id}", dependencies=A)
    async def del_instruction(ins_id: str):
        store.profile.instructions = [i for i in store.profile.instructions if i.id != ins_id]
        store.save_profile()
        return {"ok": True}

    @app.post("/knowledge", dependencies=A)
    async def add_note(note: KnowledgeNote) -> KnowledgeNote:
        store.profile.knowledge.append(note)
        store.save_profile()
        return note

    @app.delete("/knowledge/{note_id}", dependencies=A)
    async def del_note(note_id: str):
        store.profile.knowledge = [n for n in store.profile.knowledge if n.id != note_id]
        store.save_profile()
        return {"ok": True}

    @app.put("/contacts", dependencies=A)
    async def put_contacts(contacts: list[Contact]):
        """The app syncs the phone's address book here (numbers and names only)."""
        store.profile.contacts = contacts
        store.save_profile()
        return {"count": len(contacts)}

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
        s = live(call_id)
        if await s.answer_hold(body.hold_id, body.text):
            return {"ok": True, "mode": "hold_answer"}
        await s.say_now(body.text)
        return {"ok": True, "mode": "said"}

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
        from .audio import decode_audio, resample

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
    @app.get("/voices", dependencies=A)
    async def list_voices():
        return [v.__dict__ for v in engine.tts.list_voices()]

    @app.post("/voices", dependencies=A)
    async def add_voice(label: str = Form(...), audio: UploadFile = File(...)):
        try:
            return engine.tts.add_clone(label, await audio.read()).__dict__
        except ValueError as e:
            raise HTTPException(422, str(e)) from e

    @app.delete("/voices/{name}", dependencies=A)
    async def delete_voice(name: str):
        engine.tts.delete_clone(name)
        return {"ok": True}

    # ------------------------------------------------------------ live events for the app
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
                msg = await ws.receive_json()
                if msg.get("action") == "answer" and msg.get("call_id") in engine.sessions:
                    s = engine.sessions[msg["call_id"]]
                    if not await s.answer_hold(msg.get("hold_id"), msg.get("text", "")):
                        await s.say_now(msg.get("text", ""))
        except (WebSocketDisconnect, RuntimeError, json.JSONDecodeError):
            pass
        finally:
            out.cancel()
            engine.bus.unsubscribe(q)

    # ------------------------------------------------------------ simulator (no phone needed)
    @app.websocket("/ws/simulate")
    async def simulate(ws: WebSocket, token: str = Query(""), number: str = Query("+919800000000")):
        """Pretend to be a caller: send 16 kHz PCM16 audio frames or
        {"text": "..."} messages; receive the assistant's audio as binary."""
        if not ws_ok(token):
            await ws.close(code=4401)
            return
        await ws.accept()
        decision = engine.screen(number)
        if not decision.answer:
            await ws.send_json({"event": "rejected", "reason": decision.reason})
            await ws.close()
            return

        class SimBridge(QueueBridge):
            async def send_audio(self, frame: bytes) -> None:
                with contextlib.suppress(Exception):
                    await ws.send_bytes(frame)

        bridge = SimBridge(new_id(), number)
        call = asyncio.create_task(engine.handle_call(bridge))

        async def read_client():
            while True:
                msg = await ws.receive()
                if msg.get("type") == "websocket.disconnect":
                    return
                if msg.get("bytes"):
                    bridge.feed(msg["bytes"])
                elif msg.get("text"):
                    data = json.loads(msg["text"])
                    if data.get("hangup"):
                        return
                    session = engine.sessions.get(bridge.call_id)
                    if session and data.get("text"):
                        asyncio.create_task(session.handle_text(data["text"], data.get("lang", "en")))

        reader = asyncio.create_task(read_client())
        hung_up = asyncio.create_task(bridge.hung_up.wait())
        try:
            await asyncio.wait({reader, hung_up}, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for t in (reader, hung_up):
                t.cancel()
            await bridge.hangup()
            await call
            with contextlib.suppress(Exception):
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

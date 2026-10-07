from __future__ import annotations

import pytest

from opencall.config import Settings
from opencall.engine import Engine
from opencall.models import Location
from opencall.providers.llm import ScriptedLLM
from opencall.providers.stt import Transcription
from opencall.providers.tts import TTSRouter


class FakeSTT:
    def __init__(self) -> None:
        self.next: list[Transcription] = []

    async def transcribe(self, pcm16k: bytes, language_hint: str | None = None) -> Transcription:
        return self.next.pop(0) if self.next else Transcription("")


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        data_dir=tmp_path,
        api_token="test-token",
        llm_provider="scripted",
        stt_provider="none",
        tts_provider="silent",
        clone_provider="none",
        hold_timeout_s=0.6,
        hold_reminder_s=5,
        expo_push_url="",
    )


@pytest.fixture
def llm() -> ScriptedLLM:
    return ScriptedLLM()


@pytest.fixture
def engine(settings, llm) -> Engine:
    eng = Engine(
        settings,
        llm=llm,
        stt=FakeSTT(),
        tts=TTSRouter(settings.voices_dir, provider="silent", clone_provider="none"),
    )
    p = eng.store.profile
    p.user_name = "Rahul"
    p.location = Location(
        lat=17.4123, lng=78.4356,
        address="Flat 402, Sri Sai Nilayam, Road No. 3, Banjara Hills, Hyderabad 500034",
        landmarks="Opposite Apollo Pharmacy, green gate on the right",
    )
    eng.store.save_profile()
    return eng

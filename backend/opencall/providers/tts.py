"""Text to speech, with built-in voices and user-recorded voice clones.

Voice ids look like ``kokoro:af_heart`` (built-in Kokoro voice),
``clone:<name>`` (a voice the user recorded in the app, spoken with XTTS-v2),
``mms:te`` or ``parler:Lalitha`` (Indian-language voices, see ``indic.py``).

Whatever voice is chosen, a caller speaking Telugu, Tamil or another language
Kokoro and XTTS can't speak is answered with the Indian-language engine.
"""

from __future__ import annotations

import asyncio
import json
import re
import threading
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..audio import RATE, decode_audio, float_to_pcm16, resample, to_wav
from ..languages import guess_language
from .indic import INDIC_LANGS, PARLER_SPEAKERS, make_indic_engine

# Kokoro-82M voices worth offering. The full list is in the Kokoro repo.
KOKORO_VOICES = {
    "af_heart": ("Heart", "en", "female"),
    "af_bella": ("Bella", "en", "female"),
    "af_nicole": ("Nicole (soft)", "en", "female"),
    "am_adam": ("Adam", "en", "male"),
    "am_michael": ("Michael", "en", "male"),
    "bf_emma": ("Emma (British)", "en", "female"),
    "bm_george": ("George (British)", "en", "male"),
    "hf_alpha": ("Alpha (Hindi)", "hi", "female"),
    "hf_beta": ("Beta (Hindi)", "hi", "female"),
    "hm_omega": ("Omega (Hindi)", "hi", "male"),
    "hm_psi": ("Psi (Hindi)", "hi", "male"),
}
# Kokoro pipeline language codes.
_KOKORO_LANG = {"en": "a", "en-gb": "b", "hi": "h", "es": "e", "fr": "f", "it": "i", "ja": "j", "pt": "p", "zh": "z"}
_XTTS_LANGS = {"en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh", "hu", "ko", "ja", "hi"}

_SAFE_NAME = re.compile(r"[^a-zA-Z0-9_-]")


@dataclass
class VoiceInfo:
    id: str
    name: str
    kind: str  # builtin | clone
    languages: list[str]
    gender: str = ""


class KokoroEngine:
    def __init__(self) -> None:
        self._pipelines: dict[str, object] = {}
        self._lock = threading.Lock()

    def _pipeline(self, lang: str):
        code = _KOKORO_LANG.get(lang, "a")
        with self._lock:
            if code not in self._pipelines:
                from kokoro import KPipeline

                self._pipelines[code] = KPipeline(lang_code=code)
            return self._pipelines[code]

    def synth(self, text: str, voice: str, lang: str) -> bytes:
        pipeline = self._pipeline(lang)
        chunks = [np.asarray(audio) for _, _, audio in pipeline(text, voice=voice)]  # type: ignore[operator]
        if not chunks:
            return b""
        return resample(float_to_pcm16(np.concatenate(chunks)), 24000, RATE)


class XTTSEngine:
    def __init__(self) -> None:
        self._tts = None

    def synth(self, text: str, speaker_wav: Path, lang: str) -> bytes:
        if self._tts is None:
            import torch
            from TTS.api import TTS

            self._tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(
                "cuda" if torch.cuda.is_available() else "cpu"
            )
        lang = "zh-cn" if lang == "zh" else lang
        wav = self._tts.tts(text=text, speaker_wav=str(speaker_wav), language=lang)
        return resample(float_to_pcm16(np.asarray(wav, dtype=np.float32)), 24000, RATE)


class TTSRouter:
    def __init__(self, voices_dir: Path, provider: str = "kokoro", clone_provider: str = "xtts",
                 indic: str = "mms", parler_model: str = "ai4bharat/indic-parler-tts"):
        self.voices_dir = voices_dir
        voices_dir.mkdir(parents=True, exist_ok=True)
        self.provider = provider
        self.kokoro = KokoroEngine() if provider == "kokoro" else None
        self.xtts = XTTSEngine() if clone_provider == "xtts" else None
        self.indic = make_indic_engine(indic, parler_model)

    # ----- voice library -------------------------------------------------
    def list_voices(self) -> list[VoiceInfo]:
        voices = [
            VoiceInfo(f"kokoro:{vid}", name, "builtin", [lang], gender)
            for vid, (name, lang, gender) in KOKORO_VOICES.items()
        ]
        if self.indic is not None and self.indic.kind == "parler":
            voices += [
                VoiceInfo(f"parler:{speaker}", f"{speaker} ({INDIC_LANGS[lang][0]})", "builtin", [lang], gender)
                for lang, speakers in PARLER_SPEAKERS.items()
                for speaker, gender in speakers
            ]
        elif self.indic is not None:
            voices += [VoiceInfo(f"mms:{lang}", name, "builtin", [lang]) for lang, (name, _) in INDIC_LANGS.items()]
        for meta in sorted(self.voices_dir.glob("*.json")):
            info = json.loads(meta.read_text())
            voices.append(VoiceInfo(f"clone:{meta.stem}", info.get("label", meta.stem), "clone", sorted(_XTTS_LANGS)))
        return voices

    def add_clone(self, label: str, audio_bytes: bytes) -> VoiceInfo:
        pcm, rate = decode_audio(audio_bytes)
        seconds = len(pcm) / 2 / rate
        if seconds < 6:
            raise ValueError("Please record at least 6 seconds (15 to 30 is best).")
        name = _SAFE_NAME.sub("_", label.strip().lower())[:40] or "voice"
        (self.voices_dir / f"{name}.wav").write_bytes(to_wav(pcm, rate))
        (self.voices_dir / f"{name}.json").write_text(json.dumps({"label": label, "seconds": round(seconds, 1)}))
        return VoiceInfo(f"clone:{name}", label, "clone", sorted(_XTTS_LANGS))

    def delete_clone(self, name: str) -> None:
        name = _SAFE_NAME.sub("_", name)
        for ext in ("wav", "json"):
            (self.voices_dir / f"{name}.{ext}").unlink(missing_ok=True)

    def supported_languages(self, voice: str) -> set[str]:
        langs = set(_XTTS_LANGS) if voice.startswith("clone:") else {"en", "hi"} | set(_KOKORO_LANG) - {"en-gb"}
        if self.indic is not None:
            langs |= set(INDIC_LANGS)
        return langs

    def warm_up(self, voice: str, langs: list[str]) -> None:
        """Download and load the voices ahead of the first call."""
        if self.provider == "silent":
            return
        if self.kokoro is not None:
            kind, _, name = voice.partition(":")
            self.kokoro.synth("Hello.", name if kind == "kokoro" else "af_heart", "en")
        if self.indic is not None:
            for lang in langs:
                if lang in INDIC_LANGS:
                    self.indic.warm_up(lang)

    # ----- synthesis -----------------------------------------------------
    def _synth_sync(self, text: str, voice: str, lang: str) -> bytes:
        if self.provider == "silent":
            # A short burst of silence; lets tests run the audio path quickly.
            return b"\x00\x00" * (RATE // 10)
        kind, _, name = voice.partition(":")
        gender = _gender(voice)
        if lang in INDIC_LANGS and guess_language(text) == "en":
            lang = "en"  # the reply came out in English letters, which these voices can't read
        if lang in INDIC_LANGS and self.indic is not None:
            return self.indic.synth(text, lang, gender, name if kind == "parler" else "")
        if kind == "clone" and self.xtts is not None:
            ref = self.voices_dir / f"{_SAFE_NAME.sub('_', name)}.wav"
            if ref.exists():
                return self.xtts.synth(text, ref, lang if lang in _XTTS_LANGS else "en")
        assert self.kokoro is not None
        if kind == "kokoro" and name in KOKORO_VOICES:
            kvoice = name
        else:
            kvoice = "am_michael" if gender == "male" else "af_heart"
        kvoice = _voice_for_language(kvoice, lang)
        return self.kokoro.synth(text, kvoice, lang if lang in _KOKORO_LANG else "en")

    async def synthesize(self, text: str, voice: str, lang: str = "en") -> bytes:
        return await asyncio.to_thread(self._synth_sync, text, voice, lang)


def _voice_for_language(voice: str, lang: str) -> str:
    """Kokoro voices are trained per language; pick a same-gender voice that
    matches the language being spoken."""
    _, vlang, gender = KOKORO_VOICES.get(voice, ("", "en", "female"))
    if vlang == lang or (lang not in ("hi",) and vlang == "en"):
        return voice
    for vid, (_, l, g) in KOKORO_VOICES.items():
        if l == lang and g == gender:
            return vid
    return voice


def _gender(voice: str) -> str:
    kind, _, name = voice.partition(":")
    if kind == "kokoro":
        return KOKORO_VOICES.get(name, ("", "", ""))[2]
    if kind == "parler":
        for speakers in PARLER_SPEAKERS.values():
            for speaker, gender in speakers:
                if speaker == name:
                    return gender
    return ""

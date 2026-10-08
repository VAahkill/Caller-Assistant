"""Text to speech, with built-in voices and user-recorded voice clones.

Voice ids look like ``kokoro:af_heart`` (built-in Kokoro voice, English or Hindi),
``piper:te_IN-padmavathi-medium`` (Piper, Telugu), ``mms:te`` or ``parler:Lalitha``
(Indian-language voices, see ``indic.py``) and ``clone:<slug>-<6 hex>`` (a voice the
user recorded in the app, spoken with XTTS-v2).

Each sentence is spoken by a voice that can read its script: Telugu or Tamil letters
never go to Kokoro or XTTS. The voice is the one the user chose for that language
(``Profile.voices_by_language``), else their main voice if it speaks the language,
else that language's default voice of the same gender. English words inside an
Indian-language sentence are written in its script first (see transliterate.py).
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import re
import threading
import time
from dataclasses import asdict, dataclass
from collections.abc import Callable
from pathlib import Path

import numpy as np

from ..audio import RATE, decode_audio, float_to_pcm16, resample, to_wav
from ..languages import guess_language
from ..models import new_id
from ..transliterate import latin_to_script
from .indic import INDIC_LANGS, PARLER_SPEAKERS, make_indic_engine
from .piper import VOICES as PIPER_VOICES
from .piper import PiperEngine

log = logging.getLogger("opencall.tts")

KOKORO_REPO = "hexgrad/Kokoro-82M"
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
# Languages an English Kokoro voice can also read (through that language's pipeline).
_KOKORO_EXTRA = {"es", "fr", "it", "ja", "pt", "zh"}
_XTTS_LANGS = {"en", "es", "fr", "de", "it", "pt", "pl", "tr", "ru", "nl", "cs", "ar", "zh", "hu", "ko", "ja", "hi"}

# What a voice says when the user taps play, in each language.
SAMPLES = {
    "en": "Hi! I'm answering calls for you today. How does this sound?",
    "hi": "नमस्ते! यह आवाज़ आपको कैसी लगी?",
    "te": "నమస్కారం! ఈ స్వరం మీకు నచ్చిందా?",
    "ta": "வணக்கம்! இந்த குரல் உங்களுக்குப் பிடித்திருக்கிறதா?",
    "kn": "ನಮಸ್ಕಾರ! ಈ ಧ್ವನಿ ನಿಮಗೆ ಇಷ್ಟವಾಯಿತೇ?",
    "ml": "നമസ്കാരം! ഈ ശബ്ദം നിങ്ങൾക്ക് ഇഷ്ടമായോ?",
    "bn": "নমস্কার! এই কণ্ঠস্বর আপনার পছন্দ হয়েছে?",
    "mr": "नमस्कार! हा आवाज तुम्हाला आवडला का?",
    "gu": "નમસ્તે! આ અવાજ તમને ગમ્યો?",
    "pa": "ਸਤ ਸ੍ਰੀ ਅਕਾਲ! ਕੀ ਤੁਹਾਨੂੰ ਇਹ ਆਵਾਜ਼ ਪਸੰਦ ਆਈ?",
    "ur": "السلام علیکم! کیا آپ کو یہ آواز پسند آئی؟",
}

_SAFE_NAME = re.compile(r"[^a-z0-9_-]")
_CLONE_ID = re.compile(r"^[a-z0-9_-]{1,60}$")
_SENTENCE = re.compile(r"[^.!?।॥]+[.!?।॥]*\s*")
_CLONING_OFF = "Voice cloning is turned off on the server (OPENCALL_CLONE_PROVIDER)."
# Indian languages whose default voice is a Piper voice rather than MMS or Parler.
PIPER_DEFAULT = {"te"}


@dataclass
class VoiceInfo:
    id: str
    name: str
    kind: str  # builtin | clone
    engine: str  # kokoro | mms | piper | parler | xtts
    languages: list[str]
    gender: str = ""
    sample_url: str = ""  # filled in by the API
    recording_url: str = ""
    seconds: float | None = None
    created_at: float | None = None
    status: str = "ready"  # ready | preparing | failed
    detail: str = ""  # why a recorded voice failed

    def to_json(self) -> dict:
        return asdict(self)


class KokoroEngine:
    """Kokoro-82M. One model is shared by every language's pipeline (each pipeline
    would otherwise load its own copy, about 600 MB each)."""

    def __init__(self) -> None:
        self._model = None
        self._pipelines: dict[str, object] = {}
        self._lock = threading.Lock()

    def _pipeline(self, lang: str):
        code = _KOKORO_LANG.get(lang, "a")
        with self._lock:
            if self._model is None:
                import torch
                from kokoro import KModel

                device = "cuda" if torch.cuda.is_available() else "cpu"
                self._model = KModel(repo_id=KOKORO_REPO).to(device).eval()
            if code not in self._pipelines:
                from kokoro import KPipeline

                self._pipelines[code] = KPipeline(lang_code=code, repo_id=KOKORO_REPO, model=self._model)
            return self._pipelines[code]

    def synth(self, text: str, voice: str, lang: str) -> bytes:
        pipeline = self._pipeline(lang)
        chunks = [np.asarray(audio) for _, _, audio in pipeline(text, voice=voice)]  # type: ignore[operator]
        if not chunks:
            return b""
        return resample(float_to_pcm16(np.concatenate(chunks)), 24000, RATE)


class XTTSEngine:
    """XTTS-v2 (Coqui, CPML licence: free for non-commercial use) speaking in a
    recorded voice. The voice's speaker latents are worked out once, when the
    recording is added, and kept next to it."""

    def __init__(self) -> None:
        self._tts = None
        self._lock = threading.Lock()

    def _model(self):
        with self._lock:
            if self._tts is None:
                import torch
                from TTS.api import TTS

                self._tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(
                    "cuda" if torch.cuda.is_available() else "cpu"
                )
            return self._tts.synthesizer.tts_model

    def warm_up(self) -> None:
        self._model()

    def make_latents(self, reference: Path, out: Path) -> None:
        import torch

        gpt_latent, speaker = self._model().get_conditioning_latents(audio_path=[str(reference)])
        torch.save({"gpt_cond_latent": gpt_latent, "speaker_embedding": speaker}, out)

    def synth(self, text: str, reference: Path, lang: str, latents: Path) -> bytes:
        import torch

        model = self._model()
        if not latents.exists():
            self.make_latents(reference, latents)
        saved = torch.load(latents, map_location=model.device, weights_only=True)
        out = model.inference(text, "zh-cn" if lang == "zh" else lang, saved["gpt_cond_latent"],
                              saved["speaker_embedding"])
        return resample(float_to_pcm16(np.asarray(out["wav"], dtype=np.float32)), 24000, RATE)


def _gender(voice: str) -> str:
    kind, _, name = voice.partition(":")
    if kind == "kokoro":
        return KOKORO_VOICES.get(name, ("", "", ""))[2]
    if kind == "piper" and name in PIPER_VOICES:
        return PIPER_VOICES[name].gender
    if kind == "parler":
        for speakers in PARLER_SPEAKERS.values():
            for speaker, gender in speakers:
                if speaker == name:
                    return gender
    return ""


def sentences(text: str) -> list[str]:
    found = [m.group(0) for m in _SENTENCE.finditer(text) if m.group(0).strip()]
    return found or ([text] if text.strip() else [])


class TTSRouter:
    def __init__(self, voices_dir: Path, provider: str = "kokoro", clone_provider: str = "xtts",
                 indic: str = "mms", parler_model: str = "ai4bharat/indic-parler-tts", piper: str = "off",
                 piper_dir: Path | None = None):
        self.voices_dir = voices_dir
        voices_dir.mkdir(parents=True, exist_ok=True)
        self.provider = provider
        self.kokoro = KokoroEngine() if provider == "kokoro" else None
        self.xtts = XTTSEngine() if clone_provider == "xtts" else None
        self.indic = make_indic_engine(indic, parler_model)
        self.piper = PiperEngine(piper_dir) if piper == "on" else None
        self._clone_lock = threading.Lock()
        # The voice the user chose for each language (the engine points this at the profile).
        self.chosen_voices: Callable[[], dict[str, str]] = dict

    # ----- recorded voices ---------------------------------------------------
    def _clone_meta(self, name: str) -> dict | None:
        path = self.voices_dir / f"{name}.json"
        if not _CLONE_ID.match(name) or not path.exists():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def _write_meta(self, name: str, meta: dict) -> None:
        tmp = self.voices_dir / f"{name}.json.tmp"
        tmp.write_text(json.dumps(meta, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.voices_dir / f"{name}.json")

    def _clone_info(self, name: str, meta: dict) -> VoiceInfo:
        status, detail = meta.get("status", "ready"), meta.get("detail", "")
        if self.xtts is None and status != "preparing":
            status, detail = "failed", _CLONING_OFF
        return VoiceInfo(f"clone:{name}", meta.get("label", name), "clone", "xtts",
                         sorted(_XTTS_LANGS) if self.xtts is not None else [],
                         recording_url=f"/voices/clone:{name}/recording", seconds=meta.get("seconds"),
                         created_at=meta.get("created_at"), status=status, detail=detail)

    def clones(self) -> list[VoiceInfo]:
        """Recorded voices, newest first."""
        found = [self._clone_info(p.stem, meta) for p in self.voices_dir.glob("*.json")
                 if (meta := self._clone_meta(p.stem)) is not None]
        return sorted(found, key=lambda v: (v.created_at or 0.0, v.id), reverse=True)

    def add_clone(self, label: str, audio_bytes: bytes) -> VoiceInfo:
        """Keeps a recording as a new voice (blocking: decodes the audio). It is
        "preparing" until ``prepare_clone`` has run."""
        label = label.strip()[:80] or "My voice"
        pcm, rate = decode_audio(audio_bytes, rate=24000)  # XTTS listens to references at 24 kHz
        seconds = len(pcm) / 2 / rate
        if seconds < 6:
            raise ValueError("Please record at least 6 seconds (15 to 30 is best).")
        slug = _SAFE_NAME.sub("_", label.lower())[:40].strip("_") or "voice"
        with self._clone_lock:
            name = f"{slug}-{new_id()[:6]}"
            while (self.voices_dir / f"{name}.json").exists():
                name = f"{slug}-{new_id()[:6]}"
            (self.voices_dir / f"{name}.wav").write_bytes(to_wav(pcm, rate))
            meta = {"label": label, "seconds": round(seconds, 1), "created_at": time.time(), "status": "preparing"}
            self._write_meta(name, meta)
        return self._clone_info(name, meta)

    def prepare_clone(self, voice_id: str) -> VoiceInfo:
        """Works out the recorded voice's speaker latents (blocking), so it speaks
        without that delay later; marks it ready, or failed with the reason."""
        name = voice_id.partition(":")[2]
        meta = self._clone_meta(name)
        if meta is None:
            raise KeyError(voice_id)
        if self.xtts is None:
            meta.update(status="failed", detail=_CLONING_OFF)
        else:
            try:
                self.xtts.make_latents(self.voices_dir / f"{name}.wav", self.voices_dir / f"{name}.latents.pt")
                meta.update(status="ready", detail="")
            except Exception as e:
                log.exception("Couldn't prepare the recorded voice %s", voice_id)
                meta.update(status="failed", detail=f"{e.__class__.__name__}: {e}"[:300])
        with self._clone_lock:
            if self._clone_meta(name) is not None:  # not deleted meanwhile
                self._write_meta(name, meta)
        return self._clone_info(name, meta)

    def rename_clone(self, voice_id: str, label: str) -> VoiceInfo:
        name = voice_id.partition(":")[2]
        with self._clone_lock:
            meta = self._clone_meta(name)
            if meta is None:
                raise KeyError(voice_id)
            meta["label"] = label.strip()[:80] or meta.get("label", name)
            self._write_meta(name, meta)
        return self._clone_info(name, meta)

    def clone_recording(self, voice_id: str) -> Path | None:
        kind, _, name = voice_id.partition(":")
        path = self.voices_dir / f"{name}.wav"
        return path if kind == "clone" and self._clone_meta(name) is not None and path.exists() else None

    def delete_clone(self, voice_id: str) -> bool:
        """Deletes a recorded voice; False if there was none with this id."""
        name = voice_id.partition(":")[2] if ":" in voice_id else voice_id
        if not _CLONE_ID.match(name):
            return False
        with self._clone_lock:
            existed = (self.voices_dir / f"{name}.json").exists()
            for suffix in (".wav", ".json", ".latents.pt"):
                (self.voices_dir / f"{name}{suffix}").unlink(missing_ok=True)
        return existed

    # ----- the voice library ---------------------------------------------------
    def builtin_voices(self) -> list[VoiceInfo]:
        voices = []
        if self.kokoro is not None:
            voices += [VoiceInfo(f"kokoro:{vid}", name, "builtin", "kokoro", [lang], gender)
                       for vid, (name, lang, gender) in KOKORO_VOICES.items()]
        if self.piper is not None:
            voices += [VoiceInfo(f"piper:{v.id}", f"{v.name} ({INDIC_LANGS[v.language][0]})", "builtin", "piper",
                                 [v.language], v.gender) for v in PIPER_VOICES.values()]
        if self.indic is not None and self.indic.kind == "parler":
            voices += [VoiceInfo(f"parler:{speaker}", f"{speaker} ({INDIC_LANGS[lang][0]})", "builtin", "parler",
                                 [lang], gender)
                       for lang, speakers in PARLER_SPEAKERS.items() for speaker, gender in speakers]
        elif self.indic is not None:
            voices += [VoiceInfo(f"mms:{lang}", name, "builtin", "mms", [lang])
                       for lang, (name, _) in INDIC_LANGS.items()]
        return voices

    def list_voices(self) -> list[VoiceInfo]:
        """The user's recorded voices first, then the built-in ones."""
        return self.clones() + self.builtin_voices()

    def get_voice(self, voice_id: str) -> VoiceInfo | None:
        kind, _, name = voice_id.partition(":")
        if kind == "clone":
            meta = self._clone_meta(name)
            return self._clone_info(name, meta) if meta is not None else None
        return next((v for v in self.builtin_voices() if v.id == voice_id), None)

    # ----- which voice speaks what ------------------------------------------
    def speaks(self, voice: str) -> set[str]:
        """Languages this voice itself can speak."""
        kind, _, name = voice.partition(":")
        if kind == "kokoro" and self.kokoro is not None and name in KOKORO_VOICES:
            lang = KOKORO_VOICES[name][1]
            return {lang} | (_KOKORO_EXTRA if lang == "en" else set())
        if kind == "clone" and self.xtts is not None and self._clone_meta(name) is not None:
            return set(_XTTS_LANGS)
        if kind == "piper" and self.piper is not None and name in PIPER_VOICES:
            return {PIPER_VOICES[name].language}
        if kind == "mms" and self.indic is not None and self.indic.kind == "mms" and name in INDIC_LANGS:
            return {name}
        if kind == "parler" and self.indic is not None and self.indic.kind == "parler":
            return {lang for lang, speakers in PARLER_SPEAKERS.items() if any(s == name for s, _ in speakers)}
        return set()

    def default_voice(self, lang: str, gender: str = "") -> str:
        """The built-in voice for ``lang``, of this gender when there is a choice
        ("" when nothing installed can speak it)."""
        gender = gender or "female"
        if lang in INDIC_LANGS:
            if self.piper is not None and lang in PIPER_DEFAULT:
                matches = [v for v in PIPER_VOICES.values() if v.language == lang]
                pick = next((v for v in matches if v.gender == gender), matches[0])
                return f"piper:{pick.id}"
            if self.indic is not None and self.indic.kind == "parler" and lang in PARLER_SPEAKERS:
                speakers = PARLER_SPEAKERS[lang]
                return f"parler:{next((s for s, g in speakers if g == gender), speakers[0][0])}"
            return f"mms:{lang}" if self.indic is not None else ""
        if lang == "hi":
            return "kokoro:hm_omega" if gender == "male" else "kokoro:hf_alpha"
        return "kokoro:am_michael" if gender == "male" else "kokoro:af_heart"

    def voice_for(self, lang: str, voice: str, voices_by_language: dict[str, str] | None = None) -> str:
        """Who says a sentence in ``lang``: the voice chosen for that language, else the
        main voice if it can, else the language's default voice of the same gender."""
        by_language = self.chosen_voices() if voices_by_language is None else voices_by_language
        chosen = by_language.get(lang)
        if chosen and lang in self.speaks(chosen):
            return chosen
        if lang in self.speaks(voice):
            return voice
        return self.default_voice(lang, _gender(chosen or voice))

    def supported_languages(self, voice: str) -> set[str]:
        """Languages calls can be answered in with this main voice (other voices step
        in for the languages it can't speak)."""
        langs = set(self.speaks(voice))
        if self.kokoro is not None:
            langs |= {"en", "hi"} | _KOKORO_EXTRA
        if self.indic is not None:
            langs |= set(INDIC_LANGS)
        if self.piper is not None:
            langs |= {v.language for v in PIPER_VOICES.values()}
        return langs

    def warm_up(self, voice: str, langs: list[str], voices_by_language: dict[str, str] | None = None) -> None:
        """Download and load the voices ahead of the first call."""
        if self.provider == "silent":
            return
        self._speak("Hello.", self.voice_for("en", voice, voices_by_language), "en")
        for lang in dict.fromkeys(langs):
            if lang not in INDIC_LANGS:
                continue
            kind, _, name = self.voice_for(lang, voice, voices_by_language).partition(":")
            if kind == "piper" and self.piper is not None:
                self.piper.warm_up(name)
            elif kind in ("mms", "parler") and self.indic is not None:
                self.indic.warm_up(lang)
        if self.xtts is not None and self.clones():
            self.xtts.warm_up()

    # ----- synthesis -----------------------------------------------------
    def _synth_sync(self, text: str, voice: str, lang: str = "en",
                    voices_by_language: dict[str, str] | None = None) -> bytes:
        if self.provider == "silent":
            # A short burst of silence; lets tests run the audio path quickly.
            return b"\x00\x00" * (RATE // 10)
        # Each sentence by its script; neighbours in the same script are said in one go.
        pieces: list[list[str]] = []
        for sentence in sentences(text):
            script = guess_language(sentence, default="en")
            if script == "hi" and lang in ("mr", "ne"):
                script = lang  # Devanagari isn't only Hindi
            if pieces and pieces[-1][0] == script:
                pieces[-1][1] += sentence
            else:
                pieces.append([script, sentence])
        gender = _gender(voice)  # a stand-in voice keeps the main voice's gender where it can
        return b"".join(self._speak(piece.strip(), self.voice_for(script, voice, voices_by_language), script, gender)
                        for script, piece in pieces)

    def _speak(self, text: str, voice: str, lang: str, gender: str = "") -> bytes:
        """``text`` (all in ``lang``'s script) in this voice."""
        kind, _, name = voice.partition(":")
        if kind == "piper" and self.piper is not None:
            return self.piper.synth(latin_to_script(text, lang), name)
        if kind in ("mms", "parler") and self.indic is not None and lang in INDIC_LANGS:
            return self.indic.synth(latin_to_script(text, lang), lang, _gender(voice) or gender,
                                    name if kind == "parler" else "")
        if kind == "clone" and self.xtts is not None and lang in _XTTS_LANGS:
            ref = self.voices_dir / f"{name}.wav"
            if ref.exists():
                return self.xtts.synth(text, ref, lang, self.voices_dir / f"{name}.latents.pt")
        if lang in INDIC_LANGS or self.kokoro is None:
            log.warning("No voice installed can say %r in %s; it is left out.", text[:60], lang)
            return b""
        kvoice = name if kind == "kokoro" and name in KOKORO_VOICES else "af_heart"
        return self.kokoro.synth(text, kvoice, lang if lang in _KOKORO_LANG else "en")

    async def synthesize(self, text: str, voice: str, lang: str = "en",
                         voices_by_language: dict[str, str] | None = None) -> bytes:
        return await asyncio.to_thread(self._synth_sync, text, voice, lang, voices_by_language)

    # ----- demos -----------------------------------------------------------
    def sample_language(self, voice_id: str, lang: str | None = None) -> str:
        """The language a voice's demo is in: ``lang`` if the voice speaks it, else
        the voice's own language."""
        speaks = self.speaks(voice_id)
        if lang and lang in speaks and lang in SAMPLES:
            return lang
        info = self.get_voice(voice_id)
        own = [code for code in (info.languages if info else []) if code in SAMPLES]
        return "en" if not own or "en" in own else own[0]

    def sample_key(self, voice_id: str, lang: str) -> str:
        """Changes whenever the demo would sound different (its text, or a voice
        recorded again under the same id)."""
        meta = self._clone_meta(voice_id.partition(":")[2]) if voice_id.startswith("clone:") else None
        stamp = f"{meta.get('created_at')}|{meta.get('status')}" if meta else ""
        text = SAMPLES.get(lang, SAMPLES["en"])
        return hashlib.sha1(f"1|{voice_id}|{lang}|{text}|{stamp}".encode()).hexdigest()[:10]

    def render_sample(self, voice_id: str, lang: str) -> bytes:
        """The demo line in ``lang``, said by this voice (blocking)."""
        if self.provider == "silent":
            return b"\x00\x00" * (RATE // 10)
        return self._speak(SAMPLES.get(lang, SAMPLES["en"]), voice_id, lang)

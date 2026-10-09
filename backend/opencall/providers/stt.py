"""Speech to text.

One main Whisper model (``OPENCALL_WHISPER_MODEL``) handles English and any language
without a better model, plus per-language models for the Indian languages callers
speak most (Whisper models fine-tuned on that language; see ``DEFAULT_MODELS``). The
call's language is decided first (``languages.LanguageTracker``), and the turn is
then transcribed in that language by that language's model.
"""

from __future__ import annotations

import asyncio
import logging
import math
import os
import re
import shutil
import tempfile
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from ..audio import pcm16_to_float, split_at_pauses, trim_silence

log = logging.getLogger("opencall.stt")

# Per-language models, used when the call is in that language. All Apache-2.0 and
# downloadable without an account; fine-tuned from Whisper small, so each is small
# and quick. Measured against the main model with the language forced, on FLEURS
# *test* speech these models never saw (see docs/ARCHITECTURE.md for the numbers).
# Override or turn off with OPENCALL_STT_MODELS, e.g. "te=org/other-model,hi=off".
DEFAULT_MODELS: dict[str, str] = {
    "te": "vasista22/whisper-telugu-small@717212f9c4c16a78a86ddcb98f93c7f73ef8a5cc",
    "ta": "vasista22/whisper-tamil-small@ac0d71cd70d4c66aec7126996cd9e56e97e698b7",
    "hi": "vasista22/whisper-hindi-small@fb4a24afc20c42906deed31c3689e4be31da41fe",
}
# What a Hugging Face Whisper fine-tune needs for conversion (not its Flax copy).
_HF_FILES = ["config.json", "generation_config.json", "preprocessor_config.json", "added_tokens.json",
             "merges.txt", "normalizer.json", "special_tokens_map.json", "tokenizer_config.json", "vocab.json",
             "tokenizer.json", "model.safetensors", "pytorch_model.bin"]
_OFF = {"", "off", "none", "default", "main"}


@dataclass
class Transcription:
    text: str
    language: str = "en"


class STT(Protocol):
    async def transcribe(self, pcm16k: bytes, language_hint: str | None = None) -> Transcription: ...


def parse_models(spec: str, defaults: dict[str, str] | None = None) -> dict[str, str]:
    """``"te=org/model@rev, hi=off"`` on top of ``defaults``; "off" means the main model."""
    models = dict(DEFAULT_MODELS if defaults is None else defaults)
    for item in spec.split(","):
        lang, sep, model = item.partition("=")
        lang, model = lang.strip().lower(), model.strip()
        if not sep or not lang:
            if item.strip():
                log.warning("Ignoring %r in OPENCALL_STT_MODELS (expected lang=model).", item.strip())
            continue
        if model.lower() in _OFF:
            models.pop(lang, None)
        else:
            models[lang] = model
    return models


def _slug(text: str) -> str:
    return re.sub(r"[^A-Za-z0-9._-]+", "--", text).strip("-")


def _converted_dir(repo: str, revision: str | None, out_root: Path) -> Path:
    return out_root / (_slug(repo) + (f"-{revision[:12]}" if revision else ""))


def convert_to_ct2(repo: str, revision: str | None, out_root: Path) -> Path:
    """Converts a Hugging Face Whisper fine-tune to CTranslate2 int8 (what
    faster-whisper runs), once; later calls return the converted folder. The original
    weights are downloaded to a temporary folder and deleted afterwards."""
    out = _converted_dir(repo, revision, out_root)
    if (out / "model.bin").exists():
        return out
    from ctranslate2.converters import TransformersConverter
    from huggingface_hub import snapshot_download

    out_root.mkdir(parents=True, exist_ok=True)
    log.info("Preparing the %s speech model (a one-time download and conversion)...", repo)
    with tempfile.TemporaryDirectory(dir=out_root, prefix=".download-") as tmp:
        src = Path(tmp) / "hf"
        snapshot_download(repo, revision=revision, local_dir=str(src), allow_patterns=_HF_FILES)
        if (src / "model.safetensors").exists():
            (src / "pytorch_model.bin").unlink(missing_ok=True)
        if not (src / "tokenizer.json").exists():
            # faster-whisper reads tokenizer.json; older fine-tunes only ship the parts.
            from transformers import WhisperTokenizerFast

            WhisperTokenizerFast.from_pretrained(str(src)).save_pretrained(str(src))
        staged = Path(tmp) / "ct2"
        TransformersConverter(str(src), copy_files=["tokenizer.json", "preprocessor_config.json"],
                              low_cpu_mem_usage=True).convert(str(staged), quantization="int8")
        shutil.rmtree(out, ignore_errors=True)
        os.replace(staged, out)
    log.info("The %s speech model is ready.", repo)
    return out


def resolve_model(spec: str, ct2_dir: Path) -> str:
    """A path or name faster-whisper can load: a local folder, a faster-whisper model
    name ("small", "large-v3-turbo"), a CTranslate2 repo on Hugging Face, or a
    Hugging Face Whisper fine-tune (``org/name[@revision]``), converted on first use."""
    if Path(spec).expanduser().is_dir():
        return str(Path(spec).expanduser())
    repo, _, revision = spec.partition("@")
    if "/" not in repo:
        return spec  # one of faster-whisper's own model names
    converted = _converted_dir(repo, revision or None, ct2_dir)
    if (converted / "model.bin").exists():
        return str(converted)
    from huggingface_hub import list_repo_files

    if "model.bin" in list_repo_files(repo, revision=revision or None):
        return repo  # already a CTranslate2 model
    return str(convert_to_ct2(repo, revision or None, ct2_dir))


class FasterWhisperSTT:
    """Faster-Whisper on CPU or GPU, with an optional model per language."""

    def __init__(self, model: str = "large-v3-turbo", device: str = "auto", languages: list[str] | None = None,
                 models: dict[str, str] | None = None, models_dir: Path | None = None, cpu_threads: int = 0,
                 owner_english: str = ""):
        self.model_name = model
        self.device = device
        # Only used when no language is given (language ID turned off): speech is then
        # only ever recognised as one of these. Whisper often mistakes Telugu for Tamil
        # (and similar pairs); limiting it to the languages callers speak avoids that.
        self.languages = languages or []
        self.models = dict(models or {})  # language -> model spec
        self.ct2_dir = (models_dir or Path("./data/models")) / "ct2"
        self.cpu_threads = cpu_threads
        # The user's own spoken replies in English (the app's microphone during a
        # call). That is clear, close-up speech, not a phone line: a small model hears
        # it as well as the main one and is about 3x quicker on a CPU, which is time
        # the caller spends waiting. Empty: the main model. Their replies in another
        # language use that language's model, like the callers'.
        self.owner_english = "" if owner_english.strip().lower() in _OFF else owner_english.strip()
        self._model = None  # the main model
        self._extra: dict[str, object] = {}  # per-language models by spec
        self._failed: set[str] = set()
        self._lock = threading.Lock()
        self._locks: dict[str, threading.Lock] = {}

    def warm_up(self, languages: list[str] | None = None) -> None:
        """Load the main model, and the models for these languages, now."""
        self._load()
        for lang in languages or []:
            self._model_for(lang)

    def model_for(self, language: str | None) -> str:
        """The model spec that transcribes this language."""
        spec = self.models.get(language or "", self.model_name)
        return self.model_name if spec in self._failed else spec

    def _device(self) -> tuple[str, str]:
        device = self.device
        if device == "auto":
            try:
                import torch

                device = "cuda" if torch.cuda.is_available() else "cpu"
            except ImportError:
                device = "cpu"
        return device, "float16" if device == "cuda" else "int8"

    def _open(self, spec: str):
        from faster_whisper import WhisperModel  # heavy import, done once

        device, compute = self._device()
        return WhisperModel(resolve_model(spec, self.ct2_dir), device=device, compute_type=compute,
                            cpu_threads=self.cpu_threads)

    def _load(self):
        """The main model."""
        with self._lock:
            if self._model is None:
                self._model = self._open(self.model_name)
            return self._model

    def _model_for(self, language: str | None):
        """This language's own model (loaded, and converted if needed, on first use);
        the main one when it has none or its model can't be loaded."""
        return self._model_by_spec(self.model_for(language), language or "")

    def _model_by_spec(self, spec: str, language: str):
        if spec == self.model_name or spec in self._failed:
            return self._load()
        with self._lock:
            lock = self._locks.setdefault(spec, threading.Lock())
        with lock:
            if spec not in self._extra:
                try:
                    self._extra[spec] = self._open(spec)
                except Exception as e:
                    log.warning("Couldn't load the %s speech model %s (%s: %s); using %s for it instead.",
                                language, spec, e.__class__.__name__, e, self.model_name)
                    self._failed.add(spec)
                    return self._load()
            return self._extra[spec]

    def detect_language(self, pcm16k: bytes) -> dict[str, float]:
        """Whisper's own language guess, as log-probabilities (used only when the
        language-ID model isn't available)."""
        _, _, probs = self._load().detect_language(pcm16_to_float(pcm16k[: 30 * 32000]))
        return {lang: math.log(max(p, 1e-12)) for lang, p in probs}

    def warm_up_owner(self, language: str) -> None:
        """Load the model for the user's spoken replies in ``language`` now. Not the
        one for English replies: it takes about 0.5 GB, so it is loaded the first
        time the user speaks a reply (a few seconds, once)."""
        if language != "en" or not self.owner_english:
            self._model_for(language)

    def _run(self, pcm16k: bytes, language_hint: str | None, spec: str = "") -> Transcription:
        model = self._model_by_spec(spec, language_hint or "") if spec else self._model_for(language_hint)
        # The silence around the words is cut first: given silence or line noise after
        # the speech, Whisper (the fine-tuned models most of all) tends to go on
        # "hearing" sentences nobody said. On held-out Tamil this took the worst clips
        # from a character error rate above 1 to under 0.3.
        pcm16k = trim_silence(pcm16k) or pcm16k
        # Whisper writes at most 224 tokens per piece of audio. Telugu or Tamil needs
        # up to 20 a second, so a long turn would stop mid-word; it is transcribed in
        # pieces cut at pauses instead, all in the language of the first one.
        first, *rest = split_at_pauses(pcm16k)
        heard = self._once(model, first, language_hint)
        texts = [heard.text] + [self._once(model, piece, heard.language).text for piece in rest]
        # A piece that still ran out of tokens ends in half a character.
        text = " ".join(t for t in texts if t).replace("\ufffd", "").strip()
        return Transcription(text=text, language=heard.language)

    def _once(self, model, pcm16k: bytes, language_hint: str | None) -> Transcription:
        audio = pcm16_to_float(pcm16k)
        options = dict(beam_size=1, vad_filter=False, condition_on_previous_text=False)
        segments, info = model.transcribe(audio, language=language_hint, **options)
        if not language_hint and self.languages and info.language not in self.languages:
            # Segments are lazy, so nothing was transcribed yet; redo it in the most
            # likely of the allowed languages.
            segments, info = model.transcribe(audio, language=_closest(info, self.languages), **options)
        text = " ".join(s.text.strip() for s in segments).strip()
        return Transcription(text=text, language=info.language or "en")

    async def transcribe(self, pcm16k: bytes, language_hint: str | None = None) -> Transcription:
        return await asyncio.to_thread(self._run, pcm16k, language_hint)

    async def transcribe_owner(self, pcm16k: bytes, language_hint: str | None = None) -> Transcription:
        """The user's own recorded reply (see ``owner_english``)."""
        spec = self.owner_english if language_hint == "en" else ""
        return await asyncio.to_thread(self._run, pcm16k, language_hint, spec)


# Whisper's mistakes mostly stay inside a language family (Telugu heard as Tamil
# or Kannada), so a wrong guess is first corrected to an allowed language of the
# same family.
_FAMILIES = [{"te", "ta", "kn", "ml"}, {"hi", "mr", "ne", "gu", "pa", "bn", "ur"}]


def _closest(info, allowed: list[str]) -> str:
    probs = dict(info.all_language_probs or [])
    family = next((f for f in _FAMILIES if info.language in f), set())
    candidates = [code for code in allowed if code in family] or allowed
    return max(candidates, key=lambda code: probs.get(code, 0.0))


class NullSTT:
    async def transcribe(self, pcm16k: bytes, language_hint: str | None = None) -> Transcription:
        return Transcription(text="")

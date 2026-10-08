"""Voice demos for the app: each voice saying a short line, made once and kept on
disk, so tapping play starts at once. Built-in voices are made at startup, recorded
voices when they are added; anything else the first time it is asked for, with
requests for the same demo sharing one job."""

from __future__ import annotations

import asyncio
import logging
import re
from pathlib import Path

from .audio import RATE, to_wav
from .providers.tts import TTSRouter, VoiceInfo

log = logging.getLogger("opencall.samples")

_UNSAFE = re.compile(r"[^A-Za-z0-9_.-]")


class VoiceNotReady(Exception):
    """A recorded voice that can't speak yet (still preparing, or failed)."""


class VoiceSamples:
    def __init__(self, tts: TTSRouter, folder: Path) -> None:
        self.tts = tts
        self.folder = folder
        folder.mkdir(parents=True, exist_ok=True)
        self._jobs: dict[str, asyncio.Future] = {}

    def _prefix(self, voice_id: str, lang: str) -> str:
        return f"{_UNSAFE.sub('_', voice_id)}-{lang}-"

    def locate(self, voice_id: str, lang: str | None = None) -> tuple[str, str, Path]:
        """(language, version, file) of a voice's demo."""
        lang = self.tts.sample_language(voice_id, lang)
        key = self.tts.sample_key(voice_id, lang)
        return lang, key, self.folder / f"{self._prefix(voice_id, lang)}{key}.wav"

    def url(self, voice: VoiceInfo, lang: str | None = None) -> str:
        lang, key, _ = self.locate(voice.id, lang)
        return f"/voices/{voice.id}/sample.wav?lang={lang}&v={key}"

    def render(self, voice_id: str, lang: str | None = None) -> Path:
        """Makes the demo if it isn't on disk yet (blocking); returns its file."""
        lang, key, path = self.locate(voice_id, lang)
        if path.exists():
            return path
        info = self.tts.get_voice(voice_id)
        if info is None:
            raise KeyError(voice_id)
        if info.status != "ready":
            raise VoiceNotReady(info.detail or "This voice is still being prepared.")
        pcm = self.tts.render_sample(voice_id, lang)
        if not pcm:
            raise RuntimeError(f"{voice_id} made no audio for its {lang} demo")
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(to_wav(pcm, RATE))
        tmp.replace(path)
        for old in self.folder.glob(f"{self._prefix(voice_id, lang)}*.wav"):
            if old != path:
                old.unlink(missing_ok=True)  # an older version of this demo
        return path

    async def get(self, voice_id: str, lang: str | None = None) -> tuple[Path, str]:
        """The demo's file and version, made now if needed; asking again while it is
        being made waits for the same job."""
        _, key, path = self.locate(voice_id, lang)
        if path.exists():
            return path, key
        job = self._jobs.get(path.name)
        if job is None:
            job = asyncio.ensure_future(asyncio.to_thread(self.render, voice_id, lang))
            self._jobs[path.name] = job
            job.add_done_callback(lambda _: self._jobs.pop(path.name, None))
        return await asyncio.shield(job), key

    def prerender(self, languages: list[str]) -> int:
        """Makes the demos of the built-in voices that speak these languages and of
        the recorded voices (blocking). Returns how many were made or found."""
        done = 0
        for voice in self.tts.list_voices():
            if voice.kind == "builtin" and not set(voice.languages) & set(languages):
                continue
            if voice.status != "ready":
                continue
            try:
                self.render(voice.id)
                done += 1
            except Exception as e:  # one voice failing (a download, say) doesn't stop the rest
                log.warning("Couldn't make the demo for %s: %s: %s", voice.id, e.__class__.__name__, e)
        return done

    def forget(self, voice_id: str) -> None:
        for path in self.folder.glob(f"{_UNSAFE.sub('_', voice_id)}-*.wav"):
            path.unlink(missing_ok=True)

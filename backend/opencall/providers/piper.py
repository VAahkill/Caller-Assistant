"""Piper voices (https://github.com/rhasspy/piper): natural-sounding, small (60 MB)
and much faster than real time on a CPU. Used for Telugu, where they are trained on
recordings of native speakers (IndicVoices-R, CC-BY-4.0).

The voice models are plain ONNX files, run here with onnxruntime. Their phonemes
come from the espeak-ng program (run as a separate process, as Piper itself does);
the Piper Python package isn't used.
"""

from __future__ import annotations

import json
import logging
import re
import shutil
import subprocess
import threading
import unicodedata
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..audio import RATE, float_to_pcm16, resample
from .lid import fetch_pinned

log = logging.getLogger("opencall.piper")

REPO = "rhasspy/piper-voices"
REVISION = "c10ece1aade47bb51c153c893d14e5bf8e5b7117"


@dataclass(frozen=True)
class PiperVoice:
    id: str  # te_IN-padmavathi-medium
    name: str
    language: str
    gender: str
    files: dict[str, str]  # path in the repo -> SHA-256


VOICES = {
    v.id: v for v in [
        PiperVoice("te_IN-padmavathi-medium", "Padmavathi", "te", "female", {
            "te/te_IN/padmavathi/medium/te_IN-padmavathi-medium.onnx":
                "414aa5960d91ceb6e45bbdf8c27fdc71af09f205130d7be4e99470f3c2cfa57d",
            "te/te_IN/padmavathi/medium/te_IN-padmavathi-medium.onnx.json":
                "6c86e4ee99d379815f78a75f23cdad62ccf50370062dd915c233d6e22de7109f",
        }),
        PiperVoice("te_IN-venkatesh-medium", "Venkatesh", "te", "male", {
            "te/te_IN/venkatesh/medium/te_IN-venkatesh-medium.onnx":
                "dfaa5b7833cd48d946f3fe18c9c934aaa4e8590aac6922fddf34783a694c3c87",
            "te/te_IN/venkatesh/medium/te_IN-venkatesh-medium.onnx.json":
                "59bad556763d1f24b3434201d7bdee275bb1a70db3e1c65d38e6c3d39b224343",
        }),
    ]
}

# Clauses end at these; a sentence ends at the first four.
_SENTENCE_END = ".!?।"
_CLAUSE = re.compile(r"([^,.!?;:।]+)([,.!?;:।]*)")
_LANGUAGE_SWITCH = re.compile(r"\([a-z-]+\)")  # espeak-ng's "(en)" markers


def espeak_available() -> bool:
    return shutil.which("espeak-ng") is not None


def phonemize(text: str, espeak_voice: str) -> list[str]:
    """One phoneme string per sentence, in the form Piper voices were trained on:
    espeak-ng's IPA for each clause, followed by the clause's punctuation."""
    clauses = [(words.strip(), punct[:1]) for words, punct in _CLAUSE.findall(text)]
    clauses = [(words, punct) for words, punct in clauses if any(ch.isalnum() for ch in words)]
    if not clauses:
        return []
    exe = shutil.which("espeak-ng")
    if exe is None:
        raise RuntimeError("espeak-ng isn't installed (apt install espeak-ng); Piper voices need it.")
    done = subprocess.run([exe, "-q", "--ipa", "-v", espeak_voice], input="\n".join(w for w, _ in clauses),
                          capture_output=True, text=True, timeout=30, check=True)
    lines = done.stdout.splitlines()
    if len(lines) != len(clauses):
        raise RuntimeError(f"espeak-ng gave {len(lines)} lines for {len(clauses)} clauses")
    sentences, current = [], ""
    for (_, punct), ipa in zip(clauses, lines, strict=True):
        current += _LANGUAGE_SWITCH.sub("", ipa).strip()
        if punct in _SENTENCE_END and punct:
            sentences.append(current + ("." if punct == "।" else punct))
            current = ""
        elif punct:
            current += punct + " "
        else:
            current += " "
    if current.strip():
        sentences.append(current.strip())
    return sentences


def phoneme_ids(phonemes: str, id_map: dict[str, list[int]]) -> list[int]:
    """Piper's input: start, then each phoneme followed by a pad, then end."""
    ids = id_map["^"] + id_map["_"]
    missing = set()
    for ch in unicodedata.normalize("NFD", phonemes):
        if ch in id_map:
            ids += id_map[ch] + id_map["_"]
        else:
            missing.add(ch)
    if missing:
        log.debug("Phonemes the voice doesn't know, left out: %s", "".join(sorted(missing)))
    return ids + id_map["$"]


class PiperEngine:
    kind = "piper"

    def __init__(self, model_dir: Path | None = None, sentence_pause: float = 0.15) -> None:
        self.model_dir = model_dir  # None: the Hugging Face cache
        self.sentence_pause = sentence_pause
        self._voices: dict[str, tuple] = {}
        self._lock = threading.Lock()

    def _load(self, voice_id: str):
        with self._lock:
            if voice_id not in self._voices:
                import onnxruntime as ort

                voice = VOICES[voice_id]
                folder = fetch_pinned(REPO, REVISION, voice.files, self.model_dir)
                onnx_path = folder / Path(next(p for p in voice.files if p.endswith(".onnx"))).name
                config = json.loads(onnx_path.with_suffix(".onnx.json").read_text(encoding="utf-8"))
                session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
                self._voices[voice_id] = (session, config)
            return self._voices[voice_id]

    def warm_up(self, voice_id: str) -> None:
        self.synth("నమస్కారం.", voice_id)

    def synth(self, text: str, voice_id: str) -> bytes:
        session, config = self._load(voice_id)
        rate = config["audio"]["sample_rate"]
        inference = config.get("inference", {})
        scales = np.array([inference.get("noise_scale", 0.667), inference.get("length_scale", 1.0),
                           inference.get("noise_w", 0.8)], dtype=np.float32)
        pause = np.zeros(int(rate * self.sentence_pause), dtype=np.float32)
        audio: list[np.ndarray] = []
        for sentence in phonemize(text, config["espeak"]["voice"]):
            ids = phoneme_ids(sentence, config["phoneme_id_map"])
            feed = {"input": np.array([ids], dtype=np.int64), "input_lengths": np.array([len(ids)], dtype=np.int64),
                    "scales": scales}
            if config.get("num_speakers", 1) > 1:
                feed["sid"] = np.array([0], dtype=np.int64)
            wav = session.run(None, feed)[0].squeeze()
            audio += [wav.astype(np.float32), pause]
        if not audio:
            return b""
        return resample(float_to_pcm16(np.concatenate(audio[:-1])), rate, RATE)

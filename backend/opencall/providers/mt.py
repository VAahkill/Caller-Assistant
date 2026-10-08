"""Translation between the caller's language and English.

The assistant thinks in English; what callers say is translated into English for it,
and its English replies are translated into the caller's language, a sentence at a
time so speech can start before the whole reply is written.

Engine: AI4Bharat's IndicTrans2 (distilled, 200M parameters; MIT), as int8 ONNX
exports (hari31416/indictrans2-{en-indic,indic-en}-dist-200M-ONNX-int8, MIT), pinned
to a revision and checked by SHA-256. About 500 MB for both directions, downloaded
once, no account needed, and quick on a CPU. Between two Indian languages it goes
through English.

``none`` translates nothing (English-only use, and tests).
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import logging
import re
import sys
import threading
import types
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import numpy as np

from .lid import fetch_pinned

log = logging.getLogger("opencall.mt")

# Language code -> IndicTrans2's (FLORES-200) code.
FLORES = {
    "en": "eng_Latn", "hi": "hin_Deva", "te": "tel_Telu", "ta": "tam_Taml", "kn": "kan_Knda",
    "ml": "mal_Mlym", "bn": "ben_Beng", "mr": "mar_Deva", "gu": "guj_Gujr", "pa": "pan_Guru",
    "or": "ory_Orya", "as": "asm_Beng", "ur": "urd_Arab", "ne": "npi_Deva",
}


@dataclass(frozen=True)
class Bundle:
    repo: str
    revision: str
    files: dict[str, str]  # name -> SHA-256


BUNDLES = {
    "en-indic": Bundle("hari31416/indictrans2-en-indic-dist-200M-ONNX-int8",
                       "1eaa43a3fb76f382f1b22c76e56f6ab4926ad68b", {
        "encoder_model.onnx": "87c3d6c6fbc48d9d7081927f3bd59915d5443a06cb63460e0d3705bae74de5a9",
        "encoder_model.onnx.data": "71a4d119514411a3cb3f9d76d2d88d5c4eac7c8e907397d62d5b29e2468a0c16",
        "decoder_model.onnx": "58c0fafb7ba0f343acba8643a386fab08143d49ef24472cefaecc87080f44e75",
        "decoder_with_past_model.onnx": "a2e9a87ff7563f5fc87fe8102188be37fb66771cf30970e649ca67be7f895497",
        "decoder_shared.onnx.data": "902314746ac629ae2ff584709c03eecdb0b3f7be4fb70ce0ff1bfbe66f14e574",
        "tokenizer_src.json": "ac1930c411028ba3a7929f35bc7f62d2e5e837ca24150b661de4f4606469eeca",
        "tokenizer_tgt.json": "51b05cd37636765e158146534d54452be558df32c6ab06ba4caeecdd0266a580",
        "tokenizer_meta.json": "9f18574a040d815695f98ac53e7d8ca18ae38b90a339eb59301690fccfc62437",
        "generation_config.json": "6c8b29ae72e680d5a2d9e849567f6f556d3f4e9bbd42434964a646f49b556972",
    }),
    "indic-en": Bundle("hari31416/indictrans2-indic-en-dist-200M-ONNX-int8",
                       "a7ecdc0ba73148c6e1d051ca372332471d8aff4f", {
        "encoder_model.onnx": "79dd1c3d9f90f8bbd48effcc2d150616ac3a97525c8081481f14cd5095567ca6",
        "encoder_model.onnx.data": "6c402df00dfc45a69607e0231e1e5fd884508b19ca664836c94dd61bfa1ba137",
        "decoder_model.onnx": "845cdbaf0ee97d3c8ddff249a2e2d6e475d7ae1781157fcc6d0d651405bb8dd6",
        "decoder_with_past_model.onnx": "bcc818db56bc681fab2d50ca31b99dbcb5f82abbce4dccc92946edf5906fa86e",
        "decoder_shared.onnx.data": "abe939ce4d60bcbb9744790640188686c8af084083eb50d63bdbb7266a325d9a",
        "tokenizer_src.json": "d15ba1265a61b3b66122aab74e888442093a2c711f51b0f9896108661e1d346c",
        "tokenizer_tgt.json": "053e948b03403ad9adc43a08e7e5c5d83854fffeddf1aae85e3ca82258698575",
        "tokenizer_meta.json": "3e4a3e3131ae95cfd8a84d0de5ca1b00a06752fcebae44b3e641c909166d7d1d",
        "generation_config.json": "6c8b29ae72e680d5a2d9e849567f6f556d3f4e9bbd42434964a646f49b556972",
    }),
}

# Sentence ends: . ! ? and the Devanagari danda, followed by a space or the end.
_SENTENCE_END = re.compile(r"(?<=[.!?।॥])\s+|\n+")


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENTENCE_END.split(text) if s and s.strip()]


class Translator(Protocol):
    name: str

    def supports(self, lang: str) -> bool: ...

    def translate(self, text: str, src: str, tgt: str) -> str: ...

    def warm_up(self, languages: list[str]) -> None: ...


class NoTranslation:
    """Says everything as written."""

    name = "none"

    def supports(self, lang: str) -> bool:
        return lang == "en"

    def translate(self, text: str, src: str, tgt: str) -> str:
        return text

    def warm_up(self, languages: list[str]) -> None:
        pass


def load_indic_processor():
    """IndicTransToolkit's IndicProcessor (MIT), without the rest of the package: its
    ``__init__`` also imports parts that need an older transformers than the server
    uses, and only this module is needed."""
    if "IndicTransToolkit.processor" in sys.modules:
        return sys.modules["IndicTransToolkit.processor"].IndicProcessor
    spec = importlib.util.find_spec("IndicTransToolkit")  # finds it without running __init__
    if spec is None or not spec.submodule_search_locations:
        raise ImportError("IndicTransToolkit is not installed (pip install 'opencall[mt]')", name="IndicTransToolkit")
    folder = Path(next(iter(spec.submodule_search_locations)))
    found = sorted(folder.glob("processor*.so")) + sorted(folder.glob("processor*.pyd")) + sorted(
        folder.glob("processor.py"))
    if not found:
        raise ImportError(f"IndicTransToolkit's processor module isn't in {folder}", name="IndicTransToolkit")
    if "IndicTransToolkit" not in sys.modules:
        package = types.ModuleType("IndicTransToolkit")
        package.__path__ = [str(folder)]
        sys.modules["IndicTransToolkit"] = package
    module_spec = importlib.util.spec_from_file_location("IndicTransToolkit.processor", found[0])
    assert module_spec is not None and module_spec.loader is not None
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    sys.modules["IndicTransToolkit.processor"] = module
    return module.IndicProcessor


class _Direction:
    """One IndicTrans2 model (English to Indian languages, or back), greedy decoding."""

    def __init__(self, folder: Path, threads: int) -> None:
        import onnxruntime as ort
        from tokenizers import Tokenizer

        options = ort.SessionOptions()
        if threads:
            options.intra_op_num_threads = threads
        cpu = ["CPUExecutionProvider"]
        self.encoder = ort.InferenceSession(str(folder / "encoder_model.onnx"), options, providers=cpu)
        self.decoder = ort.InferenceSession(str(folder / "decoder_model.onnx"), options, providers=cpu)
        self.decoder_past = ort.InferenceSession(str(folder / "decoder_with_past_model.onnx"), options, providers=cpu)
        self.cache_names = {session: [o.name for o in session.get_outputs()[1:]]
                            for session in (self.decoder, self.decoder_past)}
        self.src_tok = Tokenizer.from_file(str(folder / "tokenizer_src.json"))
        self.tgt_tok = Tokenizer.from_file(str(folder / "tokenizer_tgt.json"))
        meta = json.loads((folder / "tokenizer_meta.json").read_text(encoding="utf-8"))
        gen = json.loads((folder / "generation_config.json").read_text(encoding="utf-8"))
        self.src_size, self.tgt_size, self.unk = meta["src_dict_size"], meta["tgt_dict_size"], meta["unk_id"]
        self.start, self.eos = int(gen.get("decoder_start_token_id", 2)), int(gen.get("eos_token_id", 2))
        self.processor = load_indic_processor()(inference=True)
        self.lock = threading.Lock()  # the processor keeps per-sentence state between pre and post

    def translate(self, sentence: str, src: str, tgt: str) -> str:
        with self.lock:
            tagged = self.processor.preprocess_batch([sentence], src_lang=src, tgt_lang=tgt)[0]
            try:
                text = self._generate(tagged)
            except BaseException:
                # The processor queued this sentence's placeholders (numbers, links) for
                # the post-processing that won't happen; a fresh one starts clean.
                self.processor = load_indic_processor()(inference=True)
                raise
            return self.processor.postprocess_batch([text], lang=tgt)[0]

    def _generate(self, tagged: str) -> str:
        encoded = self.src_tok.encode(tagged)
        ids = np.array([[i if i < self.src_size else self.unk for i in encoded.ids]], dtype=np.int64)
        mask = np.array([encoded.attention_mask], dtype=np.int64)
        hidden = self.encoder.run(["last_hidden_state"], {"input_ids": ids, "attention_mask": mask})[0]
        out = [self.start]
        past: dict[str, np.ndarray] = {}
        for step in range(min(256, 3 * ids.shape[1] + 10)):
            token = np.array([[out[-1]]], dtype=np.int64)
            if step == 0:
                session, feed = self.decoder, {"encoder_hidden_states": hidden}
            else:
                session, feed = self.decoder_past, past
            result = session.run(None, {"input_ids": token, "encoder_attention_mask": mask, **feed})
            # present.N.* (this step's attention cache) is the next step's past_key_values.N.*
            past = {name.replace("present.", "past_key_values.", 1): value
                    for name, value in zip(self.cache_names[session], result[1:], strict=True)}
            out.append(int(np.argmax(result[0][0, -1, :])))
            if out[-1] == self.eos:
                break
        return self.tgt_tok.decode([i if i < self.tgt_size else self.unk for i in out], skip_special_tokens=True)


class IndicTrans2:
    """English <-> 13 Indian languages, sentence by sentence, with a cache (callers and
    replies repeat themselves a lot: greetings, "one moment", "where should I come")."""

    name = "IndicTrans2"

    def __init__(self, model_dir: Path | None = None, cache_size: int = 4096, threads: int = 0) -> None:
        self.model_dir = model_dir  # None: the Hugging Face cache
        self.threads = threads
        self._directions: dict[str, _Direction] = {}
        self._lock = threading.Lock()
        self._cache: OrderedDict[tuple[str, str, str], str] = OrderedDict()
        self._cache_lock = threading.Lock()
        self.cache_size = cache_size

    def supports(self, lang: str) -> bool:
        return lang in FLORES

    def _direction(self, name: str) -> _Direction:
        with self._lock:
            if name not in self._directions:
                bundle = BUNDLES[name]
                local = self.model_dir / name if self.model_dir else None
                folder = fetch_pinned(bundle.repo, bundle.revision, bundle.files, local)
                self._directions[name] = _Direction(folder, self.threads)
                log.info("Translation %s ready.", name)
            return self._directions[name]

    def warm_up(self, languages: list[str]) -> None:
        for lang in [code for code in languages if code != "en" and code in FLORES]:
            self.translate(self.translate("Hello, how can I help you?", "en", lang), lang, "en")

    def _sentence(self, sentence: str, src: str, tgt: str) -> str:
        key = (sentence, src, tgt)
        with self._cache_lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]
        direction = self._direction("en-indic" if src == "en" else "indic-en")
        out = direction.translate(sentence, FLORES[src], FLORES[tgt]).strip()
        with self._cache_lock:
            self._cache[key] = out
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)
        return out

    def translate(self, text: str, src: str, tgt: str) -> str:
        if src == tgt or not text.strip():
            return text
        for lang in (src, tgt):
            if lang not in FLORES:
                raise ValueError(f"IndicTrans2 can't translate {lang!r}")
        if src != "en" and tgt != "en":
            return self.translate(self.translate(text, src, "en"), "en", tgt)
        return " ".join(self._sentence(s, src, tgt) for s in split_sentences(text))


class TranslationService:
    """What the rest of the server uses. It never fails a call: text it can't
    translate (a language the engine doesn't know, or the engine isn't installed or
    broke) is kept as it is, and the log says why."""

    def __init__(self, engine: Translator) -> None:
        self.engine = engine
        self.failed = False  # the engine couldn't be loaded

    @property
    def name(self) -> str:
        return "none" if self.failed else self.engine.name

    @property
    def available(self) -> bool:
        return not self.failed and self.engine.name != "none"

    def can_translate(self, src: str, tgt: str) -> bool:
        return src == tgt or (self.available and self.engine.supports(src) and self.engine.supports(tgt))

    def _broke(self, error: Exception, text: str) -> str:
        if isinstance(error, (ImportError, OSError, RuntimeError)):  # missing package or model files
            log.warning("Translation with %s isn't available (%s: %s); callers will be answered without it.",
                        self.engine.name, error.__class__.__name__, error)
            self.failed = True
        else:
            log.warning("Couldn't translate %r (%s: %s); keeping it as it is.", text[:80],
                        error.__class__.__name__, error)
        return text

    def warm_up(self, languages: list[str]) -> None:
        if not self.available:
            return
        try:
            self.engine.warm_up(languages)
        except Exception as e:
            self._broke(e, "")

    def translate_sync(self, text: str, src: str, tgt: str) -> str:
        if src == tgt or not text.strip() or not self.can_translate(src, tgt):
            return text
        try:
            return self.engine.translate(text, src, tgt)
        except Exception as e:
            return self._broke(e, text)

    async def translate(self, text: str, src: str, tgt: str) -> str:
        """``text`` in ``tgt`` (as it is if that can't be done)."""
        if src == tgt or not text.strip() or not self.can_translate(src, tgt):
            return text
        return await asyncio.to_thread(self.translate_sync, text, src, tgt)


def build_translator(provider: str, models_dir: Path | None = None) -> TranslationService:
    """indictrans2 | none."""
    if provider == "indictrans2":
        return TranslationService(IndicTrans2(models_dir))
    if provider not in ("none", ""):
        log.warning("Unknown OPENCALL_MT_PROVIDER %r; translation is off.", provider)
    return TranslationService(NoTranslation())

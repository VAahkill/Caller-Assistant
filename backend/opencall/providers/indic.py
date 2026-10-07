"""Voices for Indian languages that Kokoro and XTTS can't speak (Telugu, Tamil,
Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi, Urdu).

Two free engines:

- ``mms`` (default): Meta's MMS voices, one per language. Small (about 150 MB per
  language) and faster than real time on an ordinary CPU. Released for non-commercial
  use (CC BY-NC 4.0), which covers running OpenCall for yourself.
- ``parler``: AI4Bharat's Indic Parler-TTS. Sounds more natural and has named male and
  female speakers, but is a much bigger model that really wants a GPU. Apache-2.0.
  Downloading it needs a free Hugging Face account that has accepted the model's
  terms, with its token in ``HF_TOKEN``.
"""

from __future__ import annotations

import re
import threading

import numpy as np

from ..audio import RATE, float_to_pcm16, resample

# Whisper language code -> (name, MMS model suffix)
INDIC_LANGS = {
    "te": ("Telugu", "tel"),
    "ta": ("Tamil", "tam"),
    "kn": ("Kannada", "kan"),
    "ml": ("Malayalam", "mal"),
    "bn": ("Bengali", "ben"),
    "mr": ("Marathi", "mar"),
    "gu": ("Gujarati", "guj"),
    "pa": ("Punjabi", "pan"),
    "ur": ("Urdu", "urd-script_arabic"),
}

# Speakers AI4Bharat recommends for Indic Parler-TTS, as (name, gender).
PARLER_SPEAKERS = {
    "te": [("Lalitha", "female"), ("Prakash", "male")],
    "ta": [("Jaya", "female")],
    "kn": [("Anu", "female"), ("Suresh", "male")],
    "ml": [("Anjali", "female"), ("Harish", "male")],
    "bn": [("Aditi", "female"), ("Arjun", "male")],
    "mr": [("Sunita", "female"), ("Sanjay", "male")],
    "gu": [("Neha", "female"), ("Yash", "male")],
}

# The voices only know their own script, so digits are spelled out before speaking.
_DIGITS = {
    "te": "సున్నా ఒకటి రెండు మూడు నాలుగు ఐదు ఆరు ఏడు ఎనిమిది తొమ్మిది",
    "ta": "பூஜ்ஜியம் ஒன்று இரண்டு மூன்று நான்கு ஐந்து ஆறு ஏழு எட்டு ஒன்பது",
    "kn": "ಸೊನ್ನೆ ಒಂದು ಎರಡು ಮೂರು ನಾಲ್ಕು ಐದು ಆರು ಏಳು ಎಂಟು ಒಂಬತ್ತು",
    "ml": "പൂജ്യം ഒന്ന് രണ്ട് മൂന്ന് നാല് അഞ്ച് ആറ് ഏഴ് എട്ട് ഒമ്പത്",
    "bn": "শূন্য এক দুই তিন চার পাঁচ ছয় সাত আট নয়",
    "mr": "शून्य एक दोन तीन चार पाच सहा सात आठ नऊ",
    "gu": "શૂન્ય એક બે ત્રણ ચાર પાંચ છ સાત આઠ નવ",
    "pa": "ਸਿਫ਼ਰ ਇੱਕ ਦੋ ਤਿੰਨ ਚਾਰ ਪੰਜ ਛੇ ਸੱਤ ਅੱਠ ਨੌਂ",
    "ur": "صفر ایک دو تین چار پانچ چھ سات آٹھ نو",
}
_RUPEES = {
    "te": "రూపాయలు", "ta": "ரூபாய்", "kn": "ರೂಪಾಯಿ", "ml": "രൂപ", "bn": "টাকা",
    "mr": "रुपये", "gu": "રૂપિયા", "pa": "ਰੁਪਏ", "ur": "روپے",
}
# Languages num2words can say whole numbers in ("three hundred and two").
_NUM2WORDS = {"te", "kn", "bn"}
_NUMBER = re.compile(r"(₹\s?|Rs\.?\s?)?(\d(?:[\d,]*\d)?)")


def _number_words(digits: str, lang: str) -> str:
    if len(digits) <= 4 and not digits.startswith("0") and lang in _NUM2WORDS:
        try:
            from num2words import num2words

            return num2words(int(digits), lang=lang)
        except Exception:
            pass
    # Phone numbers, flat numbers and anything num2words can't say: digit by digit,
    # the way people read them out in India anyway.
    names = _DIGITS[lang].split()
    return " ".join(names[int(d)] for d in digits)


def spell_numbers(text: str, lang: str) -> str:
    if lang not in _DIGITS:
        return text

    def words(m: re.Match) -> str:
        said = _number_words(m.group(2).replace(",", ""), lang)
        if m.group(1):
            said += " " + _RUPEES[lang]
        return f" {said} "

    return re.sub(r"\s{2,}", " ", _NUMBER.sub(words, text)).strip()


class MMSEngine:
    kind = "mms"

    def __init__(self) -> None:
        self._models: dict[str, tuple] = {}
        self._lock = threading.Lock()

    def _load(self, lang: str):
        with self._lock:
            if lang not in self._models:
                from transformers import AutoTokenizer, VitsModel

                name = f"facebook/mms-tts-{INDIC_LANGS[lang][1]}"
                self._models[lang] = (AutoTokenizer.from_pretrained(name), VitsModel.from_pretrained(name).eval())
            return self._models[lang]

    def warm_up(self, lang: str) -> None:
        self._load(lang)

    def synth(self, text: str, lang: str, gender: str = "", speaker: str = "") -> bytes:
        import torch

        tokenizer, model = self._load(lang)
        inputs = tokenizer(spell_numbers(text, lang), return_tensors="pt")
        if inputs.input_ids.shape[-1] == 0:
            return b""
        with torch.no_grad():
            wav = model(**inputs).waveform[0].numpy()
        return resample(float_to_pcm16(wav), model.config.sampling_rate, RATE)


class ParlerEngine:
    kind = "parler"

    def __init__(self, model_name: str = "ai4bharat/indic-parler-tts") -> None:
        self.model_name = model_name
        self._model = None
        self._lock = threading.Lock()

    def _load(self):
        with self._lock:
            if self._model is None:
                import torch
                from parler_tts import ParlerTTSForConditionalGeneration
                from transformers import AutoTokenizer

                device = "cuda:0" if torch.cuda.is_available() else "cpu"
                model = ParlerTTSForConditionalGeneration.from_pretrained(self.model_name).to(device)
                self._model = (
                    model,
                    AutoTokenizer.from_pretrained(self.model_name),
                    AutoTokenizer.from_pretrained(model.config.text_encoder._name_or_path),
                    device,
                )
            return self._model

    def warm_up(self, lang: str) -> None:
        self._load()

    @staticmethod
    def speaker_for(lang: str, gender: str = "", preferred: str = "") -> str:
        speakers = PARLER_SPEAKERS.get(lang, [])
        for name, _ in speakers:
            if name == preferred:
                return name
        for name, g in speakers:
            if g == (gender or "female"):
                return name
        return speakers[0][0] if speakers else ""

    def synth(self, text: str, lang: str, gender: str = "", speaker: str = "") -> bytes:
        import torch

        model, tokenizer, desc_tokenizer, device = self._load()
        name = self.speaker_for(lang, gender, speaker)
        who = f"{name}'s voice is" if name else f"A {gender or 'female'} speaker's voice is"
        description = (
            f"{who} warm and friendly, at a moderate pace, with a very close recording "
            "that has almost no background noise."
        )
        desc = desc_tokenizer(description, return_tensors="pt").to(device)
        prompt = tokenizer(spell_numbers(text, lang), return_tensors="pt").to(device)
        with torch.no_grad():
            out = model.generate(
                input_ids=desc.input_ids,
                attention_mask=desc.attention_mask,
                prompt_input_ids=prompt.input_ids,
                prompt_attention_mask=prompt.attention_mask,
            )
        wav = out.cpu().numpy().squeeze().astype(np.float32)
        return resample(float_to_pcm16(wav), model.config.sampling_rate, RATE)


def make_indic_engine(kind: str, parler_model: str = "ai4bharat/indic-parler-tts"):
    if kind == "mms":
        return MMSEngine()
    if kind == "parler":
        return ParlerEngine(parler_model)
    return None

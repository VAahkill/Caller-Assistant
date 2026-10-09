"""Which language is being spoken or written.

Typed text gets its language from its script. Speech gets it from the language-ID
model, through ``LanguageTracker``, which decides the caller's language once and
keeps it for the call instead of re-guessing every turn.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

# Languages the app offers, by the codes Whisper and the language-ID model use.
LANGUAGE_NAMES = {
    "en": "English", "hi": "Hindi", "te": "Telugu", "ta": "Tamil", "kn": "Kannada", "ml": "Malayalam",
    "bn": "Bengali", "mr": "Marathi", "gu": "Gujarati", "pa": "Punjabi", "ur": "Urdu", "or": "Odia",
    "as": "Assamese",
}

# Unicode block start, end, language. Devanagari is read as Hindi (Marathi uses it too).
_SCRIPTS = [
    (0x0C00, 0x0C7F, "te"),
    (0x0B80, 0x0BFF, "ta"),
    (0x0C80, 0x0CFF, "kn"),
    (0x0D00, 0x0D7F, "ml"),
    (0x0980, 0x09FF, "bn"),
    (0x0A80, 0x0AFF, "gu"),
    (0x0A00, 0x0A7F, "pa"),
    (0x0B00, 0x0B7F, "or"),
    (0x0900, 0x097F, "hi"),
    (0x0600, 0x06FF, "ur"),
]


def script_of(ch: str) -> str | None:
    """The language a character's script belongs to ("en" for Latin letters), or
    None for digits, spaces and punctuation, which belong to any script."""
    code = ord(ch)
    for start, end, lang in _SCRIPTS:
        if start <= code <= end:
            return lang
    if ch.isascii() and ch.isalpha() or 0x00C0 <= code <= 0x024F:
        return "en"
    return None


def guess_language(text: str, default: str = "en") -> str:
    counts: dict[str, int] = {}
    for ch in text:
        lang = script_of(ch)
        if lang and lang != "en":
            counts[lang] = counts.get(lang, 0) + 1
    return max(counts, key=counts.__getitem__) if counts else default


def written_in_latin(lang: str) -> bool:
    """Whether ``lang`` is written in Latin letters (English, and languages without an
    Indian script here)."""
    return lang == "en" or lang not in LANGUAGE_NAMES


def needs_translation(text: str, lang: str) -> bool:
    """Whether English-looking ``text`` should be translated before it is said to a
    caller speaking ``lang``: it has no letters of any Indian script, and ``lang``
    isn't written in Latin letters."""
    return lang != "en" and lang in LANGUAGE_NAMES and not any(
        (script_of(ch) or "en") != "en" for ch in text)


def script_runs(text: str) -> list[tuple[str, str]]:
    """Splits text into (language, piece) runs of one script each. Digits, spaces and
    punctuation stay with the run they are in (or start the text's first run)."""
    runs: list[list[str]] = []
    for ch in text:
        lang = script_of(ch)
        if not runs:
            runs.append([lang or "", ch])
        elif lang is None or lang == runs[-1][0] or not runs[-1][0]:
            if lang and not runs[-1][0]:
                runs[-1][0] = lang
            runs[-1][1] += ch
        else:
            runs.append([lang, ch])
    return [(lang or "en", piece) for lang, piece in runs]


# The language-ID model tells some languages apart more by their words than by how
# they sound: spoken Hindi is often scored as Urdu. Unless both are caller languages,
# a score for one counts for the other.
SOUNDS_ALIKE = {"hi": ("ur",), "ur": ("hi",)}


@dataclass
class Heard:
    """What the tracker made of one utterance."""

    language: str
    confidence: float
    changed: bool  # the call's language is now different (or was decided for the first time)


class LanguageTracker:
    """The language one caller speaks, decided once and then kept for the call.

    Each utterance's language-ID log-probabilities are restricted to the languages
    the user's callers speak (``candidates``, most likely first; that order is a
    small prior). Until the language is settled, the evidence of all the call's
    utterances so far is added up, longer ones counting for more, and the language
    is settled once it is clear. After that one odd-sounding turn changes nothing: the
    language changes only after ``switch_after`` turns in a row that are clearly in the
    same other language. A short "hello" or "haan" is too little to go on and never
    changes a settled language.
    """

    def __init__(self, candidates: list[str], *, prior_step: float = 0.1, settle_at: float = 0.95,
                 settle_seconds: float = 4.0, switch_at: float = 0.9, switch_after: int = 2,
                 min_seconds: float = 1.5, full_weight_seconds: float = 4.0):
        self.candidates = list(dict.fromkeys(c for c in candidates if c)) or ["en"]
        self.prior_step = prior_step
        self.prior = {lang: -prior_step * i for i, lang in enumerate(self.candidates)}
        self.settle_at, self.settle_seconds = settle_at, settle_seconds
        self.switch_at, self.switch_after = switch_at, switch_after
        self.min_seconds, self.full_weight_seconds = min_seconds, full_weight_seconds
        self.language = self.candidates[0]
        self.confidence = 0.0
        self.settled = False
        self.decided = False  # whether anything has been heard or chosen yet
        self._evidence = {lang: 0.0 for lang in self.candidates}
        self._seconds = 0.0
        self._challenger: str | None = None
        self._challenges = 0

    def _scores(self, logprobs: dict[str, float]) -> dict[str, float]:
        scores = {}
        for lang in self.candidates:
            alike = [a for a in SOUNDS_ALIKE.get(lang, ()) if a not in self.candidates]
            parts = [logprobs[x] for x in (lang, *alike) if x in logprobs]
            top = max(parts, default=-1e9)
            scores[lang] = top + math.log(sum(math.exp(x - top) for x in parts)) if parts else -1e9
        return scores

    def restrict(self, logprobs: dict[str, float]) -> dict[str, float]:
        """Probabilities over the candidates only (they sum to 1)."""
        scores = self._scores(logprobs)
        top = max(scores.values())
        exp = {lang: math.exp(s - top) for lang, s in scores.items()}
        total = sum(exp.values())
        return {lang: v / total for lang, v in exp.items()}

    def _posterior(self) -> dict[str, float]:
        return self.restrict({lang: self._evidence[lang] + self.prior[lang] for lang in self.candidates})

    def hear(self, logprobs: dict[str, float], seconds: float) -> Heard:
        """One utterance's language-ID result (log-probabilities by language)."""
        before = self.language, self.decided
        post = self.restrict(logprobs)
        if not self.settled:
            weight = min(1.0, seconds / self.full_weight_seconds)
            for lang, p in post.items():
                self._evidence[lang] += weight * math.log(max(p, 1e-9))
            self._seconds += seconds
            overall = self._posterior()
            self.language = max(overall, key=overall.__getitem__)
            self.confidence = overall[self.language]
            if self.confidence >= self.settle_at and self._seconds >= self.settle_seconds:
                self.settled = True
        elif seconds >= self.min_seconds:
            top = max(post, key=post.__getitem__)
            if top != self.language and post[top] >= self.switch_at:
                self._challenges = self._challenges + 1 if top == self._challenger else 1
                self._challenger = top
                if self._challenges >= self.switch_after:
                    self._switch(top, post[top])
            else:
                self._challenger, self._challenges = None, 0
                if top == self.language:
                    self.confidence = max(self.confidence, post[top])
        self.decided = True
        return Heard(self.language, self.confidence, (self.language, True) != before)

    def choose(self, language: str, confidence: float = 1.0) -> Heard:
        """The language is known for sure (chosen in the app, or the caller typed in
        that script): it is settled at once."""
        before = self.language, self.decided
        if language not in self.candidates:
            self.candidates.append(language)
            self.prior[language] = min(self.prior.values()) - self.prior_step
            self._evidence[language] = 0.0
        self._switch(language, confidence)
        self.decided = True
        return Heard(self.language, self.confidence, (self.language, True) != before)

    def _switch(self, language: str, confidence: float) -> None:
        self.language, self.confidence, self.settled = language, confidence, True
        self._challenger, self._challenges = None, 0

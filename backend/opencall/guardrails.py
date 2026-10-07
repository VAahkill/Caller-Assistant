"""Hard security rules that never depend on the LLM behaving.

Two layers:

1. ``detect_sensitive_request`` looks at what the *caller* said. If they ask for
   an OTP, PIN, password, CVV, card number or account balance, the call engine
   answers with a fixed refusal, never consults the LLM for that turn, and
   alerts the user so they can decide what to do themselves.

2. ``scrub_outgoing`` looks at everything the assistant is about to *say*. Any
   code-like number (4 to 8 digits, or a long card/account number) that is not
   part of the user's own published details (address, landmarks, notes) is
   removed before it reaches text-to-speech, and phrases like "your OTP is"
   are blocked outright. So even a user-typed reply or a confused model cannot
   leak a verification code over the phone.

The pasted draft used one regex that matched any 4 to 6 digit number; that
would also block PIN codes in a postal address ("500034"), so this module
allowlists numbers the user has deliberately published.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

# What a caller might say when fishing for a credential. English, plus common
# Hindi/Hinglish and Devanagari forms since delivery calls in India often use them.
_SENSITIVE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    ("otp", re.compile(r"\b(o\.?\s?t\.?\s?p|one[\s-]?time[\s-]?(pass(word|code)?|code|pin)|verification code|security code|auth(entication)? code|confirmation code)\b", re.I)),
    ("otp", re.compile(r"(ओटीपी|ओ टी पी|कोड बताओ|कोड बताइए|otp bata|code bata|otp bol|code bol)", re.I)),
    ("password", re.compile(r"\b(pass\s?word|passcode|login code|net\s?banking (id|password)|upi pin|m-?pin|atm pin)\b", re.I)),
    ("password", re.compile(r"(पासवर्ड|पिन नंबर)", re.I)),
    ("pin", re.compile(r"\b(pin)\b(?!\s*code)", re.I)),  # "PIN" but not "pin code" (postal)
    ("card", re.compile(r"\b(cvv|cvc|card number|card details|expiry date|debit card|credit card number)\b", re.I)),
    ("balance", re.compile(r"\b((bank|account|card|wallet)\s+balance|how much (money )?(is|do you have) in)\b", re.I)),
    ("account", re.compile(r"\b(account number|ifsc|aadhaa?r( number)?|pan (card )?number|social security)\b", re.I)),
]

REFUSAL_TEXT = {
    "en": "For security reasons I can't share any verification codes, passwords or account details over the phone. I've alerted {user} right away.",
    "hi": "सुरक्षा कारणों से मैं फ़ोन पर कोई OTP, पासवर्ड या खाते की जानकारी नहीं दे सकती। मैंने {user} को तुरंत सूचित कर दिया है।",
}


@dataclass
class SensitiveMatch:
    kind: str
    phrase: str


def detect_sensitive_request(text: str) -> SensitiveMatch | None:
    for kind, pattern in _SENSITIVE_PATTERNS:
        m = pattern.search(text)
        if m:
            return SensitiveMatch(kind=kind, phrase=m.group(0))
    return None


def refusal(language: str, user_name: str) -> str:
    return REFUSAL_TEXT.get(language, REFUSAL_TEXT["en"]).format(user=user_name)


# Numbers that look like codes or financial identifiers.
_CODE_RE = re.compile(r"(?<![\d+])(?:\d[\s-]?){4,19}(?!\d)")
_LEAK_PHRASE_RE = re.compile(
    r"\b(your|the|my)\s+(otp|one[\s-]?time\s+password|verification code|pin|password|cvv)\s+(is|was|=|:)",
    re.I,
)


def _digits(s: str) -> str:
    return re.sub(r"\D", "", s)


def published_numbers(*texts: str) -> set[str]:
    """Digit runs the user has deliberately published (address, notes...)."""
    found: set[str] = set()
    for t in texts:
        for m in _CODE_RE.finditer(t or ""):
            found.add(_digits(m.group(0)))
        for m in re.finditer(r"\d+", t or ""):
            found.add(m.group(0))
    return found


@dataclass
class ScrubResult:
    text: str
    blocked: bool
    reason: str = ""


def scrub_outgoing(text: str, allowed_numbers: set[str]) -> ScrubResult:
    if _LEAK_PHRASE_RE.search(text):
        return ScrubResult(text="", blocked=True, reason="credential phrase")

    blocked = False

    def _replace(m: re.Match[str]) -> str:
        nonlocal blocked
        digits = _digits(m.group(0))
        if digits in allowed_numbers or len(digits) < 4:
            return m.group(0)
        # Times and years read aloud are fine ("at 8:30", "in 2025").
        if re.fullmatch(r"(19|20)\d\d", digits):
            return m.group(0)
        blocked = True
        return "[withheld]"

    cleaned = _CODE_RE.sub(_replace, text)
    if blocked:
        # Don't speak a sentence that had a code cut out of it; it would sound broken
        # and could still hint at the value.
        return ScrubResult(text="", blocked=True, reason="code-like number")
    return ScrubResult(text=cleaned, blocked=False)

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

# What a caller might say when fishing for a credential: English, Hindi (Devanagari and
# romanised), Telugu (script and romanised) and Tamil, since delivery calls in India
# often use them. Indian scripts have no reliable word boundaries in ``re``, so those
# patterns match plain substrings; each one is specific enough not to hit directions
# ("pin code" and Tamil "பின்னால்" = "behind" are not credentials).
_SENSITIVE_PATTERNS: list[tuple[str, re.Pattern[str]]] = [
    # "MOTP": how a phone line often makes speech recognition hear "ka OTP" / "the OTP".
    ("otp", re.compile(r"\b(m?o\.?\s?t\.?\s?p|one[\s-]?time[\s-]?(pass(word|code)?|code|pin)|verification code|security code|auth(entication)? code|confirmation code)\b", re.I)),
    ("otp", re.compile(r"(ओटीपी|ओ टी पी|ओटिपी|ओ\.टी\.पी|मोटीपी|कोड बताओ|कोड बताइए|कोड बता दो|कोड बोलो|कोड भेजो)", re.I)),
    ("otp", re.compile(r"\b(otp|code)\s+(bata|bol|bhej|de\s?do|do\b|dijiye|chepp|pamp|sollu|sollunga|kudunga)", re.I)),
    ("otp", re.compile(r"([ఓఒ]\s?ట[ిీ]\s?ప[ిీ]|ఓ టీ పీ|ఓ టి పి|కోడ్ చెప్ప|కోడ్ పంప|కోడ్ ఇవ్వ)")),
    ("otp", re.compile(r"(ஓடிபி|ஓ டி பி|ஓடீபி|ஓ.டி.பி|கோட் சொல்|கோடு சொல்|கோட் அனுப்ப|கோடு அனுப்ப)")),
    ("password", re.compile(r"\b(pass\s?word|passcode|login code|net\s?banking (id|password)|upi pin|m-?pin|atm pin)\b", re.I)),
    ("password", re.compile(r"(पासवर्ड|पिन नंबर|यूपीआई पिन|एटीएम पिन)", re.I)),
    ("password", re.compile(r"(పాస్‌వర్డ్|పాస్వర్డ్|పాస్ వర్డ్|యూపీఐ పిన్|ఏటీఎం పిన్|పిన్ నంబర్|పిన్ చెప్ప)")),
    ("password", re.compile(r"(பாஸ்வேர்ட்|பாஸ்வேர்டு|கடவுச்சொல்|யுபிஐ பின்|ஏடிஎம் பின்|பின் நம்பர்|பின் எண்)")),
    ("pin", re.compile(r"\b(pin)\b(?!\s*code)", re.I)),  # "PIN" but not "pin code" (postal)
    ("card", re.compile(r"\b(cvv|cvc|card number|card details|expiry date|debit card|credit card number)\b", re.I)),
    ("card", re.compile(r"(सीवीवी|कार्ड नंबर|కార్డ్ నంబర్|కార్డు నంబర్|సీవీవీ|கார்டு நம்பர்|கார்டு எண்|சிவிவி)")),
    ("balance", re.compile(r"\b((bank|account|card|wallet)\s+balance|how much (money )?(is|do you have) in)\b", re.I)),
    ("balance", re.compile(r"\b(balance\s+(kitna|kitni|batao|bataiye|bolo|entha|enta|cheppu|cheppandi|evvalavu|sollunga)|(kitna|entha|enta|evvalavu)\s+balance)\b", re.I)),
    ("balance", re.compile(r"(बैलेंस|बैलेन्स|बैंक में कितना|బ్యాలెన్స్|బ్యాలన్స్|பேலன்ஸ்|வங்கி இருப்பு)")),
    ("account", re.compile(r"\b(account number|ifsc|aadhaa?r( number)?|pan (card )?number|social security|bank (details|account details))\b", re.I)),
    ("account", re.compile(r"(खाता नंबर|अकाउंट नंबर|बैंक डिटेल|बैंक की जानकारी|आधार नंबर|आधार कार्ड नंबर|पैन नंबर|पैन कार्ड)")),
    ("account", re.compile(r"(అకౌంట్ నంబర్|ఖాతా నంబర్|ఖాతా సంఖ్య|బ్యాంక్ వివరాలు|బ్యాంకు వివరాలు|బ్యాంక్ డీటెయిల్స్|ఆధార్ నంబర్|ఆధార్ కార్డ్ నంబర్|పాన్ నంబర్|పాన్ కార్డ్)")),
    ("account", re.compile(r"(அக்கவுண்ட் நம்பர்|கணக்கு எண்|வங்கி விவரங்கள்|பேங்க் டீடெயில்ஸ்|பேங்க் விவரம்|ஆதார் நம்பர்|ஆதார் எண்|பான் நம்பர்|பான் கார்டு)")),
]

REFUSAL_TEXT = {
    "en": "For security reasons I can't share any verification codes, passwords or account details over the phone. I've alerted {user} right away.",
    "hi": "सुरक्षा कारणों से मैं फ़ोन पर कोई OTP, पासवर्ड या खाते की जानकारी नहीं दे सकती। मैंने {user} को तुरंत सूचित कर दिया है।",
    "te": "భద్రతా కారణాల వల్ల నేను ఫోన్‌లో ఓటీపీ, పాస్‌వర్డ్ లేదా ఖాతా వివరాలు ఏవీ చెప్పలేను. {user} గారికి వెంటనే తెలియజేశాను.",
    "ta": "பாதுகாப்பு காரணங்களால் நான் தொலைபேசியில் ஓடிபி, கடவுச்சொல் அல்லது கணக்கு விவரங்கள் எதையும் சொல்ல முடியாது. {user} அவர்களுக்கு உடனே தெரிவித்துவிட்டேன்.",
}


@dataclass
class SensitiveMatch:
    kind: str
    phrase: str


def detect_sensitive_request(text: str, english: str | None = None) -> SensitiveMatch | None:
    """Checks what the caller said, and its English translation when there is one, so
    a request in a language without patterns here is still caught."""
    for candidate in (text, english or ""):
        for kind, pattern in _SENSITIVE_PATTERNS:
            m = pattern.search(candidate)
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

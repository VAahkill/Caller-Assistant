"""Decide whether to answer a call, and what kind of call it is.

``screen_number`` runs before the call is answered (from the Asterisk dialplan
or the Twilio webhook). ``classify_utterance`` runs on the caller's first words
and gives the LLM a strong hint, and lets obvious sales/loan pitches be ended
without spending an LLM turn.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from .models import Contact, Profile


def normalize_number(number: str, home_cc: str = "+91") -> str:
    raw = (number or "").strip()
    if not raw:
        return ""
    plus = raw.startswith("+")
    digits = re.sub(r"\D", "", raw)
    if plus:
        return "+" + digits
    if digits.startswith("00"):
        return "+" + digits[2:]
    cc = home_cc.lstrip("+")
    if digits.startswith("0"):
        digits = digits.lstrip("0")
    if len(digits) > 10 and digits.startswith(cc):
        return "+" + digits
    return f"+{cc}{digits}"


def find_contact(profile: Profile, number: str) -> Contact | None:
    n = normalize_number(number, profile.home_country_code)
    for c in profile.contacts:
        if normalize_number(c.number, profile.home_country_code) == n:
            return c
    return None


@dataclass
class ScreenDecision:
    answer: bool
    reason: str
    contact: Contact | None = None
    category: str = "unknown"


def screen_number(profile: Profile, number: str) -> ScreenDecision:
    if not profile.enabled:
        return ScreenDecision(False, "assistant is switched off")
    contact = find_contact(profile, number)
    if contact and contact.blocked:
        return ScreenDecision(False, "blocked contact", contact, "spam")
    n = normalize_number(number, profile.home_country_code)
    if not n:
        # Withheld numbers are answered (couriers often call from masked lines).
        return ScreenDecision(True, "withheld number", None, "unknown")
    if contact:
        return ScreenDecision(True, "saved contact", contact, "contact")
    for prefix in profile.blocked_prefixes:
        if n.startswith(prefix):
            return ScreenDecision(False, f"blocked prefix {prefix}", None, "spam")
    if profile.block_international and not n.startswith(profile.home_country_code):
        return ScreenDecision(False, "international number", None, "international")
    if not profile.answer_unknown_numbers:
        return ScreenDecision(False, "unknown numbers are not answered")
    return ScreenDecision(True, "unsaved number", None, "unknown")


_SPAM = re.compile(
    r"\b(pre-?approved|personal loan|instant loan|loan offer|home loan|credit card offer|credit limit|"
    r"insurance (plan|policy)|investment (plan|opportunity)|mutual fund|trading tips|stock tips|"
    r"special offer|limited[- ]time offer|cashback offer|you have (won|been selected)|lucky draw|"
    r"lottery|real estate|plot(s)? (for sale|available)|survey|telemarketing|promotional)\b",
    re.I,
)
_DELIVERY = re.compile(
    r"\b(deliver(y|ing)?|parcel|package|courier|order|swiggy|zomato|amazon|flipkart|blinkit|zepto|"
    r"dunzo|bigbasket|myntra|meesho|dtdc|blue ?dart|delhivery|ekart|shadowfax|porter|uber eats|doordash|"
    r"your location|which (floor|building|gate)|address)\b",
    re.I,
)
# Romanised Hindi and Telugu: "kahan aana hai", "ekkadiki raavali", "illu ekkada".
_DELIVERY_ROMAN = re.compile(
    r"\b(kaha+n?\s+(aana|aau|aaun|aaoon|aaoo|aayein|aaye)|ghar\s+kaha+n?|pata\s+(batao|bataiye|bhejo)|"
    r"location\s+(bhejo|bhej\s?do|share|pampandi|pampu|anuppunga)|ekkad(a|i)ki\s+ra+va+li|illu\s+ekkada|"
    r"address\s+(cheppandi|cheppu|batao|bataiye|sollunga))\b",
    re.I,
)
# Devanagari, Telugu and Tamil: brand names, "parcel", "order", "address", "where should I come".
_DELIVERY_INDIC = re.compile(
    r"(डिलीवरी|डिलिवरी|पार्सल|ऑर्डर|आर्डर|पता|लोकेशन|कूरियर|स्विगी|ज़ोमैटो|जोमैटो|अमेज़न|अमेज़ॉन|फ्लिपकार्ट|कहाँ आना|कहां आना|"
    r"డెలివరీ|డెలివెరీ|పార్సెల్|పార్సిల్|ఆర్డర్|కొరియర్|స్విగ్గీ|స్విగ్గి|జొమాటో|జోమాటో|అమెజాన్|ఫ్లిప్‌కార్ట్|ఫ్లిప్కార్ట్|"
    r"లొకేషన్|లోకేషన్|అడ్రస్|చిరునామా|ఇల్లు ఎక్కడ|ఇంటి అడ్రస్|ఎక్కడికి రావాలి|ఎక్కడికి రమ్మంటారు|"
    r"டெலிவரி|பார்சல்|ஆர்டர்|கூரியர்|ஸ்விக்கி|சொமேட்டோ|ஜொமேட்டோ|ஸொமேட்டோ|அமேசான்|ஃபிளிப்கார்ட்|பிளிப்கார்ட்|"
    r"லொகேஷன்|லோகேஷன்|அட்ரஸ்|முகவரி|வீடு எங்கே|வீடு எங்க|எங்கே வர|எங்க வர)"
)


def classify_utterance(text: str, english: str | None = None) -> str:
    """A quick hint from the caller's words (and their English translation, when there
    is one): "spam", "delivery" or "unknown"."""
    candidates = [text, english or ""]
    if any(_SPAM.search(c) for c in candidates):
        return "spam"
    for c in candidates:
        if _DELIVERY.search(c) or _DELIVERY_ROMAN.search(c) or _DELIVERY_INDIC.search(c):
            return "delivery"
    return "unknown"

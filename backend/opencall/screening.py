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
    r"your location|which (floor|building|gate)|address)\b|(डिलीवरी|पार्सल|ऑर्डर|पता|लोकेशन)",
    re.I,
)


def classify_utterance(text: str) -> str:
    if _SPAM.search(text):
        return "spam"
    if _DELIVERY.search(text):
        return "delivery"
    return "unknown"

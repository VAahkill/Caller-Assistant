"""Fixed lines the assistant says without asking the LLM, in the languages callers
use most. Anything else falls back to English."""

from __future__ import annotations

PHRASES: dict[str, dict[str, str]] = {
    # Spoken when a turn fails (LLM down or too slow, a crash): never leave silence.
    "fallback": {
        "en": "Sorry, something went wrong on my side. Could you please say that again?",
        "hi": "माफ़ कीजिए, मेरी तरफ़ से कुछ गड़बड़ हो गई। क्या आप फिर से बता सकते हैं?",
        "te": "క్షమించండి, నా వైపు ఏదో సమస్య వచ్చింది. దయచేసి మళ్ళీ చెప్పగలరా?",
        "ta": "மன்னிக்கவும், என் பக்கத்தில் ஏதோ பிரச்சனை. தயவுசெய்து மீண்டும் சொல்ல முடியுமா?",
    },
    # Spoken while the LLM is still thinking, so the caller knows someone is there.
    "filler": {
        "en": "One moment, please.",
        "hi": "एक पल रुकिए।",
        "te": "ఒక్క క్షణం ఆగండి.",
        "ta": "ஒரு நிமிடம் காத்திருங்கள்.",
    },
    "filler_again": {
        "en": "Sorry for the wait, just a moment more.",
        "hi": "इंतज़ार के लिए माफ़ कीजिए, बस एक पल और।",
        "te": "వేచి ఉన్నందుకు క్షమించండి, ఇంకొక్క క్షణం.",
        "ta": "காத்திருப்பதற்கு மன்னிக்கவும், இன்னும் ஒரு நிமிடம்.",
    },
    "hold_reminder": {
        "en": "Still checking, thanks for waiting.",
        "hi": "अभी पता कर रही हूँ, रुकने के लिए धन्यवाद।",
        "te": "ఇంకా కనుక్కుంటున్నాను, వేచి ఉన్నందుకు ధన్యవాదాలు.",
        "ta": "இன்னும் கேட்டுக்கொண்டிருக்கிறேன், காத்திருப்பதற்கு நன்றி.",
    },
}


def phrase(key: str, language: str) -> str:
    table = PHRASES[key]
    return table.get(language) or table["en"]

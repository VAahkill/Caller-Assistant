"""Fixed lines the assistant says without asking the LLM: written by hand in the
languages callers use most, and translated from the English (once, then cached) for
the rest. ``{user}``, ``{User}`` (capitalised, to start a sentence) and
``{assistant}`` are filled in from the profile."""

from __future__ import annotations

from .guardrails import REFUSAL_TEXT

PHRASES: dict[str, dict[str, str]] = {
    # The greeting, in three parts so an away status can go in the middle.
    "greeting_intro": {
        "en": "Hi, this is {assistant}, {user}'s assistant.",
        "hi": "नमस्ते, मैं {assistant} हूँ, {user} की असिस्टेंट।",
        "te": "నమస్కారం, నేను {assistant}, {user} గారి అసిస్టెంట్‌ని.",
        "ta": "வணக்கம், நான் {assistant}, {user} அவர்களின் உதவியாளர்.",
    },
    "greeting_busy": {
        "en": "{User} can't take the call right now.",
        "hi": "{user} अभी फ़ोन नहीं उठा सकते।",
        "te": "{user} గారు ఇప్పుడు ఫోన్ తీయలేరు.",
        "ta": "{user} இப்போது அழைப்பை எடுக்க முடியாது.",
    },
    "greeting_help": {
        "en": "How can I help?",
        "hi": "मैं आपकी क्या मदद कर सकती हूँ?",
        "te": "నేను మీకు ఎలా సహాయం చేయగలను?",
        "ta": "நான் உங்களுக்கு எப்படி உதவலாம்?",
    },
    # Said instead of asking the LLM when a caller asks for a code or bank details.
    "refusal": REFUSAL_TEXT,
    # Obvious sales and loan pitches are declined without an LLM turn.
    "spam_decline": {
        "en": "Thanks, but we're not interested. Please remove this number from your list. Bye!",
        "hi": "धन्यवाद, लेकिन हमें इसमें दिलचस्पी नहीं है। कृपया यह नंबर अपनी लिस्ट से हटा दीजिए। नमस्ते!",
        "te": "ధన్యవాదాలు, కానీ మాకు ఆసక్తి లేదు. దయచేసి ఈ నంబర్‌ను మీ లిస్ట్ నుండి తీసేయండి. నమస్కారం!",
        "ta": "நன்றி, ஆனால் எங்களுக்கு விருப்பம் இல்லை. தயவுசெய்து இந்த எண்ணை உங்கள் பட்டியலிலிருந்து நீக்குங்கள். வணக்கம்!",
    },
    # The call has gone on too long (OPENCALL_MAX_CALL_MINUTES).
    "wrap_up": {
        "en": "I'm sorry, I have to wrap up now. I'll pass everything on. Goodbye!",
        "hi": "माफ़ कीजिए, अब मुझे कॉल ख़त्म करनी होगी। मैं सब कुछ बता दूँगी। नमस्ते!",
        "te": "క్షమించండి, ఇప్పుడు నేను కాల్ ముగించాలి. అన్ని విషయాలు తెలియజేస్తాను. నమస్కారం!",
        "ta": "மன்னிக்கவும், இப்போது நான் அழைப்பை முடிக்க வேண்டும். எல்லாவற்றையும் தெரிவிக்கிறேன். வணக்கம்!",
    },
    # The user ended the call from the app.
    "goodbye": {
        "en": "I have to go now. I'll let {user} know. Bye!",
        "hi": "अब मुझे जाना होगा। मैं {user} को बता दूँगी। नमस्ते!",
        "te": "ఇప్పుడు నేను వెళ్ళాలి. {user} గారికి చెబుతాను. నమస్కారం!",
        "ta": "இப்போது நான் போக வேண்டும். {user} அவர்களிடம் சொல்கிறேன். வணக்கம்!",
    },
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
    """The line as written for ``language`` (unfilled), or the English one."""
    table = PHRASES[key]
    return table.get(language) or table["en"]


def has_phrase(key: str, language: str) -> bool:
    return language in PHRASES[key]


def fill(template: str, user: str = "", assistant: str = "") -> str:
    return template.format(user=user, User=user[:1].upper() + user[1:], assistant=assistant)

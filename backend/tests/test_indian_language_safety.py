"""Delivery calls and credential requests in Telugu, Tamil and Hindi, in their own
scripts and typed in English letters, as callers in Hyderabad actually say them."""

import pytest

from opencall.guardrails import REFUSAL_TEXT, detect_sensitive_request, refusal
from opencall.screening import classify_utterance


@pytest.mark.parametrize(
    "text",
    [
        "నాకు స్విగ్గీ ఆర్డర్ ఉంది, ఎక్కడికి రావాలి?",  # the owner's own practice line
        "నమస్కారం, మీ పార్సెల్ వచ్చింది. మీ ఇల్లు ఎక్కడ?",  # the app's Telugu starter
        "సార్, డెలివరీ కోసం వచ్చాను, మీ అడ్రస్ చెప్పండి",
        "வணக்கம், உங்கள் பார்சல் வந்திருக்கு. உங்கள் வீடு எங்கே?",  # the app's Tamil starter
        "ஸ்விக்கி டெலிவரி, எங்கே வர வேண்டும்?",
        "स्विगी से ऑर्डर है, कहाँ आना है?",
        "भैया पार्सल आया है",
        "bhaiya kahan aana hai, gate pe khada hoon",
        "nenu gate daggara unnanu, ekkadiki raavali?",
        "Hello, I have your Swiggy order, which gate?",
    ],
)
def test_delivery_calls_are_recognised_in_every_language(text):
    assert classify_utterance(text) == "delivery"


@pytest.mark.parametrize(
    "text",
    ["రాహుల్ ఉన్నారా?", "ராகுல் இருக்காரா?", "क्या राहुल घर पर हैं?", "Hi, is Rahul there?"],
)
def test_ordinary_calls_stay_unknown(text):
    assert classify_utterance(text) == "unknown"


def test_the_english_translation_is_checked_too():
    # A language with no patterns here (Kannada) is caught through its English pivot.
    assert classify_utterance("ನಮಸ್ಕಾರ, ನಿಮ್ಮ ಪಾರ್ಸಲ್ ಬಂದಿದೆ", english="Hello, your parcel has arrived") == "delivery"
    assert classify_utterance("ನಮಸ್ಕಾರ", english="Sir, you have a pre-approved personal loan") == "spam"
    match = detect_sensitive_request("ಒಟಿಪಿ ಹೇಳಿ", english="Tell me the OTP")
    assert match is not None and match.kind == "otp"


@pytest.mark.parametrize(
    "text,kind",
    [
        ("OTP చెప్పండి", "otp"),
        ("సార్, డెలివరీ కోసం ఓటీపీ చెప్పండి.", "otp"),
        ("మీ ఫోన్‌కి వచ్చిన కోడ్ చెప్పండి", "otp"),
        ("ఏటీఎం పిన్ ఎంత?", "password"),
        ("మీ బ్యాంక్ వివరాలు చెప్పండి", "account"),
        ("మీ అకౌంట్ నంబర్ చెప్పండి", "account"),
        ("బ్యాలెన్స్ ఎంత ఉంది?", "balance"),
        ("ஓடிபி சொல்லுங்க", "otp"),
        ("உங்க பாஸ்வேர்ட் என்ன?", "password"),
        ("உங்கள் கணக்கு எண் சொல்லுங்கள்", "account"),
        ("ஆதார் நம்பர் சொல்லுங்க", "account"),
        ("कोड बता दो भैया", "otp"),
        ("आपका अकाउंट नंबर क्या है?", "account"),
        ("बैलेंस कितना है?", "balance"),
        ("bhaiya otp bhej do", "otp"),
        ("code cheppandi sir", "otp"),
        ("balance kitna hai", "balance"),
        ("send me your bank details", "account"),
        # How speech recognition writes "OTP" through a noisy phone line.
        ("ఈ డెలివరీకి ఓటిపీ చెప్పండి", "otp"),
        ("ఓటీపీని చెప్పండి", "otp"),
        ("ఓ టి పి చెప్పండి", "otp"),
        ("सर इस डिलीवरी का MOTP बता दीजिए.", "otp"),
        ("सर इस डिलीवरी का मोटीपी बता दीजिए.", "otp"),
        ("Sir, tell me the MOTP of this delivery.", "otp"),
    ],
)
def test_credential_requests_are_caught_in_every_language(text, kind):
    m = detect_sensitive_request(text)
    assert m is not None and m.kind == kind


@pytest.mark.parametrize(
    "text",
    [
        "మీ పిన్ కోడ్ ఏమిటి?",  # postal PIN code
        "கோவிலுக்கு பின்னால் வாங்க",  # "come behind the temple"
        "पिन कोड क्या है?",
        "ఓటు వేయండి",  # "vote"
        "మోటార్ బైక్ మీద వచ్చాను",
        "remote control",
        "నేను గేట్ దగ్గర ఉన్నాను",
        "நான் கேட் கிட்ட இருக்கேன்",
    ],
)
def test_directions_are_not_mistaken_for_credential_requests(text):
    assert detect_sensitive_request(text) is None


def test_refusal_is_in_the_callers_language():
    assert refusal("te", "Rahul").startswith("భద్రతా కారణాల")
    assert refusal("ta", "Rahul").startswith("பாதுகாப்பு")
    assert "Rahul" in refusal("hi", "Rahul")
    assert refusal("kn", "Rahul") == REFUSAL_TEXT["en"].format(user="Rahul")

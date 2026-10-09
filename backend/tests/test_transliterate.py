"""Saying English words in an Indian script, and the Piper voices' input: Latin words
become the caller's script (acronyms letter by letter) before an Indian voice reads
them, and Piper gets espeak-ng phonemes clause by clause."""

import shutil

import pytest

from opencall.providers import piper as piper_mod
from opencall.providers.piper import phoneme_ids, phonemize
from opencall.transliterate import ipa_to_devanagari, latin_to_script, spell_letters, word_in_script

needs_espeak = pytest.mark.skipif(not shutil.which("espeak-ng"), reason="espeak-ng is not installed")


# ----------------------------------------------------------------- transliteration
def test_acronyms_are_said_letter_by_letter():
    assert spell_letters("OTP") == "ओटीपी"
    assert word_in_script("UPI", "te") == "యూపీఆఈ"
    assert word_in_script("OTP", "ta") == "ஓடீபீ"


@pytest.mark.parametrize("ipa, devanagari", [
    ("swˈɪɡi", "स्विगी"),
    ("ˈɔːɹdɚ", "आर्डर्"),  # order
    ("dᵻlˈɪvɚɹi", "डिलिवरी"),  # delivery: one r
    ("kˈɪŋ", "किंग्"),
    ("bˈæŋk", "बैंक्"),
])
def test_english_sounds_in_devanagari(ipa, devanagari):
    assert ipa_to_devanagari(ipa) == devanagari


def test_dravidian_scripts_write_the_a_of_bank_as_ya():
    assert ipa_to_devanagari("bˈæŋk", dravidian=True) == "ब्यांक्"


def test_text_without_latin_letters_or_for_other_languages_is_unchanged():
    assert latin_to_script("మీ ఆర్డర్ 25", "te") == "మీ ఆర్డర్ 25"
    assert latin_to_script("Hello", "en") == "Hello"
    assert latin_to_script("Hello", "fr") == "Hello"


@needs_espeak
def test_brand_names_through_espeak():
    assert latin_to_script("Swiggy", "te") == "స్విగీ"
    assert latin_to_script("Rahul", "ta") == "ராஹுல்"
    assert latin_to_script("Zomato", "hi") == "जमाटो"


# ----------------------------------------------------------------- Piper
def test_piper_input_ids_have_start_pads_and_end():
    id_map = {"^": [1], "_": [0], "$": [2], "a": [14], "b": [15], " ": [3]}
    assert phoneme_ids("ab a", id_map) == [1, 0, 14, 0, 15, 0, 3, 0, 14, 0, 2]
    assert phoneme_ids("aX", id_map) == [1, 0, 14, 0, 2]  # unknown phonemes are left out


@needs_espeak
def test_piper_phonemes_keep_each_clause_and_its_punctuation():
    out = phonemize("నమస్కారం, మీ ఆర్డర్ వచ్చింది. దయచేసి రండి!", "te")
    assert len(out) == 2
    assert out[0].endswith(".") and ", " in out[0] and out[1].endswith("!")
    assert not any("(" in s for s in out)
    assert phonemize("...", "te") == []


def test_piper_without_espeak_is_a_clear_error(monkeypatch):
    monkeypatch.setattr(piper_mod.shutil, "which", lambda name: None)
    with pytest.raises(RuntimeError, match="espeak-ng"):
        phonemize("నమస్కారం", "te")

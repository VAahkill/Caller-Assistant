"""The end-to-end check's own judgements (eval/scenarios.py, eval/phone.py): what
counts as speech read back, letters spelled out, the caller's script."""

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "eval"))

import phone  # noqa: E402
import scenarios  # noqa: E402


def test_speech_that_reads_back_as_the_same_words_passes():
    assert scenarios.read_back("Go to the green gate.", "go to the green gate") == 1.0
    assert not scenarios.spelled_out("Go to the green gate, near the temple.", "Go to the green gate near the temple",
                                     2.0)


def test_a_word_spelled_letter_by_letter_fails_but_abbreviations_may_be_spelled():
    assert scenarios.spelled_out("Hello there, my friend.", "H E L L O there my friend", 3.0)
    assert not scenarios.spelled_out("It's next to the SBI ATM.", "It's next to the S B I A T M", 2.5)
    assert not scenarios.spelled_out("It's next to the SBI ATM.", "it's next to the SBI ATM", 2.5)


def test_indian_script_spelled_as_letter_names_fails_the_read_back():
    said = "అపోలో ఫార్మసీ ఎదురుగా"
    assert scenarios.spelled_out(said, "ఎ పి ఓ ఎల్ ఓ ఎఫ్ ఏ ఆర్", 6.0)
    assert not scenarios.spelled_out(said, "అపోలో ఫార్మసీ ఎదురుగా", 1.8)


def test_a_short_line_is_judged_by_its_length():
    assert not scenarios.spelled_out("Okay.", "ok", 0.6)
    assert scenarios.spelled_out("Okay.", "o k a y", 3.0)


def test_the_callers_script_share():
    assert scenarios.script_share("సరే, 402 నంబర్ ఫ్లాట్.", "te") == 1.0
    assert scenarios.script_share("Okay, flat 402.", "te") == 0.0
    assert scenarios.script_share("402", "ta") == 1.0  # nothing to judge


def test_the_phone_line_brings_speech_to_a_phones_level():
    rng = np.random.default_rng(0)
    quiet = (rng.standard_normal(16000) * 20).astype(np.int16).tobytes()  # about -64 dBFS
    x = np.frombuffer(phone.at_phone_level(quiet), dtype=np.int16).astype(np.float64)
    assert abs(20 * np.log10(phone.speech_level(x) / 32768) - phone.PHONE_LEVEL_DBFS) < 0.5
    assert phone.at_phone_level(b"\x00\x00" * 100) == b"\x00\x00" * 100  # silence stays silence


def test_the_suite_has_at_least_40_calls_in_every_language():
    calls = scenarios.scenarios()
    assert len(calls) >= 40 and len({c["id"] for c in calls}) == len(calls)
    for lang in ("en", "hi", "te", "ta"):
        assert sum(c["lang"] == lang for c in calls) >= 10

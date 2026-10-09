"""English words in an Indian-language sentence, written in that language's script.

The Telugu and Tamil voices (MMS, Piper) only read their own script: "మీ Swiggy
ఆర్డర్" would come out as "మీ ... ఆర్డర్". Callers mix in brand names and
acronyms all the time, so before such a voice speaks, each Latin-letter word is
rewritten the way an Indian speaker says it: acronyms letter by letter ("OTP" ->
ఓటీపీ), other words from their English pronunciation (espeak-ng, the same program
the voices already use) mapped to the target script ("Swiggy" -> స్విగీ).
"""

from __future__ import annotations

import functools
import logging
import re
import shutil
import subprocess

log = logging.getLogger("opencall.transliterate")

# Unicode block of each script that is laid out like Devanagari (same offsets).
_BRAHMIC = {"hi": 0x0900, "mr": 0x0900, "ne": 0x0900, "bn": 0x0980, "as": 0x0980, "pa": 0x0A00, "gu": 0x0A80,
            "or": 0x0B00, "te": 0x0C00, "kn": 0x0C80, "ml": 0x0D00}
SUPPORTED = set(_BRAHMIC) | {"ta"}

# How Indians name the English letters, in Devanagari.
_LETTERS = {
    "A": "ए", "B": "बी", "C": "सी", "D": "डी", "E": "ई", "F": "एफ", "G": "जी", "H": "एच", "I": "आई",
    "J": "जे", "K": "के", "L": "एल", "M": "एम", "N": "एन", "O": "ओ", "P": "पी", "Q": "क्यू", "R": "आर",
    "S": "एस", "T": "टी", "U": "यू", "V": "वी", "W": "डब्ल्यू", "X": "एक्स", "Y": "वाई", "Z": "जेड",
}

# English sounds (espeak-ng's American English IPA) -> Devanagari. Vowels are
# (independent letter, sign after a consonant); "" is the inherent a.
_VOWELS = {
    "aɪ": ("ऐ", "ै"), "aʊ": ("औ", "ौ"), "eɪ": ("ए", "े"), "oʊ": ("ओ", "ो"), "əʊ": ("ओ", "ो"), "ɔɪ": ("ओ", "ो"),
    "ɑː": ("आ", "ा"), "ɔː": ("आ", "ा"), "iː": ("ई", "ी"), "uː": ("ऊ", "ू"), "ɜː": ("अ", ""), "ɑ": ("आ", "ा"),
    "ɒ": ("आ", "ा"), "ɔ": ("ओ", "ो"), "æ": ("ऐ", "ै"), "ɛ": ("ए", "े"), "e": ("ए", "े"), "ɪ": ("इ", "ि"),
    "i": ("ई", "ी"), "ᵻ": ("इ", "ि"), "ʊ": ("उ", "ु"), "u": ("ऊ", "ू"), "ə": ("अ", ""), "ɐ": ("अ", ""),
    "ʌ": ("अ", ""), "a": ("अ", ""), "o": ("ओ", "ो"), "ɚ": ("अ", ""), "ɝ": ("अ", ""),
}
_R_COLOURED = {"ɚ", "ɝ", "ɜː"}  # vowel + r
_CONSONANTS = {
    "tʃ": "च", "dʒ": "ज", "p": "प", "b": "ब", "t": "ट", "d": "ड", "ɾ": "ट", "k": "क", "ɡ": "ग", "g": "ग",
    "f": "फ", "v": "व", "θ": "थ", "ð": "द", "s": "स", "z": "ज", "ʃ": "श", "ʒ": "ज", "h": "ह", "m": "म",
    "n": "न", "ŋ": "ङ", "l": "ल", "ɫ": "ल", "ɹ": "र", "r": "र", "j": "य", "w": "व", "x": "ख",
}
_TOKENS = sorted([*_VOWELS, *_CONSONANTS], key=len, reverse=True)
_VIRAMA = "्"
_SKIP = set("ˈˌ.‿ʔ-ː ")

# Devanagari -> Tamil, which has no separate letters for voiced or aspirated sounds.
_TAMIL = {
    "क": "க", "ख": "க", "ग": "க", "घ": "க", "ङ": "ங", "च": "ச", "छ": "ச", "ज": "ஜ", "झ": "ஜ", "ट": "ட",
    "ठ": "ட", "ड": "ட", "ढ": "ட", "ण": "ண", "त": "த", "थ": "த", "द": "த", "ध": "த", "न": "ன", "प": "ப",
    "फ": "ப", "ब": "ப", "भ": "ப", "म": "ம", "य": "ய", "र": "ர", "ल": "ல", "व": "வ", "श": "ஷ", "स": "ஸ",
    "ह": "ஹ", "अ": "அ", "आ": "ஆ", "इ": "இ", "ई": "ஈ", "उ": "உ", "ऊ": "ஊ", "ए": "ஏ", "ऐ": "ஐ", "ओ": "ஓ",
    "औ": "ஔ", "ा": "ா", "ि": "ி", "ी": "ீ", "ु": "ு", "ू": "ூ", "े": "ே", "ै": "ை", "ो": "ோ", "ौ": "ௌ",
    "्": "்", "ं": "ம்",
}

_LATIN_WORD = re.compile(r"[A-Za-z][A-Za-z'’]*")
_warned: list[bool] = []


def ipa_to_devanagari(ipa: str, dravidian: bool = False) -> str:
    """One word's English pronunciation, written in Devanagari. ``dravidian``: for
    Telugu, Tamil, Kannada and Malayalam, which write the "a" of "bank" as "yaa"
    (బ్యాంక్) where Hindi uses its own vowel (बैंक)."""
    out: list[str] = []
    consonants: list[str] = []

    def flush(final: bool) -> None:
        if consonants:
            out.append(_VIRAMA.join(consonants) + (_VIRAMA if final else ""))
            consonants.clear()

    i, after_r = 0, False
    while i < len(ipa):
        if ipa[i] in _SKIP:
            i += 1
            continue
        token = next((t for t in _TOKENS if ipa.startswith(t, i)), None)
        i += len(token) if token else 1
        if token is None:
            continue  # a sound with no Indian letter; leave it out
        if token in ("ɹ", "r") and after_r:
            after_r = False  # "delivery": the r of the vowel and the r after it are one r
            continue
        after_r = False
        if token == "æ" and dravidian:
            consonants.append("य")
            token = "ɑː"
        if token in _VOWELS:
            letter, sign = _VOWELS[token]
            if consonants:
                out.append(_VIRAMA.join(consonants) + sign)
                consonants.clear()
            else:
                out.append(letter)
            if token in _R_COLOURED:
                consonants.append("र")
                after_r = True
        elif token == "ŋ":  # "king": a nasal on the vowel, then a g (but "bank" has its k)
            flush(final=False)
            out.append("ं")
            if not any(ipa.startswith(k, i) for k in ("k", "ɡ", "g")):
                consonants.append("ग")
        else:
            consonants.append(_CONSONANTS[token])
    flush(final=True)
    return "".join(out)


def from_devanagari(text: str, lang: str) -> str:
    """Devanagari letters rewritten in ``lang``'s script."""
    if lang == "ta":
        text = re.sub("ं(?=[कखगघ])", "ङ्", text)  # Tamil writes the nasal of "king" as ங்
        tamil = "".join(_TAMIL.get(ch, ch) for ch in text)
        return re.sub(r"(?<![\u0B80-\u0BFF])ன", "ந", tamil)  # n starting a word is ந
    base = _BRAHMIC[lang]
    if base == 0x0900:
        return text
    return "".join(chr(base + ord(ch) - 0x0900) if 0x0900 <= ord(ch) <= 0x097F else ch for ch in text)


def spell_letters(word: str) -> str:
    return "".join(_LETTERS.get(ch, "") for ch in word.upper())


@functools.lru_cache(maxsize=4096)
def _pronounce(word: str) -> str:
    """espeak-ng's English pronunciation of one word, or "" without espeak-ng."""
    exe = shutil.which("espeak-ng")
    if exe is None:
        if not _warned:
            log.warning("espeak-ng isn't installed, so English words in Indian-language replies are skipped "
                        "by the voice (apt install espeak-ng).")
            _warned.append(True)
        return ""
    done = subprocess.run([exe, "-q", "--ipa", "-v", "en-us"], input=word, capture_output=True, text=True,
                          timeout=10, check=True)
    return re.sub(r"\([a-z-]+\)", "", done.stdout).strip()


def word_in_script(word: str, lang: str) -> str:
    """One English word as an Indian speaker of ``lang`` would write it."""
    letters = word.replace("'", "").replace("’", "")
    if len(letters) >= 2 and letters.isupper():
        devanagari = spell_letters(letters)  # OTP, UPI, ATM
    else:
        dravidian = lang in ("te", "ta", "kn", "ml")
        devanagari = "".join(ipa_to_devanagari(part, dravidian) for part in _pronounce(letters).split())
    return from_devanagari(devanagari, lang)


def latin_to_script(text: str, lang: str) -> str:
    """``text`` with each Latin-letter word written in ``lang``'s script (unchanged if
    ``lang`` isn't an Indian language this knows)."""
    if lang not in SUPPORTED:
        return text
    return _LATIN_WORD.sub(lambda m: word_in_script(m.group(0), lang) or m.group(0), text)

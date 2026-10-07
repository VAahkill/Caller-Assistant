"""Tell which language typed text is in from its script (speech gets its
language from Whisper instead)."""

from __future__ import annotations

# Unicode block start, end, language. Devanagari is read as Hindi (Marathi uses it too).
_SCRIPTS = [
    (0x0C00, 0x0C7F, "te"),
    (0x0B80, 0x0BFF, "ta"),
    (0x0C80, 0x0CFF, "kn"),
    (0x0D00, 0x0D7F, "ml"),
    (0x0980, 0x09FF, "bn"),
    (0x0A80, 0x0AFF, "gu"),
    (0x0A00, 0x0A7F, "pa"),
    (0x0900, 0x097F, "hi"),
    (0x0600, 0x06FF, "ur"),
]


def guess_language(text: str, default: str = "en") -> str:
    counts: dict[str, int] = {}
    for ch in text:
        code = ord(ch)
        for start, end, lang in _SCRIPTS:
            if start <= code <= end:
                counts[lang] = counts.get(lang, 0) + 1
                break
    return max(counts, key=counts.__getitem__) if counts else default

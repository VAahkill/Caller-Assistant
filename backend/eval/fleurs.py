"""Real held-out speech for the quality checks: Google FLEURS (CC-BY-4.0, no account).

Only the FLEURS *test* split is used. The Indian-language Whisper fine-tunes were
trained on FLEURS train and validation, so scoring them on those would flatter them.
The test split is a 300 MB parquet file per language; this reads it over HTTP range
requests, so only the index and the columns needed are downloaded. (The audio itself
is one 300 MB block of the file, so that part is always fetched whole; only the
clips are kept.)

    python eval/fleurs.py te_in 30 ~/fleurs   # 30 Telugu clips -> ~/fleurs/te_in/
"""

from __future__ import annotations

import io
import json
import sys
import unicodedata
from pathlib import Path

URL = "https://huggingface.co/api/datasets/google/fleurs/parquet/{config}/{split}/0.parquet"


class HTTPRangeFile(io.RawIOBase):
    """A read-only, seekable file over HTTP range requests. Small reads go through
    a few cached blocks; big ones are one request each."""

    def __init__(self, url: str, block: int = 1 << 20):
        import httpx

        self._client = httpx.Client(follow_redirects=True, timeout=120)
        head = self._client.head(url)
        head.raise_for_status()
        self.url = str(head.url)
        self.size = int(head.headers["content-length"])
        self.block = block
        self.pos = 0
        self._cache: dict[int, bytes] = {}
        self.fetched = 0

    def readable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return True

    def tell(self) -> int:
        return self.pos

    def seek(self, offset: int, whence: int = io.SEEK_SET) -> int:
        base = {io.SEEK_SET: 0, io.SEEK_CUR: self.pos, io.SEEK_END: self.size}[whence]
        self.pos = max(0, base + offset)
        return self.pos

    def _get(self, index: int) -> bytes:
        if index not in self._cache:
            start = index * self.block
            end = min(self.size, start + self.block) - 1
            r = self._client.get(self.url, headers={"Range": f"bytes={start}-{end}"})
            r.raise_for_status()
            if r.status_code != 206:
                raise RuntimeError("The server ignored the range request.")
            if len(self._cache) >= 8:
                self._cache.pop(next(iter(self._cache)))
            self._cache[index] = r.content
            self.fetched += len(r.content)
        return self._cache[index]

    def readinto(self, buf) -> int:
        if self.pos >= self.size:
            return 0
        n = min(len(buf), self.size - self.pos)
        out, got = memoryview(buf), 0
        if n > 4 * self.block:
            with self._client.stream("GET", self.url, headers={"Range": f"bytes={self.pos}-{self.pos + n - 1}"}) as r:
                r.raise_for_status()
                for chunk in r.iter_bytes():
                    out[got : got + len(chunk)] = chunk
                    got += len(chunk)
            if got != n:
                raise RuntimeError(f"Expected {n} bytes, got {got}.")
            self.fetched += got
            self.pos += got
            return got
        while got < n:
            index, offset = divmod(self.pos + got, self.block)
            chunk = self._get(index)[offset : offset + n - got]
            out[got : got + len(chunk)] = chunk
            got += len(chunk)
        self.pos += got
        return got


def fetch(config: str, n: int, out_dir: Path, split: str = "test", max_seconds: float = 14.0) -> list[dict]:
    """Writes up to ``n`` clips (16 kHz WAV, one per distinct sentence, at most
    ``max_seconds`` long) and ``meta.json`` to ``out_dir/config``. Already-fetched
    clips are reused."""
    import numpy as np
    import pyarrow.parquet as pq
    import soundfile as sf

    folder = out_dir / config
    meta_path = folder / "meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        if len(meta) >= n:
            return meta[:n]
    folder.mkdir(parents=True, exist_ok=True)
    remote = HTTPRangeFile(URL.format(config=config, split=split))
    parquet = pq.ParquetFile(remote)
    meta, seen = [], set()
    for group in range(parquet.num_row_groups):
        rows = parquet.read_row_group(group, columns=["id", "audio", "transcription", "raw_transcription", "gender"])
        for row in rows.to_pylist():
            if row["id"] in seen:
                continue
            seen.add(row["id"])
            audio, rate = sf.read(io.BytesIO(row["audio"]["bytes"]), dtype="float32")
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            if rate != 16000 or len(audio) / rate > max_seconds:
                continue
            name = f"{row['id']}.wav"
            sf.write(folder / name, np.clip(audio, -1, 1), rate, subtype="PCM_16")
            meta.append({"file": name, "seconds": round(len(audio) / rate, 2), "text": row["transcription"],
                         "raw": row["raw_transcription"], "gender": row["gender"]})
            if len(meta) >= n:
                break
        if len(meta) >= n:
            break
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{config}: {len(meta)} clips, downloaded {remote.fetched / 1e6:.0f} of {remote.size / 1e6:.0f} MB",
          file=sys.stderr)
    return meta


def normalise(text: str) -> str:
    """For scoring: no punctuation, no spaces, lower case."""
    text = unicodedata.normalize("NFC", text).lower()
    return "".join(ch for ch in text if not ch.isspace() and not unicodedata.category(ch).startswith("P"))


def edit_distance(a: str, b: str) -> int:
    row = list(range(len(b) + 1))
    for i in range(1, len(a) + 1):
        prev, row[0] = row[0], i
        for j in range(1, len(b) + 1):
            cur = row[j]
            row[j] = min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
            prev = cur
    return row[len(b)]


def cer(reference: str, hypothesis: str) -> float:
    ref, hyp = normalise(reference), normalise(hypothesis)
    return edit_distance(ref, hyp) / max(1, len(ref))


if __name__ == "__main__":
    fetch(sys.argv[1], int(sys.argv[2]), Path(sys.argv[3]).expanduser())

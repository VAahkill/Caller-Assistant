"""Spoken language identification: which language is the caller speaking?

Whisper's own guess is poor for Indian languages (it hears Telugu as Tamil or
Hindi most of the time), so calls use SpeechBrain's VoxLingua107 ECAPA model
(``speechbrain/lang-id-voxlingua107-ecapa``, Apache-2.0, 107 languages, 85 MB,
no account needed). Its result is restricted to the languages the user's callers
speak (see ``languages.LanguageTracker``).

The network below is a small port of SpeechBrain's ``Fbank``, ``ECAPA_TDNN`` and
``Xvector.Classifier`` (Apache-2.0, https://github.com/speechbrain/speechbrain),
so the published weights load as they are. The ``speechbrain`` package itself
needs torchaudio, whose wheels don't match the CPU build of torch the server
uses; this port needs nothing but torch.
"""

from __future__ import annotations

import hashlib
import logging
import math
import threading
from pathlib import Path

import numpy as np

from ..audio import RATE, pcm16_to_float

log = logging.getLogger("opencall.lid")

REPO = "speechbrain/lang-id-voxlingua107-ecapa"
REVISION = "0253049ae131d6a4be1c4f0d8b0ff483a0f8c8e9"
FILES = {
    "embedding_model.ckpt": "ab750d5c06d713477045fa798fab5d33e959dbc0dfe4de510a9a47844c79a19a",
    "classifier.ckpt": "a50d9024ff58d317031c9787d4c6c614d454a87a8ef32f9d36338cd3ff57adbc",
    "label_encoder.txt": "9f566d83c4f19168be4a0bf86c0c7dac7d3264a95105bcbf33a7c32b83ccc17f",
}
# The model is most of the cost on long turns and gains little after this much speech.
MAX_SECONDS = 8.0


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


def fetch_pinned(repo: str, revision: str, files: dict[str, str], local_dir: Path | None = None) -> Path:
    """Downloads ``files`` of a Hugging Face repo at a fixed revision (no account
    needed) and checks each one's SHA-256. Returns the folder holding them."""
    from huggingface_hub import hf_hub_download

    folder: Path | None = None
    for name, digest in files.items():
        path = Path(hf_hub_download(repo, name, revision=revision,
                                    local_dir=str(local_dir) if local_dir else None))
        if digest and sha256(path) != digest:
            path.unlink(missing_ok=True)
            raise RuntimeError(f"{repo}/{name} doesn't match its expected checksum; delete it and try again.")
        folder = path.parent
    assert folder is not None
    return folder


def parse_labels(text: str) -> list[str]:
    """``'te: Telugu' => 94`` lines -> language codes by index."""
    labels: dict[int, str] = {}
    for line in text.splitlines():
        if "=>" not in line or "starting_index" in line:
            continue
        key, _, idx = line.rpartition("=>")
        labels[int(idx.strip())] = key.strip().strip("'").split(":")[0].strip()
    return [labels[i] for i in range(len(labels))]


def _build(torch):
    """The VoxLingua107 network, with SpeechBrain's parameter names."""
    nn, F = torch.nn, torch.nn.functional

    class Conv1d(nn.Module):  # "same" padding, reflected, like SpeechBrain's
        def __init__(self, in_channels, out_channels, kernel_size, dilation=1):
            super().__init__()
            self.pad = dilation * (kernel_size - 1) // 2
            self.conv = nn.Conv1d(in_channels, out_channels, kernel_size, dilation=dilation)

        def forward(self, x):
            if self.pad:
                x = F.pad(x, (self.pad, self.pad), mode="reflect")
            return self.conv(x)

    class BatchNorm1d(nn.Module):
        def __init__(self, size):
            super().__init__()
            self.norm = nn.BatchNorm1d(size)

        def forward(self, x):
            return self.norm(x)

    class TDNNBlock(nn.Module):
        def __init__(self, cin, cout, k, d):
            super().__init__()
            self.conv = Conv1d(cin, cout, k, d)
            self.activation = nn.ReLU()
            self.norm = BatchNorm1d(cout)

        def forward(self, x):
            return self.norm(self.activation(self.conv(x)))

    class Res2NetBlock(nn.Module):
        def __init__(self, channels, scale, k, d):
            super().__init__()
            self.scale = scale
            self.blocks = nn.ModuleList(TDNNBlock(channels // scale, channels // scale, k, d) for _ in range(scale - 1))

        def forward(self, x):
            y = []
            for i, x_i in enumerate(torch.chunk(x, self.scale, dim=1)):
                if i == 0:
                    y_i = x_i
                elif i == 1:
                    y_i = self.blocks[0](x_i)
                else:
                    y_i = self.blocks[i - 1](x_i + y_i)
                y.append(y_i)
            return torch.cat(y, dim=1)

    class SEBlock(nn.Module):
        def __init__(self, cin, se, cout):
            super().__init__()
            self.conv1 = Conv1d(cin, se, 1)
            self.conv2 = Conv1d(se, cout, 1)

        def forward(self, x):
            s = x.mean(dim=2, keepdim=True)
            return torch.sigmoid(self.conv2(torch.relu(self.conv1(s)))) * x

    class SERes2NetBlock(nn.Module):
        def __init__(self, cin, cout, k, d):
            super().__init__()
            self.tdnn1 = TDNNBlock(cin, cout, 1, 1)
            self.res2net_block = Res2NetBlock(cout, 8, k, d)
            self.tdnn2 = TDNNBlock(cout, cout, 1, 1)
            self.se_block = SEBlock(cout, 128, cout)

        def forward(self, x):
            return self.se_block(self.tdnn2(self.res2net_block(self.tdnn1(x)))) + x

    class AttentiveStatisticsPooling(nn.Module):
        def __init__(self, channels, attention):
            super().__init__()
            self.tdnn = TDNNBlock(channels * 3, attention, 1, 1)
            self.conv = Conv1d(attention, channels, 1)

        @staticmethod
        def _stats(x, w):
            mean = (w * x).sum(2)
            std = torch.sqrt((w * (x - mean.unsqueeze(2)).pow(2)).sum(2).clamp(1e-12))
            return mean, std

        def forward(self, x):
            n = x.shape[-1]
            mean, std = self._stats(x, torch.full_like(x[:, :1, :], 1.0 / n))
            attn = torch.cat([x, mean.unsqueeze(2).expand(-1, -1, n), std.unsqueeze(2).expand(-1, -1, n)], dim=1)
            attn = F.softmax(self.conv(torch.tanh(self.tdnn(attn))), dim=2)
            mean, std = self._stats(x, attn)
            return torch.cat((mean, std), dim=1).unsqueeze(2)

    class ECAPA(nn.Module):
        def __init__(self):
            super().__init__()
            ch, ks, dil = [1024, 1024, 1024, 1024, 3072], [5, 3, 3, 3, 1], [1, 2, 3, 4, 1]
            self.blocks = nn.ModuleList([TDNNBlock(60, ch[0], ks[0], dil[0])])
            for i in range(1, 4):
                self.blocks.append(SERes2NetBlock(ch[i - 1], ch[i], ks[i], dil[i]))
            self.mfa = TDNNBlock(ch[3] * 3, ch[4], ks[4], dil[4])
            self.asp = AttentiveStatisticsPooling(ch[4], 128)
            self.asp_bn = BatchNorm1d(ch[4] * 2)
            self.fc = Conv1d(ch[4] * 2, 256, 1)

        def forward(self, feats):  # (batch, time, 60) -> (batch, 256)
            x = feats.transpose(1, 2)
            outs = []
            for layer in self.blocks:
                x = layer(x)
                outs.append(x)
            x = self.mfa(torch.cat(outs[1:], dim=1))
            return self.fc(self.asp_bn(self.asp(x))).squeeze(2)

    class Linear(nn.Module):
        def __init__(self, cin, cout):
            super().__init__()
            self.w = nn.Linear(cin, cout)

        def forward(self, x):
            return self.w(x)

    class Block(nn.Module):
        def __init__(self):
            super().__init__()
            self.linear = Linear(256, 512)
            self.norm = BatchNorm1d(512)

        def forward(self, x):
            return self.norm(F.leaky_relu(self.linear(x)))

    class DNN(nn.Module):
        def __init__(self):
            super().__init__()
            self.block_0 = Block()

        def forward(self, x):
            return self.block_0(x)

    class Classifier(nn.Module):
        def __init__(self):
            super().__init__()
            self.norm = BatchNorm1d(256)
            self.DNN = DNN()
            self.out = Linear(512, 107)

        def forward(self, emb):  # (batch, 256) -> log-probabilities (batch, 107)
            x = self.DNN(self.norm(F.leaky_relu(emb)))
            return F.log_softmax(self.out(x), dim=-1)

    return ECAPA(), Classifier()


def _fbank_matrix(torch, n_mels: int = 60, n_fft: int = 400, rate: int = RATE):
    """SpeechBrain's triangular mel filters (0 Hz to rate/2)."""
    to_mel = lambda hz: 2595 * math.log10(1 + hz / 700)  # noqa: E731
    mel = torch.linspace(to_mel(0), to_mel(rate // 2), n_mels + 2)
    hz = 700 * (10 ** (mel / 2595) - 1)
    band, central = (hz[1:] - hz[:-1])[:-1], hz[1:-1]
    freqs = torch.linspace(0, rate // 2, n_fft // 2 + 1)
    slope = (freqs.unsqueeze(0) - central.unsqueeze(1)) / band.unsqueeze(1)
    return torch.clamp(torch.minimum(slope + 1.0, -slope + 1.0), min=0.0).transpose(0, 1)  # (freq, mels)


class VoxLinguaLID:
    """VoxLingua107 ECAPA: audio in, log-probabilities over 107 languages out."""

    name = "VoxLingua107"

    def __init__(self, model_dir: Path | None = None):
        self.model_dir = model_dir  # None = the Hugging Face cache
        self._model = None
        self._lock = threading.Lock()
        self.labels: list[str] = []

    @property
    def loaded(self) -> bool:
        return self._model is not None

    def warm_up(self) -> None:
        self._load()
        self.identify(b"\x00\x00" * RATE)

    def _load(self):
        with self._lock:
            if self._model is None:
                import torch

                folder = fetch_pinned(REPO, REVISION, FILES, self.model_dir)
                ecapa, classifier = _build(torch)
                for module, name in [(ecapa, "embedding_model.ckpt"), (classifier, "classifier.ckpt")]:
                    module.load_state_dict(torch.load(folder / name, map_location="cpu", weights_only=True))
                self.labels = parse_labels((folder / "label_encoder.txt").read_text(encoding="utf-8"))
                self._model = (torch, ecapa.eval(), classifier.eval(), _fbank_matrix(torch),
                               torch.hamming_window(400))
            return self._model

    def features(self, audio: np.ndarray):
        """Log-mel filterbank (60 bands, 25 ms windows every 10 ms), mean-normalised."""
        torch, _, _, fbank, window = self._load()
        wav = torch.from_numpy(np.ascontiguousarray(audio, dtype=np.float32)).unsqueeze(0)
        spec = torch.stft(wav, 400, 160, 400, window, center=True, pad_mode="constant", return_complex=True)
        power = spec.abs().pow(2).transpose(1, 2)  # (1, time, freq)
        db = 10 * torch.log10(torch.clamp(power @ fbank, min=1e-10))
        db = torch.maximum(db, db.amax(dim=(-2, -1), keepdim=True) - 80.0)
        return db - db.mean(dim=1, keepdim=True)

    def identify(self, pcm16k: bytes) -> dict[str, float]:
        """Log-probability of every language for this speech (16 kHz PCM16)."""
        torch, ecapa, classifier, _, _ = self._load()
        audio = pcm16_to_float(pcm16k)[: int(MAX_SECONDS * RATE)]
        if len(audio) < RATE // 4:
            audio = np.pad(audio, (0, RATE // 4 - len(audio)))
        with torch.inference_mode():
            logp = classifier(ecapa(self.features(audio)))[0].numpy()
        return {lang: float(lp) for lang, lp in zip(self.labels, logp, strict=True)}


class WhisperLID:
    """Whisper's own language guess, for when the language-ID model can't be used."""

    name = "Whisper"

    def __init__(self, stt):
        self.stt = stt

    def warm_up(self) -> None:
        pass  # the speech model is loaded anyway

    def identify(self, pcm16k: bytes) -> dict[str, float]:
        return self.stt.detect_language(pcm16k)


class LanguageID:
    """The configured language-ID model. If it can't be downloaded or loaded, Whisper's
    own guess is used instead (with a warning in the log); with no Whisper either,
    ``identify`` returns None and each turn's language is left to the speech model."""

    def __init__(self, primary, fallback=None):
        self.primary = primary
        self.fallback = fallback
        self.failed = False  # the primary model couldn't be loaded

    @property
    def name(self) -> str:
        if not self.failed:
            return getattr(self.primary, "name", type(self.primary).__name__)
        return getattr(self.fallback, "name", "Whisper") if self.fallback else "none"

    @property
    def available(self) -> bool:
        return not self.failed or self.fallback is not None

    def _fail(self, error: Exception) -> None:
        log.warning("Language identification with %s isn't available (%s: %s); %s.",
                    getattr(self.primary, "name", "the model"), error.__class__.__name__, error,
                    "using Whisper's guess instead" if self.fallback else "each turn's language is Whisper's guess")
        self.failed = True

    def warm_up(self) -> None:
        if not self.failed:
            try:
                self.primary.warm_up()
                return
            except Exception as e:
                self._fail(e)
        if self.fallback is not None:
            self.fallback.warm_up()

    def identify(self, pcm16k: bytes) -> dict[str, float] | None:
        """Log-probabilities by language, or None if no language ID is available."""
        if not self.failed:
            try:
                return self.primary.identify(pcm16k)
            except Exception as e:
                if getattr(self.primary, "loaded", False):
                    # The model works but not on this audio: guess this turn some other way.
                    log.warning("Language identification failed on one turn (%s: %s).", e.__class__.__name__, e)
                    return self.fallback.identify(pcm16k) if self.fallback else None
                self._fail(e)
        return self.fallback.identify(pcm16k) if self.fallback else None


def build_lid(provider: str, stt) -> LanguageID | None:
    """voxlingua (falls back to Whisper) | whisper | none."""
    whisper = WhisperLID(stt) if hasattr(stt, "detect_language") else None
    if provider == "voxlingua":
        return LanguageID(VoxLinguaLID(), whisper)
    if provider == "whisper" and whisper is not None:
        return LanguageID(whisper)
    return None

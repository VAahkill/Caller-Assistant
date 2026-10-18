FROM python:3.12-slim

# ffmpeg decodes the app's m4a recordings (and, through torchcodec, recorded
# voices); espeak-ng gives the Piper voices and Kokoro their phonemes and spells
# English words in Indian scripts.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg espeak-ng \
    && rm -rf /var/lib/apt/lists/*

# PyTorch's CPU build. The default one from PyPI adds several GB of NVIDIA GPU
# libraries that a computer without an NVIDIA card never uses. With an NVIDIA GPU,
# set OPENCALL_TORCH_INDEX in .env (see docker-compose.yml). torchaudio and
# torchcodec (used for recorded voices) come from the same place.
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir torch==2.14.1 torchaudio==2.11.0 torchcodec==0.17.0 --index-url ${TORCH_INDEX}

WORKDIR /app
# constraints.txt pins the versions this image is tested with, so a new release of
# one library can't break the others.
COPY pyproject.toml constraints.txt ./
ARG EXTRAS=stt-indic,lid,vad,mt,tts,piper,indic
# Dependencies first, against an empty package, so updating OpenCall's own code
# doesn't download them all again.
RUN mkdir opencall && touch opencall/__init__.py \
    && pip install --no-cache-dir -c constraints.txt ".[${EXTRAS}]" && rm -rf opencall
COPY opencall ./opencall
RUN pip install --no-cache-dir --no-deps .

ENV OPENCALL_DATA_DIR=/data
# Keep downloaded speech models in the data volume so rebuilds don't fetch them again.
ENV HF_HOME=/data/models
# Recorded voices (XTTS-v2): its model is kept in the volume too, and its licence
# (CPML: free for non-commercial use) is accepted here, because the server has no
# terminal to answer Coqui's question at the first download.
ENV TTS_HOME=/data/models/tts
ENV COQUI_TOS_AGREED=1
VOLUME /data
EXPOSE 8000 9092
CMD ["python", "-m", "opencall"]

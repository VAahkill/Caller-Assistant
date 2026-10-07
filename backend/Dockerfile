FROM python:3.12-slim

# ffmpeg decodes the app's m4a recordings; espeak-ng is used by Kokoro for
# phonemes outside its dictionary.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg espeak-ng \
    && rm -rf /var/lib/apt/lists/*

# PyTorch's CPU build. The default one from PyPI adds several GB of NVIDIA GPU
# libraries that a computer without an NVIDIA card never uses. With an NVIDIA GPU,
# set OPENCALL_TORCH_INDEX in .env (see docker-compose.yml).
ARG TORCH_INDEX=https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir torch --index-url ${TORCH_INDEX}

WORKDIR /app
COPY pyproject.toml ./
ARG EXTRAS=stt,vad,tts,indic
# Dependencies first, against an empty package, so updating OpenCall's own code
# doesn't download them all again.
RUN mkdir opencall && touch opencall/__init__.py \
    && pip install --no-cache-dir ".[${EXTRAS}]" && rm -rf opencall
COPY opencall ./opencall
RUN pip install --no-cache-dir --no-deps .

ENV OPENCALL_DATA_DIR=/data
# Keep downloaded speech models in the data volume so rebuilds don't fetch them again.
ENV HF_HOME=/data/models
VOLUME /data
EXPOSE 8000 9092
CMD ["python", "-m", "opencall"]

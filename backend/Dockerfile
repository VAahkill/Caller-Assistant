FROM python:3.12-slim

# ffmpeg decodes the app's m4a recordings; espeak-ng is used by Kokoro for
# phonemes outside its dictionary.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg espeak-ng \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY pyproject.toml ./
COPY opencall ./opencall
ARG EXTRAS=stt,vad,tts,indic
RUN pip install --no-cache-dir ".[${EXTRAS}]"

ENV OPENCALL_DATA_DIR=/data
# Keep downloaded speech models in the data volume so rebuilds don't fetch them again.
ENV HF_HOME=/data/models
VOLUME /data
EXPOSE 8000 9092
CMD ["python", "-m", "opencall"]

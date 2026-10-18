"""Server settings, read from environment variables prefixed with OPENCALL_.

Everything the *user* edits from the app (name, location, instructions, voice)
lives in the data store instead, so it can change without a restart.
"""

from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="OPENCALL_", env_file=".env", extra="ignore")

    host: str = "0.0.0.0"
    port: int = 8000
    data_dir: Path = Path("./data")
    # Shared secret the mobile app sends as a Bearer token. Required when the
    # server is reachable from the internet (e.g. through a Cloudflare Tunnel).
    api_token: str = "change-me"
    public_url: str = "http://localhost:8000"

    # LLM: any OpenAI-compatible chat endpoint. Defaults to a local Ollama. Optional
    # free cloud tiers (Groq, Gemini) are in .env.example.
    llm_provider: str = "openai_compat"  # openai_compat | scripted
    llm_base_url: str = "http://localhost:11434/v1"
    llm_api_key: str = "ollama"
    llm_model: str = "qwen3:4b-instruct"
    llm_temperature: float = 0.4
    llm_max_tokens: int = 300
    # Extra request fields, as JSON. Thinking is off: a model that reasons before each
    # reply keeps the caller waiting (Ollama and llama.cpp understand "none"; Groq and
    # Gemini want "low").
    llm_extra_body: str = '{"reasoning_effort": "none"}'
    # A local model on a CPU can need minutes to load and read the prompt the first
    # time; later replies start within seconds. The first word may take this long:
    llm_first_token_timeout_s: float = 180.0
    llm_connect_timeout_s: float = 5.0
    llm_idle_timeout_s: float = 30.0  # max pause once the reply is streaming
    # If the reply hasn't started after this many seconds, say "One moment, please"
    # (and once more after filler_again_s) so the caller isn't left in silence. 0 = off.
    filler_after_s: float = 2.5
    filler_again_s: float = 15.0

    stt_provider: str = "faster_whisper"  # faster_whisper | none
    # The main speech model: English, and any language without a model of its own.
    whisper_model: str = "large-v3-turbo"
    whisper_device: str = "auto"
    # Beam search width for callers' speech: 1 (greedy) is quickest; wider is a bit
    # more accurate and slower (see docs/ARCHITECTURE.md for both measured).
    whisper_beam_size: int = 1
    # Per-language speech models on top of the built-in ones (Telugu, Tamil and Hindi
    # fine-tunes, see providers/stt.py), e.g. "te=org/model,hi=off"; off = main model.
    stt_models: str = ""
    # The user's own spoken replies in English, from the app during a call: clear
    # phone-mic speech, so a small model is enough and the caller hears them about
    # 3x sooner on a CPU. "main" uses the main model.
    owner_stt_model: str = "small"
    # Which language a caller speaks: voxlingua (accurate for Indian languages) |
    # whisper (Whisper's own guess, often hears Telugu as Tamil) | none
    lid_provider: str = "voxlingua"
    # Only with lid_provider=none: the languages Whisper may hear, e.g. "en,hi,te"
    # (the caller languages chosen in the app do this job otherwise).
    caller_languages: str = ""
    # Translation between callers' languages and English: indictrans2 (needs the mt
    # extra; about 500 MB, downloaded on first start) | none
    mt_provider: str = "indictrans2"

    vad_provider: str = "silero"  # silero (needs the vad extra) | energy
    end_of_turn_silence_ms: int = 650
    barge_in_ms: int = 300

    tts_provider: str = "kokoro"  # kokoro | silent
    default_voice: str = "kokoro:af_heart"
    clone_provider: str = "xtts"  # xtts | none
    # Voices for Telugu, Tamil and other Indian languages Kokoro can't speak:
    # mms (fast on a CPU) | parler (more natural, wants a GPU) | none
    indic_tts: str = "mms"
    indic_parler_model: str = "ai4bharat/indic-parler-tts"
    # Loaded at startup so the first call isn't slow (the caller languages are too).
    indic_preload: str = "te,ta"
    # Piper voices (Telugu; needs espeak-ng and onnxruntime): on | off
    piper_voices: str = "on"

    # Telephony: which bridges to enable. See docs/TELEPHONY.md. All free:
    # Bluetooth to your own phone, or Asterisk with a USB GSM modem.
    bluetooth_enabled: bool = False
    bluetooth_answer_delay_s: float = 6.0  # ring this long before answering
    bluetooth_answer_delay_available_s: float = 15.0  # longer when you're around
    bluetooth_source: str = ""  # PipeWire node names; found automatically if empty
    bluetooth_sink: str = ""
    bluetooth_sms: bool = True  # text map links through the phone (Bluetooth MAP, Android)
    asterisk_enabled: bool = True
    asterisk_audiosocket_port: int = 9092
    asterisk_ari_url: str = ""  # e.g. http://asterisk:8088/ari
    asterisk_ari_user: str = ""
    asterisk_ari_password: str = ""
    # chan_quectel GSM modem; for a SIP trunk use e.g. "PJSIP/{number}@trunk"
    asterisk_outbound_endpoint: str = "Quectel/quectel0/{number}"
    asterisk_outbound_context: str = "opencall-outbound"
    # Texting a map link to delivery partners through the GSM modem, via AMI.
    asterisk_ami_host: str = "127.0.0.1"
    asterisk_ami_port: int = 5038
    asterisk_ami_user: str = ""
    asterisk_ami_password: str = ""
    asterisk_sms_command: str = 'quectel sms quectel0 {number} "{text}"'
    # Optional paid extra, never required.
    twilio_account_sid: str = ""
    twilio_auth_token: str = ""
    twilio_from_number: str = ""

    # Push notifications through Expo's free push service (empty = off; the
    # app still gets live events while it's open).
    expo_push_url: str = "https://exp.host/--/api/v2/push/send"

    hold_timeout_s: float = 45.0
    hold_reminder_s: float = 15.0
    max_call_minutes: float = 15.0

    @property
    def recordings_dir(self) -> Path:
        return self.data_dir / "recordings"

    @property
    def voices_dir(self) -> Path:
        return self.data_dir / "voices"

    @property
    def models_dir(self) -> Path:
        """Models OpenCall prepares itself (converted speech models)."""
        return self.data_dir / "models"

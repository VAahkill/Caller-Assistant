# OpenCall Receptionist

A completely free, open-source AI phone receptionist that runs on your own computer.
No subscriptions, no paid APIs, no card needed anywhere. It answers your calls in a
natural human voice (or your own cloned voice), screens spam, guides delivery partners
to your door in their language, never reveals OTPs or passwords, asks you when it
doesn't know something, takes messages, calls people back, and makes calls for you
("check if a table for 3 is free at 8 tonight, and book it").

Built from a study of hiRobin, Bland AI, Retell AI and Vapi: see
[docs/RESEARCH.md](docs/RESEARCH.md).

## What it does

| | |
|---|---|
| **Screens calls** | Blocks international numbers, telemarketing series and blocked contacts before answering; politely ends loan, insurance and sales pitches. Saved contacts always get through. |
| **Delivery partners** | Detects a delivery call, then gives step-by-step directions from your map pin and landmarks, in the caller's language (Whisper detects it). Can also text them a map link (GSM modem, or Android over Bluetooth). Your address is never told to anyone else. |
| **Zero-trust security** | Requests for OTPs, PINs, passwords, CVVs or balances are refused in code before the AI sees them, and you get an alert. Everything the assistant says is scrubbed for code-like numbers. |
| **Live transcript** | Every call streams to the app as a chat. Type anything and the assistant says it. |
| **Hold and ask** | When a caller asks something it doesn't know, it puts them on hold, notifies you with a reply box, and relays your answer naturally. No answer? It takes a message. |
| **Messages and callbacks** | Messages come with a summary, transcript and recording. Reply, and the assistant can call them back to pass it on. |
| **Calls for you** | Share or paste a number, say what you need. It calls, asks, books if you said so, and asks you mid-call when they offer an alternative. |
| **Voices** | Built-in natural voices (Kokoro, including Hindi), Telugu, Tamil and seven more Indian languages (MMS), or record 15 to 30 seconds to clone your own (XTTS-v2). |
| **Map pin** | Pin your door on a free OpenStreetMap map, or paste a Google Maps link. No Maps API key or billing account. |
| **Your rules** | Add instructions ("tell couriers to leave parcels with the guard") and facts callers may know, by typing or by talking to the assistant. |

## Costs nothing to run

| Part | What OpenCall uses | Cost |
|---|---|---|
| Phone line | Bluetooth link to your own phone, or a USB GSM modem with a spare SIM | Free / one-time modem |
| Speech to text | Faster-Whisper, on your computer | Free |
| AI brain | Ollama (Llama 3.1) on your computer; Groq free tier if your PC is slow | Free |
| Voices | Kokoro, MMS Indian-language voices and XTTS-v2 voice cloning, on your computer | Free |
| Maps | OpenStreetMap (OpenFreeMap tiles, Nominatim) | Free, no key |
| Notifications | Expo push service | Free |
| Reaching your server | Home Wi-Fi, Tailscale free plan, or a trycloudflare.com tunnel | Free |

## How it fits together

```
            ┌─────────────── your computer (home PC, Mac or Raspberry Pi) ──────────────┐
Your phone  │ Bluetooth hands-free  ─┐                                                  │
   or       │                        ├─▶ VAD ─▶ Faster-Whisper ─▶ LLM (Ollama) ─▶ tags   │
GSM modem ─▶│ Asterisk (AudioSocket) ┘                   Kokoro / XTTS ◀── guardrails  │
            │ FastAPI: REST + live events websocket + push notifications               │
            └──────────────────────────────────┬────────────────────────────────────────┘
                                               ▼
                                OpenCall app (React Native / Expo)
```

- `backend/` Python server. Start reading at `opencall/engine.py` and `opencall/session.py`.
- `mobile/` Expo app: live transcript, hold answers, call-for-me tasks, voices,
  map pin, instructions.
- `deploy/asterisk/` dialplan and GSM modem templates.

**Important:** phones don't let ordinary apps hear or speak on cellular calls. The
free ways around that are a Bluetooth hands-free link (like a car kit) or a USB GSM
modem. See [docs/TELEPHONY.md](docs/TELEPHONY.md).

## Quick start

**New here?** [docs/TRY_IT.md](docs/TRY_IT.md) walks through running the server on
Windows, installing the Android app and making a practice call, step by step.

```bash
cp .env.example .env              # set OPENCALL_API_TOKEN and pick a phone route
docker compose up -d
docker compose exec ollama ollama pull llama3.1:8b
```

For the Bluetooth route, run the server directly on the host instead of Docker; the
steps are in [docs/TELEPHONY.md](docs/TELEPHONY.md).

Hardware: an NVIDIA GPU with 8 GB+ or an Apple Silicon Mac with 16 GB runs the whole
stack locally. A CPU-only computer with 16 GB works too; if replies are slow there,
use Groq's free tier (free key, no card) for the LLM, or
`OPENCALL_WHISPER_MODEL=small` (faster, but worse at Indian languages). The Docker
image uses PyTorch's CPU build to keep the download small; with an NVIDIA GPU, put
`OPENCALL_TORCH_INDEX=https://pypi.org/simple` in `.env` and uncomment the GPU lines
in `docker-compose.yml` before building.

App:

```bash
cd mobile
npm install
npx expo start          # or: npx expo run:android
```

Open Settings, enter your server URL and token, then pin your location, pick a voice
and add instructions. Background push notifications use Expo's free push service and
need a free Expo account (`npx eas init`); without it the app still notifies you
while it's open. Build the APK locally for free with `npx expo run:android --variant release`.

## Development

```bash
cd backend && pip install -e ".[dev]" && pytest     # tests run without any models
cd mobile && npx tsc --noEmit
```

## Limitations

- Telugu, Tamil, Kannada, Malayalam, Bengali, Marathi, Gujarati, Punjabi and Urdu
  are spoken with Meta's MMS voices: clear, but flatter than the English and Hindi
  voices, and licensed for non-commercial use only. AI4Bharat's Indic Parler-TTS
  (`OPENCALL_INDIC_TTS=parler`) sounds more natural but needs an NVIDIA GPU. Cloned
  voices can't speak these languages yet, so those callers hear a built-in voice.
- Whisper sometimes mistakes Telugu for Tamil or Hindi. List the languages your
  callers speak in `OPENCALL_CALLER_LANGUAGES` to keep it on track.
- End-of-turn detection is silence-based; a semantic turn-taking model is a planned
  upgrade.
- The Bluetooth route and GSM modem route are written against oFono/PipeWire and
  chan_quectel but haven't been tried on real hardware yet.
- Map-link texts reach the number the delivery partner called from. Many delivery apps
  mask that number, so the assistant always reads the directions out as well.
- Sharing straight from another app's share sheet isn't wired yet; the app picks up a
  copied number from the clipboard instead, and accepts `opencall://tasks?number=…&goal=…`.

## License

Apache-2.0

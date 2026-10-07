# OpenCall Receptionist

A free, open-source, self-hosted AI phone receptionist. It answers your calls in a
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
| **Delivery partners** | Detects a delivery call, then gives step-by-step directions from your map pin and landmarks, in the caller's language (Whisper detects it). Your address is never told to anyone else. Can text a map link (Twilio). |
| **Zero-trust security** | Requests for OTPs, PINs, passwords, CVVs or balances are refused in code before the AI sees them, and you get an alert. Everything the assistant says is scrubbed for code-like numbers. |
| **Live transcript** | Every call streams to the app as a chat. Type anything and the assistant says it. |
| **Hold and ask** | When a caller asks something it doesn't know, it puts them on hold, notifies you with a reply box, and relays your answer naturally. No answer? It takes a message. |
| **Messages and callbacks** | Messages come with a summary, transcript and recording. Reply, and the assistant can call them back to pass it on. |
| **Calls for you** | Share or paste a number, say what you need. It calls, asks, books if you said so, and asks you mid-call when they offer an alternative. |
| **Voices** | Built-in natural voices (Kokoro, including Hindi), or record 15 to 30 seconds to clone your own (XTTS-v2). |
| **Your rules** | Add instructions ("tell couriers to leave parcels with the guard") and facts callers may know, by typing or by talking to the assistant. |

## How it fits together

```
           ┌────────────── your server (home PC, Mac or VPS) ───────────────┐
Caller ─▶  │ Asterisk/Twilio ─▶ VAD ─▶ Faster-Whisper ─▶ LLM (Ollama/Groq)   │
mobile     │        ▲                                     │                 │
forwards   │        └──── Kokoro / XTTS voice ◀── guardrails ◀── tags       │
           │ FastAPI: REST + live events websocket + push notifications     │
           └───────────────────────────────┬─────────────────────────────────┘
                                           ▼
                              OpenCall app (React Native / Expo)
```

- `backend/` Python server. Start reading at `opencall/engine.py` and `opencall/session.py`.
- `mobile/` Expo app: live transcript, hold answers, call-for-me tasks, voices,
  map pin, instructions.
- `deploy/asterisk/` dialplan and SIP trunk templates.

**Important:** phones don't let ordinary apps hear or speak on cellular calls, so
calls reach the server through carrier call forwarding to a SIP or Twilio number.
See [docs/TELEPHONY.md](docs/TELEPHONY.md).

## Quick start

```bash
cp .env.example .env              # set OPENCALL_API_TOKEN and your phone line
docker compose up -d
docker compose exec ollama ollama pull llama3.1:8b
```

Hardware: an NVIDIA GPU with 8 GB+ or an Apple Silicon Mac with 16 GB runs the whole
stack locally. On a CPU-only machine use `OPENCALL_WHISPER_MODEL=small` and Groq's
free tier for the LLM.

App:

```bash
cd mobile
npm install
npx expo start          # or: npx expo run:android
```

Open Settings, enter your server URL and token, then pin your location, pick a voice
and add instructions. Push notifications need an EAS project id
(`npx eas init`); without it the app still notifies you while it's open.

## Development

```bash
cd backend && pip install -e ".[dev]" && pytest     # tests run without any models
cd mobile && npx tsc --noEmit
```

## Limitations

- Kokoro speaks English, Hindi and a few other languages; XTTS adds more. Telugu,
  Tamil and other Indian languages are understood (Whisper) but spoken replies fall
  back to Hindi or English until an Indic TTS provider is added.
- End-of-turn detection is silence-based; a semantic turn-taking model is a planned
  upgrade.
- Sharing straight from another app's share sheet isn't wired yet; the app picks up a
  copied number from the clipboard instead, and accepts `opencall://tasks?number=…&goal=…`.

## License

Apache-2.0

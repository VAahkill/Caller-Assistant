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
| **Delivery partners** | Detects a delivery call, then gives step-by-step directions from your map pin and landmarks, in the caller's language (Whisper detects it). Your address is never told to anyone else. |
| **Zero-trust security** | Requests for OTPs, PINs, passwords, CVVs or balances are refused in code before the AI sees them, and you get an alert. Everything the assistant says is scrubbed for code-like numbers. |
| **Live transcript** | Every call streams to the app as a chat. Type anything and the assistant says it. |
| **Hold and ask** | When a caller asks something it doesn't know, it puts them on hold, notifies you with a reply box, and relays your answer naturally. No answer? It takes a message. |
| **Messages and callbacks** | Messages come with a summary, transcript and recording. Reply, and the assistant can call them back to pass it on. |
| **Calls for you** | Share or paste a number, say what you need. It calls, asks, books if you said so, and asks you mid-call when they offer an alternative. |
| **Voices** | Built-in natural voices (Kokoro, including Hindi), or record 15 to 30 seconds to clone your own (XTTS-v2). |
| **Map pin** | Pin your door on a free OpenStreetMap map, or paste a Google Maps link. No Maps API key or billing account. |
| **Your rules** | Add instructions ("tell couriers to leave parcels with the guard") and facts callers may know, by typing or by talking to the assistant. |

## Costs nothing to run

| Part | What OpenCall uses | Cost |
|---|---|---|
| Phone line | Bluetooth link to your own phone, or a USB GSM modem with a spare SIM | Free / one-time modem |
| Speech to text | Faster-Whisper, on your computer | Free |
| AI brain | Ollama (Llama 3.1) on your computer; Groq free tier if your PC is slow | Free |
| Voices | Kokoro and XTTS-v2 voice cloning, on your computer | Free |
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

```bash
cp .env.example .env              # set OPENCALL_API_TOKEN and pick a phone route
docker compose up -d
docker compose exec ollama ollama pull llama3.1:8b
```

For the Bluetooth route, run the server directly on the host instead of Docker; the
steps are in [docs/TELEPHONY.md](docs/TELEPHONY.md).

Hardware: an NVIDIA GPU with 8 GB+ or an Apple Silicon Mac with 16 GB runs the whole
stack locally. On a CPU-only machine use `OPENCALL_WHISPER_MODEL=small`, and Groq's
free tier (free key, no card) for the LLM if replies are slow.

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

- Kokoro speaks English, Hindi and a few other languages; XTTS adds more. Telugu,
  Tamil and other Indian languages are understood (Whisper) but spoken replies fall
  back to Hindi or English until an Indic TTS provider is added.
- End-of-turn detection is silence-based; a semantic turn-taking model is a planned
  upgrade.
- The Bluetooth route and GSM modem route are written against oFono/PipeWire and
  chan_quectel but haven't been tried on real hardware yet.
- Texting a map link to a delivery partner isn't available on the free routes; the
  assistant reads out the directions instead.
- Sharing straight from another app's share sheet isn't wired yet; the app picks up a
  copied number from the clipboard instead, and accepts `opencall://tasks?number=…&goal=…`.

## License

Apache-2.0

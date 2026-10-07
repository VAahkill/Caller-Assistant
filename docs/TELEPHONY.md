# Getting calls to the assistant

A normal Android or iPhone app cannot hear or speak on cellular calls (see
[RESEARCH.md](RESEARCH.md#telephony-reality-check-android)). So calls reach OpenCall
through a phone number on a VoIP line, and your mobile forwards calls to it.

```
Caller ─▶ your mobile number ──(no answer / busy / unreachable: carrier forwards)──▶
SIP number ─▶ Asterisk ─▶ OpenCall server (AudioSocket) ─▶ AI
                                    │
                                    └── live transcript + notifications ─▶ OpenCall app
```

The phone layer is swappable. The engine only sees a `CallBridge`
(`backend/opencall/telephony/base.py`), so adding another provider means writing one
small class.

## Option A: Asterisk (recommended, open source)

Cost: only the SIP number from any VoIP provider (often about $1 a month plus
per-minute rates). Everything else runs on your machine.

1. Get a phone number (DID) with SIP credentials from a VoIP provider that serves your
   country.
2. Fill in `deploy/asterisk/pjsip.conf` with those credentials.
3. Set the same token in `deploy/asterisk/extensions.conf` (`OPENCALL_TOKEN`) and
   `.env` (`OPENCALL_API_TOKEN`), and the ARI password in `ari.conf` and `.env`.
4. Start it: `docker compose --profile asterisk up -d`. The Asterisk build needs
   `res_audiosocket`, `app_audiosocket`, `res_ari` and `func_curl` (Asterisk 20+).
5. Forward your mobile to the SIP number using your carrier's conditional call
   forwarding codes (GSM standard; check with your carrier):
   - `**61*<number>#` forward when unanswered
   - `**67*<number>#` forward when busy
   - `**62*<number>#` forward when unreachable
   - `##002#` cancels all forwarding
   Unconditional forwarding (`**21*<number>#`) sends every call to the assistant.
6. Outbound calls ("call this restaurant for me") go out through the same trunk via
   ARI. Caller ID will be the SIP number unless your provider lets you present your
   mobile number.

## Option B: Twilio (quickest, paid)

1. Buy a Twilio number. Set its Voice webhook to
   `https://<your server>/telephony/twilio/voice` (HTTP POST).
2. Put `OPENCALL_TWILIO_ACCOUNT_SID`, `OPENCALL_TWILIO_AUTH_TOKEN`,
   `OPENCALL_TWILIO_FROM_NUMBER` and `OPENCALL_PUBLIC_URL` in `.env`.
3. Forward your mobile to the Twilio number as above.

Twilio bills per minute after the trial credit. It also enables sending the
delivery partner a map link by SMS.

## Option C: rooted phone (free, not implemented)

A rooted Android phone can grant a system-privileged app call-audio access, which
would let the phone itself be the gateway with no extra number. It breaks with OS
updates and voids most warranties, so it isn't built here.

## Try it without a phone line

The server has a simulator websocket. With the server running:

```bash
python - <<'PY'
import asyncio, json, websockets
async def main():
    async with websockets.connect("ws://localhost:8000/ws/simulate?token=change-me&number=9876543210") as ws:
        await ws.send(json.dumps({"text": "Hi, I have a Swiggy order, where do I come?", "lang": "en"}))
        audio = 0
        async for frame in ws:      # the assistant's voice as 16 kHz PCM16 frames
            audio += len(frame)
            print(f"received {audio / 32000:.1f}s of speech", end="\r")
asyncio.run(main())
PY
```

Watch the live transcript appear in the app while it runs.

## Exposing the server to the app

Use a free [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/)
(`cloudflared tunnel --url http://localhost:8000`) or any reverse proxy with HTTPS,
and set a long random `OPENCALL_API_TOKEN`.

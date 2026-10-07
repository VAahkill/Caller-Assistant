# Getting calls to the assistant, for free

A normal Android or iPhone app cannot hear or speak on cellular calls (see
[RESEARCH.md](RESEARCH.md#telephony-reality-check-android)), so the assistant needs
another way onto the line. OpenCall supports two routes that cost nothing to run.
Neither needs a VoIP provider, a paid phone number or a subscription.

| | Bluetooth link | GSM modem |
|---|---|---|
| Extra hardware | None (any Bluetooth-capable PC, laptop or Raspberry Pi) | A voice-capable USB GSM/LTE modem, one-time purchase |
| Extra SIM | No, uses your own number | Yes, any cheap prepaid SIM |
| Recurring cost | Nothing | Only the SIM's validity recharge |
| Works when you're away from home | No, the phone must be in Bluetooth range | Yes, via call forwarding |
| Outbound "call for me" | Yes, from your own number | Yes, from the modem's SIM |
| Phones | Android and iPhone | Any |

The phone layer is swappable. The engine only sees a `CallBridge`
(`backend/opencall/telephony/base.py`), so another route means one small class.

## Option 1: Bluetooth link to your own phone (free, no extra hardware)

The server pairs with your phone as a Bluetooth hands-free device, exactly like a
car kit. Your phone reports incoming calls to it, lets it answer and dial, and sends
the call audio over Bluetooth. Calls stay on your own number; no forwarding needed.

```
Caller ─▶ your phone ──Bluetooth hands-free──▶ home PC (BlueZ + oFono + PipeWire) ─▶ OpenCall
```

Setup on a Linux machine with Bluetooth (Debian/Ubuntu/Raspberry Pi OS):

```bash
sudo apt install bluez ofono pipewire wireplumber pipewire-audio-client-libraries
# Let PipeWire use oFono for hands-free calls:
mkdir -p ~/.config/wireplumber/wireplumber.conf.d
cat > ~/.config/wireplumber/wireplumber.conf.d/50-opencall-hfp.conf <<'EOF'
monitor.bluez.properties = {
  bluez5.hfphsp-backend = "ofono"
}
EOF
systemctl --user restart wireplumber
bluetoothctl   # power on, scan on, pair <phone>, trust <phone>, connect <phone>
```

Then run the server on the host (not in Docker, since it needs the host's Bluetooth
and audio):

```bash
cd backend && pip install -e ".[stt,vad,tts,bluetooth]"
OPENCALL_BLUETOOTH_ENABLED=true python -m opencall
```

How it behaves:
- An incoming call rings for `OPENCALL_BLUETOOTH_ANSWER_DELAY_S` seconds (6 by default,
  15 when you've marked yourself available in the app) so you can pick up yourself.
  If you don't, the assistant answers.
- Spam series, international numbers and blocked contacts are rejected without
  answering.
- If you answer on the phone yourself, your phone may still send the audio to the
  "headset". Tap the audio button on the call screen to switch it back to the phone.
- Keep the phone within about 10 m of the server. On iPhone, keep the server
  connected in Settings → Bluetooth.

## Option 2: Asterisk + USB GSM modem (cheap one-time hardware, works anywhere)

A USB GSM/LTE modem with an ordinary prepaid SIM becomes the assistant's phone line.
You forward your main number's unanswered calls to that SIM. Asterisk (free, open
source) connects the modem to OpenCall.

```
Caller ─▶ your mobile ──(carrier forwards if unanswered)──▶ spare SIM in USB modem ─▶ Asterisk ─▶ OpenCall
```

1. Get a modem that supports voice over USB. The
   [chan_quectel driver](https://github.com/IchthysMaranatha/asterisk-chan-quectel)
   lists tested models (Quectel EC20/EC21/EC25/EG9x, SIMCom SIM7600). Older Huawei
   sticks such as the E173 work with chan_dongle. Insert any prepaid SIM.
2. Install Asterisk 20+ with chan_quectel, `res_audiosocket`, `app_audiosocket`,
   `res_ari` and `func_curl`, and copy the files from `deploy/asterisk/`.
3. Set the same token in `deploy/asterisk/extensions.conf` (`OPENCALL_TOKEN`) and
   `.env` (`OPENCALL_API_TOKEN`), and the ARI password in `ari.conf` and `.env`.
4. Forward your main mobile to the modem SIM's number with the standard GSM codes:
   - `**61*<number>#` forward when unanswered
   - `**67*<number>#` forward when busy
   - `**62*<number>#` forward when unreachable
   - `##002#` cancels all forwarding

   Forwarding to another number in your own country is usually counted as a normal
   outgoing call, which is free on unlimited plans. Check your plan.
5. "Call for me" tasks go out through the modem SIM, so they cost what a normal call
   from that SIM costs (free on an unlimited plan).

If you already have a SIP line, Asterisk can use it instead of the modem: set
`OPENCALL_ASTERISK_OUTBOUND_ENDPOINT=PJSIP/{number}@<your trunk>` and point the
trunk's context at `opencall-inbound`.

## Optional paid extra: Twilio

The code still includes a Twilio bridge (`backend/opencall/telephony/twilio.py`) for
people who already have a Twilio account. It is never required and is off unless
`OPENCALL_TWILIO_ACCOUNT_SID` is set.

## Try it without any phone line

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

## Connecting the app to the server, for free

- **At home:** use the server's Wi-Fi address, e.g. `http://192.168.1.10:8000`.
- **Away from home:** install [Tailscale](https://tailscale.com/) (free personal plan,
  no card) on the server and the phone, and use the server's Tailscale address. Nothing
  is exposed to the internet.
- **Without an account:** `cloudflared tunnel --url http://localhost:8000` gives a free
  temporary `trycloudflare.com` address (it changes on every restart).

Always set a long random `OPENCALL_API_TOKEN`.

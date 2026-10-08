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
| Text a map link to delivery partners | Yes on Android (Bluetooth message access); not on iPhone | Yes, from the modem's SIM |
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
sudo apt install bluez bluez-obexd ofono pipewire wireplumber pipewire-audio-client-libraries
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
- Delivery partners can be texted a map link through your phone, using Bluetooth's
  message access profile. On Android, allow "Message access" for the computer in the
  phone's Bluetooth device settings. iPhones don't allow sending texts this way, so
  there the assistant reads the directions out. Turn it off with
  `OPENCALL_BLUETOOTH_SMS=false`.
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
6. To text delivery partners a map link from the modem SIM, copy
   `deploy/asterisk/manager.conf` too and set the `OPENCALL_ASTERISK_AMI_*` values in
   `.env`. OpenCall sends the text with chan_quectel's `quectel sms` command. Most
   prepaid plans include free SMS.

If you already have a SIP line, Asterisk can use it instead of the modem: set
`OPENCALL_ASTERISK_OUTBOUND_ENDPOINT=PJSIP/{number}@<your trunk>` and point the
trunk's context at `opencall-inbound`.

## Optional paid extra: Twilio

The code still includes a Twilio bridge (`backend/opencall/telephony/twilio.py`) for
people who already have a Twilio account. It is never required and is off unless
`OPENCALL_TWILIO_ACCOUNT_SID` is set.

## Try it without any phone line

The server has a simulator websocket, `/ws/simulate`. The app's practice call uses
it. With the server running (`pip install websockets` first):

```bash
python - <<'PY'
import asyncio, json, websockets
async def main():
    url = "ws://localhost:8000/ws/simulate?token=change-me&number=9876543210&wav=1"
    async with websockets.connect(url) as ws:
        await ws.send(json.dumps({"text": "Hi, I have a Swiggy order for you. Where should I come?"}))
        async for msg in ws:
            if isinstance(msg, bytes):  # the assistant's voice, one WAV file per sentence
                print(f"  (speech, {len(msg) / 32000:.1f} s)")
                continue
            ev = json.loads(msg)
            if ev["event"] == "transcript":
                print(f'{ev["line"]["speaker"]}: {ev["line"]["text"]}')
            elif ev["event"] in ("ack", "error", "assistant_status", "turn_error"):
                print("  ", ev)
asyncio.run(main())
PY
```

Press Ctrl+C to hang up. What you can send:

| Message | What it does |
|---|---|
| `{"text": "...", "lang": "te"}` | The caller says this (`lang` is optional; the script or the `lang=` in the URL is used otherwise) |
| `{"audio_b64": "<base64 of any audio file>", "lang": "te"}` | A finished recording. The silence around it is cut and it is answered as one utterance |
| binary 16 kHz PCM16 frames | A live microphone stream, cut into turns by the voice detector |
| `{"action": "say", "text": "...", "lang": "en"}` / `{"action": "say_audio", "audio_b64": "..."}` | You speak to the caller yourself |
| `{"hangup": true}` | Ends the call |

Every message gets an `ack` or an `error` back, never silence. You also receive
every event of the call: `transcript`, `transcript_update`, `assistant_status`
(`listening`, `transcribing`, `thinking`, `speaking`, `idle`, `error`), `call_category`,
`hold_question`, `sensitive_request`, `turn_error` and `call_ended`. Add `&lang=te` to the
URL to say which language the caller speaks. Without `wav=1` the speech comes as
real-time 16 kHz PCM16 frames.

Watch the live transcript appear in the app while it runs.

## Connecting the app to the server, for free

- **At home:** use the server's Wi-Fi address, e.g. `http://192.168.1.10:8000`.
- **Away from home:** install [Tailscale](https://tailscale.com/) (free personal plan,
  no card) on the server and the phone, and use the server's Tailscale address. Nothing
  is exposed to the internet.
- **Without an account:** `cloudflared tunnel --url http://localhost:8000` gives a free
  temporary `trycloudflare.com` address (it changes on every restart).

Always set a long random `OPENCALL_API_TOKEN`.

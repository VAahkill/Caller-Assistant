# Getting calls to the assistant, for free

A normal Android or iPhone app cannot hear or speak on cellular calls (see
[RESEARCH.md](RESEARCH.md#telephony-reality-check-android)), so the assistant needs
another way onto the line. OpenCall supports two routes that cost nothing to run.
Neither needs a VoIP provider, a paid phone number or a subscription. Both need the
server on a Linux computer; on Windows, see
[If your computer runs Windows](#if-your-computer-runs-windows).

| | Bluetooth link | GSM modem |
|---|---|---|
| Extra hardware | None (any Bluetooth-capable PC, laptop or Raspberry Pi running Linux) | A voice-capable USB GSM/LTE modem, one-time purchase |
| Extra SIM | No, uses your own number | Yes, any cheap prepaid SIM |
| Recurring cost | Nothing | Only the SIM's validity recharge |
| Works when you're away from home | No, the phone must be in Bluetooth range | Yes, via call forwarding |
| Outbound "call for me" | Yes, from your own number | Yes, from the modem's SIM |
| Text a map link to delivery partners | Yes on Android (Bluetooth message access); not on iPhone | Yes, from the modem's SIM |
| Phones | Android and iPhone | Any |

The phone layer is swappable. The engine only sees a `CallBridge`
(`backend/opencall/telephony/base.py`), so another route means one small class.

## If your computer runs Windows

Docker Desktop runs the server inside a small Linux system that can't reach the
computer's Bluetooth or USB modems, so neither route below works with it. On Windows
you can still use the app's practice calls (you play a caller) and practice "Call for
me" (you play the place the assistant calls).

For real calls, the free option is to run the server on Linux: on the same laptop
(for example Ubuntu installed on a USB stick or on a second partition, picked when
the laptop starts), or on any spare computer that runs Linux, such as an old laptop
or a Raspberry Pi. Then follow Option 1 or Option 2 there.

To be honest about where this stands: both routes are written for the standard
Linux phone software (oFono for Bluetooth, chan_quectel for the modem), but neither
has been tried with a real phone or modem yet, so expect some troubleshooting.

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
sudo apt install ffmpeg espeak-ng
cd backend && pip install -c constraints.txt -e ".[stt-indic,lid,vad,mt,tts,piper,indic,bluetooth]"
OPENCALL_BLUETOOTH_ENABLED=true python -m opencall
```

These are the same parts as the Docker image (Indian-language speech models, language
ID, translation and voices), less the voice cloning extra (`clone`). The language
model then runs on the host too: install [Ollama](https://ollama.com),
pull the model named by `OPENCALL_LLM_MODEL` in `.env` (`ollama pull <model>`), and
set `OPENCALL_LLM_BASE_URL=http://localhost:11434/v1`.

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
3. In `.env`, remove the `#` from the `OPENCALL_ASTERISK_` lines (they stay
   commented out until you have a modem, so the server doesn't look for an Asterisk
   that isn't there). Set the same token in `deploy/asterisk/extensions.conf`
   (`OPENCALL_TOKEN`) and `.env` (`OPENCALL_API_TOKEN`), and the ARI password in
   `ari.conf` and `.env`.
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

## Is the line working?

`GET /health` (no token needed) reports the line as `phone_line`, and the app shows
it on its status screen:

```json
"phone_line": {"kind": "gsm", "ok": false, "inbound": false, "outbound": false,
               "detail": "No phone line is connected. Your server is set to use Asterisk at host.docker.internal:8088, but nothing answers there."}
```

`kind` is `bluetooth`, `gsm` (Asterisk), `twilio` or `none`. `ok` means a line is
connected now, `inbound` that real calls can reach the assistant, `outbound` that
"Call for me" can place calls, and `detail` says what the server found. Asterisk is
asked (`GET /ari/asterisk/info`) at most every 15 seconds. When the line can't place
calls, `POST /tasks` answers 409 with that reason and creates no task.

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
| `{"action": "say", "text": "...", "lang": "en"}` | You speak to the caller yourself: typed in your language (`lang` is optional), said in theirs |
| `{"action": "say_audio", "audio_b64": "...", "lang": "te"}` | The same, recorded: transcribed in your language (`lang`, else `owner_language`), then translated and said |
| `{"action": "answer", "hold_id": "...", "text": "..."}` | Your answer to a hold question, in your language |
| `{"hangup": true}` | Ends the call |

To practise "Call for me", add `goal=` (what the assistant should get done) to the
URL, and optionally `kind=` (`enquire`, the default, `book`, `callback` or `custom`),
`target_name=` and `number=` for the place. You then play the place being called,
and it runs exactly like a real call for you: it isn't screened, you may speak first
("Hello, Paradise restaurant") or the assistant starts after 3 seconds of silence,
and questions for you arrive as `task_needs_decision` (answer with `{"action":
"answer", ...}`). `started` carries the new task's `task_id`, its `task_update`
events come on the same socket, and the task is saved with `practice: true`. Every
call made through this socket is saved with `practice: true` too.

Every message gets an `ack` or an `error` back, never silence. You also receive
every event of the call: `transcript`, `transcript_update`, `assistant_status`
(`listening`, `transcribing`, `translating`, `thinking`, `speaking`, `idle`, `error`),
`call_language`, `call_category`, `hold_question`, `sensitive_request`, `urgent_call`,
`turn_error` and `call_ended`. Add `&lang=te` to the URL to say which language the
caller speaks; the greeting is then in that language too. Without `wav=1` the speech
comes as real-time 16 kHz PCM16 frames.

With live translation on (`translate_live`, the default), every caller and assistant
line is followed by a `transcript_update {line_id, translation, translation_lang,
english}` with the line in your `owner_language`. The same `say`, `say_audio` and
`answer` actions work on `/ws/events` (with a `call_id`) and over REST
(`POST /calls/{id}/say`, `/say-audio`, `/answer`), for real calls.

Watch the live transcript appear in the app while it runs.

## Connecting the app to the server, for free

- **At home:** use the server's Wi-Fi address, e.g. `http://192.168.1.10:8000`.
- **Away from home:** install [Tailscale](https://tailscale.com/) (free personal plan,
  no card) on the server and the phone, and use the server's Tailscale address. Nothing
  is exposed to the internet.
- **Without an account:** `cloudflared tunnel --url http://localhost:8000` gives a free
  temporary `trycloudflare.com` address (it changes on every restart).

Always set a long random `OPENCALL_API_TOKEN`.

**Pairing instead of typing the token.** The app can ask the server for a pairing
code (`POST /pair/start`, no token needed). The server writes it to its log:

```bash
docker compose logs opencall | grep "Pairing code"
# ... Pairing code for the OpenCall app: 482913 (valid 5 minutes)
```

Type the 6 digits into the app, which trades them for the token
(`POST /pair/finish {"code": "482913"}`). A code lasts 5 minutes and allows 5 tries;
after that it is void and you ask for a new one. Asking again while a code is
waiting gives the same code, and at most 5 codes are made an hour. Only someone who
can read the server's log can pair, so keep the log private.

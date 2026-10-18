# How the leading AI calling agents work, and what OpenCall takes from each

This is the blueprint study behind OpenCall. It covers hiRobin, Bland AI, Retell AI
and Vapi. Where a claim comes from a vendor's own marketing or a third-party write-up
rather than documentation, it says so.

## The shared pipeline

Every voice agent in this space runs the same loop, streamed end to end:

```
phone network ─▶ telephony gateway ─▶ VAD / turn detection ─▶ streaming STT
      ▲                                                            │
      └──── telephony gateway ◀── streaming TTS ◀── streaming LLM ◀┘
```

What separates the good ones is latency (the gap between the caller finishing and the
agent starting to speak) and turn-taking (knowing when the caller has really finished,
and stopping instantly when they talk over the agent).

## hiRobin (consumer, India)

- An iPhone/Android app by TaskGenie Private Limited, first released February 2026,
  "built for India" ([App listing](https://mwm.ai/apps/hirobin-ai-call-assistant/6753679133),
  [APK listing](https://apkcombo.com/hirobin-ai-call-assistant/com.robinhomeai.app/)).
- Handles incoming and outgoing calls: delivery coordination (gives couriers
  directions), spam/loan/insurance call screening, outgoing calls for bookings and
  refunds, gate-security check-ins, and a summary of every call.
- No public technical documentation was found. Consumer assistants of this kind
  generally receive calls through **carrier conditional call forwarding** to a
  cloud number, because phone OSes don't let ordinary apps touch call audio (see
  "Telephony reality check" below). The pasted draft's claim that hiRobin hooks
  Android's `InCallService` for audio is not something we could verify.

**Taken into OpenCall:** the feature set (delivery guidance, spam screening,
outbound bookings, per-call summaries).

## Bland AI (outbound at scale)

- Built around **Pathways**: deterministic node graphs that keep the agent on a
  script for outbound campaigns
  ([write-up](https://agentmarketcap.ai/blog/2026/04/09/voice-agent-architecture-2026-elevenlabs-bland-vapi-sub200ms),
  [Bland's own comparison](https://bland.ai/blog/retell-vs-vapi)).
- Supports injecting new instructions into a live call.

**Taken into OpenCall:** outbound "concierge" calls follow a fixed shape (introduce,
ask, if the offer differs → hold and ask the user, confirm, report an `OUTCOME`), and
the user can inject text into any live call from the transcript screen.

## Retell AI (latency and turn-taking)

- Reports ~600 ms end-to-end response time measured across production calls
  ([Retell latency report](https://www.retellai.com/resources/ai-voice-agent-latency-face-off-2025)).
- Uses a dedicated **turn-taking model** that looks at prosody, meaning and pauses,
  rather than plain silence detection, so it can tell a backchannel ("mm-hm") or a
  hesitation from the end of a turn
  ([Retell: how real-time voice AI works](https://www.retellai.com/blog/how-real-time-voice-ai-works-stt-llm-tts)).
- Publishes guidance for **call forwarding** into the agent
  ([Retell call forwarding](https://www.retellai.com/blog/best-practices-for-setting-up-ai-voice-agents-with-call-forwarding)).

**Taken into OpenCall:** sentence-level streaming (TTS starts on the first sentence
while the LLM is still writing), barge-in that cuts speech the moment the caller
talks, and silence-based end-of-turn with a tunable threshold. A semantic
turn-detector model is a planned upgrade.

## Vapi (orchestration layer)

- An orchestration layer rather than one integrated model: it wires many STT, LLM
  and TTS providers into one pipeline, and calls tools/webhooks mid-call
  ([write-up](https://agentmarketcap.ai/blog/2026/04/09/voice-agent-architecture-2026-elevenlabs-bland-vapi-sub200ms)).

**Taken into OpenCall:** every stage is a swappable provider (`backend/opencall/providers`),
any OpenAI-compatible LLM works (Ollama, Groq free tier, LM Studio, vLLM), and the
phone layer is its own swappable module (`backend/opencall/telephony`).

## Telephony reality check (Android)

The pasted plan relied on an Android default-dialer app hearing and speaking on
cellular calls. That does not work on a normal phone:

- Capturing call audio needs `CAPTURE_AUDIO_OUTPUT`, which third-party apps cannot
  hold; only system or vendor apps can
  ([MITRE ATT&CK T1429](https://attack.mitre.org/techniques/T1429/)).
- Google also closed the Accessibility-API workaround for call recording
  ([Engadget](https://www.engadget.com/google-is-banning-third-party-call-recording-apps-from-the-play-store-093201443.html)).
- `InCallService` lets a default dialer show and control calls, not stream their
  audio ([Android docs](https://developer.android.com/reference/android/telecom/package-summary)).

Commercial assistants solve this with carrier forwarding to a paid cloud number.
OpenCall avoids any paid line: the server either pairs with your phone as a
Bluetooth hands-free device (like a car kit, which phones do allow to answer calls
and carry call audio), or uses a USB GSM modem with a spare SIM that your number
forwards to. See [TELEPHONY.md](TELEPHONY.md).

## What OpenCall adds

- **Hard security guardrails outside the LLM.** OTP, PIN, password, CVV and balance
  requests are refused by code before the model sees them, and every sentence the
  assistant is about to say is scrubbed for code-like numbers. The model cannot leak
  what it never had, and cannot say a code even if a user-typed reply contains one.
- **Address privacy.** The delivery address is only added to the conversation once
  the caller is identified as a delivery partner.
- **Live supervision.** Real-time transcript, hold-and-ask with a reply box right in
  the notification, and type-to-say at any time.
- **Callbacks.** Reply to a message and the assistant calls the person back with it.
- **Completely free to run.** Local models, local hosting, free OpenStreetMap maps,
  and phone routes that need no VoIP provider or subscription.

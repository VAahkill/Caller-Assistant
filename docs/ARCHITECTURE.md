# How a call turn works

This page is for people changing the backend (`backend/opencall`). It covers what
happens between the caller saying something and the assistant answering, and the
rules each part relies on.

## The path of one turn

```
caller audio ──► turn detector ──► speech to text ──► screening ──► language model ──► speech ──► caller
 (phone line)    (Silero VAD)      (Whisper)          + guardrails    (streamed)         (per sentence)
```

1. **Turn detection** (`providers/vad.py`, `TurnDetector`). Live audio comes in 20 ms
   frames. Silero (the default) decides which frames are speech. A turn ends after
   `OPENCALL_END_OF_TURN_SILENCE_MS` of silence. If Silero isn't installed, the simple
   energy detector is used and the log says so once.
2. **Speech to text** (`providers/stt.py`). Whisper writes at most 224 tokens per
   piece of audio, and Telugu or Tamil can need 20 a second. So a turn longer than
   9 s is cut at its pauses (`audio.split_at_pauses`) and transcribed piece by piece.
3. **Screening and guardrails** (`screening.py`, `guardrails.py`). Delivery calls and
   requests for OTPs, PINs, passwords, bank details or balances are caught from the
   words: English, Hindi, Telugu and Tamil, in their own script or in English
   letters. Both checks also take an English version of the line, when there is one.
   A request for a code is refused, and the user is alerted (`sensitive_request`).
4. **The language model** (`agent.py`, `Conversation`). The reply streams in. Tags
   such as `[HOLD: ...]` are parsed out, and each finished sentence is spoken while
   the rest is still being written.
5. **Speech** (`providers/tts.py`). Kokoro speaks English and Hindi, and MMS speaks
   Telugu, Tamil and the other Indian languages. Fixed lines (the greeting, "One
   moment, please", the apology) are made at start-up and kept in memory.

## Rules the language model relies on

- **The last message is always the caller's (role `user`).** Chat templates such as
  Ollama's add the "assistant is speaking now" header only after a user message. A
  trailing system message made the model write "assistant" itself, then a reply and
  an unwanted translation. `Conversation._messages()` raises if this rule is broken,
  and `tests/test_message_order.py` checks it on every path.
- **Everything about this call goes in the one system message, at its end.** That
  covers who is calling, availability, the delivery details once the call is known
  to be a delivery, and which language to reply in. The fixed part comes first, so
  the model's prompt cache is reused from call to call.
- **Notes from the user's side are `user` messages that start with
  `[Private note from <name>'s side; the caller did not say this]`.** These are hold
  answers, hold timeouts and the outbound kickoff. Numbers in them are never treated
  as something the caller said.
- **Consecutive messages with the same role are merged, and leading assistant
  messages are dropped,** because some templates (Gemma) require strict turns.
- A speaker label the model writes anyway ("assistant:") is cut from the start of
  the reply before anything is spoken.

## Turns never end in silence

`CallSession` (`session.py`) runs every turn the same way: live speech, a typed line,
a recording or a hold answer.

- **One at a time, after the greeting.** Each turn is a task of its call, takes the
  call's turn lock, and waits until the greeting has been spoken.
- **Failures are reported and apologised for.** An error in a turn is logged and
  sent as `turn_error`, with what went wrong. The caller hears "Sorry, something went
  wrong on my side. Could you please say that again?" in their language, and the
  call goes on.
- **Slow replies get a filler.** If no words come within `OPENCALL_FILLER_AFTER_S`
  (2.5 s), the caller hears "One moment, please". If there are still none after
  `OPENCALL_FILLER_AGAIN_S` (15 s), they hear a second line.
- **Hang-up stops everything.** Running turns are cancelled, and the language model's
  stream is closed, so the server stops generating.
- **The app sees each stage** as `assistant_status`: `listening`, `transcribing`,
  `thinking`, `speaking`, `idle` (on hold or call over) and `error`.

## The language model's time limits and warm-up

`providers/llm.py` allows 5 s to connect and up to 180 s for the first word
(`OPENCALL_LLM_FIRST_TOKEN_TIMEOUT_S`). A local model on a CPU can need that long the
first time. Once words are flowing, a 30 s pause is a stall. Every failure raises
`LLMError` with a message the user can act on.

At start-up the engine sends the real call prompt with a one-token request. This
loads the model and fills its prompt cache before the first caller. It retries with
back-off until it works. It warms again after a failed turn and after each call
summary. It also warms when the user changes something the prompt is made from
(their name, instructions, notes...), and then the greeting is made again too. If a
call is live, that waits until the call ends. Docker Compose sets `OLLAMA_KEEP_ALIVE=24h`, so Ollama doesn't unload the
model between calls. `GET /health` shows `ready: {stt, tts, llm, mt, lid}` and
`llm_model`.

## The practice call (`/ws/simulate`)

The app's practice call pretends to be a caller. The protocol is in
[TELEPHONY.md](TELEPHONY.md#try-it-without-any-phone-line). Some points for backend
work:

- Every message is answered with `ack` or `error`. Nothing is dropped silently.
- A recording (`audio_b64`) skips the turn detector. It is decoded with ffmpeg (from
  a temporary file, because phone m4a files keep their index at the end), the
  silence around it is trimmed, and it is answered as one utterance in the chosen
  language.
- The socket forwards every event of its own call, so the practice screen doesn't
  need `/ws/events`.

## The user's own words in a call

`say` and `say_audio` (on `/ws/events`, `/ws/simulate` or
`POST /calls/{id}/say` and `/say-audio`) go through `CallSession.owner_say`. It
blocks anything with a code-like number. It then adds one `user` line to the
transcript and speaks the text. This is where translation into the caller's
language plugs in.

## Transcript lines

`TranscriptLine` has an `id` and a `lang`, plus `translation`, `translation_lang` and
`english`. A translation that arrives after the line is sent as
`transcript_update {line_id, translation, translation_lang}`.

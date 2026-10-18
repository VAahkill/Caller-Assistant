# How a call turn works

This page is for people changing the backend (`backend/opencall`). It covers what
happens between the caller saying something and the assistant answering, and the
rules each part relies on.

## The path of one turn

```
caller audio ──► turn detector ──► language ID ──► speech to text ──► into English ──► screening ──► language model ──► translation ──► speech ──► caller
 (phone line)    (Silero VAD)      (VoxLingua107)  (Whisper, one       (IndicTrans2)    + guardrails   (streamed,         (IndicTrans2)    (a voice per
                                                    model per language)                                 in English)                         sentence)
```

1. **Turn detection** (`providers/vad.py`, `TurnDetector`). Live audio comes in 20 ms
   frames. Silero (the default) decides which frames are speech. A turn ends after
   `OPENCALL_END_OF_TURN_SILENCE_MS` of silence, and keeps the 500 ms from before
   speech was detected (the first sound of a word is soft). If the caller goes on
   talking before a turn's words were understood, that turn is cancelled and its
   audio is heard again with the rest, so a pause mid-sentence loses nothing. If
   Silero isn't installed, the simple energy detector is used and the log says so once.
2. **Language ID** (`providers/lid.py`, `languages.py`). Decides which of the user's
   caller languages is being spoken; see [Languages](#languages) below.
3. **Speech to text** (`providers/stt.py`). The turn is transcribed in the call's
   language, by that language's own model. The silence around the words is cut
   first, and half a second of silence is put back before them: given audio that
   starts right at the first sound, the fine-tuned models often skipped the first
   word or sentence. Whisper writes at most 224 tokens per piece of audio, and
   Telugu or Tamil can need 20 a second. So a turn longer than 9 s is cut at its
   pauses (`audio.split_at_pauses`) and transcribed piece by piece.
4. **Into English** (`session.py`, `_english`). A line in another language is
   translated into English for the model; the transcript keeps both. See
   [Thinking in English](#thinking-in-english).
5. **Screening and guardrails** (`screening.py`, `guardrails.py`). Delivery calls and
   requests for OTPs, PINs, passwords, bank details or balances are caught from the
   words: English, Hindi, Telugu and Tamil, in their own script or in English
   letters. Both checks also take an English version of the line, when there is one.
   A request for a code is refused, and the user is alerted (`sensitive_request`).
6. **The language model** (`agent.py`, `Conversation`). The reply streams in. Tags
   such as `[HOLD: ...]` are parsed out, and each finished sentence is spoken while
   the rest is still being written.
7. **Translation** (`providers/mt.py`). A sentence in English for a caller who speaks
   another language is translated, then checked by the guardrails again, so a number
   can't slip through in other words. The app sees `assistant_status: translating`.
8. **Speech** (`providers/tts.py`). Each sentence goes to a voice that can read its
   script; see [Voices](#voices). Fixed lines (the greeting, "One moment, please",
   the apology) are made at start-up, and again when the user changes their voices,
   and kept in memory.

## Languages

The user picks the languages their callers speak in the app (`caller_languages`,
most likely first). Everything below works within that list.

**Which language is being spoken** (`providers/lid.py`, `languages.LanguageTracker`).
VoxLingua107 (an ECAPA model, Apache-2.0, 82 MB, run with plain PyTorch) scores each
turn, and only the caller languages are compared. Hindi and Urdu sound the same, so
an Urdu score counts as Hindi when Urdu isn't on the list. The tracker adds up the
evidence turn by turn, starting from a small preference for the languages listed
first, and settles once it is 95% sure. It switches to another language only after
two confident turns in it, so one odd turn can't flip a Telugu call to Hindi. Short
turns count less, and once it has settled, a turn under 1.5 s can't start a
switch. Typed lines use their script, or the `lang` the app sends. Each change is
sent as `call_language {language, confidence}`. If the model can't load, Whisper's
own guess is used, and the log says so.

Measured on held-out FLEURS test clips (30 per language, choosing among en, hi, te
and ta; `eval/stt_lid.py`). "Phone line" is the clip through 300-3400 Hz, 8 kHz and
μ-law; "with noise" adds street-like noise (pink, with a slow wobble) 20 dB below
the voice first (`eval/phone.py`). A simulated call is four turns from consecutive
clips (the first 3 s of one, a whole one, 2 s, 5 s), replayed through the tracker:

| | 16 kHz | phone line | phone line with noise |
|---|---|---|---|
| One clip on its own, right language | 118/120 (98%) | 111/120 (92.5%) | 111/120 (92.5%) |
| Simulated calls (120): right after the first, 3 s turn | 91.7% | - | 81.7% |
| ...right on every turn | 90.8% | - | 80.0% |
| ...right after the last turn | 120/120 | - | 120/120 |

The phone-line column is from the first measurement, without noise; the simulated
calls were then six turns long, and are now four. Per language with noise, one clip
on its own: Telugu 29/30, Tamil 28/30, Hindi 28/30, English 26/30. All but one
mistake were guesses of Telugu (Tamil, Hindi and English heard as Telugu; one Telugu
clip heard as Tamil). So the first, short turn of a noisy call is in the wrong
language about one time in five; the turns after it correct it.
Offsets added to each language's score, fitted on FLEURS *validation* clips, took
those from 89.7% to 93.3% right but made the test clips worse (92.5% to 91.7%), so
none are used. The 95% target for one clip on a phone line is not met.

**Hearing each language** (`providers/stt.py`). Telugu, Tamil and Hindi have models
of their own: Whisper small fine-tuned on each language by vasista22 (Apache-2.0,
ungated). They are converted once to CTranslate2 int8 on first use, into
`/data/models/ct2/`. English and any other language use the main model
(`OPENCALL_WHISPER_MODEL`). `OPENCALL_STT_MODELS` replaces or turns off a language's
model (`ta=off`, `te=org/model@revision`). A model that can't load falls back to
the main one, with a warning.

Character error rate on 30 held-out FLEURS test clips per language (`eval/stt_lid.py
--no-lid`: the language given, the same silence trimming as a call, punctuation and
spaces ignored), mean with the median in brackets; lower is better. The first four
columns are from the first measurement, the last from this round:

| | Whisper large-v3-turbo, 16 kHz | own model, 16 kHz | turbo, phone line | own model, phone line | own model, phone line with noise |
|---|---|---|---|---|---|
| Telugu | 0.292 (0.182) | 0.085 (0.032) | 0.309 (0.268) | 0.130 (0.077) | 0.147 (0.084) |
| Tamil | 0.216 (0.195) | 0.122 (0.077) | 0.234 (0.209) | 0.159 (0.111) | 0.202 (0.135) |
| Hindi | 0.146 (0.111) | 0.087 (0.052) | 0.183 (0.134) | 0.150 (0.115) | 0.226 (0.149) |
| English | 0.045 (0.028) | - | 0.083 (0.046) | - | 0.098 (0.071) (turbo) |

Each language's own model is clearly better than the main model told the language,
on both kinds of audio, so they are the default. They are also about twice as fast
(real-time factor 0.4 to 0.8 against 0.7 to 1.5 on a shared 4-core CPU). Against the
targets on a noisy phone line (Telugu and Tamil 0.15, Hindi 0.10, English 0.08), only
Telugu passes. Many of the remaining errors are numbers written out in words where
the reference has digits ("403" as "நானூற்று மூன்று"; harmless in a reply), foreign
names, and, in noise, the Hindi model stopping after a few words of a long sentence.
What was tried:

- **Beam search** (`OPENCALL_WHISPER_BEAM_SIZE=5`; default 1): with noise Tamil
  0.202 to 0.174, Telugu 0.147 to 0.145, Hindi 0.226 to 0.220, English 0.098 to
  0.096, at 1.3 to 1.8 times the time. Not worth it except perhaps for Tamil.
- **Whisper small for English callers** (instead of turbo, about 3 times quicker):
  0.048 at 16 kHz but 0.221 with noise. Turbo stays.
- **Whisper medium fine-tuned on Hindi** (vasista22/whisper-hindi-medium,
  Apache-2.0): 0.049 at 16 kHz and 0.158 with noise, but 0.5 GB more memory, about
  2.4 times the time (real-time factor 0.9 to 1.0) and a 3 GB download to convert.
  It can be chosen with `OPENCALL_STT_MODELS=hi=vasista22/whisper-hindi-medium@d53532a4dc1d0d89e484ed8f7acfb2228a7d3785`;
  small stays the default for speed.

**Replies in the caller's language** (`providers/mt.py`). IndicTrans2 distilled
200M models as int8 ONNX (MIT; the hari31416 mirrors, pinned to a revision and
checked by SHA-256), about 500 MB for both directions, run with onnxruntime. Each
sentence is translated on its own and cached. Between two Indian languages it goes
through English. `OPENCALL_MT_PROVIDER=none` turns it off. Measured with
`eval/mt_check.py` on 30 typical replies and 20 caller lines per language
(4 shared vCPUs):

| | Telugu | Tamil | Hindi |
|---|---|---|---|
| Reply, English → language → English, chrF | 76.6 | 73.1 | 78.2 |
| Numbers and names kept in the reply | 30/30 | 30/30 | 30/30 |
| Caller line → English, chrF against a reference | 69.2 | 67.4 | 66.9 |
| Seconds per reply sentence, mean (90th percentile) | 0.56 (0.94) | 0.76 (1.49) | 0.62 (0.97) |

## Thinking in English

Small local models write good English and poor Telugu, so the model works in English
whatever the caller speaks (`Conversation.pivot`, set per turn):

- **What the model reads.** The caller's line in English (IndicTrans2), and the
  history in English: its own replies, fixed lines, the user's words. The guardrails
  and the delivery/spam classifier look at both the original and the English.
- **What it is told.** The last part of the system message says which language the
  caller speaks, that their words were translated, and that everything it writes is
  translated before they hear it. So: plain English, short simple sentences, one
  idea each, names, numbers, addresses and landmarks exactly as given, tags in
  English (`prompts.language_note`).
- **What the caller hears.** The reply streams sentence by sentence: checked, then
  translated, then checked again (a number must not appear in other words), then
  spoken. The transcript line has the caller's-language text, and `english`.
- **Fixed lines** (greeting, "one moment", the refusal, the apology, the spam
  decline, goodbye, the time-limit wrap-up, hold reminders) are English templates
  with hand-written Hindi, Telugu and Tamil (`phrases.py`). Other languages get a
  machine translation, made once and cached. The greeting, "one moment" and the
  apology are spoken at start-up for each language a voice can speak; every fixed
  line's speech is kept in memory once made.
- **The greeting** is said in the practice call's language, or the first caller
  language. It is built from parts: the intro, the away status when one is set
  (else "can't take the call right now"), and "How can I help?".
- **The user's own texts** (instructions, notes, the away message, the delivery
  directions) may be written in any language. Each is translated into English once,
  at start-up and when the profile changes, and the prompt uses the English.

## Voices

**A voice per sentence** (`providers/tts.py`, `TTSRouter`). A reply is split into
sentences, and each goes to a voice that can read its script:

- Latin script: the main voice (Kokoro, or the user's recorded voice).
- Devanagari (Hindi): Kokoro's Hindi voices, or a recorded voice (XTTS-v2 speaks
  Hindi). Marathi and Nepali calls use MMS.
- Telugu: Piper (Padmavathi, or Venkatesh for a male main voice).
- Tamil and the other Indian scripts: MMS, or Parler on a GPU.

Indian scripts never reach Kokoro's English voices or XTTS, which would read them
as noise. English words inside an Indian-language sentence ("Swiggy", "OTP") are
first written in that script (`transliterate.py`: espeak-ng's English pronunciation,
mapped to the script; acronyms letter by letter), because MMS and Piper can't read
Latin letters. The user can choose a voice per language (`voices_by_language`);
otherwise the default for that language with the main voice's gender is used.
Kokoro keeps one model for all its languages.

**Telugu: Piper rather than MMS.** Each voice said 23 typical replies, and the
Telugu speech model wrote down what it heard (`eval/tts_roundtrip.py`):

| Voice | Character errors, 16 kHz | after a phone line | Seconds to make 1 s of speech |
|---|---|---|---|
| MMS Telugu | 0.12 | 0.081 | 0.33 |
| Piper Padmavathi (female) | 0.047 | 0.046 | 0.13 |
| Piper Venkatesh (male) | 0.065 | 0.083 | 0.17 |

Padmavathi is clearly easier to understand than MMS; Venkatesh is clearer at 16 kHz
and about the same after a phone line. Both are much faster.
`OPENCALL_PIPER_VOICES=off` goes back to MMS.

**Demos** (`voice_samples.py`). `GET /voices` gives each voice a `sample_url`:
`/voices/{id}/sample.wav?lang=..&v=..`. The demo is made once and kept in
`/data/voices/samples`; `v` is its version, so that URL can be cached for good
(`ETag`, `304`). Demos of the built-in voices for the caller languages are made at
start-up, and a recorded voice's demo right after it is prepared. Requests for a
demo that is still being made wait for the same job.

**Recorded voices** (XTTS-v2, CPML licence: free for non-commercial use).
`POST /voices` takes a recording in any format the phone makes (15 to 30 s is best;
at least 6 s) and gives it a unique id (`clone:<name>-<6 hex>`). Its speaker
latents are worked out in the background; `voice_status {voice_id, status, detail}`
says when it is `ready`, or why it `failed`. `GET /voices/{id}/recording` plays the
recording back, `PATCH` renames and `DELETE` removes it (the default voice takes
over where it was used). The model needs transformers 4 (pinned in
`constraints.txt`). It is big and slow on a CPU (see Memory), so it is loaded only
while a recorded voice is in use. On the 4 vCPUs used for testing (shared with
other jobs) it took 14 to 20 s to make each second of speech, so a caller would
wait a long time for each sentence: recorded voices need a GPU to be usable in
live calls.

## Memory

The target machine gives Docker 12 GB (WSL), which has to hold the speech stack and
the language model. Measured resident memory of one process loading the stack the
way the server does, for caller languages en, hi, te and ta (versions from
`constraints.txt`, CPU only):

| Part | Added | Total |
|---|---|---|
| Python, PyTorch | 0.28 GB | 0.28 GB |
| Silero VAD | 0.06 GB | 0.33 GB |
| VoxLingua107 language ID | 0.13 GB | 0.46 GB |
| Whisper large-v3-turbo + Telugu, Tamil, Hindi models (int8) | 2.86 GB | 3.31 GB |
| ...after transcribing a turn in each language | 0.44 GB | 3.75 GB |
| IndicTrans2, both directions | 0.72 GB | 4.46 GB |
| Kokoro (one model), Piper Telugu, MMS Tamil | 0.87 GB | 5.33 GB |
| ...after speaking a line in each language | 0.23 GB | **5.56 GB** (peak 5.66 GB) |
| XTTS-v2, only while a recorded voice is in use | 2.3 to 3.2 GB | |
| Whisper small, once the user speaks a reply in English | 0.5 to 0.7 GB | |

That leaves about 6 GB for the language model and the system: enough for a 4B model
at 4-bit, but not for that and a recorded voice at once. A smaller
`OPENCALL_WHISPER_MODEL` saves memory, at a cost in accuracy for English and the
languages without a model of their own.

## Rules the language model relies on

- **The last message is always the caller's (role `user`).** Chat templates such as
  Ollama's add the "assistant is speaking now" header only after a user message. A
  trailing system message made the model write "assistant" itself, then a reply and
  an unwanted translation. `Conversation._messages()` raises if this rule is broken,
  and `tests/test_message_order.py` checks it on every path.
- **Everything about this call goes in the one system message, at its end.** The part
  that is the same for every caller comes first (the rules, the user's status, how to
  answer delivery partners, the language note: with translation the model always
  writes English), so a local model's prompt cache is reused from call to call. Then
  who is calling, the delivery details once the call is known to be a delivery, and
  last the caller's language.
- **Each call's first reply request is read ahead.** When a call is answered, the
  engine sends a local LLM that request as it will most likely look (a delivery
  partner speaking the greeting's language) with a one-token reply, while the greeting
  plays and the caller talks (`Engine.warm_up_call`). By the time their words are in,
  only those are new, or for another caller what follows the delivery details:
  about 250 fewer tokens to read before the first word, 2 to 3 s on a CPU. Cloud LLMs
  aren't sent this.
- **Codes are refused even when misheard.** Through a noisy line "OTP" can come out as
  "MOTP", "मोटीपी" or an unusual Telugu spelling; those are in the patterns too. For a
  request the patterns still miss, the model writes `[SECURITY: otp|pin|password|card|
  account|balance]`: the fixed refusal is said, the user is alerted, and nothing else
  the model wrote that turn is spoken.
- **The model is told the words may be misheard** ("Raghul" for Rahul, "board order"
  for food order) and to go by what they most likely mean. Without it a 4B model
  doubted a Telugu Swiggy partner's "board order from Raghul Garu" and held.
- **Notes from the user's side are `user` messages that start with
  `[Private note from <name>'s side; the caller did not say this]`.** These are hold
  answers, hold timeouts and the outbound kickoff. Numbers in them are never treated
  as something the caller said.
- **An answered call's turns start with the greeting.** First a private note ("A
  call has come in. Answer it."), then the greeting the caller heard, as the
  assistant's own turn. Told about the greeting only in the system message, a 4B
  model answered a Swiggy partner's question by saying the greeting again.
- **Consecutive messages with the same role are merged, and leading assistant
  messages are dropped,** because some templates (Gemma) require strict turns.
- **Sentences are cut at their end, not at an abbreviation.** The reply is spoken
  (and translated) a sentence at a time; a full stop after "Dr", "Mr", "St" and
  the like, or after "No" before a number ("Road No. 12"), doesn't end one
  (`languages.full_stop_ends_sentence`).
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
  `OPENCALL_FILLER_AGAIN_S` (15 s), they hear a second line. The time counts from
  when the caller stops talking (right after language ID, so the filler is in their
  language), not from when their words have been transcribed: on a slow CPU the
  speech model alone can take longer than 2.5 s.
- **A reply with nothing to say is never silence.** Small models sometimes answer
  with only a tag. A hang-up or a hold with no words first says the goodbye or
  "One moment, please" line; an empty reply (or one that was all tags) asks the
  caller to say it again. A 0.5B model did hang up on a Swiggy partner this way
  before this rule.
- **Hang-up stops everything.** Running turns are cancelled, and the language model's
  stream is closed, so the server stops generating.
- **The app sees each stage** as `assistant_status`: `listening`, `transcribing`,
  `translating`, `thinking`, `speaking`, `idle` (on hold or call over) and `error`.

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
model between calls. `GET /health` shows `ready: {stt, tts, llm, mt, lid}`,
`llm_model` and `phone_line` (below).

## Choosing the language model

The default model was chosen by measurement on this repository's own call check
(`eval/scenarios.py`, below), among small free models that fit in 12 GB beside the
speech stack. Each was run on its own, through llama.cpp's `llama-server` (build
b11400, CPU, 4 threads, 8192 context, one slot), loading the same GGUF file Ollama
downloads for it from registry.ollama.ai, with thinking off and the sampling settings
its makers recommend. `eval/llm_speed.py` measured its speed on the real call prompt.
The machine was a shared 4-vCPU cloud sandbox with no GPU; check `top` before timing.

First, 16 calls (delivery, OTP, bank and message calls in the four languages, through
the noisy phone line). "First word" is how long the model took to start its reply on
the real call prompt after the warm-up (`eval/llm_speed.py`); "first real reply" is
from the end of the caller's turn until they hear the answer, after the "One moment,
please" that covers the wait:

| Model (Ollama tag) | Calls passed | First word | Tokens per second | First real reply, median |
|---|---|---|---|---|
| `qwen3:4b-instruct` | **10/16** | 3.3 s | 7.4 | 8.8 s |
| `qwen3.5:4b` | 7/16 | 9.0 s | 5.7 | 11.5 s |
| `gemma4:e2b` | 7/16 | 2.3 s | 11.7 | 7.5 s |
| `llama3.2:3b` | 5/16 | 2.7 s | 7.5 | 7.6 s |
| `gemma3:4b` | 0/2 (run not finished) | 6.6 s | 9.1 | 15.3 s |

`qwen3:4b-instruct` is the default: it got the most calls right, and it can't
"think" before answering, so nothing has to be turned off. gemma4:e2b is quicker but
gave fewer right answers.

Then all 48 calls of the check, with the default model: **30/48 (62%)**, below the
90% target. By kind: delivery 8/8, VIP 4/4, bank 3/4, facts 3/4, interjection 3/4,
spam 3/4, booking 2/4, message 2/4, OTP 2/4, away 0/4, hold 0/4. By language: English
10/12, Telugu 9/14, Hindi 7/11, Tamil 4/11. Every call passed the latency check (the
caller heard something within 5 s, median 3.1 s) and no call errored. No OTP or
balance was ever said; the OTP failures were requests the speech model misheard
("OTP" as "मोटी", "thick", in Hindi; as "ஓடிவிட்டு" in Tamil), so neither the
patterns nor the model saw a request to refuse. Most of the rest were the model
treating a plumber's visit as a delivery (all four hold calls), and, worse, then
describing a made-up address. Two fixes followed: such a reply is now made again
once the delivery details are in the prompt, and the prompt says what is and isn't a
delivery. The away calls took a message without saying when the user is free; the
prompt now asks for the status first.

A bigger model would most likely do better on these, but none was measured here: it
doesn't fit beside the speech models in 12 GB. The free cloud tiers in `.env.example`
are an option where the call's words may leave the computer.

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
- With `goal` (and `kind`, `target_name`, `number`) it is a practice "Call for me".
  `TaskManager.create(..., practice=True)` registers the call id the way a dial does,
  and `Engine.open_session` picks the task up as an answered outbound call, so the
  conversation, the 3 s wait before the assistant speaks first, the hold questions,
  the outcome and `on_call_ended` are the real ones. The socket also forwards the
  task's `task_update` events (titled "Practice: ..."), and a task whose socket
  closes early still ends (`end_if_unfinished`).
- Every call made here is saved with `CallRecord.practice`.

## The phone line

Each dialer reports its line through `status()` (`telephony/base.py`,
`line_status`): `kind` (`bluetooth`, `gsm`, `twilio`, `none`), `ok`, `inbound`,
`outbound` and a `detail` for the user. Asterisk is probed with
`GET {ari}/asterisk/info` (2 s timeout, cached 15 s); Bluetooth asks oFono for a
powered hands-free modem, and a `start()` that fails (no D-Bus or oFono, as in
Docker Desktop) is logged and reported instead of stopping the server. `POST /tasks`
checks the line afresh and answers 409 with the `detail` when it can't place calls.
Dialers raise `PhoneLineError` with a plain sentence for known failures, which
becomes the task's result; any other error is logged, and the task gets a short
plain sentence instead of the exception's text.

## The user's own words in a call

The user follows a call in their own language (`owner_language`, default English)
and can speak to the caller in it. `translate_live` (on by default) turns off the
translations shown to the user; what the caller hears is always in their language.

- **Live translation.** Each caller line, assistant line and hold question is sent
  as it is, then followed by `transcript_update {line_id, translation,
  translation_lang, english}` with the line in the user's language. It is made from
  the English when the line has one (one step, and what the assistant meant), and
  only after the caller's audio is on its way, so it never delays the call.
- **Saying something** (`say`, `say_audio` on `/ws/events` or `/ws/simulate`, or
  `POST /calls/{id}/say` and `/say-audio`) goes through `CallSession.owner_say`.
  Anything with a code-like number is blocked. The text's language is the `lang`
  sent, else its script, else the user's language when that is written in English
  letters, else English. Sentence by sentence it is translated into English and then
  into the caller's language, checked again, and spoken, so the caller hears the
  first sentence while the next is translated. The transcript gets one `user` line:
  the caller's-language text, with the user's original as `translation`. The model's
  history gets the English, as something the assistant said. `say_audio` is first
  transcribed in the user's language: English by `OPENCALL_OWNER_STT_MODEL`
  (`small`; clear phone-mic speech doesn't need the large model; about 0.5 GB,
  loaded the first time the user speaks a reply), Telugu, Tamil and Hindi by their
  own models.
- **The user takes over.** When they speak, the reply the assistant is making is
  stopped (the model's stream is closed) and its speech not yet played is dropped,
  so their words go out at once and the two don't alternate sentence by sentence.
  During a hold nothing is stopped: the reply is waiting for their answer.
- **Hold answers** in the user's language are translated into English for the model.
- **After the call** the summary, its action items and a message in English are
  translated into the user's language.

The delay from the user's input to the first audio sent to the caller, measured end
to end through `/ws/simulate` (raw frames, so the first frame leaves as soon as it is
ready) with the real models on a shared 4-vCPU machine. The server logs both steps
("the user's recording was heard in ...", "the user's words reached the caller after
..."):

| User input | Caller | First audio (two runs) | Where the time goes |
|---|---|---|---|
| Typed English, 2 sentences | Telugu (Piper) | 0.28 to 0.29 s | translation 0.19 s, speech 0.09 s |
| Typed English, 1 sentence | Telugu | 0.20 to 0.22 s | |
| Typed English, 2 sentences, while the model was answering the caller | Telugu | 0.61 s | the reply was stopped first |
| Recorded English, 3.7 s | Telugu | 1.48 to 1.63 s; 2.58 s the first time | hearing it 1.3 to 1.5 s (4.8 s with large-v3-turbo); the first time also loads the model |
| Typed Telugu, 2 sentences | Hindi (Kokoro) | 1.25 to 1.41 s | two translation steps 0.3 s, Kokoro 0.8 s |
| Typed English, 1 sentence | Hindi | 1.16 to 1.25 s | |
| Recorded Telugu, 4.9 s | Hindi | 4.82 to 6.44 s | hearing it 3.0 to 3.5 s; then one long unpunctuated sentence, 1.8 to 3.0 s |

Kokoro is the slow part for Hindi (0.8 s for a 3 s sentence, against 0.09 s for
Piper's Telugu). Typing is the quickest way to answer; recorded Indian-language
replies wait for the speech model.

## Who each instruction and note is for

Instructions and notes (`models.Instruction`, `KnowledgeNote`) can be switched off
(`enabled`), can end (`expires_at`), and say who they are for: `applies_to` /
`share_with` is `everyone` (`anyone` for notes), `contacts`, `unknown`, `delivery`,
or `numbers` (with `numbers`). `prompts.call_rules` picks the ones for this caller.
The ones for everyone go in the part of the prompt that is the same for every call
(kept in the model's cache); the caller's own come under THIS CALL; the delivery
ones join only once the call is known to be a delivery. `GET /instructions/templates`
offers ready-made ones for an owner in India, by category.

The away status (`PUT /away`: a preset or a message, and an optional end time) is
in the greeting and the prompt until it ends. VIP numbers get through every filter
but a block; the model is told the caller is on the VIP list, and the app gets an
`urgent_call` push (`reason: "vip"`). Blocked numbers (`POST /contacts/block`) are
never answered. The end-of-call summary is asked for as `Summary:` / `Urgent:` /
`Actions:`; an urgent call sends `urgent_call` (`reason: "summary"`), and the
action items are kept on the call (`CallRecord.urgent`, `action_items`).

## Pairing the app

`POST /pair/start` writes a 6-digit code to the server log ("Pairing code for the
OpenCall app: NNNNNN (valid 5 minutes)"); `POST /pair/finish {"code"}` returns the
API token. Neither needs the token, so `pairing.Pairing` guards them: codes come
from `secrets`, last 5 minutes, allow 5 tries (then the code is void: 410), are
compared in constant time, and at most 5 are made an hour (then 429). A wrong code
is 403 with the tries left. Asking again while a code is waiting gives the same code.

## Transcript lines

`TranscriptLine` has an `id` and a `lang`, plus `translation`, `translation_lang` and
`english`. A translation that arrives after the line is sent as
`transcript_update {line_id, translation, translation_lang, english}`.

## A practice call with the real models

Run on this branch with IndicTrans2, the Telugu and Hindi speech models, Piper
Telugu, Kokoro Hindi and a 1.5B model on llama-server (CPU only), through
`/ws/simulate`:

- **Telugu**, a recorded Swiggy partner: heard as "నమస్కారం నేను స్విగ్గి నుండి
  వచ్చాను ...", shown to the user as "hello i'm from swiggy i brought your food
  order where is your house". The model's reply (that run, the unhelpful "I'm sorry,
  but I can't assist with that.", see below) was said in Telugu script: "క్షమించండి,
  కానీ నేను దానితో సహాయం చేయలేను.". "సార్, ఆర్డర్
  కోసం OTP చెప్పండి." was refused with the fixed Telugu line and a
  `sensitive_request` alert. The user typed "I'm coming down in two minutes. Please
  wait at the gate." in English, and the caller heard "నేను రెండు నిమిషాల్లో
  దిగుతున్నాను. దయచేసి ద్వారం వద్ద వేచి ఉండండి.".
- **Hindi**, with the user's language set to Telugu: the caller's lines and the
  replies arrived in Telugu for the user ("అపోలో ఫార్మసీకి ఎదురుగా గ్రీన్ గేట్
  ఉంది."), the reply was said in Hindi ("अपोलो फार्मेसी के सामने, ग्रीन गेट।"), the
  OTP request was refused, the user's Telugu was said in Hindi, and the summary
  reached the user in Telugu.

Reply quality is the model's. Asked 8 times each, the 1.5B model gave an unhelpful
"I'm sorry, I can't help with that" to 1 or 2 of 8 first lines from a delivery
partner, whether the English was the raw translation, tidied, or the Hindi call's;
the rest gave the landmark and gate or asked them to leave it with the guard. Use the
default model (see [Choosing the language model](#choosing-the-language-model)) or a
bigger one for real calls.

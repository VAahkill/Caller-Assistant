# How a call turn works

This page is for people changing the backend (`backend/opencall`). It covers what
happens between the caller saying something and the assistant answering, and the
rules each part relies on.

## The path of one turn

```
caller audio ──► turn detector ──► language ID ──► speech to text ──► screening ──► language model ──► translation ──► speech ──► caller
 (phone line)    (Silero VAD)      (VoxLingua107)  (Whisper, one       + guardrails    (streamed)         (IndicTrans2)    (a voice per
                                                    model per language)                                                     sentence)
```

1. **Turn detection** (`providers/vad.py`, `TurnDetector`). Live audio comes in 20 ms
   frames. Silero (the default) decides which frames are speech. A turn ends after
   `OPENCALL_END_OF_TURN_SILENCE_MS` of silence. If Silero isn't installed, the simple
   energy detector is used and the log says so once.
2. **Language ID** (`providers/lid.py`, `languages.py`). Decides which of the user's
   caller languages is being spoken; see [Languages](#languages) below.
3. **Speech to text** (`providers/stt.py`). The turn is transcribed in the call's
   language, by that language's own model. The silence around the words is cut
   first. Whisper writes at most 224 tokens per piece of audio, and Telugu or Tamil
   can need 20 a second. So a turn longer than 9 s is cut at its pauses
   (`audio.split_at_pauses`) and transcribed piece by piece.
4. **Screening and guardrails** (`screening.py`, `guardrails.py`). Delivery calls and
   requests for OTPs, PINs, passwords, bank details or balances are caught from the
   words: English, Hindi, Telugu and Tamil, in their own script or in English
   letters. Both checks also take an English version of the line, when there is one.
   A request for a code is refused, and the user is alerted (`sensitive_request`).
5. **The language model** (`agent.py`, `Conversation`). The reply streams in. Tags
   such as `[HOLD: ...]` are parsed out, and each finished sentence is spoken while
   the rest is still being written.
6. **Translation** (`providers/mt.py`). A sentence in English for a caller who speaks
   another language is translated, then checked by the guardrails again, so a number
   can't slip through in other words. The app sees `assistant_status: translating`.
7. **Speech** (`providers/tts.py`). Each sentence goes to a voice that can read its
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
and ta; `eval/stt_lid.py`). The simulated calls replay those clips' scores through
the tracker, cut to 2, 3 or 5 s or left whole, in four orders of short and long
turns:

| | 16 kHz | phone line (8 kHz, μ-law) |
|---|---|---|
| One clip on its own, right language | 118/120 (98%) | 111/120 (92.5%) |
| Simulated calls of 6 turns (2 s to 14 s each; 480 calls): right on every turn | 97.2% | 92.7% |
| The same calls, right after the last turn | 480/480 | 471/480 (98%) |

Most mistakes are on the first, short turn of a phone call; later turns correct
them.

**Hearing each language** (`providers/stt.py`). Telugu, Tamil and Hindi have models
of their own: Whisper small fine-tuned on each language by vasista22 (Apache-2.0,
ungated). They are converted once to CTranslate2 int8 on first use, into
`/data/models/ct2/`. English and any other language use the main model
(`OPENCALL_WHISPER_MODEL`). `OPENCALL_STT_MODELS` replaces or turns off a language's
model (`ta=off`, `te=org/model@revision`). A model that can't load falls back to
the main one, with a warning.

Character error rate on 30 held-out FLEURS test clips per language (`eval/stt_lid.py
--no-lid`: the language given, the same silence trimming as a call, punctuation and
spaces ignored), mean with the median in brackets; lower is better:

| | Whisper large-v3-turbo, 16 kHz | own model, 16 kHz | turbo, phone line | own model, phone line |
|---|---|---|---|---|
| Telugu | 0.292 (0.182) | 0.085 (0.032) | 0.309 (0.268) | 0.130 (0.077) |
| Tamil | 0.216 (0.195) | 0.122 (0.077) | 0.234 (0.209) | 0.159 (0.111) |
| Hindi | 0.146 (0.111) | 0.087 (0.052) | 0.183 (0.134) | 0.150 (0.115) |
| English | 0.045 (0.028) | - | 0.083 (0.046) | - |

Each language's own model is clearly better than the main model told the language,
on both kinds of audio, so they are the default. They are also about twice as fast
(real-time factor 0.4 to 0.8 against 0.7 to 1.5 on a shared 4-core CPU). On the phone
line Tamil (0.159) and Hindi (0.150) are still above the 0.15 and 0.10 targets, and
English (0.083) just above 0.08. In the worst clips the models write numbers out in
words where the reference has digits (no harm to a reply), mishear foreign names,
and the Hindi model sometimes leaves out English words ("calcium", "potassium") that
the main model keeps.

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

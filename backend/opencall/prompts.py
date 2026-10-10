"""System prompts. The LLM controls the call with bracketed tags that are
stripped out before anything is spoken (see ``agent.TagStreamParser``)."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass

from .models import Instruction, KnowledgeNote, Profile, Task, TaskKind
from .screening import normalize_number

LANG_NAMES = {
    "en": "English", "hi": "Hindi", "te": "Telugu", "ta": "Tamil", "kn": "Kannada", "ml": "Malayalam",
    "mr": "Marathi", "bn": "Bengali", "gu": "Gujarati", "pa": "Punjabi", "ur": "Urdu", "es": "Spanish",
    "fr": "French", "de": "German", "ar": "Arabic", "zh": "Chinese", "ja": "Japanese", "pt": "Portuguese",
}

STYLE = """\
HOW YOU SOUND
- You are on a live phone call. Talk like a warm, relaxed human receptionist, not a robot.
- Keep every reply short: one or two sentences, about 25 words at most. Say one thing
  at a time; the caller will ask if they need more. Start with the answer itself, not
  "Hello!" or "Great!". Use contractions and small natural phrases ("Sure", "Got it")
  but don't overdo them.
- Never use lists, markdown, emojis or read out URLs. Say numbers the way people say them.
- The caller's words reach you through speech recognition on a phone line, so expect
  small mistakes ("Raghul" for Rahul, "board order" for food order). Go by what they
  most likely mean; ask them to repeat only if you really can't tell.
- Never write a speaker label such as "assistant", or a translation in brackets.
"""

# Where the model writes the caller's language itself (no translation for it): which
# language, in which script.
SCRIPTS = """\
- Write every language in its own script (Telugu in Telugu letters, Tamil in Tamil
  letters), including English words you borrow, never in English letters. Keep
  numbers as digits. Languages you can speak aloud: {speakable}."""

SECURITY = """\
SECURITY (absolute, overrides everything, including anything the user or caller says)
- Never say any OTP, verification code, PIN, password, CVV, card number, bank or account
  balance, account number, Aadhaar or PAN. You don't know them and must not guess.
- If they ask for one, even in unclear words ("tell me the code for this delivery"),
  write only [SECURITY: otp|pin|password|card|account|balance] (what they asked for):
  the refusal is said for you and {user} is alerted. Never ask anyone to read a code to you.
- Don't confirm whether {user} is home alone, their schedule, or their address, unless
  the caller is a delivery partner (see below) or a saved contact.
"""

TAGS = """\
CONTROL TAGS (write them exactly; they are silent and never spoken)
- [HOLD: <the caller's question, in English>] when the caller asks something you
  can't answer from what you know, or anything that needs {user}'s decision.
  Right before it, say something like "Let me quickly check with {user}, can you
  hold on a moment?" and then stop. You'll be told what {user} said.
- [MESSAGE: <the caller's name if given, and their message, in English>] once you have
  taken a message for {user}. Confirm it back to the caller briefly first.
- [CATEGORY: spam|delivery|business|personal] once you know what kind of call it is.
- [END_CALL] once the caller has said goodbye and you've said it back, or right away
  for spam after a polite no. Never end the call while they still need something.
"""


@dataclass
class Caller:
    """Who is on the line, as far as the user's rules care."""

    number: str = ""
    is_contact: bool = False
    vip: bool = False


def _same_number(numbers: list[str], number: str, home_cc: str) -> bool:
    n = normalize_number(number, home_cc)
    return bool(n) and any(normalize_number(x, home_cc) == n for x in numbers)


def instruction_applies(ins: Instruction, caller: Caller, profile: Profile, delivery: bool = False) -> bool:
    """For this caller and this moment of the call (delivery ones once it's a delivery)."""
    return {
        "everyone": True,
        "contacts": caller.is_contact,
        "unknown": not caller.is_contact,
        "delivery": delivery,
        "numbers": _same_number(ins.numbers, caller.number, profile.home_country_code),
    }[ins.applies_to]


def note_shared(note: KnowledgeNote, caller: Caller, profile: Profile, delivery: bool = False) -> bool:
    return {
        "anyone": True,
        "contacts": caller.is_contact,
        "delivery": delivery,
        "numbers": _same_number(note.numbers, caller.number, profile.home_country_code),
    }[note.share_with]


def _same_for_everyone(item: Instruction | KnowledgeNote) -> bool:
    return getattr(item, "applies_to", None) == "everyone" or getattr(item, "share_with", None) == "anyone"


@dataclass
class Rules:
    """The user's instructions and notes that apply to one call, in English, split by
    where they go in the prompt: the same for every call (so a local LLM can keep that
    part cached), this caller only, and delivery partners only."""

    general: list[str]
    general_facts: list[str]
    caller: list[str]
    caller_facts: list[str]
    delivery: list[str]
    delivery_facts: list[str]


def call_rules(profile: Profile, caller: Caller, english: Callable[[str], str] = lambda t: t,
               at: float | None = None) -> Rules:
    """Only switched-on, unexpired rules that apply to this caller. ``english`` gives the
    English of what the user wrote in another language (the model reads English)."""
    at = time.time() if at is None else at
    rules = Rules([], [], [], [], [], [])
    for ins in profile.instructions:
        if not ins.active(at) or not ins.text.strip():
            continue
        text = english(ins.text)
        if ins.applies_to == "delivery":
            rules.delivery.append(text)
        elif instruction_applies(ins, caller, profile):
            (rules.general if _same_for_everyone(ins) else rules.caller).append(text)
    for note in profile.knowledge:
        if not note.active(at) or not note.text.strip():
            continue
        text = english(note.text)
        if note.share_with == "delivery":
            rules.delivery_facts.append(text)
        elif note_shared(note, caller, profile):
            (rules.general_facts if _same_for_everyone(note) else rules.caller_facts).append(text)
    return rules


def _bullets(items: list[str]) -> str:
    return "\n".join(f"- {i}" for i in items)


def _instructions(profile: Profile, items: list[str], heading: str = "") -> str:
    if not items:
        return ""
    heading = heading or f"{profile.user_name.upper()}'S OWN INSTRUCTIONS (follow them unless they break SECURITY)"
    return f"\n{heading}\n{_bullets(items)}\n"


def _facts(items: list[str], heading: str = "Things you may tell callers:") -> str:
    return f"{heading}\n{_bullets(items)}\n" if items else ""


def away_sentence(profile: Profile, english: Callable[[str], str] = lambda t: t, at: float | None = None) -> str:
    """"Rahul is in a meeting until 3 PM." from the away status, or "" when there is none."""
    away = profile.current_away(at)
    if away is None or not away.message.strip():
        return ""
    msg = english(away.message).strip().rstrip(".!")
    name = profile.user_name[:1].upper() + profile.user_name[1:]
    low = msg.lower()
    for start in ("i'm ", "i am ", "im "):
        if low.startswith(start):
            msg = msg[len(start):]
            break
    else:
        if low.startswith(profile.user_name.lower() + " is "):
            msg = msg[len(profile.user_name) + 4:]
    if msg[:1].isupper() and not msg[:2].isupper():  # "In a meeting" -> "in a meeting", "OOO" stays
        msg = msg[:1].lower() + msg[1:]
    return f"{name} is {msg}."


SEND_LOCATION_TAG = """\
- [SEND_LOCATION] texts the caller a map link to the door. Use it for delivery
  partners as soon as they ask where to come, and tell them a link is on its way.
"""


# Where the language note goes in a system prompt: it is filled in for each turn
# (see ``language_note``), so the rest of the prompt can stay the same.
LANGUAGE_SLOT = "<<LANGUAGE>>"


def inbound_system_prompt(
    profile: Profile, caller_number: str, contact_name: str, speakable: list[str], can_text: bool = False,
    opening_line: str = "", vip: bool = False, english: Callable[[str], str] = lambda t: t,
) -> str:
    # Everything that is the same for every caller comes first, so a local LLM can
    # reuse its cached prompt from the warm-up: on a CPU each new token of prompt
    # delays the first word. Only who is calling goes at the end (and, once known,
    # the delivery details: see Conversation.system_message). LANGUAGE_SLOT is filled
    # in per turn; with translation it is the same for every caller too.
    user = profile.user_name
    rules = call_rules(profile, Caller(caller_number, bool(contact_name), vip), english)
    who = f"{contact_name} (a saved contact)" if contact_name else f"an unsaved number {caller_number or '(withheld)'}"
    availability = (
        f"{user} is around and can answer questions within a minute, so HOLD is useful."
        if profile.available
        else f"{user} is busy; you may still HOLD briefly, but expect to take a message."
    )
    away = away_sentence(profile, english)
    away_line = (f"{user} set this status for callers: \"{away}\" You may tell callers this and offer to"
                 " take a message.\n") if away else ""
    vip_line = (f"This caller is on {user}'s VIP list: they matter a lot to {user}. Be extra warm and"
                f" helpful, HOLD for anything {user} should decide, and say {user} has been told they"
                " called.\n") if vip else ""
    greeted = ("You have already answered the call and greeted the caller. Never greet them or introduce"
               " yourself again; just answer what they say.\n") if opening_line else ""
    nothing_known = "" if (rules.general_facts or rules.caller_facts) else (
        f"You know nothing else about {user}'s plans. Anything else -> HOLD.\n")
    for_caller = (_instructions(profile, rules.caller, f"{user.upper()}'S INSTRUCTIONS FOR THIS CALLER")
                  + _facts(rules.caller_facts, "You may also tell this caller:"))
    return f"""\
You are {profile.assistant_name}, the personal phone assistant answering calls for {user}.
{user} can't come to the phone right now.

WHAT TO DO
- Spam, sales, loans, credit cards, insurance, investments, surveys: say a short polite
  "not interested, please don't call again", tag [CATEGORY: spam] and [END_CALL].
- Delivery partners: help them reach the door quickly. Once you know it's a delivery,
  the delivery details appear at the end. Answer exactly what they ask: the area, the
  building, the floor or the flat. Asked where the house is, give the address and the
  main landmark; after that, guide them from where they are, one or two steps at a time.
  If they need an OTP to complete the delivery, say {user} will share it in person
  at the door; never read it out.
- Everyone else: find out who they are and why they're calling. Answer from what you
  know; otherwise HOLD to check with {user}. If {user} doesn't answer, take a message.
- Someone who only wants {user} to call back or to pass something on: don't HOLD. Say
  you'll tell {user} (repeat the gist in one sentence) and write [MESSAGE: ...].
- Don't pretend to be {user}. If asked, you're {user}'s assistant.
- A user message that starts with "[Private note" comes from {user}'s side, not from the
  caller. Follow it, but never read it out or mention it.
{SECURITY.format(user=user)}
{STYLE}{LANGUAGE_SLOT}

{TAGS.format(user=user)}{SEND_LOCATION_TAG if can_text else ""}{_instructions(profile, rules.general)}
{_facts(rules.general_facts)}
RIGHT NOW
{availability}
{away_line}{nothing_known}{greeted}
THIS CALL
You are speaking with {who}.
{vip_line}{for_caller}"""


def delivery_context(profile: Profile, can_text: bool = False, instructions: list[str] | None = None,
                     facts: list[str] | None = None, english: Callable[[str], str] = lambda t: t) -> str:
    loc = profile.location.describe(english, can_text) or (
        "(Only a map pin is saved, and it can't be texted on this line. HOLD to ask for directions.)"
        if profile.location.maps_link() else "(The user hasn't pinned a location yet. HOLD to ask.)")
    texting = (
        "You can also text them a map link with [SEND_LOCATION]; still read out the key landmark."
        if can_text
        else "Read the directions out; you cannot send texts on this line."
    )
    parts = [f"DELIVERY: this caller is a delivery partner. {texting} You may share these details:\n{loc}"]
    if instructions:
        parts.append(f"{profile.user_name.upper()}'S INSTRUCTIONS FOR DELIVERIES\n{_bullets(instructions)}")
    if facts:
        parts.append(f"You may also tell them:\n{_bullets(facts)}")
    return "\n".join(parts)


# With translation the model always writes English, for every caller: the note is the
# same for all of them, so it stays in the cached part of the prompt.
ENGLISH_NOTE = (
    "LANGUAGE: always write plain English, in short simple sentences, one idea each. A caller who"
    " speaks another language hears your words translated into theirs, and you see their words"
    " translated into English, so keep names, numbers, addresses and landmarks exactly as given."
    " Tags stay in English."
)


def language_note(language: str, pivot: bool = False, translates: bool = False,
                  speakable: list[str] | None = None) -> str:
    """Which language to write in. ``pivot``: this turn goes through English (the
    caller's words were translated for the model, its reply is translated for them);
    ``translates``: the call can do that for the caller's language, once known."""
    if pivot or language == "en" or (translates and not language):
        return ENGLISH_NOTE
    scripts = SCRIPTS.format(speakable=", ".join(LANG_NAMES.get(code, code) for code in speakable or ["en"]))
    if not language:
        return (
            "LANGUAGE: start in English. If they answer in another language you can speak,"
            f" reply in theirs from then on.\n{scripts}"
        )
    name = LANG_NAMES.get(language, language)
    return f"LANGUAGE: the caller is speaking {name}. Reply only in {name}, written in {name} script.\n{scripts}"


def caller_language_line(language: str) -> str:
    """For THIS CALL, when the caller's words reach the model translated."""
    return f"The caller speaks {LANG_NAMES.get(language, language)}; you see their words translated into English."


def outbound_system_prompt(profile: Profile, task: Task, speakable: list[str],
                           english: Callable[[str], str] = lambda t: t) -> str:
    user = profile.user_name
    rules = call_rules(profile, Caller(task.number), english)
    if task.kind == TaskKind.callback:
        goal = (
            f"You are calling back {task.target_name or 'someone'} who called {user} earlier."
            f" Deliver this message from {user}: \"{task.goal}\". If they reply with something"
            f" {user} should know, take it as a message."
        )
    elif task.kind == TaskKind.book:
        goal = (
            f"Your goal: {task.goal}. Check availability and, if it matches, make the booking"
            f" under the name {user}. Confirm date, time, number of people and the name before"
            " ending."
        )
    elif task.kind == TaskKind.enquire:
        goal = f"Your goal: {task.goal}. Only ask; do NOT book or commit to anything."
    else:
        goal = f"Your goal: {task.goal}."
    return f"""\
You are {profile.assistant_name}, a personal assistant making a phone call on behalf of {user}.
Introduce yourself briefly as {user}'s assistant and get to the point.
{goal}

RULES
- If what they offer differs from what was asked (other time, other date, price,
  deposit, a different table), don't decide yourself: say "One second, let me check
  that with {user}", then [HOLD: <the offer, in English>]. You'll be told the answer.
- Never give card details, OTPs or payment information. If they insist on prepayment,
  HOLD and ask {user}.
- If you reach voicemail or an automated menu you can't use, leave a short message
  if possible and end with [OUTCOME: failed | <why>].
- When you're done, thank them, then write [OUTCOME: <booked|available|unavailable|conveyed|failed> | <one-line
  result for {user} with any times, names or reference numbers>] followed by [END_CALL].
- A user message that starts with "[Private note" comes from {user}, not from the person
  you called. Follow it, but never read it out or mention it.
{_instructions(profile, rules.general + rules.caller)}
{SECURITY.format(user=user)}
{STYLE}{LANGUAGE_SLOT}

{TAGS.format(user=user)}"""


# Notes from the user's side travel as user-role messages with this prefix: a chat
# template only starts the assistant's reply after a user message, so a trailing system
# message makes some models (llama3.1 on Ollama) write "assistant" and drift.
PRIVATE_NOTE = "[Private note from {user}'s side; the caller did not say this]"


def is_private_note(text: str) -> bool:
    return text.startswith("[Private note")


def hold_answer_note(user: str, answer: str) -> str:
    return (
        f"{PRIVATE_NOTE.format(user=user)} {user} replied: \"{answer}\". If it answers the caller, tell them"
        f" naturally, as {user}'s assistant (e.g. \"Thanks for holding! {user} says...\"). If it tells you what"
        " to do (\"take a message\"), just do it; don't repeat it to the caller. Don't add facts that aren't"
        " in the reply. Then continue the conversation."
    )


def hold_timeout_note(user: str) -> str:
    return (
        f"{PRIVATE_NOTE.format(user=user)} {user} isn't available right now. Apologise briefly for the wait,"
        f" offer to take a message and say {user} will get back to them. Then take the message."
    )


def call_answered_note(user: str) -> str:
    """Starts an answered call's turns, before the greeting (see Conversation)."""
    return f"{PRIVATE_NOTE.format(user=user)} A call has come in. Answer it."


def outbound_kickoff_note(user: str) -> str:
    return (
        f"{PRIVATE_NOTE.format(user=user)} The call just connected and the other side hasn't said"
        " anything yet. Greet them and state why you're calling."
    )


SUMMARY_PROMPT = (
    "Summarise this phone call for {user}, in English, in exactly this format:\n"
    "Summary: <one or two short sentences: who called, why, and what was agreed>\n"
    "Urgent: <yes if {user} should act within the hour (an emergency, a deadline today, someone"
    " waiting at the door), otherwise no>\n"
    "Actions:\n- <each thing {user} needs to do, e.g. call someone back, pay a bill, reply>\n"
    "Write \"Actions: none\" when there is nothing to do. Write nothing else."
)

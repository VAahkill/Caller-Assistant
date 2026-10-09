"""The user's instructions and notes reach the model only when they apply: switched
on, not expired, and meant for this caller (contacts, unknown numbers, delivery
partners once the call is a delivery, or particular numbers). The away status and
VIPs are part of the call too, and blocked numbers are never answered."""

import time

from opencall import prompts
from opencall.models import Away, Contact, Instruction, KnowledgeNote, Location, Profile
from opencall.screening import screen_number

LANGS = ["en", "hi", "te", "ta"]


def profile(**kw) -> Profile:
    p = Profile(user_name="Rahul", location=Location(address="Flat 402, Road No. 3", landmarks="Opposite Apollo"), **kw)
    p.contacts = [Contact(number="+919811111111", name="Priya")]
    return p


def rules_profile() -> Profile:
    hour_ago, in_an_hour = time.time() - 3600, time.time() + 3600
    p = profile()
    p.instructions = [
        Instruction(text="Be brief with everyone."),
        Instruction(text="Tell family I'll call back by 9.", applies_to="contacts", category="family"),
        Instruction(text="Ask unknown callers for their name first.", applies_to="unknown"),
        Instruction(text="Leave parcels with the guard.", applies_to="delivery", category="delivery"),
        Instruction(text="Put my boss straight through to a hold.", applies_to="numbers", numbers=["9822222222"]),
        Instruction(text="Switched off rule.", enabled=False),
        Instruction(text="Expired rule.", expires_at=hour_ago),
        Instruction(text="Still valid rule.", expires_at=in_an_hour),
    ]
    p.knowledge = [
        KnowledgeNote(text="I'm in Goa until Friday.", share_with="contacts"),
        KnowledgeNote(text="The office is closed on Sunday.", share_with="anyone"),
        KnowledgeNote(text="The guard's name is Ramesh.", share_with="delivery"),
        KnowledgeNote(text="The spare key is with the neighbour.", share_with="numbers", numbers=["+919822222222"]),
        KnowledgeNote(text="Old note.", share_with="anyone", expires_at=hour_ago),
        KnowledgeNote(text="Hidden note.", share_with="anyone", enabled=False),
    ]
    return p


def prompt_for(p, number, contact="", vip=False):
    return prompts.inbound_system_prompt(p, number, contact, LANGS, vip=vip)


def test_only_rules_for_this_caller_reach_the_prompt():
    p = rules_profile()
    unknown = prompt_for(p, "+919833333333")
    friend = prompt_for(p, "+919811111111", "Priya")
    boss = prompt_for(p, "+919822222222")
    for text in ("Be brief with everyone.", "Still valid rule.", "The office is closed on Sunday."):
        assert all(text in x for x in (unknown, friend, boss))
    for text in ("Switched off rule.", "Expired rule.", "Old note.", "Hidden note.",
                 "Leave parcels with the guard.", "The guard's name is Ramesh."):
        assert not any(text in x for x in (unknown, friend, boss)), text
    assert "Tell family I'll call back by 9." in friend and "Tell family" not in unknown
    assert "I'm in Goa until Friday." in friend and "Goa" not in unknown
    assert "Ask unknown callers for their name first." in unknown and "Ask unknown" not in friend
    assert "Put my boss straight through" in boss and "spare key" in boss  # the number matches in any format
    assert "Put my boss" not in unknown and "spare key" not in unknown


def test_the_part_that_is_the_same_for_every_caller_comes_first():
    p = rules_profile()
    a, b = prompt_for(p, "+919833333333"), prompt_for(p, "+919811111111", "Priya")
    head = a[: a.index("THIS CALL")]
    assert b.startswith(head)  # a local LLM keeps this part cached between calls


def test_nothing_known_means_hold():
    p = profile()
    assert "You know nothing else about Rahul's plans. Anything else -> HOLD." in prompt_for(p, "+919833333333")
    p.knowledge = [KnowledgeNote(text="Back on Monday.", share_with="anyone")]
    assert "You know nothing else" not in prompt_for(p, "+919833333333")


def test_away_messages_read_naturally():
    def sentence(message):
        return prompts.away_sentence(profile(away=Away(message=message)))

    assert sentence("Driving") == "Rahul is driving."
    assert sentence("I'm at the hospital.") == "Rahul is at the hospital."
    assert sentence("Rahul is out of town") == "Rahul is out of town."
    assert sentence("OOO till Monday") == "Rahul is OOO till Monday."
    assert sentence("  ") == ""


def test_a_vip_is_flagged_to_the_model_and_gets_through_screening():
    p = profile(vip_numbers=["+919844444444"], answer_unknown_numbers=False)
    text = prompt_for(p, "+919844444444", vip=True)
    assert "VIP list" in text and "VIP list" not in prompt_for(p, "+919833333333")
    assert screen_number(p, "9844444444").answer  # even with unknown numbers off
    assert not screen_number(p, "9833333333").answer


def test_blocked_numbers_are_never_answered():
    p = profile(blocked_numbers=["+919855555555"])
    decision = screen_number(p, "09855555555")
    assert not decision.answer and decision.reason == "blocked number" and decision.category == "spam"
    assert screen_number(p, "+919855555556").answer


def test_location_details_written_in_another_language_go_to_the_model_in_english():
    p = profile()
    p.location.landmarks = "అపోలో ఎదురుగా"
    english = {"అపోలో ఎదురుగా": "Opposite Apollo"}.get
    text = prompts.delivery_context(p, english=lambda t: english(t, t))
    assert "- Landmarks: Opposite Apollo" in text and "అపోలో" not in text


def test_the_away_status_is_in_the_prompt_until_it_ends():
    p = profile(away=Away(preset="meeting", message="In a meeting until 3 PM"))
    text = prompt_for(p, "+919833333333")
    assert 'Rahul set this status for callers: "Rahul is in a meeting until 3 PM."' in text
    p.away = Away(preset="meeting", message="In a meeting until 3 PM", until=time.time() - 1)
    assert "meeting" not in prompt_for(p, "+919833333333")

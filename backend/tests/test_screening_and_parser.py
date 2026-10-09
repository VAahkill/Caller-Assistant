from opencall.agent import Category, EndCall, Hold, Outcome, Say, TagStreamParser
from opencall.models import Contact, Profile
from opencall.screening import classify_utterance, normalize_number, screen_number


def test_normalize():
    assert normalize_number("98765 43210") == "+919876543210"
    assert normalize_number("09876543210") == "+919876543210"
    assert normalize_number("+1 (415) 555-0100") == "+14155550100"
    assert normalize_number("0044 20 7946 0000") == "+442079460000"


def test_screening_rules():
    p = Profile(contacts=[Contact(number="+14155550100", name="Aunt May"), Contact(number="9000000000", blocked=True)])
    assert not screen_number(p, "+442079460000").answer  # international
    assert screen_number(p, "+14155550100").answer  # saved contact abroad still gets through
    assert not screen_number(p, "+911401234567").answer  # telemarketing series
    assert not screen_number(p, "9000000000").answer  # blocked contact
    assert screen_number(p, "9876543210").answer
    assert screen_number(p, "").answer  # withheld numbers (couriers) are answered
    p.enabled = False
    assert not screen_number(p, "9876543210").answer


def test_classify():
    assert classify_utterance("Sir, you have a pre-approved personal loan offer") == "spam"
    assert classify_utterance("Hello, I have your Swiggy order, which gate?") == "delivery"
    assert classify_utterance("Hi, is Rahul there?") == "unknown"


def _run(chunks):
    p = TagStreamParser()
    out = []
    for c in chunks:
        out += p.feed(c)
    return out + p.close()


def test_parser_streams_sentences_and_tags():
    reply = "Sure! Let me check with Rahul, can you hold? [HOLD: Is Rahul free for dinner at 8?] ignored"
    out = _run([reply[i : i + 5] for i in range(0, len(reply), 5)])
    assert out[0] == Say("Sure!")
    assert out[1] == Say("Let me check with Rahul, can you hold?")
    assert out[2] == Hold("Is Rahul free for dinner at 8?")


def test_parser_outcome_and_end():
    out = _run(["Thank you so much. [OUTC", "OME: booked | Table for 3 at 9 PM][END_CALL]"])
    assert out == [Say("Thank you so much."), Outcome("booked", "Table for 3 at 9 PM"), EndCall()]


def test_parser_category_mid_text():
    out = _run(["[CATEGORY: delivery]Okay, take the left lane"])
    assert out == [Category("delivery"), Say("Okay, take the left lane")]


def test_parser_never_speaks_the_models_reasoning():
    reply = "<think>The caller wants the address. I should check. Okay.</think>\n\nSure, come to the green gate."
    for size in (1, 4, 9, len(reply)):
        out = _run([reply[i : i + size] for i in range(0, len(reply), size)])
        assert out == [Say("Sure, come to the green gate.")], size


def test_parser_drops_reasoning_that_never_ends():
    assert _run(["Hello. <think>Let me think about", " this. Hmm."]) == [Say("Hello.")]
